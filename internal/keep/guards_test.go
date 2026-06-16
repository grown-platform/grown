package keep

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/users"
)

// noUserCtx carries an org but no user (should fail Unauthenticated).
func orgOnlyCtx() context.Context {
	return auth.WithOrg(context.Background(), orgs.Org{ID: "o1", Slug: "default"})
}

// userOnlyCtx carries a user but no org (should fail Internal: missing org).
func userOnlyCtx() context.Context {
	return auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1"})
}

// TestCallerOrgGuard exercises callerOrg's two failure modes directly.
func TestCallerOrgGuard(t *testing.T) {
	tests := []struct {
		name string
		ctx  context.Context
		want codes.Code
	}{
		{"no session", context.Background(), codes.Unauthenticated},
		{"org only, no user", orgOnlyCtx(), codes.Unauthenticated},
		{"user but no org", userOnlyCtx(), codes.Internal},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := callerOrg(tc.ctx)
			if status.Code(err) != tc.want {
				t.Fatalf("callerOrg = %v, want %v", status.Code(err), tc.want)
			}
		})
	}
}

// TestCallerOrgUserGuard exercises callerOrgUser's failure modes, plus the
// happy path returning both ids.
func TestCallerOrgUserGuard(t *testing.T) {
	t.Run("no session", func(t *testing.T) {
		_, _, err := callerOrgUser(context.Background())
		if status.Code(err) != codes.Unauthenticated {
			t.Fatalf("got %v want Unauthenticated", status.Code(err))
		}
	})
	t.Run("user but no org", func(t *testing.T) {
		_, _, err := callerOrgUser(userOnlyCtx())
		if status.Code(err) != codes.Internal {
			t.Fatalf("got %v want Internal", status.Code(err))
		}
	})
	t.Run("happy path returns ids", func(t *testing.T) {
		ctx := auth.WithOrg(
			auth.WithUser(context.Background(), users.User{ID: "u9", OrgID: "o9"}),
			orgs.Org{ID: "o9", Slug: "default"},
		)
		org, user, err := callerOrgUser(ctx)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if org != "o9" || user != "u9" {
			t.Fatalf("got org=%q user=%q, want o9/u9", org, user)
		}
	})
}

// unauthCtx is a context with neither user nor org — every RPC must reject it
// at the auth guard, BEFORE touching the (nil) repository. If any method
// dereferenced the repo first, these would panic instead of returning a
// status error, which is exactly what we are asserting against.
func unauthCtx() context.Context { return context.Background() }

// TestRPCUnauthenticatedShortCircuit drives every public RPC with a nil repo
// and an unauthenticated context. Each must return Unauthenticated without
// dereferencing the repo or grants. A nil *Repository is safe because the
// guard returns first.
func TestRPCUnauthenticatedShortCircuit(t *testing.T) {
	svc := NewService(nil) // nil repo: must never be reached
	ctx := unauthCtx()

	calls := []struct {
		name string
		fn   func() error
	}{
		{"ListNotes", func() error {
			_, err := svc.ListNotes(ctx, &grownv1.ListKeepNotesRequest{})
			return err
		}},
		{"CreateNote", func() error {
			_, err := svc.CreateNote(ctx, &grownv1.CreateKeepNoteRequest{})
			return err
		}},
		{"GetNote", func() error {
			_, err := svc.GetNote(ctx, &grownv1.GetKeepNoteRequest{Id: "x"})
			return err
		}},
		{"UpdateNote", func() error {
			_, err := svc.UpdateNote(ctx, &grownv1.UpdateKeepNoteRequest{Id: "x"})
			return err
		}},
		{"TrashNote", func() error {
			_, err := svc.TrashNote(ctx, &grownv1.TrashKeepNoteRequest{Id: "x"})
			return err
		}},
		{"SetReminder", func() error {
			_, err := svc.SetReminder(ctx, &grownv1.SetKeepReminderRequest{Id: "x"})
			return err
		}},
		{"ClearReminder", func() error {
			_, err := svc.ClearReminder(ctx, &grownv1.ClearKeepReminderRequest{Id: "x"})
			return err
		}},
		{"ListNoteReminders", func() error {
			_, err := svc.ListNoteReminders(ctx, &grownv1.ListKeepNoteRemindersRequest{})
			return err
		}},
		{"GrantNoteAccess", func() error {
			_, err := svc.GrantNoteAccess(ctx, &grownv1.GrantKeepNoteAccessRequest{NoteId: "x"})
			return err
		}},
		{"ListNoteGrants", func() error {
			_, err := svc.ListNoteGrants(ctx, &grownv1.ListKeepNoteGrantsRequest{NoteId: "x"})
			return err
		}},
		{"RevokeNoteAccess", func() error {
			_, err := svc.RevokeNoteAccess(ctx, &grownv1.RevokeKeepNoteAccessRequest{NoteId: "x"})
			return err
		}},
		{"ListNotesSharedWithMe", func() error {
			_, err := svc.ListNotesSharedWithMe(ctx, &grownv1.ListKeepNotesSharedWithMeRequest{})
			return err
		}},
		{"CreateLabel", func() error {
			_, err := svc.CreateLabel(ctx, &grownv1.CreateKeepLabelRequest{Name: "x"})
			return err
		}},
		{"ListLabels", func() error {
			_, err := svc.ListLabels(ctx, &grownv1.ListKeepLabelsRequest{})
			return err
		}},
		{"DeleteLabel", func() error {
			_, err := svc.DeleteLabel(ctx, &grownv1.DeleteKeepLabelRequest{Id: "x"})
			return err
		}},
		{"ApplyLabel", func() error {
			_, err := svc.ApplyLabel(ctx, &grownv1.ApplyKeepLabelRequest{NoteId: "x", LabelId: "y"})
			return err
		}},
		{"RemoveLabel", func() error {
			_, err := svc.RemoveLabel(ctx, &grownv1.RemoveKeepLabelRequest{NoteId: "x", LabelId: "y"})
			return err
		}},
		{"ArchiveNote", func() error {
			_, err := svc.ArchiveNote(ctx, &grownv1.ArchiveKeepNoteRequest{Id: "x"})
			return err
		}},
		{"UnarchiveNote", func() error {
			_, err := svc.UnarchiveNote(ctx, &grownv1.UnarchiveKeepNoteRequest{Id: "x"})
			return err
		}},
	}
	for _, c := range calls {
		t.Run(c.name, func(t *testing.T) {
			if got := status.Code(c.fn()); got != codes.Unauthenticated {
				t.Fatalf("%s with unauth ctx = %v, want Unauthenticated", c.name, got)
			}
		})
	}
}

