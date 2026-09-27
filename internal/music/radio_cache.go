package music

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Radio cache limits.
//
// The radio recorder caches every complete song it hears as a music_tracks row
// (source='radio') plus an S3 object under music/radio/. Per-station retention
// ("keep" / "days") is an org-level preference; on its own it cannot protect
// the object store, which is shared by the whole instance (Drive, Docs, Music
// uploads, …). RadioCacheLimits is therefore an INSTANCE-wide ceiling: the
// janitor sums radio bytes across all orgs and evicts the oldest unsaved songs
// instance-wide. A per-org cap would multiply with the number of orgs and
// still let the volume fill up.
const (
	// DefaultRadioCacheMaxBytes is the instance-wide radio cache ceiling when
	// GROWN_RADIO_CACHE_MAX_BYTES is unset: 5 GiB, i.e. a quarter of the
	// 20 GiB default object-store volume, ~90 hours of 128 kbps audio.
	DefaultRadioCacheMaxBytes int64 = 5 << 30
	// DefaultRadioCacheMaxDays is the instance-wide age ceiling when
	// GROWN_RADIO_CACHE_MAX_DAYS is unset.
	DefaultRadioCacheMaxDays = 30
	// DefaultStationRetentionDays is the retention given to NEW stations
	// (previously "keep forever"). Existing stations keep their setting.
	DefaultStationRetentionDays = 14
)

// RadioCacheLimits is the instance-wide radio cache ceiling. A zero field
// means "no limit" for that dimension.
type RadioCacheLimits struct {
	MaxBytes int64
	MaxDays  int
}

// MaxAge returns MaxDays as a duration (0 when unlimited).
func (l RadioCacheLimits) MaxAge() time.Duration {
	if l.MaxDays <= 0 {
		return 0
	}
	return time.Duration(l.MaxDays) * 24 * time.Hour
}

// RadioCacheLimitsFromEnv reads GROWN_RADIO_CACHE_MAX_BYTES (bytes, or a size
// such as "5Gi"/"5GB"/"500M") and GROWN_RADIO_CACHE_MAX_DAYS. Unset or
// unparsable values fall back to the defaults; an explicit "0" disables that
// dimension.
func RadioCacheLimitsFromEnv() RadioCacheLimits {
	l := RadioCacheLimits{MaxBytes: DefaultRadioCacheMaxBytes, MaxDays: DefaultRadioCacheMaxDays}
	if v := strings.TrimSpace(os.Getenv("GROWN_RADIO_CACHE_MAX_BYTES")); v != "" {
		if n, err := ParseByteSize(v); err == nil {
			l.MaxBytes = n
		}
	}
	if v := strings.TrimSpace(os.Getenv("GROWN_RADIO_CACHE_MAX_DAYS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			l.MaxDays = n
		}
	}
	return l
}

// ParseByteSize parses a plain byte count or a number with a binary
// (Ki/Mi/Gi/Ti) or decimal (K/M/G/T, optional trailing "B") suffix.
func ParseByteSize(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty size")
	}
	units := []struct {
		suffix string
		mult   float64
	}{
		{"KiB", 1 << 10}, {"MiB", 1 << 20}, {"GiB", 1 << 30}, {"TiB", 1 << 40},
		{"Ki", 1 << 10}, {"Mi", 1 << 20}, {"Gi", 1 << 30}, {"Ti", 1 << 40},
		{"KB", 1e3}, {"MB", 1e6}, {"GB", 1e9}, {"TB", 1e12},
		{"K", 1e3}, {"M", 1e6}, {"G", 1e9}, {"T", 1e12},
		{"B", 1},
	}
	mult := 1.0
	num := s
	for _, u := range units {
		if strings.HasSuffix(strings.ToUpper(s), strings.ToUpper(u.suffix)) &&
			// "Gi" must not be matched by the "G"+"i" of a longer suffix; the
			// list is ordered longest-first so the first match wins.
			len(s) > len(u.suffix) {
			num = strings.TrimSpace(s[:len(s)-len(u.suffix)])
			mult = u.mult
			break
		}
	}
	f, err := strconv.ParseFloat(num, 64)
	if err != nil || f < 0 {
		return 0, fmt.Errorf("invalid size %q", s)
	}
	return int64(f * mult), nil
}

// savedTrackPredicate is true when some user explicitly kept the track: it is
// liked (favourites) or sits in a live (non-trashed) playlist. Radio songs
// have no other "save" action — they show up in the library automatically —
// so these are the only signals. Saved tracks are never evicted.
const savedTrackPredicate = `(EXISTS (SELECT 1 FROM grown.music_likes l WHERE l.track_id = t.id)
	OR EXISTS (SELECT 1 FROM grown.music_playlist_tracks pt
		JOIN grown.music_playlists p ON p.id = pt.playlist_id
		WHERE pt.track_id = t.id AND p.trashed_at IS NULL))`

