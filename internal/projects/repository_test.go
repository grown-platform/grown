package projects

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so project rows satisfy their foreign keys. Skips unless
// GROWN_TEST_DSN points at a throwaway Postgres.
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
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-1','tester@grown.localtest.me','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func TestRepository_TeamAndIssueNumbering(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	team, err := repo.CreateTeam(ctx, orgID, "Engineering", "ENG", "", "")
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}
	if team.Key != "ENG" {
		t.Fatalf("key: got %q", team.Key)
	}

	// Sequential issues get incrementing per-team identifiers ENG-1, ENG-2.
	i1, err := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "first"})
	if err != nil {
		t.Fatalf("CreateIssue 1: %v", err)
	}
	i2, err := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "second"})
	if err != nil {
		t.Fatalf("CreateIssue 2: %v", err)
	}
	if i1.Identifier() != "ENG-1" || i2.Identifier() != "ENG-2" {
		t.Fatalf("identifiers: got %q, %q want ENG-1, ENG-2", i1.Identifier(), i2.Identifier())
	}
	if i1.Status != "backlog" {
		t.Errorf("default status: got %q want backlog", i1.Status)
	}
}

func TestRepository_UpdateIssuePartialPatch(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	team, _ := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	iss, _ := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "t", Priority: 1})

	// Patch only status; priority must be untouched.
	got, err := repo.UpdateIssue(ctx, orgID, iss.ID, IssuePatch{Status: "in_progress", StatusSet: true})
	if err != nil {
		t.Fatalf("UpdateIssue: %v", err)
	}
	if got.Status != "in_progress" {
		t.Errorf("status: got %q want in_progress", got.Status)
	}
	if got.Priority != 1 {
		t.Errorf("priority changed unexpectedly: got %d want 1", got.Priority)
	}
}

func TestRepository_ListIssuesFilterAndDelete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	team, _ := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	a, _ := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "a", Status: "todo"})
	_, _ = repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "b", Status: "done"})

	todo, err := repo.ListIssues(ctx, orgID, IssueFilter{Status: "todo"})
	if err != nil {
		t.Fatalf("ListIssues: %v", err)
	}
	if len(todo) != 1 || todo[0].ID != a.ID {
		t.Fatalf("status filter: got %d issues", len(todo))
	}

	if err := repo.DeleteIssue(ctx, orgID, a.ID); err != nil {
		t.Fatalf("DeleteIssue: %v", err)
	}
	if _, err := repo.GetIssue(ctx, orgID, a.ID); err != ErrNotFound {
		t.Fatalf("after delete: got %v want ErrNotFound", err)
	}
	all, _ := repo.ListIssues(ctx, orgID, IssueFilter{})
	if len(all) != 1 {
		t.Fatalf("after soft-delete: got %d remaining want 1", len(all))
	}
}

func TestRepository_ProjectsLabelsComments(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	p, err := repo.CreateProject(ctx, orgID, ProjectFields{Name: "Launch"})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if got, _ := repo.ListProjects(ctx, orgID); len(got) != 1 || got[0].State != "backlog" {
		t.Fatalf("ListProjects: got %d, state default wrong", len(got))
	}

	l, err := repo.CreateLabel(ctx, orgID, "bug", "")
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}
	if got, _ := repo.ListLabels(ctx, orgID); len(got) != 1 {
		t.Fatalf("ListLabels: got %d", len(got))
	}

	team, _ := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	iss, _ := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "x", ProjectID: p.ID, LabelIDs: []string{l.ID}})
	c, err := repo.CreateComment(ctx, orgID, iss.ID, userID, "Tester", "hello")
	if err != nil {
		t.Fatalf("CreateComment: %v", err)
	}
	cs, _ := repo.ListComments(ctx, orgID, iss.ID)
	if len(cs) != 1 || cs[0].ID != c.ID || cs[0].Body != "hello" {
		t.Fatalf("ListComments: got %+v", cs)
	}
}

