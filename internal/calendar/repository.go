// Package calendar is the data-access + service layer for calendar events.
package calendar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no event matches the given id (within the org).
var ErrNotFound = errors.New("event not found")

// ItemType constants for calendar item types.
const (
	ItemTypeEvent       = "event"
	ItemTypeTask        = "task"
	ItemTypeOutOfOffice = "out_of_office"
	ItemTypeFocusTime   = "focus_time"
)

// StatusBusy / StatusFree are the valid status values.
const (
	StatusBusy = "busy"
	StatusFree = "free"
)

// VisibilityDefault / VisibilityPublic / VisibilityPrivate.
const (
	VisibilityDefault = "default"
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

// Event is the in-memory representation of a grown.calendar_events row.
type Event struct {
	ID          string
	OrgID       string
	OwnerID     string
	Title       string
	Description string
	Location    string
	StartAt     time.Time
	EndAt       time.Time
	AllDay      bool
	Color       string
	Recurrence  string
	Attendees   []string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	// RecurringEventID is set (to the master id) only on expanded recurring
	// instances produced by expandEvent. It is never persisted.
	RecurringEventID string
	// Event-type fields.
	ItemType   string
	Reminders  []int32
	Status     string
	Visibility string
	TaskDone   bool
	// Recurrence exception fields.
	RecurrenceParentID string // non-empty on exception override rows
	OriginalStart      *time.Time
}

// Attendee is an in-memory representation of a grown.calendar_attendees row.
type Attendee struct {
	EventID        string
	Email          string
	ResponseStatus string
	Optional       bool
	CreatedAt      time.Time
}

// Fields bundles the editable attributes of an event (used by Create/Update).
type Fields struct {
	Title       string
	Description string
	Location    string
	StartAt     time.Time
	EndAt       time.Time
	AllDay      bool
	Color       string
	Recurrence  string
	Attendees   []string
	ItemType    string
	Reminders   []int32
	Status      string
	Visibility  string
	TaskDone    bool
	// Recurrence exception fields.
	RecurrenceParentID string
	OriginalStart      *time.Time
}

// jsonArr marshals a string slice for a JSONB column, never producing NULL.
func jsonArr(s []string) []byte {
	if s == nil {
		s = []string{}
	}
	b, _ := json.Marshal(s)
	return b
}

// jsonArr32 marshals an int32 slice for a JSONB column, never producing NULL.
func jsonArr32(s []int32) []byte {
	if s == nil {
		s = []int32{}
	}
	b, _ := json.Marshal(s)
	return b
}

// Repository reads and writes calendar events.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, title, description, location,
	start_at, end_at, all_day, color, recurrence, attendees, created_at, updated_at,
	item_type, reminders, status, visibility, task_done,
	COALESCE(recurrence_parent_id::text,''), original_start`

func scan(row pgx.Row) (Event, error) {
	var e Event
	var attendees []byte
	var reminders []byte
	err := row.Scan(&e.ID, &e.OrgID, &e.OwnerID, &e.Title, &e.Description, &e.Location,
		&e.StartAt, &e.EndAt, &e.AllDay, &e.Color, &e.Recurrence, &attendees, &e.CreatedAt, &e.UpdatedAt,
		&e.ItemType, &reminders, &e.Status, &e.Visibility, &e.TaskDone,
		&e.RecurrenceParentID, &e.OriginalStart)
	if err != nil {
		return Event{}, err
	}
	_ = json.Unmarshal(attendees, &e.Attendees)
	_ = json.Unmarshal(reminders, &e.Reminders)
	return e, nil
}

// normalizeItemType returns a valid item_type, defaulting to "event".
func normalizeItemType(s string) string {
	switch s {
	case ItemTypeTask, ItemTypeOutOfOffice, ItemTypeFocusTime:
		return s
	default:
		return ItemTypeEvent
	}
}

// normalizeStatus returns a valid status, defaulting to "busy".
func normalizeStatus(s string) string {
	if s == StatusFree {
		return StatusFree
	}
	return StatusBusy
}

// normalizeVisibility returns a valid visibility, defaulting to "default".
func normalizeVisibility(s string) string {
	switch s {
	case VisibilityPublic, VisibilityPrivate:
		return s
	default:
		return VisibilityDefault
	}
}

// Create inserts a new event.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, f Fields) (Event, error) {
	q := `INSERT INTO grown.calendar_events
		(org_id, owner_id, title, description, location, start_at, end_at, all_day, color, recurrence, attendees,
		 item_type, reminders, status, visibility, task_done, recurrence_parent_id, original_start)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
			NULLIF($17,'')::uuid, $18)
		RETURNING ` + columns
	e, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, f.Title, f.Description, f.Location,
		f.StartAt, f.EndAt, f.AllDay, f.Color, f.Recurrence, jsonArr(f.Attendees),
		normalizeItemType(f.ItemType), jsonArr32(f.Reminders), normalizeStatus(f.Status),
		normalizeVisibility(f.Visibility), f.TaskDone,
		f.RecurrenceParentID, f.OriginalStart))
	if err != nil {
		return Event{}, fmt.Errorf("calendar.Create: %w", err)
	}
	return e, nil
}

// Get returns an event within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Event, error) {
	q := `SELECT ` + columns + ` FROM grown.calendar_events WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	e, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("calendar.Get: %w", err)
	}
	return e, nil
}

