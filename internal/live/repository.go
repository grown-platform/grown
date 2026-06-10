// Package live is the data-access + service + webhook layer for multi-user live
// streaming. The media bytes flow through MediaMTX (the media server); this
// package owns the per-org stream metadata, authorizes MediaMTX publish/read
// over an HTTP webhook, and tracks live/offline transitions via the MediaMTX
// runOnReady/runOnNotReady hooks (see webhooks.go).
package live

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no stream matches the given id/path (within the
// caller's scope).
var ErrNotFound = errors.New("live stream not found")

// Visibility values.
const (
	VisibilityOrg    = "org"
	VisibilityPublic = "public"
)

// Status values.
const (
	StatusOffline = "offline"
	StatusLive    = "live"
)

// Stream is the in-memory representation of a grown.live_streams row. OwnerName
// is denormalized from grown.users at read time (best-effort; may be empty).
type Stream struct {
	ID          string
	OrgID       string
	OwnerID     string
	OwnerName   string
	Title       string
	Description string
	StreamKey   string
	Path        string
	Status      string
	Visibility  string
	StartedAt   *time.Time
	EndedAt     *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Fields bundles the editable metadata of a stream (used by Update).
type Fields struct {
	Title       string
	Description string
	Visibility  string
}

// Repository reads and writes live streams.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// columns selects the live_streams row plus the joined owner display name.
const columns = `s.id::text, s.org_id::text, s.owner_id::text,
	COALESCE(u.display_name, '') AS owner_name,
	s.title, s.description, s.stream_key, s.path, s.status, s.visibility,
	s.started_at, s.ended_at, s.created_at, s.updated_at`

const fromJoin = `FROM grown.live_streams s
	LEFT JOIN grown.users u ON u.id = s.owner_id`

func scan(row pgx.Row) (Stream, error) {
	var s Stream
	err := row.Scan(&s.ID, &s.OrgID, &s.OwnerID, &s.OwnerName,
		&s.Title, &s.Description, &s.StreamKey, &s.Path, &s.Status, &s.Visibility,
		&s.StartedAt, &s.EndedAt, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return Stream{}, err
	}
	return s, nil
}

// randKey returns a 32-hex-char (128-bit) secret used as the publish password.
func randKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateParams are the attributes set when a stream is created.
type CreateParams struct {
	Title       string
	Description string
	Visibility  string
}

// Create inserts a new stream owned by ownerID in orgID. The path is set to the
// generated stream id (done in a single statement via the RETURNING id trick is
// not possible for a self-reference, so we generate the key here and set path =
// id::text after insert in one round-trip using a CTE).
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, p CreateParams) (Stream, error) {
	vis := p.Visibility
	if vis != VisibilityPublic {
		vis = VisibilityOrg
	}
	key := randKey()
	// Insert with a placeholder path, then set path = id::text. A CTE keeps it
	// to one round-trip; the outer SELECT re-joins users for owner_name.
	q := `WITH ins AS (
			INSERT INTO grown.live_streams (org_id, owner_id, title, description, stream_key, path, visibility)
			VALUES ($1, $2, $3, $4, $5, gen_random_uuid()::text, $6)
			RETURNING id
		), upd AS (
			UPDATE grown.live_streams s SET path = s.id::text
			FROM ins WHERE s.id = ins.id
			RETURNING s.id
		)
		SELECT ` + columns + ` ` + fromJoin + `
		WHERE s.id = (SELECT id FROM upd)`
	s, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, p.Title, p.Description, key, vis))
	if err != nil {
		return Stream{}, fmt.Errorf("live.Create: %w", err)
	}
	return s, nil
}

// Get returns a stream by id, regardless of org (the service enforces who may
// see it). Returns ErrNotFound when missing.
func (r *Repository) Get(ctx context.Context, id string) (Stream, error) {
	q := `SELECT ` + columns + ` ` + fromJoin + ` WHERE s.id = $1`
	s, err := scan(r.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Stream{}, ErrNotFound
	}
	if err != nil {
		return Stream{}, fmt.Errorf("live.Get: %w", err)
	}
	return s, nil
}

// GetByPath returns a stream by its MediaMTX path. Used by the auth/ready
// webhooks. Returns ErrNotFound when missing.
func (r *Repository) GetByPath(ctx context.Context, path string) (Stream, error) {
	q := `SELECT ` + columns + ` ` + fromJoin + ` WHERE s.path = $1`
	s, err := scan(r.pool.QueryRow(ctx, q, path))
	if errors.Is(err, pgx.ErrNoRows) {
		return Stream{}, ErrNotFound
	}
	if err != nil {
		return Stream{}, fmt.Errorf("live.GetByPath: %w", err)
	}
	return s, nil
}

// ListFilter selects which streams List returns.
type ListFilter string

const (
	FilterLive ListFilter = "live"
	FilterMine ListFilter = "mine"
	FilterAll  ListFilter = "all"
)

