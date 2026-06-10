package photos

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.PhotosServiceServer over a Repository.
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

func contentURL(id string) string { return "/api/v1/photos/" + id + "/content" }

func photoToProto(p Photo) *grownv1.Photo {
	return &grownv1.Photo{
		Id:          p.ID,
		OrgId:       p.OrgID,
		OwnerId:     p.OwnerID,
		Filename:    p.Filename,
		ContentType: p.ContentType,
		Size:        p.Size,
		Width:       p.Width,
		Height:      p.Height,
		Description: p.Description,
		Favorite:    p.Favorite,
		ContentUrl:  contentURL(p.ID),
		CreatedAt:   p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func albumToProto(a Album) *grownv1.Album {
	out := &grownv1.Album{
		Id:           a.ID,
		OrgId:        a.OrgID,
		OwnerId:      a.OwnerID,
		Title:        a.Title,
		CoverPhotoId: a.CoverPhotoID,
		PhotoCount:   a.PhotoCount,
		CreatedAt:    a.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:    a.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if a.CoverPhotoID != "" {
		out.CoverUrl = contentURL(a.CoverPhotoID)
	}
	for _, p := range a.Photos {
		out.Photos = append(out.Photos, photoToProto(p))
	}
	return out
}

func (s *Service) ListPhotos(ctx context.Context, req *grownv1.ListPhotosRequest) (*grownv1.ListPhotosResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListPhotos(ctx, orgID, req.GetAlbumId(), req.GetFavorites())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list photos: %v", err)
	}
	resp := &grownv1.ListPhotosResponse{Photos: make([]*grownv1.Photo, 0, len(list))}
	for _, p := range list {
		resp.Photos = append(resp.Photos, photoToProto(p))
	}
	return resp, nil
}

func (s *Service) GetPhoto(ctx context.Context, req *grownv1.GetPhotoRequest) (*grownv1.Photo, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.GetPhoto(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "photo not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get photo: %v", err)
	}
	return photoToProto(p), nil
}

func (s *Service) UpdatePhoto(ctx context.Context, req *grownv1.UpdatePhotoRequest) (*grownv1.Photo, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.UpdatePhoto(ctx, orgID, req.GetId(), PhotoFields{
		Description: req.GetDescription(), Favorite: req.GetFavorite(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "photo not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update photo: %v", err)
	}
	return photoToProto(p), nil
}

func (s *Service) DeletePhoto(ctx context.Context, req *grownv1.DeletePhotoRequest) (*grownv1.DeletePhotoResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	_, err = s.repo.DeletePhoto(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "photo not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete photo: %v", err)
	}
	// Note: blob deletion is handled by the HTTP layer (which holds the blob
	// store). The metadata soft-delete above is the authoritative removal for
	// listing; orphaned blobs are harmless and can be GC'd separately.
	return &grownv1.DeletePhotoResponse{}, nil
}

// --- Albums ---

func (s *Service) ListAlbums(ctx context.Context, _ *grownv1.ListAlbumsRequest) (*grownv1.ListAlbumsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListAlbums(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list albums: %v", err)
	}
	resp := &grownv1.ListAlbumsResponse{Albums: make([]*grownv1.Album, 0, len(list))}
	for _, a := range list {
		resp.Albums = append(resp.Albums, albumToProto(a))
	}
	return resp, nil
}

func (s *Service) GetAlbum(ctx context.Context, req *grownv1.GetAlbumRequest) (*grownv1.Album, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	a, err := s.repo.GetAlbum(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "album not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get album: %v", err)
	}
	photos, err := s.repo.ListPhotos(ctx, orgID, a.ID, false)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "album photos: %v", err)
	}
	a.Photos = photos
	return albumToProto(a), nil
}

func (s *Service) CreateAlbum(ctx context.Context, req *grownv1.CreateAlbumRequest) (*grownv1.Album, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	a, err := s.repo.CreateAlbum(ctx, o.ID, u.ID, req.GetTitle(), req.GetPhotoIds())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create album: %v", err)
	}
	return albumToProto(a), nil
}

func (s *Service) UpdateAlbum(ctx context.Context, req *grownv1.UpdateAlbumRequest) (*grownv1.Album, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	a, err := s.repo.UpdateAlbum(ctx, orgID, req.GetId(), req.GetTitle(), req.GetCoverPhotoId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "album not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update album: %v", err)
	}
	return albumToProto(a), nil
}

func (s *Service) DeleteAlbum(ctx context.Context, req *grownv1.DeleteAlbumRequest) (*grownv1.DeleteAlbumResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteAlbum(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "album not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete album: %v", err)
	}
	return &grownv1.DeleteAlbumResponse{}, nil
}

func (s *Service) AddToAlbum(ctx context.Context, req *grownv1.AddToAlbumRequest) (*grownv1.Album, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	a, err := s.repo.AddToAlbum(ctx, orgID, req.GetAlbumId(), req.GetPhotoIds())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "album not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add to album: %v", err)
	}
	return albumToProto(a), nil
}

func (s *Service) RemoveFromAlbum(ctx context.Context, req *grownv1.RemoveFromAlbumRequest) (*grownv1.Album, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	a, err := s.repo.RemoveFromAlbum(ctx, orgID, req.GetAlbumId(), req.GetPhotoId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "album not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "remove from album: %v", err)
	}
	return albumToProto(a), nil
}
