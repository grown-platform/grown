package notifications

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.NotificationsServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// callerCtx resolves the authenticated user and org from the gRPC context.
func callerCtx(ctx context.Context) (userID, orgID string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Internal, "missing org context")
	}
	return u.ID, o.ID, nil
}

func toProto(n Notification) *grownv1.Notification {
	return &grownv1.Notification{
		Id:          n.ID,
		OrgId:       n.OrgID,
		UserId:      n.UserID,
		Type:        n.Type,
		ActorUserId: n.ActorUserID,
		Title:       n.Title,
		Body:        n.Body,
		TargetUrl:   n.TargetURL,
		Read:        n.Read,
		CreatedAt:   n.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListNotifications(ctx context.Context, req *grownv1.ListNotificationsRequest) (*grownv1.ListNotificationsResponse, error) {
	userID, orgID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	limit := int(req.GetPageSize())
	var before time.Time
	if tok := req.GetPageToken(); tok != "" {
		before, err = time.Parse(time.RFC3339Nano, tok)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid page_token: %v", err)
		}
	}
	list, err := s.repo.List(ctx, orgID, userID, before, limit)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list notifications: %v", err)
	}
	resp := &grownv1.ListNotificationsResponse{
		Notifications: make([]*grownv1.Notification, 0, len(list)),
	}
	for _, n := range list {
		resp.Notifications = append(resp.Notifications, toProto(n))
	}
	// Cursor for the next page: created_at of the last item.
	if len(list) > 0 {
		resp.NextPageToken = list[len(list)-1].CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	return resp, nil
}

func (s *Service) UnreadCount(ctx context.Context, _ *grownv1.UnreadCountRequest) (*grownv1.UnreadCountResponse, error) {
	userID, orgID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	count, err := s.repo.UnreadCount(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "unread count: %v", err)
	}
	return &grownv1.UnreadCountResponse{Count: count}, nil
}

func (s *Service) MarkRead(ctx context.Context, req *grownv1.MarkReadRequest) (*grownv1.MarkReadResponse, error) {
	userID, orgID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.MarkRead(ctx, orgID, userID, req.GetId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "notification not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "mark read: %v", err)
	}
	return &grownv1.MarkReadResponse{}, nil
}

func (s *Service) MarkAllRead(ctx context.Context, _ *grownv1.MarkAllReadRequest) (*grownv1.MarkAllReadResponse, error) {
	userID, orgID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.MarkAllRead(ctx, orgID, userID); err != nil {
		return nil, status.Errorf(codes.Internal, "mark all read: %v", err)
	}
	return &grownv1.MarkAllReadResponse{}, nil
}

func (s *Service) DeleteNotification(ctx context.Context, req *grownv1.DeleteNotificationRequest) (*grownv1.DeleteNotificationResponse, error) {
	userID, orgID, err := callerCtx(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Delete(ctx, orgID, userID, req.GetId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "notification not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "delete notification: %v", err)
	}
	return &grownv1.DeleteNotificationResponse{}, nil
}
