package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTokenBucketAllowsBurstThenBlocks(t *testing.T) {
	l := newLimiter(1, 3) // 1/s refill, burst 3
	now := time.Unix(0, 0)
	// First 3 succeed (burst), 4th blocked.
	for i := 0; i < 3; i++ {
		if !l.allow("ip", now) {
			t.Fatalf("token %d should be allowed", i)
		}
	}
	if l.allow("ip", now) {
		t.Fatal("4th token should be blocked")
	}
	// After 1s, one token refills.
	if !l.allow("ip", now.Add(time.Second)) {
		t.Fatal("token should refill after 1s")
	}
	if l.allow("ip", now.Add(time.Second)) {
		t.Fatal("only one token should have refilled")
	}
}

func TestPerKeyIsolation(t *testing.T) {
	l := newLimiter(1, 1)
	now := time.Unix(0, 0)
	if !l.allow("a", now) || !l.allow("b", now) {
		t.Fatal("different keys have independent buckets")
	}
	if l.allow("a", now) {
		t.Fatal("key a should be exhausted")
	}
}

func TestMiddleware429AndAuthPathStricter(t *testing.T) {
	rl := &RateLimiter{
		general: newLimiter(1000, 1000),
		auth:    newLimiter(0, 1), // 1 token, no refill
		settings: Settings{Enabled: true},
	}
	h := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// General path: plenty of capacity.
	req := httptest.NewRequest("GET", "/api/v1/sheets", nil)
	req.RemoteAddr = "1.2.3.4:5555"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("general request: got %d", rec.Code)
	}

	// Auth path: 1 allowed, then 429.
	mk := func() *http.Request {
		r := httptest.NewRequest("POST", "/api/v1/auth/login-password", nil)
		r.RemoteAddr = "9.9.9.9:1"
		return r
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, mk())
	if rec.Code != http.StatusOK {
		t.Fatalf("first auth request should pass, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, mk())
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second auth request should be 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("429 should set Retry-After")
	}
}

func TestClientIPHonorsXFF(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.1:222"
	r.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
	if got := clientIP(r); got != "203.0.113.7" {
		t.Fatalf("clientIP = %q, want 203.0.113.7", got)
	}
}
