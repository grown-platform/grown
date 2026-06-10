package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"golang.org/x/oauth2"
)

// newTestOIDC builds the smallest *OIDC that works without network calls.
// Only oauth2Config is populated; provider/verifier are not needed by
// AuthCodeURLWithHint (which only calls oauth2Config.AuthCodeURL).
func newTestOIDC(issuerURL string) *OIDC {
	return &OIDC{
		oauth2Config: oauth2.Config{
			ClientID:     "test-client",
			ClientSecret: "test-secret",
			RedirectURL:  "http://localhost/callback",
			Endpoint: oauth2.Endpoint{
				AuthURL:  issuerURL + "/oauth/authorize",
				TokenURL: issuerURL + "/oauth/token",
			},
		},
	}
}

func TestDemoHandler_DisabledByDefault_GET(t *testing.T) {
	cfg := DemoConfig{Enabled: false}
	authCfg := Config{CookieName: "s", SessionLifetime: 1}
	h := NewDemoHandler(cfg, authCfg, nil) // oidcClient must never be called

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("GET when disabled: got %d, want 404", rec.Code)
	}
}

func TestDemoHandler_DisabledByDefault_POST(t *testing.T) {
	cfg := DemoConfig{Enabled: false}
	authCfg := Config{CookieName: "s", SessionLifetime: 1}
	h := NewDemoHandler(cfg, authCfg, nil) // oidcClient must never be called

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("POST when disabled: got %d, want 404", rec.Code)
	}
}

func TestDemoHandler_Enabled_GET_ReturnsCapability(t *testing.T) {
	const demoEmail = "demo@example.com"
	cfg := DemoConfig{Enabled: true, Username: demoEmail}
	authCfg := Config{CookieName: "s", SessionLifetime: 1}
	h := NewDemoHandler(cfg, authCfg, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET when enabled: got %d, want 200", rec.Code)
	}
	var resp demoCapabilityResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.Enabled {
		t.Error("expected enabled:true")
	}
	if resp.Username != demoEmail {
		t.Errorf("username: got %q, want %q", resp.Username, demoEmail)
	}
}

func TestDemoHandler_Enabled_POST_SetsStateCookieAndRedirects(t *testing.T) {
	const demoEmail = "demo@example.com"
	cfg := DemoConfig{Enabled: true, Username: demoEmail}
	authCfg := Config{CookieName: "s", SessionLifetime: 1}
	oidcClient := newTestOIDC("http://idp.example.com")

	h := NewDemoHandler(cfg, authCfg, oidcClient)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("POST when enabled: got %d, want 302", rec.Code)
	}

	// The state cookie must be set.
	stateCookieFound := false
	for _, c := range rec.Result().Cookies() {
		if c.Name == stateCookieName {
			stateCookieFound = true
			if c.Value == "" {
				t.Error("state cookie value must not be empty")
			}
			if !c.HttpOnly {
				t.Error("state cookie must be HttpOnly")
			}
			break
		}
	}
	if !stateCookieFound {
		t.Error("state cookie not found in response")
	}

	// The redirect URL must contain login_hint=demo@example.com.
	loc := rec.Header().Get("Location")
	if loc == "" {
		t.Fatal("Location header is empty")
	}
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse Location %q: %v", loc, err)
	}
	got := u.Query().Get("login_hint")
	if got != demoEmail {
		t.Errorf("login_hint in Location: got %q, want %q", got, demoEmail)
	}
}

func TestDemoHandler_POST_OnlySendsConfiguredUsername(t *testing.T) {
	// Verifies that POST always uses the server-configured username, regardless
	// of anything in the request (there is no request body parsed at all).
	const configuredEmail = "demo@example.com"
	cfg := DemoConfig{Enabled: true, Username: configuredEmail}
	authCfg := Config{CookieName: "s", SessionLifetime: 1}
	oidcClient := newTestOIDC("http://idp.example.com")
	h := NewDemoHandler(cfg, authCfg, oidcClient)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	loc := rec.Header().Get("Location")
	u, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("parse Location: %v", err)
	}
	got := u.Query().Get("login_hint")
	if got != configuredEmail {
		t.Errorf("expected login_hint=%s in Location, got %q", configuredEmail, got)
	}
}

func TestDemoHandler_MethodNotAllowed(t *testing.T) {
	cfg := DemoConfig{Enabled: true, Username: "demo@example.com"}
	authCfg := Config{CookieName: "s", SessionLifetime: 1}
	oidcClient := newTestOIDC("http://idp.example.com")
	h := NewDemoHandler(cfg, authCfg, oidcClient)

	for _, method := range []string{http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req := httptest.NewRequest(method, "/api/v1/auth/demo-login", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: got %d, want 405", method, rec.Code)
		}
	}
}
