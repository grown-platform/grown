package groups

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.GroupsServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

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

// callerUser returns the caller's user id, org id, and display name.
func callerUser(ctx context.Context) (id, orgID, name string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", "", status.Error(codes.Internal, "missing org context")
	}
	name = u.DisplayName
	if name == "" {
		name = u.Email
	}
	return u.ID, o.ID, name, nil
}

// ── Proto mappers ────────────────────────────────────────────────────────────

func groupToProto(g Group) *grownv1.Group {
	return &grownv1.Group{
		Id:          g.ID,
		OrgId:       g.OrgID,
		Name:        g.Name,
		Email:       g.Email,
		Description: g.Description,
		MemberIds:   g.MemberIDs,
		MemberCount: g.MemberCount,
		TopicCount:  g.TopicCount,
		PostCount:   g.PostCount,
		CreatedAt:   g.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   g.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func topicToProto(t Topic) *grownv1.GroupTopic {
	lastAt := ""
	if t.LastPostAt != nil {
		lastAt = t.LastPostAt.UTC().Format(time.RFC3339)
	}
	return &grownv1.GroupTopic{
		Id:         t.ID,
		GroupId:    t.GroupID,
		OrgId:      t.OrgID,
		Subject:    t.Subject,
		AuthorId:   t.AuthorID,
		AuthorName: t.AuthorName,
		PostCount:  t.PostCount,
		LastPostAt: lastAt,
		CreatedAt:  t.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func postToProto(p Post) *grownv1.GroupPost {
	return &grownv1.GroupPost{
		Id:         p.ID,
		TopicId:    p.TopicID,
		GroupId:    p.GroupID,
		OrgId:      p.OrgID,
		AuthorId:   p.AuthorID,
		AuthorName: p.AuthorName,
		Body:       p.Body,
		CreatedAt:  p.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// ── Members ──────────────────────────────────────────────────────────────────

// ListMembers returns the org's users for the member picker.
func (s *Service) ListMembers(ctx context.Context, _ *grownv1.ListGroupMembersRequest) (*grownv1.ListGroupMembersResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ListMembers(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list members: %v", err)
	}
	resp := &grownv1.ListGroupMembersResponse{Members: make([]*grownv1.GroupMember, 0, len(members))}
	for _, m := range members {
		resp.Members = append(resp.Members, &grownv1.GroupMember{Id: m.ID, Name: m.Name, Email: m.Email})
	}
	return resp, nil
}

// ── Groups ───────────────────────────────────────────────────────────────────

func (s *Service) ListGroups(ctx context.Context, _ *grownv1.ListGroupsRequest) (*grownv1.ListGroupsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list groups: %v", err)
	}
	resp := &grownv1.ListGroupsResponse{Groups: make([]*grownv1.Group, 0, len(list))}
	for _, g := range list {
		resp.Groups = append(resp.Groups, groupToProto(g))
	}
	return resp, nil
}

func (s *Service) CreateGroup(ctx context.Context, req *grownv1.CreateGroupRequest) (*grownv1.Group, error) {
	userID, orgID, _, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name is required")
	}
	// Ensure the creator is always a member.
	members := dedupeWith(req.GetMemberIds(), userID)
	g, err := s.repo.Create(ctx, orgID, userID, GroupFields{
		Name: req.GetName(), Email: req.GetEmail(), Description: req.GetDescription(), MemberIDs: members,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create group: %v", err)
	}
	return groupToProto(g), nil
}

func (s *Service) GetGroup(ctx context.Context, req *grownv1.GetGroupRequest) (*grownv1.Group, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	g, err := s.repo.Get(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "group not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get group: %v", err)
	}
	return groupToProto(g), nil
}

func (s *Service) UpdateGroup(ctx context.Context, req *grownv1.UpdateGroupRequest) (*grownv1.Group, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetName() == "" {
		return nil, status.Error(codes.InvalidArgument, "name is required")
	}
	g, err := s.repo.Update(ctx, orgID, req.GetId(), GroupFields{
		Name: req.GetName(), Email: req.GetEmail(), Description: req.GetDescription(),
		MemberIDs: dedupe(req.GetMemberIds()),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "group not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update group: %v", err)
	}
	return groupToProto(g), nil
}

func (s *Service) DeleteGroup(ctx context.Context, req *grownv1.DeleteGroupRequest) (*grownv1.DeleteGroupResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Delete(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "group not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete group: %v", err)
	}
	return &grownv1.DeleteGroupResponse{}, nil
}

// ── Topics ───────────────────────────────────────────────────────────────────

func (s *Service) ListTopics(ctx context.Context, req *grownv1.ListTopicsRequest) (*grownv1.ListTopicsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	ok, err := s.repo.GroupExists(ctx, orgID, req.GetGroupId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list topics: %v", err)
	}
	if !ok {
		return nil, status.Error(codes.NotFound, "group not found")
	}
	topics, err := s.repo.ListTopics(ctx, orgID, req.GetGroupId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list topics: %v", err)
	}
	resp := &grownv1.ListTopicsResponse{Topics: make([]*grownv1.GroupTopic, 0, len(topics))}
	for _, t := range topics {
		resp.Topics = append(resp.Topics, topicToProto(t))
	}
	return resp, nil
}

func (s *Service) CreateTopic(ctx context.Context, req *grownv1.CreateTopicRequest) (*grownv1.GroupTopic, error) {
	userID, orgID, name, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetSubject() == "" {
		return nil, status.Error(codes.InvalidArgument, "subject is required")
	}
	ok, err := s.repo.GroupExists(ctx, orgID, req.GetGroupId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create topic: %v", err)
	}
	if !ok {
		return nil, status.Error(codes.NotFound, "group not found")
	}
	t, err := s.repo.CreateTopic(ctx, orgID, req.GetGroupId(), userID, name, req.GetSubject(), req.GetBody())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create topic: %v", err)
	}
	return topicToProto(t), nil
}

// ── Posts ────────────────────────────────────────────────────────────────────

func (s *Service) ListPosts(ctx context.Context, req *grownv1.ListPostsRequest) (*grownv1.ListPostsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.TopicGroup(ctx, orgID, req.GetTopicId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "topic not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "list posts: %v", err)
	}
	posts, err := s.repo.ListPosts(ctx, orgID, req.GetTopicId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list posts: %v", err)
	}
	resp := &grownv1.ListPostsResponse{Posts: make([]*grownv1.GroupPost, 0, len(posts))}
	for _, p := range posts {
		resp.Posts = append(resp.Posts, postToProto(p))
	}
	return resp, nil
}

func (s *Service) CreatePost(ctx context.Context, req *grownv1.CreatePostRequest) (*grownv1.GroupPost, error) {
	userID, orgID, name, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.GetBody() == "" {
		return nil, status.Error(codes.InvalidArgument, "body is required")
	}
	p, err := s.repo.CreatePost(ctx, orgID, req.GetTopicId(), userID, name, req.GetBody())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "topic not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create post: %v", err)
	}
	return postToProto(p), nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// dedupe removes empty and duplicate ids, preserving order.
func dedupe(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// dedupeWith dedupes ids and guarantees must is present.
func dedupeWith(ids []string, must string) []string {
	out := dedupe(append([]string{must}, ids...))
	return out
}
