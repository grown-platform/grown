// Package books is the data-access + service layer for the ebook library.
package books

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no book matches the given id (within the org).
var ErrNotFound = errors.New("book not found")

// SupportedFormats is the set of ebook formats the library accepts.
var SupportedFormats = []string{"epub", "pdf", "mobi", "txt", "cbz"}

// FormatSupported reports whether f is a known ebook format.
func FormatSupported(f string) bool {
	for _, s := range SupportedFormats {
		if s == f {
			return true
		}
	}
	return false
}

// Book is the in-memory representation of a grown.books row.
type Book struct {
	ID              string
	OrgID           string
	OwnerID         string
	Title           string
	Author          string
	Format          string
	Description     string
	FileName        string
	ContentType     string
	SizeBytes       int64
	FileKey         *string
	CoverKey        *string
	Starred         bool
	Finished        bool
	LastLocation    string
	ProgressPercent int32
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// HasCover reports whether the book has a stored cover image.
func (b Book) HasCover() bool { return b.CoverKey != nil && *b.CoverKey != "" }

// Fields bundles the editable metadata of a book (used by Create/Update).
type Fields struct {
	Title       string
	Author      string
	Format      string
	Description string
	Starred     bool
}

// Progress bundles the reader checkpoint fields.
type Progress struct {
	LastLocation    string
	ProgressPercent int32
	Finished        bool
}

// Repository reads and writes books.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, title, author, format, description,
	file_name, content_type, size_bytes, file_key, cover_key, starred, finished,
	last_location, progress_percent, created_at, updated_at`

func scan(row pgx.Row) (Book, error) {
	var b Book
	err := row.Scan(&b.ID, &b.OrgID, &b.OwnerID, &b.Title, &b.Author, &b.Format, &b.Description,
		&b.FileName, &b.ContentType, &b.SizeBytes, &b.FileKey, &b.CoverKey, &b.Starred, &b.Finished,
		&b.LastLocation, &b.ProgressPercent, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return Book{}, err
	}
	return b, nil
}

// Create inserts a new metadata-only book row (no file bytes yet).
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, f Fields) (Book, error) {
	q := `INSERT INTO grown.books (org_id, owner_id, title, author, format, description, starred)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING ` + columns
	b, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, f.Title, f.Author, f.Format, f.Description, f.Starred))
	if err != nil {
		return Book{}, fmt.Errorf("books.Create: %w", err)
	}
	return b, nil
}

// Get returns a book within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Book, error) {
	q := `SELECT ` + columns + ` FROM grown.books WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	b, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("books.Get: %w", err)
	}
	return b, nil
}

// List returns all non-trashed books in orgID, starred first then newest.
func (r *Repository) List(ctx context.Context, orgID string) ([]Book, error) {
	q := `SELECT ` + columns + ` FROM grown.books
		WHERE org_id=$1 AND trashed_at IS NULL
		ORDER BY starred DESC, created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("books.List: %w", err)
	}
	defer rows.Close()
	var out []Book
	for rows.Next() {
		b, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("books.List scan: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Update replaces the editable metadata fields of a book within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f Fields) (Book, error) {
	q := `UPDATE grown.books SET
		title=$3, author=$4, description=$5, starred=$6, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	b, err := scan(r.pool.QueryRow(ctx, q, id, orgID, f.Title, f.Author, f.Description, f.Starred))
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("books.Update: %w", err)
	}
	return b, nil
}

// UpdateProgress records the reader checkpoint for a book within orgID.
func (r *Repository) UpdateProgress(ctx context.Context, orgID, id string, p Progress) (Book, error) {
	pct := p.ProgressPercent
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	q := `UPDATE grown.books SET
		last_location=$3, progress_percent=$4, finished=$5, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	b, err := scan(r.pool.QueryRow(ctx, q, id, orgID, p.LastLocation, pct, p.Finished))
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("books.UpdateProgress: %w", err)
	}
	return b, nil
}

// SetFile records the blob key + file metadata for a book's uploaded file.
func (r *Repository) SetFile(ctx context.Context, orgID, id, fileKey, fileName, contentType string, size int64) (Book, error) {
	q := `UPDATE grown.books SET
		file_key=$3, file_name=$4, content_type=$5, size_bytes=$6, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	b, err := scan(r.pool.QueryRow(ctx, q, id, orgID, fileKey, fileName, contentType, size))
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("books.SetFile: %w", err)
	}
	return b, nil
}

// SetCover records the blob key for a book's cover image.
func (r *Repository) SetCover(ctx context.Context, orgID, id, coverKey string) (Book, error) {
	q := `UPDATE grown.books SET cover_key=$3, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	b, err := scan(r.pool.QueryRow(ctx, q, id, orgID, coverKey))
	if errors.Is(err, pgx.ErrNoRows) {
		return Book{}, ErrNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("books.SetCover: %w", err)
	}
	return b, nil
}

// Trash soft-deletes a book within orgID and returns its blob keys so the
// caller can clean up the underlying blobs.
func (r *Repository) Trash(ctx context.Context, orgID, id string) (fileKey, coverKey *string, err error) {
	q := `UPDATE grown.books SET trashed_at=now(), updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING file_key, cover_key`
	err = r.pool.QueryRow(ctx, q, id, orgID).Scan(&fileKey, &coverKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("books.Trash: %w", err)
	}
	return fileKey, coverKey, nil
}

// CountForOrg returns the number of non-trashed books in orgID. Used by the
// seeder to decide whether to populate sample books on first run.
func (r *Repository) CountForOrg(ctx context.Context, orgID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.books WHERE org_id=$1 AND trashed_at IS NULL`, orgID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("books.CountForOrg: %w", err)
	}
	return n, nil
}

// FirstOwner returns any user id in the org, to attribute seeded books to.
func (r *Repository) FirstOwner(ctx context.Context, orgID string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`SELECT id::text FROM grown.users WHERE org_id=$1 ORDER BY created_at LIMIT 1`, orgID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("books.FirstOwner: %w", err)
	}
	return id, nil
}
