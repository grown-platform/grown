// Package eventmeet links calendar events to Meet rooms (video meetings)
// without modifying the protobuf-defined calendar Event. It is a thin,
// pure-HTTP + SQL layer: one meeting per event, stored in grown.event_meet.
package eventmeet

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when an event has no attached meeting.
var ErrNotFound = errors.New("event has no meeting")

// ErrEventNotFound is returned when the event does not exist in the caller's org.
var ErrEventNotFound = errors.New("event not found")

// Link is the meeting attached to an event.
type Link struct {
	RoomID string
	Code   string
}

// JoinInfo describes who to notify when the first participant joins a room.
type JoinInfo struct {
	OrgID         string
	EventTitle    string
	Code          string
	TargetUserIDs []string // event owner + attendees who are org users
}

// Repository is the data-access layer over grown.event_meet.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Get returns the meeting attached to an event, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, eventID string) (Link, error) {
	var l Link
	err := r.pool.QueryRow(ctx,
		`SELECT room_id::text, code FROM grown.event_meet WHERE event_id=$1 AND org_id=$2`,
		eventID, orgID).Scan(&l.RoomID, &l.Code)
	if errors.Is(err, pgx.ErrNoRows) {
		return Link{}, ErrNotFound
	}
	if err != nil {
		return Link{}, fmt.Errorf("eventmeet.Get: %w", err)
	}
	return l, nil
}

// Set attaches (or replaces) the meeting for an event. The event must belong to
// the caller's org.
func (r *Repository) Set(ctx context.Context, orgID, eventID, roomID, code string) error {
	// Verify the event exists in this org before linking.
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.calendar_events WHERE id=$1 AND org_id=$2)`,
		eventID, orgID).Scan(&exists); err != nil {
		return fmt.Errorf("eventmeet.Set verify: %w", err)
	}
	if !exists {
		return ErrEventNotFound
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.event_meet (event_id, org_id, room_id, code)
		 VALUES ($1,$2,$3,$4)
		 ON CONFLICT (event_id)
		 DO UPDATE SET room_id=EXCLUDED.room_id, code=EXCLUDED.code, created_at=now()`,
		eventID, orgID, roomID, code)
	if err != nil {
		return fmt.Errorf("eventmeet.Set: %w", err)
	}
	return nil
}

// Delete removes the meeting attached to an event.
func (r *Repository) Delete(ctx context.Context, orgID, eventID string) error {
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.event_meet WHERE event_id=$1 AND org_id=$2`, eventID, orgID)
	if err != nil {
		return fmt.Errorf("eventmeet.Delete: %w", err)
	}
	return nil
}

// JoinNotify resolves, for a given meet room, the event it belongs to and the
// set of org users to notify when someone joins (the event owner plus any
// attendees who are users in the org). Returns ErrNotFound when the room is not
// attached to any event.
func (r *Repository) JoinNotify(ctx context.Context, roomID string) (JoinInfo, error) {
	var info JoinInfo
	var eventID, ownerID string
	err := r.pool.QueryRow(ctx,
		`SELECT em.event_id::text, em.org_id::text, em.code, ce.title, ce.owner_id::text
		   FROM grown.event_meet em
		   JOIN grown.calendar_events ce ON ce.id = em.event_id
		  WHERE em.room_id = $1`, roomID).
		Scan(&eventID, &info.OrgID, &info.Code, &info.EventTitle, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return JoinInfo{}, ErrNotFound
	}
	if err != nil {
		return JoinInfo{}, fmt.Errorf("eventmeet.JoinNotify event: %w", err)
	}

	seen := map[string]bool{}
	add := func(id string) {
		if id != "" && !seen[id] {
			seen[id] = true
			info.TargetUserIDs = append(info.TargetUserIDs, id)
		}
	}
	add(ownerID)

	// Map attendee emails to org users (best-effort; non-user invitees are skipped).
	rows, err := r.pool.Query(ctx,
		`SELECT u.id::text
		   FROM grown.calendar_attendees a
		   JOIN grown.users u
		     ON u.org_id = $1 AND lower(u.email) = lower(a.email)
		  WHERE a.event_id = $2`, info.OrgID, eventID)
	if err != nil {
		return JoinInfo{}, fmt.Errorf("eventmeet.JoinNotify attendees: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return JoinInfo{}, fmt.Errorf("eventmeet.JoinNotify scan: %w", err)
		}
		add(id)
	}
	return info, rows.Err()
}
