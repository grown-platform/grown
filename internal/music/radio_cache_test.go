package music

import (
	"context"
	"testing"
	"time"
)

func TestParseByteSize(t *testing.T) {
	cases := map[string]int64{
		"0":      0,
		"1234":   1234,
		"5Gi":    5 << 30,
		"5GiB":   5 << 30,
		"5gi":    5 << 30,
		"5G":     5e9,
		"5GB":    5e9,
		"500M":   500e6,
		"500Mi":  500 << 20,
		"1.5Gi":  3 << 29,
		" 2 Ti ": 2 << 40,
		"10KB":   10e3,
		"100B":   100,
	}
	for in, want := range cases {
		got, err := ParseByteSize(in)
		if err != nil || got != want {
			t.Errorf("ParseByteSize(%q) = %d, %v; want %d", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "Gi", "-5Gi", "five", "5Xi"} {
		if _, err := ParseByteSize(bad); err == nil {
			t.Errorf("ParseByteSize(%q) should fail", bad)
		}
	}
}

func TestRadioCacheLimitsFromEnv(t *testing.T) {
	t.Setenv("GROWN_RADIO_CACHE_MAX_BYTES", "")
	t.Setenv("GROWN_RADIO_CACHE_MAX_DAYS", "")
	if l := RadioCacheLimitsFromEnv(); l.MaxBytes != DefaultRadioCacheMaxBytes || l.MaxDays != DefaultRadioCacheMaxDays {
		t.Fatalf("defaults = %+v", l)
	}
	t.Setenv("GROWN_RADIO_CACHE_MAX_BYTES", "2Gi")
	t.Setenv("GROWN_RADIO_CACHE_MAX_DAYS", "7")
	if l := RadioCacheLimitsFromEnv(); l.MaxBytes != 2<<30 || l.MaxDays != 7 || l.MaxAge() != 7*24*time.Hour {
		t.Fatalf("explicit = %+v", l)
	}
	t.Setenv("GROWN_RADIO_CACHE_MAX_BYTES", "0")
	t.Setenv("GROWN_RADIO_CACHE_MAX_DAYS", "0")
	if l := RadioCacheLimitsFromEnv(); l.MaxBytes != 0 || l.MaxDays != 0 || l.MaxAge() != 0 {
		t.Fatalf("0 must disable: %+v", l)
	}
	t.Setenv("GROWN_RADIO_CACHE_MAX_BYTES", "garbage")
	t.Setenv("GROWN_RADIO_CACHE_MAX_DAYS", "-3")
	if l := RadioCacheLimitsFromEnv(); l.MaxBytes != DefaultRadioCacheMaxBytes || l.MaxDays != DefaultRadioCacheMaxDays {
		t.Fatalf("invalid must fall back to defaults: %+v", l)
	}
}

// --- DB-backed ------------------------------------------------------------

// radioTrack inserts a radio track recorded ageDays ago.
func radioTrack(t *testing.T, repo *Repository, orgID, userID, stationID, key string, size int64, ageDays int) Track {
	t.Helper()
	ctx := context.Background()
	tr, err := repo.CreateRadioTrack(ctx, orgID, userID, CreateRadioTrackParams{
		Title: key, Artist: "A", Album: "FM", ContentType: "audio/mpeg",
		Size: size, DurationSeconds: 60, BlobKey: key, StationID: stationID,
	})
	if err != nil {
		t.Fatalf("CreateRadioTrack: %v", err)
	}
	if _, err := repo.pool.Exec(ctx,
		`UPDATE grown.music_tracks SET created_at = now() - make_interval(days => $2) WHERE id=$1`,
		tr.ID, ageDays); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	return tr
}

func TestRepository_NewStationDefaultsToBoundedRetention(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	s, err := repo.UpsertStation(ctx, orgID, StationFields{Name: "FM", StreamURL: "http://x/fm"})
	if err != nil {
		t.Fatal(err)
	}
	if s.RetentionMode != RetentionDays || s.RetentionDays != DefaultStationRetentionDays {
		t.Fatalf("new station retention = %s/%d", s.RetentionMode, s.RetentionDays)
	}
	// An explicit per-station override survives a re-upsert (seeder rerun).
	if _, err := repo.SetRetention(ctx, orgID, s.ID, RetentionKeep, 0); err != nil {
		t.Fatal(err)
	}
	s2, err := repo.UpsertStation(ctx, orgID, StationFields{Name: "FM 2", StreamURL: "http://x/fm"})
	if err != nil {
		t.Fatal(err)
	}
	if s2.ID != s.ID || s2.RetentionMode != RetentionKeep {
		t.Fatalf("re-upsert changed retention: %+v", s2)
	}
}

func TestRepository_RadioCacheLifecycle(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	st, err := repo.UpsertStation(ctx, orgID, StationFields{Name: "FM", StreamURL: "http://x/fm"})
	if err != nil {
		t.Fatal(err)
	}
	old := radioTrack(t, repo, orgID, userID, st.ID, "music/radio/old", 100, 20)
	liked := radioTrack(t, repo, orgID, userID, st.ID, "music/radio/liked", 200, 19)
	listed := radioTrack(t, repo, orgID, userID, st.ID, "music/radio/listed", 300, 18)
	inTrashedPl := radioTrack(t, repo, orgID, userID, st.ID, "music/radio/trashedpl", 400, 17)
	fresh := radioTrack(t, repo, orgID, userID, st.ID, "music/radio/fresh", 500, 1)
	// A non-radio upload must never be touched.
	upload, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatal(err)
	}

	if err := repo.LikeTrack(ctx, orgID, userID, liked.ID); err != nil {
		t.Fatal(err)
	}
	pl, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "keepers"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddTrackToPlaylist(ctx, orgID, pl.ID, listed.ID); err != nil {
		t.Fatal(err)
	}
	gone, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "binned"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddTrackToPlaylist(ctx, orgID, gone.ID, inTrashedPl.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.TrashPlaylist(ctx, orgID, gone.ID); err != nil {
		t.Fatal(err)
	}

	// Usage counts only radio tracks.
	used, n, err := repo.RadioCacheUsage(ctx, orgID)
	if err != nil || used != 1500 || n != 5 {
		t.Fatalf("usage = %d/%d, %v", used, n, err)
	}
	if all, _, _ := repo.RadioCacheUsage(ctx, ""); all != 1500 {
		t.Fatalf("instance usage = %d", all)
	}

	cands, err := repo.ListRadioCacheCandidates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 5 || cands[0].ID != old.ID || cands[4].ID != fresh.ID {
		t.Fatalf("candidates not oldest-first: %+v", cands)
	}
	saved := map[string]bool{}
	for _, c := range cands {
		saved[c.ID] = c.Saved
	}
	if saved[old.ID] || !saved[liked.ID] || !saved[listed.ID] || saved[inTrashedPl.ID] || saved[fresh.ID] {
		t.Fatalf("saved flags wrong: %v", saved)
	}

	// Per-station retention (14 days by default) skips saved tracks.
	n, err = repo.SweepExpiredRadioTracks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 { // old + inTrashedPl
		t.Fatalf("station sweep trashed %d, want 2", n)
	}

	// TrashRadioTracks re-checks "saved" atomically and ignores uploads.
	n, err = repo.TrashRadioTracks(ctx, []string{liked.ID, listed.ID, fresh.ID, upload.ID})
	if err != nil || n != 1 {
		t.Fatalf("TrashRadioTracks = %d, %v; want 1 (fresh only)", n, err)
	}

	trashed, err := repo.ListTrashedRadioTracks(ctx, 10)
	if err != nil || len(trashed) != 3 {
		t.Fatalf("trashed = %+v, %v", trashed, err)
	}
	var ids []string
	for _, tr := range trashed {
		ids = append(ids, tr.ID)
	}
	exists, err := repo.RadioBlobKeysExist(ctx, []string{"music/radio/old", "music/radio/nope"})
	if err != nil || !exists["music/radio/old"] || exists["music/radio/nope"] {
		t.Fatalf("exists = %v, %v", exists, err)
	}
	n, err = repo.DeleteRadioTrackRows(ctx, append(ids, liked.ID, upload.ID))
	if err != nil || n != 3 {
		t.Fatalf("DeleteRadioTrackRows = %d, %v; want 3", n, err)
	}
	if exists, _ := repo.RadioBlobKeysExist(ctx, []string{"music/radio/old"}); exists["music/radio/old"] {
		t.Fatal("row for old should be gone")
	}
	// The trashed playlist's membership row cascaded away with the track.
	var members int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM grown.music_playlist_tracks WHERE track_id=$1`, inTrashedPl.ID).Scan(&members); err != nil || members != 0 {
		t.Fatalf("membership left = %d, %v", members, err)
	}
	if _, err := repo.GetTrack(ctx, orgID, liked.ID); err != nil {
		t.Fatalf("liked track must survive: %v", err)
	}
	if _, err := repo.GetTrack(ctx, orgID, upload.ID); err != nil {
		t.Fatalf("upload must survive: %v", err)
	}
}
