package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// mountPath is the public path this handler answers on.
const mountPath = "/api/v1/admin/audit"

// EmailResolver returns the caller's grown email + org id from the request
// context, and whether a caller is present. server.go supplies a closure backed
// by auth.UserFromContext / auth.OrgFromContext, keeping this package free of
// internal/auth (and its gen/ dep) — same pattern as internal/adminusers.
type EmailResolver func(ctx context.Context) (email, orgID string, ok bool)

// AdminChecker reports whether the caller (resolved from the request context)
// holds a per-org admin role (an org_admins grant). server.go injects a closure
// backed by the org_admins repo + auth context. Optional: kept decoupled from
// gen/ exactly like EmailResolver.
type AdminChecker func(ctx context.Context) bool

// Handler serves GET /api/v1/admin/audit, an admin-gated JSON listing of the
// caller's org's audit events. Authorization (see docs/rbac-design.md): the
// caller's email must be in GROWN_ADMIN_EMAILS (bootstrap super-admins) OR they
// must hold an org_admins grant (via the injected AdminChecker). There is NO open
// fallback — an empty allowlist no longer grants every member access.
type Handler struct {
	repo        *Repository
	adminEmails map[string]struct{}
	resolve     EmailResolver
	isOrgAdmin  AdminChecker
}

// NewHandler constructs the audit handler. adminEmails is the raw
// GROWN_ADMIN_EMAILS value (comma-separated); "" leaves the allowlist empty.
func NewHandler(repo *Repository, adminEmails string) *Handler {
	allow := make(map[string]struct{})
	for _, e := range strings.Split(adminEmails, ",") {
		e = strings.ToLower(strings.TrimSpace(e))
		if e != "" {
			allow[e] = struct{}{}
		}
	}
	return &Handler{repo: repo, adminEmails: allow}
}

// WithResolver injects the caller-identity resolver and returns the handler for
// chaining. Without a resolver every request is treated as unauthenticated.
func (h *Handler) WithResolver(r EmailResolver) *Handler {
	h.resolve = r
	return h
}

// WithAdminChecker injects the per-org admin predicate and returns the handler
// for chaining. server.go calls this with a closure backed by the org_admins repo.
func (h *Handler) WithAdminChecker(c AdminChecker) *Handler {
	h.isOrgAdmin = c
	return h
}

// eventOut is the JSON shape returned to the Admin viewer.
type eventOut struct {
	ID           string         `json:"id"`
	ActorEmail   string         `json:"actor_email"`
	ActorID      string         `json:"actor_id,omitempty"`
	Service      string         `json:"service"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resource_type"`
	ResourceID   string         `json:"resource_id"`
	Method       string         `json:"method"`
	Status       string         `json:"status"`
	Detail       map[string]any `json:"detail,omitempty"`
	IP           string         `json:"ip"`
	UserAgent    string         `json:"user_agent"`
	CreatedAt    string         `json:"created_at"`
}

// ServeHTTP authorizes the caller, then lists events for their org filtered by
// the query string: ?service=&actor=&action=&limit=&before=.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	email, orgID, ok := "", "", false
	if h.resolve != nil {
		email, orgID, ok = h.resolve(r.Context())
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "no session"})
		return
	}
	// Admin iff email is in the bootstrap allowlist OR an org_admins grant exists
	// (via the injected AdminChecker). No open fallback (see docs/rbac-design.md).
	_, inAllowlist := h.adminEmails[strings.ToLower(strings.TrimSpace(email))]
	if !inAllowlist && !(h.isOrgAdmin != nil && h.isOrgAdmin(r.Context())) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
		return
	}
	if orgID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "no org context"})
		return
	}

	q := r.URL.Query()
	f := Filter{
		Service:    strings.TrimSpace(q.Get("service")),
		ActorEmail: strings.TrimSpace(q.Get("actor")),
		Action:     strings.TrimSpace(q.Get("action")),
	}
	if l := q.Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			f.Limit = n
		}
	}
	if b := q.Get("before"); b != "" {
		if t, err := time.Parse(time.RFC3339Nano, b); err == nil {
			f.Before = t
		}
	}

	events, err := h.repo.List(r.Context(), orgID, f)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	out := make([]eventOut, 0, len(events))
	for _, e := range events {
		out = append(out, eventOut{
			ID:           e.ID,
			ActorEmail:   e.ActorEmail,
			ActorID:      e.ActorID,
			Service:      e.Service,
			Action:       e.Action,
			ResourceType: e.ResourceType,
			ResourceID:   e.ResourceID,
			Method:       e.Method,
			Status:       e.Status,
			Detail:       e.Detail,
			IP:           e.IP,
			UserAgent:    e.UserAgent,
			CreatedAt:    e.CreatedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
}

// writeJSON writes v as a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