// authedCtx carries a valid user+org so the auth guard passes and the
// sharing-disabled short-circuit (s.grants == nil) is reached without ever
// touching the repo.
func authedCtx() context.Context {
	return auth.WithOrg(
		auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1"}),
		orgs.Org{ID: "o1", Slug: "default"},
	)
}

// TestSharingDisabledShortCircuits proves that, with sharing not wired
// (s.grants == nil), the grant-management RPCs return WITHOUT touching the
// repo (which is nil here). Some return Unimplemented, others an empty result.
func TestSharingDisabledShortCircuits(t *testing.T) {
	svc := NewService(nil) // grants nil, repo nil
	ctx := authedCtx()

	t.Run("GrantNoteAccess Unimplemented", func(t *testing.T) {
		_, err := svc.GrantNoteAccess(ctx, &grownv1.GrantKeepNoteAccessRequest{
			NoteId: "n1", GranteeUserId: "u2", Role: sharing.RoleViewer,
		})
		if status.Code(err) != codes.Unimplemented {
			t.Fatalf("got %v want Unimplemented", status.Code(err))
		}
	})

	t.Run("RevokeNoteAccess Unimplemented", func(t *testing.T) {
		_, err := svc.RevokeNoteAccess(ctx, &grownv1.RevokeKeepNoteAccessRequest{NoteId: "n1"})
		if status.Code(err) != codes.Unimplemented {
			t.Fatalf("got %v want Unimplemented", status.Code(err))
		}
	})

	t.Run("ListNoteGrants empty", func(t *testing.T) {
		resp, err := svc.ListNoteGrants(ctx, &grownv1.ListKeepNoteGrantsRequest{NoteId: "n1"})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(resp.GetGrants()) != 0 {
			t.Fatalf("expected empty grants, got %d", len(resp.GetGrants()))
		}
	})

	t.Run("ListNotesSharedWithMe empty", func(t *testing.T) {
		resp, err := svc.ListNotesSharedWithMe(ctx, &grownv1.ListKeepNotesSharedWithMeRequest{})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(resp.GetNotes()) != 0 {
			t.Fatalf("expected empty notes, got %d", len(resp.GetNotes()))
		}
	})
}

// TestGrantNoteAccessValidation covers the input-validation guards that run
// after auth + the sharing-enabled check but before any repo access. We need a
// non-nil grants repo so the s.grants==nil branch is skipped; a sharing
// Repository over a nil pool is fine because validation rejects the request
// before any query runs.
func TestGrantNoteAccessValidation(t *testing.T) {
	svc := NewService(nil).WithSharing(sharing.NewRepository(nil))
	ctx := authedCtx()

	t.Run("invalid role", func(t *testing.T) {
		_, err := svc.GrantNoteAccess(ctx, &grownv1.GrantKeepNoteAccessRequest{
			NoteId: "n1", GranteeUserId: "u2", Role: "superuser",
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("got %v want InvalidArgument", status.Code(err))
		}
	})

	t.Run("empty role", func(t *testing.T) {
		_, err := svc.GrantNoteAccess(ctx, &grownv1.GrantKeepNoteAccessRequest{
			NoteId: "n1", GranteeUserId: "u2", Role: "",
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("got %v want InvalidArgument", status.Code(err))
		}
	})

	t.Run("missing grantee", func(t *testing.T) {
		_, err := svc.GrantNoteAccess(ctx, &grownv1.GrantKeepNoteAccessRequest{
			NoteId: "n1", GranteeUserId: "", Role: sharing.RoleViewer,
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("got %v want InvalidArgument", status.Code(err))
		}
	})
}

// TestCreateLabelEmptyName covers the name-required guard, which runs after
// auth but before the repo. TrimSpace means whitespace-only is also rejected.
func TestCreateLabelEmptyName(t *testing.T) {
	svc := NewService(nil)
	ctx := authedCtx()
	for _, name := range []string{"", "   ", "\t\n"} {
		_, err := svc.CreateLabel(ctx, &grownv1.CreateKeepLabelRequest{Name: name})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("CreateLabel(%q) = %v, want InvalidArgument", name, status.Code(err))
		}
	}
}

// TestSetReminderInvalidTimestampNoRepo proves the RFC3339 parse guard rejects
// a bad timestamp before any repo access (nil repo never dereferenced).
func TestSetReminderInvalidTimestampNoRepo(t *testing.T) {
	svc := NewService(nil)
	ctx := authedCtx()
	_, err := svc.SetReminder(ctx, &grownv1.SetKeepReminderRequest{Id: "n1", RemindAt: "yesterday"})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("got %v want InvalidArgument", status.Code(err))
	}
}
