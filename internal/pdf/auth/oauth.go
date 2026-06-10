package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	// oauthStateCookieName holds the per-login state and nonce, joined by ":".
	oauthStateCookieName = "pdf_oauth_state"
	// oauthStateCookieMaxAgeSeconds is how long the user has to complete the login.
	oauthStateCookieMaxAgeSeconds = 600
)

// generateStateAndNonce returns two independent 32-byte random values,
// URL-base64-encoded without padding.
func (o *OAuth) generateStateAndNonce() (string, string) {
	return randURLSafe(32), randURLSafe(32)
}

func randURLSafe(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand.Read does not fail on linux; if it does the process is unusable.
		panic("crypto/rand: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// OAuthConfig holds configuration for OAuth authentication.
type OAuthConfig struct {
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	FrontendURL  string
	CookieDomain string
	CookieSecure bool
}

// OAuth holds the OAuth2/OIDC configuration.
type OAuth struct {
	provider    *oidc.Provider
	verifier    *oidc.IDTokenVerifier
	oauthConfig *oauth2.Config
	cookieName  string
	frontendURL string
	cookieCfg   cookieConfig
}

type cookieConfig struct {
	domain string
	secure bool
}

// NewOAuth creates a new OAuth handler.
func NewOAuth(ctx context.Context, cfg OAuthConfig) (*OAuth, error) {
	provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, err
	}

	oauthCfg := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  cfg.RedirectURL,
		Scopes:       []string{"openid", "profile", "email"},
	}

	verifier := provider.Verifier(&oidc.Config{
		ClientID: cfg.ClientID,
	})

	return &OAuth{
		provider:    provider,
		verifier:    verifier,
		oauthConfig: oauthCfg,
		cookieName:  "pdf_auth",
		frontendURL: cfg.FrontendURL,
		cookieCfg: cookieConfig{
			domain: cfg.CookieDomain,
			secure: cfg.CookieSecure,
		},
	}, nil
}

// LoginHandler handles GET /auth/login - redirects to the OIDC provider with
// a freshly-generated state and nonce. Both values are stashed in a short-lived
// HttpOnly cookie that the callback verifies.
func (o *OAuth) LoginHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state, nonce := o.generateStateAndNonce()

		http.SetCookie(w, &http.Cookie{
			Name:  oauthStateCookieName,
			Value: state + ":" + nonce,
			// Path "/" (not "/auth/callback") so the cookie survives when the
			// app runs behind a reverse-proxy prefix (grown serves the callback
			// at /pdf-api/auth/callback, which would not match "/auth/callback").
			Path:     "/",
			Domain:   o.cookieCfg.domain,
			Secure:   o.cookieCfg.secure,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   oauthStateCookieMaxAgeSeconds,
		})

		authURL := o.oauthConfig.AuthCodeURL(state, oidc.Nonce(nonce))
		slog.Debug("OAuth login redirect", "url", authURL)
		http.Redirect(w, r, authURL, http.StatusFound)
	})
}

// CallbackHandler handles GET /auth/callback - validates the state cookie
// against the state query param, exchanges the code, and verifies the ID
// token's nonce claim matches the cookie nonce.
func (o *OAuth) CallbackHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always clear the state cookie when this handler runs, regardless of outcome.
		clearStateCookie := func() {
			http.SetCookie(w, &http.Cookie{
				Name:     oauthStateCookieName,
				Value:    "",
				Path:     "/",
				Domain:   o.cookieCfg.domain,
				Secure:   o.cookieCfg.secure,
				HttpOnly: true,
				SameSite: http.SameSiteLaxMode,
				MaxAge:   -1,
			})
		}

		stateCookie, err := r.Cookie(oauthStateCookieName)
		if err != nil || stateCookie.Value == "" {
			clearStateCookie()
			slog.Warn("OAuth callback missing state cookie", "error", err)
			http.Error(w, "missing oauth state", http.StatusBadRequest)
			return
		}

		parts := strings.SplitN(stateCookie.Value, ":", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			clearStateCookie()
			slog.Warn("OAuth callback malformed state cookie")
			http.Error(w, "malformed oauth state", http.StatusBadRequest)
			return
		}
		expectedState, expectedNonce := parts[0], parts[1]

		gotState := r.URL.Query().Get("state")
		if subtle.ConstantTimeCompare([]byte(gotState), []byte(expectedState)) != 1 {
			clearStateCookie()
			slog.Warn("OAuth callback state mismatch")
			http.Error(w, "state mismatch", http.StatusBadRequest)
			return
		}

		// State is validated; clear the cookie now that it's consumed.
		clearStateCookie()

		code := r.URL.Query().Get("code")
		if code == "" {
			slog.Error("OAuth callback missing code")
			http.Error(w, "missing code", http.StatusBadRequest)
			return
		}

		// oauthConfig may be nil in pure unit tests; bail out before touching
		// the real provider so the state-validation tests can exercise the
		// bail-out paths without needing a live OIDC server.
		if o.oauthConfig == nil {
			http.Error(w, "oauth not configured", http.StatusInternalServerError)
			return
		}

		token, err := o.oauthConfig.Exchange(r.Context(), code)
		if err != nil {
			slog.Error("OAuth token exchange failed", "error", err)
			http.Error(w, "token exchange failed", http.StatusInternalServerError)
			return
		}

		rawIDToken, ok := token.Extra("id_token").(string)
		if !ok || rawIDToken == "" {
			slog.Error("OAuth response missing id_token")
			http.Error(w, "no id_token in response", http.StatusInternalServerError)
			return
		}

		idToken, err := o.verifier.Verify(r.Context(), rawIDToken)
		if err != nil {
			slog.Error("OAuth id_token verification failed", "error", err)
			http.Error(w, "invalid id_token", http.StatusUnauthorized)
			return
		}

		// Verify the nonce in the ID token matches the nonce we issued.
		if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(expectedNonce)) != 1 {
			slog.Warn("OAuth id_token nonce mismatch")
			http.Error(w, "nonce mismatch", http.StatusBadRequest)
			return
		}

		// Set cookie expiry from token.
		expires := token.Expiry
		if expires.IsZero() {
			expires = time.Now().Add(time.Hour)
		}

		http.SetCookie(w, &http.Cookie{
			Name:     o.cookieName,
			Value:    rawIDToken,
			Path:     "/",
			Domain:   o.cookieCfg.domain,
			Secure:   o.cookieCfg.secure,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Expires:  expires,
		})

		slog.Info("OAuth login successful, setting cookie and redirecting",
			"cookieName", o.cookieName,
			"cookieDomain", o.cookieCfg.domain,
			"cookieSecure", o.cookieCfg.secure,
			"redirectTo", o.frontendURL)
		http.Redirect(w, r, o.frontendURL, http.StatusFound)
	})
}

