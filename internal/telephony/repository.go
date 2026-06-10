// Package telephony is the data-access + service layer for the internal
// WebRTC softphone: per-user extensions, an org member directory, and call
// history. Live signaling runs over a separate in-memory Hub.
package telephony

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no matching row exists (within the org).
var ErrNotFound = errors.New("telephony record not found")

// baseExtension is the lowest extension number assigned to org members.
const baseExtension = 1001

// maxExtensionRetries bounds the optimistic retry loop in EnsureExtension when
// concurrent callers race to claim the same free extension.
const maxExtensionRetries = 10

// Extension is the in-memory representation of a grown.telephony_extensions row.
type Extension struct {
	OrgID     string
	UserID    string
	Extension int
	CreatedAt time.Time
}

// Member is one org member enriched with their extension (extension is 0 when
// the member has not yet been provisioned).
type Member struct {
	UserID      string
	DisplayName string
	Email       string
	Extension   int
}

// Call is the in-memory representation of a grown.telephony_calls row.
type Call struct {
	ID        string
	OrgID     string
	CallerID  string
	CalleeID  string
	Status    string
	StartedAt time.Time
	EndedAt   *time.Time
}

// Repository reads and writes telephony extensions and call history.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// GetExtension returns the extension for (orgID, userID), or ErrNotFound.
func (r *Repository) GetExtension(ctx context.Context, orgID, userID string) (Extension, error) {
	q := `SELECT org_id::text, user_id::text, extension, created_at
		FROM grown.telephony_extensions WHERE org_id=$1 AND user_id=$2`
	var e Extension
	err := r.pool.QueryRow(ctx, q, orgID, userID).Scan(&e.OrgID, &e.UserID, &e.Extension, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Extension{}, ErrNotFound
	}
	if err != nil {
		return Extension{}, fmt.Errorf("telephony.GetExtension: %w", err)
	}
	return e, nil
}

// EnsureExtension returns the caller's extension, provisioning one on first
// access. The newly assigned extension is the lowest free value >= baseExtension
// within the org (equivalently MAX+1 when the range is contiguous). Concurrent
// callers retry on a unique-constraint collision.
func (r *Repository) EnsureExtension(ctx context.Context, orgID, userID string) (Extension, error) {
	// Fast path: already provisioned.
	if e, err := r.GetExtension(ctx, orgID, userID); err == nil {
		return e, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Extension{}, err
	}

	for range maxExtensionRetries {
		ext, err := r.nextFreeExtension(ctx, orgID)
		if err != nil {
			return Extension{}, err
		}
		q := `INSERT INTO grown.telephony_extensions (org_id, user_id, extension)
			VALUES ($1,$2,$3)
			RETURNING org_id::text, user_id::text, extension, created_at`
		var e Extension
		err = r.pool.QueryRow(ctx, q, orgID, userID, ext).Scan(&e.OrgID, &e.UserID, &e.Extension, &e.CreatedAt)
		if err == nil {
			return e, nil
		}
		// On a unique collision either the user was provisioned concurrently
		// (re-read) or another user grabbed the extension (retry).
		if isUniqueViolation(err) {
			if e, gErr := r.GetExtension(ctx, orgID, userID); gErr == nil {
				return e, nil
			}
			continue
		}
		return Extension{}, fmt.Errorf("telephony.EnsureExtension: %w", err)
	}
	return Extension{}, fmt.Errorf("telephony.EnsureExtension: exhausted %d retries", maxExtensionRetries)
}

// nextFreeExtension returns the lowest unused extension >= baseExtension in orgID.
func (r *Repository) nextFreeExtension(ctx context.Context, orgID string) (int, error) {
	// gs is the candidate range [baseExtension, MAX+1]; the first value not
	// present in the extensions table is the lowest free slot.
	q := `SELECT gs FROM generate_series($2::int, COALESCE(
			(SELECT MAX(extension) FROM grown.telephony_extensions WHERE org_id=$1), $2::int - 1) + 1) AS gs
		WHERE NOT EXISTS (
			SELECT 1 FROM grown.telephony_extensions
			WHERE org_id=$1 AND extension=gs)
		ORDER BY gs LIMIT 1`
	var ext int
	err := r.pool.QueryRow(ctx, q, orgID, baseExtension).Scan(&ext)
	if err != nil {
		return 0, fmt.Errorf("telephony.nextFreeExtension: %w", err)
	}
	return ext, nil
}

// ListMembers returns all org members joined with their extension, ordered by
// display name. Members without an extension yet have Extension == 0.
func (r *Repository) ListMembers(ctx context.Context, orgID string) ([]Member, error) {
	q := `SELECT u.id::text, u.display_name, u.email, COALESCE(e.extension, 0)
		FROM grown.users u
		LEFT JOIN grown.telephony_extensions e
		  ON e.org_id = u.org_id AND e.user_id = u.id
		WHERE u.org_id = $1
		ORDER BY lower(COALESCE(NULLIF(u.display_name,''), u.email))`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("telephony.ListMembers: %w", err)
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.UserID, &m.DisplayName, &m.Email, &m.Extension); err != nil {
			return nil, fmt.Errorf("telephony.ListMembers scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// LogCall inserts a completed/missed/rejected call record and returns it.
func (r *Repository) LogCall(ctx context.Context, orgID, callerID, calleeID, status string, startedAt time.Time, endedAt *time.Time) (Call, error) {
	q := `INSERT INTO grown.telephony_calls (org_id, caller_id, callee_id, status, started_at, ended_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id::text, org_id::text, caller_id::text, callee_id::text, status, started_at, ended_at`
	var c Call
	err := r.pool.QueryRow(ctx, q, orgID, callerID, calleeID, status, startedAt, endedAt).
		Scan(&c.ID, &c.OrgID, &c.CallerID, &c.CalleeID, &c.Status, &c.StartedAt, &c.EndedAt)
	if err != nil {
		return Call{}, fmt.Errorf("telephony.LogCall: %w", err)
	}
	return c, nil
}

// ListCalls returns calls within orgID where userID is either caller or callee,
// most recent first.
func (r *Repository) ListCalls(ctx context.Context, orgID, userID string) ([]Call, error) {
	q := `SELECT id::text, org_id::text, caller_id::text, callee_id::text, status, started_at, ended_at
		FROM grown.telephony_calls
		WHERE org_id=$1 AND (caller_id=$2 OR callee_id=$2)
		ORDER BY started_at DESC LIMIT 200`
	rows, err := r.pool.Query(ctx, q, orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("telephony.ListCalls: %w", err)
	}
	defer rows.Close()
	var out []Call
	for rows.Next() {
		var c Call
		if err := rows.Scan(&c.ID, &c.OrgID, &c.CallerID, &c.CalleeID, &c.Status, &c.StartedAt, &c.EndedAt); err != nil {
			return nil, fmt.Errorf("telephony.ListCalls scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505).
func isUniqueViolation(err error) bool {
	type pgErr interface{ SQLState() string }
	var pe pgErr
	if errors.As(err, &pe) {
		return pe.SQLState() == "23505"
	}
	return false
}
