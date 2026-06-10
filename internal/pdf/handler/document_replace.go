package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/pdf/database"
	"code.pick.haus/grown/grown/internal/pdf/storage"
)

// DocumentReplaceHandler issues a fresh presigned PUT URL for an existing
// document's storage key. Used by the edit page when saving in-place text
// changes: the client regenerates the PDF via pdf-lib and PUTs back to the
// same S3 key.
//
// Plain HTTP (no proto regen) since this is additive.
type DocumentReplaceHandler struct {
	db      *database.DB
	storage *storage.Client
}

func NewDocumentReplaceHandler(db *database.DB, storage *storage.Client) *DocumentReplaceHandler {
	return &DocumentReplaceHandler{db: db, storage: storage}
}

// ReplaceURL handles POST /api/documents/{id}/replace-url.
// Returns {"uploadUrl": "..."} — caller PUTs the regenerated PDF blob there.
//
// Authz today: any authenticated caller (the OIDC middleware has already
// verified the cookie). Tightening to owner-or-superadmin is tracked
// alongside the other org_id-from-context deferred items.
func (h *DocumentReplaceHandler) ReplaceURL(w http.ResponseWriter, r *http.Request) {
	docID := docIDFromPath(r.URL.Path, "/replace-url")
	if docID == "" {
		http.Error(w, "document id required", http.StatusBadRequest)
		return
	}
	doc, err := h.db.Queries.GetDocument(r.Context(), docID)
	if err != nil {
		slog.Warn("ReplaceURL: GetDocument failed", "docId", docID, "error", err)
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(doc.StorageKey) == "" {
		http.Error(w, "document has no storage key", http.StatusInternalServerError)
		return
	}
	url, err := h.storage.GetPresignedUploadURL(r.Context(), doc.StorageKey, 15*time.Minute, "application/pdf")
	if err != nil {
		slog.Error("ReplaceURL: presign failed", "docId", docID, "error", err)
		http.Error(w, "could not issue upload url", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"uploadUrl": url})
}
