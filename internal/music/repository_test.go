package music

import (
	"context"
	"errors"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so music rows can satisfy their foreign keys. Skips unless
// GROWN_TEST_DSN points at a throwaway Postgres.
func setupDB(t *testing.T) (*pgxpool.Pool, string, string) {
	t.Helper()
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	var orgID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', 'subject-1', 'tester@grown.localtest.me', 'Tester')
		 RETURNING id::text`, orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func sampleTrack() CreateTrackParams {
	return CreateTrackParams{
		Title:           "My Song",
		Artist:          "The Testers",
		Album:           "Greatest Hits",
		ContentType:     "audio/mpeg",
		Size:            1234,
		DurationSeconds: 42.5,
		ArtworkDataURL:  "data:image/png;base64,AAAA",
		BlobKey:         "music/abc123",
	}
}

func TestRepository_CreateAndGetTrack(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	created, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if created.Title != "My Song" || created.Artist != "The Testers" || created.Album != "Greatest Hits" {
		t.Errorf("unexpected create result: %+v", created)
	}
	if created.ContentType != "audio/mpeg" || created.Size != 1234 || created.DurationSeconds != 42.5 {
		t.Errorf("content/size/duration mismatch: %+v", created)
	}
	if created.OrgID != orgID || created.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", created)
	}

	got, err := repo.GetTrack(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("GetTrack: %v", err)
	}
	if got.ID != created.ID || got.BlobKey != "music/abc123" {
		t.Errorf("GetTrack mismatch: %+v", got)
	}
}

func TestRepository_GetTrack_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.GetTrack(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestRepository_ListTracks(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p1 := sampleTrack()
	p1.Title = "First"
	p1.BlobKey = "music/1"
	first, err := repo.CreateTrack(ctx, orgID, userID, p1)
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	p2 := sampleTrack()
	p2.Title = "Second"
	p2.BlobKey = "music/2"
	second, err := repo.CreateTrack(ctx, orgID, userID, p2)
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	list, err := repo.ListTracks(ctx, orgID)
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 tracks, got %d", len(list))
	}
	ids := map[string]bool{list[0].ID: true, list[1].ID: true}
	if !ids[first.ID] || !ids[second.ID] {
		t.Errorf("missing tracks in list: %+v", list)
	}
}

func TestRepository_UpdateTrack(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}
	updated, err := repo.UpdateTrack(ctx, orgID, tr.ID, TrackFields{
		Title: "Renamed", Artist: "New Artist", Album: "New Album", ArtworkDataURL: "data:image/png;base64,BBBB",
	})
	if err != nil {
		t.Fatalf("UpdateTrack: %v", err)
	}
	if updated.Title != "Renamed" || updated.Artist != "New Artist" || updated.Album != "New Album" {
		t.Errorf("update not applied: %+v", updated)
	}
	if updated.ArtworkDataURL != "data:image/png;base64,BBBB" {
		t.Errorf("artwork not updated: %+v", updated)
	}
	// Immutable fields are preserved.
	if updated.ContentType != "audio/mpeg" || updated.Size != 1234 || updated.BlobKey != "music/abc123" {
		t.Errorf("immutable fields changed: %+v", updated)
	}
}

func TestRepository_UpdateTrack_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.UpdateTrack(context.Background(), orgID, "00000000-0000-0000-0000-000000000000", TrackFields{Title: "x"})
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestRepository_TrashTrack(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}
	blobKey, err := repo.TrashTrack(ctx, orgID, tr.ID)
	if err != nil {
		t.Fatalf("TrashTrack: %v", err)
	}
	if blobKey != "music/abc123" {
		t.Errorf("want blob key returned, got %q", blobKey)
	}
	if _, err := repo.GetTrack(ctx, orgID, tr.ID); err != ErrNotFound {
		t.Errorf("trashed track still visible: %v", err)
	}
	list, err := repo.ListTracks(ctx, orgID)
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("trashed track appears in list: %+v", list)
	}
	// Double-trash is a no-op (already gone).
	if _, err := repo.TrashTrack(ctx, orgID, tr.ID); err != ErrNotFound {
		t.Errorf("re-trash want ErrNotFound, got %v", err)
	}
}

func TestRepository_PlaylistCRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	pl, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "Roadtrip", Description: "vibes"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if pl.ID == "" || pl.Name != "Roadtrip" || pl.Description != "vibes" {
		t.Errorf("unexpected playlist: %+v", pl)
	}
	if pl.OrgID != orgID || pl.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", pl)
	}

	got, err := repo.GetPlaylist(ctx, orgID, pl.ID)
	if err != nil {
		t.Fatalf("GetPlaylist: %v", err)
	}
	if got.TrackCount != 0 || len(got.Tracks) != 0 {
		t.Errorf("new playlist should be empty: %+v", got)
	}

	upd, err := repo.UpdatePlaylist(ctx, orgID, pl.ID, PlaylistFields{Name: "Renamed", Description: "d2"})
	if err != nil {
		t.Fatalf("UpdatePlaylist: %v", err)
	}
	if upd.Name != "Renamed" || upd.Description != "d2" {
		t.Errorf("update not applied: %+v", upd)
	}

	list, err := repo.ListPlaylists(ctx, orgID)
	if err != nil {
		t.Fatalf("ListPlaylists: %v", err)
	}
	if len(list) != 1 || list[0].Name != "Renamed" {
		t.Errorf("unexpected playlist list: %+v", list)
	}

	if err := repo.TrashPlaylist(ctx, orgID, pl.ID); err != nil {
		t.Fatalf("TrashPlaylist: %v", err)
	}
	if _, err := repo.GetPlaylist(ctx, orgID, pl.ID); err != ErrNotFound {
		t.Errorf("trashed playlist still visible: %v", err)
	}
	if err := repo.TrashPlaylist(ctx, orgID, pl.ID); err != ErrNotFound {
		t.Errorf("re-trash want ErrNotFound, got %v", err)
	}
}

func TestRepository_PlaylistTrackMembership(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	pl, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "Mix"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	p1 := sampleTrack()
	p1.Title = "Track A"
	p1.BlobKey = "music/a"
	ta, err := repo.CreateTrack(ctx, orgID, userID, p1)
	if err != nil {
		t.Fatalf("create track a: %v", err)
	}
	p2 := sampleTrack()
	p2.Title = "Track B"
	p2.BlobKey = "music/b"
	tb, err := repo.CreateTrack(ctx, orgID, userID, p2)
	if err != nil {
		t.Fatalf("create track b: %v", err)
	}

	got, err := repo.AddTrackToPlaylist(ctx, orgID, pl.ID, ta.ID)
	if err != nil {
		t.Fatalf("AddTrackToPlaylist a: %v", err)
	}
	if got.TrackCount != 1 || len(got.Tracks) != 1 || got.Tracks[0].ID != ta.ID {
		t.Errorf("after add a: %+v", got)
	}
	got, err = repo.AddTrackToPlaylist(ctx, orgID, pl.ID, tb.ID)
	if err != nil {
		t.Fatalf("AddTrackToPlaylist b: %v", err)
	}
	if got.TrackCount != 2 {
		t.Fatalf("after add b, want 2: %+v", got)
	}
	// Ordering: a was added first, so it should sort ahead of b.
	if got.Tracks[0].ID != ta.ID || got.Tracks[1].ID != tb.ID {
		t.Errorf("playlist order wrong: %+v", got.Tracks)
	}

	// Re-adding is idempotent.
	got, err = repo.AddTrackToPlaylist(ctx, orgID, pl.ID, ta.ID)
	if err != nil {
		t.Fatalf("re-add a: %v", err)
	}
	if got.TrackCount != 2 {
		t.Errorf("re-add should be no-op, got count %d", got.TrackCount)
	}

	// ListPlaylists reports the count.
	list, err := repo.ListPlaylists(ctx, orgID)
	if err != nil {
		t.Fatalf("ListPlaylists: %v", err)
	}
	if len(list) != 1 || list[0].TrackCount != 2 {
		t.Errorf("list track_count wrong: %+v", list)
	}

	// Removing a track drops it from the playlist.
	got, err = repo.RemoveTrackFromPlaylist(ctx, orgID, pl.ID, ta.ID)
	if err != nil {
		t.Fatalf("RemoveTrackFromPlaylist: %v", err)
	}
	if got.TrackCount != 1 || got.Tracks[0].ID != tb.ID {
		t.Errorf("after remove a: %+v", got)
	}

	// Trashing a track removes it from playlists too.
	if _, err := repo.TrashTrack(ctx, orgID, tb.ID); err != nil {
		t.Fatalf("TrashTrack b: %v", err)
	}
	got, err = repo.GetPlaylist(ctx, orgID, pl.ID)
	if err != nil {
		t.Fatalf("GetPlaylist after trash: %v", err)
	}
	if got.TrackCount != 0 {
		t.Errorf("trashed track still in playlist: %+v", got)
	}
}

func TestRepository_AddTrack_CrossEntityNotFound(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	pl, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "Mix"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	// Adding a non-existent track is NotFound.
	if _, err := repo.AddTrackToPlaylist(ctx, orgID, pl.ID, "00000000-0000-0000-0000-000000000000"); err != ErrNotFound {
		t.Errorf("add missing track: want ErrNotFound, got %v", err)
	}
	// Adding to a non-existent playlist is NotFound.
	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}
	if _, err := repo.AddTrackToPlaylist(ctx, orgID, "00000000-0000-0000-0000-000000000000", tr.ID); err != ErrNotFound {
		t.Errorf("add to missing playlist: want ErrNotFound, got %v", err)
	}
}

func TestRepository_ReorderPlaylistTrack(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	pl, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "Reorder"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	// Create three tracks and add them in order A→B→C.
	tracks := make([]Track, 3)
	for i, name := range []string{"A", "B", "C"} {
		p := sampleTrack()
		p.Title = name
		p.BlobKey = "music/" + name
		tr, err := repo.CreateTrack(ctx, orgID, userID, p)
		if err != nil {
			t.Fatalf("create track %s: %v", name, err)
		}
		tracks[i] = tr
		if _, err := repo.AddTrackToPlaylist(ctx, orgID, pl.ID, tr.ID); err != nil {
			t.Fatalf("add track %s: %v", name, err)
		}
	}

	// Move A (index 0) to position 2 → expected order B, C, A.
	got, err := repo.ReorderPlaylistTrack(ctx, orgID, pl.ID, tracks[0].ID, 2)
	if err != nil {
		t.Fatalf("ReorderPlaylistTrack: %v", err)
	}
	if len(got.Tracks) != 3 {
		t.Fatalf("expected 3 tracks, got %d", len(got.Tracks))
	}
	want := []string{tracks[1].ID, tracks[2].ID, tracks[0].ID}
	for i, tr := range got.Tracks {
		if tr.ID != want[i] {
			t.Errorf("position %d: want %s got %s", i, want[i], tr.ID)
		}
	}

	// Move C (now index 1) back to position 0 → expected order C, B, A.
	got, err = repo.ReorderPlaylistTrack(ctx, orgID, pl.ID, tracks[2].ID, 0)
	if err != nil {
		t.Fatalf("ReorderPlaylistTrack 2: %v", err)
	}
	if got.Tracks[0].ID != tracks[2].ID {
		t.Errorf("after second reorder: want %s first, got %s", tracks[2].ID, got.Tracks[0].ID)
	}

	// Reorder non-existent track returns ErrNotFound.
	if _, err := repo.ReorderPlaylistTrack(ctx, orgID, pl.ID, "00000000-0000-0000-0000-000000000000", 0); !errors.Is(err, ErrNotFound) {
		t.Errorf("want ErrNotFound for missing track, got %v", err)
	}
}

func TestRepository_LikeUnlike(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}

	// Initially not liked.
	liked, err := repo.IsLiked(ctx, userID, tr.ID)
	if err != nil {
		t.Fatalf("IsLiked: %v", err)
	}
	if liked {
		t.Error("expected not liked initially")
	}

	// Like it.
	if err := repo.LikeTrack(ctx, orgID, userID, tr.ID); err != nil {
		t.Fatalf("LikeTrack: %v", err)
	}
	liked, err = repo.IsLiked(ctx, userID, tr.ID)
	if err != nil {
		t.Fatalf("IsLiked after like: %v", err)
	}
	if !liked {
		t.Error("expected liked after LikeTrack")
	}

	// Idempotent re-like.
	if err := repo.LikeTrack(ctx, orgID, userID, tr.ID); err != nil {
		t.Fatalf("re-LikeTrack: %v", err)
	}

	// Unlike.
	if err := repo.UnlikeTrack(ctx, orgID, userID, tr.ID); err != nil {
		t.Fatalf("UnlikeTrack: %v", err)
	}
	liked, err = repo.IsLiked(ctx, userID, tr.ID)
	if err != nil {
		t.Fatalf("IsLiked after unlike: %v", err)
	}
	if liked {
		t.Error("expected not liked after UnlikeTrack")
	}

	// Like a missing track returns ErrNotFound.
	if err := repo.LikeTrack(ctx, orgID, userID, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, ErrNotFound) {
		t.Errorf("like missing track: want ErrNotFound, got %v", err)
	}
}

func TestRepository_ListLikedTracks(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Seed a second user (same org).
	var userID2 string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', 'subject-2', 'tester2@grown.localtest.me', 'Tester2')
		 RETURNING id::text`, orgID).Scan(&userID2); err != nil {
		t.Fatalf("seed user2: %v", err)
	}

	p1 := sampleTrack()
	p1.Title = "Track X"
	p1.BlobKey = "music/x"
	tx, err := repo.CreateTrack(ctx, orgID, userID, p1)
	if err != nil {
		t.Fatalf("create x: %v", err)
	}
	p2 := sampleTrack()
	p2.Title = "Track Y"
	p2.BlobKey = "music/y"
	ty, err := repo.CreateTrack(ctx, orgID, userID, p2)
	if err != nil {
		t.Fatalf("create y: %v", err)
	}

	// user1 likes both; user2 likes only y.
	if err := repo.LikeTrack(ctx, orgID, userID, tx.ID); err != nil {
		t.Fatalf("like x: %v", err)
	}
	if err := repo.LikeTrack(ctx, orgID, userID, ty.ID); err != nil {
		t.Fatalf("like y: %v", err)
	}
	if err := repo.LikeTrack(ctx, orgID, userID2, ty.ID); err != nil {
		t.Fatalf("user2 like y: %v", err)
	}

	list1, err := repo.ListLikedTracks(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("ListLikedTracks user1: %v", err)
	}
	if len(list1) != 2 {
		t.Errorf("user1 want 2 liked, got %d", len(list1))
	}

	list2, err := repo.ListLikedTracks(ctx, orgID, userID2)
	if err != nil {
		t.Fatalf("ListLikedTracks user2: %v", err)
	}
	if len(list2) != 1 || list2[0].ID != ty.ID {
		t.Errorf("user2 want 1 liked (y), got %+v", list2)
	}

	// LikedSet annotates correctly.
	s, err := repo.LikedSet(ctx, userID, []string{tx.ID, ty.ID})
	if err != nil {
		t.Fatalf("LikedSet: %v", err)
	}
	if !s[tx.ID] || !s[ty.ID] {
		t.Errorf("LikedSet wrong: %+v", s)
	}
	s2, err := repo.LikedSet(ctx, userID2, []string{tx.ID, ty.ID})
	if err != nil {
		t.Fatalf("LikedSet user2: %v", err)
	}
	if s2[tx.ID] || !s2[ty.ID] {
		t.Errorf("LikedSet user2 wrong: %+v", s2)
	}
}

