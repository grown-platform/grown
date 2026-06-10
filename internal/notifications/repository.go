// Package notifications is the data-access + service layer for the per-user
// in-app notification feed (grown.notifications).
package notifications

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no notification matches the given id for the user.
var ErrNotFound = errors.New("notification not found")

// Notification is the in-memory representation of a grown.notifications row.
type Notification struct {
	ID          string
	OrgID       string
	UserID      string
	Type        string
	ActorUserID string // empty when actor_user_id IS NULL
	Title       string
	Body        string
	TargetURL   string
	Read        bool
	CreatedAt   time.Time
}

// CreateParams bundles the fields required to insert a new notification.
// OrgID + UserID are mandatory; ActorUserID may be "".
type CreateParams struct {
	OrgID       string
	UserID      string
	Type        string
	ActorUserID string
	Title       string
	Body        string
	TargetURL   string
}

// Repository reads and writes notifications.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const cols = `id::text, org_id::text, user_id::text, type,
	COALESCE(actor_user_id::text, ''), title, body, target_url, read, created_at`

func scan(row pgx.Row) (Notification, error) {
	var n Notification
	err := row.Scan(&n.ID, &n.OrgID, &n.UserID, &n.Type,
		&n.ActorUserID, &n.Title, &n.Body, &n.TargetURL, &n.Read, &n.CreatedAt)
	return n, err
}

// Create inserts a new notification and returns it.
func (r *Repository) Create(ctx context.Context, p CreateParams) (Notification, error) {
	var actor any
	if p.ActorUserID != "" {
		actor = p.ActorUserID
	}
	row := r.pool.QueryRow(ctx,
		`INSERT INTO grown.notifications
		 (org_id, user_id, type, actor_user_id, title, body, target_url)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)
		 RETURNING `+cols,
		p.OrgID, p.UserID, p.Type, actor, p.Title, p.Body, p.TargetURL,
	)
	n, err := scan(row)
	if err != nil {
		return Notification{}, fmt.Errorf("notifications.Create: %w", err)
	}
	return n, nil
}

// List returns the caller's notifications (orgID+userID scoped), newest first,
// with optional cursor-based pagination via beforeTime + limit.
// Pass zero Time and 0 limit for the first page with the default limit (50).
func (r *Repository) List(ctx context.Context, orgID, userID string, beforeTime time.Time, limit int) ([]Notification, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if beforeTime.IsZero() {
		rows, err = r.pool.Query(ctx,
			`SELECT `+cols+` FROM grown.notifications
			 WHERE org_id=$1 AND user_id=$2
			 ORDER BY created_at DESC LIMIT $3`,
			orgID, userID, limit,
		)
	} else {
		rows, err = r.pool.Query(ctx,
			`SELECT `+cols+` FROM grown.notifications
			 WHERE org_id=$1 AND user_id=$2 AND created_at < $3
			 ORDER BY created_at DESC LIMIT $4`,
			orgID, userID, beforeTime, limit,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("notifications.List: %w", err)
	}
	defer rows.Close()
	var out []Notification
	for rows.Next() {
		n, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("notifications.List scan: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// UnreadCount returns the number of unread notifications for the user.
func (r *Repository) UnreadCount(ctx context.Context, orgID, userID string) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM grown.notifications WHERE org_id=$1 AND user_id=$2 AND read=false`,
		orgID, userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("notifications.UnreadCount: %w", err)
	}
	return count, nil
}

// MarkRead marks a single notification as read for the user. Returns ErrNotFound
// if the notification does not exist or belongs to a different user.
func (r *Repository) MarkRead(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.notifications SET read=true
		 WHERE id=$1 AND org_id=$2 AND user_id=$3`,
		id, orgID, userID,
	)
	if err != nil {
		return fmt.Errorf("notifications.MarkRead: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkAllRead marks every unread notification for the user as read.
func (r *Repository) MarkAllRead(ctx context.Context, orgID, userID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE grown.notifications SET read=true
		 WHERE org_id=$1 AND user_id=$2 AND read=false`,
		orgID, userID,
	)
	if err != nil {
		return fmt.Errorf("notifications.MarkAllRead: %w", err)
	}
	return nil
}

// Delete removes a notification permanently for the user. Returns ErrNotFound
// if it does not exist or belongs to a different user.
func (r *Repository) Delete(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.notifications WHERE id=$1 AND org_id=$2 AND user_id=$3`,
		id, orgID, userID,
	)
	if err != nil {
		return fmt.Errorf("notifications.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
