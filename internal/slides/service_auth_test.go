package slides

// service_auth_test.go exercises the auth + validation short-circuits in the
// Service handlers — the code paths that return a gRPC error BEFORE touching the
// repository (and thus the database). The repo is constructed over a nil pool to
// prove these paths never reach it; if a handler did fall through to the DB it
// would panic, failing the test. These complement grants_test.go (which is
// DB-gated) by covering the no-context and sharing-disabled branches with no DB.

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

// nilService builds a Service whose repository has no pool. Any handler that
// reaches the DB will panic; we only call handlers that short-circuit earlier.
func nilService() *Service { return NewService(NewRepository(nil)) }

// userOnlyCtx carries a user but no org — models a mis-wired request that should
// fail with Internal ("missing org context").
func userOnlyCtx() context.Context {
	return auth.WithUser(context.Background(), users.User{ID: "u-1", OrgID: "o-1"})
}

// orgOnlyCtx carries an org but no user — callerOrg/callerOrgUser must report
// Unauthenticated (no session) since the user check runs first.
func orgOnlyCtx() context.Context {
	return auth.WithOrg(context.Background(), orgs.Org{ID: "o-1", Slug: "default"})
}

// fullCtx carries both user and org but is backed by no DB; only valid for
// handlers we expect to short-circuit before the repo.
func fullCtx() context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: "u-1", OrgID: "o-1"})
	return auth.WithOrg(ctx, orgs.Org{ID: "o-1", Slug: "default"})
}

// TestHandlers_NoSession proves every handler refuses an unauthenticated context
// with codes.Unauthenticated before reaching the repository.
func TestHandlers_NoSession(t *testing.T) {
	svc := nilService()
	ctx := context.Background()
	cases := []struct {
		name string
		call func() error
	}{
		{"ListDecks", func() error { _, e := svc.ListDecks(ctx, &grownv1.ListDecksRequest{}); return e }},
		{"CreateDeck", func() error { _, e := svc.CreateDeck(ctx, &grownv1.CreateDeckRequest{}); return e }},
		{"GetDeck", func() error { _, e := svc.GetDeck(ctx, &grownv1.GetDeckRequest{Id: "d"}); return e }},
		{"RenameDeck", func() error { _, e := svc.RenameDeck(ctx, &grownv1.RenameDeckRequest{Id: "d"}); return e }},
		{"SaveDeck", func() error { _, e := svc.SaveDeck(ctx, &grownv1.SaveDeckRequest{Id: "d"}); return e }},
		{"TrashDeck", func() error { _, e := svc.TrashDeck(ctx, &grownv1.TrashDeckRequest{Id: "d"}); return e }},
		{"GrantAccess", func() error { _, e := svc.GrantAccess(ctx, &grownv1.GrantDeckAccessRequest{DeckId: "d"}); return e }},
		{"ListGrants", func() error { _, e := svc.ListGrants(ctx, &grownv1.ListDeckGrantsRequest{DeckId: "d"}); return e }},
		{"RevokeAccess", func() error { _, e := svc.RevokeAccess(ctx, &grownv1.RevokeDeckAccessRequest{DeckId: "d"}); return e }},
		{"ListSharedWithMe", func() error { _, e := svc.ListSharedWithMe(ctx, &grownv1.ListDecksSharedWithMeRequest{}); return e }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := status.Code(tc.call()); got != codes.Unauthenticated {
				t.Errorf("%s: code = %v want Unauthenticated", tc.name, got)
			}
		})
	}
}

// TestHandlers_OrgOnly: a context with an org but no user still fails as
// Unauthenticated, because the user (session) check runs before the org check.
func TestHandlers_OrgOnly_Unauthenticated(t *testing.T) {
	svc := nilService()
	ctx := orgOnlyCtx()
	if got := status.Code(mustErr(svc.ListDecks(ctx, &grownv1.ListDecksRequest{}))); got != codes.Unauthenticated {
		t.Errorf("ListDecks org-only: code = %v want Unauthenticated", got)
	}
	if got := status.Code(mustErr(svc.GetDeck(ctx, &grownv1.GetDeckRequest{Id: "d"}))); got != codes.Unauthenticated {
		t.Errorf("GetDeck org-only: code = %v want Unauthenticated", got)
	}
}

