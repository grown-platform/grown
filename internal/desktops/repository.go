// Package desktops implements on-demand container desktops (Guacamole Phase 2):
// a flavor catalog, thin Kubernetes + Guacamole REST clients, a provisioner that
// launches/stops a desktop per session, an idle reaper, and the HTTP surface.
// Enabled on pick.haus only (GROWN_DESKTOPS_ENABLED); inert otherwise.
package desktops

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a session row doesn't exist (or isn't the
// caller's).
var ErrNotFound = errors.New("desktop session not found")

// Session is one launched (or launching) desktop.
type Session struct {
	ID         string
	OrgID      string
	UserID     string
	Flavor     string // catalog id
	Mode       string // "ephemeral" | "persistent"
	PodName    string
	PVCName    string
	GuacConnID string
	State      string // starting | running | stopped | error
	OpenURL    string
	Detail     string
	CreatedAt  time.Time
	LastSeenAt time.Time
}

// Repository is the desktop_sessions data layer.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over a pgx pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const sessionCols = `id::text, org_id::text, user_id::text, flavor, mode,
	pod_name, pvc_name, guac_conn_id, state, open_url, detail, created_at, last_seen_at`

func scanSession(row pgx.Row) (Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.OrgID, &s.UserID, &s.Flavor, &s.Mode,
		&s.PodName, &s.PVCName, &s.GuacConnID, &s.State, &s.OpenURL, &s.Detail,
		&s.CreatedAt, &s.LastSeenAt)
	return s, err
}

func nz(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// Create inserts a new session and returns it (state defaults to "starting").
func (r *Repository) Create(ctx context.Context, s Session) (Session, error) {
	out, err := scanSession(r.pool.QueryRow(ctx,
		`INSERT INTO grown.desktop_sessions
		   (org_id, user_id, flavor, mode, pod_name, pvc_name, guac_conn_id, state, open_url, detail)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 RETURNING `+sessionCols,
		s.OrgID, s.UserID, s.Flavor, s.Mode, s.PodName, s.PVCName, s.GuacConnID,
		nz(s.State, "starting"), s.OpenURL, s.Detail))
	if err != nil {
		return Session{}, fmt.Errorf("desktops.Create: %w", err)
	}
	return out, nil
}

// GetForUser returns the caller's session by id (ErrNotFound otherwise).
func (r *Repository) GetForUser(ctx context.Context, userID, id string) (Session, error) {
	s, err := scanSession(r.pool.QueryRow(ctx,
		`SELECT `+sessionCols+` FROM grown.desktop_sessions WHERE id=$1 AND user_id=$2`,
		id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("desktops.GetForUser: %w", err)
	}
	return s, nil
}

// Get returns a session by id regardless of owner (used by the reaper).
func (r *Repository) Get(ctx context.Context, id string) (Session, error) {
	s, err := scanSession(r.pool.QueryRow(ctx,
		`SELECT `+sessionCols+` FROM grown.desktop_sessions WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("desktops.Get: %w", err)
	}
	return s, nil
}

// ListByUser returns a user's non-stopped sessions, newest first.
func (r *Repository) ListByUser(ctx context.Context, userID string) ([]Session, error) {
	return r.query(ctx,
		`SELECT `+sessionCols+` FROM grown.desktop_sessions
		  WHERE user_id=$1 AND state <> 'stopped' ORDER BY created_at DESC`, userID)
}

// CountActiveByUser counts a user's live (starting/running) sessions, for the cap.
func (r *Repository) CountActiveByUser(ctx context.Context, userID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.desktop_sessions
		  WHERE user_id=$1 AND state IN ('starting','running')`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("desktops.CountActiveByUser: %w", err)
	}
	return n, nil
}

// SetRunning records the provisioned pod/connection and flips state to running.
func (r *Repository) SetRunning(ctx context.Context, id, podName, pvcName, guacConnID, openURL string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.desktop_sessions
		    SET pod_name=$2, pvc_name=$3, guac_conn_id=$4, open_url=$5,
		        state='running', detail='', last_seen_at=now()
		  WHERE id=$1`, id, podName, pvcName, guacConnID, openURL)
	if err != nil {
		return fmt.Errorf("desktops.SetRunning: %w", err)
	}
	return nil
}

// SetState updates state + detail (e.g. error context, or stopped).
func (r *Repository) SetState(ctx context.Context, id, state, detail string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.desktop_sessions SET state=$2, detail=$3 WHERE id=$1`,
		id, state, detail)
	if err != nil {
		return fmt.Errorf("desktops.SetState: %w", err)
	}
	return nil
}

// Touch refreshes the idle heartbeat so the reaper doesn't kill a watched session.
func (r *Repository) Touch(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.desktop_sessions SET last_seen_at=now()
		  WHERE id=$1 AND state IN ('starting','running')`, id)
	if err != nil {
		return fmt.Errorf("desktops.Touch: %w", err)
	}
	return nil
}

// ListIdle returns live sessions whose heartbeat is older than cutoff.
func (r *Repository) ListIdle(ctx context.Context, cutoff time.Time) ([]Session, error) {
	return r.query(ctx,
		`SELECT `+sessionCols+` FROM grown.desktop_sessions
		  WHERE state IN ('starting','running') AND last_seen_at < $1`, cutoff)
}

func (r *Repository) query(ctx context.Context, sql string, args ...any) ([]Session, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("desktops.query: %w", err)
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
