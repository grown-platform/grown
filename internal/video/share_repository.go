package video

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

// ErrShareNotFound is returned when no matching share row exists.
var ErrShareNotFound = errors.New("video share not found")

// ShareRepository reads and writes video_shares and video_share_links rows.
type ShareRepository struct {
	pool *pgxpool.Pool
}

// NewShareRepository constructs a ShareRepository.
func NewShareRepository(pool *pgxpool.Pool) *ShareRepository {
	return &ShareRepository{pool: pool}
}

// ---------------------------------------------------------------------------
// User-targeted shares
// ---------------------------------------------------------------------------

// UserShare is a row from grown.video_shares enriched with the user's name and
// email (joined from grown.users).
type UserShare struct {
	VideoID   string
	UserID    string
	UserName  string
	UserEmail string
	CreatedAt time.Time
}

// AddUserShare inserts a share row (video_id, user_id). Idempotent: if the row
// already exists the function returns the existing record without error.
func (r *ShareRepository) AddUserShare(ctx context.Context, videoID, userID string) (UserShare, error) {
	var s UserShare
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.video_shares (video_id, shared_with_user_id)
		 VALUES ($1::uuid, $2::uuid)
		 ON CONFLICT (video_id, shared_with_user_id) DO UPDATE
		   SET video_id = EXCLUDED.video_id  -- no-op; returns existing row
		 RETURNING video_id::text, shared_with_user_id::text, created_at`,
		videoID, userID).Scan(&s.VideoID, &s.UserID, &s.CreatedAt)
	if err != nil {
		return UserShare{}, fmt.Errorf("video.AddUserShare: %w", err)
	}
	// Resolve name + email from grown.users (best-effort; ignore errors).
	_ = r.pool.QueryRow(ctx,
		`SELECT COALESCE(display_name,''), COALESCE(email,'') FROM grown.users WHERE id=$1::uuid`,
		userID).Scan(&s.UserName, &s.UserEmail)
	return s, nil
}

// ListUserShares returns all non-trashed user shares for a video.
func (r *ShareRepository) ListUserShares(ctx context.Context, videoID string) ([]UserShare, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT vs.video_id::text, vs.shared_with_user_id::text,
		        COALESCE(u.display_name,''), COALESCE(u.email,''), vs.created_at
		 FROM grown.video_shares vs
		 LEFT JOIN grown.users u ON u.id = vs.shared_with_user_id
		 WHERE vs.video_id = $1::uuid
		 ORDER BY vs.created_at`, videoID)
	if err != nil {
		return nil, fmt.Errorf("video.ListUserShares: %w", err)
	}
	defer rows.Close()
	var out []UserShare
	for rows.Next() {
		var s UserShare
		if err := rows.Scan(&s.VideoID, &s.UserID, &s.UserName, &s.UserEmail, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("video.ListUserShares scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RemoveUserShare deletes a single share row. Returns ErrShareNotFound if the
// row did not exist.
func (r *ShareRepository) RemoveUserShare(ctx context.Context, videoID, userID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.video_shares WHERE video_id=$1::uuid AND shared_with_user_id=$2::uuid`,
		videoID, userID)
	if err != nil {
		return fmt.Errorf("video.RemoveUserShare: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrShareNotFound
	}
	return nil
}

// IsSharedWithUser reports whether the video has been individually shared with userID.
func (r *ShareRepository) IsSharedWithUser(ctx context.Context, videoID, userID string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.video_shares WHERE video_id=$1::uuid AND shared_with_user_id=$2::uuid)`,
		videoID, userID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("video.IsSharedWithUser: %w", err)
	}
	return exists, nil
}

// ---------------------------------------------------------------------------
// Public share links
// ---------------------------------------------------------------------------

// ShareLink is a row from grown.video_share_links.
type ShareLink struct {
	Token     string
	VideoID   string
	OrgID     string
	CreatedBy string
	ExpiresAt *time.Time
	CreatedAt time.Time
}

func newShareToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// CreateShareLink inserts a new public link and returns it.
func (r *ShareRepository) CreateShareLink(ctx context.Context, videoID, orgID, createdBy string, expiresAt *time.Time) (ShareLink, error) {
	token, err := newShareToken()
	if err != nil {
		return ShareLink{}, fmt.Errorf("video.CreateShareLink token: %w", err)
	}
	var sl ShareLink
	err = r.pool.QueryRow(ctx,
		`INSERT INTO grown.video_share_links (token, video_id, org_id, created_by, expires_at)
		 VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5)
		 RETURNING token, video_id::text, org_id::text, created_by::text, expires_at, created_at`,
		token, videoID, orgID, createdBy, expiresAt).
		Scan(&sl.Token, &sl.VideoID, &sl.OrgID, &sl.CreatedBy, &sl.ExpiresAt, &sl.CreatedAt)
	if err != nil {
		return ShareLink{}, fmt.Errorf("video.CreateShareLink: %w", err)
	}
	return sl, nil
}

// ListShareLinks returns active (non-revoked, non-expired) links for a video.
func (r *ShareRepository) ListShareLinks(ctx context.Context, videoID string) ([]ShareLink, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT token, video_id::text, org_id::text, created_by::text, expires_at, created_at
		 FROM grown.video_share_links
		 WHERE video_id=$1::uuid AND revoked_at IS NULL
		   AND (expires_at IS NULL OR expires_at > now())
		 ORDER BY created_at DESC`, videoID)
	if err != nil {
		return nil, fmt.Errorf("video.ListShareLinks: %w", err)
	}
	defer rows.Close()
	var out []ShareLink
	for rows.Next() {
		var sl ShareLink
		if err := rows.Scan(&sl.Token, &sl.VideoID, &sl.OrgID, &sl.CreatedBy, &sl.ExpiresAt, &sl.CreatedAt); err != nil {
			return nil, fmt.Errorf("video.ListShareLinks scan: %w", err)
		}
		out = append(out, sl)
	}
	return out, rows.Err()
}

// RevokeShareLink marks a link revoked. Returns ErrShareNotFound if no live
// link matched.
func (r *ShareRepository) RevokeShareLink(ctx context.Context, token string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.video_share_links SET revoked_at=now()
		 WHERE token=$1 AND revoked_at IS NULL`, token)
	if err != nil {
		return fmt.Errorf("video.RevokeShareLink: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrShareNotFound
	}
	return nil
}

// GetShareLink resolves a token to its ShareLink + the underlying Video.
// Returns ErrShareNotFound when the token is unknown, revoked, expired, or the
// video has been trashed.
func (r *ShareRepository) GetShareLink(ctx context.Context, token string) (ShareLink, Video, error) {
	var sl ShareLink
	var v Video
	err := r.pool.QueryRow(ctx,
		`SELECT sl.token, sl.video_id::text, sl.org_id::text, sl.created_by::text,
		        sl.expires_at, sl.created_at,
		        v.id::text, v.org_id::text, v.owner_id::text, v.title, v.description,
		        v.content_type, v.size, v.duration_seconds, v.thumbnail_data_url,
		        v.blob_key, v.created_at, v.updated_at
		 FROM grown.video_share_links sl
		 JOIN grown.videos v ON v.id = sl.video_id AND v.trashed_at IS NULL
		 WHERE sl.token=$1 AND sl.revoked_at IS NULL
		   AND (sl.expires_at IS NULL OR sl.expires_at > now())`, token).
		Scan(
			&sl.Token, &sl.VideoID, &sl.OrgID, &sl.CreatedBy, &sl.ExpiresAt, &sl.CreatedAt,
			&v.ID, &v.OrgID, &v.OwnerID, &v.Title, &v.Description,
			&v.ContentType, &v.Size, &v.DurationSeconds, &v.ThumbnailDataURL,
			&v.BlobKey, &v.CreatedAt, &v.UpdatedAt,
		)
	if errors.Is(err, pgx.ErrNoRows) {
		return ShareLink{}, Video{}, ErrShareNotFound
	}
	if err != nil {
		return ShareLink{}, Video{}, fmt.Errorf("video.GetShareLink: %w", err)
	}
	return sl, v, nil
}
