package radio

import (
	"context"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/music"
	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestJanitor_DB drives the janitor against the real repository (Postgres)
// with an in-memory blob store: cap eviction, saved-track protection, keep-
// forever stations, legacy trashed rows and object deletion end to end.
func TestJanitor_DB(t *testing.T) {
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatal(err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var orgID, userID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','s1','t@grown.localtest.me','T') RETURNING id::text`, orgID).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	repo := music.NewRepository(pool)
	store := newMemStore()

	// A legacy "keep forever" station, like the demo's seeded ones.
	st, err := repo.UpsertStation(ctx, orgID, music.StationFields{Name: "FM", StreamURL: "http://x/fm"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetRetention(ctx, orgID, st.ID, music.RetentionKeep, 0); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for i, name := range []string{"s1", "s2", "s3", "s4", "s5"} {
		key := blobPrefix + name
		_ = store.Put(ctx, key, "audio/mpeg", 1000, nil)
		tr, err := repo.CreateRadioTrack(ctx, orgID, userID, music.CreateRadioTrackParams{
			Title: name, Artist: "A", Size: 1000, BlobKey: key, StationID: st.ID, ContentType: "audio/mpeg",
		})
		if err != nil {
			t.Fatal(err)
		}
		// s1 is the oldest (5 days), s5 the newest (1 day).
		if _, err := pool.Exec(ctx, `UPDATE grown.music_tracks SET created_at = now() - make_interval(days => $2) WHERE id=$1`,
			tr.ID, 5-i); err != nil {
			t.Fatal(err)
		}
		ids[name] = tr.ID
	}
	// s1 (oldest) is a user's favourite.
	if err := repo.LikeTrack(ctx, orgID, userID, ids["s1"]); err != nil {
		t.Fatal(err)
	}
	// A legacy row trashed earlier whose object survived (the old sweeper
	// ignored delete errors): the purge must remove both.
	_ = store.Put(ctx, blobPrefix+"legacy", "audio/mpeg", 777, nil)
	if _, err := repo.CreateRadioTrack(ctx, orgID, userID, music.CreateRadioTrackParams{
		Title: "legacy", Size: 777, BlobKey: blobPrefix + "legacy", StationID: st.ID, ContentType: "audio/mpeg",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE grown.music_tracks SET trashed_at=now() WHERE title='legacy'`); err != nil {
		t.Fatal(err)
	}

	// Cap 2500 of 5000 bytes → evict the oldest unsaved until ≤ 2500: s2, s3, s4
	// (s1 is liked and still counts toward the total).
	j := NewJanitor(repo, store, music.RadioCacheLimits{MaxBytes: 2500, MaxDays: 30}, time.Hour)
	rep, err := j.RunOnce(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if rep.CapEvicted != 3 || rep.Purged != 4 || rep.PurgedBytes != 3777 {
		t.Fatalf("report = %+v", rep)
	}
	for _, n := range []string{"s2", "s3", "s4", "legacy"} {
		if store.has(blobPrefix + n) {
			t.Errorf("object %s still stored", n)
		}
	}
	for _, n := range []string{"s1", "s5"} {
		if !store.has(blobPrefix + n) {
			t.Errorf("object %s wrongly deleted", n)
		}
		if _, err := repo.GetTrack(ctx, orgID, ids[n]); err != nil {
			t.Errorf("track %s wrongly deleted: %v", n, err)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM grown.music_tracks WHERE source='radio'`).Scan(&rows); err != nil || rows != 2 {
		t.Fatalf("radio rows left = %d, %v (rows must be hard-deleted)", rows, err)
	}
	used, _, _ := repo.RadioCacheUsage(ctx, "")
	if used != 2000 {
		t.Fatalf("usage after sweep = %d", used)
	}
	// Idempotent.
	if rep, err := j.RunOnce(ctx, true); err != nil || rep != (SweepReport{}) {
		t.Fatalf("second pass = %+v, %v", rep, err)
	}
}
