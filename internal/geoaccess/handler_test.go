package geoaccess

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestHandler builds a Handler over a nil Store (no DB: LoadPolicy returns
// the inert default, SetPolicy is a no-op) and a nil-store Cache, with an
// injected Identity. This exercises auth gating, dispatch, and validation
// without touching a database.
func newTestHandler(id Identity) *Handler {
	return NewHandler(nil, NewCache(nil), id)
}

func adminIdentity(email string) Identity {
	return Identity{
		Caller:  func(context.Context) (string, bool) { return email, true },
		IsAdmin: func(context.Context) bool { return true },
	}
}

func TestHandlerNoSession(t *testing.T) {
	h := newTestHandler(Identity{
		Caller:  func(context.Context) (string, bool) { return "", false },
		IsAdmin: func(context.Context) bool { return true },
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/geo", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: got %d, want 401", rec.Code)
	}
}

func TestHandlerNilCaller(t *testing.T) {
	// A zero Identity (nil Caller) must be treated as no session, not a panic.
	h := newTestHandler(Identity{})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/geo", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("nil caller: got %d, want 401", rec.Code)
	}
}

func TestHandlerNotAdmin(t *testing.T) {
	h := newTestHandler(Identity{
		Caller:  func(context.Context) (string, bool) { return "user@x", true },
		IsAdmin: func(context.Context) bool { return false },
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/geo", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin: got %d, want 403", rec.Code)
	}
}

func TestHandlerNilIsAdmin(t *testing.T) {
	// Present session but nil IsAdmin closure must be denied (no open fallback).
	h := newTestHandler(Identity{
		Caller: func(context.Context) (string, bool) { return "user@x", true },
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/geo", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("nil IsAdmin: got %d, want 403", rec.Code)
	}
}

func TestHandlerGetReturnsPolicy(t *testing.T) {
	h := newTestHandler(adminIdentity("admin@x"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/geo", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET: got %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	// nil store ⇒ inert default policy.
	if body["mode"] != ModeOff {
		t.Errorf("mode = %v, want off", body["mode"])
	}
	// countries must never be null.
	if _, ok := body["countries"].([]any); !ok {
		t.Errorf("countries = %v (type %T), want a JSON array", body["countries"], body["countries"])
	}
}

func TestHandlerMethodNotAllowed(t *testing.T) {
	h := newTestHandler(adminIdentity("admin@x"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/admin/geo", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE: got %d, want 405", rec.Code)
	}
}

func TestHandlerPutInvalidBody(t *testing.T) {
	h := newTestHandler(adminIdentity("admin@x"))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/geo", strings.NewReader("{not json"))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid body: got %d, want 400", rec.Code)
	}
}

func TestHandlerPutInvalidMode(t *testing.T) {
	h := newTestHandler(adminIdentity("admin@x"))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/geo",
		strings.NewReader(`{"mode":"deny","countries":["US"]}`))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid mode: got %d, want 400", rec.Code)
	}
}

func TestHandlerPutValid(t *testing.T) {
	// nil store: SetPolicy is a no-op, LoadPolicy returns the default, but the
	// request should still validate and succeed (200) and invalidate the cache.
	cache := NewCache(nil)
	cache.policy = Policy{Mode: ModeBlock, Countries: []string{"CN"}}
	cache.valid = true
	h := NewHandler(nil, cache, adminIdentity("admin@x"))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/geo",
		strings.NewReader(`{"mode":"block","countries":["us"," de ","US"]}`))
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("valid PUT: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	// The handler must invalidate the cache on a successful write.
	if cache.valid {
		t.Error("PUT should have invalidated the cache")
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response not JSON: %v", err)
	}
	if _, ok := body["countries"].([]any); !ok {
		t.Errorf("countries should be a JSON array, got %T", body["countries"])
	}
}

func TestPolicyJSONShape(t *testing.T) {
	// nil countries must serialize to [] and a zero time to "".
	out := policyJSON(Policy{Mode: ModeAllow, Countries: nil})
	if c, ok := out["countries"].([]string); !ok || len(c) != 0 {
		t.Errorf("countries = %v, want empty []string", out["countries"])
	}
	if out["updated_at"] != "" {
		t.Errorf("zero UpdatedAt should yield empty string, got %v", out["updated_at"])
	}
	if out["mode"] != ModeAllow {
		t.Errorf("mode = %v, want allow", out["mode"])
	}
}
