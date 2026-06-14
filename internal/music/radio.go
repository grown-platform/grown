package music

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Retention modes for a radio station's cached songs.
const (
	RetentionKeep = "keep" // keep cached songs indefinitely (default)
	RetentionDays = "days" // trash radio-source tracks older than RetentionDays
)

// Station is the in-memory representation of a grown.music_radio_stations row.
// TrackCount is populated by the list read; it counts the station's cached
// (non-trashed) radio tracks.
type Station struct {
	ID            string
	OrgID         string
	Name          string
	StreamURL     string
	Genre         string
	LogoURL       string
	RetentionMode string
	RetentionDays int // 0 when RetentionMode != "days"
	TrackCount    int
	CreatedAt     time.Time
}

const stationColumns = `id::text, org_id::text, name, stream_url,
	COALESCE(genre, ''), COALESCE(logo_url, ''), retention_mode,
	COALESCE(retention_days, 0), created_at`

func scanStation(row pgx.Row) (Station, error) {
	var s Station
	err := row.Scan(&s.ID, &s.OrgID, &s.Name, &s.StreamURL, &s.Genre, &s.LogoURL,
		&s.RetentionMode, &s.RetentionDays, &s.CreatedAt)
	if err != nil {
		return Station{}, err
	}
	return s, nil
}

// StationFields are the attributes set when a station is seeded/created.
type StationFields struct {
	Name      string
	StreamURL string
	Genre     string
	LogoURL   string
}

// UpsertStation inserts a station (idempotent on org_id+stream_url); if one
// already exists it leaves retention untouched and refreshes the display name.
func (r *Repository) UpsertStation(ctx context.Context, orgID string, f StationFields) (Station, error) {
	q := `INSERT INTO grown.music_radio_stations (org_id, name, stream_url, genre, logo_url)
		VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''))
		ON CONFLICT (org_id, stream_url) DO UPDATE SET name = EXCLUDED.name
		RETURNING ` + stationColumns
	s, err := scanStation(r.pool.QueryRow(ctx, q, orgID, f.Name, f.StreamURL, f.Genre, f.LogoURL))
	if err != nil {
		return Station{}, fmt.Errorf("music.UpsertStation: %w", err)
	}
	return s, nil
}

