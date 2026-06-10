package whiteboards

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/sharing"
)

// Service implements grownv1.WhiteboardsServiceServer over a Repository.
type Service struct {
	repo   *Repository
	grants *sharing.Repository // nil disables per-user ACL grants
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// WithSharing wires the per-user ACL grant repository, enabling GrantBoardAccess/
// ListBoardGrants/RevokeBoardAccess, "Shared with me", and cross-org grant reads.
func (s *Service) WithSharing(grants *sharing.Repository) *Service {
	s.grants = grants
	return s
}

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

// callerOrgUser returns the caller's org id and user id, or an auth error.
func callerOrgUser(ctx context.Context) (orgID, userID string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, u.ID, nil
}

// accessBoard resolves a whiteboard the caller may read: an org member sees
// their org's boards; otherwise a per-user grant (object_grants) is required.
// Returns the board, the caller's effective role, and a gRPC NotFound error
// when neither path grants access (absent and forbidden are indistinguishable).
func (s *Service) accessBoard(ctx context.Context, orgID, userID, boardID string) (Whiteboard, string, error) {
	if wb, err := s.repo.Get(ctx, orgID, boardID); err == nil {
		role := "editor"
		if wb.OwnerID == userID {
			role = "owner"
		}
		return wb, role, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Whiteboard{}, "", status.Errorf(codes.Internal, "get whiteboard: %v", err)
	}
	if s.grants != nil {
		role, ok, err := s.grants.RoleFor(ctx, userID, sharing.TypeWhiteboardBoard, boardID)
		if err != nil {
			return Whiteboard{}, "", status.Errorf(codes.Internal, "grant lookup: %v", err)
		}
		if ok {
			wb, gerr := s.repo.GetByID(ctx, boardID)
			if errors.Is(gerr, ErrNotFound) {
				return Whiteboard{}, "", status.Error(codes.NotFound, "whiteboard not found")
			}
			if gerr != nil {
				return Whiteboard{}, "", status.Errorf(codes.Internal, "get whiteboard: %v", gerr)
			}
			return wb, role, nil
		}
	}
	return Whiteboard{}, "", status.Error(codes.NotFound, "whiteboard not found")
}

func grantToProto(g sharing.Grant) *grownv1.ObjectGrant {
	return &grownv1.ObjectGrant{
		GranteeUserId: g.GranteeUserID,
		GranteeName:   g.GranteeName,
		GranteeEmail:  g.GranteeEmail,
		Role:          g.Role,
		GrantedBy:     g.GrantedBy,
	}
}

func toProto(w Whiteboard) *grownv1.Whiteboard {
	return &grownv1.Whiteboard{
		Id:        w.ID,
		OrgId:     w.OrgID,
		OwnerId:   w.OwnerID,
		Title:     w.Title,
		CreatedAt: w.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: w.UpdatedAt.UTC().Format(time.RFC3339),
		Data:      w.Data,
	}
}

func (s *Service) ListWhiteboards(ctx context.Context, _ *grownv1.ListWhiteboardsRequest) (*grownv1.ListWhiteboardsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list whiteboards: %v", err)
	}
	resp := &grownv1.ListWhiteboardsResponse{Whiteboards: make([]*grownv1.Whiteboard, 0, len(list))}
	for _, w := range list {
		resp.Whiteboards = append(resp.Whiteboards, toProto(w))
	}
	return resp, nil
}

func (s *Service) CreateWhiteboard(ctx context.Context, req *grownv1.CreateWhiteboardRequest) (*grownv1.Whiteboard, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	w, err := s.repo.Create(ctx, o.ID, u.ID, req.GetTitle())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create whiteboard: %v", err)
	}
	return toProto(w), nil
}

func (s *Service) GetWhiteboard(ctx context.Context, req *grownv1.GetWhiteboardRequest) (*grownv1.Whiteboard, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	wb, _, aerr := s.accessBoard(ctx, orgID, userID, req.GetId())
	if aerr != nil {
		return nil, aerr
	}
	return toProto(wb), nil
}

func (s *Service) RenameWhiteboard(ctx context.Context, req *grownv1.RenameWhiteboardRequest) (*grownv1.Whiteboard, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	w, err := s.repo.Rename(ctx, orgID, req.GetId(), req.GetTitle())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "whiteboard not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "rename whiteboard: %v", err)
	}
	return toProto(w), nil
}

