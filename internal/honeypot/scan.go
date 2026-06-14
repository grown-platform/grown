package honeypot

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// This file extends the honeypot tripwire to detect TYPICAL API/vuln scanning
// in addition to the fixed decoy paths. Everything here is best-effort, async,
// and NON-BLOCKING: detection records an alert and then ALWAYS falls through to
// the real router. Unlike the exact decoy paths (which return a canned 404), a
// scan signal never short-circuits a request — so a real route is never shadowed
// and a false positive on a legit path can't break it. The only side effect is a
// recorded alert.

// probePrefixes are leading path fragments that no real grown UI/API serves but
// that vuln scanners hammer. Matched case-insensitively as a prefix on the
// cleaned path. /.well-known/security.txt is deliberately EXCLUDED (it's a legit
// path) by special-casing /.well-known below.
var probePrefixes = []string{
	"/.env",
	"/.git/",
	"/.aws/",
	"/.ssh/",
	"/wp-",        // wp-admin, wp-login.php, wp-content, wp-includes…
	"/phpmyadmin", // and /pma, /phpMyAdmin variants normalize via lower-case
	"/actuator",   // Spring Boot actuator endpoints
	"/swagger",
	"/vendor/",
	"/backup",
	"/config.json",
	"/config.",
	"/cgi-bin/",
	"/.vscode/",
	"/.idea/",
}

// probeSuffixes catch credential/backup files regardless of directory depth
// (e.g. /api/v1/some/path/.env or /app/config.php.bak).
var probeSuffixes = []string{
	"/.env",
	".env",
	".sql",
	".bak",
	".old",
	".swp",
	"/.git/config",
	"/.htpasswd",
	"/.htaccess",
}

// scannerUAs are substrings of well-known scanner / exploitation tool
// User-Agents. Matched case-insensitively on the UA. "python-requests" is here
// as a flood signal, but only counts as bad_ua when paired with a sensitive
// path (handled in classifyScan) to avoid flagging legit automation broadly.
var scannerUAs = []string{
	"sqlmap", "nikto", "nmap", "masscan", "zgrab", "nuclei",
	"dirbuster", "gobuster", "wpscan", "acunetix", "nessus",
	"feroxbuster", "ffuf", "httpx", "metasploit",
}

// traversalTokens are substrings whose presence in the raw path or query marks a
// traversal / null-byte probe.
var traversalTokens = []string{
	"../", "..\\", "%2e%2e", "%2E%2E", "..%2f", "..%5c", "%00", "\x00",
}

// isProbePath reports whether path matches a known probe prefix/suffix. The
// legit /.well-known/* tree is excluded so security.txt etc. never trip.
func isProbePath(path string) bool {
	lp := strings.ToLower(path)
	if strings.HasPrefix(lp, "/.well-known/") {
		return false
	}
	for _, p := range probePrefixes {
		if strings.HasPrefix(lp, p) {
			return true
		}
	}
	for _, s := range probeSuffixes {
		if strings.HasSuffix(lp, s) {
			return true
		}
	}
	return false
}

// hasTraversal reports whether the raw request URI (path + query) contains a
// traversal or null-byte token.
func hasTraversal(rawPath, rawQuery string) bool {
	hay := rawPath + "?" + rawQuery
	for _, t := range traversalTokens {
		if strings.Contains(hay, t) {
			return true
		}
	}
	return false
}

// badUA reports whether the User-Agent is a known scanner. The empty-UA case is
// handled by the caller (only sensitive on probe/sensitive paths).
func badUA(ua string) bool {
	if ua == "" {
		return false
	}
	lua := strings.ToLower(ua)
	for _, s := range scannerUAs {
		if strings.Contains(lua, s) {
			return true
		}
	}
	return false
}

// sensitivePath marks paths where an empty UA is itself suspicious (an honest
// browser/app always sends one). Kept narrow: API + probe paths only.
func sensitivePath(path string) bool {
	lp := strings.ToLower(path)
	return strings.HasPrefix(lp, "/api/") || isProbePath(lp)
}

// classifyScan inspects a request and returns the first matching scan alert
// (kind + detail), or ("","") when nothing matches. Order: traversal (most
// severe) → scanner UA → probe path → empty-UA-on-sensitive. It records at most
// one kind per request to avoid duplicate rows.
func classifyScan(r *http.Request) (kind, detail string) {
	if hasTraversal(r.URL.Path, r.URL.RawQuery) {
		return KindPathTraversal, "traversal/null-byte in URI"
	}
	ua := r.Header.Get("User-Agent")
	if badUA(ua) {
		return KindBadUA, "scanner UA"
	}
	if isProbePath(r.URL.Path) {
		// A scanner UA flooding python-requests on a probe path is still api_scan;
		// the path is the stronger signal.
		return KindAPIScan, "probe path"
	}
	if ua == "" && sensitivePath(r.URL.Path) {
		return KindBadUA, "empty UA on sensitive path"
	}
	return "", ""
}

// ---------------------------------------------------------------------------
// 404-burst tracker — a memory-bounded, TTL'd per-IP 404 counter. When an IP
// exceeds the threshold within the rolling window we record ONE scan_burst alert
// per window, then suppress further bursts for that IP until the window rolls.
// ---------------------------------------------------------------------------

const (
	// burstWindow is the rolling window for counting 404s per IP.
	burstWindow = 5 * time.Minute
	// burstThreshold is the 404 count within burstWindow that trips a scan_burst.
	burstThreshold = 20
	// burstMaxIPs caps the tracked-IP map so a churn of unique IPs can't grow it
	// without bound; when exceeded we drop expired entries (and, if still over,
	// stop tracking new IPs until the sweeper catches up).
	burstMaxIPs = 50000
)

// ipCounter is one IP's rolling 404 state.
type ipCounter struct {
	count       int
	windowStart time.Time
	alerted     bool // a scan_burst was already recorded for the current window
}

// burstTracker counts 404s per IP in a rolling window and reports when an IP
// first crosses the threshold. Safe for concurrent use.
type burstTracker struct {
	mu       sync.Mutex
	ips      map[string]*ipCounter
	lastSwep time.Time
}

func newBurstTracker() *burstTracker {
	return &burstTracker{ips: make(map[string]*ipCounter), lastSwep: time.Now()}
}

// record404 registers a 404 for ip at time now and reports whether THIS call
// crossed the burst threshold (true exactly once per window per IP). It also
// lazily sweeps expired entries to bound memory.
func (b *burstTracker) record404(ip string, now time.Time) bool {
	if ip == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()

	// Lazy sweep at most once per window: drop entries whose window has fully
	// elapsed so the map tracks only currently-active scanners.
	if now.Sub(b.lastSwep) > burstWindow {
		for k, c := range b.ips {
			if now.Sub(c.windowStart) > burstWindow {
				delete(b.ips, k)
			}
		}
		b.lastSwep = now
	}

	c := b.ips[ip]
	if c == nil {
		// Refuse to grow unbounded under a unique-IP flood; the sweep above keeps
		// this rare. New IPs are simply not tracked until space frees up.
		if len(b.ips) >= burstMaxIPs {
			return false
		}
		c = &ipCounter{windowStart: now}
		b.ips[ip] = c
	}
	// Roll the window if it elapsed.
	if now.Sub(c.windowStart) > burstWindow {
		c.count = 0
		c.windowStart = now
		c.alerted = false
	}
	c.count++
	if c.count >= burstThreshold && !c.alerted {
		c.alerted = true
		return true
	}
	return false
}