func TestRepository_SubIssues(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	team, _ := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")

	// Create a parent issue.
	parent, err := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "parent"})
	if err != nil {
		t.Fatalf("CreateIssue parent: %v", err)
	}

	// Create two sub-issues under the parent.
	c1, err := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "child1", Status: "todo", ParentIssueID: parent.ID})
	if err != nil {
		t.Fatalf("CreateIssue child1: %v", err)
	}
	c2, err := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "child2", Status: "done", ParentIssueID: parent.ID})
	if err != nil {
		t.Fatalf("CreateIssue child2: %v", err)
	}

	// ParentIssueID should be set on the sub-issues.
	if c1.ParentIssueID != parent.ID {
		t.Errorf("c1.ParentIssueID: got %q want %q", c1.ParentIssueID, parent.ID)
	}
	if c2.ParentIssueID != parent.ID {
		t.Errorf("c2.ParentIssueID: got %q want %q", c2.ParentIssueID, parent.ID)
	}

	// Parent should report sub-issue counts (total=2, done=1).
	p2, err := repo.GetIssue(ctx, orgID, parent.ID)
	if err != nil {
		t.Fatalf("GetIssue parent: %v", err)
	}
	if p2.SubIssueCount != 2 {
		t.Errorf("SubIssueCount: got %d want 2", p2.SubIssueCount)
	}
	if p2.SubIssueDone != 1 {
		t.Errorf("SubIssueDone: got %d want 1", p2.SubIssueDone)
	}

	// ListIssues with parent filter returns only the two children.
	children, err := repo.ListIssues(ctx, orgID, IssueFilter{ParentIssueID: parent.ID})
	if err != nil {
		t.Fatalf("ListIssues by parent: %v", err)
	}
	if len(children) != 2 {
		t.Fatalf("children count: got %d want 2", len(children))
	}

	// ListIssues with "none" returns only top-level issues (parent has no parent).
	topLevel, err := repo.ListIssues(ctx, orgID, IssueFilter{ParentIssueID: "none"})
	if err != nil {
		t.Fatalf("ListIssues top-level: %v", err)
	}
	for _, i := range topLevel {
		if i.ParentIssueID != "" {
			t.Errorf("top-level filter returned issue with parent %q", i.ParentIssueID)
		}
	}
	found := false
	for _, i := range topLevel {
		if i.ID == parent.ID {
			found = true
		}
	}
	if !found {
		t.Error("top-level filter did not include the parent issue")
	}

	// Trashing the parent sets children's parent_issue_id to NULL (via ON DELETE SET NULL).
	// We use hard-delete behaviour as a proxy: soft-delete with trashed_at, then verify
	// the DB FK fires when we actually DELETE the row.
	_, err = pool.Exec(ctx, `DELETE FROM grown.project_issues WHERE id=$1`, parent.ID)
	if err != nil {
		t.Fatalf("hard-delete parent: %v", err)
	}
	// Re-fetch children — their parent_issue_id should now be NULL.
	rc1, err := repo.GetIssue(ctx, orgID, c1.ID)
	if err != nil {
		t.Fatalf("GetIssue c1 after parent delete: %v", err)
	}
	if rc1.ParentIssueID != "" {
		t.Errorf("c1.ParentIssueID after parent delete: got %q want empty", rc1.ParentIssueID)
	}
}

func TestRepository_OrgIsolation(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	// A second org must not see the first org's team.
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", ""); err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}
	if got, _ := repo.ListTeams(ctx, otherOrg); len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d teams", len(got))
	}
}

func TestRepository_UpdateDeleteTeam(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	team, err := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}

	// UpdateTeam changes the name.
	updated, err := repo.UpdateTeam(ctx, orgID, team.ID, "Engineering", "#ff0000", "")
	if err != nil {
		t.Fatalf("UpdateTeam: %v", err)
	}
	if updated.Name != "Engineering" || updated.Color != "#ff0000" {
		t.Fatalf("UpdateTeam: got name=%q color=%q", updated.Name, updated.Color)
	}

	// DeleteTeam removes the team.
	if err := repo.DeleteTeam(ctx, orgID, team.ID); err != nil {
		t.Fatalf("DeleteTeam: %v", err)
	}
	if _, err := repo.GetTeam(ctx, orgID, team.ID); err != ErrNotFound {
		t.Fatalf("GetTeam after delete: got %v want ErrNotFound", err)
	}
}

func TestRepository_TeamMembers(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	team, err := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}

	// Add the seeded user to the team.
	if err := repo.AddTeamMember(ctx, orgID, team.ID, userID); err != nil {
		t.Fatalf("AddTeamMember: %v", err)
	}

	members, err := repo.ListTeamMembers(ctx, orgID, team.ID)
	if err != nil {
		t.Fatalf("ListTeamMembers: %v", err)
	}
	if len(members) != 1 || members[0].ID != userID {
		t.Fatalf("ListTeamMembers: got %+v", members)
	}

	// Adding again (idempotent) must not fail.
	if err := repo.AddTeamMember(ctx, orgID, team.ID, userID); err != nil {
		t.Fatalf("AddTeamMember idempotent: %v", err)
	}

	// Remove member.
	if err := repo.RemoveTeamMember(ctx, orgID, team.ID, userID); err != nil {
		t.Fatalf("RemoveTeamMember: %v", err)
	}
	after, _ := repo.ListTeamMembers(ctx, orgID, team.ID)
	if len(after) != 0 {
		t.Fatalf("after remove: expected 0 members, got %d", len(after))
	}
}

