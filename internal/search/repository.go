// Package search provides unified cross-app search over the existing tables.
// It runs read-only parameterised ILIKE queries directly against each app's
// schema — no new tables required — and enforces org-scoping on every query.
package search

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Result is a single matched item returned by the repository.
type Result struct {
	// Type names the source app ("drive", "docs", "sheets", etc.).
	Type    string
	ID      string
	Title   string
	Snippet string
	// URL is the deep-link SPA path, e.g. /docs/d/<id>.
	URL string
}

// Repository holds the pool and runs per-type ILIKE queries.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Search runs one ILIKE query per source type (in parallel via goroutines),
// filters by orgID and, where rows are per-user, by userID. Results for each
// type are capped at perTypeLimit. The combined slice is unordered within a
// type but types always appear in a stable order.
func (r *Repository) Search(ctx context.Context, orgID, userID, query string, perTypeLimit int) ([]Result, error) {
	if perTypeLimit <= 0 || perTypeLimit > 50 {
		perTypeLimit = 10
	}
	q := "%" + strings.ToLower(query) + "%"

	type rowFn func() ([]Result, error)

	fns := []rowFn{
		func() ([]Result, error) { return r.searchDrive(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchDocs(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchSheets(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchSlides(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchContacts(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchKeep(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchCalendar(ctx, orgID, q, perTypeLimit) },
		func() ([]Result, error) { return r.searchMail(ctx, userID, q, perTypeLimit) },
	}

	type work struct {
		idx     int
		results []Result
		err     error
	}
	ch := make(chan work, len(fns))
	for i, fn := range fns {
		i, fn := i, fn
		go func() {
			res, err := fn()
			ch <- work{idx: i, results: res, err: err}
		}()
	}

	buckets := make([][]Result, len(fns))
	for range fns {
		w := <-ch
		if w.err != nil {
			return nil, fmt.Errorf("search bucket %d: %w", w.idx, w.err)
		}
		buckets[w.idx] = w.results
	}

	var out []Result
	for _, b := range buckets {
		out = append(out, b...)
	}
	return out, nil
}

// searchDrive matches drive files by name (non-trashed, org-scoped).
func (r *Repository) searchDrive(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, name, COALESCE(mime_type, '')
		 FROM grown.drive_files
		 WHERE org_id = $1 AND trashed_at IS NULL AND lower(name) LIKE $2
		 ORDER BY updated_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.drive: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, name, mime string
		if err := rows.Scan(&id, &name, &mime); err != nil {
			return nil, err
		}
		out = append(out, Result{
			Type:    "drive",
			ID:      id,
			Title:   name,
			Snippet: mime,
			URL:     "/drive",
		})
	}
	return out, rows.Err()
}

// searchDocs matches docs documents by title (non-trashed, org-scoped).
func (r *Repository) searchDocs(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, title
		 FROM grown.docs_documents
		 WHERE org_id = $1 AND trashed_at IS NULL AND lower(title) LIKE $2
		 ORDER BY updated_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.docs: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return nil, err
		}
		out = append(out, Result{
			Type:  "docs",
			ID:    id,
			Title: title,
			URL:   "/docs/d/" + id,
		})
	}
	return out, rows.Err()
}

// searchSheets matches sheets documents by title (non-trashed, org-scoped).
func (r *Repository) searchSheets(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, title
		 FROM grown.sheets_documents
		 WHERE org_id = $1 AND trashed_at IS NULL AND lower(title) LIKE $2
		 ORDER BY updated_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.sheets: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return nil, err
		}
		out = append(out, Result{
			Type:  "sheets",
			ID:    id,
			Title: title,
			URL:   "/sheets/d/" + id,
		})
	}
	return out, rows.Err()
}

// searchSlides matches slides documents by title (non-trashed, org-scoped).
func (r *Repository) searchSlides(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, title
		 FROM grown.slides_documents
		 WHERE org_id = $1 AND trashed_at IS NULL AND lower(title) LIKE $2
		 ORDER BY updated_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.slides: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, title string
		if err := rows.Scan(&id, &title); err != nil {
			return nil, err
		}
		out = append(out, Result{
			Type:  "slides",
			ID:    id,
			Title: title,
			URL:   "/slides/d/" + id,
		})
	}
	return out, rows.Err()
}

