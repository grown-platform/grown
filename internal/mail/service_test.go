package mail

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"
)

// setupDB drops/recreates the grown schema, runs migrations, and seeds an org +
// user. Skips unless GROWN_TEST_DSN points at a throwaway Postgres.
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
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
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

func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{
		ID: userID, OrgID: orgID, Email: "tester@grown.localtest.me", DisplayName: "Tester",
	})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func newSvc(pool *pgxpool.Pool) *Service {
	repo := NewRepository(pool)
	return NewService(NewLocalBackend(repo), repo)
}

// insertInbox inserts an inbox message for the owner, returning the stored copy.
func insertInbox(t *testing.T, repo *Repository, orgID, ownerID, threadID, subject, body string) Message {
	t.Helper()
	m, err := repo.Insert(context.Background(), Message{
		OrgID: orgID, OwnerID: ownerID, ThreadID: threadID, Folder: "inbox",
		FromAddr: "alice@grown.localtest.me", FromName: "Alice",
		ToAddrs: []string{"tester@grown.localtest.me"}, Subject: subject, Body: body, Snippet: body,
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	return m
}

func TestListThreads_GroupsByThread(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	// Two messages in one thread, one in another.
	t1 := insertInbox(t, repo, orgID, userID, "", "Hello", "first")
	time.Sleep(2 * time.Millisecond)
	insertInbox(t, repo, orgID, userID, t1.ThreadID, "Re: Hello", "second")
	time.Sleep(2 * time.Millisecond)
	insertInbox(t, repo, orgID, userID, "", "Standalone", "lonely")

	resp, err := svc.ListThreads(ctx, &grownv1.ListMessagesRequest{Folder: "inbox"})
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if len(resp.GetThreads()) != 2 {
		t.Fatalf("got %d threads, want 2", len(resp.GetThreads()))
	}
	// Newest thread first: the standalone message is newest.
	top := resp.GetThreads()[0]
	if top.GetMessageCount() != 1 || top.GetLatest().GetSubject() != "Standalone" {
		t.Errorf("unexpected top thread: count=%d subject=%q", top.GetMessageCount(), top.GetLatest().GetSubject())
	}
	// The Hello thread has 2 messages and surfaces the latest reply.
	hello := resp.GetThreads()[1]
	if hello.GetMessageCount() != 2 {
		t.Errorf("hello thread count = %d, want 2", hello.GetMessageCount())
	}
	if hello.GetLatest().GetSubject() != "Re: Hello" {
		t.Errorf("hello latest subject = %q, want Re: Hello", hello.GetLatest().GetSubject())
	}
	if !hello.GetAnyUnread() {
		t.Errorf("hello thread should be unread")
	}
}

func TestGetThread_ReturnsAllAndMarksRead(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	t1 := insertInbox(t, repo, orgID, userID, "", "Hello", "first")
	insertInbox(t, repo, orgID, userID, t1.ThreadID, "Re: Hello", "second")

	resp, err := svc.GetThread(ctx, &grownv1.GetThreadRequest{ThreadId: t1.ThreadID})
	if err != nil {
		t.Fatalf("GetThread: %v", err)
	}
	if len(resp.GetMessages()) != 2 {
		t.Fatalf("got %d messages, want 2", len(resp.GetMessages()))
	}
	// Oldest first, full bodies present.
	if resp.GetMessages()[0].GetBody() != "first" {
		t.Errorf("first body = %q", resp.GetMessages()[0].GetBody())
	}
	// All marked read -> thread no longer counted unread.
	list, err := svc.ListThreads(ctx, &grownv1.ListMessagesRequest{Folder: "inbox"})
	if err != nil {
		t.Fatalf("ListThreads: %v", err)
	}
	if list.GetThreads()[0].GetAnyUnread() {
		t.Errorf("thread should be read after GetThread")
	}
}

func TestSnooze_HidesFromInboxAndShowsInSnoozed(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	m := insertInbox(t, repo, orgID, userID, "", "Snooze me", "later")

	// Snooze 1 hour into the future.
	until := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	if _, err := svc.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{
		Id: m.ID, IsRead: m.IsRead, SetSnooze: true, SnoozeUntil: until,
	}); err != nil {
		t.Fatalf("ModifyMessage snooze: %v", err)
	}

	// Inbox no longer shows it.
	inbox, err := svc.ListMessages(ctx, &grownv1.ListMessagesRequest{Folder: "inbox"})
	if err != nil {
		t.Fatalf("ListMessages inbox: %v", err)
	}
	if len(inbox.GetMessages()) != 0 {
		t.Fatalf("inbox should be empty, got %d", len(inbox.GetMessages()))
	}
	// Snoozed folder shows it, with snooze_until set.
	snoozed, err := svc.ListMessages(ctx, &grownv1.ListMessagesRequest{Folder: "snoozed"})
	if err != nil {
		t.Fatalf("ListMessages snoozed: %v", err)
	}
	if len(snoozed.GetMessages()) != 1 {
		t.Fatalf("snoozed should have 1, got %d", len(snoozed.GetMessages()))
	}
	if snoozed.GetMessages()[0].GetSnoozeUntil() == "" {
		t.Errorf("snooze_until should be set")
	}
	if snoozed.GetUnread()["snoozed"] != 1 {
		t.Errorf("snoozed unread count = %d, want 1", snoozed.GetUnread()["snoozed"])
	}

	// Un-snooze: returns to inbox.
	if _, err := svc.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{
		Id: m.ID, IsRead: true, SetSnooze: true, SnoozeUntil: "",
	}); err != nil {
		t.Fatalf("ModifyMessage unsnooze: %v", err)
	}
	inbox2, err := svc.ListMessages(ctx, &grownv1.ListMessagesRequest{Folder: "inbox"})
	if err != nil {
		t.Fatalf("ListMessages inbox2: %v", err)
	}
	if len(inbox2.GetMessages()) != 1 {
		t.Fatalf("inbox should have 1 after un-snooze, got %d", len(inbox2.GetMessages()))
	}
}

