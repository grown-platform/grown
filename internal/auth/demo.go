package auth

import (
	"encoding/json"
	"net/http"
)

// DemoConfig holds the feature-flag and credentials for the one-click demo
// login button. All fields come from environment variables loaded in main.go:
//
//	GROWN_DEMO_LOGIN_ENABLED=true
//	GROWN_DEMO_USERNAME=demo@pick.haus.com
//	GROWN_DEMO_PASSWORD=<set to the demo account password in Zitadel>
//
// GROWN_DEMO_PASSWORD is read by the operator and stored in Zitadel but is
// never logged, stored, or transmitted by grown. The handler only forwards the
// username as an OIDC login_hint so Zitadel can pre-fill the email field; the
// user must still enter the password themselves on the Zitadel login page.
//
// When Enabled is false (the default) the handler returns 404 on every method
// so the feature is completely invisible in non-demo deployments.
type DemoConfig struct {
	// Enabled gates the entire demo-login surface. Must be explicitly true.
	Enabled bool
	// Username is the email address pre-filled in the IdP login form via
	// OIDC login_hint. Only this address is ever forwarded — the handler
	// never accepts a caller-supplied username.
	Username string
}

// demoCapabilityResponse is the JSON body returned by GET /api/v1/auth/demo-login.
type demoCapabilityResponse struct {
	Enabled  bool   `json:"enabled"`
	Username string `json:"username,omitempty"`
}

// NewDemoHandler returns an http.Handler that serves the demo-login routes:
//
//   - GET  /api/v1/auth/demo-login — capability probe (public, no auth required)
//   - POST /api/v1/auth/demo-login — initiates the OIDC authorization-code flow
//     with login_hint pre-filled to the configured demo username; the state
//     cookie and redirect are handled identically to the normal /auth/login path
//
// When cfg.Enabled is false both verbs return 404 so the feature is invisible.
//
// Security invariants:
//   - Only the single username in cfg.Username is ever forwarded to the IdP.
//   - The endpoint is a no-op (404) when cfg.Enabled is false.
//   - No credential is stored, logged, or returned.
func NewDemoHandler(cfg DemoConfig, authCfg Config, oidcClient *OIDC) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !cfg.Enabled {
			http.NotFound(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			// The username is included so the button can label itself accurately.
			// It is not a secret (it is the public demo account email).
			_ = json.NewEncoder(w).Encode(demoCapabilityResponse{
				Enabled:  true,
				Username: cfg.Username,
			})

		case http.MethodPost:
			// Generate a CSRF state token, store it as a short-lived cookie, then
			// redirect to the IdP with login_hint set to the demo username. The
			// normal OIDC callback path (/api/v1/auth/callback) handles the rest,
			// so session creation is identical to the standard login flow.
			state, err := NewState()
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			http.SetCookie(w, &http.Cookie{
				Name:     stateCookieName,
				Value:    state,
				Path:     "/api/v1/auth",
				Domain:   authCfg.CookieDomain,
				MaxAge:   600,
				HttpOnly: true,
				Secure:   authCfg.CookieSecure,
				SameSite: http.SameSiteLaxMode,
			})
			authURL := oidcClient.AuthCodeURLWithHint(state, cfg.Username)
			http.Redirect(w, r, authURL, http.StatusFound)

		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
}
