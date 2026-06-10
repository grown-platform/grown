// Package music is the data-access + service layer for the internal music
// library. Audio bytes live in the blob store (shared with Drive); this package
// owns the per-org track + playlist metadata rows and the raw HTTP
// upload/stream handlers.
package music

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when no track or playlist matches the given id
// (within the org).
var ErrNotFound = errors.New("music item not found")

// Track is the in-memory representation of a grown.music_tracks row.
type Track struct {
	ID              string
	OrgID           string
	OwnerID         string
	Title           string
	Artist          string
	Album           string
	ContentType     string
	Size            int64
	DurationSeconds float64
	ArtworkDataURL  string
	BlobKey         string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// TrackFields bundles the editable metadata of a track (used by Update).
type TrackFields struct {
	Title          string
	Artist         string
	Album          string
	ArtworkDataURL string
}

// Playlist is the in-memory representation of a grown.music_playlists row.
// Tracks is populated by the playlist-detail reads; TrackCount is always set.
type Playlist struct {
	ID          string
	OrgID       string
	OwnerID     string
	Name        string
	Description string
	Tracks      []Track
	TrackCount  int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// PlaylistFields bundles the editable metadata of a playlist.
type PlaylistFields struct {
	Name        string
	Description string
}

// Repository reads and writes tracks and playlists.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository constructs a Repository over the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

const trackColumns = `id::text, org_id::text, owner_id::text, title, artist, album,
	content_type, size, duration_seconds, artwork_data_url, blob_key, created_at, updated_at`

// trackColumnsT is trackColumns qualified by the "t" alias, for use in JOINs.
const trackColumnsT = `t.id::text, t.org_id::text, t.owner_id::text, t.title, t.artist, t.album,
	t.content_type, t.size, t.duration_seconds, t.artwork_data_url, t.blob_key, t.created_at, t.updated_at`

func scanTrack(row pgx.Row) (Track, error) {
	var t Track
	err := row.Scan(&t.ID, &t.OrgID, &t.OwnerID, &t.Title, &t.Artist, &t.Album,
		&t.ContentType, &t.Size, &t.DurationSeconds, &t.ArtworkDataURL, &t.BlobKey,
		&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return Track{}, err
	}
	return t, nil
}

// CreateTrackParams are the attributes set when a track is first uploaded.
type CreateTrackParams struct {
	Title           string
	Artist          string
	Album           string
	ContentType     string
	Size            int64
	DurationSeconds float64
	ArtworkDataURL  string
	BlobKey         string
}

// CreateTrack inserts a new track metadata row.
func (r *Repository) CreateTrack(ctx context.Context, orgID, ownerID string, p CreateTrackParams) (Track, error) {
	q := `INSERT INTO grown.music_tracks
		(org_id, owner_id, title, artist, album, content_type, size, duration_seconds, artwork_data_url, blob_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING ` + trackColumns
	t, err := scanTrack(r.pool.QueryRow(ctx, q, orgID, ownerID, p.Title, p.Artist, p.Album,
		p.ContentType, p.Size, p.DurationSeconds, p.ArtworkDataURL, p.BlobKey))
	if err != nil {
		return Track{}, fmt.Errorf("music.CreateTrack: %w", err)
	}
	return t, nil
}

// GetTrack returns a track within orgID, or ErrNotFound.
func (r *Repository) GetTrack(ctx context.Context, orgID, id string) (Track, error) {
	q := `SELECT ` + trackColumns + ` FROM grown.music_tracks WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	t, err := scanTrack(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Track{}, ErrNotFound
	}
	if err != nil {
		return Track{}, fmt.Errorf("music.GetTrack: %w", err)
	}
	return t, nil
}

// ListTracks returns all non-trashed tracks in orgID, newest first.
func (r *Repository) ListTracks(ctx context.Context, orgID string) ([]Track, error) {
	q := `SELECT ` + trackColumns + ` FROM grown.music_tracks
		WHERE org_id=$1 AND trashed_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("music.ListTracks: %w", err)
	}
	defer rows.Close()
	var out []Track
	for rows.Next() {
		t, err := scanTrack(rows)
		if err != nil {
			return nil, fmt.Errorf("music.ListTracks scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// UpdateTrack replaces the editable metadata of a track within orgID.
func (r *Repository) UpdateTrack(ctx context.Context, orgID, id string, f TrackFields) (Track, error) {
	q := `UPDATE grown.music_tracks SET
		title=$3, artist=$4, album=$5, artwork_data_url=$6, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + trackColumns
	t, err := scanTrack(r.pool.QueryRow(ctx, q, id, orgID, f.Title, f.Artist, f.Album, f.ArtworkDataURL))
	if errors.Is(err, pgx.ErrNoRows) {
		return Track{}, ErrNotFound
	}
	if err != nil {
		return Track{}, fmt.Errorf("music.UpdateTrack: %w", err)
	}
	return t, nil
}

// TrashTrack soft-deletes a track within orgID and returns its blob key so the
// caller can remove the underlying bytes. The track is also removed from any
// playlists it belongs to (the join row's FK cascades only on hard delete, so
// we delete the membership explicitly).
func (r *Repository) TrashTrack(ctx context.Context, orgID, id string) (string, error) {
	var blobKey string
	err := r.pool.QueryRow(ctx,
		`UPDATE grown.music_tracks SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		 RETURNING blob_key`, id, orgID).Scan(&blobKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("music.TrashTrack: %w", err)
	}
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM grown.music_playlist_tracks WHERE track_id=$1`, id); err != nil {
		return "", fmt.Errorf("music.TrashTrack membership: %w", err)
	}
	return blobKey, nil
}

const playlistColumns = `id::text, org_id::text, owner_id::text, name, description, created_at, updated_at`

func scanPlaylist(row pgx.Row) (Playlist, error) {
	var p Playlist
	err := row.Scan(&p.ID, &p.OrgID, &p.OwnerID, &p.Name, &p.Description, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return Playlist{}, err
	}
	return p, nil
}

// CreatePlaylist inserts a new, empty playlist.
func (r *Repository) CreatePlaylist(ctx context.Context, orgID, ownerID string, f PlaylistFields) (Playlist, error) {
	q := `INSERT INTO grown.music_playlists (org_id, owner_id, name, description)
		VALUES ($1,$2,$3,$4)
		RETURNING ` + playlistColumns
	p, err := scanPlaylist(r.pool.QueryRow(ctx, q, orgID, ownerID, f.Name, f.Description))
	if err != nil {
		return Playlist{}, fmt.Errorf("music.CreatePlaylist: %w", err)
	}
	return p, nil
}

// GetPlaylist returns a playlist within orgID with its tracks loaded, or
// ErrNotFound.
func (r *Repository) GetPlaylist(ctx context.Context, orgID, id string) (Playlist, error) {
	q := `SELECT ` + playlistColumns + ` FROM grown.music_playlists WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`
	p, err := scanPlaylist(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Playlist{}, ErrNotFound
	}
	if err != nil {
		return Playlist{}, fmt.Errorf("music.GetPlaylist: %w", err)
	}
	tracks, err := r.playlistTracks(ctx, orgID, id)
	if err != nil {
		return Playlist{}, err
	}
	p.Tracks = tracks
	p.TrackCount = len(tracks)
	return p, nil
}

// playlistTracks loads a playlist's tracks in playlist order, skipping any that
// have since been trashed.
func (r *Repository) playlistTracks(ctx context.Context, orgID, playlistID string) ([]Track, error) {
	q := `SELECT ` + trackColumnsT + `
		FROM grown.music_playlist_tracks pt
		JOIN grown.music_tracks t ON t.id = pt.track_id
		WHERE pt.playlist_id=$1 AND t.org_id=$2 AND t.trashed_at IS NULL
		ORDER BY pt.position, pt.added_at`
	rows, err := r.pool.Query(ctx, q, playlistID, orgID)
	if err != nil {
		return nil, fmt.Errorf("music.playlistTracks: %w", err)
	}
	defer rows.Close()
	out := make([]Track, 0)
	for rows.Next() {
		t, err := scanTrack(rows)
		if err != nil {
			return nil, fmt.Errorf("music.playlistTracks scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListPlaylists returns all non-trashed playlists in orgID with their track
// counts (but not their tracks), newest first.
func (r *Repository) ListPlaylists(ctx context.Context, orgID string) ([]Playlist, error) {
	q := `SELECT ` + playlistColumns + `,
			(SELECT count(*) FROM grown.music_playlist_tracks pt
			 JOIN grown.music_tracks t ON t.id = pt.track_id
			 WHERE pt.playlist_id = grown.music_playlists.id AND t.trashed_at IS NULL) AS track_count
		FROM grown.music_playlists
		WHERE org_id=$1 AND trashed_at IS NULL
		ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("music.ListPlaylists: %w", err)
	}
	defer rows.Close()
	var out []Playlist
	for rows.Next() {
		var p Playlist
		var count int
		if err := rows.Scan(&p.ID, &p.OrgID, &p.OwnerID, &p.Name, &p.Description,
			&p.CreatedAt, &p.UpdatedAt, &count); err != nil {
			return nil, fmt.Errorf("music.ListPlaylists scan: %w", err)
		}
		p.TrackCount = count
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdatePlaylist replaces the editable metadata of a playlist within orgID and
// returns it with its tracks loaded.
func (r *Repository) UpdatePlaylist(ctx context.Context, orgID, id string, f PlaylistFields) (Playlist, error) {
	q := `UPDATE grown.music_playlists SET
		name=$3, description=$4, updated_at=now()
		WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL
		RETURNING ` + playlistColumns
	p, err := scanPlaylist(r.pool.QueryRow(ctx, q, id, orgID, f.Name, f.Description))
	if errors.Is(err, pgx.ErrNoRows) {
		return Playlist{}, ErrNotFound
	}
	if err != nil {
		return Playlist{}, fmt.Errorf("music.UpdatePlaylist: %w", err)
	}
	tracks, err := r.playlistTracks(ctx, orgID, id)
	if err != nil {
		return Playlist{}, err
	}
	p.Tracks = tracks
	p.TrackCount = len(tracks)
	return p, nil
}

// TrashPlaylist soft-deletes a playlist within orgID. The membership rows stay
// (they cascade only on hard delete), but the playlist itself becomes invisible.
func (r *Repository) TrashPlaylist(ctx context.Context, orgID, id string) error {
	ct, err := r.pool.Exec(ctx,
		`UPDATE grown.music_playlists SET trashed_at=now(), updated_at=now()
		 WHERE id=$1 AND org_id=$2 AND trashed_at IS NULL`, id, orgID)
	if err != nil {
		return fmt.Errorf("music.TrashPlaylist: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddTrackToPlaylist appends a track to a playlist (idempotent: re-adding an
// existing member is a no-op). Both must belong to orgID. Returns the updated
// playlist with its tracks loaded.
func (r *Repository) AddTrackToPlaylist(ctx context.Context, orgID, playlistID, trackID string) (Playlist, error) {
	// Verify both belong to the org and are live.
	if _, err := r.GetPlaylist(ctx, orgID, playlistID); err != nil {
		return Playlist{}, err
	}
	if _, err := r.GetTrack(ctx, orgID, trackID); err != nil {
		return Playlist{}, err
	}
	// Append at the end: next position is max(position)+1.
	q := `INSERT INTO grown.music_playlist_tracks (playlist_id, track_id, position)
		VALUES ($1, $2,
			COALESCE((SELECT max(position)+1 FROM grown.music_playlist_tracks WHERE playlist_id=$1), 0))
		ON CONFLICT (playlist_id, track_id) DO NOTHING`
	if _, err := r.pool.Exec(ctx, q, playlistID, trackID); err != nil {
		return Playlist{}, fmt.Errorf("music.AddTrackToPlaylist: %w", err)
	}
	// Touch the playlist so updated_at reflects the change.
	if _, err := r.pool.Exec(ctx,
		`UPDATE grown.music_playlists SET updated_at=now() WHERE id=$1 AND org_id=$2`, playlistID, orgID); err != nil {
		return Playlist{}, fmt.Errorf("music.AddTrackToPlaylist touch: %w", err)
	}
	return r.GetPlaylist(ctx, orgID, playlistID)
}

// RemoveTrackFromPlaylist removes a track from a playlist (no-op if absent).
// Returns the updated playlist with its tracks loaded.
func (r *Repository) RemoveTrackFromPlaylist(ctx context.Context, orgID, playlistID, trackID string) (Playlist, error) {
	if _, err := r.GetPlaylist(ctx, orgID, playlistID); err != nil {
		return Playlist{}, err
	}
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM grown.music_playlist_tracks WHERE playlist_id=$1 AND track_id=$2`,
		playlistID, trackID); err != nil {
		return Playlist{}, fmt.Errorf("music.RemoveTrackFromPlaylist: %w", err)
	}
	if _, err := r.pool.Exec(ctx,
		`UPDATE grown.music_playlists SET updated_at=now() WHERE id=$1 AND org_id=$2`, playlistID, orgID); err != nil {
		return Playlist{}, fmt.Errorf("music.RemoveTrackFromPlaylist touch: %w", err)
	}
	return r.GetPlaylist(ctx, orgID, playlistID)
}

// ReorderPlaylistTrack moves a track within a playlist to a new zero-based
// position. Positions of other tracks are shifted accordingly.
func (r *Repository) ReorderPlaylistTrack(ctx context.Context, orgID, playlistID, trackID string, newPosition int) (Playlist, error) {
	if _, err := r.GetPlaylist(ctx, orgID, playlistID); err != nil {
		return Playlist{}, err
	}
	// Load current order so we can renumber correctly.
	tracks, err := r.playlistTracks(ctx, orgID, playlistID)
	if err != nil {
		return Playlist{}, err
	}
	// Find the track's current index.
	oldIdx := -1
	for i, t := range tracks {
		if t.ID == trackID {
			oldIdx = i
			break
		}
	}
	if oldIdx == -1 {
		return Playlist{}, ErrNotFound
	}
	// Clamp newPosition.
	if newPosition < 0 {
		newPosition = 0
	}
	if newPosition >= len(tracks) {
		newPosition = len(tracks) - 1
	}
	if oldIdx == newPosition {
		return r.GetPlaylist(ctx, orgID, playlistID)
	}
	// Rebuild the order.
	ordered := make([]Track, 0, len(tracks))
	for i, t := range tracks {
		if i != oldIdx {
			ordered = append(ordered, t)
		}
	}
	ordered = append(ordered[:newPosition], append([]Track{tracks[oldIdx]}, ordered[newPosition:]...)...)

	// Write back in a single batch.
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Playlist{}, fmt.Errorf("music.ReorderPlaylistTrack begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for pos, t := range ordered {
		if _, err := tx.Exec(ctx,
			`UPDATE grown.music_playlist_tracks SET position=$3 WHERE playlist_id=$1 AND track_id=$2`,
			playlistID, t.ID, pos); err != nil {
			return Playlist{}, fmt.Errorf("music.ReorderPlaylistTrack update: %w", err)
		}
	}
	if _, err := tx.Exec(ctx,
		`UPDATE grown.music_playlists SET updated_at=now() WHERE id=$1 AND org_id=$2`, playlistID, orgID); err != nil {
		return Playlist{}, fmt.Errorf("music.ReorderPlaylistTrack touch: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Playlist{}, fmt.Errorf("music.ReorderPlaylistTrack commit: %w", err)
	}
	return r.GetPlaylist(ctx, orgID, playlistID)
}

// LikeTrack records that userID has liked the track (idempotent).
func (r *Repository) LikeTrack(ctx context.Context, orgID, userID, trackID string) error {
	// Verify the track belongs to the org.
	if _, err := r.GetTrack(ctx, orgID, trackID); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO grown.music_likes (user_id, track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, trackID)
	if err != nil {
		return fmt.Errorf("music.LikeTrack: %w", err)
	}
	return nil
}

// UnlikeTrack removes a like (no-op if not liked).
func (r *Repository) UnlikeTrack(ctx context.Context, orgID, userID, trackID string) error {
	if _, err := r.GetTrack(ctx, orgID, trackID); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx,
		`DELETE FROM grown.music_likes WHERE user_id=$1 AND track_id=$2`,
		userID, trackID)
	if err != nil {
		return fmt.Errorf("music.UnlikeTrack: %w", err)
	}
	return nil
}

// ListLikedTracks returns all non-trashed tracks that userID has liked within
// orgID, newest-liked first.
func (r *Repository) ListLikedTracks(ctx context.Context, orgID, userID string) ([]Track, error) {
	q := `SELECT ` + trackColumnsT + `
		FROM grown.music_likes l
		JOIN grown.music_tracks t ON t.id = l.track_id
		WHERE l.user_id=$1 AND t.org_id=$2 AND t.trashed_at IS NULL
		ORDER BY l.liked_at DESC`
	rows, err := r.pool.Query(ctx, q, userID, orgID)
	if err != nil {
		return nil, fmt.Errorf("music.ListLikedTracks: %w", err)
	}
	defer rows.Close()
	var out []Track
	for rows.Next() {
		t, err := scanTrack(rows)
		if err != nil {
			return nil, fmt.Errorf("music.ListLikedTracks scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// IsLiked returns true if userID has liked trackID.
func (r *Repository) IsLiked(ctx context.Context, userID, trackID string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM grown.music_likes WHERE user_id=$1 AND track_id=$2)`,
		userID, trackID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("music.IsLiked: %w", err)
	}
	return exists, nil
}

// LikedSet returns the set of liked track IDs for a given user, filtered to
// the provided IDs slice. Used to annotate bulk track lists efficiently.
func (r *Repository) LikedSet(ctx context.Context, userID string, trackIDs []string) (map[string]bool, error) {
	if len(trackIDs) == 0 {
		return map[string]bool{}, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT track_id::text FROM grown.music_likes WHERE user_id=$1 AND track_id = ANY($2::uuid[])`,
		userID, trackIDs)
	if err != nil {
		return nil, fmt.Errorf("music.LikedSet: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("music.LikedSet scan: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}