// searchContacts matches contacts by display_name, first_name, last_name (org-scoped).
func (r *Repository) searchContacts(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, display_name, COALESCE(emails::text, '')
		 FROM grown.contacts
		 WHERE org_id = $1 AND trashed_at IS NULL
		   AND (lower(display_name) LIKE $2 OR lower(first_name) LIKE $2 OR lower(last_name) LIKE $2
		     OR lower(COALESCE(emails::text,'')) LIKE $2)
		 ORDER BY updated_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.contacts: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, name, emails string
		if err := rows.Scan(&id, &name, &emails); err != nil {
			return nil, err
		}
		out = append(out, Result{
			Type:    "contacts",
			ID:      id,
			Title:   name,
			Snippet: emails,
			URL:     "/contacts",
		})
	}
	return out, rows.Err()
}

// searchKeep matches notes by title or body (non-trashed, org-scoped).
func (r *Repository) searchKeep(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, title, body
		 FROM grown.keep_notes
		 WHERE org_id = $1 AND trashed_at IS NULL
		   AND (lower(title) LIKE $2 OR lower(body) LIKE $2)
		 ORDER BY updated_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.keep: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, title, body string
		if err := rows.Scan(&id, &title, &body); err != nil {
			return nil, err
		}
		snippet := body
		if len(snippet) > 120 {
			snippet = snippet[:120] + "…"
		}
		out = append(out, Result{
			Type:    "keep",
			ID:      id,
			Title:   title,
			Snippet: snippet,
			URL:     "/keep",
		})
	}
	return out, rows.Err()
}

// searchCalendar matches events by title (non-trashed, org-scoped).
func (r *Repository) searchCalendar(ctx context.Context, orgID, q string, lim int) ([]Result, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, title, COALESCE(description, '')
		 FROM grown.calendar_events
		 WHERE org_id = $1 AND trashed_at IS NULL AND lower(title) LIKE $2
		 ORDER BY start_at DESC LIMIT $3`,
		orgID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.calendar: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, title, desc string
		if err := rows.Scan(&id, &title, &desc); err != nil {
			return nil, err
		}
		snippet := desc
		if len(snippet) > 120 {
			snippet = snippet[:120] + "…"
		}
		out = append(out, Result{
			Type:    "calendar",
			ID:      id,
			Title:   title,
			Snippet: snippet,
			URL:     "/calendar",
		})
	}
	return out, rows.Err()
}

// searchMail matches messages by subject or snippet (per-user ownership).
// Mail rows are scoped by owner_id (the mailbox owner's user id) rather than
// org_id, to match the existing mail service's isolation model.
func (r *Repository) searchMail(ctx context.Context, userID, q string, lim int) ([]Result, error) {
	if userID == "" {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, subject, snippet
		 FROM grown.mail_messages
		 WHERE owner_id = $1
		   AND (lower(subject) LIKE $2 OR lower(snippet) LIKE $2)
		 ORDER BY sent_at DESC LIMIT $3`,
		userID, q, lim)
	if err != nil {
		return nil, fmt.Errorf("search.mail: %w", err)
	}
	defer rows.Close()
	var out []Result
	for rows.Next() {
		var id, subject, snippet string
		if err := rows.Scan(&id, &subject, &snippet); err != nil {
			return nil, err
		}
		out = append(out, Result{
			Type:    "mail",
			ID:      id,
			Title:   subject,
			Snippet: snippet,
			URL:     "/mail",
		})
	}
	return out, rows.Err()
}