func TestSnooze_PastTimeReappearsInInbox(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	m := insertInbox(t, repo, orgID, userID, "", "Past snooze", "x")
	past := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	if _, err := svc.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{
		Id: m.ID, IsRead: m.IsRead, SetSnooze: true, SnoozeUntil: past,
	}); err != nil {
		t.Fatalf("ModifyMessage: %v", err)
	}
	// A snooze time in the past means the message is visible in inbox again.
	inbox, err := svc.ListMessages(ctx, &grownv1.ListMessagesRequest{Folder: "inbox"})
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(inbox.GetMessages()) != 1 {
		t.Fatalf("inbox should show expired-snooze message, got %d", len(inbox.GetMessages()))
	}
}

func TestModifyMessage_RejectsBadSnoozeTime(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	m := insertInbox(t, repo, orgID, userID, "", "X", "y")
	_, err := svc.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{
		Id: m.ID, SetSnooze: true, SnoozeUntil: "not-a-time",
	})
	if err == nil {
		t.Fatalf("expected error for bad snooze time")
	}
}

func TestListLabels_DistinctSorted(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	m1 := insertInbox(t, repo, orgID, userID, "", "A", "a")
	m2 := insertInbox(t, repo, orgID, userID, "", "B", "b")
	if _, err := svc.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{
		Id: m1.ID, SetLabels: true, Labels: []string{"Work", "Urgent"},
	}); err != nil {
		t.Fatalf("label m1: %v", err)
	}
	if _, err := svc.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{
		Id: m2.ID, SetLabels: true, Labels: []string{"Work"},
	}); err != nil {
		t.Fatalf("label m2: %v", err)
	}
	resp, err := svc.ListLabels(ctx, &grownv1.ListLabelsRequest{})
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	got := resp.GetLabels()
	if len(got) != 2 || got[0] != "Urgent" || got[1] != "Work" {
		t.Fatalf("labels = %v, want [Urgent Work]", got)
	}

	// Filter-by-label returns only matching messages.
	filtered, err := svc.ListThreads(ctx, &grownv1.ListMessagesRequest{Folder: "inbox", Label: "Urgent"})
	if err != nil {
		t.Fatalf("ListThreads label filter: %v", err)
	}
	if len(filtered.GetThreads()) != 1 {
		t.Fatalf("Urgent filter = %d threads, want 1", len(filtered.GetThreads()))
	}
}

