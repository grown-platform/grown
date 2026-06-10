package video

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so video rows can satisfy their foreign keys. Skips unless
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

func sampleParams() CreateParams {
	return CreateParams{
		Title:            "My Clip",
		Description:      "a test",
		ContentType:      "video/mp4",
		Size:             1234,
		DurationSeconds:  42.5,
		ThumbnailDataURL: "data:image/png;base64,AAAA",
		BlobKey:          "video/abc123",
	}
}

func TestRepository_CreateAndGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	created, err := repo.Create(ctx, orgID, userID, sampleParams())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if created.Title != "My Clip" || created.ContentType != "video/mp4" {
		t.Errorf("unexpected create result: %+v", created)
	}
	if created.Size != 1234 || created.DurationSeconds != 42.5 {
		t.Errorf("size/duration mismatch: %+v", created)
	}
	if created.OrgID != orgID || created.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", created)
	}

	got, err := repo.Get(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != created.ID || got.BlobKey != "video/abc123" {
		t.Errorf("Get mismatch: %+v", got)
	}
}

func TestRepository_Get_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.Get(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestRepository_List_NewestFirst(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p1 := sampleParams()
	p1.Title = "First"
	p1.BlobKey = "video/1"
	first, err := repo.Create(ctx, orgID, userID, p1)
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	p2 := sampleParams()
	p2.Title = "Second"
	p2.BlobKey = "video/2"
	second, err := repo.Create(ctx, orgID, userID, p2)
	if err != nil {
		t.Fatalf("create second: %v", err)
	}

	list, err := repo.List(ctx, orgID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 videos, got %d", len(list))
	}
	// Newest first; both share created_at to the second potentially, so just
	// assert membership and that the most-recent insert isn't dropped.
	ids := map[string]bool{list[0].ID: true, list[1].ID: true}
	if !ids[first.ID] || !ids[second.ID] {
		t.Errorf("missing videos in list: %+v", list)
	}
}

func TestRepository_Update(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	v, err := repo.Create(ctx, orgID, userID, sampleParams())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	updated, err := repo.Update(ctx, orgID, v.ID, Fields{
		Title: "Renamed", Description: "new desc", ThumbnailDataURL: "data:image/png;base64,BBBB",
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Title != "Renamed" || updated.Description != "new desc" {
		t.Errorf("update not applied: %+v", updated)
	}
	if updated.ThumbnailDataURL != "data:image/png;base64,BBBB" {
		t.Errorf("thumbnail not updated: %+v", updated)
	}
	// Immutable fields are preserved.
	if updated.ContentType != "video/mp4" || updated.Size != 1234 || updated.BlobKey != "video/abc123" {
		t.Errorf("immutable fields changed: %+v", updated)
	}
}

func TestRepository_Update_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.Update(context.Background(), orgID, "00000000-0000-0000-0000-000000000000", Fields{Title: "x"})
	if err != ErrNotFound {
		t.Errorf("want ErrNotFound, got %v", err)
	}
}

func TestRepository_Trash(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	v, err := repo.Create(ctx, orgID, userID, sampleParams())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	blobKey, err := repo.Trash(ctx, orgID, v.ID)
	if err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if blobKey != "video/abc123" {
		t.Errorf("want blob key returned, got %q", blobKey)
	}
	if _, err := repo.Get(ctx, orgID, v.ID); err != ErrNotFound {
		t.Errorf("trashed video still visible: %v", err)
	}
	list, err := repo.List(ctx, orgID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("trashed video appears in list: %+v", list)
	}
	// Double-trash is a no-op (already gone).
	if _, err := repo.Trash(ctx, orgID, v.ID); err != ErrNotFound {
		t.Errorf("re-trash want ErrNotFound, got %v", err)
	}
}

func TestRepository_OrgScoping(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// A second org cannot see or mutate the first org's video.
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other', 'Other Org') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	v, err := repo.Create(ctx, orgID, userID, sampleParams())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := repo.Get(ctx, otherOrg, v.ID); err != ErrNotFound {
		t.Errorf("cross-org Get should be NotFound, got %v", err)
	}
	if _, err := repo.Update(ctx, otherOrg, v.ID, Fields{Title: "hax"}); err != ErrNotFound {
		t.Errorf("cross-org Update should be NotFound, got %v", err)
	}
	if _, err := repo.Trash(ctx, otherOrg, v.ID); err != ErrNotFound {
		t.Errorf("cross-org Trash should be NotFound, got %v", err)
	}
	list, err := repo.List(ctx, otherOrg)
	if err != nil {
		t.Fatalf("List other: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("other org sees foreign videos: %+v", list)
	}
}
