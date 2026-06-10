package photos

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// authCtx builds a context as the auth middleware would, carrying the caller's
// user + org so the service can resolve tenancy.
func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithOrg(context.Background(), orgs.Org{ID: orgID})
	ctx = auth.WithUser(ctx, users.User{ID: userID, OrgID: orgID})
	return ctx
}

func TestService_PhotoLifecycle(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authCtx(orgID, userID)

	// Seed a photo via the repo (uploads go through the HTTP layer).
	p := mkPhoto(t, repo, orgID, userID, "a.png")

	got, err := svc.GetPhoto(ctx, &grownv1.GetPhotoRequest{Id: p.ID})
	if err != nil {
		t.Fatalf("GetPhoto: %v", err)
	}
	if got.GetContentUrl() != "/api/v1/photos/"+p.ID+"/content" {
		t.Errorf("content_url: got %q", got.GetContentUrl())
	}

	upd, err := svc.UpdatePhoto(ctx, &grownv1.UpdatePhotoRequest{Id: p.ID, Description: "hi", Favorite: true})
	if err != nil {
		t.Fatalf("UpdatePhoto: %v", err)
	}
	if upd.GetDescription() != "hi" || !upd.GetFavorite() {
		t.Errorf("update: %+v", upd)
	}

	list, err := svc.ListPhotos(ctx, &grownv1.ListPhotosRequest{})
	if err != nil {
		t.Fatalf("ListPhotos: %v", err)
	}
	if len(list.GetPhotos()) != 1 {
		t.Fatalf("ListPhotos: got %d want 1", len(list.GetPhotos()))
	}

	if _, err := svc.DeletePhoto(ctx, &grownv1.DeletePhotoRequest{Id: p.ID}); err != nil {
		t.Fatalf("DeletePhoto: %v", err)
	}
	if _, err := svc.GetPhoto(ctx, &grownv1.GetPhotoRequest{Id: p.ID}); status.Code(err) != codes.NotFound {
		t.Errorf("Get after delete: got %v want NotFound", err)
	}
}

func TestService_RequiresAuth(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool))
	if _, err := svc.ListPhotos(context.Background(), &grownv1.ListPhotosRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Errorf("unauthenticated ListPhotos: got %v want Unauthenticated", err)
	}
}

func TestService_AlbumLifecycle(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authCtx(orgID, userID)

	p1 := mkPhoto(t, repo, orgID, userID, "a.png")
	p2 := mkPhoto(t, repo, orgID, userID, "b.png")

	a, err := svc.CreateAlbum(ctx, &grownv1.CreateAlbumRequest{Title: "Trip", PhotoIds: []string{p1.ID}})
	if err != nil {
		t.Fatalf("CreateAlbum: %v", err)
	}
	if a.GetTitle() != "Trip" || a.GetPhotoCount() != 1 {
		t.Errorf("CreateAlbum: %+v", a)
	}
	if a.GetCoverUrl() == "" {
		t.Error("expected cover_url to be set")
	}

	a, err = svc.AddToAlbum(ctx, &grownv1.AddToAlbumRequest{AlbumId: a.GetId(), PhotoIds: []string{p2.ID}})
	if err != nil {
		t.Fatalf("AddToAlbum: %v", err)
	}
	if a.GetPhotoCount() != 2 {
		t.Errorf("after add: %d", a.GetPhotoCount())
	}

	full, err := svc.GetAlbum(ctx, &grownv1.GetAlbumRequest{Id: a.GetId()})
	if err != nil {
		t.Fatalf("GetAlbum: %v", err)
	}
	if len(full.GetPhotos()) != 2 {
		t.Errorf("GetAlbum photos: got %d want 2", len(full.GetPhotos()))
	}

	a, err = svc.RemoveFromAlbum(ctx, &grownv1.RemoveFromAlbumRequest{AlbumId: a.GetId(), PhotoId: p1.ID})
	if err != nil {
		t.Fatalf("RemoveFromAlbum: %v", err)
	}
	if a.GetPhotoCount() != 1 {
		t.Errorf("after remove: %d", a.GetPhotoCount())
	}

	list, err := svc.ListAlbums(ctx, &grownv1.ListAlbumsRequest{})
	if err != nil {
		t.Fatalf("ListAlbums: %v", err)
	}
	if len(list.GetAlbums()) != 1 {
		t.Fatalf("ListAlbums: got %d want 1", len(list.GetAlbums()))
	}

	if _, err := svc.DeleteAlbum(ctx, &grownv1.DeleteAlbumRequest{Id: a.GetId()}); err != nil {
		t.Fatalf("DeleteAlbum: %v", err)
	}
	if _, err := svc.GetAlbum(ctx, &grownv1.GetAlbumRequest{Id: a.GetId()}); status.Code(err) != codes.NotFound {
		t.Errorf("GetAlbum after delete: got %v want NotFound", err)
	}
}
