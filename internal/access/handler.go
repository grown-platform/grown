// Package access exposes the clientless-access HTTP surface for grown.
//
// "Access" has two layers:
//
//  1. Published internal apps (this handler) — org admins register internal /
//     self-hosted web services (name, URL, optional icon / description); org
//     members see them as launch tiles and open them in a new tab. These are
//     reached via the existing Cloudflare-tunnel + Zitadel SSO, so they are
//     clientless by definition.
//
//  2. Browser SSH/RDP/VNC gateway (Guacamole) — prepared in gitops/guacamole;
//     this package surfaces a "coming soon" marker so the frontend can render the
//     placeholder section. Once the gateway is deployed the SPA already handles
//     it client-side.
//
// Trust model mirrors adminusers / orgadminhttp: the handler is mounted INSIDE
// grown's auth middleware, so the caller's user + org are on the request context.
// It is decoupled from gen/ and internal/auth via injected closures (CallerFunc,
// AdminChecker), so it builds and tests standalone.
//
// Routes (mounted under /api/v1/access):
//
//	GET    /api/v1/access/apps          → list org's published apps (any member)
//	POST   /api/v1/access/apps          → create published app     (admin only)
//	PUT    /api/v1/access/apps/{id}     → update published app     (admin only)
//	DELETE /api/v1/access/apps/{id}     → delete published app     (admin only)
package access

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// MountPrefix is the HTTP path prefix under which the handler is mounted.
const MountPrefix = "/api/v1/access"

// CallerFunc resolves the caller's (userID, orgID) from the request context.
// server.go supplies a closure backed by auth.UserFromContext / auth.OrgFromContext.
// Returns ("", "", false) when no authenticated session is present.
type CallerFunc func(ctx context.Context) (userID, orgID string, ok bool)

// AdminChecker reports whether the caller (resolved from the request context) is
// an admin of their org. server.go supplies a closure backed by the org_admins
// repository + the GROWN_ADMIN_EMAILS allowlist, so this package stays decoupled
// from gen/.
type AdminChecker func(ctx context.Context) bool

// Handler serves the /api/v1/access/* routes.
type Handler struct {
	repo       *Repository
	callerOf   CallerFunc
	isOrgAdmin AdminChecker
	// gatewayURL is the public Guacamole gateway URL (GROWN_GUAC_URL). Empty =>
	// the gateway isn't deployed for this instance and the Access page keeps its
	// "coming soon" placeholder.
	gatewayURL string
}

// NewHandler constructs a Handler. Call WithCaller / WithAdminChecker to inject
// identity and authorization.
func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// WithCaller injects the caller-identity resolver and returns the handler for
// chaining.
func (h *Handler) WithCaller(f CallerFunc) *Handler {
	h.callerOf = f
	return h
}

// WithAdminChecker injects the admin predicate and returns the handler for
// chaining.
func (h *Handler) WithAdminChecker(c AdminChecker) *Handler {
	h.isOrgAdmin = c
	return h
}

// WithGatewayURL injects the public Guacamole gateway URL (GROWN_GUAC_URL) and
// returns the handler for chaining. Empty leaves the gateway "not configured".
func (h *Handler) WithGatewayURL(u string) *Handler {
	h.gatewayURL = strings.TrimSpace(u)
	return h
}

// ServeHTTP routes on method + path suffix after MountPrefix.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Require an authenticated session for every route.
	if h.callerOf == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	_, orgID, ok := h.callerOf(r.Context())
	if !ok || orgID == "" {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, MountPrefix)
	rest = strings.Trim(rest, "/")

	switch {
	case rest == "gateway":
		// GET /api/v1/access/gateway → the browser-desktop gateway status for the
		// Access page. Any authenticated member may read it.
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": h.gatewayURL != "",
			"url":     h.gatewayURL,
		})

	case rest == "apps":
		switch r.Method {
		case http.MethodGet:
			h.listApps(w, r, orgID)
		case http.MethodPost:
			h.requireAdmin(w, r, func() { h.createApp(w, r, orgID) })
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}

	case strings.HasPrefix(rest, "apps/"):
		id := strings.TrimPrefix(rest, "apps/")
		if id == "" || strings.Contains(id, "/") {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		switch r.Method {
		case http.MethodPut:
			h.requireAdmin(w, r, func() { h.updateApp(w, r, orgID, id) })
		case http.MethodDelete:
			h.requireAdmin(w, r, func() { h.deleteApp(w, r, orgID, id) })
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}

	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

// requireAdmin gates fn behind the admin check, writing 403 on denial.
func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request, fn func()) {
	if h.isOrgAdmin == nil || !h.isOrgAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "admin privileges required")
		return
	}
	fn()
}

// listApps handles GET /api/v1/access/apps.
func (h *Handler) listApps(w http.ResponseWriter, r *http.Request, orgID string) {
	apps, err := h.repo.List(r.Context(), orgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list apps: "+err.Error())
		return
	}
	if apps == nil {
		apps = []App{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"apps": apps})
}

// appInput is the shared create/update request body shape.
type appInput struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
}

func (in *appInput) validate() (string, bool) {
	in.Name = strings.TrimSpace(in.Name)
	in.URL = strings.TrimSpace(in.URL)
	in.Description = strings.TrimSpace(in.Description)
	in.Icon = strings.TrimSpace(in.Icon)
	if in.Name == "" {
		return "name is required", false
	}
	if len([]rune(in.Name)) > 120 {
		return "name must be 120 characters or fewer", false
	}
	if in.URL == "" {
		return "url is required", false
	}
	u, err := url.ParseRequestURI(in.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return "url must be a valid http or https URL", false
	}
	return "", true
}

// createApp handles POST /api/v1/access/apps.
func (h *Handler) createApp(w http.ResponseWriter, r *http.Request, orgID string) {
	var in appInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if msg, ok := in.validate(); !ok {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	userID, _, _ := h.callerOf(r.Context())
	app, err := h.repo.Create(r.Context(), orgID, in.Name, in.URL, in.Description, in.Icon, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "create app: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, app)
}

// updateApp handles PUT /api/v1/access/apps/{id}.
func (h *Handler) updateApp(w http.ResponseWriter, r *http.Request, orgID, id string) {
	var in appInput
	if err := decodeBody(r, &in); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if msg, ok := in.validate(); !ok {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	app, err := h.repo.Update(r.Context(), orgID, id, in.Name, in.URL, in.Description, in.Icon)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "access app not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "update app: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, app)
}

// deleteApp handles DELETE /api/v1/access/apps/{id}.
func (h *Handler) deleteApp(w http.ResponseWriter, r *http.Request, orgID, id string) {
	err := h.repo.Delete(r.Context(), orgID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, http.StatusNotFound, "access app not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "delete app: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---- HTTP helpers (same conventions as adminusers) -------------------------

func decodeBody(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}