// List returns streams in orgID per the filter, newest first.
//   - FilterMine: only callerID's streams (any status/visibility).
//   - FilterLive: streams with status='live' the caller may watch (org members
//     see org+public; the service is the final arbiter but org scoping is here).
//   - FilterAll:  all streams in the org.
func (r *Repository) List(ctx context.Context, orgID, callerID string, filter ListFilter) ([]Stream, error) {
	base := `SELECT ` + columns + ` ` + fromJoin + ` WHERE s.org_id = $1`
	args := []any{orgID}
	switch filter {
	case FilterMine:
		base += ` AND s.owner_id = $2`
		args = append(args, callerID)
	case FilterLive:
		base += ` AND s.status = '` + StatusLive + `'`
	default: // FilterAll
	}
	base += ` ORDER BY s.created_at DESC`
	rows, err := r.pool.Query(ctx, base, args...)
	if err != nil {
		return nil, fmt.Errorf("live.List: %w", err)
	}
	defer rows.Close()
	var out []Stream
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("live.List scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("live.List rows: %w", err)
	}
	return out, nil
}

// Update changes editable metadata, scoped to (orgID, ownerID). Returns
// ErrNotFound when no such owned stream exists.
func (r *Repository) Update(ctx context.Context, orgID, ownerID, id string, f Fields) (Stream, error) {
	vis := f.Visibility
	if vis != VisibilityPublic && vis != VisibilityOrg {
		// Keep the existing value when the caller sent an empty/invalid one.
		vis = ""
	}
	q := `WITH upd AS (
			UPDATE grown.live_streams s SET
				title = $4,
				description = $5,
				visibility = CASE WHEN $6 = '' THEN s.visibility ELSE $6 END,
				updated_at = now()
			WHERE s.id = $1 AND s.org_id = $2 AND s.owner_id = $3
			RETURNING s.id
		)
		SELECT ` + columns + ` ` + fromJoin + ` WHERE s.id = (SELECT id FROM upd)`
	s, err := scan(r.pool.QueryRow(ctx, q, id, orgID, ownerID, f.Title, f.Description, vis))
	if errors.Is(err, pgx.ErrNoRows) {
		return Stream{}, ErrNotFound
	}
	if err != nil {
		return Stream{}, fmt.Errorf("live.Update: %w", err)
	}
	return s, nil
}

// Delete removes a stream scoped to (orgID, ownerID). Returns ErrNotFound when
// no such owned stream exists.
func (r *Repository) Delete(ctx context.Context, orgID, ownerID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.live_streams WHERE id = $1 AND org_id = $2 AND owner_id = $3`,
		id, orgID, ownerID)
	if err != nil {
		return fmt.Errorf("live.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetStatus flips a stream's status by MediaMTX path and stamps started_at /
// ended_at accordingly. Called by the ready/notready webhooks. live=true sets
// status='live' + started_at=now() (clears ended_at); live=false sets
// status='offline' + ended_at=now(). Returns ErrNotFound when the path is
// unknown.
func (r *Repository) SetStatus(ctx context.Context, path string, isLive bool) (Stream, error) {
	var q string
	if isLive {
		q = `WITH upd AS (
				UPDATE grown.live_streams s
				SET status = '` + StatusLive + `', started_at = now(), ended_at = NULL, updated_at = now()
				WHERE s.path = $1 RETURNING s.id
			)
			SELECT ` + columns + ` ` + fromJoin + ` WHERE s.id = (SELECT id FROM upd)`
	} else {
		q = `WITH upd AS (
				UPDATE grown.live_streams s
				SET status = '` + StatusOffline + `', ended_at = now(), updated_at = now()
				WHERE s.path = $1 RETURNING s.id
			)
			SELECT ` + columns + ` ` + fromJoin + ` WHERE s.id = (SELECT id FROM upd)`
	}
	s, err := scan(r.pool.QueryRow(ctx, q, path))
	if errors.Is(err, pgx.ErrNoRows) {
		return Stream{}, ErrNotFound
	}
	if err != nil {
		return Stream{}, fmt.Errorf("live.SetStatus: %w", err)
	}
	return s, nil
}

// EndByOwner marks a stream offline scoped to (orgID, ownerID). Used by the
// owner-initiated EndStream RPC. Returns ErrNotFound when no such owned stream
// exists.
func (r *Repository) EndByOwner(ctx context.Context, orgID, ownerID, id string) (Stream, error) {
	q := `WITH upd AS (
			UPDATE grown.live_streams s
			SET status = '` + StatusOffline + `', ended_at = now(), updated_at = now()
			WHERE s.id = $1 AND s.org_id = $2 AND s.owner_id = $3
			RETURNING s.id
		)
		SELECT ` + columns + ` ` + fromJoin + ` WHERE s.id = (SELECT id FROM upd)`
	s, err := scan(r.pool.QueryRow(ctx, q, id, orgID, ownerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Stream{}, ErrNotFound
	}
	if err != nil {
		return Stream{}, fmt.Errorf("live.EndByOwner: %w", err)
	}
	return s, nil
}
