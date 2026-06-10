// Package video is the data-access + service layer for the internal video
// library. Video bytes live in the blob store (shared with Drive); this package
// owns the per-org metadata rows and the raw HTTP upload/stream handlers.
package video

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no video matches the given id (within the org).
var ErrNotFound = errors.New("video not found")

// Video is the in-memory representation of a grown.videos row.
type Video struct {
	ID               string
	OrgID            string
	OwnerID          string
	Title            string
	Description      string
	ContentType      string
	Size             int64
	DurationSeconds  float64
	ThumbnailDataURL string
	BlobKey          string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Fields bundles the editable metadata of a video (used by Update).
type Fields struct {
	Title            string
	Description      string
	ThumbnailDataURL string
}

// Repository reads and writes videos.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const columns = `id::text, org_id::text, owner_id::text, title, description,
	content_type, size, duration_seconds, thumbnail_data_url, blob_key, created_at, updated_at`

func scan(row pgx.Row) (Video, error) {
	var v Video
	err := row.Scan(&v.ID, &v.OrgID, &v.OwnerID, &v.Title, &v.Description,
		&v.ContentType, &v.Size, &v.DurationSeconds, &v.ThumbnailDataURL, &v.BlobKey,
		&v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		return Video{}, err
	}
	return v, nil
}

// CreateParams are the attributes set when a video is first uploaded.
type CreateParams struct {
	Title            string
	Description      string
	ContentType      string
	Size             int64
	DurationSeconds  float64
	ThumbnailDataURL string
	BlobKey          string
}

// Create inserts a new video metadata row.
func (r *Repository) Create(ctx context.Context, orgID, ownerID string, p CreateParams) (Video, error) {
	q := `INSERT INTO grown.videos
		(org_id, owner_id, title, description, content_type, size, duration_seconds, thumbnail_data_url, blob_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING ` + columns
	v, err := scan(r.pool.QueryRow(ctx, q, orgID, ownerID, p.Title, p.Description,
		p.ContentType, p.Size, p.DurationSeconds, p.ThumbnailDataURL, p.BlobKey))
	if err != nil {
		return Video{}, fmt.Errorf("video.Create: %w", err)
	}
	return v, nil
}

// Get returns a video within orgID, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, orgID, id string) (Video, error) {
	q := `SELECT ` + columns + ` FROM grown.videos WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	v, err := scan(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Video{}, ErrNotFound
	}
	if err != nil {
		return Video{}, fmt.Errorf("video.Get: %w", err)
	}
	return v, nil
}

// List returns all non-trashed videos in orgID, newest first.
func (r *Repository) List(ctx context.Context, orgID string) ([]Video, error) {
	q := `SELECT ` + columns + ` FROM grown.videos
		WHERE org_id=$1 AND trashed_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("video.List: %w", err)
	}
	defer rows.Close()
	var out []Video
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("video.List scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Update replaces the editable metadata of a video within orgID.
func (r *Repository) Update(ctx context.Context, orgID, id string, f Fields) (Video, error) {
	q := `UPDATE grown.videos SET
		title=$3, description=$4, thumbnail_data_url=$5, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + columns
	v, err := scan(r.pool.QueryRow(ctx, q, id, orgID, f.Title, f.Description, f.ThumbnailDataURL))
	if errors.Is(err, pgx.ErrNoRows) {
		return Video{}, ErrNotFound
	}
	if err != nil {
		return Video{}, fmt.Errorf("video.Update: %w", err)
	}
	return v, nil
}

// GetByID returns a non-trashed video by its id regardless of org. Used for
// shared-with access checks (the org is resolved from the share link/row).
func (r *Repository) GetByID(ctx context.Context, id string) (Video, error) {
	q := `SELECT ` + columns + ` FROM grown.videos WHERE id=$1 AND trashed_at IS NULL`
	v, err := scan(r.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Video{}, ErrNotFound
	}
	if err != nil {
		return Video{}, fmt.Errorf("video.GetByID: %w", err)
	}
	return v, nil
}

// ListSharedWith returns non-trashed videos that have been individually shared
// with userID (across all orgs).
func (r *Repository) ListSharedWith(ctx context.Context, userID string) ([]Video, error) {
	q := `SELECT ` + columns + `
		FROM grown.videos v
		JOIN grown.video_shares vs ON vs.video_id = v.id
		WHERE vs.shared_with_user_id=$1::uuid AND v.trashed_at IS NULL
		ORDER BY v.created_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("video.ListSharedWith: %w", err)
	}
	defer rows.Close()
	var out []Video
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("video.ListSharedWith scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Trash soft-deletes a video within orgID and returns its blob key so the
// caller can remove the underlying bytes.
func (r *Repository) Trash(ctx context.Context, orgID, id string) (string, error) {
	var blobKey string
	err := r.pool.QueryRow(ctx,
		`UPDATE grown.videos SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		 RETURNING blob_key`, id, orgID).Scan(&blobKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("video.Trash: %w", err)
	}
	return blobKey, nil
}
