package projects

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.ProjectsServiceServer over a Repository, with an
// optional Hub for live issue broadcasts.
type Service struct {
	repo *Repository
	hub  *Hub
	// ForgejoWebhookSecret is the shared HMAC-SHA256 secret for verifying
	// inbound Forgejo webhook signatures. Empty disables the webhook endpoint
	// (handler returns 503). Set by the server during wiring.
	ForgejoWebhookSecret string
}

// NewService constructs a Service. hub may be nil (no realtime broadcasts).
func NewService(repo *Repository, hub *Hub) *Service { return &Service{repo: repo, hub: hub} }

func callerOrg(ctx context.Context) (string, error) {
	if _, ok := auth.UserFromContext(ctx); !ok {
		return "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, nil
}

// ── Proto mappers ────────────────────────────────────────────────────────────

func teamProto(t Team) *grownv1.Team {
	return &grownv1.Team{
		Id: t.ID, OrgId: t.OrgID, Name: t.Name, Key: t.Key, Color: t.Color,
		Icon: t.Icon, IssueCount: t.IssueCount, CreatedAt: t.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func issueProto(i Issue) *grownv1.Issue {
	return &grownv1.Issue{
		Id: i.ID, OrgId: i.OrgID, TeamId: i.TeamID, Identifier: i.Identifier(), Number: i.Number,
		Title: i.Title, Description: i.Description, Status: i.Status, Priority: i.Priority,
		AssigneeId: i.AssigneeID, AssigneeName: i.AssigneeName, LabelIds: i.LabelIDs,
		ProjectId: i.ProjectID, Estimate: i.Estimate, SortOrder: i.SortOrder, CreatorId: i.CreatorID,
		CreatedAt: i.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt: i.UpdatedAt.UTC().Format(time.RFC3339),
		ParentIssueId: i.ParentIssueID, SubIssueCount: i.SubIssueCount, SubIssueDoneCount: i.SubIssueDone,
	}
}

func projectProto(p Project) *grownv1.Project {
	return &grownv1.Project{
		Id: p.ID, OrgId: p.OrgID, Name: p.Name, Description: p.Description, Color: p.Color,
		Icon: p.Icon, State: p.State, LeadId: p.LeadID, LeadName: p.LeadName, TargetDate: p.TargetDate,
		CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt: p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func labelProto(l Label) *grownv1.Label {
	return &grownv1.Label{Id: l.ID, OrgId: l.OrgID, Name: l.Name, Color: l.Color, CreatedAt: l.CreatedAt.UTC().Format(time.RFC3339)}
}

func commentProto(c Comment) *grownv1.Comment {
	return &grownv1.Comment{Id: c.ID, IssueId: c.IssueID, AuthorId: c.AuthorID, AuthorName: c.AuthorName, Body: c.Body, CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339)}
}

func gitLinkProto(l GitLink) *grownv1.GitLink {
	return &grownv1.GitLink{
		Id: l.ID, IssueId: l.IssueID, Kind: l.Kind, Repo: l.Repo, Ref: l.Ref,
		Url: l.URL, Title: l.Title, State: l.State, IsMagic: l.IsMagic,
		CreatedAt: l.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: l.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func toStatus(err error, what string) error {
	if errors.Is(err, ErrNotFound) {
		return status.Error(codes.NotFound, what+" not found")
	}
	if errors.Is(err, ErrNotOrgMember) {
		return status.Error(codes.InvalidArgument, err.Error())
	}
	return status.Errorf(codes.Internal, "%s: %v", what, err)
}

// ── Members ──────────────────────────────────────────────────────────────────

func (s *Service) ListMembers(ctx context.Context, _ *grownv1.ListMembersRequest) (*grownv1.ListMembersResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ListMembers(ctx, orgID)
	if err != nil {
		return nil, toStatus(err, "list members")
	}
	resp := &grownv1.ListMembersResponse{Members: make([]*grownv1.Member, 0, len(members))}
	for _, m := range members {
		resp.Members = append(resp.Members, &grownv1.Member{Id: m.ID, Name: m.Name, Email: m.Email})
	}
	return resp, nil
}

// ── Teams ────────────────────────────────────────────────────────────────────

func (s *Service) ListTeams(ctx context.Context, _ *grownv1.ListTeamsRequest) (*grownv1.ListTeamsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	teams, err := s.repo.ListTeams(ctx, orgID)
	if err != nil {
		return nil, toStatus(err, "list teams")
	}
	resp := &grownv1.ListTeamsResponse{Teams: make([]*grownv1.Team, 0, len(teams))}
	for _, t := range teams {
		resp.Teams = append(resp.Teams, teamProto(t))
	}
	return resp, nil
}

func (s *Service) CreateTeam(ctx context.Context, req *grownv1.CreateTeamRequest) (*grownv1.Team, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" || req.GetKey() == "" {
		return nil, status.Error(codes.InvalidArgument, "name and key are required")
	}
	t, err := s.repo.CreateTeam(ctx, orgID, req.GetName(), req.GetKey(), req.GetColor(), req.GetIcon())
	if err != nil {
		return nil, toStatus(err, "create team")
	}
	return teamProto(t), nil
}

func (s *Service) UpdateTeam(ctx context.Context, req *grownv1.UpdateTeamRequest) (*grownv1.Team, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name is required")
	}
	t, err := s.repo.UpdateTeam(ctx, orgID, req.GetId(), req.GetName(), req.GetColor(), req.GetIcon())
	if err != nil {
		return nil, toStatus(err, "update team")
	}
	return teamProto(t), nil
}

func (s *Service) DeleteTeam(ctx context.Context, req *grownv1.DeleteTeamRequest) (*grownv1.DeleteTeamResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteTeam(ctx, orgID, req.GetId()); err != nil {
		return nil, toStatus(err, "delete team")
	}
	return &grownv1.DeleteTeamResponse{}, nil
}

// ── Team members ──────────────────────────────────────────────────────────────

func (s *Service) ListTeamMembers(ctx context.Context, req *grownv1.ListTeamMembersRequest) (*grownv1.ListTeamMembersResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ListTeamMembers(ctx, orgID, req.GetTeamId())
	if err != nil {
		return nil, toStatus(err, "list team members")
	}
	resp := &grownv1.ListTeamMembersResponse{Members: make([]*grownv1.TeamMember, 0, len(members))}
	for _, m := range members {
		resp.Members = append(resp.Members, &grownv1.TeamMember{UserId: m.ID, Name: m.Name, Email: m.Email})
	}
	return resp, nil
}

func (s *Service) AddTeamMember(ctx context.Context, req *grownv1.AddTeamMemberRequest) (*grownv1.AddTeamMemberResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if err := s.repo.AddTeamMember(ctx, orgID, req.GetTeamId(), req.GetUserId()); err != nil {
		return nil, toStatus(err, "add team member")
	}
	return &grownv1.AddTeamMemberResponse{}, nil
}

func (s *Service) RemoveTeamMember(ctx context.Context, req *grownv1.RemoveTeamMemberRequest) (*grownv1.RemoveTeamMemberResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.RemoveTeamMember(ctx, orgID, req.GetTeamId(), req.GetUserId()); err != nil {
		return nil, toStatus(err, "remove team member")
	}
	return &grownv1.RemoveTeamMemberResponse{}, nil
}

// ── Assignable ────────────────────────────────────────────────────────────────

func (s *Service) ListAssignable(ctx context.Context, req *grownv1.ListAssignableRequest) (*grownv1.ListMembersResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ListAssignable(ctx, orgID, req.GetTeamId())
	if err != nil {
		return nil, toStatus(err, "list assignable")
	}
	resp := &grownv1.ListMembersResponse{Members: make([]*grownv1.Member, 0, len(members))}
	for _, m := range members {
		resp.Members = append(resp.Members, &grownv1.Member{Id: m.ID, Name: m.Name, Email: m.Email})
	}
	return resp, nil
}

// ── Issues ───────────────────────────────────────────────────────────────────

func (s *Service) ListIssues(ctx context.Context, req *grownv1.ListIssuesRequest) (*grownv1.ListIssuesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	issues, err := s.repo.ListIssues(ctx, orgID, IssueFilter{
		TeamID: req.GetTeamId(), ProjectID: req.GetProjectId(),
		AssigneeID: req.GetAssigneeId(), Status: req.GetStatus(),
		ParentIssueID: req.GetParentIssueId(),
	})
	if err != nil {
		return nil, toStatus(err, "list issues")
	}
	resp := &grownv1.ListIssuesResponse{Issues: make([]*grownv1.Issue, 0, len(issues))}
	for _, i := range issues {
		resp.Issues = append(resp.Issues, issueProto(i))
	}
	return resp, nil
}

func (s *Service) GetIssue(ctx context.Context, req *grownv1.GetIssueRequest) (*grownv1.Issue, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	i, err := s.repo.GetIssue(ctx, orgID, req.GetId())
	if err != nil {
		return nil, toStatus(err, "issue")
	}
	return issueProto(i), nil
}

func (s *Service) CreateIssue(ctx context.Context, req *grownv1.CreateIssueRequest) (*grownv1.Issue, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	if req.GetTeamId() == "" {
		return nil, status.Error(codes.InvalidArgument, "team_id is required")
	}
	i, err := s.repo.CreateIssue(ctx, o.ID, req.GetTeamId(), u.ID, IssueFields{
		Title: req.GetTitle(), Description: req.GetDescription(), Status: req.GetStatus(),
		Priority: req.GetPriority(), AssigneeID: req.GetAssigneeId(), LabelIDs: req.GetLabelIds(),
		ProjectID: req.GetProjectId(), Estimate: req.GetEstimate(),
		ParentIssueID: req.GetParentIssueId(),
	})
	if err != nil {
		return nil, toStatus(err, "create issue")
	}
	p := issueProto(i)
	s.hub.BroadcastIssue(i.TeamID, p)
	return p, nil
}

func (s *Service) UpdateIssue(ctx context.Context, req *grownv1.UpdateIssueRequest) (*grownv1.Issue, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	i, err := s.repo.UpdateIssue(ctx, orgID, req.GetId(), IssuePatch{
		Title: req.GetTitle(), TitleSet: req.GetTitleSet(),
		Description: req.GetDescription(), DescSet: req.GetDescriptionSet(),
		Status: req.GetStatus(), StatusSet: req.GetStatusSet(),
		Priority: req.GetPriority(), PrioSet: req.GetPrioritySet(),
		AssigneeID: req.GetAssigneeId(), AssigneeSet: req.GetAssigneeSet(),
		LabelIDs: req.GetLabelIds(), LabelsSet: req.GetLabelsSet(),
		ProjectID: req.GetProjectId(), ProjectSet: req.GetProjectSet(),
		Estimate: req.GetEstimate(), EstimateSet: req.GetEstimateSet(),
		SortOrder: req.GetSortOrder(), SortSet: req.GetSortOrderSet(),
		ParentIssueID: req.GetParentIssueId(), ParentSet: req.GetParentSet(),
	})
	if err != nil {
		return nil, toStatus(err, "update issue")
	}
	p := issueProto(i)
	s.hub.BroadcastIssue(i.TeamID, p)
	return p, nil
}

func (s *Service) DeleteIssue(ctx context.Context, req *grownv1.DeleteIssueRequest) (*grownv1.DeleteIssueResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	// Resolve team for the broadcast before deleting.
	i, err := s.repo.GetIssue(ctx, orgID, req.GetId())
	if err != nil {
		return nil, toStatus(err, "issue")
	}
	if err := s.repo.DeleteIssue(ctx, orgID, req.GetId()); err != nil {
		return nil, toStatus(err, "delete issue")
	}
	s.hub.BroadcastDeleted(i.TeamID, req.GetId())
	return &grownv1.DeleteIssueResponse{}, nil
}

// ── Projects ─────────────────────────────────────────────────────────────────

func (s *Service) ListProjects(ctx context.Context, _ *grownv1.ListProjectsRequest) (*grownv1.ListProjectsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListProjects(ctx, orgID)
	if err != nil {
		return nil, toStatus(err, "list projects")
	}
	resp := &grownv1.ListProjectsResponse{Projects: make([]*grownv1.Project, 0, len(list))}
	for _, p := range list {
		resp.Projects = append(resp.Projects, projectProto(p))
	}
	return resp, nil
}

func (s *Service) CreateProject(ctx context.Context, req *grownv1.CreateProjectRequest) (*grownv1.Project, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name is required")
	}
	p, err := s.repo.CreateProject(ctx, orgID, ProjectFields{
		Name: req.GetName(), Description: req.GetDescription(), Color: req.GetColor(),
		Icon: req.GetIcon(), State: req.GetState(), LeadID: req.GetLeadId(), TargetDate: req.GetTargetDate(),
	})
	if err != nil {
		return nil, toStatus(err, "create project")
	}
	return projectProto(p), nil
}

func (s *Service) UpdateProject(ctx context.Context, req *grownv1.UpdateProjectRequest) (*grownv1.Project, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.UpdateProject(ctx, orgID, ProjectFields{
		Name: req.GetName(), Description: req.GetDescription(), Color: req.GetColor(),
		Icon: req.GetIcon(), State: req.GetState(), LeadID: req.GetLeadId(), TargetDate: req.GetTargetDate(),
	}, req.GetId())
	if err != nil {
		return nil, toStatus(err, "update project")
	}
	return projectProto(p), nil
}

func (s *Service) DeleteProject(ctx context.Context, req *grownv1.DeleteProjectRequest) (*grownv1.DeleteProjectResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteProject(ctx, orgID, req.GetId()); err != nil {
		return nil, toStatus(err, "delete project")
	}
	return &grownv1.DeleteProjectResponse{}, nil
}

// ── Labels ───────────────────────────────────────────────────────────────────

func (s *Service) ListLabels(ctx context.Context, _ *grownv1.ListProjectLabelsRequest) (*grownv1.ListProjectLabelsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListLabels(ctx, orgID)
	if err != nil {
		return nil, toStatus(err, "list labels")
	}
	resp := &grownv1.ListProjectLabelsResponse{Labels: make([]*grownv1.Label, 0, len(list))}
	for _, l := range list {
		resp.Labels = append(resp.Labels, labelProto(l))
	}
	return resp, nil
}

func (s *Service) CreateLabel(ctx context.Context, req *grownv1.CreateLabelRequest) (*grownv1.Label, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name is required")
	}
	l, err := s.repo.CreateLabel(ctx, orgID, req.GetName(), req.GetColor())
	if err != nil {
		return nil, toStatus(err, "create label")
	}
	return labelProto(l), nil
}

func (s *Service) DeleteLabel(ctx context.Context, req *grownv1.DeleteLabelRequest) (*grownv1.DeleteLabelResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteLabel(ctx, orgID, req.GetId()); err != nil {
		return nil, toStatus(err, "delete label")
	}
	return &grownv1.DeleteLabelResponse{}, nil
}

// ── Comments ─────────────────────────────────────────────────────────────────

func (s *Service) ListComments(ctx context.Context, req *grownv1.ListIssueCommentsRequest) (*grownv1.ListIssueCommentsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListComments(ctx, orgID, req.GetIssueId())
	if err != nil {
		return nil, toStatus(err, "list comments")
	}
	resp := &grownv1.ListIssueCommentsResponse{Comments: make([]*grownv1.Comment, 0, len(list))}
	for _, c := range list {
		resp.Comments = append(resp.Comments, commentProto(c))
	}
	return resp, nil
}

func (s *Service) CreateComment(ctx context.Context, req *grownv1.CreateCommentRequest) (*grownv1.Comment, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	if req.GetBody() == "" {
		return nil, status.Error(codes.InvalidArgument, "body is required")
	}
	name := u.DisplayName
	if name == "" {
		name = u.Email
	}
	c, err := s.repo.CreateComment(ctx, o.ID, req.GetIssueId(), u.ID, name, req.GetBody())
	if err != nil {
		return nil, toStatus(err, "create comment")
	}
	return commentProto(c), nil
}

func (s *Service) ListIssueGitLinks(ctx context.Context, req *grownv1.ListIssueGitLinksRequest) (*grownv1.ListIssueGitLinksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	links, err := s.repo.ListGitLinks(ctx, orgID, req.GetIssueId())
	if err != nil {
		return nil, toStatus(err, "list git links")
	}
	resp := &grownv1.ListIssueGitLinksResponse{Links: make([]*grownv1.GitLink, 0, len(links))}
	for _, l := range links {
		resp.Links = append(resp.Links, gitLinkProto(l))
	}
	return resp, nil
}
