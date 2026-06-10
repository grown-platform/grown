package music

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.MusicServiceServer over a Repository.
type Service struct {
	repo  *Repository
	blobs BlobStore
}

// NewService constructs a Service. blobs is used to delete the underlying bytes
// when a track is removed; it may be nil (delete then only drops metadata).
func NewService(repo *Repository, blobs BlobStore) *Service {
	return &Service{repo: repo, blobs: blobs}
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
func streamURL(id string) string { return "/api/v1/music/" + id + "/content" }

func trackToProto(t Track) *grownv1.Track {
	return trackToProtoLiked(t, false)
}

func trackToProtoLiked(t Track, liked bool) *grownv1.Track {
	return &grownv1.Track{
		Id:              t.ID,
		OrgId:           t.OrgID,
		OwnerId:         t.OwnerID,
		Title:           t.Title,
		Artist:          t.Artist,
		Album:           t.Album,
		ContentType:     t.ContentType,
		Size:            t.Size,
		DurationSeconds: t.DurationSeconds,
		ArtworkDataUrl:  t.ArtworkDataURL,
		StreamUrl:       streamURL(t.ID),
		CreatedAt:       t.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       t.UpdatedAt.UTC().Format(time.RFC3339),
		Liked:           liked,
	}
}

func playlistToProto(p Playlist) *grownv1.Playlist {
	tracks := make([]*grownv1.Track, 0, len(p.Tracks))
	for _, t := range p.Tracks {
		tracks = append(tracks, trackToProto(t))
	}
	return &grownv1.Playlist{
		Id:          p.ID,
		OrgId:       p.OrgID,
		OwnerId:     p.OwnerID,
		Name:        p.Name,
		Description: p.Description,
		Tracks:      tracks,
		TrackCount:  int32(p.TrackCount),
		CreatedAt:   p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListTracks(ctx context.Context, _ *grownv1.ListTracksRequest) (*grownv1.ListTracksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	u, _ := auth.UserFromContext(ctx)
	list, err := s.repo.ListTracks(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list tracks: %v", err)
	}
	// Annotate liked status in bulk.
	ids := make([]string, len(list))
	for i, t := range list {
		ids[i] = t.ID
	}
	liked, err := s.repo.LikedSet(ctx, u.ID, ids)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "liked set: %v", err)
	}
	resp := &grownv1.ListTracksResponse{Tracks: make([]*grownv1.Track, 0, len(list))}
	for _, t := range list {
		resp.Tracks = append(resp.Tracks, trackToProtoLiked(t, liked[t.ID]))
	}
	return resp, nil
}

func (s *Service) GetTrack(ctx context.Context, req *grownv1.GetTrackRequest) (*grownv1.Track, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	t, err := s.repo.GetTrack(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "track not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get track: %v", err)
	}
	return trackToProto(t), nil
}

func (s *Service) UpdateTrack(ctx context.Context, req *grownv1.UpdateTrackRequest) (*grownv1.Track, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	t, err := s.repo.UpdateTrack(ctx, orgID, req.GetId(), TrackFields{
		Title:          req.GetTitle(),
		Artist:         req.GetArtist(),
		Album:          req.GetAlbum(),
		ArtworkDataURL: req.GetArtworkDataUrl(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "track not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update track: %v", err)
	}
	return trackToProto(t), nil
}

func (s *Service) DeleteTrack(ctx context.Context, req *grownv1.DeleteTrackRequest) (*grownv1.DeleteTrackResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	blobKey, err := s.repo.TrashTrack(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "track not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete track: %v", err)
	}
	// Best-effort blob cleanup; metadata is already soft-deleted.
	if s.blobs != nil && blobKey != "" {
		_ = s.blobs.Delete(ctx, blobKey)
	}
	return &grownv1.DeleteTrackResponse{}, nil
}

func (s *Service) ListPlaylists(ctx context.Context, _ *grownv1.ListPlaylistsRequest) (*grownv1.ListPlaylistsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListPlaylists(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list playlists: %v", err)
	}
	resp := &grownv1.ListPlaylistsResponse{Playlists: make([]*grownv1.Playlist, 0, len(list))}
	for _, p := range list {
		resp.Playlists = append(resp.Playlists, playlistToProto(p))
	}
	return resp, nil
}

