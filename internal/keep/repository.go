// Package keep is the data-access + service layer for quick notes (a Google
// Keep clone).
package keep

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no note matches the given id (within the org).
var ErrNotFound = errors.New("note not found")

// ChecklistItem is a single line of an optional note checklist.
type ChecklistItem struct {
	Text    string `json:"text"`
	Checked bool   `json:"checked"`
}

// Note is the in-memory representation of a grown.keep_notes row.
type Note struct {
	ID        string
	OrgID     string
	OwnerID   string
	Title     string
	Body      string
	Color     string
	Pinned    bool
	Archived  bool
	Labels    []string
	Checklist []ChecklistItem
	RemindAt  *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Fields bundles the editable attributes of a note (used by Create/Update).
type Fields struct {
	Title     string
	Body      string
	Color     string
	Pinned    bool
	Archived  bool
	Labels    []string
	Checklist []ChecklistItem
}

// Repository reads and writes notes.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, title, body, color,
	pinned, archived, labels, checklist, remind_at, created_at, updated_at`

func jsonLabels(s []string) []byte {
	if s == nil {
		s = []string{}
	}
	b, _ := json.Marshal(s)
	return b
}

func jsonChecklist(items []ChecklistItem) []byte {
	if items == nil {
		items = []ChecklistItem{}
	}
	b, _ := json.Marshal(items)
	return b
}

func scan(row pgx.Row) (Note, error) {
	var n Note
	var labels, checklist []byte
	err := row.Scan(&n.ID, &n.OrgID, &n.OwnerID, &n.Title, &n.Body, &n.Color,
		&n.Pinned, &n.Archived, &labels, &checklist, &n.RemindAt, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return Note{}, err
	}
	_ = json.Unmarshal(labels, &n.Labels)
	_ = json.Unmarshal(checklist, &n.Checklist)
	return n, nil
}

// Create inserts a new note.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, f Fields) (Note, error) {
	q := `INSERT INTO grown.keep_notes
		(org_id, owner_id, title, body, color, pinned, archived, labels, checklist)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING ` + columns
	n, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, f.Title, f.Body, f.Color,
		f.Pinned, f.Archived, jsonLabels(f.Labels), jsonChecklist(f.Checklist)))
	if err != nil {
		return Note{}, fmt.Errorf("keep.Create: %w", err)
	}
	return n, nil
}

// Get returns a note within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Note, error) {
	q := `SELECT ` + columns + ` FROM grown.keep_notes WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	n, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if err != nil {
		return Note{}, fmt.Errorf("keep.Get: %w", err)
	}
	return n, nil
}

