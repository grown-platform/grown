package handler

// TemplatesHandler provides document-template CRUD endpoints as plain HTTP
// (no proto/gRPC gateway) to avoid proto regeneration.
//
// Routes (registered in main.go):
//   GET    /api/templates                       — list templates for org
//   GET    /api/templates/{id}                  — get one template + fields
//   DELETE /api/templates/{id}                  — delete template
//   POST   /api/documents/{id}/save-as-template — snapshot current field layout
//   POST   /api/templates/{id}/create-document  — new document shell from template

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"code.pick.haus/grown/grown/internal/pdf/auth"
	"code.pick.haus/grown/grown/internal/pdf/config"
	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
	"code.pick.haus/grown/grown/internal/pdf/storage"
)

const defaultOrgID = "org_default"

type TemplatesHandler struct {
	db      *database.DB
	cfg     *config.Config
	storage *storage.Client
}

func NewTemplatesHandler(db *database.DB, cfg *config.Config, storageClient *storage.Client) *TemplatesHandler {
	return &TemplatesHandler{db: db, cfg: cfg, storage: storageClient}
}

// ----- response shapes -----

type templateFieldJSON struct {
	ID         string  `json:"id"`
	TemplateID string  `json:"templateId"`
	SignerSlot int32   `json:"signerSlot"`
	FieldType  string  `json:"fieldType"`
	PageNumber int32   `json:"pageNumber"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Width      float64 `json:"width"`
	Height     float64 `json:"height"`
	Required   bool    `json:"required"`
	Label      string  `json:"label,omitempty"`
	FontSize   int32   `json:"fontSize,omitempty"`
}

type templateJSON struct {
	ID             string              `json:"id"`
	OrganizationID string              `json:"organizationId"`
	Name           string              `json:"name"`
	Description    string              `json:"description,omitempty"`
	SignerSlots    int32               `json:"signerSlots"`
	SigningOrder   bool                `json:"signingOrder"`
	CreatedBy      string              `json:"createdBy"`
	CreatedAt      time.Time           `json:"createdAt"`
	Fields         []templateFieldJSON `json:"fields"`
}

func templateToJSON(t sqlc.DocumentTemplate, fields []sqlc.TemplateField) templateJSON {
	tj := templateJSON{
		ID:             t.ID,
		OrganizationID: t.OrganizationID,
		Name:           t.Name,
		SignerSlots:    t.SignerSlots,
		SigningOrder:   t.SigningOrder,
		CreatedBy:      t.CreatedBy,
		Fields:         make([]templateFieldJSON, 0, len(fields)),
	}
	if t.Description.Valid {
		tj.Description = t.Description.String
	}
	if t.CreatedAt.Valid {
		tj.CreatedAt = t.CreatedAt.Time
	}
	for _, f := range fields {
		fj := templateFieldJSON{
			ID:         f.ID,
			TemplateID: f.TemplateID,
			SignerSlot: f.SignerSlot,
			FieldType:  f.FieldType,
			PageNumber: f.PageNumber,
			Required:   f.Required,
			X:          float64FromNumeric(f.X),
			Y:          float64FromNumeric(f.Y),
			Width:      float64FromNumeric(f.Width),
			Height:     float64FromNumeric(f.Height),
		}
		if f.Label.Valid {
			fj.Label = f.Label.String
		}
		if f.FontSize.Valid {
			fj.FontSize = f.FontSize.Int32
		}
		tj.Fields = append(tj.Fields, fj)
	}
	return tj
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("writeJSON encode error", "error", err)
	}
}

// ----- handlers -----

// ListTemplates handles GET /api/templates
func (h *TemplatesHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := h.db.Queries.ListTemplates(r.Context(), sqlc.ListTemplatesParams{
		OrganizationID: defaultOrgID,
		Limit:          50,
		Offset:         0,
	})
	if err != nil {
		slog.Error("ListTemplates failed", "error", err)
		http.Error(w, "failed to list templates", http.StatusInternalServerError)
		return
	}
	out := make([]templateJSON, 0, len(templates))
	for _, t := range templates {
		fields, _ := h.db.Queries.GetTemplateFields(r.Context(), t.ID)
		out = append(out, templateToJSON(t, fields))
	}
	total, _ := h.db.Queries.CountTemplates(r.Context(), defaultOrgID)
	writeJSON(w, http.StatusOK, map[string]any{
		"templates":  out,
		"totalCount": total,
	})
}

// GetTemplate handles GET /api/templates/{id}
func (h *TemplatesHandler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	id := templateIDFromPath(r.URL.Path, "")
	if id == "" {
		http.Error(w, "template id required", http.StatusBadRequest)
		return
	}
	t, err := h.db.Queries.GetTemplateByOrg(r.Context(), sqlc.GetTemplateByOrgParams{
		ID: id, OrganizationID: defaultOrgID,
	})
	if err != nil {
		http.Error(w, "template not found", http.StatusNotFound)
		return
	}
	fields, _ := h.db.Queries.GetTemplateFields(r.Context(), t.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"template": templateToJSON(t, fields),
	})
}

// DeleteTemplate handles DELETE /api/templates/{id}
func (h *TemplatesHandler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id := templateIDFromPath(r.URL.Path, "")
	if id == "" {
		http.Error(w, "template id required", http.StatusBadRequest)
		return
	}
	if err := h.db.Queries.DeleteTemplateFields(r.Context(), id); err != nil {
		slog.Error("DeleteTemplateFields failed", "id", id, "error", err)
	}
	if err := h.db.Queries.DeleteTemplate(r.Context(), id); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// SaveAsTemplate handles POST /api/documents/{id}/save-as-template
// Body: {"name":"...","description":"..."}
func (h *TemplatesHandler) SaveAsTemplate(w http.ResponseWriter, r *http.Request) {
	docID := docIDFromPath(r.URL.Path, "/save-as-template")
	if docID == "" {
		http.Error(w, "document id required", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		http.Error(w, "could not read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	// Load the document and its signers/fields
	doc, err := h.db.Queries.GetDocument(r.Context(), docID)
	if err != nil {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	signers, err := h.db.Queries.GetSignersByDocument(r.Context(), docID)
	if err != nil {
		http.Error(w, "failed to load signers", http.StatusInternalServerError)
		return
	}
	if len(signers) == 0 {
		http.Error(w, "document has no signers to snapshot", http.StatusBadRequest)
		return
	}

	userID := auth.UserEmailFromContext(r.Context())
	if userID == "" {
		userID = doc.CreatedBy
	}

	tmplID := "tmpl_" + uuid.New().String()
	tmpl, err := h.db.Queries.CreateTemplate(r.Context(), sqlc.CreateTemplateParams{
		ID:             tmplID,
		OrganizationID: doc.OrganizationID,
		Name:           req.Name,
		Description:    textFromString(req.Description),
		SignerSlots:    int32(len(signers)),
		SigningOrder:   doc.SigningOrder,
		CreatedBy:      userID,
	})
	if err != nil {
		slog.Error("CreateTemplate failed", "error", err)
		http.Error(w, "failed to create template", http.StatusInternalServerError)
		return
	}

	// Copy each signer's fields as template fields. The signer slot maps to
	// signing_order (1-based), so field layout is preserved.
	var createdFields []sqlc.TemplateField
	for _, s := range signers {
		fields, err := h.db.Queries.GetSignatureFieldsBySigner(r.Context(), s.ID)
		if err != nil {
			continue
		}
		slot := s.SigningOrder
		if slot < 1 {
			slot = 1
		}
		for _, f := range fields {
			fID := "tfld_" + uuid.New().String()
			var fontSizeVal pgtype.Int4
			if f.FontSize.Valid {
				fontSizeVal = f.FontSize
			}
			tf, err := h.db.Queries.CreateTemplateField(r.Context(), sqlc.CreateTemplateFieldParams{
				ID:         fID,
				TemplateID: tmplID,
				SignerSlot: slot,
				FieldType:  string(f.FieldType),
				PageNumber: f.PageNumber,
				X:          f.X,
				Y:          f.Y,
				Width:      f.Width,
				Height:     f.Height,
				Required:   f.Required,
				Label:      f.Label,
				FontSize:   fontSizeVal,
			})
			if err != nil {
				slog.Error("CreateTemplateField failed", "error", err)
				continue
			}
			createdFields = append(createdFields, tf)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"template": templateToJSON(tmpl, createdFields),
	})
}

// CreateDocumentFromTemplate handles POST /api/templates/{id}/create-document
// Body: {"name":"...","description":"..."}
// Creates an empty document shell with signing_order preset from the template.
// The caller still needs to upload a PDF and assign signers manually (the
// template provides field-slot information but not the actual signer identities).
func (h *TemplatesHandler) CreateDocumentFromTemplate(w http.ResponseWriter, r *http.Request) {
	tmplID := templateIDFromPath(r.URL.Path, "/create-document")
	if tmplID == "" {
		http.Error(w, "template id required", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		http.Error(w, "could not read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}

	tmpl, err := h.db.Queries.GetTemplateByOrg(r.Context(), sqlc.GetTemplateByOrgParams{
		ID: tmplID, OrganizationID: defaultOrgID,
	})
	if err != nil {
		http.Error(w, "template not found", http.StatusNotFound)
		return
	}

	userID := auth.UserEmailFromContext(r.Context())
	if userID == "" {
		userID = "user_default"
	}

	docID := "doc_" + uuid.New().String()
	storageKey := fmt.Sprintf("%s/documents/%s/original.pdf", defaultOrgID, docID)

	doc, err := h.db.Queries.CreateDocument(r.Context(), sqlc.CreateDocumentParams{
		ID:             docID,
		OrganizationID: defaultOrgID,
		Name:           req.Name,
		Description:    textFromString(req.Description),
		Status:         sqlc.DocumentStatusDraft,
		StorageKey:     storageKey,
		TotalPages:     1,
		SigningOrder:   tmpl.SigningOrder,
		CreatedBy:      userID,
	})
	if err != nil {
		slog.Error("CreateDocument from template failed", "error", err)
		http.Error(w, "failed to create document", http.StatusInternalServerError)
		return
	}

	// Generate presigned upload URL (valid 15 min)
	uploadURL, err := h.storage.GetPresignedUploadURL(r.Context(), storageKey, 15*time.Minute, "application/pdf")
	if err != nil {
		slog.Error("GetPresignedUploadURL failed", "error", err)
		// Non-fatal — return the document without the URL
		uploadURL = ""
	}

	// Return document info + template metadata so the frontend can guide
	// the user through assigning signers to the pre-saved slots.
	fields, _ := h.db.Queries.GetTemplateFields(r.Context(), tmplID)
	writeJSON(w, http.StatusOK, map[string]any{
		"document":       doc,
		"uploadUrl":      uploadURL,
		"templateName":   tmpl.Name,
		"signerSlots":    tmpl.SignerSlots,
		"signingOrder":   tmpl.SigningOrder,
		"templateFields": templateFieldsToJSON(fields),
	})
}

// templateFieldsToJSON converts a slice for JSON response.
func templateFieldsToJSON(fields []sqlc.TemplateField) []templateFieldJSON {
	out := make([]templateFieldJSON, 0, len(fields))
	for _, f := range fields {
		fj := templateFieldJSON{
			ID:         f.ID,
			TemplateID: f.TemplateID,
			SignerSlot: f.SignerSlot,
			FieldType:  f.FieldType,
			PageNumber: f.PageNumber,
			Required:   f.Required,
			X:          float64FromNumeric(f.X),
			Y:          float64FromNumeric(f.Y),
			Width:      float64FromNumeric(f.Width),
			Height:     float64FromNumeric(f.Height),
		}
		if f.Label.Valid {
			fj.Label = f.Label.String
		}
		if f.FontSize.Valid {
			fj.FontSize = f.FontSize.Int32
		}
		out = append(out, fj)
	}
	return out
}

// ----- path helpers -----

// templateIDFromPath extracts the {id} segment from /api/templates/{id}[/<suffix>].
func templateIDFromPath(path, suffix string) string {
	const prefix = "/api/templates/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(path, prefix)
	if suffix != "" {
		if !strings.HasSuffix(rest, suffix) {
			return ""
		}
		rest = strings.TrimSuffix(rest, suffix)
	}
	// Trim any trailing slash components
	if idx := strings.Index(rest, "/"); idx >= 0 {
		rest = rest[:idx]
	}
	if rest == "" {
		return ""
	}
	return rest
}
