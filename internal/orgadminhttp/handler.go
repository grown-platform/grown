// Package orgadminhttp exposes the admin-gated, org-scoped HTTP surface for the
// Admin console's three new feature groups:
//
//	Org settings  — rename the caller's org (display_name; slug stays stable).
//	Org branding  — per-org logo + accent color (read, set color, upload logo).
//	Sessions      — list/revoke logins in the org, and the caller's own devices.
//
// Trust model mirrors internal/adminusers and internal/audit: the handler runs
// INSIDE grown's auth middleware, so the caller's user + org are on the request
// context. It is decoupled from gen/ and internal/auth via injected closures
// (Identity) and narrow repo-shaped interfaces, so it builds and tests
// standalone. Every admin route is gated by an injected AdminChecker (the
// allowlist OR an org_admins grant — there is NO open fallback).
//
// Routes (mounted at these absolute paths from server.go):
//
//	PATCH  /api/v1/admin/org                      → rename org (admin)
//	GET    /api/v1/admin/org/branding             → branding for editing (admin)
//	PATCH  /api/v1/admin/org/branding             → set accent color (admin)
//	POST   /api/v1/admin/org/branding/logo        → upload logo (multipart, admin)
//	DELETE /api/v1/admin/org/branding/logo        → clear logo (admin)
//	GET    /api/v1/admin/sessions                 → list org sessions (admin)
//	POST   /api/v1/admin/sessions/{id}/revoke     → revoke a session (admin)
//	GET    /api/v1/org/branding                   → active branding (any member)
//	GET    /api/v1/org/branding/logo              → logo blob (any member)
//	GET    /api/v1/me/sessions                    → caller's own sessions
//	POST   /api/v1/me/sessions/{id}/revoke        → caller signs out a device
package orgadminhttp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// maxLogoBytes bounds an uploaded logo (logos are small SVG/PNG marks).
const maxLogoBytes = 2 << 20 // 2 MiB

// Identity resolves the caller off the request context. server.go supplies a
// closure backed by auth.UserFromContext / auth.OrgFromContext, keeping this
// package free of internal/auth (and its gen/ dependency).
type Identity struct {
	// Caller returns the caller's user id, email, org id, and live session token
	// (the token is only used to flag the caller's own session — never returned),
	// plus whether a caller is present.
	Caller func(ctx context.Context) (userID, email, orgID, sessionToken string, ok bool)
	// IsAdmin reports whether the caller is an admin (allowlist OR org_admins).
	IsAdmin func(ctx context.Context) bool
}

// OrgStore is the org-rename slice of internal/orgs.Repository.
type OrgStore interface {
	UpdateDisplayName(ctx context.Context, id, displayName string) (Org, error)
}

// Org is the minimal org shape returned after a rename.
type Org struct {
	ID          string
	Slug        string
	DisplayName string
}

// BrandingStore is the per-org branding slice of internal/branding.Repository.
type BrandingStore interface {
	Get(ctx context.Context, orgID string) (Branding, error)
	SetAccentColor(ctx context.Context, orgID, accent string) error
	SetProductName(ctx context.Context, orgID, name string) error
	SetLogo(ctx context.Context, orgID, blobKey, mime string) error
}

// Branding is the per-org branding shape.
type Branding struct {
	OrgID       string
	LogoBlobKey string
	LogoMIME    string
	AccentColor string
	ProductName string
}

// BlobStore is the subset of the Drive blob store the logo upload/serve needs.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// SessionStore is the listing/revoke slice of internal/auth.SessionStore.
type SessionStore interface {
	ListByOrg(ctx context.Context, orgID, currentToken string) ([]SessionInfo, error)
	ListByUser(ctx context.Context, userID, currentToken string) ([]SessionInfo, error)
	RevokeByOrgAndID(ctx context.Context, orgID, id string) (bool, error)
	RevokeByUserAndID(ctx context.Context, userID, id string) (bool, error)
}

// SessionInfo is the session+user shape surfaced to the Sessions view.
type SessionInfo struct {
	ID          string
	UserID      string
	Email       string
	DisplayName string
	CreatedAt   time.Time
	ExpiresAt   time.Time
	LastSeenAt  *time.Time
	RevokedAt   *time.Time
	IP          string
	UserAgent   string
	Current     bool
}

// Handler implements all of the above routes. Any of its stores may be nil; a
// route whose backing store is unset returns 503 (feature disabled) rather than
// panicking, so the handler can be wired incrementally.
type Handler struct {
	id       Identity
	orgs     OrgStore
	branding BrandingStore
	blobs    BlobStore
	sessions SessionStore
}

// NewHandler constructs the handler. Pass nil for any store to disable its
// routes. identity must be supplied for any route to authorize.
func NewHandler(id Identity, orgsStore OrgStore, brandingStore BrandingStore, blobs BlobStore, sessions SessionStore) *Handler {
	return &Handler{id: id, orgs: orgsStore, branding: brandingStore, blobs: blobs, sessions: sessions}
}

// ---- Routing ---------------------------------------------------------------

// ServeHTTP dispatches on method + path. server.go mounts this handler for the
// path prefixes it owns; each branch authorizes independently (admin vs member).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimRight(r.URL.Path, "/")
	switch {
	case path == "/api/v1/admin/org":
		h.renameOrg(w, r)
	case path == "/api/v1/admin/org/branding":
		h.adminBranding(w, r)
	case path == "/api/v1/admin/org/branding/logo":
		h.adminBrandingLogo(w, r)
	case path == "/api/v1/admin/sessions":
		h.adminListSessions(w, r)
	case strings.HasPrefix(path, "/api/v1/admin/sessions/") && strings.HasSuffix(path, "/revoke"):
		h.adminRevokeSession(w, r, sessionIDFrom(path, "/api/v1/admin/sessions/"))
	case path == "/api/v1/org/branding":
		h.publicBranding(w, r)
	case path == "/api/v1/org/branding/logo":
		h.publicBrandingLogo(w, r)
	case path == "/api/v1/me/sessions":
		h.listOwnSessions(w, r)
	case strings.HasPrefix(path, "/api/v1/me/sessions/") && strings.HasSuffix(path, "/revoke"):
		h.revokeOwnSession(w, r, sessionIDFrom(path, "/api/v1/me/sessions/"))
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

// sessionIDFrom extracts the {id} segment from ".../{id}/revoke".
func sessionIDFrom(path, prefix string) string {
	rest := strings.TrimPrefix(path, prefix)
	return strings.TrimSuffix(rest, "/revoke")
}

// ---- Auth helpers ----------------------------------------------------------

// caller returns the resolved caller, writing 401 + false when absent.
type callerInfo struct {
	userID, email, orgID, sessionToken string
}

func (h *Handler) caller(w http.ResponseWriter, r *http.Request) (callerInfo, bool) {
	if h.id.Caller == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return callerInfo{}, false
	}
	uid, email, orgID, tok, ok := h.id.Caller(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return callerInfo{}, false
	}
	return callerInfo{userID: uid, email: email, orgID: orgID, sessionToken: tok}, true
}

// requireAdmin resolves the caller and enforces admin privileges, writing the
// error response on denial.
func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) (callerInfo, bool) {
	c, ok := h.caller(w, r)
	if !ok {
		return callerInfo{}, false
	}
	if h.id.IsAdmin == nil || !h.id.IsAdmin(r.Context()) {
		writeError(w, http.StatusForbidden, "admin privileges required")
		return callerInfo{}, false
	}
	if c.orgID == "" {
		writeError(w, http.StatusBadRequest, "no org context")
		return callerInfo{}, false
	}
	return c, true
}

// ---- JSON helpers ----------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}

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
