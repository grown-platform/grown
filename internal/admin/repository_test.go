package admin

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

func TestRepository_DefaultEmptyThenUpsert(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// No overrides stored yet → empty map (everything defaults to enabled).
	got, err := repo.GetSettings(ctx, orgID)
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected no stored settings, got %d", len(got))
	}

	// Disable music, enable books explicitly.
	if _, err := repo.UpsertSettings(ctx, orgID, []Setting{
		{ServiceID: "music", Enabled: false},
		{ServiceID: "books", Enabled: true},
	}); err != nil {
		t.Fatalf("UpsertSettings: %v", err)
	}
	got, _ = repo.GetSettings(ctx, orgID)
	if got["music"].Enabled {
		t.Errorf("music should be disabled")
	}
	if !got["books"].Enabled {
		t.Errorf("books should be enabled")
	}

	// Upsert is idempotent on the (org, service) key: flip music back on.
	if _, err := repo.UpsertSettings(ctx, orgID, []Setting{{ServiceID: "music", Enabled: true}}); err != nil {
		t.Fatalf("UpsertSettings 2: %v", err)
	}
	got, _ = repo.GetSettings(ctx, orgID)
	if !got["music"].Enabled {
		t.Errorf("music should be re-enabled after second upsert")
	}
	if len(got) != 2 {
		t.Errorf("expected 2 distinct settings, got %d", len(got))
	}
}

func TestRepository_ExternalURL(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// No rows yet — GetSettings returns empty map.
	got, err := repo.GetSettings(ctx, orgID)
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty map, got %d", len(got))
	}

	// Upsert a setting with an external URL.
	if _, err := repo.UpsertSettings(ctx, orgID, []Setting{
		{ServiceID: "photos", Enabled: true, ExternalURL: "https://immich.example.com"},
	}); err != nil {
		t.Fatalf("UpsertSettings with external URL: %v", err)
	}
	got, err = repo.GetSettings(ctx, orgID)
	if err != nil {
		t.Fatalf("GetSettings after upsert: %v", err)
	}
	if got["photos"].ExternalURL != "https://immich.example.com" {
		t.Errorf("expected external URL %q, got %q", "https://immich.example.com", got["photos"].ExternalURL)
	}

	// Clearing the external URL (empty string) stores NULL, GetSettings returns "".
	if _, err := repo.UpsertSettings(ctx, orgID, []Setting{
		{ServiceID: "photos", Enabled: true, ExternalURL: ""},
	}); err != nil {
		t.Fatalf("UpsertSettings clear external URL: %v", err)
	}
	got, err = repo.GetSettings(ctx, orgID)
	if err != nil {
		t.Fatalf("GetSettings after clear: %v", err)
	}
	if got["photos"].ExternalURL != "" {
		t.Errorf("expected empty external URL after clear, got %q", got["photos"].ExternalURL)
	}

	// Multiple services: only one has an external URL.
	if _, err := repo.UpsertSettings(ctx, orgID, []Setting{
		{ServiceID: "git", Enabled: true, ExternalURL: "https://git.example.com"},
		{ServiceID: "music", Enabled: false, ExternalURL: ""},
	}); err != nil {
		t.Fatalf("UpsertSettings multi: %v", err)
	}
	got, _ = repo.GetSettings(ctx, orgID)
	if got["git"].ExternalURL != "https://git.example.com" {
		t.Errorf("git external URL: want %q got %q", "https://git.example.com", got["git"].ExternalURL)
	}
	if got["music"].ExternalURL != "" {
		t.Errorf("music external URL should be empty, got %q", got["music"].ExternalURL)
	}
}

func TestRepository_OrgIsolation(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := repo.UpsertSettings(ctx, orgID, []Setting{{ServiceID: "music", Enabled: false}}); err != nil {
		t.Fatalf("UpsertSettings: %v", err)
	}
	got, _ := repo.GetSettings(ctx, otherOrg)
	if len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d settings", len(got))
	}
}
