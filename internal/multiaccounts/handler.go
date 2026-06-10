package multiaccounts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

// browserIDCookieName is the stable, long-lived browser identifier cookie.
// It is NOT secret; it only identifies which accounts have been signed in
// from this browser so the server can authorize activate requests.
const browserIDCookieName = "grown_bid"

// browserIDLifetime is how long the browser-id cookie persists (1 year).
const browserIDLifetime = 365 * 24 * time.Hour

// AccountInfo is the JSON shape returned by GET /api/v1/me/accounts.
type AccountInfo struct {
	SessionPublicID string `json:"session_id"`
	UserID          string `json:"user_id"`
	Email           string `json:"email"`
	DisplayName     string `json:"display_name"`
	OrgID           string `json:"org_id"`
	OrgName         string `json:"org_name"`
	OrgSlug         string `json:"org_slug"`
	AvatarURL       string `json:"avatar_url,omitempty"`
	Active          bool   `json:"active"`
}

// SessionLookup resolves a session token to its user + org metadata.
type SessionLookup interface {
	// LookupFull resolves a token; returns (userID, email, displayName, orgID,
	// orgName, orgSlug, publicID, ok). publicID is the non-secret session id used
	// to build activate URLs and match the browser's account list.
	LookupFull(ctx context.Context, token string) (userID, email, displayName, orgID, orgName, orgSlug, publicID string, ok bool)
	// LookupTokenByPublicID returns the bearer token for the session whose
	// public_id matches id. Used to authorize activate requests.
	LookupTokenByPublicID(ctx context.Context, publicID string) (string, error)
}

// CallerInfo carries the current caller's identity, resolved off the request
// context by a closure server.go injects (keeps this package free of gen/).
type CallerInfo struct {
	UserID  string
	OrgID   string
	Token   string // the live bearer token from the session cookie
	Present bool
}

// CallerFunc resolves the caller from the request context.
type CallerFunc func(ctx context.Context) CallerInfo

// CookieConfig carries cookie attributes the handler needs.
type CookieConfig struct {
	Name     string
	Domain   string
	Secure   bool
	Lifetime time.Duration
}

// AccountStore is the narrow interface the handler needs from the Store.
type AccountStore interface {
	AddAccount(ctx context.Context, browserID, sessionToken string) error
	TokensForBrowser(ctx context.Context, browserID string) ([]string, error)
	HasSession(ctx context.Context, browserID, sessionToken string) (bool, error)
	RemoveSession(ctx context.Context, browserID, sessionToken string) error
}

// Handler implements:
//
//	GET    /api/v1/me/accounts                      — list browser's accounts
//	POST   /api/v1/me/accounts/{id}/activate        — switch to a different account
//	DELETE /api/v1/me/accounts/{id}                 — sign out one account
type Handler struct {
	caller      CallerFunc
	store       AccountStore
	sessions    SessionLookup
	avatarCheck func(ctx context.Context, userID string) bool // true when user has an avatar
	cookie      CookieConfig
}

// NewHandler constructs the Handler.
func NewHandler(caller CallerFunc, store AccountStore, sessions SessionLookup, cookie CookieConfig) *Handler {
	return &Handler{caller: caller, store: store, sessions: sessions, cookie: cookie}
}

// WithAvatarCheck injects an optional function that reports whether a user has
// an avatar (used to populate avatar_url in the account list).
func (h *Handler) WithAvatarCheck(fn func(ctx context.Context, userID string) bool) *Handler {
	h.avatarCheck = fn
	return h
}

