// Package geoaccess implements instance-level geo-location access control for
// the whole site (not per-org). It enforces an edge access policy against
// Cloudflare's CF-IPCountry request header — the site sits behind a Cloudflare
// Tunnel, so that header is set by Cloudflare's edge and is trustworthy here.
//
// Three pieces live in this package:
//
//   - Store      — reads/writes the single grown.geo_access policy row (0085).
//   - Policy/cache — an in-memory snapshot with a short TTL + reload-on-write so
//     the hot request path does not hit the DB on every request.
//   - Middleware — net/http middleware that returns 403 with a self-contained
//     HTML page when a request's country is blocked by the active policy.
//   - Handler    — admin-gated GET/PUT at /api/v1/admin/geo.
//
// Fail-open is the rule throughout: a nil store, a DB error, or a missing/
// unknown CF-IPCountry header all ALLOW the request, so a misconfiguration or
// outage never locks everyone out. The admin API, auth/login, and health paths
// are additionally exempted in the middleware so an admin can always recover.
package geoaccess

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Mode is the policy mode. Off means no filtering.
const (
	ModeOff   = "off"
	ModeBlock = "block"
	ModeAllow = "allow"
)

// Policy is the instance-wide edge access policy (the single grown.geo_access
// row). Countries are ISO 3166-1 alpha-2 codes, upper-cased.
type Policy struct {
	Mode      string    `json:"mode"`
	Countries []string  `json:"countries"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by"`
}

// defaultPolicy is the inert fail-open policy used when no DB is configured or a
// read fails: mode off ⇒ the middleware never blocks.
func defaultPolicy() Policy {
	return Policy{Mode: ModeOff, Countries: []string{}}
}

// Allows reports whether a request from the given CF-IPCountry code is permitted
// under this policy. The country is the raw header value (e.g. "US", "DE", or
// "XX"/"T1"/"" for unknown). Unknown/empty always ALLOWS — we never block on a
// country we cannot identify, so a misconfigured edge fails open.
func (p Policy) Allows(country string) bool {
	c := strings.ToUpper(strings.TrimSpace(country))
	// Off, or an unknown/Tor/empty country, is always allowed.
	if p.Mode == ModeOff || c == "" || c == "XX" || c == "T1" {
		return true
	}
	in := false
	for _, code := range p.Countries {
		if code == c {
			in = true
			break
		}
	}
	switch p.Mode {
	case ModeBlock:
		// Deny the listed countries; everything else is allowed.
		return !in
	case ModeAllow:
		// Deny everything except the listed countries.
		return in
	default:
		// Unrecognized mode ⇒ fail open.
		return true
	}
}

// Store persists the single grown.geo_access policy row (migration 0085). A nil
// Store (no DB configured) is valid: LoadPolicy returns the inert default and
// SetPolicy is a no-op, so the feature is simply absent rather than erroring.
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

// LoadPolicy reads the single policy row. A nil store (or any error) yields the
// inert default (mode off) — the middleware fails open so a DB hiccup never
// silently blocks the whole site.
func (s *Store) LoadPolicy(ctx context.Context) Policy {
	if s == nil {
		return defaultPolicy()
	}
	var out Policy
	err := s.pool.QueryRow(ctx,
		`SELECT mode, countries, updated_at, updated_by
		   FROM grown.geo_access WHERE id = TRUE`).
		Scan(&out.Mode, &out.Countries, &out.UpdatedAt, &out.UpdatedBy)
	if err != nil {
		return defaultPolicy()
	}
	if out.Countries == nil {
		out.Countries = []string{}
	}
	return out
}

// SetPolicy upserts the policy row, recording the acting admin. Countries are
// normalized (upper-cased, de-duplicated, blanks dropped) before persisting.
func (s *Store) SetPolicy(ctx context.Context, mode string, countries []string, actorEmail string) error {
	if s == nil {
		return nil
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO grown.geo_access (id, mode, countries, updated_at, updated_by)
		 VALUES (TRUE, $1, $2, now(), $3)
		 ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode,
		     countries = EXCLUDED.countries,
		     updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
		mode, NormalizeCountries(countries), actorEmail)
	return err
}

// NormalizeCountries upper-cases, trims, de-duplicates, and drops blank entries,
// returning a non-nil slice. Used both before persisting and when parsing the
// admin PUT body.
func NormalizeCountries(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, c := range in {
		c = strings.ToUpper(strings.TrimSpace(c))
		if c == "" {
			continue
		}
		if _, dup := seen[c]; dup {
			continue
		}
		seen[c] = struct{}{}
		out = append(out, c)
	}
	return out
}

// ValidMode reports whether m is a recognized policy mode.
func ValidMode(m string) bool {
	return m == ModeOff || m == ModeBlock || m == ModeAllow
}
