package slides

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
	var orgID, userID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-1','tester@grown.localtest.me','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func TestRepository_CreateRenameSaveTrash(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, err := repo.Create(ctx, orgID, userID, "Pitch")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := repo.Rename(ctx, orgID, d.ID, "Pitch v2"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if err := repo.Save(ctx, orgID, d.ID, `{"slides":[]}`); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := repo.Get(ctx, orgID, d.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != "Pitch v2" {
		t.Fatalf("after rename: %q", got.Title)
	}
	if list, _ := repo.List(ctx, orgID); len(list) != 1 {
		t.Fatalf("List: got %d want 1", len(list))
	}
	if err := repo.Trash(ctx, orgID, d.ID); err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, d.ID); err != ErrNotFound {
		t.Fatalf("after trash: got %v want ErrNotFound", err)
	}
}

func TestRepository_OrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := repo.Create(ctx, orgID, userID, "Private"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got, _ := repo.List(ctx, otherOrg); len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d decks", len(got))
	}
}
