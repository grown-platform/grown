package video

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

func TestService_ListGetUpdateDelete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	blobs := &fakeBlobs{}
	repo := NewRepository(pool)
	svc := NewService(repo, nil, blobs, "")
	ctx := authCtx(orgID, userID)

	// Seed a video via the repo (upload itself is the HTTP path).
	v, err := repo.Create(ctx, orgID, userID, sampleParams())
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	list, err := svc.ListVideos(ctx, &grownv1.ListVideosRequest{})
	if err != nil {
		t.Fatalf("ListVideos: %v", err)
	}
	if len(list.GetVideos()) != 1 {
		t.Fatalf("ListVideos len: got %d want 1", len(list.GetVideos()))
	}
	pv := list.GetVideos()[0]
	if pv.GetStreamUrl() != "/api/v1/videos/"+v.ID+"/content" {
		t.Errorf("stream url: got %q", pv.GetStreamUrl())
	}
	if pv.GetCreatedAt() == "" {
		t.Errorf("expected RFC3339 created_at")
	}

	got, err := svc.GetVideo(ctx, &grownv1.GetVideoRequest{Id: v.ID})
	if err != nil {
		t.Fatalf("GetVideo: %v", err)
	}
	if got.GetTitle() != "My Clip" || got.GetContentType() != "video/mp4" {
		t.Errorf("GetVideo mismatch: %+v", got)
	}

	upd, err := svc.UpdateVideo(ctx, &grownv1.UpdateVideoRequest{Id: v.ID, Title: "Renamed", Description: "d"})
	if err != nil {
		t.Fatalf("UpdateVideo: %v", err)
	}
	if upd.GetTitle() != "Renamed" || upd.GetDescription() != "d" {
		t.Errorf("UpdateVideo not applied: %+v", upd)
	}

	if _, err := svc.DeleteVideo(ctx, &grownv1.DeleteVideoRequest{Id: v.ID}); err != nil {
		t.Fatalf("DeleteVideo: %v", err)
	}
	if len(blobs.deleted) != 1 || blobs.deleted[0] != "video/abc123" {
		t.Errorf("expected blob cleanup, got %+v", blobs.deleted)
	}
	if _, err := svc.GetVideo(ctx, &grownv1.GetVideoRequest{Id: v.ID}); status.Code(err) != codes.NotFound {
		t.Errorf("deleted video: want NotFound, got %v", err)
	}
}

func TestService_Unauthenticated(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool), nil, &fakeBlobs{}, "")
	_, err := svc.ListVideos(context.Background(), &grownv1.ListVideosRequest{})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("want Unauthenticated, got %v", err)
	}
}

func TestService_GetNotFound(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil, &fakeBlobs{}, "")
	ctx := authCtx(orgID, userID)
	_, err := svc.GetVideo(ctx, &grownv1.GetVideoRequest{Id: "00000000-0000-0000-0000-000000000000"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("want NotFound, got %v", err)
	}
}
