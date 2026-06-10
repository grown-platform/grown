// Package whiteboards is the data-access + service layer for Excalidraw whiteboards.
package whiteboards

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no whiteboard matches the given id (within the org).
var ErrNotFound = errors.New("whiteboard not found")

// Whiteboard is the in-memory representation of a grown.whiteboards row.
type Whiteboard struct {
	ID        string
	OrgID     string
	OwnerID   string
	Title     string
	Data      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Repository reads and writes whiteboards.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const metaColumns = `id::text, org_id::text, owner_id::text, title, created_at, updated_at`

func scanMeta(row pgx.Row) (Whiteboard, error) {
	var w Whiteboard
	err := row.Scan(&w.ID, &w.OrgID, &w.OwnerID, &w.Title, &w.CreatedAt, &w.UpdatedAt)
	return w, err
}

// Create inserts a new whiteboard. An empty title becomes the column default.
func (r *Repository) Create(ctx context.Context, orgID, ownerID, title string) (Whiteboard, error) {
	q := `INSERT INTO grown.whiteboards (org_id, owner_id, title)
	      VALUES ($1, $2, COALESCE(NULLIF($3, ''), 'Untitled whiteboard'))
	      RETURNING ` + metaColumns
	w, err := scanMeta(r.pool.QueryRow(ctx, q, orgID, ownerID, title))
	if err != nil {
		return Whiteboard{}, fmt.Errorf("whiteboards.Create: %w", err)
	}
	return w, nil
}

// Get returns a whiteboard's metadata + scene data within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Whiteboard, error) {
	q := `SELECT ` + metaColumns + `, COALESCE(data, '') FROM grown.whiteboards
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`
	var w Whiteboard
	err := r.pool.QueryRow(ctx, q, id, orgID).Scan(
		&w.ID, &w.OrgID, &w.OwnerID, &w.Title, &w.CreatedAt, &w.UpdatedAt, &w.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Whiteboard{}, ErrNotFound
	}
	if err != nil {
		return Whiteboard{}, fmt.Errorf("whiteboards.Get: %w", err)
	}
	return w, nil
}

// List returns all non-trashed whiteboards (metadata only) in orgID, newest first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Whiteboard, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+metaColumns+` FROM grown.whiteboards
		 WHERE org_id = $1 AND trashed_at IS NULL ORDER BY updated_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("whiteboards.List: %w", err)
	}
	defer rows.Close()
	var out []Whiteboard
	for rows.Next() {
		w, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("whiteboards.List scan: %w", err)
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// Rename updates a whiteboard's title within orgID.
func (r *Repository) Rename(ctx context.Context, orgID, id, title string) (Whiteboard, error) {
	q := `UPDATE grown.whiteboards SET title = $3, updated_at = now()
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL
	      RETURNING ` + metaColumns
	w, err := scanMeta(r.pool.QueryRow(ctx, q, id, orgID, title))
	if errors.Is(err, pgx.ErrNoRows) {
		return Whiteboard{}, ErrNotFound
	}
	if err != nil {
		return Whiteboard{}, fmt.Errorf("whiteboards.Rename: %w", err)
	}
	return w, nil
}

// Save stores the scene JSON for a whiteboard within orgID.
func (r *Repository) Save(ctx context.Context, orgID, id, data string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.whiteboards SET data = $3, updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID, data)
	if err != nil {
		return fmt.Errorf("whiteboards.Save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetByID returns the non-trashed whiteboard with id (metadata + data) WITHOUT
// an org scope. Used by the cross-org grant read path; the caller must have
// already verified a grant exists before calling this.
func (r *Repository) GetByID(ctx context.Context, id string) (Whiteboard, error) {
	q := `SELECT ` + metaColumns + `, COALESCE(data, '') FROM grown.whiteboards
	      WHERE id = $1 AND trashed_at IS NULL`
	var w Whiteboard
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&w.ID, &w.OrgID, &w.OwnerID, &w.Title, &w.CreatedAt, &w.UpdatedAt, &w.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Whiteboard{}, ErrNotFound
	}
	if err != nil {
		return Whiteboard{}, fmt.Errorf("whiteboards.GetByID: %w", err)
	}
	return w, nil
}

// GetByIDs returns the non-trashed whiteboards (metadata only) whose ids are in
// the given slice, in arbitrary order. Used by ListSharedWithMe.
func (r *Repository) GetByIDs(ctx context.Context, ids []string) ([]Whiteboard, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+metaColumns+` FROM grown.whiteboards
		 WHERE id = ANY($1::uuid[]) AND trashed_at IS NULL`,
		ids)
	if err != nil {
		return nil, fmt.Errorf("whiteboards.GetByIDs: %w", err)
	}
	defer rows.Close()
	var out []Whiteboard
	for rows.Next() {
		w, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("whiteboards.GetByIDs scan: %w", err)
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// Trash soft-deletes a whiteboard within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.whiteboards SET trashed_at = now(), updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("whiteboards.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