func (s *Service) SaveWhiteboard(ctx context.Context, req *grownv1.SaveWhiteboardRequest) (*grownv1.SaveWhiteboardResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Save(ctx, orgID, req.GetId(), req.GetData())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "whiteboard not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "save whiteboard: %v", err)
	}
	return &grownv1.SaveWhiteboardResponse{}, nil
}

func (s *Service) TrashWhiteboard(ctx context.Context, req *grownv1.TrashWhiteboardRequest) (*grownv1.TrashWhiteboardResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "whiteboard not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "trash whiteboard: %v", err)
	}
	return &grownv1.TrashWhiteboardResponse{}, nil
}

// GrantBoardAccess grants a grown user a role on a whiteboard in the caller's org.
func (s *Service) GrantBoardAccess(ctx context.Context, req *grownv1.GrantBoardAccessRequest) (*grownv1.GrantBoardAccessResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if !sharing.ValidRole(req.GetRole()) {
		return nil, status.Error(codes.InvalidArgument, "role must be viewer, commenter, or editor")
	}
	if req.GetGranteeUserId() == "" {
		return nil, status.Error(codes.InvalidArgument, "grantee_user_id required")
	}
	// Caller must be an org member of the board to manage its grants.
	if _, err := s.repo.Get(ctx, orgID, req.GetBoardId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "whiteboard not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get whiteboard: %v", err)
	}
	if err := s.grants.GrantAccess(ctx, sharing.TypeWhiteboardBoard, req.GetBoardId(), req.GetGranteeUserId(), req.GetRole(), userID); err != nil {
		return nil, status.Errorf(codes.Internal, "grant: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeWhiteboardBoard, req.GetBoardId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	for _, g := range list {
		if g.GranteeUserID == req.GetGranteeUserId() {
			return &grownv1.GrantBoardAccessResponse{Grant: grantToProto(g)}, nil
		}
	}
	return &grownv1.GrantBoardAccessResponse{}, nil
}

// ListBoardGrants returns the per-user ACL grants on a whiteboard in the caller's org.
func (s *Service) ListBoardGrants(ctx context.Context, req *grownv1.ListBoardGrantsRequest) (*grownv1.ListBoardGrantsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListBoardGrantsResponse{}, nil
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetBoardId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "whiteboard not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get whiteboard: %v", err)
	}
	list, lerr := s.grants.ListGrantsForObject(ctx, sharing.TypeWhiteboardBoard, req.GetBoardId())
	if lerr != nil {
		return nil, status.Errorf(codes.Internal, "list grants: %v", lerr)
	}
	out := make([]*grownv1.ObjectGrant, 0, len(list))
	for _, g := range list {
		out = append(out, grantToProto(g))
	}
	return &grownv1.ListBoardGrantsResponse{Grants: out}, nil
}

// RevokeBoardAccess removes a user's per-user grant on a whiteboard in the caller's org.
func (s *Service) RevokeBoardAccess(ctx context.Context, req *grownv1.RevokeBoardAccessRequest) (*grownv1.RevokeBoardAccessResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return nil, status.Error(codes.Unimplemented, "sharing not enabled")
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetBoardId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "whiteboard not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get whiteboard: %v", err)
	}
	if err := s.grants.RevokeAccess(ctx, sharing.TypeWhiteboardBoard, req.GetBoardId(), req.GetGranteeUserId()); err != nil {
		return nil, status.Errorf(codes.Internal, "revoke: %v", err)
	}
	return &grownv1.RevokeBoardAccessResponse{}, nil
}

// ListSharedWithMe returns whiteboards granted to the caller by a per-user ACL
// grant (possibly cross-org), excluding the caller's own org boards.
func (s *Service) ListSharedWithMe(ctx context.Context, _ *grownv1.ListWhiteboardsSharedWithMeRequest) (*grownv1.ListWhiteboardsSharedWithMeResponse, error) {
	orgID, userID, err := callerOrgUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.grants == nil {
		return &grownv1.ListWhiteboardsSharedWithMeResponse{}, nil
	}
	ids, err := s.grants.ListObjectIDsGrantedToUser(ctx, userID, sharing.TypeWhiteboardBoard)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared ids: %v", err)
	}
	boards, err := s.repo.GetByIDs(ctx, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "shared boards: %v", err)
	}
	resp := &grownv1.ListWhiteboardsSharedWithMeResponse{Whiteboards: make([]*grownv1.Whiteboard, 0, len(boards))}
	for _, wb := range boards {
		if wb.OrgID == orgID {
			continue
		}
		resp.Whiteboards = append(resp.Whiteboards, toProto(wb))
	}
	return resp, nil
}
