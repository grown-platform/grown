package meet

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.MeetServiceServer over a Repository.
type Service struct {
	grownv1.UnimplementedMeetServiceServer
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

func toProto(r Room) *grownv1.MeetRoom {
	return &grownv1.MeetRoom{
		Id:        r.ID,
		OrgId:     r.OrgID,
		OwnerId:   r.OwnerID,
		Name:      r.Name,
		CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListMeetRooms(ctx context.Context, _ *grownv1.ListMeetRoomsRequest) (*grownv1.ListMeetRoomsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list rooms: %v", err)
	}
	resp := &grownv1.ListMeetRoomsResponse{Rooms: make([]*grownv1.MeetRoom, 0, len(list))}
	for _, r := range list {
		resp.Rooms = append(resp.Rooms, toProto(r))
	}
	return resp, nil
}

func (s *Service) CreateMeetRoom(ctx context.Context, req *grownv1.CreateMeetRoomRequest) (*grownv1.MeetRoom, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	r, err := s.repo.Create(ctx, o.ID, u.ID, req.GetName())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create room: %v", err)
	}
	return toProto(r), nil
}

func (s *Service) GetMeetRoom(ctx context.Context, req *grownv1.GetMeetRoomRequest) (*grownv1.MeetRoom, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	r, err := s.repo.Get(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "room not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get room: %v", err)
	}
	return toProto(r), nil
}

func (s *Service) DeleteMeetRoom(ctx context.Context, req *grownv1.DeleteMeetRoomRequest) (*grownv1.DeleteMeetRoomResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Delete(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "room not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete room: %v", err)
	}
	return &grownv1.DeleteMeetRoomResponse{}, nil
}
