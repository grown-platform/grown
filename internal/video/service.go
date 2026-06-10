package video

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.VideoServiceServer over a Repository.
type Service struct {
	repo       *Repository
	shares     *ShareRepository
	blobs      BlobStore
	publicHost string // e.g. "https://workspace.example.com" — no trailing slash
	playlists  *PlaylistRepository
	progress   *ProgressRepository
	captions   *CaptionRepository
}

// NewService constructs a Service. blobs is used to delete the underlying bytes
// when a video is removed; it may be nil (delete then only drops metadata).
// shares and publicHost are required for the sharing RPCs; shares may be nil to
// disable share management (safe for read-only deployments).
func NewService(repo *Repository, shares *ShareRepository, blobs BlobStore, publicHost string) *Service {
	return &Service{repo: repo, shares: shares, blobs: blobs, publicHost: publicHost}
}

// WithFeatureRepos wires the playlist/progress/caption repos into an existing
// Service. Returns s for chaining.
func (s *Service) WithFeatureRepos(playlists *PlaylistRepository, progress *ProgressRepository, captions *CaptionRepository) *Service {
	s.playlists = playlists
	s.progress = progress
	s.captions = captions
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

// streamURL is the relative HTTP path the player/download uses to fetch bytes.
func streamURL(id string) string { return "/api/v1/videos/" + id + "/content" }

func toProto(v Video) *grownv1.Video {
	return &grownv1.Video{
		Id:               v.ID,
		OrgId:            v.OrgID,
		OwnerId:          v.OwnerID,
		Title:            v.Title,
		Description:      v.Description,
		ContentType:      v.ContentType,
		Size:             v.Size,
		DurationSeconds:  v.DurationSeconds,
		ThumbnailDataUrl: v.ThumbnailDataURL,
		StreamUrl:        streamURL(v.ID),
		CreatedAt:        v.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:        v.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListVideos(ctx context.Context, _ *grownv1.ListVideosRequest) (*grownv1.ListVideosResponse, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	orgID := o.ID

	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list videos: %v", err)
	}

	// Also surface videos that have been individually shared with this user (from
	// other orgs or same org but not in the base list). Deduplicate by ID.
	seen := make(map[string]struct{}, len(list))
	for _, v := range list {
		seen[v.ID] = struct{}{}
	}
	if s.shares != nil {
		shared, err := s.repo.ListSharedWith(ctx, u.ID)
		if err == nil {
			for _, v := range shared {
				if _, dup := seen[v.ID]; !dup {
					list = append(list, v)
					seen[v.ID] = struct{}{}
				}
			}
		}
	}

	resp := &grownv1.ListVideosResponse{Videos: make([]*grownv1.Video, 0, len(list))}
	for _, v := range list {
		resp.Videos = append(resp.Videos, toProto(v))
	}
	return resp, nil
}

func (s *Service) GetVideo(ctx context.Context, req *grownv1.GetVideoRequest) (*grownv1.Video, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	// Try org-owned first.
	v, err := s.repo.Get(ctx, o.ID, req.GetId())
	if errors.Is(err, ErrNotFound) && s.shares != nil {
		// Fall back: maybe it was individually shared with this user.
		shared, shareErr := s.shares.IsSharedWithUser(ctx, req.GetId(), u.ID)
		if shareErr == nil && shared {
			v, err = s.repo.GetByID(ctx, req.GetId())
		}
	}
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get video: %v", err)
	}
	return toProto(v), nil
}

func (s *Service) UpdateVideo(ctx context.Context, req *grownv1.UpdateVideoRequest) (*grownv1.Video, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	v, err := s.repo.Update(ctx, orgID, req.GetId(), Fields{
		Title:            req.GetTitle(),
		Description:      req.GetDescription(),
		ThumbnailDataURL: req.GetThumbnailDataUrl(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update video: %v", err)
	}
	return toProto(v), nil
}

func (s *Service) DeleteVideo(ctx context.Context, req *grownv1.DeleteVideoRequest) (*grownv1.DeleteVideoResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	blobKey, err := s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete video: %v", err)
	}
	// Best-effort blob cleanup; metadata is already soft-deleted.
	if s.blobs != nil && blobKey != "" {
		_ = s.blobs.Delete(ctx, blobKey)
	}
	return &grownv1.DeleteVideoResponse{}, nil
}
