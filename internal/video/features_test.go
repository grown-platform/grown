package video

import (
	"context"
	"testing"
)

// ---------------------------------------------------------------------------
// Playlist tests
// ---------------------------------------------------------------------------

func TestPlaylist_CRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewPlaylistRepository(pool)
	ctx := context.Background()

	// Create
	pl, err := repo.CreatePlaylist(ctx, orgID, userID, "My Playlist")
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if pl.ID == "" || pl.Name != "My Playlist" {
		t.Errorf("unexpected create result: %+v", pl)
	}

	// List
	list, err := repo.ListPlaylists(ctx, orgID)
	if err != nil {
		t.Fatalf("ListPlaylists: %v", err)
	}
	if len(list) != 1 || list[0].ID != pl.ID {
		t.Errorf("list mismatch: %+v", list)
	}

	// Update
	updated, err := repo.UpdatePlaylist(ctx, orgID, pl.ID, "Renamed")
	if err != nil {
		t.Fatalf("UpdatePlaylist: %v", err)
	}
	if updated.Name != "Renamed" {
		t.Errorf("update not applied: %+v", updated)
	}

	// Delete
	if err := repo.DeletePlaylist(ctx, orgID, pl.ID); err != nil {
		t.Fatalf("DeletePlaylist: %v", err)
	}
	list2, _ := repo.ListPlaylists(ctx, orgID)
	if len(list2) != 0 {
		t.Errorf("playlist still visible after delete: %+v", list2)
	}
}

func TestPlaylist_AddRemoveReorder(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	ctx := context.Background()
	vRepo := NewRepository(pool)
	pRepo := NewPlaylistRepository(pool)

	pl, _ := pRepo.CreatePlaylist(ctx, orgID, userID, "Test")

	// Create two videos.
	p1 := sampleParams()
	p1.Title = "V1"
	p1.BlobKey = "video/feat-v1"
	v1, err := vRepo.Create(ctx, orgID, userID, p1)
	if err != nil {
		t.Fatalf("create v1: %v", err)
	}
	p2 := sampleParams()
	p2.Title = "V2"
	p2.BlobKey = "video/feat-v2"
	v2, err := vRepo.Create(ctx, orgID, userID, p2)
	if err != nil {
		t.Fatalf("create v2: %v", err)
	}

	if err := pRepo.AddToPlaylist(ctx, orgID, pl.ID, v1.ID); err != nil {
		t.Fatalf("AddToPlaylist v1: %v", err)
	}
	if err := pRepo.AddToPlaylist(ctx, orgID, pl.ID, v2.ID); err != nil {
		t.Fatalf("AddToPlaylist v2: %v", err)
	}

	videos, err := pRepo.ListPlaylistVideos(ctx, orgID, pl.ID)
	if err != nil {
		t.Fatalf("ListPlaylistVideos: %v", err)
	}
	if len(videos) != 2 {
		t.Fatalf("want 2 videos in playlist, got %d", len(videos))
	}

	// Reorder: put v2 first.
	if err := pRepo.ReorderPlaylist(ctx, orgID, pl.ID, []string{v2.ID, v1.ID}); err != nil {
		t.Fatalf("ReorderPlaylist: %v", err)
	}
	reordered, err := pRepo.ListPlaylistVideos(ctx, orgID, pl.ID)
	if err != nil {
		t.Fatalf("ListPlaylistVideos after reorder: %v", err)
	}
	if reordered[0].ID != v2.ID {
		t.Errorf("reorder: want v2 first, got %+v", reordered)
	}

	// Remove v1.
	if err := pRepo.RemoveFromPlaylist(ctx, orgID, pl.ID, v1.ID); err != nil {
		t.Fatalf("RemoveFromPlaylist: %v", err)
	}
	after, err := pRepo.ListPlaylistVideos(ctx, orgID, pl.ID)
	if err != nil {
		t.Fatalf("ListPlaylistVideos after remove: %v", err)
	}
	if len(after) != 1 || after[0].ID != v2.ID {
		t.Errorf("after remove want [v2], got %+v", after)
	}
}

func TestPlaylist_OrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	ctx := context.Background()
	pRepo := NewPlaylistRepository(pool)

	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other-pl', 'Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	pl, _ := pRepo.CreatePlaylist(ctx, orgID, userID, "Org A Playlist")

	// Other org cannot see or delete it.
	_, err := pRepo.GetPlaylist(ctx, otherOrg, pl.ID)
	if err != ErrPlaylistNotFound {
		t.Errorf("cross-org Get: want ErrPlaylistNotFound, got %v", err)
	}
	if err := pRepo.DeletePlaylist(ctx, otherOrg, pl.ID); err != ErrPlaylistNotFound {
		t.Errorf("cross-org Delete: want ErrPlaylistNotFound, got %v", err)
	}
	list, _ := pRepo.ListPlaylists(ctx, otherOrg)
	if len(list) != 0 {
		t.Errorf("cross-org List should be empty, got %+v", list)
	}
}

