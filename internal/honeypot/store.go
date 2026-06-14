// Package honeypot implements an intrusion-tripwire feature for the whole
// instance. It exposes:
//
//   - Store      — reads/writes grown.honeypot_alerts (migration 0087).
//   - Middleware — net/http middleware mounted EARLY in the router that trips on
//     a fixed set of decoy paths that no real UI links to (e.g. /.env,
//     /wp-login.php). On a hit it records a kind="decoy_path" alert and returns
//     an innocuous 404 — it never reveals it is a trap and never blocks a real
//     route (only the exact decoy paths match).
//   - FormHandler — a public POST /api/v1/honeypot whose body carries a hidden
//     form field (company_website / hp_token) that a human never fills in. A
//     non-empty value records a kind="form_bot" alert. Always returns 204.
//   - AdminHandler — the admin-gated listing/management surface at
//     /api/v1/admin/honeypot (recent alerts + counts + clear).
//
// The traps fire on UNAUTHENTICATED requests (catching probers before they have
// a session), so alerts are instance-global — there is no org to scope to (same
// as grown.gamerooms_audit / grown.geo_access). Recording is best-effort and
// never blocks the request: a nil Store, a DB error, or a slow DB is swallowed.
package honeypot

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Alert kinds.
const (
	KindDecoyPath = "decoy_path"
	KindFormBot   = "form_bot"
	// KindAPIScan marks a request to a common probe path (e.g. /.env, /wp-*,
	// /actuator) that no real grown UI links to — recorded but PASSED THROUGH to
	// real routing (which returns its own 404), so it never shadows a route.
	KindAPIScan = "api_scan"
	// KindBadUA marks a request carrying a known scanner/exploitation User-Agent
	// (sqlmap, nikto, nmap, …) or an empty UA on a sensitive path.
	KindBadUA = "bad_ua"
	// KindPathTraversal marks a request whose path/query contains traversal or
	// null-byte sequences (../, %2e%2e, %00).
	KindPathTraversal = "path_traversal"
	// KindScanBurst marks an IP that exceeded the 404 burst threshold within the
	// rolling window — a strong directory-bruteforce / scan signal. Recorded once
	// per window per IP.
	KindScanBurst = "scan_burst"
)

// Store persists honeypot alerts (grown.honeypot_alerts, migration 0087). A nil
// Store (no DB configured) is valid: Record is a no-op and the listing methods
// return empty results, so the feature is simply absent rather than erroring.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store over the given pool. A nil pool yields a nil
// *Store, which every method tolerates.
func NewStore(pool *pgxpool.Pool) *Store {
	if pool == nil {
		return nil
	}
	return &Store{pool: pool}
}

// Alert is one row of grown.honeypot_alerts.
type Alert struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Path      string    `json:"path"`
	Method    string    `json:"method"`
	IP        string    `json:"ip"`
	Country   string    `json:"country"`
	UserAgent string    `json:"user_agent"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}

// maxField caps any captured free-text field so an attacker cannot bloat a row
// with a multi-megabyte User-Agent / path.
const maxField = 1024

func clip(s string) string {
	if len(s) > maxField {
		return s[:maxField]
	}
	return s
}

// Record appends an alert. Best-effort: a nil store is ignored and the write
// runs on a detached short-timeout context inside a goroutine, so a slow or
// failing DB never stalls or blocks the request path that tripped the trap.
func (s *Store) Record(a Alert) {
	if s == nil {
		return
	}
	a.Kind = clip(a.Kind)
	a.Path = clip(a.Path)
	a.Method = clip(a.Method)
	a.IP = clip(a.IP)
	a.Country = clip(a.Country)
	a.UserAgent = clip(a.UserAgent)
	a.Detail = clip(a.Detail)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.pool.Exec(ctx,
			`INSERT INTO grown.honeypot_alerts
			   (kind, path, method, ip, country, user_agent, detail)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			a.Kind, a.Path, a.Method, a.IP, a.Country, a.UserAgent, a.Detail)
	}()
}

// ListRecent returns the newest alerts, newest-first, capped at limit
// (clamped to [1,500], default 100). A nil store yields an empty slice.
func (s *Store) ListRecent(ctx context.Context, limit int) ([]Alert, error) {
	if s == nil {
		return []Alert{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id::text, kind, path, method, ip, country, user_agent, detail, created_at
		   FROM grown.honeypot_alerts
		  ORDER BY created_at DESC
		  LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Alert, 0, limit)
	for rows.Next() {
		var a Alert
		if err := rows.Scan(&a.ID, &a.Kind, &a.Path, &a.Method, &a.IP,
			&a.Country, &a.UserAgent, &a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Counts is the at-a-glance summary surfaced on the admin dashboard badge.
type Counts struct {
	// Total is every alert ever recorded.
	Total int64 `json:"total"`
	// Last24h is alerts created in the trailing 24 hours (drives the red badge).
	Last24h int64 `json:"last_24h"`
	// ByKind is the all-time count per kind (decoy_path, form_bot).
	ByKind map[string]int64 `json:"by_kind"`
}

// CountSummary returns total / last-24h / per-kind counts. A nil store yields a
// zero summary. Errors are swallowed (best-effort) and yield the zero summary.
func (s *Store) CountSummary(ctx context.Context) Counts {
	c := Counts{ByKind: map[string]int64{}}
	if s == nil {
		return c
	}
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM grown.honeypot_alerts`).Scan(&c.Total)
	_ = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM grown.honeypot_alerts WHERE created_at > now() - interval '24 hours'`).
		Scan(&c.Last24h)
	rows, err := s.pool.Query(ctx,
		`SELECT kind, COUNT(*) FROM grown.honeypot_alerts GROUP BY kind`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var k string
			var n int64
			if rows.Scan(&k, &n) == nil {
				c.ByKind[k] = n
			}
		}
	}
	return c
}

// Clear deletes all alerts (the admin "acknowledge / clear" affordance) and
// returns the number removed. A nil store is a no-op returning 0.
func (s *Store) Clear(ctx context.Context) (int64, error) {
	if s == nil {
		return 0, nil
	}
	tag, err := s.pool.Exec(ctx, `DELETE FROM grown.honeypot_alerts`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// DecoyPaths is the fixed set of trap paths. Each is an EXACT path that no real
// grown UI or API links to, so any hit is a probe/scan. Kept exact (not prefix)
// so the middleware can never shadow a real route. Matching is case-sensitive on
// the cleaned path; common scanner targets are listed verbatim.
var DecoyPaths = map[string]struct{}{
	"/.env":                          {},
	"/.git/config":                   {},
	"/wp-login.php":                  {},
	"/admin/credentials":             {},
	"/api/v1/admin/export-all-users": {},
	"/api/v1/admin/backup":           {},
}

// IsDecoyPath reports whether path is one of the decoy traps. The path is
// matched exactly after trimming a single trailing slash, so /.env and /.env/
// both trip but no real route is ever shadowed.
func IsDecoyPath(path string) bool {
	if _, ok := DecoyPaths[path]; ok {
		return true
	}
	if len(path) > 1 && strings.HasSuffix(path, "/") {
		if _, ok := DecoyPaths[strings.TrimRight(path, "/")]; ok {
			return true
		}
	}
	return false
}
