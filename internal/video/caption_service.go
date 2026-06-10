package video

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

func captionStreamURL(id string) string { return "/api/v1/videos/captions/" + id + "/content" }

func toCaptionProto(c Caption) *grownv1.VideoCaption {
	return &grownv1.VideoCaption{
		Id:        c.ID,
		OrgId:     c.OrgID,
		VideoId:   c.VideoID,
		Lang:      c.Lang,
		Label:     c.Label,
		StreamUrl: captionStreamURL(c.ID),
		CreatedAt: c.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListVideoCaptions(ctx context.Context, req *grownv1.ListVideoCaptionsRequest) (*grownv1.ListVideoCaptionsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.captions == nil {
		return &grownv1.ListVideoCaptionsResponse{}, nil
	}
	list, err := s.captions.ListCaptions(ctx, orgID, req.GetVideoId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list captions: %v", err)
	}
	resp := &grownv1.ListVideoCaptionsResponse{Captions: make([]*grownv1.VideoCaption, 0, len(list))}
	for _, c := range list {
		resp.Captions = append(resp.Captions, toCaptionProto(c))
	}
	return resp, nil
}

func (s *Service) DeleteVideoCaption(ctx context.Context, req *grownv1.DeleteVideoCaptionRequest) (*grownv1.DeleteVideoCaptionResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if s.captions == nil {
		return nil, status.Error(codes.Unimplemented, "captions not configured")
	}
	blobKey, err := s.captions.DeleteCaption(ctx, orgID, req.GetVideoId(), req.GetId())
	if errors.Is(err, ErrCaptionNotFound) {
		return nil, status.Error(codes.NotFound, "caption not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete caption: %v", err)
	}
	if s.blobs != nil && blobKey != "" {
		_ = s.blobs.Delete(ctx, blobKey)
	}
	return &grownv1.DeleteVideoCaptionResponse{}, nil
}