func TestRepository_LikedOrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other2', 'Other2') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}

	// Attempting to like a track from a different org returns ErrNotFound.
	if err := repo.LikeTrack(ctx, otherOrg, userID, tr.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("cross-org like: want ErrNotFound, got %v", err)
	}
}

func TestRepository_OrgScoping(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// A second org cannot see or mutate the first org's track/playlist.
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other', 'Other Org') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("CreateTrack: %v", err)
	}
	if _, err := repo.GetTrack(ctx, otherOrg, tr.ID); err != ErrNotFound {
		t.Errorf("cross-org GetTrack should be NotFound, got %v", err)
	}
	if _, err := repo.UpdateTrack(ctx, otherOrg, tr.ID, TrackFields{Title: "hax"}); err != ErrNotFound {
		t.Errorf("cross-org UpdateTrack should be NotFound, got %v", err)
	}
	if _, err := repo.TrashTrack(ctx, otherOrg, tr.ID); err != ErrNotFound {
		t.Errorf("cross-org TrashTrack should be NotFound, got %v", err)
	}
	tracks, err := repo.ListTracks(ctx, otherOrg)
	if err != nil {
		t.Fatalf("ListTracks other: %v", err)
	}
	if len(tracks) != 0 {
		t.Errorf("other org sees foreign tracks: %+v", tracks)
	}

	pl, err := repo.CreatePlaylist(ctx, orgID, userID, PlaylistFields{Name: "Mine"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if _, err := repo.GetPlaylist(ctx, otherOrg, pl.ID); err != ErrNotFound {
		t.Errorf("cross-org GetPlaylist should be NotFound, got %v", err)
	}
	if err := repo.TrashPlaylist(ctx, otherOrg, pl.ID); err != ErrNotFound {
		t.Errorf("cross-org TrashPlaylist should be NotFound, got %v", err)
	}
	playlists, err := repo.ListPlaylists(ctx, otherOrg)
	if err != nil {
		t.Fatalf("ListPlaylists other: %v", err)
	}
	if len(playlists) != 0 {
		t.Errorf("other org sees foreign playlists: %+v", playlists)
	}
}
