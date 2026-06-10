package music

import (
	"context"
	"io"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// authCtx returns a context carrying the seeded user + org, as the auth
// middleware would attach in a real request.
func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

// fakeBlobs records Delete calls so we can assert blob cleanup on delete.
type fakeBlobs struct{ deleted []string }

func (f *fakeBlobs) Put(_ context.Context, _, _ string, _ int64, _ io.Reader) error { return nil }
func (f *fakeBlobs) Get(_ context.Context, _ string) (io.ReadCloser, string, int64, error) {
	return io.NopCloser(nil), "", 0, nil
}
func (f *fakeBlobs) Delete(_ context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return nil
}

func TestService_TrackListGetUpdateDelete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	blobs := &fakeBlobs{}
	repo := NewRepository(pool)
	svc := NewService(repo, blobs)
	ctx := authCtx(orgID, userID)

	// Seed a track via the repo (upload itself is the HTTP path).
	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	list, err := svc.ListTracks(ctx, &grownv1.ListTracksRequest{})
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	if len(list.GetTracks()) != 1 {
		t.Fatalf("ListTracks len: got %d want 1", len(list.GetTracks()))
	}
	pt := list.GetTracks()[0]
	if pt.GetStreamUrl() != "/api/v1/music/"+tr.ID+"/content" {
		t.Errorf("stream url: got %q", pt.GetStreamUrl())
	}
	if pt.GetCreatedAt() == "" {
		t.Errorf("expected RFC3339 created_at")
	}

	got, err := svc.GetTrack(ctx, &grownv1.GetTrackRequest{Id: tr.ID})
	if err != nil {
		t.Fatalf("GetTrack: %v", err)
	}
	if got.GetTitle() != "My Song" || got.GetArtist() != "The Testers" || got.GetContentType() != "audio/mpeg" {
		t.Errorf("GetTrack mismatch: %+v", got)
	}

	upd, err := svc.UpdateTrack(ctx, &grownv1.UpdateTrackRequest{Id: tr.ID, Title: "Renamed", Artist: "A", Album: "B"})
	if err != nil {
		t.Fatalf("UpdateTrack: %v", err)
	}
	if upd.GetTitle() != "Renamed" || upd.GetArtist() != "A" || upd.GetAlbum() != "B" {
		t.Errorf("UpdateTrack not applied: %+v", upd)
	}

	if _, err := svc.DeleteTrack(ctx, &grownv1.DeleteTrackRequest{Id: tr.ID}); err != nil {
		t.Fatalf("DeleteTrack: %v", err)
	}
	if len(blobs.deleted) != 1 || blobs.deleted[0] != "music/abc123" {
		t.Errorf("expected blob cleanup, got %+v", blobs.deleted)
	}
	if _, err := svc.GetTrack(ctx, &grownv1.GetTrackRequest{Id: tr.ID}); status.Code(err) != codes.NotFound {
		t.Errorf("deleted track: want NotFound, got %v", err)
	}
}

func TestService_PlaylistLifecycle(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo, &fakeBlobs{})
	ctx := authCtx(orgID, userID)

	pl, err := svc.CreatePlaylist(ctx, &grownv1.CreatePlaylistRequest{Name: "Focus", Description: "deep work"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if pl.GetName() != "Focus" || pl.GetOwnerId() != userID || pl.GetTrackCount() != 0 {
		t.Errorf("unexpected created playlist: %+v", pl)
	}

	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("seed track: %v", err)
	}

	added, err := svc.AddTrackToPlaylist(ctx, &grownv1.AddTrackToPlaylistRequest{PlaylistId: pl.GetId(), TrackId: tr.ID})
	if err != nil {
		t.Fatalf("AddTrackToPlaylist: %v", err)
	}
	if added.GetTrackCount() != 1 || len(added.GetTracks()) != 1 || added.GetTracks()[0].GetId() != tr.ID {
		t.Errorf("after add: %+v", added)
	}

	listed, err := svc.ListPlaylists(ctx, &grownv1.ListPlaylistsRequest{})
	if err != nil {
		t.Fatalf("ListPlaylists: %v", err)
	}
	if len(listed.GetPlaylists()) != 1 || listed.GetPlaylists()[0].GetTrackCount() != 1 {
		t.Errorf("ListPlaylists: %+v", listed)
	}

	gotPl, err := svc.GetPlaylist(ctx, &grownv1.GetPlaylistRequest{Id: pl.GetId()})
	if err != nil {
		t.Fatalf("GetPlaylist: %v", err)
	}
	if len(gotPl.GetTracks()) != 1 {
		t.Errorf("GetPlaylist tracks: %+v", gotPl)
	}

	removed, err := svc.RemoveTrackFromPlaylist(ctx, &grownv1.RemoveTrackFromPlaylistRequest{PlaylistId: pl.GetId(), TrackId: tr.ID})
	if err != nil {
		t.Fatalf("RemoveTrackFromPlaylist: %v", err)
	}
	if removed.GetTrackCount() != 0 {
		t.Errorf("after remove: %+v", removed)
	}

	updPl, err := svc.UpdatePlaylist(ctx, &grownv1.UpdatePlaylistRequest{Id: pl.GetId(), Name: "Renamed", Description: "x"})
	if err != nil {
		t.Fatalf("UpdatePlaylist: %v", err)
	}
	if updPl.GetName() != "Renamed" {
		t.Errorf("UpdatePlaylist not applied: %+v", updPl)
	}

	if _, err := svc.DeletePlaylist(ctx, &grownv1.DeletePlaylistRequest{Id: pl.GetId()}); err != nil {
		t.Fatalf("DeletePlaylist: %v", err)
	}
	if _, err := svc.GetPlaylist(ctx, &grownv1.GetPlaylistRequest{Id: pl.GetId()}); status.Code(err) != codes.NotFound {
		t.Errorf("deleted playlist: want NotFound, got %v", err)
	}
}