// GetByID returns the non-trashed note with id WITHOUT an org filter. Used
// only on the grant path, after the caller has independently verified an
// object_grant for the requesting user. Callers MUST NOT expose it without
// that check, or it leaks cross-org notes.
func (r *Repository) GetByID(ctx context.Context, id string) (Note, error) {
	q := `SELECT ` + columns + ` FROM grown.keep_notes WHERE id=$1 AND trashed_at IS NULL`
	n, err := scan(r.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if err != nil {
		return Note{}, fmt.Errorf("keep.GetByID: %w", err)
	}
	return n, nil
}

// GetByIDs returns the non-trashed notes whose ids are in the set, across
// any org, newest first. Backs the Keep "Shared with me" view.
func (r *Repository) GetByIDs(ctx context.Context, ids []string) ([]Note, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + columns + ` FROM grown.keep_notes
		  WHERE id = ANY($1) AND trashed_at IS NULL
		  ORDER BY updated_at DESC`
	rows, err := r.pool.Query(ctx, q, ids)
	if err != nil {
		return nil, fmt.Errorf("keep.GetByIDs: %w", err)
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("keep.GetByIDs scan: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// List returns all non-trashed notes in orgID, pinned first then most-recent.
func (r *Repository) List(ctx context.Context, orgID string) ([]Note, error) {
	q := `SELECT ` + columns + ` FROM grown.keep_notes
		WHERE org_id=$1 AND trashed_at IS NULL
		ORDER BY pinned DESC, updated_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("keep.List: %w", err)
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("keep.List scan: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ListFiltered returns non-trashed notes in orgID, with optional filters.
// When archived is true, only archived notes are returned; otherwise only
// non-archived notes are returned. When labelID is non-empty, only notes
// linked to that label (via keep_note_labels) are included.
func (r *Repository) ListFiltered(ctx context.Context, orgID string, archived bool, labelID string) ([]Note, error) {
	q := `SELECT ` + columns + ` FROM grown.keep_notes n
		WHERE n.org_id=$1 AND n.trashed_at IS NULL AND n.archived=$2`
	args := []any{orgID, archived}
	if labelID != "" {
		q += ` AND EXISTS (SELECT 1 FROM grown.keep_note_labels knl WHERE knl.note_id=n.id AND knl.label_id=$3)`
		args = append(args, labelID)
	}
	q += ` ORDER BY n.pinned DESC, n.updated_at DESC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("keep.ListFiltered: %w", err)
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("keep.ListFiltered scan: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// Update replaces the editable fields of a note within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f Fields) (Note, error) {
	q := `UPDATE grown.keep_notes SET
		title=$3, body=$4, color=$5, pinned=$6, archived=$7,
		labels=$8, checklist=$9, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	n, err := scan(r.pool.QueryRow(ctx, q, id, orgID, f.Title, f.Body, f.Color,
		f.Pinned, f.Archived, jsonLabels(f.Labels), jsonChecklist(f.Checklist)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if err != nil {
		return Note{}, fmt.Errorf("keep.Update: %w", err)
	}
	return n, nil
}

// SetReminder sets or updates the remind_at timestamp of a note within orgID.
// Pass nil to clear the reminder.
func (r *Repository) SetReminder(ctx context.Context, orgID, id string, remindAt *time.Time) (Note, error) {
	q := `UPDATE grown.keep_notes SET remind_at=$3, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	n, err := scan(r.pool.QueryRow(ctx, q, id, orgID, remindAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if err != nil {
		return Note{}, fmt.Errorf("keep.SetReminder: %w", err)
	}
	return n, nil
}

// ListReminders returns all non-trashed notes in orgID that have remind_at set,
// ordered by remind_at ascending (soonest first).
func (r *Repository) ListReminders(ctx context.Context, orgID string) ([]Note, error) {
	q := `SELECT ` + columns + ` FROM grown.keep_notes
		WHERE org_id=$1 AND remind_at IS NOT NULL AND trashed_at IS NULL
		ORDER BY remind_at ASC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("keep.ListReminders: %w", err)
	}
	defer rows.Close()
	var out []Note
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("keep.ListReminders scan: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// SetArchived sets the archived flag on a note.
func (r *Repository) SetArchived(ctx context.Context, orgID, id string, archived bool) (Note, error) {
	q := `UPDATE grown.keep_notes SET archived=$3, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	n, err := scan(r.pool.QueryRow(ctx, q, id, orgID, archived))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if err != nil {
		return Note{}, fmt.Errorf("keep.SetArchived: %w", err)
	}
	return n, nil
}

// Trash soft-deletes a note within orgID.
func (r *Repository) Trash(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.keep_notes SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("keep.Trash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Label is a named label owned by a user within their org.
type Label struct {
	ID        string
	OrgID     string
	UserID    string
	Name      string
	CreatedAt time.Time
}

// ErrLabelNotFound is returned when no label matches the given id.
var ErrLabelNotFound = errors.New("label not found")

// CreateLabel inserts a new label.
func (r *Repository) CreateLabel(ctx context.Context, orgID, userID, name string) (Label, error) {
	var l Label
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.keep_labels (org_id, user_id, name)
		 VALUES ($1,$2,$3)
		 RETURNING id::text, org_id::text, user_id::text, name, created_at`,
		orgID, userID, name).Scan(&l.ID, &l.OrgID, &l.UserID, &l.Name, &l.CreatedAt)
	if err != nil {
		return Label{}, fmt.Errorf("keep.CreateLabel: %w", err)
	}
	return l, nil
}

// ListLabels returns all labels for the given org+user, alphabetically.
func (r *Repository) ListLabels(ctx context.Context, orgID, userID string) ([]Label, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, org_id::text, user_id::text, name, created_at
		 FROM grown.keep_labels
		 WHERE org_id=$1 AND user_id=$2
		 ORDER BY name`,
		orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("keep.ListLabels: %w", err)
	}
	defer rows.Close()
	var out []Label
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.OrgID, &l.UserID, &l.Name, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("keep.ListLabels scan: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// DeleteLabel removes a label (CASCADE removes keep_note_labels rows).
func (r *Repository) DeleteLabel(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.keep_labels WHERE id=$1 AND org_id=$2 AND user_id=$3`,
		id, orgID, userID)
	if err != nil {
		return fmt.Errorf("keep.DeleteLabel: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrLabelNotFound
	}
	return nil
}

// ApplyLabel attaches a label to a note (idempotent via ON CONFLICT DO NOTHING).
func (r *Repository) ApplyLabel(ctx context.Context, orgID, noteID, labelID string) error {
	// Verify the note belongs to the org.
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT true FROM grown.keep_notes WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`,
		noteID, orgID).Scan(&exists); err != nil || !exists {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.keep_note_labels (note_id, label_id) VALUES ($1,$2)
		 ON CONFLICT DO NOTHING`,
		noteID, labelID)
	if err != nil {
		return fmt.Errorf("keep.ApplyLabel: %w", err)
	}
	return nil
}

// RemoveLabel detaches a label from a note.
func (r *Repository) RemoveLabel(ctx context.Context, orgID, noteID, labelID string) error {
	// Verify the note belongs to the org.
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT true FROM grown.keep_notes WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`,
		noteID, orgID).Scan(&exists); err != nil || !exists {
		return ErrNotFound
	}
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.keep_note_labels WHERE note_id=$1 AND label_id=$2`,
		noteID, labelID)
	if err != nil {
		return fmt.Errorf("keep.RemoveLabel: %w", err)
	}
	return nil
}