// CountStations returns the number of stations in orgID (used by the seeder).
func (r *Repository) CountStations(ctx context.Context, orgID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.music_radio_stations WHERE org_id=$1`, orgID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("music.CountStations: %w", err)
	}
	return n, nil
}

// FirstOwner returns any user id in the org, to attribute radio recordings to
// when no specific listener is known.
func (r *Repository) FirstOwner(ctx context.Context, orgID string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`SELECT id::text FROM grown.users WHERE org_id=$1 ORDER BY created_at LIMIT 1`, orgID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("music.FirstOwner: %w", err)
	}
	return id, nil
}

// GetStation returns a station within orgID, or ErrNotFound.
func (r *Repository) GetStation(ctx context.Context, orgID, id string) (Station, error) {
	q := `SELECT ` + stationColumns + ` FROM grown.music_radio_stations WHERE id=$1 AND org_id=$2`
	s, err := scanStation(r.pool.QueryRow(ctx, q, id, orgID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Station{}, ErrNotFound
	}
	if err != nil {
		return Station{}, fmt.Errorf("music.GetStation: %w", err)
	}
	return s, nil
}

// ListStations returns all stations in orgID with their cached-track counts,
// alphabetical by name.
func (r *Repository) ListStations(ctx context.Context, orgID string) ([]Station, error) {
	q := `SELECT ` + stationColumns + `,
			(SELECT count(*) FROM grown.music_tracks t
			 WHERE t.radio_station_id = grown.music_radio_stations.id AND t.trashed_at IS NULL)
		FROM grown.music_radio_stations
		WHERE org_id=$1
		ORDER BY name`
	rows, err := r.pool.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("music.ListStations: %w", err)
	}
	defer rows.Close()
	var out []Station
	for rows.Next() {
		var s Station
		if err := rows.Scan(&s.ID, &s.OrgID, &s.Name, &s.StreamURL, &s.Genre, &s.LogoURL,
			&s.RetentionMode, &s.RetentionDays, &s.CreatedAt, &s.TrackCount); err != nil {
			return nil, fmt.Errorf("music.ListStations scan: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SetRetention updates a station's retention policy. mode must be "keep" or
// "days"; days is stored only for mode=="days".
func (r *Repository) SetRetention(ctx context.Context, orgID, id, mode string, days int) (Station, error) {
	if mode != RetentionKeep && mode != RetentionDays {
		return Station{}, fmt.Errorf("music.SetRetention: invalid mode %q", mode)
	}
	var daysArg *int
	if mode == RetentionDays {
		if days <= 0 {
			days = 30
		}
		daysArg = &days
	}
	q := `UPDATE grown.music_radio_stations SET retention_mode=$3, retention_days=$4
		WHERE id=$1 AND org_id=$2
		RETURNING ` + stationColumns
	s, err := scanStation(r.pool.QueryRow(ctx, q, id, orgID, mode, daysArg))
	if errors.Is(err, pgx.ErrNoRows) {
		return Station{}, ErrNotFound
	}
	if err != nil {
		return Station{}, fmt.Errorf("music.SetRetention: %w", err)
	}
	return s, nil
}

// CreateRadioTrackParams are the attributes of a song cached from a stream.
type CreateRadioTrackParams struct {
	Title           string
	Artist          string
	Album           string // station name
	ContentType     string
	Size            int64
	DurationSeconds float64
	BlobKey         string
	StationID       string
}

// CreateRadioTrack inserts a track recorded from a radio stream (source='radio',
// radio_station_id set).
func (r *Repository) CreateRadioTrack(ctx context.Context, orgID, ownerID string, p CreateRadioTrackParams) (Track, error) {
	q := `INSERT INTO grown.music_tracks
		(org_id, owner_id, title, artist, album, content_type, size, duration_seconds,
		 blob_key, source, radio_station_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'radio',$10)
		RETURNING ` + trackColumns
	t, err := scanTrack(r.pool.QueryRow(ctx, q, orgID, ownerID, p.Title, p.Artist, p.Album,
		p.ContentType, p.Size, p.DurationSeconds, p.BlobKey, p.StationID))
	if err != nil {
		return Track{}, fmt.Errorf("music.CreateRadioTrack: %w", err)
	}
	return t, nil
}

// RadioTrackExists reports whether a non-trashed radio track for the station
// with the same artist+title was recorded within the dedupe window.
func (r *Repository) RadioTrackExists(ctx context.Context, stationID, artist, title string, within time.Duration) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(
			SELECT 1 FROM grown.music_tracks
			WHERE radio_station_id=$1 AND artist=$2 AND title=$3
			  AND trashed_at IS NULL AND created_at > now() - $4::interval)`,
		stationID, artist, title, fmt.Sprintf("%d seconds", int(within.Seconds()))).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("music.RadioTrackExists: %w", err)
	}
	return exists, nil
}

// SweepExpiredRadioTracks soft-deletes radio-source tracks for stations on the
// "days" retention policy whose tracks are older than the station's
// retention_days. Returns the trashed tracks' blob keys so the caller can drop
// the bytes. Best-effort: called periodically by a background ticker.
func (r *Repository) SweepExpiredRadioTracks(ctx context.Context) ([]string, error) {
	q := `UPDATE grown.music_tracks t SET trashed_at=now(), updated_at=now()
		FROM grown.music_radio_stations s
		WHERE t.radio_station_id = s.id
		  AND t.trashed_at IS NULL
		  AND t.source = 'radio'
		  AND s.retention_mode = 'days'
		  AND s.retention_days IS NOT NULL
		  AND t.created_at < now() - (s.retention_days || ' days')::interval
		RETURNING t.blob_key`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("music.SweepExpiredRadioTracks: %w", err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, fmt.Errorf("music.SweepExpiredRadioTracks scan: %w", err)
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}