// --- Label entity CRUD integration tests ---

func TestCreateListDeleteMailLabel(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	// Create two labels.
	l1, err := svc.CreateMailLabel(ctx, &grownv1.CreateMailLabelRequest{Name: "Work", Color: "#ff0000"})
	if err != nil {
		t.Fatalf("CreateMailLabel Work: %v", err)
	}
	if l1.GetName() != "Work" || l1.GetColor() != "#ff0000" {
		t.Errorf("unexpected label: %+v", l1)
	}
	if l1.GetId() == "" {
		t.Errorf("label id should be set")
	}

	_, err = svc.CreateMailLabel(ctx, &grownv1.CreateMailLabelRequest{Name: "Personal", Color: "#00ff00"})
	if err != nil {
		t.Fatalf("CreateMailLabel Personal: %v", err)
	}

	// ListLabels returns both in label_objects.
	listResp, err := svc.ListLabels(ctx, &grownv1.ListLabelsRequest{})
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(listResp.GetLabelObjects()) != 2 {
		t.Fatalf("label_objects count = %d, want 2", len(listResp.GetLabelObjects()))
	}
	// Sorted by name: Personal, Work.
	if listResp.GetLabelObjects()[0].GetName() != "Personal" || listResp.GetLabelObjects()[1].GetName() != "Work" {
		t.Errorf("wrong label order: %v", listResp.GetLabelObjects())
	}

	// Update: rename + color change.
	upd, err := svc.UpdateMailLabel(ctx, &grownv1.UpdateMailLabelRequest{Id: l1.GetId(), Name: "Work 2", Color: "#0000ff"})
	if err != nil {
		t.Fatalf("UpdateMailLabel: %v", err)
	}
	if upd.GetName() != "Work 2" || upd.GetColor() != "#0000ff" {
		t.Errorf("unexpected updated label: %+v", upd)
	}

	// DeleteMailLabel removes it.
	if _, err := svc.DeleteMailLabel(ctx, &grownv1.DeleteMailLabelRequest{Id: l1.GetId()}); err != nil {
		t.Fatalf("DeleteMailLabel: %v", err)
	}
	listResp2, err := svc.ListLabels(ctx, &grownv1.ListLabelsRequest{})
	if err != nil {
		t.Fatalf("ListLabels after delete: %v", err)
	}
	if len(listResp2.GetLabelObjects()) != 1 {
		t.Fatalf("label_objects after delete = %d, want 1", len(listResp2.GetLabelObjects()))
	}
}

func TestApplyRemoveMailLabel(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	m := insertInbox(t, repo, orgID, userID, "", "Label me", "body")
	label, err := svc.CreateMailLabel(ctx, &grownv1.CreateMailLabelRequest{Name: "Important", Color: "#ff0000"})
	if err != nil {
		t.Fatalf("CreateMailLabel: %v", err)
	}

	// Apply.
	if _, err := svc.ApplyMailLabel(ctx, &grownv1.ApplyMailLabelRequest{MessageId: m.ID, LabelId: label.GetId()}); err != nil {
		t.Fatalf("ApplyMailLabel: %v", err)
	}

	// Idempotent: apply again should not error.
	if _, err := svc.ApplyMailLabel(ctx, &grownv1.ApplyMailLabelRequest{MessageId: m.ID, LabelId: label.GetId()}); err != nil {
		t.Fatalf("ApplyMailLabel idempotent: %v", err)
	}

	// Remove.
	if _, err := svc.RemoveMailLabel(ctx, &grownv1.RemoveMailLabelRequest{MessageId: m.ID, LabelId: label.GetId()}); err != nil {
		t.Fatalf("RemoveMailLabel: %v", err)
	}
}

// --- Normalized filter CRUD + matcher unit tests ---

