package books

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
		t.Skip("GROWN_TEST_DSN not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var orgID, userID string
	pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID)
	pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'x', 'y', 'z@x', 'Z') RETURNING id::text`,
		orgID,
	).Scan(&userID)
	return pool, orgID, userID
}

func TestRepository_CreateGetList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, err := r.Create(ctx, orgID, userID, Fields{Title: "Moby Dick", Author: "Melville", Format: "epub"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if b.Title != "Moby Dick" || b.Format != "epub" || b.HasCover() {
		t.Errorf("unexpected book: %+v", b)
	}

	got, err := r.Get(ctx, orgID, b.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != b.ID {
		t.Errorf("get returned %q want %q", got.ID, b.ID)
	}

	list, err := r.List(ctx, orgID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].ID != b.ID {
		t.Errorf("expected just the new book, got %+v", list)
	}
}

func TestRepository_OrgScoping(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	// A second org + user.
	var otherOrg, otherUser string
	pool.QueryRow(ctx, `INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg)
	pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'a','b','c@d','D') RETURNING id::text`, otherOrg).Scan(&otherUser)

	mine, _ := r.Create(ctx, orgID, userID, Fields{Title: "Mine", Format: "pdf"})
	_, _ = r.Create(ctx, otherOrg, otherUser, Fields{Title: "Theirs", Format: "pdf"})

	// List is scoped to the org.
	mineList, _ := r.List(ctx, orgID)
	if len(mineList) != 1 || mineList[0].ID != mine.ID {
		t.Errorf("org scoping leaked: %+v", mineList)
	}
	// Cross-org Get must fail.
	if _, err := r.Get(ctx, otherOrg, mine.ID); err != ErrNotFound {
		t.Errorf("expected ErrNotFound on cross-org get, got %v", err)
	}
}

func TestRepository_UpdateAndProgress(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "Draft", Format: "txt"})

	upd, err := r.Update(ctx, orgID, b.ID, Fields{Title: "Final", Author: "Me", Description: "d", Starred: true})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.Title != "Final" || upd.Author != "Me" || !upd.Starred {
		t.Errorf("update not applied: %+v", upd)
	}

	prog, err := r.UpdateProgress(ctx, orgID, b.ID, Progress{LastLocation: "p42", ProgressPercent: 150, Finished: true})
	if err != nil {
		t.Fatalf("progress: %v", err)
	}
	if prog.LastLocation != "p42" || prog.ProgressPercent != 100 || !prog.Finished {
		t.Errorf("progress clamping/update wrong: %+v", prog)
	}
}

func TestRepository_SetFileAndCover(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "F", Format: "pdf"})
	withFile, err := r.SetFile(ctx, orgID, b.ID, "books/file/abc", "f.pdf", "application/pdf", 1234)
	if err != nil {
		t.Fatalf("set file: %v", err)
	}
	if withFile.FileKey == nil || *withFile.FileKey != "books/file/abc" || withFile.SizeBytes != 1234 {
		t.Errorf("set file wrong: %+v", withFile)
	}

	withCover, err := r.SetCover(ctx, orgID, b.ID, "books/cover/xyz")
	if err != nil {
		t.Fatalf("set cover: %v", err)
	}
	if !withCover.HasCover() {
		t.Errorf("expected has cover: %+v", withCover)
	}
}

func TestRepository_Trash(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "Tmp", Format: "txt"})
	_, _ = r.SetFile(ctx, orgID, b.ID, "books/file/eph", "e.txt", "text/plain", 4)

	fileKey, _, err := r.Trash(ctx, orgID, b.ID)
	if err != nil {
		t.Fatalf("trash: %v", err)
	}
	if fileKey == nil || *fileKey != "books/file/eph" {
		t.Errorf("trash should return file key, got %v", fileKey)
	}
	// Gone from list + get.
	if list, _ := r.List(ctx, orgID); len(list) != 0 {
		t.Errorf("trashed book still listed: %+v", list)
	}
	if _, err := r.Get(ctx, orgID, b.ID); err != ErrNotFound {
		t.Errorf("expected ErrNotFound after trash, got %v", err)
	}
	// Double-trash is ErrNotFound.
	if _, _, err := r.Trash(ctx, orgID, b.ID); err != ErrNotFound {
		t.Errorf("double trash: want ErrNotFound got %v", err)
	}
}
