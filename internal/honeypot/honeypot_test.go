package honeypot

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A nil store stands in for "no DB configured": every method must tolerate it,
// so the middleware/handlers can be tested without a database. Record is a
// no-op, the listing methods return empty, and the HTTP responses are still
// correct.

func TestIsDecoyPath(t *testing.T) {
	hits := []string{
		"/.env", "/.git/config", "/wp-login.php", "/admin/credentials",
		"/api/v1/admin/export-all-users", "/api/v1/admin/backup",
		"/.env/", // trailing slash still trips
	}
	for _, p := range hits {
		if !IsDecoyPath(p) {
			t.Errorf("IsDecoyPath(%q) = false; want true", p)
		}
	}
	misses := []string{
		"/", "/api/v1/admin/analytics", "/api/v1/admin/honeypot",
		"/env", "/wp-login", "/api/v1/admin/users", "/admin",
	}
	for _, p := range misses {
		if IsDecoyPath(p) {
			t.Errorf("IsDecoyPath(%q) = true; want false (must not shadow real routes)", p)
		}
	}
}

func TestMiddlewareDecoyReturns404AndDoesNotPassThrough(t *testing.T) {
	var s *Store // nil store: Record is a no-op
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	h := s.Middleware(next)

	req := httptest.NewRequest(http.MethodGet, "/.env", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("decoy status = %d; want 404 (must not reveal the trap)", rr.Code)
	}
	if called {
		t.Errorf("decoy hit reached next handler; it must be intercepted")
	}
	if strings.Contains(strings.ToLower(rr.Body.String()), "honeypot") ||
		strings.Contains(strings.ToLower(rr.Body.String()), "trap") {
		t.Errorf("404 body leaks that it is a trap: %q", rr.Body.String())
	}
}

func TestMiddlewarePassesThroughRealRoute(t *testing.T) {
	var s *Store
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusTeapot)
	})
	h := s.Middleware(next)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/analytics", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if !called {
		t.Errorf("real route did not pass through the middleware")
	}
	if rr.Code != http.StatusTeapot {
		t.Errorf("status = %d; want 418 from next", rr.Code)
	}
}

func TestFormHandlerAlwaysNoContent(t *testing.T) {
	var s *Store
	h := s.FormHandler()

	// Clean submission (no hidden field) → 204.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/honeypot",
		strings.NewReader(`{"name":"alice"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("clean submission status = %d; want 204", rr.Code)
	}

	// Bot submission (hidden field set) → still 204 (no signal to the bot).
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/honeypot",
		strings.NewReader(`{"company_website":"http://spam.example"}`))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusNoContent {
		t.Errorf("bot submission status = %d; want 204", rr2.Code)
	}
}

func TestCheckHiddenFields(t *testing.T) {
	var s *Store
	// JSON with hidden field set.
	req := httptest.NewRequest(http.MethodPost, "/x",
		strings.NewReader(`{"hp_token":"x","other":"ok"}`))
	req.Header.Set("Content-Type", "application/json")
	if trip, f := s.checkHiddenFields(req); !trip || f != "hp_token" {
		t.Errorf("checkHiddenFields(json) = %v,%q; want true,hp_token", trip, f)
	}
	// Form-encoded with company_website set.
	req2 := httptest.NewRequest(http.MethodPost, "/x",
		strings.NewReader("name=bob&company_website=spam"))
	req2.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if trip, f := s.checkHiddenFields(req2); !trip || f != "company_website" {
		t.Errorf("checkHiddenFields(form) = %v,%q; want true,company_website", trip, f)
	}
	// Clean form: no trip.
	req3 := httptest.NewRequest(http.MethodPost, "/x",
		strings.NewReader("name=bob&company_website="))
	req3.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if trip, _ := s.checkHiddenFields(req3); trip {
		t.Errorf("clean form tripped the honeypot")
	}
}

func TestClientIPPrefersEdgeHeaders(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "1.1.1.1, 2.2.2.2")
	if got := clientIP(req); got != "1.1.1.1" {
		t.Errorf("clientIP XFF = %q; want 1.1.1.1", got)
	}
	req.Header.Set("CF-Connecting-IP", "9.9.9.9")
	if got := clientIP(req); got != "9.9.9.9" {
		t.Errorf("clientIP CF = %q; want 9.9.9.9 (CF takes priority)", got)
	}
	// No headers → RemoteAddr host.
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.1:1234"
	if got := clientIP(req2); got != "10.0.0.1" {
		t.Errorf("clientIP RemoteAddr = %q; want 10.0.0.1", got)
	}
}

func TestAdminHandlerGate(t *testing.T) {
	var s *Store
	// No session → 401.
	h := NewAdminHandler(s, Identity{
		Caller:  func(context.Context) (string, bool) { return "", false },
		IsAdmin: func(context.Context) bool { return false },
	})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/admin/honeypot", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("no session status = %d; want 401", rr.Code)
	}

	// Authenticated non-admin → 403.
	h2 := NewAdminHandler(s, Identity{
		Caller:  func(context.Context) (string, bool) { return "u@x", true },
		IsAdmin: func(context.Context) bool { return false },
	})
	rr2 := httptest.NewRecorder()
	h2.ServeHTTP(rr2, httptest.NewRequest(http.MethodGet, "/api/v1/admin/honeypot", nil))
	if rr2.Code != http.StatusForbidden {
		t.Errorf("non-admin status = %d; want 403", rr2.Code)
	}

	// Admin → 200 with empty alert list from the nil store.
	h3 := NewAdminHandler(s, Identity{
		Caller:  func(context.Context) (string, bool) { return "a@x", true },
		IsAdmin: func(context.Context) bool { return true },
	})
	rr3 := httptest.NewRecorder()
	h3.ServeHTTP(rr3, httptest.NewRequest(http.MethodGet, "/api/v1/admin/honeypot", nil))
	if rr3.Code != http.StatusOK {
		t.Errorf("admin status = %d; want 200 (body=%s)", rr3.Code, rr3.Body.String())
	}
	if !strings.Contains(rr3.Body.String(), "alerts") {
		t.Errorf("admin body missing alerts: %s", rr3.Body.String())
	}
}
