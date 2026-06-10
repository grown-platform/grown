package handler

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/sqlc"
)

// AnnotationsHandler exposes document-scoped annotation persistence.
// Plain HTTP (no proto / gRPC gateway) to avoid proto regeneration for an
// additive feature.
type AnnotationsHandler struct {
	db *database.DB
}

func NewAnnotationsHandler(db *database.DB) *AnnotationsHandler {
	return &AnnotationsHandler{db: db}
}

// GetAnnotations handles GET /api/documents/{id}/annotations.
// Returns {"annotations": <jsonarray>}.
func (h *AnnotationsHandler) GetAnnotations(w http.ResponseWriter, r *http.Request) {
	docID := docIDFromPath(r.URL.Path, "/annotations")
	if docID == "" {
		http.Error(w, "document id required", http.StatusBadRequest)
		return
	}
	raw, err := h.db.Queries.GetDocumentAnnotations(r.Context(), docID)
	if err != nil {
		slog.Warn("GetDocumentAnnotations failed", "docId", docID, "error", err)
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	// raw is JSONB bytes — already a JSON value. Forward as-is inside an
	// envelope so the response shape is stable.
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"annotations":`))
	if len(raw) == 0 {
		w.Write([]byte("[]"))
	} else {
		w.Write(raw)
	}
	w.Write([]byte(`}`))
}

// PutAnnotations handles PUT /api/documents/{id}/annotations.
// Body: {"annotations": [...]}. Replaces the stored array.
func (h *AnnotationsHandler) PutAnnotations(w http.ResponseWriter, r *http.Request) {
	docID := docIDFromPath(r.URL.Path, "/annotations")
	if docID == "" {
		http.Error(w, "document id required", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 5<<20)) // 5MB cap
	if err != nil {
		http.Error(w, "could not read body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var payload struct {
		Annotations json.RawMessage `json:"annotations"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if len(payload.Annotations) == 0 {
		payload.Annotations = json.RawMessage("[]")
	}
	// Sanity: the value must be a JSON array. Reject objects/strings/etc.
	trimmed := []byte(strings.TrimSpace(string(payload.Annotations)))
	if len(trimmed) == 0 || trimmed[0] != '[' {
		http.Error(w, "annotations must be a JSON array", http.StatusBadRequest)
		return
	}

	if err := h.db.Queries.UpdateDocumentAnnotations(r.Context(), sqlc.UpdateDocumentAnnotationsParams{
		ID:          docID,
		Annotations: []byte(payload.Annotations),
	}); err != nil {
		slog.Error("UpdateDocumentAnnotations failed", "docId", docID, "error", err)
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetAnnotationsByToken handles GET /api/sign/{token}/annotations — the
// guest-signer-side read path. Validates the access token, then returns
// the document's stored annotations. Read-only — signers cannot write.
func (h *AnnotationsHandler) GetAnnotationsByToken(w http.ResponseWriter, r *http.Request) {
	token := tokenFromPath(r.URL.Path, "/annotations")
	if token == "" {
		http.Error(w, "token required", http.StatusBadRequest)
		return
	}
	signer, err := h.db.Queries.GetSignerByToken(r.Context(), pgtype.Text{String: token, Valid: true})
	if err != nil {
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}
	raw, err := h.db.Queries.GetDocumentAnnotations(r.Context(), signer.DocumentID)
	if err != nil {
		slog.Warn("GetDocumentAnnotations via token failed", "docId", signer.DocumentID, "error", err)
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"annotations":`))
	if len(raw) == 0 {
		w.Write([]byte("[]"))
	} else {
		w.Write(raw)
	}
	w.Write([]byte(`}`))
}

// tokenFromPath extracts the {token} segment of /api/sign/{token}/<suffix>.
// Returns "" if the path doesn't match that shape.
func tokenFromPath(path, suffix string) string {
	const prefix = "/api/sign/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(path, prefix)
	if !strings.HasSuffix(rest, suffix) {
		return ""
	}
	tok := strings.TrimSuffix(rest, suffix)
	if tok == "" || strings.Contains(tok, "/") {
		return ""
	}
	return tok
}

// docIDFromPath extracts the {id} segment of /api/documents/{id}/<suffix>.
// Returns "" if the path doesn't match that shape.
func docIDFromPath(path, suffix string) string {
	const prefix = "/api/documents/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(path, prefix)
	if !strings.HasSuffix(rest, suffix) {
		return ""
	}
	id := strings.TrimSuffix(rest, suffix)
	if id == "" || strings.Contains(id, "/") {
		return ""
	}
	return id
}
