package slides

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/jackc/pgx/v5/pgxpool"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/users"
)

// authCtx returns a context carrying the seeded user + org, as the auth
// middleware would attach in a real request.
func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, DisplayName: "Tester", Email: "tester@grown.localtest.me"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

// makeOrgUser creates an org with the given slug plus a user in it, returning
// (orgID, userID). Used to model a cross-org grantee (e.g. a personal org).
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

// userCtx returns a context for a user in their own org.
func userCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "other"})
}

// TestCrossOrgGrantAccess proves the security-critical ACL path for Slides:
//   - a non-org-member CANNOT read a deck without a grant (NotFound),
//   - a grantee in a DIFFERENT org CAN read it once granted,
//   - the existence of the deck is not leaked to non-grantees, and
//   - grants list/revoke behave.
func TestCrossOrgGrantAccess(t *testing.T) {
	pool, orgA, alice := setupDB(t) // alice owns a deck in org A (default)
	grants := sharing.NewRepository(pool)
	svc := NewService(NewRepository(pool)).WithSharing(grants)

	// Bob lives in a separate personal org B — no org overlap with alice.
	bobOrg, bob := makeOrgUser(t, pool, "personal-bob", "subject-bob", "bob@test")

	aliceCtx := authCtx(orgA, alice)
	bobCtx := userCtx(bobOrg, bob)

	deck, err := svc.CreateDeck(aliceCtx, &grownv1.CreateDeckRequest{Title: "Secret"})
	if err != nil {
		t.Fatalf("CreateDeck: %v", err)
	}

	// 1. Before any grant, bob (different org) is denied with NotFound — the deck
	//    must NOT leak to a non-grantee.
	if _, err := svc.GetDeck(bobCtx, &grownv1.GetDeckRequest{Id: deck.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetDeck non-grantee: got %v want NotFound", status.Code(err))
	}

	// 2. Alice grants bob viewer.
	if _, err := svc.GrantAccess(aliceCtx, &grownv1.GrantDeckAccessRequest{
		DeckId: deck.GetId(), GranteeUserId: bob, Role: sharing.RoleViewer,
	}); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}

	// 3. Now bob can read it (cross-org).
	got, err := svc.GetDeck(bobCtx, &grownv1.GetDeckRequest{Id: deck.GetId()})
	if err != nil {
		t.Fatalf("GetDeck grantee: %v", err)
	}
	if got.GetTitle() != "Secret" {
		t.Fatalf("GetDeck grantee title = %q", got.GetTitle())
	}

	// 4. Bob's "Shared with me" includes the deck; alice's does not (own org).
	swm, err := svc.ListSharedWithMe(bobCtx, &grownv1.ListDecksSharedWithMeRequest{})
	if err != nil {
		t.Fatalf("ListSharedWithMe bob: %v", err)
	}
	if len(swm.GetDecks()) != 1 || swm.GetDecks()[0].GetId() != deck.GetId() {
		t.Fatalf("bob shared-with-me = %+v; want the one deck", swm.GetDecks())
	}
	if aswm, _ := svc.ListSharedWithMe(aliceCtx, &grownv1.ListDecksSharedWithMeRequest{}); len(aswm.GetDecks()) != 0 {
		t.Fatalf("alice shared-with-me = %+v; want empty (own org)", aswm.GetDecks())
	}

	// 5. Bob (a mere grantee, not an org member) cannot manage grants or trash.
	if _, err := svc.GrantAccess(bobCtx, &grownv1.GrantDeckAccessRequest{
		DeckId: deck.GetId(), GranteeUserId: alice, Role: sharing.RoleViewer,
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob GrantAccess: got %v want NotFound", status.Code(err))
	}
	if _, err := svc.TrashDeck(bobCtx, &grownv1.TrashDeckRequest{Id: deck.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob TrashDeck: got %v want NotFound", status.Code(err))
	}
	// A viewer grantee cannot write via the org-scoped SaveDeck either.
	if _, err := svc.SaveDeck(bobCtx, &grownv1.SaveDeckRequest{Id: deck.GetId(), Data: "{}"}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob SaveDeck: got %v want NotFound", status.Code(err))
	}

	// 6. Alice lists grants and sees bob.
	gl, err := svc.ListGrants(aliceCtx, &grownv1.ListDeckGrantsRequest{DeckId: deck.GetId()})
	if err != nil || len(gl.GetGrants()) != 1 || gl.GetGrants()[0].GetGranteeUserId() != bob {
		t.Fatalf("ListGrants = %+v, %v; want [bob]", gl.GetGrants(), err)
	}

	// 7. Revoke → bob loses access (NotFound again).
	if _, err := svc.RevokeAccess(aliceCtx, &grownv1.RevokeDeckAccessRequest{
		DeckId: deck.GetId(), GranteeUserId: bob,
	}); err != nil {
		t.Fatalf("RevokeAccess: %v", err)
	}
	if _, err := svc.GetDeck(bobCtx, &grownv1.GetDeckRequest{Id: deck.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetDeck after revoke: got %v want NotFound", status.Code(err))
	}
	if swm, _ := svc.ListSharedWithMe(bobCtx, &grownv1.ListDecksSharedWithMeRequest{}); len(swm.GetDecks()) != 0 {
		t.Fatalf("bob shared-with-me after revoke = %+v; want empty", swm.GetDecks())
	}
}
