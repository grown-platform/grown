// Package games is the data-access layer for user-imported HTML games.
//
// Imported games are untrusted, self-contained HTML documents uploaded at
// runtime. Their bytes live in the blob store (shared with Drive); metadata
// lives in grown.games. All reads are org-scoped.
package games

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no game matches the given id within the org.
var ErrNotFound = errors.New("game not found")

// Game is the public (JSON) view of an imported game row.
type Game struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
}

// GameMeta is the full game record (with org/owner/blob key) used on insert
// and content fetch.
type GameMeta struct {
	Game
	OrgID   string
	OwnerID string
	BlobKey string
}

// Repository is the pgxpool-backed store for imported games.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Create inserts game metadata (the blob is stored separately) and returns the
// row with its generated id + created_at populated.
func (r *Repository) Create(ctx context.Context, m GameMeta) (GameMeta, error) {
	q := `INSERT INTO grown.games (org_id, owner_id, name, blob_key, content_type, size)
	      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text, created_at`
	err := r.pool.QueryRow(ctx, q, m.OrgID, m.OwnerID, m.Name, m.BlobKey, m.ContentType, m.Size).
		Scan(&m.ID, &m.CreatedAt)
	if err != nil {
		return GameMeta{}, fmt.Errorf("games.Create: %w", err)
	}
	return m, nil
}

// ListByOrg returns the public view of all games owned by the org, newest first.
func (r *Repository) ListByOrg(ctx context.Context, orgID string) ([]Game, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, name, content_type, size, created_at
		 FROM grown.games WHERE org_id=$1 ORDER BY created_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("games.ListByOrg: %w", err)
	}
	defer rows.Close()
	out := make([]Game, 0)
	for rows.Next() {
		var g Game
		if err := rows.Scan(&g.ID, &g.Name, &g.ContentType, &g.Size, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("games.ListByOrg scan: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// Get returns full game metadata within an org (for content streaming).
func (r *Repository) Get(ctx context.Context, orgID, id string) (GameMeta, error) {
	var m GameMeta
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, org_id::text, owner_id::text, name, content_type, size, blob_key, created_at
		 FROM grown.games WHERE id=$1 AND org_id=$2`, id, orgID).
		Scan(&m.ID, &m.OrgID, &m.OwnerID, &m.Name, &m.ContentType, &m.Size, &m.BlobKey, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return GameMeta{}, ErrNotFound
	}
	if err != nil {
		return GameMeta{}, fmt.Errorf("games.Get: %w", err)
	}
	return m, nil
}
