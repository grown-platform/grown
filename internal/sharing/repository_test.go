package sharing_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/storage"
)

// newUUID returns a fresh UUID using Postgres, avoiding an extra Go dependency.
func newUUID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `SELECT gen_random_uuid()::text`).Scan(&id); err != nil {
		t.Fatalf("gen_random_uuid: %v", err)
	}
	return id
}

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

func seedUser(t *testing.T, pool *pgxpool.Pool, orgID, subject, email string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'https://issuer.test', $2, $3, $3) RETURNING id::text`,
		orgID, subject, email,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
	return id
}

func TestGrantRevokeRoleFor(t *testing.T) {
	pool, orgID := setupDB(t)
	ctx := context.Background()
	repo := sharing.NewRepository(pool)

	owner := seedUser(t, pool, orgID, "z-owner", "owner@test")
	grantee := seedUser(t, pool, orgID, "z-grantee", "grantee@test")
	objID := newUUID(t, pool)

	// No grant initially.
	if _, ok, err := repo.RoleFor(ctx, grantee, sharing.TypeDriveFile, objID); err != nil || ok {
		t.Fatalf("RoleFor before grant = ok %v, err %v; want false", ok, err)
	}

	// Grant viewer.
	if err := repo.GrantAccess(ctx, sharing.TypeDriveFile, objID, grantee, sharing.RoleViewer, owner); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}
	role, ok, err := repo.RoleFor(ctx, grantee, sharing.TypeDriveFile, objID)
	if err != nil || !ok || role != sharing.RoleViewer {
		t.Fatalf("RoleFor = %q, %v, %v; want viewer", role, ok, err)
	}

	// Re-grant upgrades the role (idempotent upsert).
	if err := repo.GrantAccess(ctx, sharing.TypeDriveFile, objID, grantee, sharing.RoleEditor, owner); err != nil {
		t.Fatalf("re-GrantAccess: %v", err)
	}
	if role, _, _ := repo.RoleFor(ctx, grantee, sharing.TypeDriveFile, objID); role != sharing.RoleEditor {
		t.Fatalf("RoleFor after upgrade = %q; want editor", role)
	}

	// Listing returns the grantee with name/email resolved.
	list, err := repo.ListGrantsForObject(ctx, sharing.TypeDriveFile, objID)
	if err != nil || len(list) != 1 {
		t.Fatalf("ListGrantsForObject = %v, %v; want 1", list, err)
	}
	if list[0].GranteeEmail != "grantee@test" || list[0].Role != sharing.RoleEditor {
		t.Fatalf("grant row = %+v", list[0])
	}

	// "Shared with me" ids.
	ids, err := repo.ListObjectIDsGrantedToUser(ctx, grantee, sharing.TypeDriveFile)
	if err != nil || len(ids) != 1 || ids[0] != objID {
		t.Fatalf("ListObjectIDsGrantedToUser = %v, %v; want [%s]", ids, err, objID)
	}
	// Type isolation: a docs query for the same user returns nothing.
	if ids, _ := repo.ListObjectIDsGrantedToUser(ctx, grantee, sharing.TypeDocsDoc); len(ids) != 0 {
		t.Fatalf("docs ids = %v; want empty", ids)
	}

	// Revoke removes the grant.
	if err := repo.RevokeAccess(ctx, sharing.TypeDriveFile, objID, grantee); err != nil {
		t.Fatalf("RevokeAccess: %v", err)
	}
	if _, ok, _ := repo.RoleFor(ctx, grantee, sharing.TypeDriveFile, objID); ok {
		t.Fatalf("RoleFor after revoke = true; want false")
	}
	// Revoking a non-existent grant is a no-op.
	if err := repo.RevokeAccess(ctx, sharing.TypeDriveFile, objID, grantee); err != nil {
		t.Fatalf("RevokeAccess (noop): %v", err)
	}
}

func TestGrantAccessRejectsBadRole(t *testing.T) {
	pool, orgID := setupDB(t)
	ctx := context.Background()
	repo := sharing.NewRepository(pool)
	u := seedUser(t, pool, orgID, "z-u", "u@test")
	if err := repo.GrantAccess(ctx, sharing.TypeDriveFile, newUUID(t, pool), u, "owner", ""); err == nil {
		t.Fatalf("GrantAccess with invalid role should error")
	}
}