// ListOptions holds optional filters for List.
type ListOptions struct {
	// ItemType, if non-empty, restricts results to that item type.
	ItemType string
}

// List returns non-trashed events for orgID that may appear in [min, max].
//
// Single (non-recurring) events are included only when they overlap the window.
// Recurring masters are included whenever they *start* before max (their later
// occurrences may fall inside the window even if the master's own end_at is
// before min); the caller is responsible for expanding them. Also returns
// exception overrides so the caller can suppress/replace the corresponding
// computed occurrence. Ordered by start.
func (r *Repository) List(ctx context.Context, orgID string, min, max time.Time, opts ...ListOptions) ([]Event, error) {
	typeFilter := ""
	if len(opts) > 0 && opts[0].ItemType != "" {
		typeFilter = opts[0].ItemType
	}

	var (
		pgxRows pgx.Rows
		err     error
	)
	if typeFilter != "" {
		pgxRows, err = r.pool.Query(ctx, `SELECT `+columns+` FROM grown.calendar_events
			WHERE org_id=$1 AND trashed_at IS NULL
			  AND (
			    -- recurring masters: may have occurrences in the window
			    (recurrence <> '' AND recurrence_parent_id IS NULL AND start_at < $3)
			    -- exception overrides that land in the window
			    OR (recurrence_parent_id IS NOT NULL AND start_at < $3 AND end_at > $2)
			    -- regular single events that overlap the window
			    OR (recurrence = '' AND recurrence_parent_id IS NULL AND start_at < $3 AND end_at > $2)
			  )
			  AND item_type = $4
			ORDER BY start_at`, orgID, min, max, typeFilter)
	} else {
		pgxRows, err = r.pool.Query(ctx, `SELECT `+columns+` FROM grown.calendar_events
			WHERE org_id=$1 AND trashed_at IS NULL
			  AND (
			    -- recurring masters: may have occurrences in the window
			    (recurrence <> '' AND recurrence_parent_id IS NULL AND start_at < $3)
			    -- exception overrides that land in the window
			    OR (recurrence_parent_id IS NOT NULL AND start_at < $3 AND end_at > $2)
			    -- regular single events that overlap the window
			    OR (recurrence = '' AND recurrence_parent_id IS NULL AND start_at < $3 AND end_at > $2)
			  )
			ORDER BY start_at`, orgID, min, max)
	}
	if err != nil {
		return nil, fmt.Errorf("calendar.List: %w", err)
	}
	defer pgxRows.Close()
	var out []Event
	for pgxRows.Next() {
		e, err := scan(pgxRows)
		if err != nil {
			return nil, fmt.Errorf("calendar.List scan: %w", err)
		}
		out = append(out, e)
	}
	return out, pgxRows.Err()
}

