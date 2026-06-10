package video

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrPlaylistNotFound is returned when no playlist matches the given id within the org.
var ErrPlaylistNotFound = errors.New("playlist not found")

// VideoPlaylist is an in-memory row from grown.video_playlists.
type VideoPlaylist struct {
	ID          string
	OrgID       string
	OwnerUserID string
	Name        string
	CreatedAt   time.Time
	ItemCount   int32
}

// PlaylistRepository reads and writes playlist rows.
type PlaylistRepository struct {
	pool *pgxpool.Pool
}

// NewPlaylistRepository constructs a PlaylistRepository.
func NewPlaylistRepository(pool *pgxpool.Pool) *PlaylistRepository {
	return &PlaylistRepository{pool: pool}
}

// CreatePlaylist inserts a new playlist and returns it.
func (r *PlaylistRepository) CreatePlaylist(ctx context.Context, orgID, ownerUserID, name string) (VideoPlaylist, error) {
	var p VideoPlaylist
	err := r.pool.QueryRow(ctx,
		`INSERT INTO grown.video_playlists (org_id, owner_user_id, name)
		 VALUES ($1::uuid, $2::uuid, $3)
		 RETURNING id::text, org_id::text, owner_user_id::text, name, created_at`,
		orgID, ownerUserID, name).
		Scan(&p.ID, &p.OrgID, &p.OwnerUserID, &p.Name, &p.CreatedAt)
	if err != nil {
		return VideoPlaylist{}, fmt.Errorf("playlist.Create: %w", err)
	}
	return p, nil
}

// GetPlaylist returns a playlist by id within orgID, or ErrPlaylistNotFound.
func (r *PlaylistRepository) GetPlaylist(ctx context.Context, orgID, id string) (VideoPlaylist, error) {
	var p VideoPlaylist
	err := r.pool.QueryRow(ctx,
		`SELECT pl.id::text, pl.org_id::text, pl.owner_user_id::text, pl.name, pl.created_at,
		        COUNT(pi.video_id)::int
		 FROM grown.video_playlists pl
		 LEFT JOIN grown.video_playlist_items pi ON pi.playlist_id = pl.id
		 WHERE pl.id=$1::uuid AND pl.org_id=$2::uuid
		 GROUP BY pl.id`, id, orgID).
		Scan(&p.ID, &p.OrgID, &p.OwnerUserID, &p.Name, &p.CreatedAt, &p.ItemCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return VideoPlaylist{}, ErrPlaylistNotFound
	}
	if err != nil {
		return VideoPlaylist{}, fmt.Errorf("playlist.Get: %w", err)
	}
	return p, nil
}

// ListPlaylists returns all playlists in orgID, newest first.
func (r *PlaylistRepository) ListPlaylists(ctx context.Context, orgID string) ([]VideoPlaylist, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT pl.id::text, pl.org_id::text, pl.owner_user_id::text, pl.name, pl.created_at,
		        COUNT(pi.video_id)::int
		 FROM grown.video_playlists pl
		 LEFT JOIN grown.video_playlist_items pi ON pi.playlist_id = pl.id
		 WHERE pl.org_id=$1::uuid
		 GROUP BY pl.id
		 ORDER BY pl.created_at DESC`, orgID)
	if err != nil {
		return nil, fmt.Errorf("playlist.List: %w", err)
	}
	defer rows.Close()
	var out []VideoPlaylist
	for rows.Next() {
		var p VideoPlaylist
		if err := rows.Scan(&p.ID, &p.OrgID, &p.OwnerUserID, &p.Name, &p.CreatedAt, &p.ItemCount); err != nil {
			return nil, fmt.Errorf("playlist.List scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdatePlaylist renames a playlist within orgID. Returns ErrPlaylistNotFound if not found.
func (r *PlaylistRepository) UpdatePlaylist(ctx context.Context, orgID, id, name string) (VideoPlaylist, error) {
	var p VideoPlaylist
	err := r.pool.QueryRow(ctx,
		`UPDATE grown.video_playlists SET name=$3
		 WHERE id=$1::uuid AND org_id=$2::uuid
		 RETURNING id::text, org_id::text, owner_user_id::text, name, created_at`,
		id, orgID, name).
		Scan(&p.ID, &p.OrgID, &p.OwnerUserID, &p.Name, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return VideoPlaylist{}, ErrPlaylistNotFound
	}
	if err != nil {
		return VideoPlaylist{}, fmt.Errorf("playlist.Update: %w", err)
	}
	return p, nil
}

// DeletePlaylist removes a playlist within orgID. Returns ErrPlaylistNotFound if not found.
func (r *PlaylistRepository) DeletePlaylist(ctx context.Context, orgID, id string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.video_playlists WHERE id=$1::uuid AND org_id=$2::uuid`,
		id, orgID)
	if err != nil {
		return fmt.Errorf("playlist.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrPlaylistNotFound
	}
	return nil
}

