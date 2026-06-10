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

// The share methods below are attached to *Service so they satisfy the full
// grownv1.VideoServiceServer interface after buf generate.

func toUserShareProto(s UserShare) *grownv1.VideoUserShare {
	return &grownv1.VideoUserShare{
		VideoId:   s.VideoID,
		UserId:    s.UserID,
		UserName:  s.UserName,
		UserEmail: s.UserEmail,
		CreatedAt: s.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func toShareLinkProto(sl ShareLink, publicHost string) *grownv1.VideoShareLink {
	expiresAt := ""
	if sl.ExpiresAt != nil {
		expiresAt = sl.ExpiresAt.UTC().Format(time.RFC3339)
	}
	watchURL := publicHost + "/video/watch/" + sl.Token
	return &grownv1.VideoShareLink{
		Token:     sl.Token,
		VideoId:   sl.VideoID,
		OrgId:     sl.OrgID,
		CreatedBy: sl.CreatedBy,
		ExpiresAt: expiresAt,
		CreatedAt: sl.CreatedAt.UTC().Format(time.RFC3339),
		Url:       watchURL,
	}
}

// ShareVideo grants one or more org users access to watch a video.
func (s *Service) ShareVideo(ctx context.Context, req *grownv1.ShareVideoRequest) (*grownv1.ShareVideoResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	// Verify the video exists in this org.
	if _, err := s.repo.Get(ctx, orgID, req.GetVideoId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get video: %v", err)
	}

	var shares []*grownv1.VideoUserShare
	for _, uid := range req.GetUserIds() {
		sh, err := s.shares.AddUserShare(ctx, req.GetVideoId(), uid)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "share video: %v", err)
		}
		shares = append(shares, toUserShareProto(sh))
	}
	return &grownv1.ShareVideoResponse{Shares: shares}, nil
}

// ListVideoShares returns the org users a video has been shared with.
func (s *Service) ListVideoShares(ctx context.Context, req *grownv1.ListVideoSharesRequest) (*grownv1.ListVideoSharesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetVideoId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get video: %v", err)
	}

	list, err := s.shares.ListUserShares(ctx, req.GetVideoId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list shares: %v", err)
	}
	resp := &grownv1.ListVideoSharesResponse{Shares: make([]*grownv1.VideoUserShare, 0, len(list))}
	for _, sh := range list {
		resp.Shares = append(resp.Shares, toUserShareProto(sh))
	}
	return resp, nil
}

// UnshareVideo removes a targeted share grant.
func (s *Service) UnshareVideo(ctx context.Context, req *grownv1.UnshareVideoRequest) (*grownv1.UnshareVideoResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetVideoId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get video: %v", err)
	}

	if err := s.shares.RemoveUserShare(ctx, req.GetVideoId(), req.GetUserId()); errors.Is(err, ErrShareNotFound) {
		return nil, status.Error(codes.NotFound, "share not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "unshare video: %v", err)
	}
	return &grownv1.UnshareVideoResponse{}, nil
}

// CreateVideoShareLink creates a public watch link for the video.
func (s *Service) CreateVideoShareLink(ctx context.Context, req *grownv1.CreateVideoShareLinkRequest) (*grownv1.VideoShareLink, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	if _, err := s.repo.Get(ctx, o.ID, req.GetVideoId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get video: %v", err)
	}

	var expiresAt *time.Time
	if raw := req.GetExpiresAt(); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid expires_at: %v", err)
		}
		expiresAt = &t
	}

	sl, err := s.shares.CreateShareLink(ctx, req.GetVideoId(), o.ID, u.ID, expiresAt)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create share link: %v", err)
	}
	return toShareLinkProto(sl, s.publicHost), nil
}

// ListVideoShareLinks returns active public links for a video.
func (s *Service) ListVideoShareLinks(ctx context.Context, req *grownv1.ListVideoShareLinksRequest) (*grownv1.ListVideoShareLinksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, orgID, req.GetVideoId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "video not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get video: %v", err)
	}

	list, err := s.shares.ListShareLinks(ctx, req.GetVideoId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list share links: %v", err)
	}
	resp := &grownv1.ListVideoShareLinksResponse{Links: make([]*grownv1.VideoShareLink, 0, len(list))}
	for _, sl := range list {
		resp.Links = append(resp.Links, toShareLinkProto(sl, s.publicHost))
	}
	return resp, nil
}

// RevokeVideoShareLink revokes a public share link.
func (s *Service) RevokeVideoShareLink(ctx context.Context, req *grownv1.RevokeVideoShareLinkRequest) (*grownv1.RevokeVideoShareLinkResponse, error) {
	// Auth: only org members (verified via callerOrg) can revoke. We verify the
	// share link belongs to the caller's org before revoking.
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	// Resolve the share link to confirm it belongs to this org.
	sl, _, err := s.shares.GetShareLink(ctx, req.GetToken())
	if errors.Is(err, ErrShareNotFound) {
		return nil, status.Error(codes.NotFound, "share link not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get share link: %v", err)
	}
	if sl.OrgID != o.ID {
		return nil, status.Error(codes.NotFound, "share link not found")
	}
	if err := s.shares.RevokeShareLink(ctx, req.GetToken()); errors.Is(err, ErrShareNotFound) {
		return nil, status.Error(codes.NotFound, "share link not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "revoke share link: %v", err)
	}
	return &grownv1.RevokeVideoShareLinkResponse{}, nil
}
