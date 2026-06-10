package docs

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// authCtx returns a context carrying the seeded user + org, as the auth
// middleware would attach in a real request.
func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, DisplayName: "Tester", Email: "tester@grown.localtest.me"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestService_CreateListGetRenameTrash(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	created, err := svc.CreateDoc(ctx, &grownv1.CreateDocRequest{Title: "Hello"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}
	if created.GetId() == "" || created.GetTitle() != "Hello" {
		t.Fatalf("unexpected created doc: %+v", created)
	}
	if created.GetCreatedAt() == "" {
		t.Errorf("expected RFC3339 created_at, got empty")
	}

	list, err := svc.ListDocs(ctx, &grownv1.ListDocsRequest{})
	if err != nil {
		t.Fatalf("ListDocs: %v", err)
	}
	if len(list.GetDocs()) != 1 {
		t.Fatalf("ListDocs len: got %d want 1", len(list.GetDocs()))
	}

	got, err := svc.GetDoc(ctx, &grownv1.GetDocRequest{Id: created.GetId()})
	if err != nil {
		t.Fatalf("GetDoc: %v", err)
	}
	if got.GetTitle() != "Hello" {
		t.Errorf("GetDoc title: got %q", got.GetTitle())
	}

	renamed, err := svc.RenameDoc(ctx, &grownv1.RenameDocRequest{Id: created.GetId(), Title: "World"})
	if err != nil {
		t.Fatalf("RenameDoc: %v", err)
	}
	if renamed.GetTitle() != "World" {
		t.Errorf("RenameDoc title: got %q", renamed.GetTitle())
	}

	if _, err := svc.TrashDoc(ctx, &grownv1.TrashDocRequest{Id: created.GetId()}); err != nil {
		t.Fatalf("TrashDoc: %v", err)
	}
	_, err = svc.GetDoc(ctx, &grownv1.GetDocRequest{Id: created.GetId()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("GetDoc after trash: got code %v want NotFound", status.Code(err))
	}
}

func TestService_Unauthenticated(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool))

	_, err := svc.ListDocs(context.Background(), &grownv1.ListDocsRequest{})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("ListDocs without session: got code %v want Unauthenticated", status.Code(err))
	}
}

