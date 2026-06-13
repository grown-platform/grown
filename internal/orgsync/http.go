package orgsync

import (
	"encoding/json"
	"net/http"
)

// HTTPHandler exposes the org-to-org transfer surface, mounted inside grown's
// auth middleware:
//
//	POST /api/v1/orgsync/transfer
//	  { "target_slug": "...", "drive_file_ids": [...], "contact_ids": [...] }
type HTTPHandler struct {
	svc         *Service
	orgFromCtx  func(r *http.Request) (string, bool)
	userFromCtx func(r *http.Request) (string, bool)
}

// NewHTTPHandler constructs the handler.
func NewHTTPHandler(svc *Service, orgFromCtx, userFromCtx func(r *http.Request) (string, bool)) *HTTPHandler {
	return &HTTPHandler{svc: svc, orgFromCtx: orgFromCtx, userFromCtx: userFromCtx}
}

const mount = "/api/v1/orgsync/transfer"

// Match reports whether path routes to this handler.
func (h *HTTPHandler) Match(path string) bool { return path == mount }

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != mount {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID, ok := h.orgFromCtx(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, ok := h.userFromCtx(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		TargetSlug   string   `json:"target_slug"`
		DriveFileIDs []string `json:"drive_file_ids"`
		ContactIDs   []string `json:"contact_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if body.TargetSlug == "" {
		http.Error(w, "target_slug required", http.StatusBadRequest)
		return
	}
	res, err := h.svc.Transfer(r.Context(), orgID, userID, body.TargetSlug, body.DriveFileIDs, body.ContactIDs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}
