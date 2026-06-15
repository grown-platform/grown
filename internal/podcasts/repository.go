// Package podcasts is the data-access + HTTP layer for the Podcasts app: per-user
// subscriptions to RSS podcast feeds (stored) plus a server-side, SSRF-guarded
// feed fetcher/parser (live, not stored — see feed.go). Episodes are never
// persisted; opening a show fetches and parses its feed on demand.
package podcasts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no subscription matches the given id (within the
// caller's org + user).
var ErrNotFound = errors.New("podcast subscription not found")

// Subscription is the in-memory representation of a
// grown.podcast_subscriptions row.
type Subscription struct {
	ID         string    `json:"id"`
	OrgID      string    `json:"org_id"`
	UserID     string    `json:"user_id"`
	FeedURL    string    `json:"feed_url"`
	Title      string    `json:"title"`
	Author     string    `json:"author"`
	ArtworkURL string    `json:"artwork_url"`
	CreatedAt  time.Time `json:"created_at"`
}

// SubscriptionFields bundles the metadata stored when subscribing.
type SubscriptionFields struct {
	FeedURL    string
	Title      string
	Author     string
	ArtworkURL string
}

// Repository reads and writes podcast subscriptions.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const subColumns = `id::text, org_id::text, user_id::text, feed_url,
	title, author, artwork_url, created_at`

func scanSub(row pgx.Row) (Subscription, error) {
	var s Subscription
	err := row.Scan(&s.ID, &s.OrgID, &s.UserID, &s.FeedURL,
		&s.Title, &s.Author, &s.ArtworkURL, &s.CreatedAt)
	if err != nil {
		return Subscription{}, err
	}
	return s, nil
}

// Subscribe records a subscription for the user. Idempotent on
// (user_id, feed_url): re-subscribing refreshes the snapshot metadata
// (title/author/artwork) and returns the existing row.
func (r *Repository) Subscribe(ctx context.Context, orgID, userID string, f SubscriptionFields) (Subscription, error) {
	q := `INSERT INTO grown.podcast_subscriptions (org_id, user_id, feed_url, title, author, artwork_url)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id, feed_url) DO UPDATE SET
			title = EXCLUDED.title,
			author = EXCLUDED.author,
			artwork_url = EXCLUDED.artwork_url
		RETURNING ` + subColumns
	s, err := scanSub(r.pool.QueryRow(ctx, q, orgID, userID, f.FeedURL, f.Title, f.Author, f.ArtworkURL))
	if err != nil {
		return Subscription{}, fmt.Errorf("podcasts.Subscribe: %w", err)
	}
	return s, nil
}

// Unsubscribe deletes a subscription by id, scoped to the caller's org + user
// so one user can't remove another's. Returns ErrNotFound if nothing matched.
func (r *Repository) Unsubscribe(ctx context.Context, orgID, userID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.podcast_subscriptions WHERE id=$1 AND org_id=$2 AND user_id=$3`,
		id, orgID, userID)
	if err != nil {
		return fmt.Errorf("podcasts.Unsubscribe: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListSubscriptions returns the caller's subscriptions, newest first.
func (r *Repository) ListSubscriptions(ctx context.Context, orgID, userID string) ([]Subscription, error) {
	q := `SELECT ` + subColumns + `
		FROM grown.podcast_subscriptions
		WHERE org_id=$1 AND user_id=$2
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID, userID)
	if err != nil {
		return nil, fmt.Errorf("podcasts.ListSubscriptions: %w", err)
	}
	defer rows.Close()
	out := make([]Subscription, 0)
	for rows.Next() {
		s, err := scanSub(rows)
		if err != nil {
			return nil, fmt.Errorf("podcasts.ListSubscriptions scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
