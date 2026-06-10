package books

// reading.go — repository methods for per-user reading progress, bookmarks,
// highlights, and shelves (all backed by migration 0066_books_reading.sql).

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// --- Reading progress ---

// ReadingProgress is the per-user position record from grown.book_progress.
type ReadingProgress struct {
	UserID    string
	BookID    string
	Locator   string
	Percent   int32
	UpdatedAt time.Time
}

// SetProgress upserts the reading position for a specific user + book. The
// book must belong to orgID (enforces org isolation even though progress is
// user-scoped).
func (r *Repository) SetProgress(ctx context.Context, orgID, userID, bookID, locator string, percent int32) (ReadingProgress, error) {
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	// Verify the book belongs to the org before writing progress.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.books WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL)`,
		bookID, orgID).Scan(&exists)
	if err != nil {
		return ReadingProgress{}, fmt.Errorf("books.SetProgress check: %w", err)
	}
	if !exists {
		return ReadingProgress{}, ErrNotFound
	}
	q := `INSERT INTO grown.book_progress (user_id, book_id, locator, percent, updated_at)
		VALUES ($1,$2,$3,$4,now())
		ON CONFLICT (user_id, book_id) DO UPDATE
		SET locator=EXCLUDED.locator, percent=EXCLUDED.percent, updated_at=now()
		RETURNING user_id::text, book_id::text, locator, percent, updated_at`
	var p ReadingProgress
	err = r.pool.QueryRow(ctx, q, userID, bookID, locator, percent).
		Scan(&p.UserID, &p.BookID, &p.Locator, &p.Percent, &p.UpdatedAt)
	if err != nil {
		return ReadingProgress{}, fmt.Errorf("books.SetProgress: %w", err)
	}
	return p, nil
}

// GetProgress returns the reading position for a user + book, or
// a zero ReadingProgress (not an error) when no record exists yet.
func (r *Repository) GetProgress(ctx context.Context, orgID, userID, bookID string) (ReadingProgress, error) {
	// Verify org scoping.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.books WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL)`,
		bookID, orgID).Scan(&exists)
	if err != nil {
		return ReadingProgress{}, fmt.Errorf("books.GetProgress check: %w", err)
	}
	if !exists {
		return ReadingProgress{}, ErrNotFound
	}
	var p ReadingProgress
	err = r.pool.QueryRow(ctx,
		`SELECT user_id::text, book_id::text, locator, percent, updated_at
		 FROM grown.book_progress WHERE user_id=$1 AND book_id=$2`,
		userID, bookID).
		Scan(&p.UserID, &p.BookID, &p.Locator, &p.Percent, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Return a zero progress (not an error).
		return ReadingProgress{UserID: userID, BookID: bookID}, nil
	}
	if err != nil {
		return ReadingProgress{}, fmt.Errorf("books.GetProgress: %w", err)
	}
	return p, nil
}

// --- Bookmarks ---

// Bookmark is a named position marker within a book.
type Bookmark struct {
	ID        string
	OrgID     string
	UserID    string
	BookID    string
	Locator   string
	Label     string
	CreatedAt time.Time
}

// AddBookmark inserts a new bookmark for a user within an org.
func (r *Repository) AddBookmark(ctx context.Context, orgID, userID, bookID, locator, label string) (Bookmark, error) {
	// Org scoping check.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.books WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL)`,
		bookID, orgID).Scan(&exists)
	if err != nil {
		return Bookmark{}, fmt.Errorf("books.AddBookmark check: %w", err)
	}
	if !exists {
		return Bookmark{}, ErrNotFound
	}
	q := `INSERT INTO grown.book_bookmarks (org_id, user_id, book_id, locator, label)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id::text, org_id::text, user_id::text, book_id::text, locator, label, created_at`
	var bm Bookmark
	err = r.pool.QueryRow(ctx, q, orgID, userID, bookID, locator, label).
		Scan(&bm.ID, &bm.OrgID, &bm.UserID, &bm.BookID, &bm.Locator, &bm.Label, &bm.CreatedAt)
	if err != nil {
		return Bookmark{}, fmt.Errorf("books.AddBookmark: %w", err)
	}
	return bm, nil
}

