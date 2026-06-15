package live

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Webhooks short-circuit tests. These exercise the request-shape decisions that
// happen BEFORE any repository call, so a nil-repo Webhooks is safe.

func TestRoutes(t *testing.T) {
	h := NewWebhooks(nil)
	cases := []struct {
		name   string
		method string
		path   string
		wantOK bool
	}{
		{"auth POST", http.MethodPost, "/api/v1/live/auth", true},
		{"ready POST", http.MethodPost, "/api/v1/live/abc/_ready", true},
		{"notready POST", http.MethodPost, "/api/v1/live/abc/_notready", true},
		{"auth GET not matched", http.MethodGet, "/api/v1/live/auth", false},
		{"ready GET not matched", http.MethodGet, "/api/v1/live/abc/_ready", false},
		{"unrelated path", http.MethodPost, "/api/v1/live/abc", false},
		{"nested ready not matched", http.MethodPost, "/api/v1/live/a/b/_ready", false},
		{"empty id ready not matched", http.MethodPost, "/api/v1/live//_ready", false},
		{"other prefix", http.MethodPost, "/other/auth", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, c.path, nil)
			hh, ok := h.Routes(req)
			if ok != c.wantOK {
				t.Fatalf("Routes ok = %v, want %v", ok, c.wantOK)
			}
			if ok && hh == nil {
				t.Error("Routes returned ok but nil handler")
			}
			if !ok && hh != nil {
				t.Error("Routes returned not-ok but non-nil handler")
			}
		})
	}
}

func TestAuthHandlerShortCircuits(t *testing.T) {
	h := NewWebhooks(nil)
	cases := []struct {
		name     string
		body     string
		wantCode int
	}{
		{"malformed json", "{not json", http.StatusUnauthorized},
		{"publish empty path", `{"action":"publish","path":""}`, http.StatusUnauthorized},
		{"publish root path trims to empty", `{"action":"publish","path":"/"}`, http.StatusUnauthorized},
		{"read empty path", `{"action":"read","path":""}`, http.StatusUnauthorized},
		{"playback empty path", `{"action":"playback","path":""}`, http.StatusUnauthorized},
		{"unknown action api", `{"action":"api","path":"x"}`, http.StatusUnauthorized},
		{"unknown action metrics", `{"action":"metrics","path":"x"}`, http.StatusUnauthorized},
		{"empty action", `{"action":"","path":"x"}`, http.StatusUnauthorized},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/live/auth", strings.NewReader(c.body))
			rec := httptest.NewRecorder()
			h.AuthHandler().ServeHTTP(rec, req)
			if rec.Code != c.wantCode {
				t.Errorf("code = %d, want %d (body %q)", rec.Code, c.wantCode, rec.Body.String())
			}
		})
	}
}

func TestReadyHandlerBadPath(t *testing.T) {
	h := NewWebhooks(nil)
	// A path that doesn't satisfy streamID returns 400 before any repo call.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/live//_ready", nil)
	rec := httptest.NewRecorder()
	h.ReadyHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("ReadyHandler bad path code = %d, want 400", rec.Code)
	}
}

func TestNotReadyHandlerBadPath(t *testing.T) {
	h := NewWebhooks(nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/live/a/b/_notready", nil)
	rec := httptest.NewRecorder()
	h.NotReadyHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("NotReadyHandler bad path code = %d, want 400", rec.Code)
	}
}
