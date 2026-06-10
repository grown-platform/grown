// Package slides is the data-access + service layer for presentations.
package slides

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no deck matches the given id (within the org).
var ErrNotFound = errors.New("deck not found")

// Deck is the in-memory representation of a grown.slides_documents row.
type Deck struct {
	ID        string
	OrgID     string
	OwnerID   string
	Title     string
	Data      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Repository reads and writes presentations.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// metaColumns excludes the (potentially large) data blob.
const metaColumns = `id::text, org_id::text, owner_id::text, title, created_at, updated_at`

func scanMeta(row pgx.Row) (Deck, error) {
	var d Deck
	err := row.Scan(&d.ID, &d.OrgID, &d.OwnerID, &d.Title, &d.CreatedAt, &d.UpdatedAt)
	return d, err
}

// Create inserts a new presentation. An empty title becomes the column default.
func (r *Repository) Create(ctx context.Context, orgID, ownerID, title string) (Deck, error) {
	q := `INSERT INTO grown.slides_documents (org_id, owner_id, title)
	      VALUES ($1, $2, COALESCE(NULLIF($3, ''), 'Untitled presentation'))
	      RETURNING ` + metaColumns
	d, err := scanMeta(r.pool.QueryRow(ctx, q, orgID, ownerID, title))
	if err != nil {
		return Deck{}, fmt.Errorf("slides.Create: %w", err)
	}
	return d, nil
}

// Get returns a deck's metadata + deck data within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Deck, error) {
	q := `SELECT ` + metaColumns + `, COALESCE(data, '') FROM grown.slides_documents
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`
	var d Deck
	err := r.pool.QueryRow(ctx, q, id, orgID).Scan(
		&d.ID, &d.OrgID, &d.OwnerID, &d.Title, &d.CreatedAt, &d.UpdatedAt, &d.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Deck{}, ErrNotFound
	}
	if err != nil {
		return Deck{}, fmt.Errorf("slides.Get: %w", err)
	}
	return d, nil
}

// GetByID returns the non-trashed deck with id (metadata + data) WITHOUT an org
// filter. Used only on the grant path, after the caller has independently
// verified an object_grant for the requesting user. Callers MUST NOT expose it
// without that check, or it leaks cross-org decks. Use Get (org-scoped) for the
// normal path.
func (r *Repository) GetByID(ctx context.Context, id string) (Deck, error) {
	q := `SELECT ` + metaColumns + `, COALESCE(data, '') FROM grown.slides_documents
	      WHERE id = $1 AND trashed_at IS NULL`
	var d Deck
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&d.ID, &d.OrgID, &d.OwnerID, &d.Title, &d.CreatedAt, &d.UpdatedAt, &d.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Deck{}, ErrNotFound
	}
	if err != nil {
		return Deck{}, fmt.Errorf("slides.GetByID: %w", err)
	}
	return d, nil
}

// GetByIDs returns the non-trashed decks (metadata only) whose ids are in the
// set, across any org, newest first. Backs the Slides "Shared with me" view.
func (r *Repository) GetByIDs(ctx context.Context, ids []string) ([]Deck, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + metaColumns + ` FROM grown.slides_documents
	      WHERE id = ANY($1) AND trashed_at IS NULL
	      ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, ids)
	if err != nil {
		return nil, fmt.Errorf("slides.GetByIDs: %w", err)
	}
	defer rows.Close()
	var out []Deck
	for rows.Next() {
		d, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("slides.GetByIDs scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// List returns all non-trashed decks (metadata only) in orgID, newest first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Deck, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+metaColumns+` FROM grown.slides_documents
		 WHERE org_id = $1 AND trashed_at IS NULL ORDER BY updated_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("slides.List: %w", err)
	}
	defer rows.Close()
	var out []Deck
	for rows.Next() {
		d, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("slides.List scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Rename updates a deck's title within orgID.
func (r *Repository) Rename(ctx context.Context, orgID, id, title string) (Deck, error) {
	q := `UPDATE grown.slides_documents SET title = $3, updated_at = now()
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL
	      RETURNING ` + metaColumns
	d, err := scanMeta(r.pool.QueryRow(ctx, q, id, orgID, title))
	if errors.Is(err, pgx.ErrNoRows) {
		return Deck{}, ErrNotFound
	}
	if err != nil {
		return Deck{}, fmt.Errorf("slides.Rename: %w", err)
	}
	return d, nil
}

// Save stores the deck JSON for a presentation within orgID.
func (r *Repository) Save(ctx context.Context, orgID, id, data string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.slides_documents SET data = $3, updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID, data)
	if err != nil {
		return fmt.Errorf("slides.Save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Trash soft-deletes a deck within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.slides_documents SET trashed_at = now(), updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("slides.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
