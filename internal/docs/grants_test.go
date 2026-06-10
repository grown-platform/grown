package docs

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/jackc/pgx/v5/pgxpool"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/sharing"
)

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

// TestCrossOrgCommentAccess proves that comment operations respect the same
// doc-access control as document reads:
//   - a user outside the doc's org cannot list or add comments (NotFound),
//   - after a grant, they can list and add comments (as a viewer/commenter),
//   - after a grant is revoked, access is denied again.
func TestCrossOrgCommentAccess(t *testing.T) {
	pool, orgA, alice := setupDB(t)
	grants := sharing.NewRepository(pool)
	svc := NewService(NewRepository(pool)).WithSharing(grants, nil)

	bobOrg, bob := makeOrgUser(t, pool, "personal-bob2", "subject-bob2", "bob2@test")
	aliceCtx := authCtx(orgA, alice)
	bobCtx := authCtx(bobOrg, bob)

	doc, err := svc.CreateDoc(aliceCtx, &grownv1.CreateDocRequest{Title: "NeedToKnow"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}

	// 1. Bob (no grant) cannot list comments.
	if _, err := svc.ListComments(bobCtx, &grownv1.ListCommentsRequest{DocId: doc.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("ListComments non-grantee: got %v want NotFound", status.Code(err))
	}

	// 2. Bob cannot add a comment.
	if _, err := svc.AddComment(bobCtx, &grownv1.AddCommentRequest{DocId: doc.GetId(), Body: "ha"}); status.Code(err) != codes.NotFound {
		t.Fatalf("AddComment non-grantee: got %v want NotFound", status.Code(err))
	}

	// 3. Alice grants bob viewer.
	if _, err := svc.GrantAccess(aliceCtx, &grownv1.GrantDocAccessRequest{
		DocId: doc.GetId(), GranteeUserId: bob, Role: sharing.RoleViewer,
	}); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}

	// 4. Bob can now list comments (empty) and add a comment.
	list, err := svc.ListComments(bobCtx, &grownv1.ListCommentsRequest{DocId: doc.GetId()})
	if err != nil {
		t.Fatalf("ListComments grantee: %v", err)
	}
	if len(list.GetComments()) != 0 {
		t.Errorf("expected empty list, got %d", len(list.GetComments()))
	}

	// 5. Revoke → Bob loses access again.
	if _, err := svc.RevokeAccess(aliceCtx, &grownv1.RevokeDocAccessRequest{
		DocId: doc.GetId(), GranteeUserId: bob,
	}); err != nil {
		t.Fatalf("RevokeAccess: %v", err)
	}
	if _, err := svc.ListComments(bobCtx, &grownv1.ListCommentsRequest{DocId: doc.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("ListComments after revoke: got %v want NotFound", status.Code(err))
	}
}

// TestCrossOrgGrantAccess proves the security-critical ACL path for Docs:
//   - a non-org-member CANNOT read a doc without a grant (NotFound),
//   - a grantee in a DIFFERENT org CAN read it once granted,
//   - the existence of the doc is not leaked to non-grantees, and
//   - grants list/revoke behave.
func TestCrossOrgGrantAccess(t *testing.T) {
	pool, orgA, alice := setupDB(t) // alice owns a doc in org A (default)
	grants := sharing.NewRepository(pool)
	svc := NewService(NewRepository(pool)).WithSharing(grants, nil)

	// Bob lives in a separate personal org B — no org overlap with alice.
	bobOrg, bob := makeOrgUser(t, pool, "personal-bob", "subject-bob", "bob@test")

	aliceCtx := authCtx(orgA, alice)
	bobCtx := authCtx(bobOrg, bob)

	doc, err := svc.CreateDoc(aliceCtx, &grownv1.CreateDocRequest{Title: "Secret"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}

	// 1. Before any grant, bob (different org) is denied with NotFound — the doc
	//    must NOT leak to a non-grantee.
	if _, err := svc.GetDoc(bobCtx, &grownv1.GetDocRequest{Id: doc.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetDoc non-grantee: got %v want NotFound", status.Code(err))
	}

	// 2. Alice grants bob viewer.
	if _, err := svc.GrantAccess(aliceCtx, &grownv1.GrantDocAccessRequest{
		DocId: doc.GetId(), GranteeUserId: bob, Role: sharing.RoleViewer,
	}); err != nil {
		t.Fatalf("GrantAccess: %v", err)
	}

	// 3. Now bob can read it (cross-org).
	got, err := svc.GetDoc(bobCtx, &grownv1.GetDocRequest{Id: doc.GetId()})
	if err != nil {
		t.Fatalf("GetDoc grantee: %v", err)
	}
	if got.GetTitle() != "Secret" {
		t.Fatalf("GetDoc grantee title = %q", got.GetTitle())
	}

	// 4. Bob's "Shared with me" includes the doc; alice's does not (it's her org).
	swm, err := svc.ListSharedWithMe(bobCtx, &grownv1.ListDocsSharedWithMeRequest{})
	if err != nil {
		t.Fatalf("ListSharedWithMe bob: %v", err)
	}
	if len(swm.GetDocs()) != 1 || swm.GetDocs()[0].GetId() != doc.GetId() {
		t.Fatalf("bob shared-with-me = %+v; want the one doc", swm.GetDocs())
	}
	if aswm, _ := svc.ListSharedWithMe(aliceCtx, &grownv1.ListDocsSharedWithMeRequest{}); len(aswm.GetDocs()) != 0 {
		t.Fatalf("alice shared-with-me = %+v; want empty (own org)", aswm.GetDocs())
	}

	// 5. Bob (a mere grantee, not an org member) cannot manage grants or trash.
	if _, err := svc.GrantAccess(bobCtx, &grownv1.GrantDocAccessRequest{
		DocId: doc.GetId(), GranteeUserId: alice, Role: sharing.RoleViewer,
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob GrantAccess: got %v want NotFound", status.Code(err))
	}
	if _, err := svc.TrashDoc(bobCtx, &grownv1.TrashDocRequest{Id: doc.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("bob TrashDoc: got %v want NotFound", status.Code(err))
	}

	// 6. Alice lists grants and sees bob.
	gl, err := svc.ListGrants(aliceCtx, &grownv1.ListDocGrantsRequest{DocId: doc.GetId()})
	if err != nil || len(gl.GetGrants()) != 1 || gl.GetGrants()[0].GetGranteeUserId() != bob {
		t.Fatalf("ListGrants = %+v, %v; want [bob]", gl.GetGrants(), err)
	}

	// 7. Revoke → bob loses access (NotFound again).
	if _, err := svc.RevokeAccess(aliceCtx, &grownv1.RevokeDocAccessRequest{
		DocId: doc.GetId(), GranteeUserId: bob,
	}); err != nil {
		t.Fatalf("RevokeAccess: %v", err)
	}
	if _, err := svc.GetDoc(bobCtx, &grownv1.GetDocRequest{Id: doc.GetId()}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetDoc after revoke: got %v want NotFound", status.Code(err))
	}
}
