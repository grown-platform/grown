package search

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.SearchServiceServer.
type Service struct {
	repo *Repository
}

// NewService constructs a Service backed by repo.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// Search performs a unified cross-app ILIKE search scoped to the caller's org.
func (s *Service) Search(ctx context.Context, req *grownv1.SearchRequest) (*grownv1.SearchResponse, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	org, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}

	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return &grownv1.SearchResponse{}, nil
	}

	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	// Each source type gets at most limit/8 rows (at least 5).
	perType := limit / 8
	if perType < 5 {
		perType = 5
	}

	results, err := s.repo.Search(ctx, org.ID, u.ID, query, perType)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "search: %v", err)
	}

	// Group results by type, preserving stable type order from the repository.
	typeOrder := []string{"drive", "docs", "sheets", "slides", "contacts", "keep", "calendar", "mail"}
	buckets := make(map[string][]*grownv1.SearchResult, len(typeOrder))
	for _, r := range results {
		buckets[r.Type] = append(buckets[r.Type], &grownv1.SearchResult{
			Type:    typeToProto(r.Type),
			Id:      r.ID,
			Title:   r.Title,
			Snippet: r.Snippet,
			Url:     r.URL,
		})
	}

	var groups []*grownv1.SearchGroup
	total := int32(0)
	for _, typ := range typeOrder {
		items := buckets[typ]
		if len(items) == 0 {
			continue
		}
		groups = append(groups, &grownv1.SearchGroup{
			Type:    typeToProto(typ),
			Results: items,
		})
		total += int32(len(items))
	}

	return &grownv1.SearchResponse{
		Groups:     groups,
		TotalCount: total,
	}, nil
}

func typeToProto(t string) grownv1.SearchResultType {
	switch t {
	case "drive":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_DRIVE
	case "docs":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_DOCS
	case "sheets":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_SHEETS
	case "slides":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_SLIDES
	case "contacts":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_CONTACTS
	case "keep":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_KEEP
	case "calendar":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_CALENDAR
	case "mail":
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_MAIL
	default:
		return grownv1.SearchResultType_SEARCH_RESULT_TYPE_UNSPECIFIED
	}
}
