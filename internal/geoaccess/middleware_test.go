package geoaccess

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAlwaysAllowed(t *testing.T) {
	exempt := []string{
		"/api/v1/admin/", "/api/v1/admin/geo", "/api/v1/admin/analytics",
		"/api/v1/auth/", "/api/v1/auth/login-password", "/api/v1/auth/callback",
		"/healthz", "/readyz", "/livez", "/health",
	}
	for _, p := range exempt {
		if !alwaysAllowed(p) {
			t.Errorf("expected %q to be always-allowed", p)
		}
	}
	filtered := []string{
		"/", "/games/pong.html", "/api/v1/sheets",
		"/api/v1/adminx", // not the admin prefix
		"/healthzz",      // not an exact health path
		"/health/extra",  // not an exact health path
		"/admin/",        // missing /api/v1 prefix
		"/api/v1/authx",  // not the auth prefix
	}
	for _, p := range filtered {
		if alwaysAllowed(p) {
			t.Errorf("expected %q to be subject to filtering", p)
		}
	}
}

// newCacheWithPolicy builds a Cache with a fixed policy already loaded so the
// middleware never needs a DB (nil store). Get refreshes through the nil store
// only when invalidated, which yields the inert default — so we keep it valid.
func newCacheWithPolicy(p Policy) *Cache {
	c := NewCache(nil)
	c.policy = p
	c.valid = true
	c.loadedAt = time.Now()
	return c
}

func TestMiddlewareModeOffPassesThrough(t *testing.T) {
	c := newCacheWithPolicy(Policy{Mode: ModeOff, Countries: []string{"US"}})
	h := c.Middleware(okHandler())

	req := httptest.NewRequest(http.MethodGet, "/games/pong.html", nil)
	req.Header.Set("CF-IPCountry", "US")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("mode off should pass through, got %d", rec.Code)
	}
}

func TestMiddlewareBlocksAndAllows(t *testing.T) {
	cases := []struct {
		name     string
		policy   Policy
		path     string
		country  string
		wantCode int
	}{
		{"blocklist denies listed country", Policy{Mode: ModeBlock, Countries: []string{"CN"}}, "/", "CN", http.StatusForbidden},
		{"blocklist allows unlisted", Policy{Mode: ModeBlock, Countries: []string{"CN"}}, "/", "US", http.StatusOK},
		{"allowlist permits listed", Policy{Mode: ModeAllow, Countries: []string{"US"}}, "/", "US", http.StatusOK},
		{"allowlist denies unlisted", Policy{Mode: ModeAllow, Countries: []string{"US"}}, "/", "DE", http.StatusForbidden},
		{"missing header fails open under block", Policy{Mode: ModeBlock, Countries: []string{"CN"}}, "/", "", http.StatusOK},
		{"unknown XX fails open under allow", Policy{Mode: ModeAllow, Countries: []string{"US"}}, "/", "XX", http.StatusOK},
		{"exempt admin path bypasses block", Policy{Mode: ModeBlock, Countries: []string{"US"}}, "/api/v1/admin/geo", "US", http.StatusOK},
		{"exempt auth path bypasses allow", Policy{Mode: ModeAllow, Countries: []string{"DE"}}, "/api/v1/auth/login", "US", http.StatusOK},
		{"exempt health path bypasses allow", Policy{Mode: ModeAllow, Countries: []string{"DE"}}, "/healthz", "US", http.StatusOK},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cache := newCacheWithPolicy(c.policy)
			h := cache.Middleware(okHandler())
			req := httptest.NewRequest(http.MethodGet, c.path, nil)
			if c.country != "" {
				req.Header.Set("CF-IPCountry", c.country)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != c.wantCode {
				t.Fatalf("path=%q country=%q got %d, want %d", c.path, c.country, rec.Code, c.wantCode)
			}
		})
	}
}

func TestMiddlewareBlockedPageContents(t *testing.T) {
	c := newCacheWithPolicy(Policy{Mode: ModeBlock, Countries: []string{"CN"}})
	h := c.Middleware(okHandler())
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("CF-IPCountry", "CN")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Access from your region is restricted") {
		t.Errorf("blocked page missing expected copy; body=%q", body)
	}
}

// Middleware over a nil-store cache that has been invalidated reloads the inert
// default (mode off), so everything passes — the whole-site fail-open guarantee.
func TestMiddlewareNilStoreFailsOpen(t *testing.T) {
	c := NewCache(nil)
	c.Invalidate() // force a reload through the nil store on next Get
	h := c.Middleware(okHandler())
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("CF-IPCountry", "CN")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("nil-store middleware must fail open, got %d", rec.Code)
	}
}

func TestCacheGetNilStoreReturnsDefault(t *testing.T) {
	c := NewCache(nil)
	c.Invalidate()
	p := c.Get(context.Background())
	if p.Mode != ModeOff {
		t.Errorf("nil-store cache Get mode = %q, want off", p.Mode)
	}
}

func TestCacheInvalidate(t *testing.T) {
	c := newCacheWithPolicy(Policy{Mode: ModeBlock, Countries: []string{"US"}})
	if !c.valid {
		t.Fatal("cache should start valid")
	}
	c.Invalidate()
	if c.valid {
		t.Fatal("Invalidate should clear the valid flag")
	}
	// After invalidation a nil-store Get reloads the inert default.
	if got := c.Get(context.Background()); got.Mode != ModeOff {
		t.Errorf("post-invalidate Get mode = %q, want off (nil store)", got.Mode)
	}
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}