// LogoutHandler handles GET /auth/logout - clears cookies and redirects to Zitadel logout.
func (o *OAuth) LogoutHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Clear the auth cookie
		http.SetCookie(w, &http.Cookie{
			Name:     o.cookieName,
			Value:    "",
			Path:     "/",
			Domain:   o.cookieCfg.domain,
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   o.cookieCfg.secure,
			SameSite: http.SameSiteLaxMode,
		})

		// Get end_session_endpoint from provider
		var claims struct {
			EndSessionEndpoint string `json:"end_session_endpoint"`
		}
		if err := o.provider.Claims(&claims); err == nil && claims.EndSessionEndpoint != "" {
			// post_logout_redirect_uri MUST exactly match what the OIDC client
			// has registered. The provisioning job in pick-gitops registers the
			// URI with a trailing slash; normalize here so they match. Use
			// url.Values to URL-encode parameters so special characters don't
			// break the query string.
			postLogoutURI := strings.TrimRight(o.frontendURL, "/") + "/"
			params := url.Values{}
			params.Set("post_logout_redirect_uri", postLogoutURI)
			params.Set("client_id", o.oauthConfig.ClientID)
			logoutURL := claims.EndSessionEndpoint + "?" + params.Encode()
			slog.Debug("OAuth logout redirect", "url", logoutURL)
			http.Redirect(w, r, logoutURL, http.StatusFound)
			return
		}

		// Fallback: redirect to frontend
		http.Redirect(w, r, o.frontendURL, http.StatusFound)
	})
}

// MeHandler handles GET /api/user/me - returns current user info from cookie.
// Pass a SuperadminChecker to report whether the caller is a superadmin;
// pass nil to disable that field (it will always be false).
func (o *OAuth) MeHandler(sa SuperadminChecker) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slog.Info("MeHandler called", "cookieName", o.cookieName)

		cookie, err := r.Cookie(o.cookieName)
		if err != nil || cookie.Value == "" {
			slog.Info("MeHandler: no auth cookie found", "error", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		idToken, err := o.verifier.Verify(r.Context(), cookie.Value)
		if err != nil {
			slog.Info("OAuth /me token verification failed", "error", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var claims OIDCClaims
		if err = idToken.Claims(&claims); err != nil {
			slog.Error("OAuth /me failed to parse claims", "error", err)
			http.Error(w, "failed to parse claims", http.StatusInternalServerError)
			return
		}

		isAdmin := false
		if sa != nil {
			isAdmin = IsSuperadmin(r.Context(), sa, claims.Email)
		}

		response := struct {
			ID           string `json:"id"`
			Email        string `json:"email"`
			Name         string `json:"name"`
			IsSuperadmin bool   `json:"isSuperadmin"`
		}{
			ID:           claims.Sub,
			Email:        claims.Email,
			Name:         claims.Name,
			IsSuperadmin: isAdmin,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	})
}

// Verifier returns the OIDC verifier for use in middleware.
func (o *OAuth) Verifier() *oidc.IDTokenVerifier {
	return o.verifier
}

// CookieName returns the auth cookie name.
func (o *OAuth) CookieName() string {
	return o.cookieName
}
