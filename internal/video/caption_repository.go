package video

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrCaptionNotFound is returned when no caption matches the given id.
var ErrCaptionNotFound = errors.New("caption not found")

// Caption holds one row from grown.video_captions.
type Caption struct {
	ID        string
	OrgID     string
	VideoID   string
	Lang      string
	Label     string
	BlobKey   string
	CreatedAt time.Time
}

// CaptionRepository reads and writes caption rows.
type CaptionRepository struct {
	pool *pgxpool.Pool
}

// NewCaptionRepository constructs a CaptionRepository.
func NewCaptionRepository(pool *pgxpool.Pool) *CaptionRepository {
	return &CaptionRepository{pool: pool}
}

const captionColumns = `id::text, org_id::text, video_id::text, lang, label, blob_key, created_at`

func scanCaption(row pgx.Row) (Caption, error) {
	var c Caption
	if err := row.Scan(&c.ID, &c.OrgID, &c.VideoID, &c.Lang, &c.Label, &c.BlobKey, &c.CreatedAt); err != nil {
		return Caption{}, err
	}
	return c, nil
}

// CreateCaption inserts a caption row.
func (r *CaptionRepository) CreateCaption(ctx context.Context, orgID, videoID, lang, label, blobKey string) (Caption, error) {
	c, err := scanCaption(r.pool.QueryRow(ctx,
		`INSERT INTO grown.video_captions (org_id, video_id, lang, label, blob_key)
		 VALUES ($1::uuid, $2::uuid, $3, $4, $5)
		 RETURNING `+captionColumns,
		orgID, videoID, lang, label, blobKey))
	if err != nil {
		return Caption{}, fmt.Errorf("caption.Create: %w", err)
	}
	return c, nil
}

// ListCaptions returns all captions for a video (within orgID).
func (r *CaptionRepository) ListCaptions(ctx context.Context, orgID, videoID string) ([]Caption, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+captionColumns+`
		 FROM grown.video_captions
		 WHERE video_id=$1::uuid AND org_id=$2::uuid
		 ORDER BY created_at`, videoID, orgID)
	if err != nil {
		return nil, fmt.Errorf("caption.List: %w", err)
	}
	defer rows.Close()
	var out []Caption
	for rows.Next() {
		c, err := scanCaption(rows)
		if err != nil {
			return nil, fmt.Errorf("caption.List scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetCaption returns a single caption by id within orgID (any video).
func (r *CaptionRepository) GetCaption(ctx context.Context, orgID, id string) (Caption, error) {
	c, err := scanCaption(r.pool.QueryRow(ctx,
		`SELECT `+captionColumns+`
		 FROM grown.video_captions
		 WHERE id=$1::uuid AND org_id=$2::uuid`,
		id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Caption{}, ErrCaptionNotFound
	}
	if err != nil {
		return Caption{}, fmt.Errorf("caption.Get: %w", err)
	}
	return c, nil
}

// DeleteCaption removes a caption row and returns its blob_key for cleanup.
func (r *CaptionRepository) DeleteCaption(ctx context.Context, orgID, videoID, id string) (string, error) {
	var blobKey string
	err := r.pool.QueryRow(ctx,
		`DELETE FROM grown.video_captions WHERE id=$1::uuid AND video_id=$2::uuid AND org_id=$3::uuid
		 RETURNING blob_key`,
		id, videoID, orgID).Scan(&blobKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrCaptionNotFound
	}
	if err != nil {
		return "", fmt.Errorf("caption.Delete: %w", err)
	}
	return blobKey, nil
}
