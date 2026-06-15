package ratelimit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// okHandler is a trivial downstream that records whether it was reached.
func okHandler(reached *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if reached != nil {
			*reached = true
		}
		w.WriteHeader(http.StatusOK)
	})
}

// TestMiddlewareDisabledPassesThrough: a disabled limiter returns the next
// handler unwrapped, so requests are never throttled.
func TestMiddlewareDisabledPassesThrough(t *testing.T) {
	rl := &RateLimiter{
		general:  newLimiter(0, 0), // would block everything if consulted
		auth:     newLimiter(0, 0),
		settings: Settings{Enabled: false},
	}
	var reached bool
	h := rl.Middleware(okHandler(&reached))
	req := httptest.NewRequest("GET", "/api/v1/sheets", nil)
	req.RemoteAddr = "1.1.1.1:9"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !reached {
		t.Fatalf("disabled middleware should pass through: code=%d reached=%v", rec.Code, reached)
	}
}

// TestMiddlewareWebSocketExempt: an Upgrade: websocket request bypasses the
// bucket even when the limiter is exhausted.
func TestMiddlewareWebSocketExempt(t *testing.T) {
	rl := &RateLimiter{
		general:  newLimiter(0, 0), // no tokens at all
		auth:     newLimiter(0, 0),
		settings: Settings{Enabled: true},
	}
	var reached bool
	h := rl.Middleware(okHandler(&reached))
	req := httptest.NewRequest("GET", "/api/v1/ws", nil)
	req.RemoteAddr = "2.2.2.2:9"
	req.Header.Set("Upgrade", "WebSocket") // case-insensitive match
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !reached {
		t.Fatalf("websocket upgrade should be exempt: code=%d reached=%v", rec.Code, reached)
	}
}

// TestMiddleware429Body verifies the 429 response carries Retry-After and a
// body, and does not reach the downstream handler.
func TestMiddleware429Body(t *testing.T) {
	rl := &RateLimiter{
		general:  newLimiter(0, 0),
		auth:     newLimiter(1000, 1000),
		settings: Settings{Enabled: true},
	}
	var reached bool
	h := rl.Middleware(okHandler(&reached))
	req := httptest.NewRequest("GET", "/api/v1/sheets", nil)
	req.RemoteAddr = "3.3.3.3:9"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
	if reached {
		t.Error("downstream handler must not be reached on 429")
	}
	if rec.Header().Get("Retry-After") != "1" {
		t.Errorf("Retry-After = %q, want 1", rec.Header().Get("Retry-After"))
	}
	if rec.Body.Len() == 0 {
		t.Error("429 should include an explanatory body")
	}
}

// TestMiddlewareRecordsBlockWithNilStore: hitting a 429 with a nil store must
// not panic (Record tolerates a nil receiver).
func TestMiddlewareRecordsBlockWithNilStore(t *testing.T) {
	rl := &RateLimiter{
		general:  newLimiter(0, 0),
		auth:     newLimiter(0, 0),
		settings: Settings{Enabled: true},
		store:    nil,
	}
	h := rl.Middleware(okHandler(nil))
	req := httptest.NewRequest("GET", "/api/v1/sheets", nil)
	req.RemoteAddr = "4.4.4.4:9"
	req.Header.Set("CF-IPCountry", "US")
	req.Header.Set("User-Agent", "test-agent")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req) // must not panic
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
}

func TestIsAuthPath(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/api/v1/auth/login", true},
		{"/api/v1/auth/login-password", true}, // prefix match
		{"/api/v1/auth/demo-login", true},
		{"/api/v1/auth/logout", false},
		{"/api/v1/sheets", false},
		{"/", false},
		{"", false},
	}
	for _, tc := range tests {
		if got := isAuthPath(tc.path); got != tc.want {
			t.Errorf("isAuthPath(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		xff        string
		want       string
	}{
		{"xff single", "10.0.0.1:5", "203.0.113.7", "203.0.113.7"},
		{"xff first hop", "10.0.0.1:5", "203.0.113.7, 10.0.0.1", "203.0.113.7"},
		{"xff trimmed", "10.0.0.1:5", "  198.51.100.9 , 10.0.0.1", "198.51.100.9"},
		{"no xff host:port", "192.0.2.5:4444", "", "192.0.2.5"},
		{"no xff no port", "192.0.2.6", "", "192.0.2.6"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = tc.remoteAddr
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := clientIP(r); got != tc.want {
				t.Errorf("clientIP = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestServeSettings checks the JSON settings endpoint emits the active config.
func TestServeSettings(t *testing.T) {
	rl := &RateLimiter{
		settings: Settings{
			Enabled: true, GeneralRPS: 30, GeneralBurst: 60,
			AuthRPS: 0.5, AuthBurst: 10, KeyBy: "ip",
		},
	}
	rec := httptest.NewRecorder()
	rl.ServeSettings(rec, httptest.NewRequest("GET", "/settings", nil))
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var got Settings
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	if got != rl.settings {
		t.Errorf("ServeSettings body = %+v, want %+v", got, rl.settings)
	}
}

// --- AdminHandler auth gating + happy path (nil store tolerated) ---

func adminID(isAdmin bool) Identity {
	return Identity{
		Caller:  func(context.Context) (string, bool) { return "admin@x", true },
		IsAdmin: func(context.Context) bool { return isAdmin },
	}
}

func newAdminHandler(id Identity) *AdminHandler {
	rl := &RateLimiter{settings: Settings{Enabled: true, KeyBy: "ip"}}
	return NewAdminHandler(rl, nil, id) // nil store: methods are no-ops
}

func TestAdminHandlerMethodNotAllowed(t *testing.T) {
	h := newAdminHandler(adminID(true))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/admin/ratelimit", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: got %d, want 405", rec.Code)
	}
}

func TestAdminHandlerNoSession(t *testing.T) {
	h := newAdminHandler(Identity{
		Caller:  func(context.Context) (string, bool) { return "", false },
		IsAdmin: func(context.Context) bool { return true },
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/ratelimit", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: got %d, want 401", rec.Code)
	}
}

func TestAdminHandlerNilCaller(t *testing.T) {
	h := newAdminHandler(Identity{}) // zero Identity: nil Caller must be 401, not panic
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/ratelimit", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("nil caller: got %d, want 401", rec.Code)
	}
}

func TestAdminHandlerNotAdmin(t *testing.T) {
	h := newAdminHandler(adminID(false))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/ratelimit", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin: got %d, want 403", rec.Code)
	}
}

func TestAdminHandlerNilIsAdmin(t *testing.T) {
	h := newAdminHandler(Identity{
		Caller: func(context.Context) (string, bool) { return "admin@x", true },
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/ratelimit", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("nil IsAdmin: got %d, want 403", rec.Code)
	}
}

func TestAdminHandlerOK(t *testing.T) {
	h := newAdminHandler(adminID(true))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/ratelimit", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin GET: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	for _, key := range []string{"settings", "counts", "blocks", "top_offenders"} {
		if _, ok := body[key]; !ok {
			t.Errorf("response missing %q key", key)
		}
	}
	// nil store ⇒ ListRecent returns an empty slice, never null.
	if _, ok := body["blocks"].([]any); !ok {
		t.Errorf("blocks = %v (type %T), want a JSON array", body["blocks"], body["blocks"])
	}
}