// RadioCacheCandidate is one live (non-trashed) radio track as seen by the
// cache janitor.
type RadioCacheCandidate struct {
	ID        string
	Size      int64
	CreatedAt time.Time
	Saved     bool // liked or in a playlist: never evicted
}

// ListRadioCacheCandidates returns every live radio-sourced track across the
// instance, oldest first. There is no play history, so recording time is the
// LRU proxy.
func (r *Repository) ListRadioCacheCandidates(ctx context.Context) ([]RadioCacheCandidate, error) {
	q := `SELECT t.id::text, t.size, t.created_at, ` + savedTrackPredicate + `
		FROM grown.music_tracks t
		WHERE t.source = 'radio' AND t.trashed_at IS NULL
		ORDER BY t.created_at, t.id`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("music.ListRadioCacheCandidates: %w", err)
	}
	defer rows.Close()
	var out []RadioCacheCandidate
	for rows.Next() {
		var c RadioCacheCandidate
		if err := rows.Scan(&c.ID, &c.Size, &c.CreatedAt, &c.Saved); err != nil {
			return nil, fmt.Errorf("music.ListRadioCacheCandidates scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// TrashRadioTracks soft-deletes the given radio tracks, re-checking atomically
// that none has been saved (liked/playlisted) since it was selected. Returns
// the number actually trashed. The purge step then removes bytes + rows.
func (r *Repository) TrashRadioTracks(ctx context.Context, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE grown.music_tracks t SET trashed_at=now(), updated_at=now()
		 WHERE t.id = ANY($1::uuid[]) AND t.source = 'radio' AND t.trashed_at IS NULL
		   AND NOT `+savedTrackPredicate, ids)
	if err != nil {
		return 0, fmt.Errorf("music.TrashRadioTracks: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// TrashedRadioTrack is a soft-deleted radio track awaiting purge.
type TrashedRadioTrack struct {
	ID      string
	BlobKey string
	Size    int64
}

// ListTrashedRadioTracks returns up to limit trashed radio tracks (oldest
// trash first) whose blobs and rows have not been purged yet.
func (r *Repository) ListTrashedRadioTracks(ctx context.Context, limit int) ([]TrashedRadioTrack, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id::text, blob_key, size FROM grown.music_tracks
		 WHERE source = 'radio' AND trashed_at IS NOT NULL
		 ORDER BY trashed_at, id LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("music.ListTrashedRadioTracks: %w", err)
	}
	defer rows.Close()
	var out []TrashedRadioTrack
	for rows.Next() {
		var t TrashedRadioTrack
		if err := rows.Scan(&t.ID, &t.BlobKey, &t.Size); err != nil {
			return nil, fmt.Errorf("music.ListTrashedRadioTracks scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteRadioTrackRows hard-deletes trashed radio track rows (likes/playlist
// memberships cascade). Only rows that are still trashed radio tracks are
// touched.
func (r *Repository) DeleteRadioTrackRows(ctx context.Context, ids []string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tag, err := r.pool.Exec(ctx,
		`DELETE FROM grown.music_tracks
		 WHERE id = ANY($1::uuid[]) AND source = 'radio' AND trashed_at IS NOT NULL`, ids)
	if err != nil {
		return 0, fmt.Errorf("music.DeleteRadioTrackRows: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// RadioBlobKeysExist reports which of keys are still referenced by any
// music_tracks row (live or trashed). Used by the orphan-object sweep.
func (r *Repository) RadioBlobKeysExist(ctx context.Context, keys []string) (map[string]bool, error) {
	out := make(map[string]bool, len(keys))
	if len(keys) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT blob_key FROM grown.music_tracks WHERE blob_key = ANY($1::text[])`, keys)
	if err != nil {
		return nil, fmt.Errorf("music.RadioBlobKeysExist: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, fmt.Errorf("music.RadioBlobKeysExist scan: %w", err)
		}
		out[k] = true
	}
	return out, rows.Err()
}

// RadioCacheUsage returns the bytes and song count of live radio tracks, for
// one org (orgID != "") or the whole instance (orgID == "").
func (r *Repository) RadioCacheUsage(ctx context.Context, orgID string) (bytes int64, count int, err error) {
	err = r.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(size),0), count(*) FROM grown.music_tracks
		 WHERE source = 'radio' AND trashed_at IS NULL AND ($1 = '' OR org_id::text = $1)`,
		orgID).Scan(&bytes, &count)
	if err != nil {
		return 0, 0, fmt.Errorf("music.RadioCacheUsage: %w", err)
	}
	return bytes, count, nil
}