func TestRepository_AddTeamMember_RejectsNonOrgUser(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	team, err := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}

	// Seed a user in a different org.
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other2','Other2') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	var outsider string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-2','outsider@other.me','Outsider') RETURNING id::text`,
		otherOrg).Scan(&outsider); err != nil {
		t.Fatalf("seed outsider: %v", err)
	}

	// Adding an outsider must return ErrNotOrgMember.
	if err := repo.AddTeamMember(ctx, orgID, team.ID, outsider); err != ErrNotOrgMember {
		t.Fatalf("expected ErrNotOrgMember, got %v", err)
	}
}

func TestGitLinkUpsertAndList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Resolve the slug→ID path (the default org has slug "default").
	resolvedID, err := repo.OrgIDBySlug(ctx, "default")
	if err != nil {
		t.Fatalf("OrgIDBySlug: %v", err)
	}
	if resolvedID != orgID {
		t.Fatalf("OrgIDBySlug: got %q want %q", resolvedID, orgID)
	}

	// ErrNotFound for unknown slug.
	if _, err := repo.OrgIDBySlug(ctx, "no-such-org"); err != ErrNotFound {
		t.Fatalf("OrgIDBySlug unknown: got %v want ErrNotFound", err)
	}

	// Seed a team + issue.
	team, err := repo.CreateTeam(ctx, orgID, "GitTest", "GT", "", "")
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}
	iss, err := repo.CreateIssue(ctx, orgID, team.ID, userID, IssueFields{Title: "link test"})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}

	// FindIssueByKeyNumber round-trips GT-1.
	found, err := repo.FindIssueByKeyNumber(ctx, orgID, "GT", 1)
	if err != nil {
		t.Fatalf("FindIssueByKeyNumber: %v", err)
	}
	if found.ID != iss.ID {
		t.Fatalf("FindIssueByKeyNumber: got id %q want %q", found.ID, iss.ID)
	}

	// Case-insensitive key lookup.
	found2, err := repo.FindIssueByKeyNumber(ctx, orgID, "gt", 1)
	if err != nil {
		t.Fatalf("FindIssueByKeyNumber lowercase key: %v", err)
	}
	if found2.ID != iss.ID {
		t.Fatalf("FindIssueByKeyNumber lowercase: got %q want %q", found2.ID, iss.ID)
	}

	// ErrNotFound for wrong number.
	if _, err := repo.FindIssueByKeyNumber(ctx, orgID, "GT", 999); err != ErrNotFound {
		t.Fatalf("FindIssueByKeyNumber missing: got %v want ErrNotFound", err)
	}

	// First upsert: state="open", IsMagic=false.
	link1 := GitLink{
		OrgID:   orgID,
		IssueID: iss.ID,
		Kind:    "branch",
		Repo:    "myorg/myrepo",
		Ref:     "feat/GT-1-link-test",
		URL:     "https://git.example.com/myorg/myrepo/src/branch/feat/GT-1-link-test",
		Title:   "feat/GT-1-link-test",
		State:   "open",
		IsMagic: false,
	}
	if err := repo.UpsertGitLink(ctx, link1); err != nil {
		t.Fatalf("UpsertGitLink first: %v", err)
	}

	// Second upsert: state="merged", IsMagic=true — should update in place.
	link2 := link1
	link2.State = "merged"
	link2.IsMagic = true
	if err := repo.UpsertGitLink(ctx, link2); err != nil {
		t.Fatalf("UpsertGitLink second: %v", err)
	}

	// ListGitLinks must return exactly 1 row with the updated values.
	links, err := repo.ListGitLinks(ctx, orgID, iss.ID)
	if err != nil {
		t.Fatalf("ListGitLinks: %v", err)
	}
	if len(links) != 1 {
		t.Fatalf("ListGitLinks: got %d rows want 1", len(links))
	}
	got := links[0]
	if got.State != "merged" {
		t.Errorf("State: got %q want merged", got.State)
	}
	if !got.IsMagic {
		t.Errorf("IsMagic: got false want true")
	}
	if got.Kind != "branch" {
		t.Errorf("Kind: got %q want branch", got.Kind)
	}
	if got.IssueID != iss.ID {
		t.Errorf("IssueID: got %q want %q", got.IssueID, iss.ID)
	}
}

func TestRepository_ListAssignable(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	team, err := repo.CreateTeam(ctx, orgID, "Eng", "ENG", "", "")
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}

	// Seed a second org user.
	var user2 string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-3','user2@org.me','User Two') RETURNING id::text`,
		orgID).Scan(&user2); err != nil {
		t.Fatalf("seed user2: %v", err)
	}

	// Without team members, ListAssignable returns all org members (2).
	all, err := repo.ListAssignable(ctx, orgID, team.ID)
	if err != nil {
		t.Fatalf("ListAssignable (no team members): %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 org members, got %d", len(all))
	}

	// Add only user1 to the team. ListAssignable(team) must return only user1.
	if err := repo.AddTeamMember(ctx, orgID, team.ID, userID); err != nil {
		t.Fatalf("AddTeamMember: %v", err)
	}
	scoped, err := repo.ListAssignable(ctx, orgID, team.ID)
	if err != nil {
		t.Fatalf("ListAssignable (with team member): %v", err)
	}
	if len(scoped) != 1 || scoped[0].ID != userID {
		t.Fatalf("ListAssignable scoped: got %+v", scoped)
	}

	// Without team_id, ListAssignable returns all org members.
	orgScoped, err := repo.ListAssignable(ctx, orgID, "")
	if err != nil {
		t.Fatalf("ListAssignable (org scope): %v", err)
	}
	if len(orgScoped) != 2 {
		t.Fatalf("ListAssignable org-wide: got %d want 2", len(orgScoped))
	}
}
