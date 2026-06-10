package contacts

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

func TestRepository_CRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	c, err := repo.Create(ctx, orgID, userID, Fields{DisplayName: "Ada", Emails: []string{"ada@x.io"}, Starred: true})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if c.DisplayName != "Ada" || len(c.Emails) != 1 || !c.Starred {
		t.Fatalf("create round-trip: %+v", c)
	}

	got, err := repo.Get(ctx, orgID, c.ID)
	if err != nil || got.ID != c.ID {
		t.Fatalf("Get: %v", err)
	}

	if _, err := repo.Update(ctx, orgID, c.ID, Fields{DisplayName: "Ada L.", Notes: "hi"}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, _ = repo.Get(ctx, orgID, c.ID)
	if got.DisplayName != "Ada L." || got.Notes != "hi" {
		t.Fatalf("after update: %+v", got)
	}

	if err := repo.Trash(ctx, orgID, c.ID); err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, c.ID); err != ErrNotFound {
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
	if _, err := repo.Create(ctx, orgID, userID, Fields{DisplayName: "Secret"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got, _ := repo.List(ctx, otherOrg, ListFilter{}); len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d contacts", len(got))
	}
}

func TestRepository_Star(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	c, err := repo.Create(ctx, orgID, userID, Fields{DisplayName: "Star Test", Starred: false})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if c.Starred {
		t.Fatal("expected starred=false initially")
	}

	c2, err := repo.SetStarred(ctx, orgID, c.ID, true)
	if err != nil {
		t.Fatalf("SetStarred true: %v", err)
	}
	if !c2.Starred {
		t.Fatal("expected starred=true after SetStarred(true)")
	}

	c3, err := repo.SetStarred(ctx, orgID, c.ID, false)
	if err != nil {
		t.Fatalf("SetStarred false: %v", err)
	}
	if c3.Starred {
		t.Fatal("expected starred=false after SetStarred(false)")
	}

	// Starred-only filter.
	_, _ = repo.SetStarred(ctx, orgID, c.ID, true)
	list, err := repo.List(ctx, orgID, ListFilter{StarredOnly: true})
	if err != nil {
		t.Fatalf("List starred: %v", err)
	}
	found := false
	for _, x := range list {
		if x.ID == c.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("starred contact not in starred-only list")
	}
}

func TestRepository_Groups_CRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Create group.
	g, err := repo.CreateGroup(ctx, orgID, userID, "Friends")
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	if g.Name != "Friends" || g.OrgID != orgID {
		t.Fatalf("group round-trip: %+v", g)
	}

	// List groups.
	groups, err := repo.ListGroups(ctx, orgID)
	if err != nil {
		t.Fatalf("ListGroups: %v", err)
	}
	if len(groups) == 0 {
		t.Fatal("expected at least one group")
	}

	// Rename group.
	g2, err := repo.UpdateGroup(ctx, orgID, g.ID, "Close Friends")
	if err != nil {
		t.Fatalf("UpdateGroup: %v", err)
	}
	if g2.Name != "Close Friends" {
		t.Fatalf("after rename: %+v", g2)
	}

	// Delete group.
	if err := repo.DeleteGroup(ctx, orgID, g.ID); err != nil {
		t.Fatalf("DeleteGroup: %v", err)
	}
	remaining, _ := repo.ListGroups(ctx, orgID)
	for _, x := range remaining {
		if x.ID == g.ID {
			t.Fatal("deleted group still present")
		}
	}
}

func TestRepository_Groups_Membership(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	c1, _ := repo.Create(ctx, orgID, userID, Fields{DisplayName: "Alice"})
	c2, _ := repo.Create(ctx, orgID, userID, Fields{DisplayName: "Bob"})
	g, _ := repo.CreateGroup(ctx, orgID, userID, "TestGroup")

	// Add both to group.
	if err := repo.AddToGroup(ctx, orgID, g.ID, []string{c1.ID, c2.ID}); err != nil {
		t.Fatalf("AddToGroup: %v", err)
	}

	// List by group.
	members, err := repo.List(ctx, orgID, ListFilter{GroupID: g.ID})
	if err != nil {
		t.Fatalf("List by group: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(members))
	}

	// Remove one.
	if err := repo.RemoveFromGroup(ctx, orgID, g.ID, c1.ID); err != nil {
		t.Fatalf("RemoveFromGroup: %v", err)
	}
	members2, _ := repo.List(ctx, orgID, ListFilter{GroupID: g.ID})
	if len(members2) != 1 || members2[0].ID != c2.ID {
		t.Fatalf("after remove: %+v", members2)
	}

	// Idempotent add (no error on duplicate).
	if err := repo.AddToGroup(ctx, orgID, g.ID, []string{c2.ID}); err != nil {
		t.Fatalf("duplicate AddToGroup should succeed: %v", err)
	}
}

func TestRepository_Groups_OrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('grp-other','GrpOther') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	_, _ = repo.CreateGroup(ctx, orgID, userID, "MyGroup")

	otherGroups, _ := repo.ListGroups(ctx, otherOrg)
	if len(otherGroups) != 0 {
		t.Fatalf("cross-org group leak: other org saw %d groups", len(otherGroups))
	}
}
