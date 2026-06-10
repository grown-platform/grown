package sites

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.SitesServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// callerOrg requires an authenticated user and returns their org id.
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

// orgOnly returns the org id without requiring an authenticated user. The
// auth middleware always attaches the org to the request context, so this
// works for anonymous callers hitting the public published-site endpoint.
func orgOnly(ctx context.Context) (string, error) {
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, nil
}

func toProto(s Site) *grownv1.Site {
	return &grownv1.Site{
		Id:          s.ID,
		OrgId:       s.OrgID,
		OwnerId:     s.OwnerID,
		Name:        s.Name,
		ContentJson: s.ContentJSON,
		Published:   s.Published,
		CreatedAt:   s.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   s.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListSites(ctx context.Context, _ *grownv1.ListSitesRequest) (*grownv1.ListSitesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.List(ctx, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list sites: %v", err)
	}
	resp := &grownv1.ListSitesResponse{Sites: make([]*grownv1.Site, 0, len(list))}
	for _, site := range list {
		resp.Sites = append(resp.Sites, toProto(site))
	}
	return resp, nil
}

func (s *Service) CreateSite(ctx context.Context, req *grownv1.CreateSiteRequest) (*grownv1.Site, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	site, err := s.repo.Create(ctx, o.ID, u.ID, Fields{
		Name:        req.GetName(),
		ContentJSON: req.GetContentJson(),
		Published:   false,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create site: %v", err)
	}
	return toProto(site), nil
}

func (s *Service) GetSite(ctx context.Context, req *grownv1.GetSiteRequest) (*grownv1.Site, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	site, err := s.repo.Get(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "site not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get site: %v", err)
	}
	return toProto(site), nil
}

func (s *Service) UpdateSite(ctx context.Context, req *grownv1.UpdateSiteRequest) (*grownv1.Site, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	site, err := s.repo.Update(ctx, orgID, req.GetId(), Fields{
		Name:        req.GetName(),
		ContentJSON: req.GetContentJson(),
		Published:   req.GetPublished(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "site not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update site: %v", err)
	}
	return toProto(site), nil
}

func (s *Service) DeleteSite(ctx context.Context, req *grownv1.DeleteSiteRequest) (*grownv1.DeleteSiteResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "site not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete site: %v", err)
	}
	return &grownv1.DeleteSiteResponse{}, nil
}

// GetPublishedSite serves the public view route. It does not require an
// authenticated user; it only returns sites flagged published.
func (s *Service) GetPublishedSite(ctx context.Context, req *grownv1.GetPublishedSiteRequest) (*grownv1.Site, error) {
	orgID, err := orgOnly(ctx)
	if err != nil {
		return nil, err
	}
	site, err := s.repo.GetPublished(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "site not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get published site: %v", err)
	}
	return toProto(site), nil
}