// ---------------------------------------------------------------------------
// Progress tests
// ---------------------------------------------------------------------------

func TestProgress_UpsertAndGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	ctx := context.Background()
	vRepo := NewRepository(pool)
	pRepo := NewProgressRepository(pool)

	v, _ := vRepo.Create(ctx, orgID, userID, sampleParams())

	// First upsert — not yet watched.
	prog, err := pRepo.Upsert(ctx, userID, v.ID, 30.0, 0.5)
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if prog.Percent != 0.5 || prog.Watched {
		t.Errorf("unexpected progress after 50%%: %+v", prog)
	}

	// Get should return same values.
	got, err := pRepo.Get(ctx, userID, v.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.PositionSeconds != 30.0 {
		t.Errorf("position mismatch: %+v", got)
	}

	// Get for unknown video returns zero-value (no error).
	zero, err := pRepo.Get(ctx, userID, "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("Get unknown: %v", err)
	}
	if zero.Watched || zero.Percent != 0 {
		t.Errorf("zero-value mismatch: %+v", zero)
	}
}

func TestProgress_WatchedThreshold(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	ctx := context.Background()
	vRepo := NewRepository(pool)
	pRepo := NewProgressRepository(pool)

	p1 := sampleParams()
	p1.BlobKey = "video/prog-threshold"
	v, _ := vRepo.Create(ctx, orgID, userID, p1)

	// 96% — should flip watched.
	prog, err := pRepo.Upsert(ctx, userID, v.ID, 40.3, 0.96)
	if err != nil {
		t.Fatalf("Upsert at 96%%: %v", err)
	}
	if !prog.Watched {
		t.Errorf("expected watched=true at 96%%, got %+v", prog)
	}

	// Rewatching at 10% should NOT clear watched (once watched, stay watched).
	prog2, err := pRepo.Upsert(ctx, userID, v.ID, 5.0, 0.10)
	if err != nil {
		t.Fatalf("Upsert at 10%%: %v", err)
	}
	if !prog2.Watched {
		t.Errorf("watched should stay true even after rewinding: %+v", prog2)
	}
}

// ---------------------------------------------------------------------------
// Caption tests
// ---------------------------------------------------------------------------

func TestCaption_CreateListDelete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	ctx := context.Background()
	vRepo := NewRepository(pool)
	cRepo := NewCaptionRepository(pool)

	p1 := sampleParams()
	p1.BlobKey = "video/caption-test"
	v, _ := vRepo.Create(ctx, orgID, userID, p1)

	c, err := cRepo.CreateCaption(ctx, orgID, v.ID, "en", "English", "caption/abc")
	if err != nil {
		t.Fatalf("CreateCaption: %v", err)
	}
	if c.ID == "" || c.Lang != "en" {
		t.Errorf("unexpected caption: %+v", c)
	}

	list, err := cRepo.ListCaptions(ctx, orgID, v.ID)
	if err != nil {
		t.Fatalf("ListCaptions: %v", err)
	}
	if len(list) != 1 || list[0].ID != c.ID {
		t.Errorf("list mismatch: %+v", list)
	}

	blobKey, err := cRepo.DeleteCaption(ctx, orgID, v.ID, c.ID)
	if err != nil {
		t.Fatalf("DeleteCaption: %v", err)
	}
	if blobKey != "caption/abc" {
		t.Errorf("wrong blob key returned: %q", blobKey)
	}
	list2, _ := cRepo.ListCaptions(ctx, orgID, v.ID)
	if len(list2) != 0 {
		t.Errorf("caption still visible after delete: %+v", list2)
	}

	// Delete non-existent returns ErrCaptionNotFound.
	if _, err := cRepo.DeleteCaption(ctx, orgID, v.ID, c.ID); err != ErrCaptionNotFound {
		t.Errorf("re-delete: want ErrCaptionNotFound, got %v", err)
	}
}

func TestCaption_OrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	ctx := context.Background()
	vRepo := NewRepository(pool)
	cRepo := NewCaptionRepository(pool)

	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other-cap', 'Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	p1 := sampleParams()
	p1.BlobKey = "video/cap-iso"
	v, _ := vRepo.Create(ctx, orgID, userID, p1)
	c, _ := cRepo.CreateCaption(ctx, orgID, v.ID, "en", "English", "caption/xyz")

	// Other org cannot delete it.
	if _, err := cRepo.DeleteCaption(ctx, otherOrg, v.ID, c.ID); err != ErrCaptionNotFound {
		t.Errorf("cross-org delete: want ErrCaptionNotFound, got %v", err)
	}
}
