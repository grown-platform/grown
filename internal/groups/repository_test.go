package groups

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

func TestRepository_GroupTopicPostFlow(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	g, err := repo.Create(ctx, orgID, userID, GroupFields{Name: "Eng", Email: "eng@org", Description: "engineering", MemberIDs: []string{userID}})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if g.Name != "Eng" {
		t.Fatalf("group: %+v", g)
	}

	topic, err := repo.CreateTopic(ctx, orgID, g.ID, userID, "Tester", "Welcome", "first post body")
	if err != nil {
		t.Fatalf("CreateTopic: %v", err)
	}
	if ts, _ := repo.ListTopics(ctx, orgID, g.ID); len(ts) != 1 {
		t.Fatalf("ListTopics: got %d want 1", len(ts))
	}

	// The topic's opening body is stored as the first post; a reply adds a 2nd.
	if _, err := repo.CreatePost(ctx, orgID, topic.ID, userID, "Tester", "a reply"); err != nil {
		t.Fatalf("CreatePost: %v", err)
	}
	posts, _ := repo.ListPosts(ctx, orgID, topic.ID)
	if len(posts) < 1 {
		t.Fatalf("ListPosts: got %d want >=1", len(posts))
	}
	if posts[len(posts)-1].Body != "a reply" {
		t.Fatalf("last post body: %q", posts[len(posts)-1].Body)
	}
}

func TestRepository_ListMembersAndIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ms, err := repo.ListMembers(ctx, orgID)
	if err != nil {
		t.Fatalf("ListMembers: %v", err)
	}
	found := false
	for _, m := range ms {
		if m.ID == userID {
			found = true
		}
	}
	if !found {
		t.Fatalf("ListMembers missing caller %q", userID)
	}

	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := repo.Create(ctx, orgID, userID, GroupFields{Name: "Private", Email: "p@org"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got, _ := repo.List(ctx, otherOrg); len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d groups", len(got))
	}
}
