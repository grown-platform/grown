package photos

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so photo rows can satisfy their foreign keys. Skips unless
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

func mkPhoto(t *testing.T, r *Repository, orgID, userID, name string) Photo {
	t.Helper()
	p, err := r.CreatePhoto(context.Background(), orgID, userID, NewPhoto{
		Filename: name, ContentType: "image/png", Size: 123, Width: 800, Height: 600,
		BlobKey: "photos/" + name,
	})
	if err != nil {
		t.Fatalf("CreatePhoto(%s): %v", name, err)
	}
	return p
}

func TestPhoto_CreateGetList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p := mkPhoto(t, repo, orgID, userID, "a.png")
	if p.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if p.OrgID != orgID || p.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", p)
	}
	if p.Width != 800 || p.Height != 600 {
		t.Errorf("dimensions: got %dx%d", p.Width, p.Height)
	}

	got, err := repo.GetPhoto(ctx, orgID, p.ID)
	if err != nil {
		t.Fatalf("GetPhoto: %v", err)
	}
	if got.ID != p.ID || got.Filename != "a.png" || got.BlobKey != "photos/a.png" {
		t.Errorf("GetPhoto mismatch: %+v", got)
	}

	mkPhoto(t, repo, orgID, userID, "b.png")
	list, err := repo.ListPhotos(ctx, orgID, "", false)
	if err != nil {
		t.Fatalf("ListPhotos: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("ListPhotos len: got %d want 2", len(list))
	}
}

func TestPhoto_GetNotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.GetPhoto(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func TestPhoto_OrgScoping(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// A second org should not see the first org's photos.
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other', 'Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	p := mkPhoto(t, repo, orgID, userID, "secret.png")

	if _, err := repo.GetPhoto(ctx, otherOrg, p.ID); err != ErrNotFound {
		t.Errorf("cross-org GetPhoto: got %v want ErrNotFound", err)
	}
	list, _ := repo.ListPhotos(ctx, otherOrg, "", false)
	if len(list) != 0 {
		t.Errorf("cross-org ListPhotos: got %d want 0", len(list))
	}
}

func TestPhoto_UpdateAndFavorites(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p := mkPhoto(t, repo, orgID, userID, "a.png")
	up, err := repo.UpdatePhoto(ctx, orgID, p.ID, PhotoFields{Description: "sunset", Favorite: true})
	if err != nil {
		t.Fatalf("UpdatePhoto: %v", err)
	}
	if up.Description != "sunset" || !up.Favorite {
		t.Errorf("update not applied: %+v", up)
	}
	mkPhoto(t, repo, orgID, userID, "b.png") // not a favorite

	favs, err := repo.ListPhotos(ctx, orgID, "", true)
	if err != nil {
		t.Fatalf("ListPhotos favorites: %v", err)
	}
	if len(favs) != 1 || favs[0].ID != p.ID {
		t.Errorf("favorites filter: got %+v", favs)
	}
}

func TestPhoto_DeleteHidesAndReturnsBlob(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p := mkPhoto(t, repo, orgID, userID, "a.png")
	blobKey, err := repo.DeletePhoto(ctx, orgID, p.ID)
	if err != nil {
		t.Fatalf("DeletePhoto: %v", err)
	}
	if blobKey != "photos/a.png" {
		t.Errorf("blob key: got %q", blobKey)
	}
	if _, err := repo.GetPhoto(ctx, orgID, p.ID); err != ErrNotFound {
		t.Errorf("Get after delete: got %v want ErrNotFound", err)
	}
	list, _ := repo.ListPhotos(ctx, orgID, "", false)
	if len(list) != 0 {
		t.Errorf("List after delete: got %d want 0", len(list))
	}
	if _, err := repo.DeletePhoto(ctx, orgID, p.ID); err != ErrNotFound {
		t.Errorf("double delete: got %v want ErrNotFound", err)
	}
}

func TestAlbum_CreateGetListUpdateDelete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p1 := mkPhoto(t, repo, orgID, userID, "a.png")
	p2 := mkPhoto(t, repo, orgID, userID, "b.png")

	a, err := repo.CreateAlbum(ctx, orgID, userID, "Trip", []string{p1.ID, p2.ID})
	if err != nil {
		t.Fatalf("CreateAlbum: %v", err)
	}
	if a.Title != "Trip" || a.PhotoCount != 2 {
		t.Errorf("album: got %+v", a)
	}
	if a.CoverPhotoID == "" {
		t.Error("expected a cover photo to be auto-set")
	}

	got, err := repo.GetAlbum(ctx, orgID, a.ID)
	if err != nil {
		t.Fatalf("GetAlbum: %v", err)
	}
	if got.ID != a.ID || got.PhotoCount != 2 {
		t.Errorf("GetAlbum mismatch: %+v", got)
	}

	albums, err := repo.ListAlbums(ctx, orgID)
	if err != nil {
		t.Fatalf("ListAlbums: %v", err)
	}
	if len(albums) != 1 {
		t.Fatalf("ListAlbums len: got %d want 1", len(albums))
	}

	up, err := repo.UpdateAlbum(ctx, orgID, a.ID, "Vacation", p2.ID)
	if err != nil {
		t.Fatalf("UpdateAlbum: %v", err)
	}
	if up.Title != "Vacation" || up.CoverPhotoID != p2.ID {
		t.Errorf("UpdateAlbum mismatch: %+v", up)
	}

	if err := repo.DeleteAlbum(ctx, orgID, a.ID); err != nil {
		t.Fatalf("DeleteAlbum: %v", err)
	}
	if _, err := repo.GetAlbum(ctx, orgID, a.ID); err != ErrNotFound {
		t.Errorf("GetAlbum after delete: got %v want ErrNotFound", err)
	}
}

