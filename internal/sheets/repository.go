// Package sheets is the data-access + service layer for spreadsheets.
package sheets

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no sheet matches the given id (within the org).
var ErrNotFound = errors.New("sheet not found")

// Sheet is the in-memory representation of a grown.sheets_documents row.
type Sheet struct {
	ID        string
	OrgID     string
	OwnerID   string
	Title     string
	Data      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Repository reads and writes spreadsheets.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// metaColumns excludes the (potentially large) data blob.
const metaColumns = `id::text, org_id::text, owner_id::text, title, created_at, updated_at`

func scanMeta(row pgx.Row) (Sheet, error) {
	var s Sheet
	err := row.Scan(&s.ID, &s.OrgID, &s.OwnerID, &s.Title, &s.CreatedAt, &s.UpdatedAt)
	return s, err
}

// Create inserts a new spreadsheet. An empty title becomes the column default.
func (r *Repository) Create(ctx context.Context, orgID, ownerID, title string) (Sheet, error) {
	q := `INSERT INTO grown.sheets_documents (org_id, owner_id, title)
	      VALUES ($1, $2, COALESCE(NULLIF($3, ''), 'Untitled spreadsheet'))
	      RETURNING ` + metaColumns
	s, err := scanMeta(r.pool.QueryRow(ctx, q, orgID, ownerID, title))
	if err != nil {
		return Sheet{}, fmt.Errorf("sheets.Create: %w", err)
	}
	return s, nil
}

// Get returns a sheet's metadata + workbook data within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Sheet, error) {
	q := `SELECT ` + metaColumns + `, COALESCE(data, '') FROM grown.sheets_documents
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`
	var s Sheet
	err := r.pool.QueryRow(ctx, q, id, orgID).Scan(
		&s.ID, &s.OrgID, &s.OwnerID, &s.Title, &s.CreatedAt, &s.UpdatedAt, &s.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Sheet{}, ErrNotFound
	}
	if err != nil {
		return Sheet{}, fmt.Errorf("sheets.Get: %w", err)
	}
	return s, nil
}

// GetByID returns the non-trashed sheet with id (metadata + data) WITHOUT an org
// filter. Used only on the grant path, after the caller has independently
// verified an object_grant for the requesting user. Callers MUST NOT expose it
// without that check, or it leaks cross-org sheets. Use Get (org-scoped) for the
// normal path.
func (r *Repository) GetByID(ctx context.Context, id string) (Sheet, error) {
	q := `SELECT ` + metaColumns + `, COALESCE(data, '') FROM grown.sheets_documents
	      WHERE id = $1 AND trashed_at IS NULL`
	var s Sheet
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&s.ID, &s.OrgID, &s.OwnerID, &s.Title, &s.CreatedAt, &s.UpdatedAt, &s.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return Sheet{}, ErrNotFound
	}
	if err != nil {
		return Sheet{}, fmt.Errorf("sheets.GetByID: %w", err)
	}
	return s, nil
}

// GetByIDs returns the non-trashed sheets (metadata only) whose ids are in the
// set, across any org, newest first. Backs the Sheets "Shared with me" view.
func (r *Repository) GetByIDs(ctx context.Context, ids []string) ([]Sheet, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + metaColumns + ` FROM grown.sheets_documents
	      WHERE id = ANY($1) AND trashed_at IS NULL
	      ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, ids)
	if err != nil {
		return nil, fmt.Errorf("sheets.GetByIDs: %w", err)
	}
	defer rows.Close()
	var out []Sheet
	for rows.Next() {
		s, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("sheets.GetByIDs scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// List returns all non-trashed sheets (metadata only) in orgID, newest first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Sheet, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+metaColumns+` FROM grown.sheets_documents
		 WHERE org_id = $1 AND trashed_at IS NULL ORDER BY updated_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("sheets.List: %w", err)
	}
	defer rows.Close()
	var out []Sheet
	for rows.Next() {
		s, err := scanMeta(rows)
		if err != nil {
			return nil, fmt.Errorf("sheets.List scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Rename updates a sheet's title within orgID.
func (r *Repository) Rename(ctx context.Context, orgID, id, title string) (Sheet, error) {
	q := `UPDATE grown.sheets_documents SET title = $3, updated_at = now()
	      WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL
	      RETURNING ` + metaColumns
	s, err := scanMeta(r.pool.QueryRow(ctx, q, id, orgID, title))
	if errors.Is(err, pgx.ErrNoRows) {
		return Sheet{}, ErrNotFound
	}
	if err != nil {
		return Sheet{}, fmt.Errorf("sheets.Rename: %w", err)
	}
	return s, nil
}

// Save stores the workbook JSON for a sheet within orgID.
func (r *Repository) Save(ctx context.Context, orgID, id, data string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.sheets_documents SET data = $3, updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID, data)
	if err != nil {
		return fmt.Errorf("sheets.Save: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Trash soft-deletes a sheet within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.sheets_documents SET trashed_at = now(), updated_at = now()
		 WHERE id = $1 AND org_id = $2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("sheets.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
