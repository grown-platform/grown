package meet

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so room rows can satisfy their foreign keys. Skips unless
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

	created, err := repo.Create(ctx, orgID, userID, "Team standup")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if created.Name != "Team standup" {
		t.Errorf("name: got %q want 'Team standup'", created.Name)
	}
	if created.OrgID != orgID || created.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", created)
	}

	got, err := repo.Get(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != created.ID || got.Name != "Team standup" {
		t.Errorf("Get mismatch: %+v", got)
	}
}

func TestRepository_Create_DefaultName(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)

	r, err := repo.Create(context.Background(), orgID, userID, "")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if r.Name != "Untitled meeting" {
		t.Errorf("default name: got %q", r.Name)
	}
}

func TestRepository_Get_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.Get(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func TestRepository_Get_WrongOrg(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	r, err := repo.Create(ctx, orgID, userID, "Private room")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Different org — should not be visible.
	_, err = repo.Get(ctx, "00000000-0000-0000-0000-000000000000", r.ID)
	if err != ErrNotFound {
		t.Errorf("cross-org Get: got %v, want ErrNotFound", err)
	}
}

func TestRepository_List(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if _, err := repo.Create(ctx, orgID, userID, "Room A"); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Create(ctx, orgID, userID, "Room B"); err != nil {
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

func TestRepository_List_OrgScoped(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if _, err := repo.Create(ctx, orgID, userID, "Org1 room"); err != nil {
		t.Fatal(err)
	}
	// Listing under a different org should return nothing.
	other := "00000000-0000-0000-0000-000000000001"
	list, err := repo.List(ctx, other)
	if err != nil {
		t.Fatalf("List other org: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("expected 0 rooms for other org, got %d", len(list))
	}
}

func TestRepository_Create_HasCode(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)

	r, err := repo.Create(context.Background(), orgID, userID, "Coded room")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !ValidCode(r.Code) {
		t.Errorf("code %q is not a valid xxx-xxxx-xxx code", r.Code)
	}
}

func TestRepository_GetByCode(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	created, err := repo.Create(ctx, orgID, userID, "Code lookup")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := repo.GetByCode(ctx, orgID, created.Code)
	if err != nil {
		t.Fatalf("GetByCode: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("GetByCode: id mismatch: got %q want %q", got.ID, created.ID)
	}
}

func TestRepository_GetByCode_WrongOrg(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	created, err := repo.Create(ctx, orgID, userID, "Private meeting")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	_, err = repo.GetByCode(ctx, "00000000-0000-0000-0000-000000000000", created.Code)
	if err != ErrNotFound {
		t.Errorf("cross-org GetByCode: got %v, want ErrNotFound", err)
	}
}

func TestRepository_GetByCode_InvalidFormat(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.GetByCode(context.Background(), orgID, "not-a-code")
	if err != ErrInvalidCode {
		t.Errorf("invalid code: got %v, want ErrInvalidCode", err)
	}
}

func TestRepository_GetByCode_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.GetByCode(context.Background(), orgID, "aaa-bbbb-ccc")
	if err != ErrNotFound {
		t.Errorf("unknown code: got %v, want ErrNotFound", err)
	}
}

func TestRepository_Delete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	r, err := repo.Create(ctx, orgID, userID, "Doomed room")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := repo.Delete(ctx, orgID, r.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, r.ID); err != ErrNotFound {
		t.Errorf("Get after Delete: got %v want ErrNotFound", err)
	}
	// Double delete.
	if err := repo.Delete(ctx, orgID, r.ID); err != ErrNotFound {
		t.Errorf("double delete: got %v want ErrNotFound", err)
	}
}
