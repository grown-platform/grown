package whiteboards

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/sharing"
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

	w, err := repo.Create(ctx, orgID, userID, "Sketch")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if w.Title != "Sketch" {
		t.Fatalf("title: %q", w.Title)
	}

	if _, err := repo.Rename(ctx, orgID, w.ID, "Sketch v2"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if err := repo.Save(ctx, orgID, w.ID, `{"elements":[]}`); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := repo.Get(ctx, orgID, w.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != "Sketch v2" || got.Data != `{"elements":[]}` {
		t.Fatalf("after rename+save: %+v", got)
	}

	if list, _ := repo.List(ctx, orgID); len(list) != 1 {
		t.Fatalf("List: got %d want 1", len(list))
	}

	if err := repo.Trash(ctx, orgID, w.ID); err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, w.ID); err != ErrNotFound {
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
		t.Fatalf("cross-org leak: other org saw %d boards", len(got))
	}
}

func TestRepository_SharingGrants(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	grants := sharing.NewRepository(pool)
	ctx := context.Background()

	// Create a whiteboard in orgID.
	w, err := repo.Create(ctx, orgID, userID, "Shared Board")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Create a second org + user (the grantee).
	var otherOrg, otherUser string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('grantee-org','Grantee Org') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','grantee-1','grantee@grown.localtest.me','Grantee') RETURNING id::text`,
		otherOrg).Scan(&otherUser); err != nil {
		t.Fatalf("seed other user: %v", err)
	}

	// Grantee cannot see the board before a grant.
	if _, err := repo.GetByID(ctx, w.ID); err != nil {
		t.Fatalf("GetByID should work without org scope: %v", err)
	}
	role, ok, err := grants.RoleFor(ctx, otherUser, sharing.TypeWhiteboardBoard, w.ID)
	if err != nil {
		t.Fatalf("RoleFor: %v", err)
	}
	if ok {
		t.Fatalf("RoleFor: unexpected grant before GrantAccess (role=%q)", role)
	}

	// Grant viewer access.
	if err := grants.GrantAccess(ctx, sharing.TypeWhiteboardBoard, w.ID, otherUser, sharing.RoleViewer, userID); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}
	role, ok, err = grants.RoleFor(ctx, otherUser, sharing.TypeWhiteboardBoard, w.ID)
	if err != nil {
		t.Fatalf("RoleFor after grant: %v", err)
	}
	if !ok || role != sharing.RoleViewer {
		t.Fatalf("RoleFor: got ok=%v role=%q, want ok=true role=viewer", ok, role)
	}

	// ListObjectIDsGrantedToUser returns the board id.
	ids, err := grants.ListObjectIDsGrantedToUser(ctx, otherUser, sharing.TypeWhiteboardBoard)
	if err != nil {
		t.Fatalf("ListObjectIDsGrantedToUser: %v", err)
	}
	if len(ids) != 1 || ids[0] != w.ID {
		t.Fatalf("ListObjectIDsGrantedToUser: got %v want [%s]", ids, w.ID)
	}

	// GetByIDs returns the board.
	boards, err := repo.GetByIDs(ctx, ids)
	if err != nil {
		t.Fatalf("GetByIDs: %v", err)
	}
	if len(boards) != 1 || boards[0].ID != w.ID {
		t.Fatalf("GetByIDs: got %+v", boards)
	}

	// Revoke and confirm gone.
	if err := grants.RevokeAccess(ctx, sharing.TypeWhiteboardBoard, w.ID, otherUser); err != nil {
		t.Fatalf("RevokeAccess: %v", err)
	}
	if _, ok, _ := grants.RoleFor(ctx, otherUser, sharing.TypeWhiteboardBoard, w.ID); ok {
		t.Fatal("grant still present after RevokeAccess")
	}
}
