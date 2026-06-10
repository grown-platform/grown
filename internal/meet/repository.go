// Package meet is the data-access + service layer for video-call rooms.
package meet

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no room matches the given id (within the org).
var ErrNotFound = errors.New("meet room not found")

// ErrInvalidCode is returned when a syntactically invalid code is supplied.
var ErrInvalidCode = errors.New("invalid meeting code format")

// Room is the in-memory representation of a grown.meet_rooms row.
type Room struct {
	ID        string
	OrgID     string
	OwnerID   string
	Name      string
	Code      string
	CreatedAt time.Time
}

// Repository reads and writes meet rooms.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, name, COALESCE(code,''), created_at`

func scan(row pgx.Row) (Room, error) {
	var r Room
	err := row.Scan(&r.ID, &r.OrgID, &r.OwnerID, &r.Name, &r.Code, &r.CreatedAt)
	if err != nil {
		return Room{}, err
	}
	return r, nil
}

// maxCodeRetries is the number of times Create will retry on a code collision.
const maxCodeRetries = 10

// Create inserts a new room, generating a unique short code with collision retry.
func (r *Repository) Create(ctx context.Context, orgID, ownerID, name string) (Room, error) {
	if name == "" {
		name = "Untitled meeting"
	}
	q := `INSERT INTO grown.meet_rooms (org_id, owner_id, name, code)
		VALUES ($1,$2,$3,$4)
		RETURNING ` + columns
	for range maxCodeRetries {
		code, err := GenerateCode()
		if err != nil {
			return Room{}, fmt.Errorf("meet.Create generate code: %w", err)
		}
		room, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, name, code))
		if err == nil {
			return room, nil
		}
		// Retry only on unique-constraint violations (code collision).
		if isUniqueViolation(err) {
			continue
		}
		return Room{}, fmt.Errorf("meet.Create: %w", err)
	}
	return Room{}, fmt.Errorf("meet.Create: exhausted %d code generation retries", maxCodeRetries)
}

// Get returns a room within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Room, error) {
	q := `SELECT ` + columns + ` FROM grown.meet_rooms WHERE id=$1 AND org_id=$2`
	room, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Room{}, ErrNotFound
	}
	if err != nil {
		return Room{}, fmt.Errorf("meet.Get: %w", err)
	}
	return room, nil
}

// GetByCode returns the room with the given code within orgID, or ErrNotFound.
// orgID scopes the lookup so codes from another org are invisible.
func (r *Repository) GetByCode(ctx context.Context, orgID, code string) (Room, error) {
	if !ValidCode(code) {
		return Room{}, ErrInvalidCode
	}
	q := `SELECT ` + columns + ` FROM grown.meet_rooms WHERE code=$1 AND org_id=$2`
	room, err := scan(r.pool.QueryRow(ctx, q, code, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Room{}, ErrNotFound
	}
	if err != nil {
		return Room{}, fmt.Errorf("meet.GetByCode: %w", err)
	}
	return room, nil
}

// List returns all rooms in orgID, ordered by created_at descending.
func (r *Repository) List(ctx context.Context, orgID string) ([]Room, error) {
	q := `SELECT ` + columns + ` FROM grown.meet_rooms WHERE org_id=$1 ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("meet.List: %w", err)
	}
	defer rows.Close()
	var out []Room
	for rows.Next() {
		room, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("meet.List scan: %w", err)
		}
		out = append(out, room)
	}
	return out, rows.Err()
}

// Delete permanently removes a room within orgID.
func (r *Repository) Delete(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.meet_rooms WHERE id=$1 AND org_id=$2`, id, orgID)
	if err != nil {
		return fmt.Errorf("meet.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	// pgx wraps the pgconn.PgError; check the SQLState directly.
	type pgErr interface{ SQLState() string }
	var pe pgErr
	if errors.As(err, &pe) {
		return pe.SQLState() == "23505"
	}
	return false
}
