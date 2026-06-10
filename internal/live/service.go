package live

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.LiveServiceServer over a Repository. URLs builds
// the ingest/playback URLs returned to clients from env-configured public
// bases.
type Service struct {
	repo *Repository
	urls URLConfig
}

// NewService constructs a Service.
func NewService(repo *Repository, urls URLConfig) *Service {
	return &Service{repo: repo, urls: urls}
}

// caller returns (userID, orgID) from the auth context, or a gRPC error.
func caller(ctx context.Context) (userID, orgID string, err error) {
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

func ts(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// toProto converts a Stream to its proto form. When includeSecrets is false the
// stream_key and ingest_* URLs are blanked (non-owner views). Playback URLs
// (hls/whep) are always included.
func (s *Service) toProto(st Stream, includeSecrets bool) *grownv1.LiveStream {
	out := &grownv1.LiveStream{
		Id:          st.ID,
		OrgId:       st.OrgID,
		OwnerId:     st.OwnerID,
		OwnerName:   st.OwnerName,
		Title:       st.Title,
		Description: st.Description,
		Visibility:  st.Visibility,
		Status:      st.Status,
		Path:        st.Path,
		HlsUrl:      s.urls.HLS(st.Path),
		WhepUrl:     s.urls.WHEP(st.Path),
		StartedAt:   ts(st.StartedAt),
		EndedAt:     ts(st.EndedAt),
		CreatedAt:   st.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   st.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if includeSecrets {
		out.StreamKey = st.StreamKey
		out.IngestRtmpUrl = s.urls.IngestRTMP(st.Path)
		out.IngestWhipUrl = s.urls.IngestWHIP(st.Path)
	}
	return out
}

// canWatch reports whether callerOrg may watch st: public streams are watchable
// by anyone; org streams only by members of the owning org.
func canWatch(st Stream, callerOrg string) bool {
	if st.Visibility == VisibilityPublic {
		return true
	}
	return st.OrgID == callerOrg
}

func (s *Service) CreateStream(ctx context.Context, req *grownv1.LiveCreateStreamRequest) (*grownv1.LiveStream, error) {
	uid, oid, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.repo.Create(ctx, oid, uid, CreateParams{
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		Visibility:  req.GetVisibility(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create stream: %v", err)
	}
	// Owner just created it → include secrets.
	return s.toProto(st, true), nil
}

func (s *Service) ListStreams(ctx context.Context, req *grownv1.LiveListStreamsRequest) (*grownv1.LiveListStreamsResponse, error) {
	uid, oid, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	filter := ListFilter(req.GetFilter())
	switch filter {
	case FilterLive, FilterMine, FilterAll:
	default:
		filter = FilterAll
	}
	list, err := s.repo.List(ctx, oid, uid, filter)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list streams: %v", err)
	}
	resp := &grownv1.LiveListStreamsResponse{Streams: make([]*grownv1.LiveStream, 0, len(list))}
	for _, st := range list {
		// Secrets only for the caller's own streams.
		resp.Streams = append(resp.Streams, s.toProto(st, st.OwnerID == uid))
	}
	return resp, nil
}

func (s *Service) GetStream(ctx context.Context, req *grownv1.LiveGetStreamRequest) (*grownv1.LiveStream, error) {
	uid, oid, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.repo.Get(ctx, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "stream not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get stream: %v", err)
	}
	isOwner := st.OwnerID == uid
	if !isOwner && !canWatch(st, oid) {
		// Don't leak existence of org streams in other orgs.
		return nil, status.Error(codes.NotFound, "stream not found")
	}
	return s.toProto(st, isOwner), nil
}

func (s *Service) UpdateStream(ctx context.Context, req *grownv1.LiveUpdateStreamRequest) (*grownv1.LiveStream, error) {
	uid, oid, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.repo.Update(ctx, oid, uid, req.GetId(), Fields{
		Title:       req.GetTitle(),
		Description: req.GetDescription(),
		Visibility:  req.GetVisibility(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "stream not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update stream: %v", err)
	}
	return s.toProto(st, true), nil
}

func (s *Service) DeleteStream(ctx context.Context, req *grownv1.LiveDeleteStreamRequest) (*grownv1.LiveDeleteStreamResponse, error) {
	uid, oid, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Delete(ctx, oid, uid, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "stream not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete stream: %v", err)
	}
	return &grownv1.LiveDeleteStreamResponse{}, nil
}

func (s *Service) EndStream(ctx context.Context, req *grownv1.LiveEndStreamRequest) (*grownv1.LiveStream, error) {
	uid, oid, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.repo.EndByOwner(ctx, oid, uid, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "stream not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "end stream: %v", err)
	}
	return s.toProto(st, true), nil
}