// ServeHTTP dispatches on method + path.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimRight(r.URL.Path, "/")
	switch {
	case path == "/api/v1/me/accounts":
		h.listAccounts(w, r)
	case strings.HasPrefix(path, "/api/v1/me/accounts/") && strings.HasSuffix(path, "/activate"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/me/accounts/"), "/activate")
		h.activateAccount(w, r, id)
	case strings.HasPrefix(path, "/api/v1/me/accounts/") && !strings.Contains(strings.TrimPrefix(path, "/api/v1/me/accounts/"), "/"):
		id := strings.TrimPrefix(path, "/api/v1/me/accounts/")
		h.removeAccount(w, r, id)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

// EnsureBrowserID reads the browser_id cookie; if absent, mints a new one and
// sets it on the response. Returns the browser_id. Should be called at OIDC
// callback time and any other time BID is needed. When called on a plain
// request handler, pass nil for w to skip setting a new cookie (returns "" when
// absent).
func EnsureBrowserID(w http.ResponseWriter, r *http.Request, cfg CookieConfig) string {
	if c, err := r.Cookie(browserIDCookieName); err == nil && c.Value != "" {
		return c.Value
	}
	if w == nil {
		return ""
	}
	// Mint new browser id.
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	bid := hex.EncodeToString(buf)
	http.SetCookie(w, &http.Cookie{
		Name:     browserIDCookieName,
		Value:    bid,
		Path:     "/",
		Domain:   cfg.Domain,
		MaxAge:   int(browserIDLifetime.Seconds()),
		HttpOnly: true,
		Secure:   cfg.Secure,
		SameSite: http.SameSiteLaxMode,
	})
	return bid
}

// listAccounts returns all accounts the browser has signed into, including
// which one is currently active.
func (h *Handler) listAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	caller := h.caller(r.Context())
	bid := browserIDFromRequest(r)
	if bid == "" || h.store == nil {
		// No browser_id or no store — return the single active account if any.
		var accounts []AccountInfo
		if caller.Present {
			ai := h.resolveAccount(r.Context(), caller.Token, caller.Token)
			if ai != nil {
				accounts = []AccountInfo{*ai}
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
		return
	}
	tokens, err := h.store.TokensForBrowser(r.Context(), bid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Dedupe by user: a browser may hold several session tokens for the same
	// user (re-logins). Show each user once, preferring their active session.
	var accounts []AccountInfo
	seen := map[string]int{}
	for _, tok := range tokens {
		ai := h.resolveAccount(r.Context(), tok, caller.Token)
		if ai == nil {
			continue
		}
		if idx, ok := seen[ai.UserID]; ok {
			if ai.Active && !accounts[idx].Active {
				accounts[idx] = *ai
			}
			continue
		}
		seen[ai.UserID] = len(accounts)
		accounts = append(accounts, *ai)
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
}

// activateAccount switches the active session cookie to the requested account.
// The browser must already have that session in its browser_accounts list.
func (h *Handler) activateAccount(w http.ResponseWriter, r *http.Request, publicID string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	bid := browserIDFromRequest(r)
	if bid == "" || h.store == nil {
		writeError(w, http.StatusForbidden, "no browser id; cannot switch accounts")
		return
	}
	// Resolve the bearer token for the requested public_id.
	targetToken, err := h.sessions.LookupTokenByPublicID(r.Context(), publicID)
	if errors.Is(err, errNotFound) || targetToken == "" {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Security: verify THIS browser has the session in its account list.
	has, err := h.store.HasSession(r.Context(), bid, targetToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !has {
		writeError(w, http.StatusForbidden, "account not in this browser's list")
		return
	}
	// Set the session cookie to the target token.
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookie.Name,
		Value:    targetToken,
		Path:     "/",
		Domain:   h.cookie.Domain,
		MaxAge:   int(h.cookie.Lifetime.Seconds()),
		HttpOnly: true,
		Secure:   h.cookie.Secure,
		SameSite: http.SameSiteLaxMode,
	})
	// Return the new active account info.
	ai := h.resolveAccount(r.Context(), targetToken, targetToken)
	if ai == nil {
		writeError(w, http.StatusGone, "session expired or revoked")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": *ai})
}

// removeAccount signs out one account from this browser's list.
func (h *Handler) removeAccount(w http.ResponseWriter, r *http.Request, publicID string) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	bid := browserIDFromRequest(r)
	if bid == "" {
		writeError(w, http.StatusForbidden, "no browser id")
		return
	}
	targetToken, err := h.sessions.LookupTokenByPublicID(r.Context(), publicID)
	if err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if targetToken != "" {
		// Verify ownership then remove.
		has, _ := h.store.HasSession(r.Context(), bid, targetToken)
		if has {
			_ = h.store.RemoveSession(r.Context(), bid, targetToken)
		}
	}
	caller := h.caller(r.Context())
	// If the removed account was active, clear the session cookie.
	activePublicID := ""
	if caller.Present {
		_, _, _, _, _, _, activePublicID, _ = h.sessions.LookupFull(r.Context(), caller.Token)
	}
	wasActive := caller.Present && activePublicID == publicID
	if wasActive {
		http.SetCookie(w, &http.Cookie{
			Name:   h.cookie.Name,
			Value:  "",
			Path:   "/",
			Domain: h.cookie.Domain,
			MaxAge: -1,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "signed_out": wasActive})
}

// resolveAccount looks up the session token and builds an AccountInfo.
// Returns nil when the session is expired or revoked.
func (h *Handler) resolveAccount(ctx context.Context, token, activeToken string) *AccountInfo {
	userID, email, displayName, orgID, orgName, orgSlug, publicID, ok := h.sessions.LookupFull(ctx, token)
	if !ok {
		return nil
	}
	ai := &AccountInfo{
		SessionPublicID: publicID,
		UserID:          userID,
		Email:           email,
		DisplayName:     displayName,
		OrgID:           orgID,
		OrgName:         orgName,
		OrgSlug:         orgSlug,
		Active:          token == activeToken,
	}
	if h.avatarCheck != nil && h.avatarCheck(ctx, userID) {
		ai.AvatarURL = "/api/v1/users/" + userID + "/avatar"
	}
	return ai
}

func browserIDFromRequest(r *http.Request) string {
	c, err := r.Cookie(browserIDCookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	return c.Value
}

// errNotFound is a sentinel so we can detect not-found without importing auth.
var errNotFound = errors.New("not found")

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"error": msg})
}
