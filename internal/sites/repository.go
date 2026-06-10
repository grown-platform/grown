// Package sites is the data-access + service layer for the site builder.
//
// A site stores its full page/block tree as a JSONB document. The repository
// treats that document as an opaque JSON string (the editor owns its shape);
// callers pass valid JSON in and get the same JSON back.
package sites

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no site matches the given id (within the org).
var ErrNotFound = errors.New("site not found")

// Site is the in-memory representation of a grown.sites row.
type Site struct {
	ID          string
	OrgID       string
	OwnerID     string
	Name        string
	ContentJSON string
	Published   bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Fields bundles the editable attributes of a site (used by Create/Update).
type Fields struct {
	Name        string
	ContentJSON string
	Published   bool
}

// Repository reads and writes sites.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, name, content::text, published, created_at, updated_at`

// emptyJSON normalises a blank content payload to a valid JSON object so the
// JSONB column never sees an empty string.
func emptyJSON(s string) string {
	if s == "" {
		return "{}"
	}
	return s
}

func scan(row pgx.Row) (Site, error) {
	var s Site
	err := row.Scan(&s.ID, &s.OrgID, &s.OwnerID, &s.Name, &s.ContentJSON, &s.Published, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return Site{}, err
	}
	return s, nil
}

// Create inserts a new site.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, f Fields) (Site, error) {
	q := `INSERT INTO grown.sites (org_id, owner_id, name, content, published)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING ` + columns
	s, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, f.Name, emptyJSON(f.ContentJSON), f.Published))
	if err != nil {
		return Site{}, fmt.Errorf("sites.Create: %w", err)
	}
	return s, nil
}

// Get returns a site within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Site, error) {
	q := `SELECT ` + columns + ` FROM grown.sites WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	s, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Site{}, ErrNotFound
	}
	if err != nil {
		return Site{}, fmt.Errorf("sites.Get: %w", err)
	}
	return s, nil
}

// GetPublished returns a site within orgID only if it is published, else
// ErrNotFound. Powers the unauthenticated public view route.
func (r *Repository) GetPublished(ctx context.Context, orgID, id string) (Site, error) {
	q := `SELECT ` + columns + ` FROM grown.sites
		WHERE id=$1 AND org_id=$2 AND published=true AND trashed_at IS NULL`
	s, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Site{}, ErrNotFound
	}
	if err != nil {
		return Site{}, fmt.Errorf("sites.GetPublished: %w", err)
	}
	return s, nil
}

// List returns all non-trashed sites in orgID, most recently updated first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Site, error) {
	q := `SELECT ` + columns + ` FROM grown.sites
		WHERE org_id=$1 AND trashed_at IS NULL
		ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("sites.List: %w", err)
	}
	defer rows.Close()
	var out []Site
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("sites.List scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Update replaces the editable fields of a site within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f Fields) (Site, error) {
	q := `UPDATE grown.sites SET
		name=$3, content=$4, published=$5, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	s, err := scan(r.pool.QueryRow(ctx, q, id, orgID, f.Name, emptyJSON(f.ContentJSON), f.Published))
	if errors.Is(err, pgx.ErrNoRows) {
		return Site{}, ErrNotFound
	}
	if err != nil {
		return Site{}, fmt.Errorf("sites.Update: %w", err)
	}
	return s, nil
}

// Trash soft-deletes a site within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.sites SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("sites.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
