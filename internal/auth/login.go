package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// LoginHandlers bundles the HTTP handlers for in-app password login and the
// one-click demo login. Both mint a grown session directly — no browser
// redirect to the Zitadel UI.
type LoginHandlers struct {
	cfg      Config
	zitadel  *ZitadelClient
	sessions *SessionStore
	users    *users.Repository
	orgs     *orgs.Repository
	issuer   string

	// demo configuration (read from env at construction time)
	demoEnabled  bool
	demoUsername string
}

// NewLoginHandlers constructs the LoginHandlers.
// issuer is the OIDC issuer (used to look up grown users by their Zitadel id).
// zitadel may be nil when the API URL / service token are not configured;
// both endpoints will return 503 in that case.
func NewLoginHandlers(
	cfg Config,
	zitadel *ZitadelClient,
	sessions *SessionStore,
	usersRepo *users.Repository,
	orgsRepo *orgs.Repository,
	issuer string,
) *LoginHandlers {
	demoEnabled := boolEnv("GROWN_DEMO_LOGIN_ENABLED")
	demoUsername := os.Getenv("GROWN_DEMO_USERNAME")
	if demoUsername == "" {
		demoUsername = "demo@pick.haus"
	}
	return &LoginHandlers{
		cfg:          cfg,
		zitadel:      zitadel,
		sessions:     sessions,
		users:        usersRepo,
		orgs:         orgsRepo,
		issuer:       issuer,
		demoEnabled:  demoEnabled,
		demoUsername: demoUsername,
	}
}

// boolEnv returns true when the env var is truthy ("1", "true", "yes", "on").
func boolEnv(name string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

// PasswordLogin handles POST /api/v1/auth/login-password.
// Body: {"username":"…","password":"…"}
// On success sets the grown session cookie and returns 200 {"ok":true}.
// On bad creds returns 401 {"error":"invalid email or password"}.
// The password is never logged.
func (h *LoginHandlers) PasswordLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.zitadel == nil {
		jsonError(w, "password login not configured", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		jsonError(w, "invalid email or password", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	zResult, err := h.zitadel.AuthenticatePassword(ctx, req.Username, req.Password)
	if err != nil {
		if errors.Is(err, ErrZitadelUnauthorized) {
			jsonError(w, "invalid email or password", http.StatusUnauthorized)
			return
		}
		slog.Error("zitadel password auth failed", "err", err)
		jsonError(w, "authentication failed", http.StatusInternalServerError)
		return
	}

	if err := h.mintSession(ctx, w, r, zResult.UserID); err != nil {
		slog.Error("mint session after password login", "err", err)
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// DemoLogin handles POST /api/v1/auth/demo-login (one-click demo sign-in) and
// GET /api/v1/auth/demo-login (capability probe).
//
// GET → {"enabled": true/false}
// POST → on success sets the grown session cookie and returns 200 {"ok":true}.
//
// Gated by GROWN_DEMO_LOGIN_ENABLED=true. The demo account is the single
// configured GROWN_DEMO_USERNAME — no caller-supplied username is accepted.
func (h *LoginHandlers) DemoLogin(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"enabled": h.demoEnabled})
		return
	case http.MethodPost:
		// fall through
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !h.demoEnabled {
		jsonError(w, "demo login is disabled", http.StatusForbidden)
		return
	}
	if h.zitadel == nil {
		jsonError(w, "demo login not configured", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()

	// Look up the demo user's Zitadel user id by their login name so we can
	// resolve (or provision) their grown row via GetByOIDCAnyOrg / UpsertByOIDC,
	// exactly like the OIDC callback does.
	zUserID, err := h.zitadel.LookupUserByLoginName(ctx, h.demoUsername)
	if err != nil {
		slog.Error("demo login: lookup demo user in zitadel", "username", h.demoUsername, "err", err)
		jsonError(w, "demo user not found", http.StatusServiceUnavailable)
		return
	}

	if err := h.mintSession(ctx, w, r, zUserID); err != nil {
		slog.Error("mint session for demo login", "err", err)
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// mintSession resolves the grown user for zitadelUserID, creates a grown
// session, and sets the session cookie on w. It mirrors exactly what the OIDC
// Callback does: GetByOIDCAnyOrg → UpsertByOIDC (provision if new) →
// CreateWithContext → set-cookie.
func (h *LoginHandlers) mintSession(ctx context.Context, w http.ResponseWriter, r *http.Request, zitadelUserID string) error {
	issuer := h.issuer
	if issuer == "" {
		issuer = h.cfg.IssuerURL
	}

	// Resolve or provision the grown user.
	u, err := h.users.GetByOIDCAnyOrg(ctx, issuer, zitadelUserID)
	if err != nil && !errors.Is(err, users.ErrNotFound) {
		return err
	}
	if errors.Is(err, users.ErrNotFound) {
		// First time this Zitadel user signs in via the password flow — provision
		// them exactly like the OIDC callback would, in the default org.
		orgID, orgErr := h.resolveDefaultOrg(ctx)
		if orgErr != nil {
			return orgErr
		}
		u, err = h.users.UpsertByOIDC(ctx, users.UpsertInput{
			OrgID:       orgID,
			OIDCIssuer:  issuer,
			OIDCSubject: zitadelUserID,
		})
		if err != nil {
			return err
		}
	}

	// Capture client context for the session (same as the OIDC callback).
	ip, userAgent := extractRequestContext(r)

	tok, err := h.sessions.CreateWithContext(ctx, u.ID, h.cfg.SessionLifetime, ip, userAgent)
	if err != nil {
		return err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     h.cfg.CookieName,
		Value:    tok,
		Path:     "/",
		Domain:   h.cfg.CookieDomain,
		MaxAge:   int(h.cfg.SessionLifetime / time.Second),
		HttpOnly: true,
		Secure:   h.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// resolveDefaultOrg returns the default org ID. Used when provisioning a user
// for the first time via the password flow (mirrors the OIDC callback's
// fallback path when personal orgs are disabled or for demo users).
func (h *LoginHandlers) resolveDefaultOrg(ctx context.Context) (string, error) {
	org, err := h.orgs.GetBySlug(ctx, h.cfg.DefaultOrgSlug)
	if err != nil {
		return "", err
	}
	return org.ID, nil
}

// extractRequestContext extracts IP + User-Agent from a plain *http.Request
// (used by the direct HTTP handlers, as opposed to the gRPC-gateway path
// which reads from gRPC metadata).
func extractRequestContext(r *http.Request) (ip, userAgent string) {
	userAgent = r.Header.Get("User-Agent")
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			ip = strings.TrimSpace(xff[:i])
		} else {
			ip = strings.TrimSpace(xff)
		}
	}
	if ip == "" {
		host := r.RemoteAddr
		if h, _, err := net.SplitHostPort(host); err == nil {
			ip = h
		} else {
			ip = host
		}
	}
	return ip, userAgent
}

// jsonError writes a JSON error response.
func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
