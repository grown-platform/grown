// Package visits implements lightweight, privacy-preserving visitor tracking
// that powers the public "N players in the last 24h" counter atop /games.
//
// It exposes:
//
//   - Store      — upserts/queries/prunes grown.visits (migration 0089). The raw
//     client IP is NEVER stored: only a salted SHA-256 hash, so the table holds
//     no PII, just a daily distinct-visitor set.
//   - Middleware — a cheap net/http middleware that records one visit per real
//     page/app request (static-asset + bot/scanner noise is skipped) without
//     double-counting (it samples a narrow set of "real navigation" requests).
//   - Handler    — the PUBLIC, no-auth GET /api/v1/games/active-users endpoint
//     returning {"unique_24h": N} (same public posture as /api/v1/games/recent).
//   - StartPruner — a periodic background prune that drops rows older than ~2
//     days so the table stays tiny.
//
// Everything is best-effort and non-blocking: a nil Store no-ops, recording runs
// async on a detached context, and errors are swallowed so the tracker can never
// slow or break a real request.
package visits

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store reads/writes grown.visits. A nil Store (no DB configured) is valid:
// Record is a no-op, ActiveUnique24h returns 0, and Prune is a no-op.
type Store struct {
	pool *pgxpool.Pool
	salt string
}

// NewStore constructs a Store over the given pool. A nil pool yields a nil
// *Store, which every method tolerates. The IP-hash salt is read from
// GROWN_VISITS_SALT (any stable secret); a built-in default is used when unset
// so the feature works out of the box (the salt only needs to be non-public and
// stable, not per-deploy unique — it just prevents trivial IP enumeration).
func NewStore(pool *pgxpool.Pool) *Store {
	if pool == nil {
		return nil
	}
	salt := strings.TrimSpace(os.Getenv("GROWN_VISITS_SALT"))
	if salt == "" {
		salt = "grown-visits-default-salt"
	}
	return &Store{pool: pool, salt: salt}
}

// hashIP returns a salted SHA-256 hex digest of the client IP. The salt makes
// the stored value non-reversible to a specific IP without it.
func (s *Store) hashIP(ip string) string {
	h := sha256.Sum256([]byte(s.salt + "|" + ip))
	return hex.EncodeToString(h[:])
}

// Record upserts one visit for the given client IP (hashed), bumping last_seen.
// Best-effort + async: a nil store / empty IP is ignored and the write runs on a
// detached short-timeout context so a slow DB never stalls the request path.
func (s *Store) Record(ip string) {
	if s == nil || ip == "" {
		return
	}
	ipHash := s.hashIP(ip)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.pool.Exec(ctx,
			`INSERT INTO grown.visits (day, ip_hash, last_seen)
			 VALUES (CURRENT_DATE, $1, now())
			 ON CONFLICT (day, ip_hash) DO UPDATE SET last_seen = now()`,
			ipHash)
	}()
}

// ActiveUnique24h returns the count of distinct visitors (distinct ip_hash) seen
// in the trailing 24h. A nil store (or any error) yields 0 (best-effort).
func (s *Store) ActiveUnique24h(ctx context.Context) int64 {
	if s == nil {
		return 0
	}
	var n int64
	_ = s.pool.QueryRow(ctx,
		`SELECT COUNT(DISTINCT ip_hash) FROM grown.visits
		  WHERE last_seen > now() - interval '24 hours'`).Scan(&n)
	return n
}

// Prune deletes rows older than ~2 days (keeping a small buffer beyond the 24h
// window) so the table stays tiny. Best-effort; a nil store is a no-op.
func (s *Store) Prune(ctx context.Context) {
	if s == nil {
		return
	}
	_, _ = s.pool.Exec(ctx,
		`DELETE FROM grown.visits WHERE last_seen < now() - interval '2 days'`)
}

// StartPruner runs Prune immediately and then every 6 hours until ctx is done.
// Safe to call with a nil store (it returns at once). Intended to be launched in
// a goroutine at server start.
func (s *Store) StartPruner(ctx context.Context) {
	if s == nil {
		return
	}
	s.Prune(ctx)
	t := time.NewTicker(6 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Prune(ctx)
		}
	}
}

// ---------------------------------------------------------------------------
// Middleware — records a visit per real page/app navigation, skipping static
// assets, API/relay traffic, and obvious bots/scanners to avoid noise and
// double-counting.
// ---------------------------------------------------------------------------

// botUASubstrings are lower-cased substrings that mark a non-human UA we skip.
var botUASubstrings = []string{
	"bot", "crawler", "spider", "slurp", "curl", "wget", "python-requests",
	"go-http-client", "httpclient", "scrapy", "headless", "sqlmap", "nikto",
	"nmap", "masscan", "zgrab", "nuclei", "facebookexternalhit", "preview",
	"monitor", "uptime", "pingdom", "ahrefs", "semrush",
}

// staticSuffixes are file extensions we treat as asset noise (never a "visit").
var staticSuffixes = []string{
	".js", ".css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
	".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".webm",
	".wasm", ".json", ".txt", ".xml", ".html",
}

// countablePath reports whether a path is a real "navigation" worth counting.
// We count the games area and the SPA's top-level navigations, NOT API calls,
// the game-room relay, static assets, or health checks. This keeps the count to
// roughly one row per visiting browser per day without double-counting the many
// XHR/asset requests a single page load fans out into.
func countablePath(path string) bool {
	lp := strings.ToLower(path)
	// Never count API, relay, health, or well-known traffic.
	if strings.HasPrefix(lp, "/api/") ||
		strings.HasPrefix(lp, "/healthz") ||
		strings.HasPrefix(lp, "/.well-known/") ||
		strings.HasPrefix(lp, "/bolo-mp/") ||
		strings.HasPrefix(lp, "/assemble/") ||
		strings.HasPrefix(lp, "/git/") {
		return false
	}
	// Skip static asset requests by extension.
	for _, suf := range staticSuffixes {
		if strings.HasSuffix(lp, suf) {
			return false
		}
	}
	return true
}

// clientIP extracts a best-effort client IP, preferring the Cloudflare/edge
// headers over the raw socket (the site sits behind a Cloudflare tunnel).
func clientIP(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
		return v
	}
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		if first := strings.TrimSpace(strings.Split(v, ",")[0]); first != "" {
			return first
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

// isBot reports whether the UA looks like a non-human client we should skip.
// An empty UA is also treated as a bot (real browsers always send one).
func isBot(ua string) bool {
	if strings.TrimSpace(ua) == "" {
		return true
	}
	lua := strings.ToLower(ua)
	for _, s := range botUASubstrings {
		if strings.Contains(lua, s) {
			return true
		}
	}
	return false
}

// Middleware records a visit (async) for GET navigations to countable paths from
// non-bot clients, then always calls next. It is intentionally cheap and never
// blocks. A nil store yields next unchanged.
func (s *Store) Middleware(next http.Handler) http.Handler {
	if s == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && countablePath(r.URL.Path) && !isBot(r.UserAgent()) {
			s.Record(clientIP(r))
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// Public handler — GET /api/v1/games/active-users (no auth).
// ---------------------------------------------------------------------------

// ActiveUsersPath is the public, no-auth endpoint serving the 24h unique count.
const ActiveUsersPath = "/api/v1/games/active-users"

// Handler serves GET /api/v1/games/active-users → {"unique_24h": N}. PUBLIC (no
// auth), same posture as /api/v1/games/recent. A nil store yields 0.
func (s *Store) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		n := s.ActiveUnique24h(r.Context())
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]int64{"unique_24h": n})
	})
}
