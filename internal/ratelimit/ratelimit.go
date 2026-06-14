// Package ratelimit provides a small, dependency-free, per-client token-bucket
// rate limiter and HTTP middleware for the public API. It protects against
// abusive request volume (and credential-stuffing on the auth endpoints) with
// sensible defaults that can be tuned via environment variables.
package ratelimit

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// bucket is one client's token bucket.
type bucket struct {
	tokens float64
	last   time.Time
}

// limiter is a keyed token bucket: `rate` tokens refill per second up to
// `burst` capacity. allow() consumes one token if available.
type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64
	burst   float64
}

func newLimiter(rate, burst float64) *limiter {
	return &limiter{buckets: make(map[string]*bucket), rate: rate, burst: burst}
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// sweep drops buckets that have been idle long enough to have fully refilled,
// bounding memory under churn.
func (l *limiter) sweep(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, b := range l.buckets {
		if now.Sub(b.last) > 10*time.Minute {
			delete(l.buckets, k)
		}
	}
}

// Settings is the effective, human-readable configuration (surfaced in the
// admin console so operators can see the active API limits).
type Settings struct {
	Enabled      bool    `json:"enabled"`
	GeneralRPS   float64 `json:"general_rps"`
	GeneralBurst float64 `json:"general_burst"`
	AuthRPS      float64 `json:"auth_rps"`
	AuthBurst    float64 `json:"auth_burst"`
	KeyBy        string  `json:"key_by"` // "ip"
}

// RateLimiter applies a general bucket to all API requests and a stricter
// bucket to authentication endpoints, keyed by client IP.
type RateLimiter struct {
	general  *limiter
	auth     *limiter
	settings Settings
	// store records block events for the admin observability panel. nil ⇒ no
	// recording (the limiter still throttles; it just isn't observable in the DB).
	store *Store
}

// WithStore wires a block-event store so 429 rejections are recorded for the
// admin Rate-limiting panel. Returns rl for chaining. A nil store is tolerated
// (recording becomes a no-op).
func (rl *RateLimiter) WithStore(s *Store) *RateLimiter {
	rl.store = s
	return rl
}

// FromEnv builds a RateLimiter from environment variables, with defaults tuned
// for a small self-hosted workspace:
//
//	GROWN_RATELIMIT_ENABLED      (default "true")
//	GROWN_RATELIMIT_RPS          general sustained req/s per IP   (default 30)
//	GROWN_RATELIMIT_BURST        general burst per IP             (default 60)
//	GROWN_RATELIMIT_AUTH_RPS     auth endpoints req/s per IP      (default 0.5)
//	GROWN_RATELIMIT_AUTH_BURST   auth burst per IP                (default 10)
func FromEnv() *RateLimiter {
	enabled := envBool("GROWN_RATELIMIT_ENABLED", true)
	gRPS := envFloat("GROWN_RATELIMIT_RPS", 30)
	gBurst := envFloat("GROWN_RATELIMIT_BURST", 60)
	aRPS := envFloat("GROWN_RATELIMIT_AUTH_RPS", 0.5)
	aBurst := envFloat("GROWN_RATELIMIT_AUTH_BURST", 10)
	rl := &RateLimiter{
		general: newLimiter(gRPS, gBurst),
		auth:    newLimiter(aRPS, aBurst),
		settings: Settings{
			Enabled: enabled, GeneralRPS: gRPS, GeneralBurst: gBurst,
			AuthRPS: aRPS, AuthBurst: aBurst, KeyBy: "ip",
		},
	}
	if enabled {
		go rl.janitor()
	}
	return rl
}

func (rl *RateLimiter) janitor() {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for now := range t.C {
		rl.general.sweep(now)
		rl.auth.sweep(now)
	}
}

// Settings returns the effective configuration (for the admin console).
func (rl *RateLimiter) Settings() Settings { return rl.settings }

// isAuthPath marks the credential-bearing endpoints that get the stricter
// bucket (login + demo login), to blunt brute-force attempts.
func isAuthPath(p string) bool {
	return strings.HasPrefix(p, "/api/v1/auth/login") || p == "/api/v1/auth/demo-login"
}

// clientIP extracts the caller's IP, honoring the first hop of
// X-Forwarded-For (we sit behind the cluster gateway/ingress).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Middleware wraps an API handler, returning 429 with Retry-After when a
// client exceeds its bucket. WebSocket upgrade requests are exempt (a single
// long-lived connection shouldn't be throttled like request bursts).
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	if !rl.settings.Enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			next.ServeHTTP(w, r)
			return
		}
		lim := rl.general
		bucket := "general"
		if isAuthPath(r.URL.Path) {
			lim = rl.auth
			bucket = "auth"
		}
		if !lim.allow(clientIP(r), time.Now()) {
			// Record the throttle event (best-effort, async) for the admin panel.
			rl.store.Record(Block{
				IP:        clientIP(r),
				Path:      r.URL.Path,
				Bucket:    bucket,
				Country:   strings.TrimSpace(r.Header.Get("CF-IPCountry")),
				UserAgent: r.UserAgent(),
			})
			w.Header().Set("Retry-After", "1")
			http.Error(w, "rate limit exceeded — slow down and retry", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ServeSettings is a tiny JSON endpoint (intended to be admin-gated by the
// caller) that returns the active limits for display in the admin console.
func (rl *RateLimiter) ServeSettings(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rl.settings)
}

func envBool(k string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envFloat(k string, def float64) float64 {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}
