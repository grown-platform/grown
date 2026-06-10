package zitadelproxy

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type subjectKey struct{}

// resolver mimics the closure server.go wires from auth.UserFromContext.
func resolver(ctx context.Context) (string, bool) {
	s, ok := ctx.Value(subjectKey{}).(string)
	return s, ok && s != ""
}

// withUser returns a request whose context carries the caller's oidc_subject,
// mimicking what auth.HTTPMiddleware attaches upstream.
func withUser(r *http.Request, subject string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), subjectKey{}, subject))
}

func newTestHandler(zitadelURL, token string) *Handler {
	return New(zitadelURL, token, resolver, nil)
}

func TestServeHTTP_NoSession_Unauthorized(t *testing.T) {
	h := newTestHandler("https://zitadel.example", "pat")
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/zitadel/v2/users/abc", nil)
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", w.Code)
	}
}

func TestServeHTTP_ForeignUser_Forbidden(t *testing.T) {
	h := newTestHandler("https://zitadel.example", "pat")
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/zitadel/v2/users/victim", nil), "attacker")
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403 for cross-user access, got %d", w.Code)
	}
}

func TestServeHTTP_DisallowedPath_Forbidden(t *testing.T) {
	h := newTestHandler("https://zitadel.example", "pat")
	w := httptest.NewRecorder()
	// management API is not in the allowlist for grown.
	r := withUser(httptest.NewRequest(http.MethodPost, "/api/zitadel/management/v1/users/self/idps/_search", nil), "self")
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("want 403 for disallowed path, got %d", w.Code)
	}
}

func TestServeHTTP_OwnUser_ProxiesWithPAT(t *testing.T) {
	var gotAuth, gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		if c := r.Header.Get("Cookie"); c != "" {
			t.Errorf("Cookie header leaked to upstream: %q", c)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	h := newTestHandler(upstream.URL, "secret-pat")
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodGet, "/api/zitadel/v2/users/self", nil), "self")
	r.Header.Set("Cookie", "grown_session=abc")
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if gotAuth != "Bearer secret-pat" {
		t.Errorf("upstream Authorization = %q, want Bearer secret-pat", gotAuth)
	}
	if gotPath != "/v2/users/self" {
		t.Errorf("upstream path = %q, want /v2/users/self", gotPath)
	}
}

func TestServeHTTP_PasskeyStart_InjectsDomain(t *testing.T) {
	var body map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	h := newTestHandler(upstream.URL, "pat")
	w := httptest.NewRecorder()
	r := withUser(httptest.NewRequest(http.MethodPost, "/api/zitadel/v2/users/self/passkeys", strings.NewReader("{}")), "self")
	r.Host = "workspace.localtest.me:8080"
	h.ServeHTTP(w, r)

	if got := body["domain"]; got != "workspace.localtest.me" {
		t.Errorf("injected domain = %v, want workspace.localtest.me (port stripped)", got)
	}
}

func TestHostWithoutPort(t *testing.T) {
	cases := map[string]string{
		"example.com":            "example.com",
		"example.com:8080":       "example.com",
		"workspace.localtest.me": "workspace.localtest.me",
		"[::1]:8080":             "::1",
		"":                       "",
	}
	for in, want := range cases {
		if got := hostWithoutPort(in); got != want {
			t.Errorf("hostWithoutPort(%q) = %q, want %q", in, got, want)
		}
	}
}
