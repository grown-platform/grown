package notifications

import (
	"context"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupDB(t *testing.T) (*pgxpool.Pool, string, string, string) {
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
	var userID, actorID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','sub1','user@example.com','User') RETURNING id::text`, orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','sub2','actor@example.com','Actor') RETURNING id::text`, orgID).Scan(&actorID); err != nil {
		t.Fatalf("seed actor: %v", err)
	}
	return pool, orgID, userID, actorID
}

func TestRepository_CreateAndList(t *testing.T) {
	pool, orgID, userID, actorID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Create two notifications; the second is created a bit later so ordering is deterministic.
	n1, err := repo.Create(ctx, CreateParams{
		OrgID:       orgID,
		UserID:      userID,
		Type:        "share_grant",
		ActorUserID: actorID,
		Title:       "Alice shared 'Doc 1' with you",
		Body:        "You have been granted viewer access.",
		TargetURL:   "/docs/doc1",
	})
	if err != nil {
		t.Fatalf("Create n1: %v", err)
	}
	if n1.ID == "" || n1.OrgID != orgID || n1.UserID != userID {
		t.Fatalf("unexpected n1: %+v", n1)
	}
	if n1.Read {
		t.Fatal("new notification should be unread")
	}

	// A tiny sleep ensures created_at ordering is stable.
	time.Sleep(2 * time.Millisecond)

	n2, err := repo.Create(ctx, CreateParams{
		OrgID:     orgID,
		UserID:    userID,
		Type:      "share_grant",
		Title:     "Bob shared 'Doc 2' with you",
		TargetURL: "/docs/doc2",
	})
	if err != nil {
		t.Fatalf("Create n2: %v", err)
	}

	list, err := repo.List(ctx, orgID, userID, time.Time{}, 0)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("want 2 notifications, got %d", len(list))
	}
	// Newest first: n2 should be first.
	if list[0].ID != n2.ID {
		t.Fatalf("expected n2 first (newest), got %s", list[0].ID)
	}
	if list[1].ID != n1.ID {
		t.Fatalf("expected n1 second, got %s", list[1].ID)
	}
}

func TestRepository_UnreadCount(t *testing.T) {
	pool, orgID, userID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	count, err := repo.UnreadCount(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("UnreadCount: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 unread initially, got %d", count)
	}

	n, _ := repo.Create(ctx, CreateParams{OrgID: orgID, UserID: userID, Type: "test", Title: "Hi"})
	count, _ = repo.UnreadCount(ctx, orgID, userID)
	if count != 1 {
		t.Fatalf("expected 1 unread, got %d", count)
	}

	if err := repo.MarkRead(ctx, orgID, userID, n.ID); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	count, _ = repo.UnreadCount(ctx, orgID, userID)
	if count != 0 {
		t.Fatalf("expected 0 after MarkRead, got %d", count)
	}
}

func TestRepository_MarkAllRead(t *testing.T) {
	pool, orgID, userID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if _, err := repo.Create(ctx, CreateParams{OrgID: orgID, UserID: userID, Type: "test", Title: "N"}); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}
	if err := repo.MarkAllRead(ctx, orgID, userID); err != nil {
		t.Fatalf("MarkAllRead: %v", err)
	}
	count, _ := repo.UnreadCount(ctx, orgID, userID)
	if count != 0 {
		t.Fatalf("expected 0 after MarkAllRead, got %d", count)
	}
}

func TestRepository_OrgUserIsolation(t *testing.T) {
	pool, orgID, userID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Create a second org + user.
	var otherOrg, otherUser string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email) VALUES ($1,'test','sub3','o@o.com') RETURNING id::text`,
		otherOrg).Scan(&otherUser); err != nil {
		t.Fatalf("seed other user: %v", err)
	}

	// Notification for the original user in original org.
	if _, err := repo.Create(ctx, CreateParams{OrgID: orgID, UserID: userID, Type: "t", Title: "for user1"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Notification for the other user in other org.
	if _, err := repo.Create(ctx, CreateParams{OrgID: otherOrg, UserID: otherUser, Type: "t", Title: "for user2"}); err != nil {
		t.Fatalf("Create other: %v", err)
	}

	list1, _ := repo.List(ctx, orgID, userID, time.Time{}, 0)
	if len(list1) != 1 {
		t.Fatalf("user1 wants 1 notification, got %d", len(list1))
	}
	list2, _ := repo.List(ctx, otherOrg, otherUser, time.Time{}, 0)
	if len(list2) != 1 {
		t.Fatalf("user2 wants 1 notification, got %d", len(list2))
	}
	// Cross-org/user query must return nothing.
	crossList, _ := repo.List(ctx, orgID, otherUser, time.Time{}, 0)
	if len(crossList) != 0 {
		t.Fatalf("cross-org leak: got %d", len(crossList))
	}
}

// TestSharingOnGrantFiresNotification verifies the OnGrant callback wiring.
// It does NOT need a database — it only checks that the callback is invoked.
func TestSharingOnGrantFiresNotification(t *testing.T) {
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
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
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email) VALUES ($1,'test','sg1','grant@test.com') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	var fired *sharing.GrantEvent
	sharingRepo := sharing.NewRepository(pool)
	sharingRepo.OnGrant = func(ctx context.Context, e sharing.GrantEvent) {
		fired = &e
	}

	fakeObjectID := "00000000-0000-0000-0000-000000000001"
	if err := sharingRepo.GrantAccess(ctx, sharing.TypeDriveFile, fakeObjectID, userID, sharing.RoleViewer, ""); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}
	if fired == nil {
		t.Fatal("OnGrant was not called after GrantAccess")
	}
	if fired.GranteeUserID != userID || fired.ObjectType != sharing.TypeDriveFile {
		t.Fatalf("unexpected event: %+v", fired)
	}
}
