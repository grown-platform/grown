package chat

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so chat rows can satisfy their foreign keys.
// Skips unless GROWN_TEST_DSN points at a throwaway Postgres.
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

func seedSecondUser(t *testing.T, pool *pgxpool.Pool, orgID string) string {
	t.Helper()
	ctx := context.Background()
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', 'subject-2', 'other@grown.localtest.me', 'Other')
		 RETURNING id::text`, orgID).Scan(&userID); err != nil {
		t.Fatalf("seed second user: %v", err)
	}
	return userID
}

func TestRepository_CreateAndGetChannel(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, err := repo.CreateChannel(ctx, orgID, "group", "General", []string{userID})
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	if ch.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if ch.OrgID != orgID {
		t.Errorf("org mismatch: got %q want %q", ch.OrgID, orgID)
	}
	if ch.Kind != "group" {
		t.Errorf("kind: got %q want group", ch.Kind)
	}
	if ch.Name != "General" {
		t.Errorf("name: got %q want General", ch.Name)
	}

	got, err := repo.GetChannel(ctx, orgID, ch.ID)
	if err != nil {
		t.Fatalf("GetChannel: %v", err)
	}
	if got.ID != ch.ID {
		t.Errorf("id mismatch")
	}
}

func TestRepository_GetChannel_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)

	_, err := repo.GetChannel(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("got %v want ErrNotFound", err)
	}
}

func TestRepository_ListChannelsForUser_OrgScoping(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	_, err := repo.CreateChannel(ctx, orgID, "group", "Chan A", []string{userID})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateChannel(ctx, orgID, "group", "Chan B", []string{userID})
	if err != nil {
		t.Fatal(err)
	}
	list, err := repo.ListChannelsForUser(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("ListChannelsForUser: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("got %d channels, want 2", len(list))
	}
	// Different org should return 0.
	list2, _ := repo.ListChannelsForUser(ctx, "00000000-0000-0000-0000-000000000000", userID)
	if len(list2) != 0 {
		t.Errorf("cross-org leak: got %d channels", len(list2))
	}
}

func TestRepository_FindDMChannel(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	other := seedSecondUser(t, pool, orgID)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, err := repo.CreateChannel(ctx, orgID, "dm", "", []string{userID, other})
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	found, err := repo.FindDMChannel(ctx, orgID, userID, other)
	if err != nil {
		t.Fatalf("FindDMChannel: %v", err)
	}
	if found.ID != ch.ID {
		t.Errorf("FindDMChannel id mismatch: got %q want %q", found.ID, ch.ID)
	}
}

func TestRepository_PostAndListMessages(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, _ := repo.CreateChannel(ctx, orgID, "group", "General", []string{userID})

	m1, err := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "hello", "")
	if err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if m1.ID == "" {
		t.Fatal("expected non-empty message id")
	}
	if m1.Body != "hello" {
		t.Errorf("body: got %q", m1.Body)
	}

	_, _ = repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "world", "")

	msgs, err := repo.ListMessages(ctx, orgID, ch.ID, "", 50)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(msgs) != 2 {
		t.Errorf("got %d messages, want 2", len(msgs))
	}
}

func TestRepository_DeleteMessage(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, _ := repo.CreateChannel(ctx, orgID, "group", "General", []string{userID})
	m, _ := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "to be deleted", "")

	if err := repo.DeleteMessage(ctx, orgID, ch.ID, m.ID, userID); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}
	// Deleting again should return ErrNotFound.
	if err := repo.DeleteMessage(ctx, orgID, ch.ID, m.ID, userID); err != ErrNotFound {
		t.Errorf("double delete: got %v, want ErrNotFound", err)
	}
}

func TestRepository_Reactions_ToggleAndGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	other := seedSecondUser(t, pool, orgID)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, _ := repo.CreateChannel(ctx, orgID, "group", "Reactions", []string{userID, other})
	m, _ := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "react to me", "")

	// Add reaction from userID.
	rxs, err := repo.ToggleReaction(ctx, orgID, m.ID, userID, "👍")
	if err != nil {
		t.Fatalf("ToggleReaction add: %v", err)
	}
	if len(rxs) != 1 || rxs[0].Emoji != "👍" || rxs[0].Count != 1 || !rxs[0].Me {
		t.Errorf("after add: got %+v", rxs)
	}

	// Add same reaction from other user.
	_, err = repo.ToggleReaction(ctx, orgID, m.ID, other, "👍")
	if err != nil {
		t.Fatalf("ToggleReaction other: %v", err)
	}
	rxs2, _ := repo.GetReactions(ctx, m.ID, userID)
	if len(rxs2) != 1 || rxs2[0].Count != 2 || !rxs2[0].Me {
		t.Errorf("after second react: got %+v", rxs2)
	}

	// Remove reaction from userID (toggle off).
	rxs3, err := repo.ToggleReaction(ctx, orgID, m.ID, userID, "👍")
	if err != nil {
		t.Fatalf("ToggleReaction remove: %v", err)
	}
	if len(rxs3) != 1 || rxs3[0].Count != 1 || rxs3[0].Me {
		t.Errorf("after remove: got %+v", rxs3)
	}
}

func TestRepository_Threads_PostAndList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, _ := repo.CreateChannel(ctx, orgID, "group", "Threads", []string{userID})
	parent, _ := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "root", "")

	_, err := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "reply 1", parent.ID)
	if err != nil {
		t.Fatalf("PostMessage reply: %v", err)
	}
	_, _ = repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "reply 2", parent.ID)

	replies, err := repo.ListThreadReplies(ctx, orgID, ch.ID, parent.ID, 50)
	if err != nil {
		t.Fatalf("ListThreadReplies: %v", err)
	}
	if len(replies) != 2 {
		t.Errorf("got %d replies, want 2", len(replies))
	}
	for _, r := range replies {
		if r.ParentID != parent.ID {
			t.Errorf("reply parent_id: got %q want %q", r.ParentID, parent.ID)
		}
	}

	// Top-level list should show only root (not replies) with reply_count=2.
	topLevel, err := repo.ListMessages(ctx, orgID, ch.ID, "", 50)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(topLevel) != 1 {
		t.Errorf("top-level: got %d, want 1", len(topLevel))
	}
	if topLevel[0].ReplyCount != 2 {
		t.Errorf("reply_count: got %d, want 2", topLevel[0].ReplyCount)
	}
}

func TestRepository_ReactionsForMessages_Batch(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	ch, _ := repo.CreateChannel(ctx, orgID, "group", "Batch", []string{userID})
	m1, _ := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "msg1", "")
	m2, _ := repo.PostMessage(ctx, ch.ID, orgID, userID, "Tester", "msg2", "")

	_, _ = repo.ToggleReaction(ctx, orgID, m1.ID, userID, "❤️")
	_, _ = repo.ToggleReaction(ctx, orgID, m2.ID, userID, "🎉")

	rxMap, err := repo.GetReactionsForMessages(ctx, []string{m1.ID, m2.ID}, userID)
	if err != nil {
		t.Fatalf("GetReactionsForMessages: %v", err)
	}
	if len(rxMap[m1.ID]) != 1 || rxMap[m1.ID][0].Emoji != "❤️" {
		t.Errorf("m1 reactions: %+v", rxMap[m1.ID])
	}
	if len(rxMap[m2.ID]) != 1 || rxMap[m2.ID][0].Emoji != "🎉" {
		t.Errorf("m2 reactions: %+v", rxMap[m2.ID])
	}
}
