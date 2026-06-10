package keep

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/users"

	"github.com/jackc/pgx/v5/pgxpool"
)

// authCtx returns a context carrying the seeded user + org.
func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, DisplayName: "Tester", Email: "tester@keep.localtest.me"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

// makeOrgUser creates an org + user in it, returning (orgID, userID).
func makeOrgUser(t *testing.T, pool *pgxpool.Pool, slug, subject, email string) (string, string) {
	t.Helper()
	var orgID string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.orgs (slug, display_name) VALUES ($1, $1) RETURNING id::text`, slug,
	).Scan(&orgID); err != nil {
		t.Fatalf("create org %s: %v", slug, err)
	}
	var userID string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', $2, $3, $3) RETURNING id::text`, orgID, subject, email,
	).Scan(&userID); err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	return orgID, userID
}

// TestReminderSetClearList tests reminder set/clear/list-by-upcoming.
func TestReminderSetClearList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authCtx(orgID, userID)

	// Create a note via repo.
	n, err := repo.Create(context.Background(), orgID, userID, Fields{Title: "Buy milk"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// ListNoteReminders should be empty initially.
	remResp, err := svc.ListNoteReminders(ctx, &grownv1.ListKeepNoteRemindersRequest{})
	if err != nil {
		t.Fatalf("ListNoteReminders empty: %v", err)
	}
	if len(remResp.GetNotes()) != 0 {
		t.Fatalf("expected 0 reminders, got %d", len(remResp.GetNotes()))
	}

	// Set a reminder.
	future := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	setResp, err := svc.SetReminder(ctx, &grownv1.SetKeepReminderRequest{
		Id:       n.ID,
		RemindAt: future.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("SetReminder: %v", err)
	}
	if setResp.GetRemindAt() == "" {
		t.Fatalf("SetReminder: remind_at empty in response")
	}

	// ListNoteReminders should now include the note.
	remResp, err = svc.ListNoteReminders(ctx, &grownv1.ListKeepNoteRemindersRequest{})
	if err != nil {
		t.Fatalf("ListNoteReminders after set: %v", err)
	}
	if len(remResp.GetNotes()) != 1 || remResp.GetNotes()[0].GetId() != n.ID {
		t.Fatalf("ListNoteReminders: got %v", remResp.GetNotes())
	}

	// Clear the reminder.
	clearResp, err := svc.ClearReminder(ctx, &grownv1.ClearKeepReminderRequest{Id: n.ID})
	if err != nil {
		t.Fatalf("ClearReminder: %v", err)
	}
	if clearResp.GetRemindAt() != "" {
		t.Fatalf("ClearReminder: expected empty remind_at, got %q", clearResp.GetRemindAt())
	}

	// ListNoteReminders should be empty again.
	remResp, err = svc.ListNoteReminders(ctx, &grownv1.ListKeepNoteRemindersRequest{})
	if err != nil {
		t.Fatalf("ListNoteReminders after clear: %v", err)
	}
	if len(remResp.GetNotes()) != 0 {
		t.Fatalf("expected 0 reminders after clear, got %d", len(remResp.GetNotes()))
	}
}

// TestReminderInvalidTimestamp verifies a bad RFC3339 is rejected.
func TestReminderInvalidTimestamp(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authCtx(orgID, userID)

	n, err := repo.Create(context.Background(), orgID, userID, Fields{Title: "foo"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	_, err = svc.SetReminder(ctx, &grownv1.SetKeepReminderRequest{Id: n.ID, RemindAt: "not-a-date"})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for bad timestamp, got %v", err)
	}
}

// TestCrossOrgNoteGrantAccess mirrors docs/grants_test.go for Keep notes.
//
// Security-critical ACL path:
//   - non-org-member cannot read without a grant (NotFound),
//   - grantee in a different org CAN read once granted (cross-org),
//   - existence not leaked to non-grantees,
//   - grants list/revoke behave,
//   - bob (grantee) cannot manage grants or trash,
//   - revoke re-denies access.
func TestCrossOrgNoteGrantAccess(t *testing.T) {
	pool, orgA, alice := setupDB(t)
	grants := sharing.NewRepository(pool)
	svc := NewService(NewRepository(pool)).WithSharing(grants)

	// Bob lives in a separate personal org — no org overlap with alice.
	bobOrg, bob := makeOrgUser(t, pool, "personal-bob", "subject-bob", "bob@test")

	aliceCtx := authCtx(orgA, alice)
	bobCtx := authCtx(bobOrg, bob)

	note, err := svc.CreateNote(aliceCtx, &grownv1.CreateKeepNoteRequest{Title: "Secret note"})
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	// 1. Before any grant, bob (different org) is denied with NotFound — the
	//    note must NOT leak to a non-grantee.
	if _, err := svc.GetNote(bobCtx, &grownv1.GetKeepNoteRequest{Id: note.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetNote non-grantee: got %v want NotFound", status.Code(err))
	}

	// 2. Alice grants bob viewer.
	if _, err := svc.GrantNoteAccess(aliceCtx, &grownv1.GrantKeepNoteAccessRequest{
		NoteId: note.GetId(), GranteeUserId: bob, Role: sharing.RoleViewer,
	}); err != nil {
		t.Fatalf("GrantNoteAccess: %v", err)
	}

	// 3. Now bob can read it (cross-org).
	got, err := svc.GetNote(bobCtx, &grownv1.GetKeepNoteRequest{Id: note.GetId()})
	if err != nil {
		t.Fatalf("GetNote grantee: %v", err)
	}
	if got.GetTitle() != "Secret note" {
		t.Fatalf("GetNote grantee title = %q", got.GetTitle())
	}

	// 4. Bob's "Shared with me" includes the note; alice's does not.
	swm, err := svc.ListNotesSharedWithMe(bobCtx, &grownv1.ListKeepNotesSharedWithMeRequest{})
	if err != nil {
		t.Fatalf("ListNotesSharedWithMe bob: %v", err)
	}
	if len(swm.GetNotes()) != 1 || swm.GetNotes()[0].GetId() != note.GetId() {
		t.Fatalf("bob shared-with-me = %+v; want the one note", swm.GetNotes())
	}
	if aswm, _ := svc.ListNotesSharedWithMe(aliceCtx, &grownv1.ListKeepNotesSharedWithMeRequest{}); len(aswm.GetNotes()) != 0 {
		t.Fatalf("alice shared-with-me = %+v; want empty (own org)", aswm.GetNotes())
	}

	// 5. Bob (grantee, not org member) cannot manage grants or trash.
	if _, err := svc.GrantNoteAccess(bobCtx, &grownv1.GrantKeepNoteAccessRequest{
		NoteId: note.GetId(), GranteeUserId: alice, Role: sharing.RoleViewer,
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob GrantNoteAccess: got %v want NotFound", status.Code(err))
	}
	if _, err := svc.TrashNote(bobCtx, &grownv1.TrashKeepNoteRequest{Id: note.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob TrashNote: got %v want NotFound", status.Code(err))
	}

	// 6. Alice lists grants and sees bob.
	gl, err := svc.ListNoteGrants(aliceCtx, &grownv1.ListKeepNoteGrantsRequest{NoteId: note.GetId()})
	if err != nil || len(gl.GetGrants()) != 1 || gl.GetGrants()[0].GetGranteeUserId() != bob {
		t.Fatalf("ListNoteGrants = %+v, %v; want [bob]", gl.GetGrants(), err)
	}

	// 7. Revoke → bob loses access (NotFound again).
	if _, err := svc.RevokeNoteAccess(aliceCtx, &grownv1.RevokeKeepNoteAccessRequest{
		NoteId: note.GetId(), GranteeUserId: bob,
	}); err != nil {
		t.Fatalf("RevokeNoteAccess: %v", err)
	}
	if _, err := svc.GetNote(bobCtx, &grownv1.GetKeepNoteRequest{Id: note.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetNote after revoke: got %v want NotFound", status.Code(err))
	}
}