// AddToPlaylist inserts a video into a playlist at the end.
// No-ops if the video is already in the playlist.
func (r *PlaylistRepository) AddToPlaylist(ctx context.Context, orgID, playlistID, videoID string) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.video_playlist_items (playlist_id, video_id, position)
		 SELECT $1::uuid, $2::uuid,
		        COALESCE((SELECT MAX(position)+1 FROM grown.video_playlist_items WHERE playlist_id=$1::uuid), 0)
		 WHERE EXISTS (SELECT 1 FROM grown.video_playlists WHERE id=$1::uuid AND org_id=$3::uuid)
		 ON CONFLICT (playlist_id, video_id) DO NOTHING`,
		playlistID, videoID, orgID)
	if err != nil {
		return fmt.Errorf("playlist.AddItem: %w", err)
	}
	return nil
}

// RemoveFromPlaylist removes a video from a playlist.
func (r *PlaylistRepository) RemoveFromPlaylist(ctx context.Context, orgID, playlistID, videoID string) error {
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.video_playlist_items pi
		 USING grown.video_playlists pl
		 WHERE pi.playlist_id = pl.id
		   AND pl.id=$1::uuid AND pl.org_id=$3::uuid AND pi.video_id=$2::uuid`,
		playlistID, videoID, orgID)
	if err != nil {
		return fmt.Errorf("playlist.RemoveItem: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrPlaylistNotFound
	}
	return nil
}

// ReorderPlaylist replaces all positions for a playlist using the given video id order.
func (r *PlaylistRepository) ReorderPlaylist(ctx context.Context, orgID, playlistID string, videoIDs []string) error {
	// Verify ownership first.
	if _, err := r.GetPlaylist(ctx, orgID, playlistID); err != nil {
		return err
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("playlist.Reorder begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for i, vid := range videoIDs {
		if _, err := tx.Exec(ctx,
			`UPDATE grown.video_playlist_items SET position=$3 WHERE playlist_id=$1::uuid AND video_id=$2::uuid`,
			playlistID, vid, i); err != nil {
			return fmt.Errorf("playlist.Reorder update: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// ListPlaylistVideos returns videos in a playlist ordered by position.
func (r *PlaylistRepository) ListPlaylistVideos(ctx context.Context, orgID, playlistID string) ([]Video, error) {
	// Verify ownership.
	if _, err := r.GetPlaylist(ctx, orgID, playlistID); err != nil {
		return nil, err
	}
	q := `SELECT ` + columns + `
		  FROM grown.videos v
		  JOIN grown.video_playlist_items pi ON pi.video_id = v.id
		  WHERE pi.playlist_id=$1::uuid AND v.trashed_at IS NULL
		  ORDER BY pi.position`
	rows, err := r.pool.Query(ctx, q, playlistID)
	if err != nil {
		return nil, fmt.Errorf("playlist.ListVideos: %w", err)
	}
	defer rows.Close()
	var out []Video
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("playlist.ListVideos scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
