package geoaccess

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

// cacheTTL bounds how stale the in-memory policy snapshot may be. The hot
// request path reads the cached snapshot; the DB is consulted at most once per
// TTL (and immediately after a write via Invalidate). 30s is short enough that a
// policy change takes effect quickly without hammering the DB per request.
const cacheTTL = 30 * time.Second

// Cache is a TTL-bounded in-memory snapshot of the policy, refreshed lazily from
// the Store. It is reload-on-write: the admin handler calls Invalidate after a
// PUT so the next request reflects the change immediately rather than waiting
// out the TTL. A nil Store makes Get always return the inert default.
type Cache struct {
	store *Store

	mu       sync.RWMutex
	policy   Policy
	loadedAt time.Time
	valid    bool
}

// NewCache constructs a Cache over the given Store (which may be nil).
func NewCache(store *Store) *Cache {
	return &Cache{store: store, policy: defaultPolicy()}
}

// Get returns the current policy, refreshing from the Store when the snapshot is
// missing or older than cacheTTL. Refresh failures keep the last good snapshot
// (or the inert default), so the middleware always fails open.
func (c *Cache) Get(ctx context.Context) Policy {
	c.mu.RLock()
	if c.valid && time.Since(c.loadedAt) < cacheTTL {
		p := c.policy
		c.mu.RUnlock()
		return p
	}
	c.mu.RUnlock()

	p := c.store.LoadPolicy(ctx)
	c.mu.Lock()
	c.policy = p
	c.loadedAt = time.Now()
	c.valid = true
	c.mu.Unlock()
	return p
}

// Invalidate clears the cached snapshot so the next Get reloads from the Store.
// Called by the admin handler right after a successful PUT (reload-on-write).
func (c *Cache) Invalidate() {
	c.mu.Lock()
	c.valid = false
	c.mu.Unlock()
}

// alwaysAllowed reports whether a request path must bypass geo-filtering so an
// admin can never lock themselves (or the recovery surface) out:
//
//   - /api/v1/admin/*        — the admin console + the geo policy API itself
//   - /api/v1/auth/*         — login, demo-login, OIDC callback, logout
//   - health / readiness     — /healthz, /readyz, /livez, /health
//
// Everything else (the main app, the games area, all other API + static routes)
// is subject to the policy.
func alwaysAllowed(path string) bool {
	switch {
	case strings.HasPrefix(path, "/api/v1/admin/"):
		return true
	case strings.HasPrefix(path, "/api/v1/auth/"):
		return true
	case path == "/healthz" || path == "/readyz" || path == "/livez" || path == "/health":
		return true
	default:
		return false
	}
}

// Middleware wraps next with geo-location enforcement. When the active policy's
// mode is off (the default) the request passes straight through. Otherwise the
// request's CF-IPCountry header is checked against the policy; a blocked country
// gets a 403 with a self-contained HTML page. Exempt paths (alwaysAllowed) are
// never filtered. A missing/unknown country header always passes (fail-open).
func (c *Cache) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Recovery surfaces (admin/auth/health) are never filtered.
		if alwaysAllowed(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		p := c.Get(r.Context())
		if p.Mode == ModeOff {
			next.ServeHTTP(w, r)
			return
		}
		country := r.Header.Get("CF-IPCountry")
		if p.Allows(country) {
			next.ServeHTTP(w, r)
			return
		}
		writeBlockedPage(w)
	})
}

// writeBlockedPage renders the 403 region-restricted page. It is fully
// self-contained (no external assets) so it renders even when the rest of the
// app is unreachable to this client.
func writeBlockedPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(blockedHTML))
}

const blockedHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access restricted</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center;
    background: #0b0f14; color: #e6edf3;
  }
  .card {
    max-width: 460px; margin: 24px; padding: 40px 32px;
    background: #11161d; border: 1px solid #232b35; border-radius: 14px;
    text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,0.35);
  }
  .icon { font-size: 44px; line-height: 1; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 10px; }
  p { font-size: 15px; line-height: 1.55; color: #9fb0c0; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128274;</div>
    <h1>Access from your region is restricted</h1>
    <p>This site isn&#39;t available from your current location. If you believe
       this is a mistake, please contact the site administrator.</p>
  </div>
</body>
</html>`