func (s *Service) GetPlaylist(ctx context.Context, req *grownv1.GetPlaylistRequest) (*grownv1.Playlist, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.GetPlaylist(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "playlist not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get playlist: %v", err)
	}
	return playlistToProto(p), nil
}

func (s *Service) CreatePlaylist(ctx context.Context, req *grownv1.CreatePlaylistRequest) (*grownv1.Playlist, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	u, _ := auth.UserFromContext(ctx)
	p, err := s.repo.CreatePlaylist(ctx, orgID, u.ID, PlaylistFields{
		Name:        req.GetName(),
		Description: req.GetDescription(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create playlist: %v", err)
	}
	return playlistToProto(p), nil
}

func (s *Service) UpdatePlaylist(ctx context.Context, req *grownv1.UpdatePlaylistRequest) (*grownv1.Playlist, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.UpdatePlaylist(ctx, orgID, req.GetId(), PlaylistFields{
		Name:        req.GetName(),
		Description: req.GetDescription(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "playlist not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update playlist: %v", err)
	}
	return playlistToProto(p), nil
}

func (s *Service) DeletePlaylist(ctx context.Context, req *grownv1.DeletePlaylistRequest) (*grownv1.DeletePlaylistResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.TrashPlaylist(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "playlist not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete playlist: %v", err)
	}
	return &grownv1.DeletePlaylistResponse{}, nil
}

func (s *Service) AddTrackToPlaylist(ctx context.Context, req *grownv1.AddTrackToPlaylistRequest) (*grownv1.Playlist, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.AddTrackToPlaylist(ctx, orgID, req.GetPlaylistId(), req.GetTrackId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "playlist or track not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add track to playlist: %v", err)
	}
	return playlistToProto(p), nil
}

func (s *Service) RemoveTrackFromPlaylist(ctx context.Context, req *grownv1.RemoveTrackFromPlaylistRequest) (*grownv1.Playlist, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.RemoveTrackFromPlaylist(ctx, orgID, req.GetPlaylistId(), req.GetTrackId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "playlist not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "remove track from playlist: %v", err)
	}
	return playlistToProto(p), nil
}

func (s *Service) ReorderPlaylistTrack(ctx context.Context, req *grownv1.ReorderPlaylistTrackRequest) (*grownv1.Playlist, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.ReorderPlaylistTrack(ctx, orgID, req.GetPlaylistId(), req.GetTrackId(), int(req.GetNewPosition()))
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "playlist or track not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "reorder playlist track: %v", err)
	}
	return playlistToProto(p), nil
}

func (s *Service) LikeTrack(ctx context.Context, req *grownv1.LikeTrackRequest) (*grownv1.LikeTrackResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	u, _ := auth.UserFromContext(ctx)
	if err := s.repo.LikeTrack(ctx, orgID, u.ID, req.GetTrackId()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "track not found")
		}
		return nil, status.Errorf(codes.Internal, "like track: %v", err)
	}
	return &grownv1.LikeTrackResponse{}, nil
}

func (s *Service) UnlikeTrack(ctx context.Context, req *grownv1.UnlikeTrackRequest) (*grownv1.UnlikeTrackResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	u, _ := auth.UserFromContext(ctx)
	if err := s.repo.UnlikeTrack(ctx, orgID, u.ID, req.GetTrackId()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "track not found")
		}
		return nil, status.Errorf(codes.Internal, "unlike track: %v", err)
	}
	return &grownv1.UnlikeTrackResponse{}, nil
}

func (s *Service) ListLikedTracks(ctx context.Context, _ *grownv1.ListLikedTracksRequest) (*grownv1.ListLikedTracksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	u, _ := auth.UserFromContext(ctx)
	list, err := s.repo.ListLikedTracks(ctx, orgID, u.ID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list liked tracks: %v", err)
	}
	resp := &grownv1.ListLikedTracksResponse{Tracks: make([]*grownv1.Track, 0, len(list))}
	for _, t := range list {
		resp.Tracks = append(resp.Tracks, trackToProtoLiked(t, true))
	}
	return resp, nil
}