// TestFilterMatcher is a pure unit test (no DB) of the filterMatches function.
func TestFilterMatcher(t *testing.T) {
	msg := &Message{
		FromAddr: "alice@example.com",
		FromName: "Alice",
		ToAddrs:  []string{"bob@example.com"},
		Subject:  "Meeting tomorrow",
		Body:     "Let's meet at noon",
		Snippet:  "Let's meet at noon",
	}

	cases := []struct {
		name   string
		f      Filter
		expect bool
	}{
		{
			name:   "from contains match",
			f:      Filter{MatchField: "from", MatchOp: "contains", MatchValue: "alice"},
			expect: true,
		},
		{
			name:   "from contains no match",
			f:      Filter{MatchField: "from", MatchOp: "contains", MatchValue: "charlie"},
			expect: false,
		},
		{
			name:   "subject contains match (case-insensitive)",
			f:      Filter{MatchField: "subject", MatchOp: "contains", MatchValue: "MEETING"},
			expect: true,
		},
		{
			name:   "subject equals match",
			f:      Filter{MatchField: "subject", MatchOp: "equals", MatchValue: "meeting tomorrow"},
			expect: true,
		},
		{
			name:   "subject equals no match (partial)",
			f:      Filter{MatchField: "subject", MatchOp: "equals", MatchValue: "meeting"},
			expect: false,
		},
		{
			name:   "to contains match",
			f:      Filter{MatchField: "to", MatchOp: "contains", MatchValue: "bob"},
			expect: true,
		},
		{
			name:   "body contains match",
			f:      Filter{MatchField: "body", MatchOp: "contains", MatchValue: "noon"},
			expect: true,
		},
		{
			name:   "empty match_value never matches",
			f:      Filter{MatchField: "subject", MatchOp: "contains", MatchValue: ""},
			expect: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := filterMatches(msg, tc.f)
			if got != tc.expect {
				t.Errorf("filterMatches = %v, want %v", got, tc.expect)
			}
		})
	}
}

// TestApplyFilterMutation is a pure unit test of applyFilter.
func TestApplyFilterMutation(t *testing.T) {
	t.Run("label action adds label", func(t *testing.T) {
		m := &Message{Labels: []string{"existing"}}
		applyFilter(m, Filter{ActionType: "label", ActionValue: "new"})
		if !contains(m.Labels, "new") {
			t.Errorf("expected 'new' label in %v", m.Labels)
		}
	})
	t.Run("label action is idempotent", func(t *testing.T) {
		m := &Message{Labels: []string{"existing"}}
		applyFilter(m, Filter{ActionType: "label", ActionValue: "existing"})
		count := 0
		for _, l := range m.Labels {
			if l == "existing" {
				count++
			}
		}
		if count != 1 {
			t.Errorf("expected exactly one 'existing' label, got %d", count)
		}
	})
	t.Run("mark_read", func(t *testing.T) {
		m := &Message{IsRead: false}
		applyFilter(m, Filter{ActionType: "mark_read"})
		if !m.IsRead {
			t.Errorf("expected message to be marked read")
		}
	})
	t.Run("archive moves from inbox", func(t *testing.T) {
		m := &Message{Folder: "inbox"}
		applyFilter(m, Filter{ActionType: "archive"})
		if m.Folder != "archive" {
			t.Errorf("expected folder=archive, got %q", m.Folder)
		}
	})
	t.Run("archive does not move non-inbox", func(t *testing.T) {
		m := &Message{Folder: "sent"}
		applyFilter(m, Filter{ActionType: "archive"})
		if m.Folder != "sent" {
			t.Errorf("expected folder=sent, got %q", m.Folder)
		}
	})
	t.Run("star", func(t *testing.T) {
		m := &Message{Starred: false}
		applyFilter(m, Filter{ActionType: "star"})
		if !m.Starred {
			t.Errorf("expected message to be starred")
		}
	})
}

