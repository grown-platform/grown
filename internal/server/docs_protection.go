package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/docs"
)

// docsProtectionID returns the document id from
// /api/v1/docs/d/{id}/protection, and whether the path matched.
func docsProtectionID(path string) (string, bool) {
	const prefix = "/api/v1/docs/d/"
	const suffix = "/protection"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// serveDocsProtection reads (GET, any org member) or sets (PUT, the owner
// only) a document's protection mode (Docs M10). The editors enforce every
// mode from the document itself; the server keeps the mode so the collab
// hub can drop non-owners' writes to a read-only document.
func serveDocsProtection(w http.ResponseWriter, r *http.Request, id string, repo *docs.Repository) {
	ctx := r.Context()
	u, okU := auth.UserFromContext(ctx)
	org, okO := auth.OrgFromContext(ctx)
	if !okU || !okO {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	d, err := repo.Get(ctx, org.ID, id)
	if errors.Is(err, docs.ErrNotFound) {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	switch r.Method {
	case http.MethodGet:
		mode, err := repo.GetProtection(ctx, id)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"mode": mode})
	case http.MethodPut:
		if d.OwnerID != u.ID {
			http.Error(w, "only the owner can change protection", http.StatusForbidden)
			return
		}
		var body struct {
			Mode string `json:"mode"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || !docs.ValidProtection(body.Mode) {
			http.Error(w, "invalid protection mode", http.StatusBadRequest)
			return
		}
		if err := repo.SetProtection(ctx, id, body.Mode); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// docsWriteGate combines a connection's access with read-only protection:
// the owner always writes; others lose write access while the document is
// protected read-only.
func docsWriteGate(canWrite bool, isOwner bool, gate *docs.ProtectionGate) func() bool {
	return func() bool {
		if !canWrite {
			return false
		}
		if isOwner || gate == nil {
			return true
		}
		return !gate.ReadOnly(time.Now())
	}
}
