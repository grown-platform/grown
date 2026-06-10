package video

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

func toProgressProto(p Progress) *grownv1.VideoProgress {
	return &grownv1.VideoProgress{
		VideoId:         p.VideoID,
		PositionSeconds: p.PositionSeconds,
		Percent:         p.Percent,
		Watched:         p.Watched,
		UpdatedAt:       p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) SetVideoProgress(ctx context.Context, req *grownv1.SetVideoProgressRequest) (*grownv1.SetVideoProgressResponse, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	if s.progress == nil {
		return nil, status.Error(codes.Unimplemented, "progress not configured")
	}
	p, err := s.progress.Upsert(ctx, u.ID, req.GetVideoId(), req.GetPositionSeconds(), req.GetPercent())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "set progress: %v", err)
	}
	return &grownv1.SetVideoProgressResponse{Progress: toProgressProto(p)}, nil
}

func (s *Service) GetVideoProgress(ctx context.Context, req *grownv1.GetVideoProgressRequest) (*grownv1.VideoProgress, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	if s.progress == nil {
		return nil, status.Error(codes.Unimplemented, "progress not configured")
	}
	p, err := s.progress.Get(ctx, u.ID, req.GetVideoId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get progress: %v", err)
	}
	return toProgressProto(p), nil
}
