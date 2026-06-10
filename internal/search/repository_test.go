package search

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB spins up a clean schema and returns a pool plus the default org's id
// and two distinct org ids (org1, org2) for cross-org isolation tests.
func setupDB(t *testing.T) (pool *pgxpool.Pool, org1ID, org2ID, user1ID, user2ID string) {
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

	// org1 = the seeded default org
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&org1ID); err != nil {
		t.Fatalf("default org: %v", err)
	}

	// org2 = a second org for cross-org isolation
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('second','Second Org') RETURNING id::text`,
	).Scan(&org2ID); err != nil {
		t.Fatalf("seed org2: %v", err)
	}

	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','s1','user1@test.local','User One') RETURNING id::text`, org1ID,
	).Scan(&user1ID); err != nil {
		t.Fatalf("seed user1: %v", err)
	}

	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','s2','user2@test.local','User Two') RETURNING id::text`, org2ID,
	).Scan(&user2ID); err != nil {
		t.Fatalf("seed user2: %v", err)
	}
	return
}

func TestSearch_OrgScoped(t *testing.T) {
	pool, org1ID, org2ID, user1ID, user2ID := setupDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	// Seed docs in org1 and org2 with distinguishable titles.
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.docs_documents (org_id, owner_id, title) VALUES ($1,$2,'Alpha Doc')`,
		org1ID, user1ID); err != nil {
		t.Fatalf("seed doc org1: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.docs_documents (org_id, owner_id, title) VALUES ($1,$2,'Alpha Doc')`,
		org2ID, user2ID); err != nil {
		t.Fatalf("seed doc org2: %v", err)
	}

	// Seed a keep note in org1 only.
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.keep_notes (org_id, owner_id, title, body) VALUES ($1,$2,'Alpha Note','some body')`,
		org1ID, user1ID); err != nil {
		t.Fatalf("seed keep org1: %v", err)
	}

	// Search from org1's perspective — should see 2 results (1 doc + 1 note).
	res1, err := repo.Search(ctx, org1ID, user1ID, "alpha", 10)
	if err != nil {
		t.Fatalf("Search org1: %v", err)
	}
	if len(res1) != 2 {
		t.Errorf("org1: want 2 results, got %d: %+v", len(res1), res1)
	}

	// Search from org2's perspective — should only see 1 result (their own doc).
	res2, err := repo.Search(ctx, org2ID, user2ID, "alpha", 10)
	if err != nil {
		t.Fatalf("Search org2: %v", err)
	}
	if len(res2) != 1 {
		t.Errorf("org2: want 1 result, got %d: %+v", len(res2), res2)
	}
}

func TestSearch_MatchedAndGrouped(t *testing.T) {
	pool, org1ID, _, user1ID, _ := setupDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	// Seed one item each in drive, docs, keep with "widget" in the title.
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.drive_files (org_id, owner_id, name, mime_type) VALUES ($1,$2,'widget.pdf','application/pdf')`,
		org1ID, user1ID); err != nil {
		t.Fatalf("seed drive: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.docs_documents (org_id, owner_id, title) VALUES ($1,$2,'Widget Guide')`,
		org1ID, user1ID); err != nil {
		t.Fatalf("seed docs: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.keep_notes (org_id, owner_id, title, body) VALUES ($1,$2,'Widget Note','body text')`,
		org1ID, user1ID); err != nil {
		t.Fatalf("seed keep: %v", err)
	}

	res, err := repo.Search(ctx, org1ID, user1ID, "widget", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res) != 3 {
		t.Errorf("want 3 results, got %d: %+v", len(res), res)
	}

	// Check types present.
	types := map[string]bool{}
	for _, r := range res {
		types[r.Type] = true
		if r.URL == "" {
			t.Errorf("result %q has empty URL", r.Title)
		}
	}
	for _, want := range []string{"drive", "docs", "keep"} {
		if !types[want] {
			t.Errorf("expected type %q in results", want)
		}
	}
}

func TestSearch_NoMatch(t *testing.T) {
	pool, org1ID, _, user1ID, _ := setupDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	res, err := repo.Search(ctx, org1ID, user1ID, "zzznomatch", 10)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(res) != 0 {
		t.Errorf("want 0 results, got %d", len(res))
	}
}

func TestSearch_MailPerUser(t *testing.T) {
	pool, org1ID, org2ID, user1ID, user2ID := setupDB(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	// Seed a mail message for user1 (org1) with "budget" in subject.
	if _, err := pool.Exec(ctx,
		`INSERT INTO grown.mail_messages
		 (org_id, owner_id, folder, from_addr, from_name, to_addrs, cc_addrs, subject, body, snippet, is_read, starred, labels, attachments)
		 VALUES ($1,$2,'inbox','a@b.com','Alice','[]','[]','Budget Review','full body','budget preview',false,false,'[]','[]')`,
		org1ID, user1ID); err != nil {
		t.Fatalf("seed mail user1: %v", err)
	}

	// user2 searching should not see user1's mail.
	res2, err := repo.Search(ctx, org2ID, user2ID, "budget", 10)
	if err != nil {
		t.Fatalf("Search user2: %v", err)
	}
	for _, r := range res2 {
		if r.Type == "mail" {
			t.Errorf("user2 should not see user1's mail, got: %+v", r)
		}
	}

	// user1 searching should see their own mail.
	res1, err := repo.Search(ctx, org1ID, user1ID, "budget", 10)
	if err != nil {
		t.Fatalf("Search user1: %v", err)
	}
	found := false
	for _, r := range res1 {
		if r.Type == "mail" && r.Title == "Budget Review" {
			found = true
		}
	}
	if !found {
		t.Errorf("user1 should find their own mail; got: %+v", res1)
	}
}
