package docs

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so document rows can satisfy their foreign keys. Skips unless
// GROWN_TEST_DSN points at a throwaway Postgres.
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

	var orgID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', 'subject-1', 'tester@grown.localtest.me', 'Tester')
		 RETURNING id::text`, orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func TestRepository_CreateAndGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	created, err := repo.Create(ctx, orgID, userID, "My Doc")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if created.Title != "My Doc" {
		t.Errorf("title: got %q want My Doc", created.Title)
	}
	if created.OrgID != orgID || created.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", created)
	}

	got, err := repo.Get(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != created.ID || got.Title != "My Doc" {
		t.Errorf("Get mismatch: %+v", got)
	}
}

func TestRepository_Create_DefaultTitle(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)

	d, err := repo.Create(context.Background(), orgID, userID, "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if d.Title != "Untitled document" {
		t.Errorf("default title: got %q", d.Title)
	}
}

func TestRepository_Get_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.Get(context.Background(), orgID,
		"00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func TestRepository_List(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if _, err := repo.Create(ctx, orgID, userID, "A"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Create(ctx, orgID, userID, "B"); err != nil {
		t.Fatal(err)
	}
	list, err := repo.List(ctx, orgID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("List len: got %d want 2", len(list))
	}
}

func TestRepository_Rename(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, _ := repo.Create(ctx, orgID, userID, "Before")
	got, err := repo.Rename(ctx, orgID, d.ID, "After")
	if err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if got.Title != "After" {
		t.Errorf("title: got %q want After", got.Title)
	}
}

func TestRepository_Trash_HidesFromGetAndList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, _ := repo.Create(ctx, orgID, userID, "Doomed")
	if err := repo.Trash(ctx, orgID, d.ID); err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, d.ID); err != ErrNotFound {
		t.Errorf("Get after trash: got %v want ErrNotFound", err)
	}
	list, _ := repo.List(ctx, orgID)
	if len(list) != 0 {
		t.Errorf("List after trash: got %d want 0", len(list))
	}
	if err := repo.Trash(ctx, orgID, d.ID); err != ErrNotFound {
		t.Errorf("double trash: got %v want ErrNotFound", err)
	}
}

func TestRepository_Versions(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, _ := repo.Create(ctx, orgID, userID, "Doc")

	v1, err := repo.CreateVersion(ctx, d.ID, userID, "", "<p>first</p>", true)
	if err != nil {
		t.Fatalf("CreateVersion: %v", err)
	}
	if v1.ID == "" || !v1.IsAuto {
		t.Errorf("v1 unexpected: %+v", v1)
	}
	if _, err := repo.CreateVersion(ctx, d.ID, userID, "Named", "<p>second</p>", false); err != nil {
		t.Fatalf("CreateVersion 2: %v", err)
	}

	list, err := repo.ListVersions(ctx, d.ID)
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("ListVersions len: got %d want 2", len(list))
	}
	// Newest first; list omits content_html but resolves author name.
	if list[0].Label != "Named" {
		t.Errorf("order: got %q want Named first", list[0].Label)
	}
	if list[0].ContentHTML != "" {
		t.Errorf("list should omit content_html, got %q", list[0].ContentHTML)
	}
	if list[0].AuthorName != "Tester" {
		t.Errorf("author name: got %q want Tester", list[0].AuthorName)
	}

	full, err := repo.GetVersion(ctx, d.ID, v1.ID)
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	if full.ContentHTML != "<p>first</p>" {
		t.Errorf("GetVersion content: got %q", full.ContentHTML)
	}

	if _, err := repo.GetVersion(ctx, d.ID, "00000000-0000-0000-0000-000000000000"); err != ErrNotFound {
		t.Errorf("GetVersion missing: got %v want ErrNotFound", err)
	}
}

func TestRepository_Comments(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, _ := repo.Create(ctx, orgID, userID, "Doc")

	c, err := repo.CreateComment(ctx, d.ID, userID, "Looks good", "hello world", 5, 16)
	if err != nil {
		t.Fatalf("CreateComment: %v", err)
	}
	if c.Resolved {
		t.Error("new comment should be unresolved")
	}
	if c.Quote != "hello world" || c.AnchorFrom != 5 || c.AnchorTo != 16 {
		t.Errorf("anchor mismatch: %+v", c)
	}

	list, err := repo.ListComments(ctx, d.ID)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(list) != 1 || list[0].AuthorName != "Tester" {
		t.Fatalf("ListComments: got %+v", list)
	}

	resolved, err := repo.ResolveComment(ctx, d.ID, c.ID, true)
	if err != nil {
		t.Fatalf("ResolveComment: %v", err)
	}
	if !resolved.Resolved || resolved.ResolvedAt == nil {
		t.Errorf("expected resolved: %+v", resolved)
	}
	reopened, err := repo.ResolveComment(ctx, d.ID, c.ID, false)
	if err != nil {
		t.Fatalf("ResolveComment reopen: %v", err)
	}
	if reopened.Resolved {
		t.Error("expected reopened")
	}

	if err := repo.DeleteComment(ctx, d.ID, c.ID); err != nil {
		t.Fatalf("DeleteComment: %v", err)
	}
	if err := repo.DeleteComment(ctx, d.ID, c.ID); err != ErrNotFound {
		t.Errorf("double delete: got %v want ErrNotFound", err)
	}
	list, _ = repo.ListComments(ctx, d.ID)
	if len(list) != 0 {
		t.Errorf("after delete: got %d want 0", len(list))
	}
}

func TestRepository_CommentThreading(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, _ := repo.Create(ctx, orgID, userID, "Threads")

	// Create a root comment.
	root, err := repo.CreateComment(ctx, d.ID, userID, "Root", "hello", 1, 6)
	if err != nil {
		t.Fatalf("CreateComment: %v", err)
	}
	if root.ParentCommentID != "" {
		t.Errorf("root ParentCommentID should be empty, got %q", root.ParentCommentID)
	}

	// Create a reply.
	reply, err := repo.ReplyToComment(ctx, d.ID, root.ID, userID, "Reply text")
	if err != nil {
		t.Fatalf("ReplyToComment: %v", err)
	}
	if reply.ParentCommentID != root.ID {
		t.Errorf("reply.ParentCommentID: got %q want %q", reply.ParentCommentID, root.ID)
	}

	// ListComments should return 1 root with 1 reply.
	list, err := repo.ListComments(ctx, d.ID)
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 root comment, got %d", len(list))
	}
	if len(list[0].Replies) != 1 {
		t.Fatalf("expected 1 reply, got %d", len(list[0].Replies))
	}
	if list[0].Replies[0].Body != "Reply text" {
		t.Errorf("reply body: got %q", list[0].Replies[0].Body)
	}

	// ReplyToComment on non-existent parent returns ErrNotFound.
	if _, err := repo.ReplyToComment(ctx, d.ID, "00000000-0000-0000-0000-000000000000", userID, "x"); err != ErrNotFound {
		t.Errorf("reply unknown parent: got %v want ErrNotFound", err)
	}
}

func TestRepository_UpdateLog_RoundTrip(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	d, _ := repo.Create(ctx, orgID, userID, "Doc")
	want := [][]byte{{0x01, 0x02}, {0x03}, {0x04, 0x05, 0x06}}
	for _, u := range want {
		if err := repo.AppendUpdate(ctx, d.ID, u); err != nil {
			t.Fatalf("AppendUpdate: %v", err)
		}
	}
	got, err := repo.Updates(ctx, d.ID)
	if err != nil {
		t.Fatalf("Updates: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("Updates len: got %d want %d", len(got), len(want))
	}
	for i := range want {
		if string(got[i]) != string(want[i]) {
			t.Errorf("update[%d]: got %v want %v", i, got[i], want[i])
		}
	}
}
