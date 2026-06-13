package geoaccess

import (
	"context"
	"encoding/json"
	"net/http"
)

// Identity resolves the calling admin off the request context. server.go injects
// a closure backed by auth.UserFromContext + the org_admins/allowlist check,
// keeping this package free of internal/auth's gen/ dependency (same pattern as
// internal/adminanalytics and internal/gamerooms).
type Identity struct {
	// Caller returns the caller's grown email and whether a session is present.
	Caller func(ctx context.Context) (email string, ok bool)
	// IsAdmin reports whether the caller is a grown admin (allowlist or org_admins).
	IsAdmin func(ctx context.Context) bool
}

// Handler serves the admin-gated geo policy API at /api/v1/admin/geo:
//
//	GET  /api/v1/admin/geo  – returns the current policy
//	PUT  /api/v1/admin/geo  – {"mode":"off|block|allow","countries":["US",...]}
//
// It is mounted INSIDE grown's auth middleware in server.go (driveAuthWrap), so
// the caller's session is resolvable from the request context. Every call is
// gated on ADMIN privileges (allowlist OR org_admins) — the same gate as
// audit/analytics/gamerooms. After a successful PUT the shared Cache is
// invalidated so the change takes effect on the next request (reload-on-write).
type Handler struct {
	store *Store
	cache *Cache
	id    Identity
}

// NewHandler constructs the geo policy handler over a Store + the Cache the
// middleware reads. Invalidating that same Cache on write is what makes a policy
// change take effect immediately.
func NewHandler(store *Store, cache *Cache, id Identity) *Handler {
	return &Handler{store: store, cache: cache, id: id}
}

// ServeHTTP authorizes the caller then dispatches GET/PUT.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Authorize: a present session whose caller IsAdmin. No open fallback.
	email, ok := "", false
	if h.id.Caller != nil {
		email, ok = h.id.Caller(r.Context())
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "no session"})
		return
	}
	if h.id.IsAdmin == nil || !h.id.IsAdmin(r.Context()) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.get(w, r)
	case http.MethodPut:
		h.put(w, r, email)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
	}
}

// get returns the current policy.
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	p := h.store.LoadPolicy(r.Context())
	writeJSON(w, http.StatusOK, policyJSON(p))
}

// put validates + persists a new policy, then invalidates the middleware cache.
func (h *Handler) put(w http.ResponseWriter, r *http.Request, email string) {
	var body struct {
		Mode      string   `json:"mode"`
		Countries []string `json:"countries"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
		return
	}
	if !ValidMode(body.Mode) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "mode must be one of off, block, allow"})
		return
	}
	countries := NormalizeCountries(body.Countries)
	if err := h.store.SetPolicy(r.Context(), body.Mode, countries, email); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	// Reload-on-write: the next request sees the new policy immediately.
	if h.cache != nil {
		h.cache.Invalidate()
	}
	writeJSON(w, http.StatusOK, policyJSON(h.store.LoadPolicy(r.Context())))
}

// policyJSON shapes a Policy for the wire, ensuring countries is never null and
// timestamps are RFC3339 (empty when unset).
func policyJSON(p Policy) map[string]any {
	countries := p.Countries
	if countries == nil {
		countries = []string{}
	}
	updated := ""
	if !p.UpdatedAt.IsZero() {
		updated = p.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	return map[string]any{
		"mode":       p.Mode,
		"countries":  countries,
		"updated_at": updated,
		"updated_by": p.UpdatedBy,
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