func TestService_Unauthenticated(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool), &fakeBlobs{})
	if _, err := svc.ListTracks(context.Background(), &grownv1.ListTracksRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Errorf("ListTracks want Unauthenticated, got %v", err)
	}
	if _, err := svc.ListPlaylists(context.Background(), &grownv1.ListPlaylistsRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Errorf("ListPlaylists want Unauthenticated, got %v", err)
	}
}

func TestService_LikesAndListLiked(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo, &fakeBlobs{})
	ctx := authCtx(orgID, userID)

	tr, err := repo.CreateTrack(ctx, orgID, userID, sampleTrack())
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	// LikeTrack.
	if _, err := svc.LikeTrack(ctx, &grownv1.LikeTrackRequest{TrackId: tr.ID}); err != nil {
		t.Fatalf("LikeTrack: %v", err)
	}

	// ListTracks now returns liked=true for this track.
	list, err := svc.ListTracks(ctx, &grownv1.ListTracksRequest{})
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	if len(list.GetTracks()) != 1 || !list.GetTracks()[0].GetLiked() {
		t.Errorf("expected liked=true in ListTracks, got: %+v", list.GetTracks())
	}

	// ListLikedTracks includes the liked track.
	liked, err := svc.ListLikedTracks(ctx, &grownv1.ListLikedTracksRequest{})
	if err != nil {
		t.Fatalf("ListLikedTracks: %v", err)
	}
	if len(liked.GetTracks()) != 1 || liked.GetTracks()[0].GetId() != tr.ID {
		t.Errorf("ListLikedTracks: %+v", liked)
	}
	if !liked.GetTracks()[0].GetLiked() {
		t.Errorf("ListLikedTracks track should have liked=true")
	}

	// UnlikeTrack removes it.
	if _, err := svc.UnlikeTrack(ctx, &grownv1.UnlikeTrackRequest{TrackId: tr.ID}); err != nil {
		t.Fatalf("UnlikeTrack: %v", err)
	}
	liked2, err := svc.ListLikedTracks(ctx, &grownv1.ListLikedTracksRequest{})
	if err != nil {
		t.Fatalf("ListLikedTracks after unlike: %v", err)
	}
	if len(liked2.GetTracks()) != 0 {
		t.Errorf("expected 0 liked tracks after unlike, got %+v", liked2.GetTracks())
	}
}

func TestService_ReorderPlaylistTrack(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo, &fakeBlobs{})
	ctx := authCtx(orgID, userID)

	pl, err := svc.CreatePlaylist(ctx, &grownv1.CreatePlaylistRequest{Name: "Ordered"})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}

	tracks := make([]Track, 3)
	for i, name := range []string{"A", "B", "C"} {
		p := sampleTrack()
		p.Title = name
		p.BlobKey = "music/svc" + name
		tr, err := repo.CreateTrack(ctx, orgID, userID, p)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		tracks[i] = tr
		if _, err := svc.AddTrackToPlaylist(ctx, &grownv1.AddTrackToPlaylistRequest{PlaylistId: pl.GetId(), TrackId: tr.ID}); err != nil {
			t.Fatalf("add %s: %v", name, err)
		}
	}

	// Move track A (pos 0) to pos 2 → B, C, A.
	reordered, err := svc.ReorderPlaylistTrack(ctx, &grownv1.ReorderPlaylistTrackRequest{
		PlaylistId:  pl.GetId(),
		TrackId:     tracks[0].ID,
		NewPosition: 2,
	})
	if err != nil {
		t.Fatalf("ReorderPlaylistTrack: %v", err)
	}
	if len(reordered.GetTracks()) != 3 {
		t.Fatalf("expected 3 tracks, got %d", len(reordered.GetTracks()))
	}
	if reordered.GetTracks()[0].GetId() != tracks[1].ID {
		t.Errorf("expected B first, got %s", reordered.GetTracks()[0].GetId())
	}
	if reordered.GetTracks()[2].GetId() != tracks[0].ID {
		t.Errorf("expected A last, got %s", reordered.GetTracks()[2].GetId())
	}
}

func TestService_GetTrackNotFound(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), &fakeBlobs{})
	ctx := authCtx(orgID, userID)
	_, err := svc.GetTrack(ctx, &grownv1.GetTrackRequest{Id: "00000000-0000-0000-0000-000000000000"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("want NotFound, got %v", err)
	}
}
