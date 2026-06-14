package ratelimit

import (
	"context"
	"encoding/json"
	"net/http"
)

// Identity resolves the calling admin off the request context. server.go injects
// a closure backed by auth.UserFromContext + the org_admins/allowlist check,
// keeping this package free of internal/auth's gen/ dependency (same pattern as
// internal/honeypot and internal/geoaccess).
type Identity struct {
	// Caller returns the caller's grown email and whether a session is present.
	Caller func(ctx context.Context) (email string, ok bool)
	// IsAdmin reports whether the caller is a grown admin (allowlist or org_admins).
	IsAdmin func(ctx context.Context) bool
}

// AdminHandler is the admin-gated, read-only rate-limiting console at
// GET /api/v1/admin/ratelimit. It returns the effective limiter configuration
// (limits/window from GROWN_RATELIMIT_*), a counts summary, the recent block
// events, and the top offending IPs in the trailing 24h. Mounted INSIDE grown's
// auth middleware in server.go so the caller's session is resolvable. The data
// is instance-global (the limiter keys on IP, not org).
type AdminHandler struct {
	rl       *RateLimiter
	store    *Store
	identity Identity
}

// NewAdminHandler constructs the admin handler over the limiter + its store.
func NewAdminHandler(rl *RateLimiter, store *Store, id Identity) *AdminHandler {
	return &AdminHandler{rl: rl, store: store, identity: id}
}

func (h *AdminHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	// Authorize: a present session whose caller IsAdmin. No open fallback.
	ok := false
	if h.identity.Caller != nil {
		_, ok = h.identity.Caller(r.Context())
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "no session"})
		return
	}
	if h.identity.IsAdmin == nil || !h.identity.IsAdmin(r.Context()) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
		return
	}

	blocks, err := h.store.ListRecent(r.Context(), 200)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"settings":      h.rl.Settings(),
		"counts":        h.store.CountSummary(r.Context()),
		"blocks":        blocks,
		"top_offenders": h.store.TopOffenders(r.Context(), 20),
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