// TestCreateListDeleteFilter tests the normalized filter CRUD via the service.
func TestCreateListDeleteFilter(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	// Create a filter.
	f, err := svc.CreateFilter(ctx, &grownv1.CreateFilterRequest{
		MatchField: "subject", MatchOp: "contains", MatchValue: "newsletter",
		ActionType: "label", ActionValue: "Newsletters",
	})
	if err != nil {
		t.Fatalf("CreateFilter: %v", err)
	}
	if f.GetId() == "" {
		t.Errorf("filter id should be set")
	}
	if f.GetMatchValue() != "newsletter" {
		t.Errorf("match_value = %q, want newsletter", f.GetMatchValue())
	}

	// List returns it.
	listResp, err := svc.ListFilters(ctx, &grownv1.ListFiltersRequest{})
	if err != nil {
		t.Fatalf("ListFilters: %v", err)
	}
	if len(listResp.GetFilters()) != 1 {
		t.Fatalf("filters count = %d, want 1", len(listResp.GetFilters()))
	}

	// Delete.
	if _, err := svc.DeleteFilter(ctx, &grownv1.DeleteFilterRequest{Id: f.GetId()}); err != nil {
		t.Fatalf("DeleteFilter: %v", err)
	}
	listResp2, err := svc.ListFilters(ctx, &grownv1.ListFiltersRequest{})
	if err != nil {
		t.Fatalf("ListFilters after delete: %v", err)
	}
	if len(listResp2.GetFilters()) != 0 {
		t.Fatalf("filters count after delete = %d, want 0", len(listResp2.GetFilters()))
	}
}

// TestApplyFiltersNow tests the "apply all filters to existing inbox" path.
func TestApplyFiltersNow(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	// Insert messages: one matching the filter, one not.
	insertInbox(t, repo, orgID, userID, "", "Newsletter: weekly digest", "read this")
	insertInbox(t, repo, orgID, userID, "", "Normal email", "hello")

	// Create a filter: subject contains "newsletter" -> label "Newsletters".
	if _, err := svc.CreateFilter(ctx, &grownv1.CreateFilterRequest{
		MatchField: "subject", MatchOp: "contains", MatchValue: "newsletter",
		ActionType: "label", ActionValue: "Newsletters",
	}); err != nil {
		t.Fatalf("CreateFilter: %v", err)
	}

	// Apply filters now.
	resp, err := svc.ApplyFilters(ctx, &grownv1.ApplyFiltersRequest{})
	if err != nil {
		t.Fatalf("ApplyFilters: %v", err)
	}
	if resp.GetModified() != 1 {
		t.Errorf("modified = %d, want 1", resp.GetModified())
	}

	// The matching message should have the Newsletters label.
	msgs, err := svc.ListMessages(ctx, &grownv1.ListMessagesRequest{Folder: "inbox", Label: "Newsletters"})
	if err != nil {
		t.Fatalf("ListMessages label: %v", err)
	}
	if len(msgs.GetMessages()) != 1 {
		t.Fatalf("filtered messages = %d, want 1", len(msgs.GetMessages()))
	}
}

// TestSearch tests that the query param filters by subject/from/snippet.
func TestSearch(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := newSvc(pool)
	ctx := authCtx(orgID, userID)

	insertInbox(t, repo, orgID, userID, "", "Project update", "status is green")
	insertInbox(t, repo, orgID, userID, "", "Team lunch tomorrow", "bring snacks")

	// Search by subject keyword.
	resp, err := svc.ListThreads(ctx, &grownv1.ListMessagesRequest{Query: "project"})
	if err != nil {
		t.Fatalf("ListThreads search: %v", err)
	}
	if len(resp.GetThreads()) != 1 {
		t.Fatalf("search 'project' = %d threads, want 1", len(resp.GetThreads()))
	}
	if resp.GetThreads()[0].GetLatest().GetSubject() != "Project update" {
		t.Errorf("unexpected subject: %q", resp.GetThreads()[0].GetLatest().GetSubject())
	}

	// Search by snippet content.
	resp2, err := svc.ListThreads(ctx, &grownv1.ListMessagesRequest{Query: "snacks"})
	if err != nil {
		t.Fatalf("ListThreads search snacks: %v", err)
	}
	if len(resp2.GetThreads()) != 1 {
		t.Fatalf("search 'snacks' = %d threads, want 1", len(resp2.GetThreads()))
	}

	// Search that matches nothing.
	resp3, err := svc.ListThreads(ctx, &grownv1.ListMessagesRequest{Query: "zzz-no-match"})
	if err != nil {
		t.Fatalf("ListThreads search no-match: %v", err)
	}
	if len(resp3.GetThreads()) != 0 {
		t.Fatalf("search no-match = %d threads, want 0", len(resp3.GetThreads()))
	}
}
