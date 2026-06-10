package projects

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

func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, Email: "tester@test.me", DisplayName: "Tester"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestService_RequiresAuth(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	// No user/org in context → Unauthenticated.
	_, err := svc.ListTeams(context.Background(), &grownv1.ListTeamsRequest{})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("ListTeams without session: got %v want Unauthenticated", err)
	}
}

func TestService_CreateIssueValidation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID)

	// Missing team_id is rejected.
	if _, err := svc.CreateIssue(ctx, &grownv1.CreateIssueRequest{Title: "x"}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("CreateIssue without team_id: got %v want InvalidArgument", err)
	}

	team, err := svc.CreateTeam(ctx, &grownv1.CreateTeamRequest{Name: "Eng", Key: "ENG"})
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}
	iss, err := svc.CreateIssue(ctx, &grownv1.CreateIssueRequest{TeamId: team.Id, Title: "ship it", Priority: 2})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if iss.Identifier != "ENG-1" || iss.Priority != 2 {
		t.Fatalf("issue: got identifier=%q priority=%d", iss.Identifier, iss.Priority)
	}
}

func TestService_ListMembersIncludesCaller(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID)

	resp, err := svc.ListMembers(ctx, &grownv1.ListMembersRequest{})
	if err != nil {
		t.Fatalf("ListMembers: %v", err)
	}
	found := false
	for _, m := range resp.Members {
		if m.Id == userID {
			found = true
		}
	}
	if !found {
		t.Fatalf("ListMembers did not include the seeded caller %q", userID)
	}
}

func TestService_UpdateIssueStatusRoundTrip(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID)
	team, _ := svc.CreateTeam(ctx, &grownv1.CreateTeamRequest{Name: "Eng", Key: "ENG"})
	iss, _ := svc.CreateIssue(ctx, &grownv1.CreateIssueRequest{TeamId: team.Id, Title: "t"})

	got, err := svc.UpdateIssue(ctx, &grownv1.UpdateIssueRequest{Id: iss.Id, Status: "done", StatusSet: true})
	if err != nil {
		t.Fatalf("UpdateIssue: %v", err)
	}
	if got.Status != "done" {
		t.Fatalf("status: got %q want done", got.Status)
	}
}

func TestService_SubIssues(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID)

	team, _ := svc.CreateTeam(ctx, &grownv1.CreateTeamRequest{Name: "Eng", Key: "ENG"})

	// Create parent issue.
	parent, err := svc.CreateIssue(ctx, &grownv1.CreateIssueRequest{TeamId: team.Id, Title: "parent"})
	if err != nil {
		t.Fatalf("CreateIssue parent: %v", err)
	}

	// Create sub-issues — one pending, one done.
	child1, err := svc.CreateIssue(ctx, &grownv1.CreateIssueRequest{TeamId: team.Id, Title: "child1", ParentIssueId: parent.Id})
	if err != nil {
		t.Fatalf("CreateIssue child1: %v", err)
	}
	child2, err := svc.CreateIssue(ctx, &grownv1.CreateIssueRequest{TeamId: team.Id, Title: "child2", ParentIssueId: parent.Id, Status: "done"})
	if err != nil {
		t.Fatalf("CreateIssue child2: %v", err)
	}

	// child1 should carry parent_issue_id.
	if child1.ParentIssueId != parent.Id {
		t.Errorf("child1.parent_issue_id: got %q want %q", child1.ParentIssueId, parent.Id)
	}
	if child2.ParentIssueId != parent.Id {
		t.Errorf("child2.parent_issue_id: got %q want %q", child2.ParentIssueId, parent.Id)
	}

	// GetIssue on parent should show sub_issue_count=2 and sub_issue_done_count=1.
	p2, err := svc.GetIssue(ctx, &grownv1.GetIssueRequest{Id: parent.Id})
	if err != nil {
		t.Fatalf("GetIssue parent: %v", err)
	}
	if p2.SubIssueCount != 2 {
		t.Errorf("sub_issue_count: got %d want 2", p2.SubIssueCount)
	}
	if p2.SubIssueDoneCount != 1 {
		t.Errorf("sub_issue_done_count: got %d want 1", p2.SubIssueDoneCount)
	}

	// ListIssues filtered by parent_issue_id returns only the two children.
	lr, err := svc.ListIssues(ctx, &grownv1.ListIssuesRequest{ParentIssueId: parent.Id})
	if err != nil {
		t.Fatalf("ListIssues by parent: %v", err)
	}
	if len(lr.Issues) != 2 {
		t.Fatalf("children count: got %d want 2", len(lr.Issues))
	}

	// UpdateIssue can reparent a child (clearing parent).
	updated, err := svc.UpdateIssue(ctx, &grownv1.UpdateIssueRequest{Id: child1.Id, ParentIssueId: "", ParentSet: true})
	if err != nil {
		t.Fatalf("UpdateIssue reparent: %v", err)
	}
	if updated.ParentIssueId != "" {
		t.Errorf("after clear parent: got %q want empty", updated.ParentIssueId)
	}
	// parent should now only have 1 child.
	p3, _ := svc.GetIssue(ctx, &grownv1.GetIssueRequest{Id: parent.Id})
	if p3.SubIssueCount != 1 {
		t.Errorf("sub_issue_count after reparent: got %d want 1", p3.SubIssueCount)
	}

	_ = pool // satisfy import
}
