package telephony

import (
	"context"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org so user/extension rows can satisfy their foreign keys. Skips unless
// GROWN_TEST_DSN points at a throwaway Postgres.
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
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	return pool, orgID
}

// seedUser inserts a user into orgID and returns its id.
func seedUser(t *testing.T, pool *pgxpool.Pool, orgID, subject, email, name string) string {
	t.Helper()
	var userID string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', $2, $3, $4)
		 RETURNING id::text`, orgID, subject, email, name).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return userID
}

func TestEnsureExtension_AssignsBaseFirst(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	u := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")

	e, err := repo.EnsureExtension(ctx, orgID, u)
	if err != nil {
		t.Fatalf("EnsureExtension: %v", err)
	}
	if e.Extension != baseExtension {
		t.Errorf("first extension: got %d want %d", e.Extension, baseExtension)
	}
	// Idempotent: a second call returns the same extension.
	again, err := repo.EnsureExtension(ctx, orgID, u)
	if err != nil {
		t.Fatalf("EnsureExtension (again): %v", err)
	}
	if again.Extension != e.Extension {
		t.Errorf("non-idempotent: got %d want %d", again.Extension, e.Extension)
	}
}

func TestEnsureExtension_Increments(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	u2 := seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")

	e1, err := repo.EnsureExtension(ctx, orgID, u1)
	if err != nil {
		t.Fatal(err)
	}
	e2, err := repo.EnsureExtension(ctx, orgID, u2)
	if err != nil {
		t.Fatal(err)
	}
	if e1.Extension != baseExtension || e2.Extension != baseExtension+1 {
		t.Errorf("extensions: got %d,%d want %d,%d", e1.Extension, e2.Extension, baseExtension, baseExtension+1)
	}
}

func TestEnsureExtension_ReusesLowestFreeGap(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	u2 := seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")
	u3 := seedUser(t, pool, orgID, "s3", "c@grown.localtest.me", "Carol")

	if _, err := repo.EnsureExtension(ctx, orgID, u1); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.EnsureExtension(ctx, orgID, u2); err != nil {
		t.Fatal(err)
	}
	// Free up 1001 (u1) by deleting its extension row directly.
	if _, err := pool.Exec(ctx,
		`DELETE FROM grown.telephony_extensions WHERE org_id=$1 AND user_id=$2`, orgID, u1); err != nil {
		t.Fatal(err)
	}
	// u3 should reclaim the lowest free slot (1001).
	e3, err := repo.EnsureExtension(ctx, orgID, u3)
	if err != nil {
		t.Fatal(err)
	}
	if e3.Extension != baseExtension {
		t.Errorf("reuse gap: got %d want %d", e3.Extension, baseExtension)
	}
}

func TestGetExtension_NotFound(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	u := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")

	_, err := repo.GetExtension(context.Background(), orgID, u)
	if err != ErrNotFound {
		t.Errorf("got %v want ErrNotFound", err)
	}
}

func TestListMembers_IncludesExtensions(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")
	if _, err := repo.EnsureExtension(ctx, orgID, u1); err != nil {
		t.Fatal(err)
	}

	members, err := repo.ListMembers(ctx, orgID)
	if err != nil {
		t.Fatalf("ListMembers: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("members: got %d want 2", len(members))
	}
	var aliceExt, bobExt int
	for _, m := range members {
		switch m.UserID {
		case u1:
			aliceExt = m.Extension
		default:
			bobExt = m.Extension
		}
	}
	if aliceExt != baseExtension {
		t.Errorf("alice ext: got %d want %d", aliceExt, baseExtension)
	}
	if bobExt != 0 {
		t.Errorf("bob ext (unprovisioned): got %d want 0", bobExt)
	}
}

func TestLogAndListCalls(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	u2 := seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")

	start := time.Now().Add(-time.Minute)
	end := time.Now()
	if _, err := repo.LogCall(ctx, orgID, u1, u2, "completed", start, &end); err != nil {
		t.Fatalf("LogCall: %v", err)
	}
	if _, err := repo.LogCall(ctx, orgID, u2, u1, "missed", time.Now(), nil); err != nil {
		t.Fatalf("LogCall missed: %v", err)
	}

	// Both calls involve u1.
	calls, err := repo.ListCalls(ctx, orgID, u1)
	if err != nil {
		t.Fatalf("ListCalls: %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("calls: got %d want 2", len(calls))
	}
	// Most-recent-first: the missed call was logged second.
	if calls[0].Status != "missed" {
		t.Errorf("order: got %q want missed first", calls[0].Status)
	}
}

func TestListCalls_OrgScoped(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	u2 := seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")
	if _, err := repo.LogCall(ctx, orgID, u1, u2, "completed", time.Now(), nil); err != nil {
		t.Fatal(err)
	}
	other := "00000000-0000-0000-0000-000000000001"
	calls, err := repo.ListCalls(ctx, other, u1)
	if err != nil {
		t.Fatalf("ListCalls other org: %v", err)
	}
	if len(calls) != 0 {
		t.Errorf("expected 0 calls for other org, got %d", len(calls))
	}
}