// TestHandlers_UserNoOrg: a session present but org context missing is an
// internal mis-wiring → codes.Internal ("missing org context").
func TestHandlers_UserNoOrg_Internal(t *testing.T) {
	svc := nilService()
	ctx := userOnlyCtx()
	cases := []struct {
		name string
		call func() error
	}{
		{"ListDecks", func() error { _, e := svc.ListDecks(ctx, &grownv1.ListDecksRequest{}); return e }},
		{"CreateDeck", func() error { _, e := svc.CreateDeck(ctx, &grownv1.CreateDeckRequest{}); return e }},
		{"GetDeck", func() error { _, e := svc.GetDeck(ctx, &grownv1.GetDeckRequest{Id: "d"}); return e }},
		{"ListSharedWithMe", func() error { _, e := svc.ListSharedWithMe(ctx, &grownv1.ListDecksSharedWithMeRequest{}); return e }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := status.Code(tc.call()); got != codes.Internal {
				t.Errorf("%s user-no-org: code = %v want Internal", tc.name, got)
			}
		})
	}
}

// TestSharingDisabled: when no sharing repo is wired, the grant handlers either
// reject (Unimplemented for mutating ops) or return empty (read ops) WITHOUT
// touching the deck repository. Authenticated context, nil pool, must not panic.
func TestSharingDisabled(t *testing.T) {
	svc := nilService() // .grants is nil (WithSharing never called)
	ctx := fullCtx()

	if _, err := svc.GrantAccess(ctx, &grownv1.GrantDeckAccessRequest{
		DeckId: "d", GranteeUserId: "g", Role: sharing.RoleViewer,
	}); status.Code(err) != codes.Unimplemented {
		t.Errorf("GrantAccess no-sharing: code = %v want Unimplemented", status.Code(err))
	}

	if _, err := svc.RevokeAccess(ctx, &grownv1.RevokeDeckAccessRequest{
		DeckId: "d", GranteeUserId: "g",
	}); status.Code(err) != codes.Unimplemented {
		t.Errorf("RevokeAccess no-sharing: code = %v want Unimplemented", status.Code(err))
	}

	// ListGrants returns an empty list (no error) when sharing is disabled.
	gl, err := svc.ListGrants(ctx, &grownv1.ListDeckGrantsRequest{DeckId: "d"})
	if err != nil {
		t.Errorf("ListGrants no-sharing: unexpected err %v", err)
	}
	if len(gl.GetGrants()) != 0 {
		t.Errorf("ListGrants no-sharing: got %d grants want 0", len(gl.GetGrants()))
	}

	// ListSharedWithMe returns empty (no error) when sharing is disabled.
	swm, err := svc.ListSharedWithMe(ctx, &grownv1.ListDecksSharedWithMeRequest{})
	if err != nil {
		t.Errorf("ListSharedWithMe no-sharing: unexpected err %v", err)
	}
	if len(swm.GetDecks()) != 0 {
		t.Errorf("ListSharedWithMe no-sharing: got %d decks want 0", len(swm.GetDecks()))
	}
}

// TestGrantAccess_Validation covers the InvalidArgument short-circuits. Sharing
// must be enabled to reach them (the nil-grants guard runs first), but the
// validation runs BEFORE the deck repo lookup, so a nil-pool repo is fine.
func TestGrantAccess_Validation(t *testing.T) {
	// Wire a sharing repo (also over a nil pool) just to pass the s.grants==nil
	// guard; validation returns before either repo is queried.
	svc := NewService(NewRepository(nil)).WithSharing(sharing.NewRepository(nil))
	ctx := fullCtx()

	cases := []struct {
		name string
		req  *grownv1.GrantDeckAccessRequest
		want codes.Code
	}{
		{
			name: "invalid role",
			req:  &grownv1.GrantDeckAccessRequest{DeckId: "d", GranteeUserId: "g", Role: "superuser"},
			want: codes.InvalidArgument,
		},
		{
			name: "empty role",
			req:  &grownv1.GrantDeckAccessRequest{DeckId: "d", GranteeUserId: "g", Role: ""},
			want: codes.InvalidArgument,
		},
		{
			name: "missing grantee",
			req:  &grownv1.GrantDeckAccessRequest{DeckId: "d", GranteeUserId: "", Role: sharing.RoleViewer},
			want: codes.InvalidArgument,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.GrantAccess(ctx, tc.req)
			if got := status.Code(err); got != tc.want {
				t.Errorf("GrantAccess(%s): code = %v want %v", tc.name, got, tc.want)
			}
		})
	}
}

// mustErr extracts the error from a (T, error) pair where the value is ignored.
func mustErr[T any](_ T, err error) error { return err }
