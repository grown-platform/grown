package branding

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupDB(t *testing.T) (*pgxpool.Pool, string) {
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
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	return pool, orgID
}

// TestRepository_GetDefaults returns an empty (default) branding when no row
// exists — the normal unbranded case, not an error.
func TestRepository_GetDefaults(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)

	b, err := repo.Get(context.Background(), orgID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if b.AccentColor != "" || b.LogoBlobKey != "" {
		t.Errorf("expected empty branding, got %+v", b)
	}
}

// TestRepository_SetAccentAndLogo verifies accent color and logo are stored
// independently (setting one preserves the other) and clearable.
func TestRepository_SetAccentAndLogo(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if err := repo.SetAccentColor(ctx, orgID, "#3F704D"); err != nil {
		t.Fatalf("SetAccentColor: %v", err)
	}
	if err := repo.SetLogo(ctx, orgID, "branding/x/logo-abc", "image/png"); err != nil {
		t.Fatalf("SetLogo: %v", err)
	}

	b, err := repo.Get(ctx, orgID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if b.AccentColor != "#3F704D" {
		t.Errorf("accent: got %q", b.AccentColor)
	}
	if b.LogoBlobKey != "branding/x/logo-abc" || b.LogoMIME != "image/png" {
		t.Errorf("logo: got key=%q mime=%q", b.LogoBlobKey, b.LogoMIME)
	}

	// Updating the accent must NOT clobber the logo.
	if err := repo.SetAccentColor(ctx, orgID, "#112233"); err != nil {
		t.Fatalf("SetAccentColor 2: %v", err)
	}
	b, _ = repo.Get(ctx, orgID)
	if b.AccentColor != "#112233" {
		t.Errorf("accent after update: got %q", b.AccentColor)
	}
	if b.LogoBlobKey != "branding/x/logo-abc" {
		t.Errorf("logo lost after accent update: %q", b.LogoBlobKey)
	}

	// Clearing the logo leaves the accent intact.
	if err := repo.SetLogo(ctx, orgID, "", ""); err != nil {
		t.Fatalf("SetLogo clear: %v", err)
	}
	b, _ = repo.Get(ctx, orgID)
	if b.LogoBlobKey != "" {
		t.Errorf("logo not cleared: %q", b.LogoBlobKey)
	}
	if b.AccentColor != "#112233" {
		t.Errorf("accent lost after logo clear: %q", b.AccentColor)
	}

	// Clearing the accent stores NULL.
	if err := repo.SetAccentColor(ctx, orgID, ""); err != nil {
		t.Fatalf("SetAccentColor clear: %v", err)
	}
	b, _ = repo.Get(ctx, orgID)
	if b.AccentColor != "" {
		t.Errorf("accent not cleared: %q", b.AccentColor)
	}
}
