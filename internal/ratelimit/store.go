package ratelimit

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store persists rate-limit block events (grown.ratelimit_blocks, migration
// 0088) so the admin console can show recent throttling + the top offending
// IPs. A nil Store (no DB configured) is valid: Record is a no-op and the
// listing methods return empty results, so the observability surface is simply
// absent rather than erroring. Mirrors internal/honeypot.Store.
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

// Block is one row of grown.ratelimit_blocks.
type Block struct {
	ID        string    `json:"id"`
	IP        string    `json:"ip"`
	Path      string    `json:"path"`
	Bucket    string    `json:"bucket"`
	Country   string    `json:"country"`
	UserAgent string    `json:"user_agent"`
	CreatedAt time.Time `json:"created_at"`
}

// maxField caps captured free-text so an attacker can't bloat a row.
const maxField = 1024

func clip(s string) string {
	if len(s) > maxField {
		return s[:maxField]
	}
	return s
}

// Record appends a block event. Best-effort: a nil store is ignored and the
// write runs on a detached short-timeout context inside a goroutine, so a slow
// or failing DB never stalls the (already-rejected) request path. Mirrors the
// honeypot store's async-Record pattern.
func (s *Store) Record(b Block) {
	if s == nil {
		return
	}
	b.IP = clip(b.IP)
	b.Path = clip(b.Path)
	b.Bucket = clip(b.Bucket)
	b.Country = clip(b.Country)
	b.UserAgent = clip(b.UserAgent)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = s.pool.Exec(ctx,
			`INSERT INTO grown.ratelimit_blocks (ip, path, bucket, country, user_agent)
			 VALUES ($1,$2,$3,$4,$5)`,
			b.IP, b.Path, b.Bucket, b.Country, b.UserAgent)
	}()
}

// ListRecent returns the newest block events, newest-first, capped at limit
// (clamped to [1,500], default 100). A nil store yields an empty slice.
func (s *Store) ListRecent(ctx context.Context, limit int) ([]Block, error) {
	if s == nil {
		return []Block{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id::text, ip, path, bucket, country, user_agent, created_at
		   FROM grown.ratelimit_blocks
		  ORDER BY created_at DESC
		  LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Block, 0, limit)
	for rows.Next() {
		var b Block
		if err := rows.Scan(&b.ID, &b.IP, &b.Path, &b.Bucket, &b.Country,
			&b.UserAgent, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Offender is one row of the top-offending-IP summary.
type Offender struct {
	IP    string `json:"ip"`
	Count int64  `json:"count"`
}

// TopOffenders returns the IPs with the most blocks in the trailing 24h, most
// first, capped at limit. A nil store (or any error) yields an empty slice.
func (s *Store) TopOffenders(ctx context.Context, limit int) []Offender {
	if s == nil {
		return []Offender{}
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx,
		`SELECT ip, COUNT(*) AS n FROM grown.ratelimit_blocks
		  WHERE created_at > now() - interval '24 hours' AND ip <> ''
		  GROUP BY ip ORDER BY n DESC, ip ASC LIMIT $1`, limit)
	if err != nil {
		return []Offender{}
	}
	defer rows.Close()
	out := make([]Offender, 0, limit)
	for rows.Next() {
		var o Offender
		if rows.Scan(&o.IP, &o.Count) == nil {
			out = append(out, o)
		}
	}
	return out
}

// Counts is an at-a-glance summary of throttling activity.
type Counts struct {
	Total   int64 `json:"total"`
	Last24h int64 `json:"last_24h"`
}

// CountSummary returns total + last-24h block counts. A nil store (or any error)
// yields a zero summary (best-effort).
func (s *Store) CountSummary(ctx context.Context) Counts {
	var c Counts
	if s == nil {
		return c
	}
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM grown.ratelimit_blocks`).Scan(&c.Total)
	_ = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM grown.ratelimit_blocks WHERE created_at > now() - interval '24 hours'`).
		Scan(&c.Last24h)
	return c
}
