package orgs

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupDB(t *testing.T) *pgxpool.Pool {
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
	return pool
}

func TestRepository_GetBySlug_FindsDefault(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)

	org, err := repo.GetBySlug(context.Background(), "default")
	if err != nil {
		t.Fatalf("GetBySlug: %v", err)
	}
	if org.Slug != "default" {
		t.Errorf("slug: got %q, want default", org.Slug)
	}
	if org.DisplayName != "Default" {
		t.Errorf("display_name: got %q, want Default", org.DisplayName)
	}
	if org.ID == "" {
		t.Errorf("id should be non-empty")
	}
}

func TestRepository_CreatePersonal(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	o, err := repo.CreatePersonal(ctx, "Ada Lovelace")
	if err != nil {
		t.Fatalf("CreatePersonal: %v", err)
	}
	if o.ID == "" {
		t.Fatalf("personal org id empty")
	}
	if o.DisplayName != "Ada Lovelace" {
		t.Errorf("display_name = %q; want Ada Lovelace", o.DisplayName)
	}
	if len(o.Slug) < len("personal-") || o.Slug[:len("personal-")] != "personal-" {
		t.Errorf("slug = %q; want personal-<...>", o.Slug)
	}

	// Two personal orgs get distinct slugs/ids.
	o2, err := repo.CreatePersonal(ctx, "")
	if err != nil {
		t.Fatalf("CreatePersonal #2: %v", err)
	}
	if o2.Slug == o.Slug || o2.ID == o.ID {
		t.Errorf("second personal org collides: %q vs %q", o2.Slug, o.Slug)
	}
	if o2.DisplayName != "Personal workspace" {
		t.Errorf("empty name default = %q; want Personal workspace", o2.DisplayName)
	}

	// Round-trips by id.
	got, err := repo.GetByID(ctx, o.ID)
	if err != nil || got.Slug != o.Slug {
		t.Fatalf("GetByID = %+v, %v", got, err)
	}
}

func TestRepository_GetBySlug_NotFound(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.GetBySlug(context.Background(), "missing")
	if err != ErrNotFound {
		t.Errorf("got err=%v, want ErrNotFound", err)
	}
}
