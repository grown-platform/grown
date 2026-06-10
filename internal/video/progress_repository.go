package video

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WatchedThreshold is the minimum percent at which a video is marked watched.
const WatchedThreshold = 0.95

// Progress holds one row from grown.video_progress.
type Progress struct {
	UserID          string
	VideoID         string
	PositionSeconds float64
	Percent         float64
	Watched         bool
	UpdatedAt       time.Time
}

// ProgressRepository reads and writes video_progress rows.
type ProgressRepository struct {
	pool *pgxpool.Pool
}

// NewProgressRepository constructs a ProgressRepository.
func NewProgressRepository(pool *pgxpool.Pool) *ProgressRepository {
	return &ProgressRepository{pool: pool}
}

// Upsert inserts or updates a progress row. Sets watched=true when percent >= WatchedThreshold.
// Once watched, the flag stays true even if the user rewinds.
func (r *ProgressRepository) Upsert(ctx context.Context, userID, videoID string, positionSeconds, percent float64) (Progress, error) {
	watched := percent >= WatchedThreshold
	var p Progress
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.video_progress (user_id, video_id, position_seconds, percent, watched, updated_at)
		 VALUES ($1::uuid, $2::uuid, $3, $4, $5, now())
		 ON CONFLICT (user_id, video_id) DO UPDATE
		   SET position_seconds = EXCLUDED.position_seconds,
		       percent          = EXCLUDED.percent,
		       watched          = EXCLUDED.watched OR grown.video_progress.watched,
		       updated_at       = now()
		 RETURNING user_id::text, video_id::text, position_seconds, percent, watched, updated_at`,
		userID, videoID, positionSeconds, percent, watched).
		Scan(&p.UserID, &p.VideoID, &p.PositionSeconds, &p.Percent, &p.Watched, &p.UpdatedAt)
	if err != nil {
		return Progress{}, fmt.Errorf("progress.Upsert: %w", err)
	}
	return p, nil
}

// Get returns a progress row for (userID, videoID).
// Returns zero-value Progress (not an error) when no row exists yet.
func (r *ProgressRepository) Get(ctx context.Context, userID, videoID string) (Progress, error) {
	var p Progress
	err := r.pool.QueryRow(ctx,
		`SELECT user_id::text, video_id::text, position_seconds, percent, watched, updated_at
		 FROM grown.video_progress
		 WHERE user_id=$1::uuid AND video_id=$2::uuid`,
		userID, videoID).
		Scan(&p.UserID, &p.VideoID, &p.PositionSeconds, &p.Percent, &p.Watched, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Progress{VideoID: videoID, UserID: userID}, nil
	}
	if err != nil {
		return Progress{}, fmt.Errorf("progress.Get: %w", err)
	}
	return p, nil
}

// GetBulk returns a map of videoID→Progress for a user and a set of video ids.
func (r *ProgressRepository) GetBulk(ctx context.Context, userID string, videoIDs []string) (map[string]Progress, error) {
	out := make(map[string]Progress, len(videoIDs))
	if len(videoIDs) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT user_id::text, video_id::text, position_seconds, percent, watched, updated_at
		 FROM grown.video_progress
		 WHERE user_id=$1::uuid AND video_id = ANY($2::uuid[])`,
		userID, videoIDs)
	if err != nil {
		return nil, fmt.Errorf("progress.GetBulk: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p Progress
		if err := rows.Scan(&p.UserID, &p.VideoID, &p.PositionSeconds, &p.Percent, &p.Watched, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("progress.GetBulk scan: %w", err)
		}
		out[p.VideoID] = p
	}
	return out, rows.Err()
}