// ListBookmarks returns all bookmarks for a user + book (org-scoped).
func (r *Repository) ListBookmarks(ctx context.Context, orgID, userID, bookID string) ([]Bookmark, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, user_id::text, book_id::text, locator, label, created_at
		 FROM grown.book_bookmarks
		 WHERE org_id=$1 AND user_id=$2 AND book_id=$3
		 ORDER BY created_at`,
		orgID, userID, bookID)
	if err != nil {
		return nil, fmt.Errorf("books.ListBookmarks: %w", err)
	}
	defer rows.Close()
	var out []Bookmark
	for rows.Next() {
		var bm Bookmark
		if err := rows.Scan(&bm.ID, &bm.OrgID, &bm.UserID, &bm.BookID, &bm.Locator, &bm.Label, &bm.CreatedAt); err != nil {
			return nil, fmt.Errorf("books.ListBookmarks scan: %w", err)
		}
		out = append(out, bm)
	}
	return out, rows.Err()
}

// DeleteBookmark removes a bookmark by id, scoped to org + user.
func (r *Repository) DeleteBookmark(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.book_bookmarks WHERE id=$1 AND org_id=$2 AND user_id=$3`,
		id, orgID, userID)
	if err != nil {
		return fmt.Errorf("books.DeleteBookmark: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Highlights ---

// Highlight is an annotated text passage.
type Highlight struct {
	ID           string
	OrgID        string
	UserID       string
	BookID       string
	Locator      string
	SelectedText string
	Note         string
	Color        string
	CreatedAt    time.Time
}

var validColors = map[string]bool{"yellow": true, "green": true, "blue": true, "pink": true}

// AddHighlight inserts a new highlight. Color defaults to "yellow" if unknown.
func (r *Repository) AddHighlight(ctx context.Context, orgID, userID, bookID, locator, selectedText, note, color string) (Highlight, error) {
	if !validColors[color] {
		color = "yellow"
	}
	// Org scoping check.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.books WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL)`,
		bookID, orgID).Scan(&exists)
	if err != nil {
		return Highlight{}, fmt.Errorf("books.AddHighlight check: %w", err)
	}
	if !exists {
		return Highlight{}, ErrNotFound
	}
	q := `INSERT INTO grown.book_highlights (org_id, user_id, book_id, locator, selected_text, note, color)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id::text, org_id::text, user_id::text, book_id::text, locator, selected_text, note, color, created_at`
	var h Highlight
	err = r.pool.QueryRow(ctx, q, orgID, userID, bookID, locator, selectedText, note, color).
		Scan(&h.ID, &h.OrgID, &h.UserID, &h.BookID, &h.Locator, &h.SelectedText, &h.Note, &h.Color, &h.CreatedAt)
	if err != nil {
		return Highlight{}, fmt.Errorf("books.AddHighlight: %w", err)
	}
	return h, nil
}

// ListHighlights returns all highlights for a user + book (org-scoped).
func (r *Repository) ListHighlights(ctx context.Context, orgID, userID, bookID string) ([]Highlight, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, user_id::text, book_id::text, locator, selected_text, note, color, created_at
		 FROM grown.book_highlights
		 WHERE org_id=$1 AND user_id=$2 AND book_id=$3
		 ORDER BY created_at`,
		orgID, userID, bookID)
	if err != nil {
		return nil, fmt.Errorf("books.ListHighlights: %w", err)
	}
	defer rows.Close()
	var out []Highlight
	for rows.Next() {
		var h Highlight
		if err := rows.Scan(&h.ID, &h.OrgID, &h.UserID, &h.BookID, &h.Locator, &h.SelectedText, &h.Note, &h.Color, &h.CreatedAt); err != nil {
			return nil, fmt.Errorf("books.ListHighlights scan: %w", err)
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// DeleteHighlight removes a highlight by id, scoped to org + user.
func (r *Repository) DeleteHighlight(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.book_highlights WHERE id=$1 AND org_id=$2 AND user_id=$3`,
		id, orgID, userID)
	if err != nil {
		return fmt.Errorf("books.DeleteHighlight: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Shelves ---

// Shelf is a named collection of books.
type Shelf struct {
	ID          string
	OrgID       string
	OwnerUserID string
	Name        string
	CreatedAt   time.Time
}

// CreateShelf inserts a new shelf for a user.
func (r *Repository) CreateShelf(ctx context.Context, orgID, userID, name string) (Shelf, error) {
	q := `INSERT INTO grown.book_shelves (org_id, owner_user_id, name)
		VALUES ($1,$2,$3)
		RETURNING id::text, org_id::text, owner_user_id::text, name, created_at`
	var s Shelf
	err := r.pool.QueryRow(ctx, q, orgID, userID, name).
		Scan(&s.ID, &s.OrgID, &s.OwnerUserID, &s.Name, &s.CreatedAt)
	if err != nil {
		return Shelf{}, fmt.Errorf("books.CreateShelf: %w", err)
	}
	return s, nil
}

// ListShelves returns all shelves owned by a user in an org.
func (r *Repository) ListShelves(ctx context.Context, orgID, userID string) ([]Shelf, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, owner_user_id::text, name, created_at
		 FROM grown.book_shelves
		 WHERE org_id=$1 AND owner_user_id=$2
		 ORDER BY name`,
		orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("books.ListShelves: %w", err)
	}
	defer rows.Close()
	var out []Shelf
	for rows.Next() {
		var s Shelf
		if err := rows.Scan(&s.ID, &s.OrgID, &s.OwnerUserID, &s.Name, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("books.ListShelves scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteShelf deletes a shelf and its memberships, scoped to org + owner.
func (r *Repository) DeleteShelf(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.book_shelves WHERE id=$1 AND org_id=$2 AND owner_user_id=$3`,
		id, orgID, userID)
	if err != nil {
		return fmt.Errorf("books.DeleteShelf: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddToShelf adds a book to a shelf. The shelf must belong to the user in the
// org; the book must belong to the org. Duplicate inserts are silently ignored.
func (r *Repository) AddToShelf(ctx context.Context, orgID, userID, shelfID, bookID string) error {
	// Verify shelf ownership.
	var shelfOK bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.book_shelves WHERE id=$1 AND org_id=$2 AND owner_user_id=$3)`,
		shelfID, orgID, userID).Scan(&shelfOK)
	if err != nil {
		return fmt.Errorf("books.AddToShelf check shelf: %w", err)
	}
	if !shelfOK {
		return ErrNotFound
	}
	// Verify book org scoping.
	var bookOK bool
	err = r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.books WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL)`,
		bookID, orgID).Scan(&bookOK)
	if err != nil {
		return fmt.Errorf("books.AddToShelf check book: %w", err)
	}
	if !bookOK {
		return ErrNotFound
	}
	_, err = r.pool.Exec(ctx,
		`INSERT INTO grown.book_shelf_items (shelf_id, book_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		shelfID, bookID)
	if err != nil {
		return fmt.Errorf("books.AddToShelf: %w", err)
	}
	return nil
}

// RemoveFromShelf removes a book from a shelf. Shelf must be owned by user.
func (r *Repository) RemoveFromShelf(ctx context.Context, orgID, userID, shelfID, bookID string) error {
	// Verify shelf ownership.
	var shelfOK bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.book_shelves WHERE id=$1 AND org_id=$2 AND owner_user_id=$3)`,
		shelfID, orgID, userID).Scan(&shelfOK)
	if err != nil {
		return fmt.Errorf("books.RemoveFromShelf check: %w", err)
	}
	if !shelfOK {
		return ErrNotFound
	}
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.book_shelf_items WHERE shelf_id=$1 AND book_id=$2`,
		shelfID, bookID)
	if err != nil {
		return fmt.Errorf("books.RemoveFromShelf: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListByShelf returns books in a shelf, scoped to orgID.
func (r *Repository) ListByShelf(ctx context.Context, orgID, shelfID string) ([]Book, error) {
	// Verify the shelf exists in the org.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.book_shelves WHERE id=$1 AND org_id=$2)`,
		shelfID, orgID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("books.ListByShelf check: %w", err)
	}
	if !exists {
		return nil, ErrNotFound
	}
	q := `SELECT ` + columns + ` FROM grown.books b
		JOIN grown.book_shelf_items si ON si.book_id = b.id
		WHERE si.shelf_id=$1 AND b.org_id=$2 AND b.trashed_at IS NULL
		ORDER BY b.starred DESC, b.created_at DESC`
	rows, err := r.pool.Query(ctx, q, shelfID, orgID)
	if err != nil {
		return nil, fmt.Errorf("books.ListByShelf: %w", err)
	}
	defer rows.Close()
	var out []Book
	for rows.Next() {
		b, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("books.ListByShelf scan: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