func TestAlbum_AddRemovePhotos(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p1 := mkPhoto(t, repo, orgID, userID, "a.png")
	p2 := mkPhoto(t, repo, orgID, userID, "b.png")
	a, _ := repo.CreateAlbum(ctx, orgID, userID, "Empty", nil)
	if a.PhotoCount != 0 {
		t.Fatalf("new album should be empty, got %d", a.PhotoCount)
	}

	a, err := repo.AddToAlbum(ctx, orgID, a.ID, []string{p1.ID, p2.ID})
	if err != nil {
		t.Fatalf("AddToAlbum: %v", err)
	}
	if a.PhotoCount != 2 {
		t.Errorf("after add: got %d want 2", a.PhotoCount)
	}

	// Idempotent: adding p1 again does not duplicate.
	a, err = repo.AddToAlbum(ctx, orgID, a.ID, []string{p1.ID})
	if err != nil {
		t.Fatalf("AddToAlbum idempotent: %v", err)
	}
	if a.PhotoCount != 2 {
		t.Errorf("after re-add: got %d want 2", a.PhotoCount)
	}

	// Scoped photos list for the album.
	inAlbum, err := repo.ListPhotos(ctx, orgID, a.ID, false)
	if err != nil {
		t.Fatalf("ListPhotos in album: %v", err)
	}
	if len(inAlbum) != 2 {
		t.Errorf("album photos: got %d want 2", len(inAlbum))
	}

	a, err = repo.RemoveFromAlbum(ctx, orgID, a.ID, p1.ID)
	if err != nil {
		t.Fatalf("RemoveFromAlbum: %v", err)
	}
	if a.PhotoCount != 1 {
		t.Errorf("after remove: got %d want 1", a.PhotoCount)
	}

	// Deleting a photo removes it from albums too.
	if _, err := repo.DeletePhoto(ctx, orgID, p2.ID); err != nil {
		t.Fatalf("DeletePhoto: %v", err)
	}
	a, _ = repo.GetAlbum(ctx, orgID, a.ID)
	if a.PhotoCount != 0 {
		t.Errorf("after deleting last photo: got %d want 0", a.PhotoCount)
	}
}

func TestAlbum_AddRejectsForeignPhoto(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	var otherOrg, otherUser string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other', 'Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', 'subject-2', 'other@x', 'Other') RETURNING id::text`, otherOrg).Scan(&otherUser); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	foreign := mkPhoto(t, repo, otherOrg, otherUser, "foreign.png")

	a, _ := repo.CreateAlbum(ctx, orgID, userID, "Mine", nil)
	a, err := repo.AddToAlbum(ctx, orgID, a.ID, []string{foreign.ID})
	if err != nil {
		t.Fatalf("AddToAlbum: %v", err)
	}
	if a.PhotoCount != 0 {
		t.Errorf("foreign photo should not be added: got count %d", a.PhotoCount)
	}
}