// Update replaces the editable fields of an event within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f Fields) (Event, error) {
	q := `UPDATE grown.calendar_events SET
		title=$3, description=$4, location=$5, start_at=$6, end_at=$7, all_day=$8, color=$9, recurrence=$10, attendees=$11,
		item_type=$12, reminders=$13, status=$14, visibility=$15, task_done=$16, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	e, err := scan(r.pool.QueryRow(ctx, q, id, orgID, f.Title, f.Description, f.Location,
		f.StartAt, f.EndAt, f.AllDay, f.Color, f.Recurrence, jsonArr(f.Attendees),
		normalizeItemType(f.ItemType), jsonArr32(f.Reminders), normalizeStatus(f.Status),
		normalizeVisibility(f.Visibility), f.TaskDone))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("calendar.Update: %w", err)
	}
	return e, nil
}

// Delete soft-deletes an event within orgID.
func (r *Repository) Delete(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.calendar_events SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("calendar.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetExceptionForOccurrence returns the exception override row (if any) for
// the given master + originalStart combination within the org.
func (r *Repository) GetExceptionForOccurrence(ctx context.Context, orgID, masterID string, originalStart time.Time) (Event, bool, error) {
	q := `SELECT ` + columns + ` FROM grown.calendar_events
		WHERE org_id=$1 AND recurrence_parent_id=$2 AND original_start=$3 AND trashed_at IS NULL
		LIMIT 1`
	e, err := scan(r.pool.QueryRow(ctx, q, orgID, masterID, originalStart))
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, false, nil
	}
	if err != nil {
		return Event{}, false, fmt.Errorf("calendar.GetException: %w", err)
	}
	return e, true, nil
}

// DeleteExceptionForOccurrence soft-deletes the exception (tombstone for a
// single occurrence) so the occurrence is suppressed during list expansion.
func (r *Repository) DeleteExceptionForOccurrence(ctx context.Context, orgID, masterID string, originalStart time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.calendar_events SET trashed_at=now(), updated_at=now()
		 WHERE org_id=$1 AND recurrence_parent_id=$2 AND original_start=$3 AND trashed_at IS NULL`,
		orgID, masterID, originalStart)
	if err != nil {
		return fmt.Errorf("calendar.DeleteException: %w", err)
	}
	return nil
}

// ListExceptions returns all live exception overrides for the given master event.
func (r *Repository) ListExceptions(ctx context.Context, orgID, masterID string) ([]Event, error) {
	q := `SELECT ` + columns + ` FROM grown.calendar_events
		WHERE org_id=$1 AND recurrence_parent_id=$2 AND trashed_at IS NULL
		ORDER BY original_start`
	rows, err := r.pool.Query(ctx, q, orgID, masterID)
	if err != nil {
		return nil, fmt.Errorf("calendar.ListExceptions: %w", err)
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		e, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("calendar.ListExceptions scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---- Attendee repository methods ----

const attendeeCols = `event_id::text, email, response_status, optional, created_at`

func scanAttendee(row pgx.Row) (Attendee, error) {
	var a Attendee
	err := row.Scan(&a.EventID, &a.Email, &a.ResponseStatus, &a.Optional, &a.CreatedAt)
	if err != nil {
		return Attendee{}, err
	}
	return a, nil
}

// AddAttendee inserts or updates an attendee on an event. If the attendee
// already exists the optional flag is updated but the response_status is left
// unchanged.
func (r *Repository) AddAttendee(ctx context.Context, orgID, eventID, email string, optional bool) (Attendee, error) {
	q := `INSERT INTO grown.calendar_attendees (event_id, org_id, email, optional)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (event_id, email) DO UPDATE SET optional=EXCLUDED.optional
		RETURNING ` + attendeeCols
	a, err := scanAttendee(r.pool.QueryRow(ctx, q, eventID, orgID, email, optional))
	if err != nil {
		return Attendee{}, fmt.Errorf("calendar.AddAttendee: %w", err)
	}
	return a, nil
}

// ListAttendees returns all attendees for an event.
func (r *Repository) ListAttendees(ctx context.Context, eventID string) ([]Attendee, error) {
	q := `SELECT ` + attendeeCols + ` FROM grown.calendar_attendees
		WHERE event_id=$1 ORDER BY created_at`
	rows, err := r.pool.Query(ctx, q, eventID)
	if err != nil {
		return nil, fmt.Errorf("calendar.ListAttendees: %w", err)
	}
	defer rows.Close()
	var out []Attendee
	for rows.Next() {
		a, err := scanAttendee(rows)
		if err != nil {
			return nil, fmt.Errorf("calendar.ListAttendees scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// RemoveAttendee deletes an attendee from an event (organizer-only operation;
// auth check is in the service layer).
func (r *Repository) RemoveAttendee(ctx context.Context, eventID, email string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.calendar_attendees WHERE event_id=$1 AND email=$2`, eventID, email)
	if err != nil {
		return fmt.Errorf("calendar.RemoveAttendee: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetRSVP updates the response_status for an existing attendee.
func (r *Repository) SetRSVP(ctx context.Context, eventID, email, status string) (Attendee, error) {
	q := `UPDATE grown.calendar_attendees SET response_status=$3
		WHERE event_id=$1 AND email=$2
		RETURNING ` + attendeeCols
	a, err := scanAttendee(r.pool.QueryRow(ctx, q, eventID, email, status))
	if errors.Is(err, pgx.ErrNoRows) {
		return Attendee{}, ErrNotFound
	}
	if err != nil {
		return Attendee{}, fmt.Errorf("calendar.SetRSVP: %w", err)
	}
	return a, nil
}
