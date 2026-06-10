// Package admin is the data-access + service layer for org administration.
// Its first feature is per-org enable/disable of individual workspace services
// (the Admin console "Apps & services" page).
package admin

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Setting is the in-memory representation of a grown.org_service_settings row.
type Setting struct {
	ServiceID   string
	Enabled     bool
	ExternalURL string // empty means "use the internal route"
	UpdatedAt   time.Time
}

// Repository reads and writes per-org service settings.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetSettings returns every explicitly-stored service toggle for orgID, keyed
// by service id. Services not present in the map are enabled by default — that
// default-on behavior is applied by callers, not encoded here.
func (r *Repository) GetSettings(ctx context.Context, orgID string) (map[string]Setting, error) {
	q := `SELECT service_id, enabled, COALESCE(external_url, ''), updated_at
		FROM grown.org_service_settings
		WHERE org_id=$1
		ORDER BY service_id`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("admin.GetSettings: %w", err)
	}
	defer rows.Close()
	out := make(map[string]Setting)
	for rows.Next() {
		var s Setting
		if err := rows.Scan(&s.ServiceID, &s.Enabled, &s.ExternalURL, &s.UpdatedAt); err != nil {
			return nil, fmt.Errorf("admin.GetSettings scan: %w", err)
		}
		out[s.ServiceID] = s
	}
	return out, rows.Err()
}

// UpsertSettings inserts or updates the given service toggles for orgID in a
// single transaction, then returns the org's full settings map. Empty input is
// a no-op read.
func (r *Repository) UpsertSettings(ctx context.Context, orgID string, settings []Setting) (map[string]Setting, error) {
	if len(settings) > 0 {
		tx, err := r.pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("admin.UpsertSettings begin: %w", err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck // rollback is a no-op after commit
		const q = `INSERT INTO grown.org_service_settings (org_id, service_id, enabled, external_url, updated_at)
			VALUES ($1, $2, $3, NULLIF($4, ''), now())
			ON CONFLICT (org_id, service_id)
			DO UPDATE SET enabled = EXCLUDED.enabled, external_url = EXCLUDED.external_url, updated_at = now()`
		for _, s := range settings {
			if s.ServiceID == "" {
				continue
			}
			if _, err := tx.Exec(ctx, q, orgID, s.ServiceID, s.Enabled, s.ExternalURL); err != nil {
				return nil, fmt.Errorf("admin.UpsertSettings exec %q: %w", s.ServiceID, err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("admin.UpsertSettings commit: %w", err)
		}
	}
	return r.GetSettings(ctx, orgID)
}
