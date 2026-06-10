package prefs

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupDB(t *testing.T) (*pgxpool.Pool, string, string, string) {
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
	var orgID, userID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-1','tester@grown.test','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// second user in same org for isolation tests
	var userID2 string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-2','other@grown.test','Other') RETURNING id::text`,
		orgID).Scan(&userID2); err != nil {
		t.Fatalf("seed user2: %v", err)
	}
	return pool, orgID, userID, userID2
}

func TestGetOrDefault_NoRow(t *testing.T) {
	pool, orgID, userID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p, err := repo.GetOrDefault(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("GetOrDefault: %v", err)
	}
	if p.Language != "en" || p.Density != "comfortable" || p.TimeFormat != "12h" {
		t.Fatalf("unexpected defaults: %+v", p)
	}
	if p.UserID != userID || p.OrgID != orgID {
		t.Fatalf("IDs not filled: %+v", p)
	}
}

func TestUpdatePreferences_FullUpsert(t *testing.T) {
	pool, orgID, userID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p, err := repo.UpdatePreferences(ctx, orgID, userID, UpdateFields{
		Language:           "es",
		Density:            "compact",
		DefaultApp:         "drive",
		DateFormat:         "D/M/YYYY",
		TimeFormat:         "24h",
		WeekStart:          "monday",
		EmailNotifications: false,
		Extra:              `{"theme_accent":"#ff0000"}`,
	})
	if err != nil {
		t.Fatalf("UpdatePreferences: %v", err)
	}
	if p.Language != "es" || p.Density != "compact" || p.TimeFormat != "24h" {
		t.Fatalf("saved values wrong: %+v", p)
	}
	if p.EmailNotifications {
		t.Fatalf("email_notifications should be false")
	}

	// Read back
	got, err := repo.GetOrDefault(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("GetOrDefault after update: %v", err)
	}
	if got.Language != "es" || got.WeekStart != "monday" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestUpdatePreferences_PartialMask(t *testing.T) {
	pool, orgID, userID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// First: full upsert
	if _, err := repo.UpdatePreferences(ctx, orgID, userID, UpdateFields{
		Language: "fr", Density: "compact",
	}); err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	// Partial: change only density; language should stay "fr"
	p, err := repo.UpdatePreferences(ctx, orgID, userID, UpdateFields{
		Density: "comfortable",
		Mask:    []string{"density"},
	})
	if err != nil {
		t.Fatalf("partial update: %v", err)
	}
	if p.Density != "comfortable" {
		t.Fatalf("density not updated: %+v", p)
	}
	if p.Language != "fr" {
		t.Fatalf("language should be unchanged (fr), got: %s", p.Language)
	}
}

func TestUpdatePreferences_UserIsolation(t *testing.T) {
	pool, orgID, userID, userID2 := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if _, err := repo.UpdatePreferences(ctx, orgID, userID, UpdateFields{Language: "de"}); err != nil {
		t.Fatalf("update user1: %v", err)
	}

	p2, err := repo.GetOrDefault(ctx, orgID, userID2)
	if err != nil {
		t.Fatalf("get user2: %v", err)
	}
	if p2.Language != "en" {
		t.Fatalf("user2 should have default language, got: %s", p2.Language)
	}
}
