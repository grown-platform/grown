package users

import (
	"context"
	"os"
	"testing"
	"time"

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
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("get default org id: %v", err)
	}
	return pool, orgID
}

func TestRepository_UpsertByOIDC_Creates(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)

	u, err := repo.UpsertByOIDC(context.Background(), UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-1",
		Email:       "alice@example.com",
		DisplayName: "Alice Example",
	})
	if err != nil {
		t.Fatalf("UpsertByOIDC: %v", err)
	}
	if u.ID == "" || u.OrgID != orgID || u.OIDCSubject != "user-1" || u.Email != "alice@example.com" {
		t.Errorf("got %+v", u)
	}
}

func TestRepository_GetByOIDCAnyOrg(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Unknown subject → ErrNotFound (drives the "first-ever sign-in" branch).
	if _, err := repo.GetByOIDCAnyOrg(ctx, "http://idp", "ghost"); err != ErrNotFound {
		t.Fatalf("GetByOIDCAnyOrg(ghost) = %v; want ErrNotFound", err)
	}

	// A user provisioned in a NON-default (personal) org is still found by
	// (issuer, subject) without knowing the org — so a returning personal user
	// keeps their org on the next sign-in.
	var personalOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('personal-x','X') RETURNING id::text`,
	).Scan(&personalOrg); err != nil {
		t.Fatalf("create personal org: %v", err)
	}
	want, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID: personalOrg, OIDCIssuer: "http://idp", OIDCSubject: "carol",
		Email: "carol@test", DisplayName: "Carol",
	})
	if err != nil {
		t.Fatalf("seed personal user: %v", err)
	}
	got, err := repo.GetByOIDCAnyOrg(ctx, "http://idp", "carol")
	if err != nil {
		t.Fatalf("GetByOIDCAnyOrg(carol): %v", err)
	}
	if got.ID != want.ID || got.OrgID != personalOrg {
		t.Fatalf("GetByOIDCAnyOrg(carol) = %+v; want id %s org %s", got, want.ID, personalOrg)
	}
	_ = orgID
}

func TestRepository_UpsertByOIDC_UpdatesEmail(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	first, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-2",
		Email:       "old@example.com",
		DisplayName: "Old Name",
	})
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	time.Sleep(10 * time.Millisecond) // ensure updated_at advances on Postgres
	second, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-2",
		Email:       "new@example.com",
		DisplayName: "New Name",
	})
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if first.ID != second.ID {
		t.Errorf("ID changed across upserts: %s -> %s", first.ID, second.ID)
	}
	if second.Email != "new@example.com" || second.DisplayName != "New Name" {
		t.Errorf("expected updated email/name; got %+v", second)
	}
}

func TestRepository_GetByID(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	created, err := repo.UpsertByOIDC(ctx, UpsertInput{
		OrgID:       orgID,
		OIDCIssuer:  "http://localhost:8081",
		OIDCSubject: "user-3",
		Email:       "bob@example.com",
		DisplayName: "Bob",
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := repo.GetByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("got %s, want %s", got.ID, created.ID)
	}
}
