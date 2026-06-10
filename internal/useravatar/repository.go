// Package useravatar stores per-user avatar blobs (keyed in the shared Drive
// blob store) and provides the HTTP handler for upload / serve / delete.
//
// The pattern mirrors internal/branding: a Postgres table (grown.user_avatars)
// holds the blob key + mime, and the actual bytes live in the S3/rustfs blob
// store. The handler is decoupled from gen/ and internal/auth via injected
// closures, so it builds and tests standalone.
package useravatar

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a user has no avatar row.
var ErrNotFound = errors.New("avatar not found")

// Avatar is the in-memory shape of a grown.user_avatars row.
type Avatar struct {
	UserID   string
	BlobKey  string
	MimeType string
}

// Repository reads and writes user avatar rows.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// Get returns the avatar row for userID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, userID string) (Avatar, error) {
	var a Avatar
	a.UserID = userID
	err := r.pool.QueryRow(ctx,
		`SELECT blob_key, mime_type FROM grown.user_avatars WHERE user_id = $1`,
		userID,
	).Scan(&a.BlobKey, &a.MimeType)
	if errors.Is(err, pgx.ErrNoRows) {
		return Avatar{}, ErrNotFound
	}
	if err != nil {
		return Avatar{}, fmt.Errorf("useravatar.Get: %w", err)
	}
	return a, nil
}

// Set upserts the avatar blob key + mime for userID. An empty key clears the
// avatar (stored as a delete so ErrNotFound is returned on the next Get).
func (r *Repository) Set(ctx context.Context, userID, blobKey, mime string) error {
	if blobKey == "" {
		_, err := r.pool.Exec(ctx,
			`DELETE FROM grown.user_avatars WHERE user_id = $1`,
			userID,
		)
		if err != nil {
			return fmt.Errorf("useravatar.Set(delete): %w", err)
		}
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.user_avatars (user_id, blob_key, mime_type, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id)
		 DO UPDATE SET blob_key = EXCLUDED.blob_key,
		               mime_type = EXCLUDED.mime_type,
		               updated_at = now()`,
		userID, blobKey, mime,
	)
	if err != nil {
		return fmt.Errorf("useravatar.Set: %w", err)
	}
	return nil
}