func TestService_Sharing(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	doc, err := svc.CreateDoc(ctx, &grownv1.CreateDocRequest{Title: "Shared"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}

	// Create a viewer share.
	share, err := svc.CreateShare(ctx, &grownv1.CreateDocShareRequest{DocId: doc.GetId(), Role: "viewer"})
	if err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if share.GetToken() == "" || share.GetRole() != "viewer" {
		t.Fatalf("unexpected share: %+v", share)
	}

	// Bad role rejected.
	if _, err := svc.CreateShare(ctx, &grownv1.CreateDocShareRequest{DocId: doc.GetId(), Role: "owner"}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("bad role: got %v want InvalidArgument", status.Code(err))
	}

	// List shows it.
	list, err := svc.ListShares(ctx, &grownv1.ListDocSharesRequest{DocId: doc.GetId()})
	if err != nil || len(list.GetShares()) != 1 {
		t.Fatalf("ListShares: %v, %d", err, len(list.GetShares()))
	}

	// GetShare resolves publicly (no auth context).
	info, err := svc.GetShare(context.Background(), &grownv1.GetDocShareRequest{Token: share.GetToken()})
	if err != nil {
		t.Fatalf("GetShare: %v", err)
	}
	if info.GetDocId() != doc.GetId() || info.GetRole() != "viewer" || info.GetTitle() != "Shared" {
		t.Errorf("unexpected share info: %+v", info)
	}

	// Revoke, then it no longer resolves and is gone from the list.
	if _, err := svc.RevokeShare(ctx, &grownv1.RevokeDocShareRequest{Token: share.GetToken()}); err != nil {
		t.Fatalf("RevokeShare: %v", err)
	}
	if _, err := svc.GetShare(context.Background(), &grownv1.GetDocShareRequest{Token: share.GetToken()}); status.Code(err) != codes.NotFound {
		t.Errorf("GetShare after revoke: got %v want NotFound", status.Code(err))
	}
	list2, _ := svc.ListShares(ctx, &grownv1.ListDocSharesRequest{DocId: doc.GetId()})
	if len(list2.GetShares()) != 0 {
		t.Errorf("ListShares after revoke: got %d want 0", len(list2.GetShares()))
	}
}

func TestService_VersionHistory(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	doc, err := svc.CreateDoc(ctx, &grownv1.CreateDocRequest{Title: "Versioned"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}

	v, err := svc.SnapshotNow(ctx, &grownv1.SnapshotNowRequest{
		DocId: doc.GetId(), ContentHtml: "<p>v1</p>", Label: "Initial",
	})
	if err != nil {
		t.Fatalf("SnapshotNow: %v", err)
	}
	if v.GetLabel() != "Initial" || v.GetAuthorName() == "" {
		t.Errorf("unexpected version: %+v", v)
	}

	list, err := svc.ListVersions(ctx, &grownv1.ListVersionsRequest{DocId: doc.GetId()})
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(list.GetVersions()) != 1 {
		t.Fatalf("ListVersions len: got %d want 1", len(list.GetVersions()))
	}
	// List omits content_html.
	if list.GetVersions()[0].GetContentHtml() != "" {
		t.Error("list should omit content_html")
	}

	full, err := svc.GetVersion(ctx, &grownv1.GetVersionRequest{DocId: doc.GetId(), VersionId: v.GetId()})
	if err != nil {
		t.Fatalf("GetVersion: %v", err)
	}
	if full.GetContentHtml() != "<p>v1</p>" {
		t.Errorf("GetVersion content: got %q", full.GetContentHtml())
	}

	// Restore records a new auditable version carrying the source content.
	restored, err := svc.RestoreVersion(ctx, &grownv1.RestoreVersionRequest{DocId: doc.GetId(), VersionId: v.GetId()})
	if err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}
	if restored.GetContentHtml() != "<p>v1</p>" {
		t.Errorf("restored content: got %q", restored.GetContentHtml())
	}
	list2, _ := svc.ListVersions(ctx, &grownv1.ListVersionsRequest{DocId: doc.GetId()})
	if len(list2.GetVersions()) != 2 {
		t.Errorf("after restore: got %d versions want 2", len(list2.GetVersions()))
	}

	// Snapshot against an unknown doc is NotFound.
	if _, err := svc.SnapshotNow(ctx, &grownv1.SnapshotNowRequest{
		DocId: "00000000-0000-0000-0000-000000000000", ContentHtml: "x",
	}); status.Code(err) != codes.NotFound {
		t.Errorf("snapshot unknown doc: got %v want NotFound", status.Code(err))
	}
}

func TestService_Comments(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	doc, err := svc.CreateDoc(ctx, &grownv1.CreateDocRequest{Title: "Commented"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}

	c, err := svc.AddComment(ctx, &grownv1.AddCommentRequest{
		DocId: doc.GetId(), Body: "Fix this", Quote: "typo", AnchorFrom: 3, AnchorTo: 8,
	})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if c.GetBody() != "Fix this" || c.GetResolved() || c.GetAuthorName() == "" {
		t.Errorf("unexpected comment: %+v", c)
	}

	// Empty body rejected.
	if _, err := svc.AddComment(ctx, &grownv1.AddCommentRequest{DocId: doc.GetId(), Body: ""}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("empty body: got %v want InvalidArgument", status.Code(err))
	}

	list, err := svc.ListComments(ctx, &grownv1.ListCommentsRequest{DocId: doc.GetId()})
	if err != nil || len(list.GetComments()) != 1 {
		t.Fatalf("ListComments: %v, %d", err, len(list.GetComments()))
	}

	resolved, err := svc.ResolveComment(ctx, &grownv1.ResolveCommentRequest{
		DocId: doc.GetId(), CommentId: c.GetId(), Resolved: true,
	})
	if err != nil {
		t.Fatalf("ResolveComment: %v", err)
	}
	if !resolved.GetResolved() || resolved.GetResolvedAt() == "" {
		t.Errorf("expected resolved: %+v", resolved)
	}

	if _, err := svc.DeleteComment(ctx, &grownv1.DeleteCommentRequest{DocId: doc.GetId(), CommentId: c.GetId()}); err != nil {
		t.Fatalf("DeleteComment: %v", err)
	}
	if _, err := svc.DeleteComment(ctx, &grownv1.DeleteCommentRequest{DocId: doc.GetId(), CommentId: c.GetId()}); status.Code(err) != codes.NotFound {
		t.Errorf("double delete: got %v want NotFound", status.Code(err))
	}
}

func TestService_CommentThreading(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	doc, err := svc.CreateDoc(ctx, &grownv1.CreateDocRequest{Title: "Threads"})
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}

	// Create a top-level comment.
	root, err := svc.AddComment(ctx, &grownv1.AddCommentRequest{
		DocId: doc.GetId(), Body: "Root comment", Quote: "selection", AnchorFrom: 1, AnchorTo: 10,
	})
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if root.GetParentCommentId() != "" {
		t.Errorf("root comment should have empty parent_comment_id, got %q", root.GetParentCommentId())
	}

	// Reply to the root comment.
	reply, err := svc.ReplyToComment(ctx, &grownv1.ReplyToCommentRequest{
		DocId: doc.GetId(), CommentId: root.GetId(), Body: "This is a reply",
	})
	if err != nil {
		t.Fatalf("ReplyToComment: %v", err)
	}
	if reply.GetParentCommentId() != root.GetId() {
		t.Errorf("reply parent: got %q want %q", reply.GetParentCommentId(), root.GetId())
	}

	// ListComments should return root with reply nested.
	list, err := svc.ListComments(ctx, &grownv1.ListCommentsRequest{DocId: doc.GetId()})
	if err != nil {
		t.Fatalf("ListComments: %v", err)
	}
	if len(list.GetComments()) != 1 {
		t.Fatalf("ListComments: expected 1 root comment, got %d", len(list.GetComments()))
	}
	if len(list.GetComments()[0].GetReplies()) != 1 {
		t.Fatalf("ListComments: expected 1 reply, got %d", len(list.GetComments()[0].GetReplies()))
	}
	if list.GetComments()[0].GetReplies()[0].GetBody() != "This is a reply" {
		t.Errorf("reply body: got %q", list.GetComments()[0].GetReplies()[0].GetBody())
	}

	// Empty body rejected for replies.
	if _, err := svc.ReplyToComment(ctx, &grownv1.ReplyToCommentRequest{
		DocId: doc.GetId(), CommentId: root.GetId(), Body: "",
	}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("empty reply body: got %v want InvalidArgument", status.Code(err))
	}

	// Replying to a non-existent comment is NotFound.
	if _, err := svc.ReplyToComment(ctx, &grownv1.ReplyToCommentRequest{
		DocId: doc.GetId(), CommentId: "00000000-0000-0000-0000-000000000000", Body: "x",
	}); status.Code(err) != codes.NotFound {
		t.Errorf("reply unknown parent: got %v want NotFound", status.Code(err))
	}

	// Resolve the root thread.
	resolved, err := svc.ResolveComment(ctx, &grownv1.ResolveCommentRequest{
		DocId: doc.GetId(), CommentId: root.GetId(), Resolved: true,
	})
	if err != nil {
		t.Fatalf("ResolveComment: %v", err)
	}
	if !resolved.GetResolved() || resolved.GetResolvedAt() == "" {
		t.Errorf("expected resolved, got %+v", resolved)
	}

	// Reopen the thread.
	reopened, err := svc.ReopenComment(ctx, &grownv1.ReopenCommentRequest{
		DocId: doc.GetId(), CommentId: root.GetId(),
	})
	if err != nil {
		t.Fatalf("ReopenComment: %v", err)
	}
	if reopened.GetResolved() {
		t.Errorf("expected reopened (not resolved)")
	}

	// ReopenComment on unknown comment is NotFound.
	if _, err := svc.ReopenComment(ctx, &grownv1.ReopenCommentRequest{
		DocId: doc.GetId(), CommentId: "00000000-0000-0000-0000-000000000000",
	}); status.Code(err) != codes.NotFound {
		t.Errorf("reopen unknown: got %v want NotFound", status.Code(err))
	}
}

func TestService_GetDoc_NotFound(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))

	_, err := svc.GetDoc(authCtx(orgID, userID),
		&grownv1.GetDocRequest{Id: "00000000-0000-0000-0000-000000000000"})
	if status.Code(err) != codes.NotFound {
		t.Errorf("got code %v want NotFound", status.Code(err))
	}
}
