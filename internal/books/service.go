package books

import (
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.BooksServiceServer over a Repository.
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

func toProto(b Book) *grownv1.Book {
	return &grownv1.Book{
		Id:              b.ID,
		OrgId:           b.OrgID,
		OwnerId:         b.OwnerID,
		Title:           b.Title,
		Author:          b.Author,
		Format:          b.Format,
		Description:     b.Description,
		FileName:        b.FileName,
		ContentType:     b.ContentType,
		SizeBytes:       b.SizeBytes,
		HasCover:        b.HasCover(),
		Starred:         b.Starred,
		Finished:        b.Finished,
		LastLocation:    b.LastLocation,
		ProgressPercent: b.ProgressPercent,
		CreatedAt:       b.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       b.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListBooks(ctx context.Context, req *grownv1.ListBooksRequest) (*grownv1.ListBooksResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	var list []Book
	if req.GetShelfId() != "" {
		list, err = s.repo.ListByShelf(ctx, orgID, req.GetShelfId())
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "shelf not found")
		}
	} else {
		list, err = s.repo.List(ctx, orgID)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list books: %v", err)
	}
	resp := &grownv1.ListBooksResponse{Books: make([]*grownv1.Book, 0, len(list))}
	for _, b := range list {
		resp.Books = append(resp.Books, toProto(b))
	}
	return resp, nil
}

func (s *Service) GetBook(ctx context.Context, req *grownv1.GetBookRequest) (*grownv1.Book, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	b, err := s.repo.Get(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get book: %v", err)
	}
	return toProto(b), nil
}

func (s *Service) CreateBook(ctx context.Context, req *grownv1.CreateBookRequest) (*grownv1.Book, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	format := strings.ToLower(strings.TrimSpace(req.GetFormat()))
	if !FormatSupported(format) {
		return nil, status.Errorf(codes.InvalidArgument, "unsupported format %q (want one of %s)",
			req.GetFormat(), strings.Join(SupportedFormats, ", "))
	}
	if strings.TrimSpace(req.GetTitle()) == "" {
		return nil, status.Error(codes.InvalidArgument, "title is required")
	}
	b, err := s.repo.Create(ctx, o.ID, u.ID, Fields{
		Title:       strings.TrimSpace(req.GetTitle()),
		Author:      strings.TrimSpace(req.GetAuthor()),
		Format:      format,
		Description: req.GetDescription(),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create book: %v", err)
	}
	return toProto(b), nil
}

func (s *Service) UpdateBook(ctx context.Context, req *grownv1.UpdateBookRequest) (*grownv1.Book, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetTitle()) == "" {
		return nil, status.Error(codes.InvalidArgument, "title is required")
	}
	b, err := s.repo.Update(ctx, orgID, req.GetId(), Fields{
		Title:       strings.TrimSpace(req.GetTitle()),
		Author:      strings.TrimSpace(req.GetAuthor()),
		Description: req.GetDescription(),
		Starred:     req.GetStarred(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update book: %v", err)
	}
	return toProto(b), nil
}

func (s *Service) UpdateBookProgress(ctx context.Context, req *grownv1.UpdateBookProgressRequest) (*grownv1.Book, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	b, err := s.repo.UpdateProgress(ctx, orgID, req.GetId(), Progress{
		LastLocation:    req.GetLastLocation(),
		ProgressPercent: req.GetProgressPercent(),
		Finished:        req.GetFinished(),
	})
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update progress: %v", err)
	}
	return toProto(b), nil
}

func (s *Service) DeleteBook(ctx context.Context, req *grownv1.DeleteBookRequest) (*grownv1.DeleteBookResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	_, _, err = s.repo.Trash(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete book: %v", err)
	}
	return &grownv1.DeleteBookResponse{}, nil
}

// callerUser extracts both org and user from the context.
func callerUser(ctx context.Context) (orgID, userID string, err error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, u.ID, nil
}

// --- Progress ---

func progressToProto(p ReadingProgress) *grownv1.BookProgress {
	return &grownv1.BookProgress{
		UserId:    p.UserID,
		BookId:    p.BookID,
		Locator:   p.Locator,
		Percent:   p.Percent,
		UpdatedAt: p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) SetProgress(ctx context.Context, req *grownv1.SetProgressRequest) (*grownv1.BookProgress, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.SetProgress(ctx, orgID, userID, req.GetBookId(), req.GetLocator(), req.GetPercent())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "set progress: %v", err)
	}
	return progressToProto(p), nil
}

func (s *Service) GetProgress(ctx context.Context, req *grownv1.GetProgressRequest) (*grownv1.BookProgress, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.GetProgress(ctx, orgID, userID, req.GetBookId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get progress: %v", err)
	}
	return progressToProto(p), nil
}

// --- Bookmarks ---

func bookmarkToProto(bm Bookmark) *grownv1.Bookmark {
	return &grownv1.Bookmark{
		Id:        bm.ID,
		OrgId:     bm.OrgID,
		UserId:    bm.UserID,
		BookId:    bm.BookID,
		Locator:   bm.Locator,
		Label:     bm.Label,
		CreatedAt: bm.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) AddBookmark(ctx context.Context, req *grownv1.AddBookmarkRequest) (*grownv1.Bookmark, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	bm, err := s.repo.AddBookmark(ctx, orgID, userID, req.GetBookId(), req.GetLocator(), req.GetLabel())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add bookmark: %v", err)
	}
	return bookmarkToProto(bm), nil
}

func (s *Service) ListBookmarks(ctx context.Context, req *grownv1.ListBookmarksRequest) (*grownv1.ListBookmarksResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	bms, err := s.repo.ListBookmarks(ctx, orgID, userID, req.GetBookId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list bookmarks: %v", err)
	}
	resp := &grownv1.ListBookmarksResponse{Bookmarks: make([]*grownv1.Bookmark, 0, len(bms))}
	for _, bm := range bms {
		resp.Bookmarks = append(resp.Bookmarks, bookmarkToProto(bm))
	}
	return resp, nil
}

func (s *Service) DeleteBookmark(ctx context.Context, req *grownv1.DeleteBookmarkRequest) (*grownv1.DeleteBookmarkResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteBookmark(ctx, orgID, userID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "bookmark not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete bookmark: %v", err)
	}
	return &grownv1.DeleteBookmarkResponse{}, nil
}

// --- Highlights ---

func highlightToProto(h Highlight) *grownv1.Highlight {
	return &grownv1.Highlight{
		Id:           h.ID,
		OrgId:        h.OrgID,
		UserId:       h.UserID,
		BookId:       h.BookID,
		Locator:      h.Locator,
		SelectedText: h.SelectedText,
		Note:         h.Note,
		Color:        h.Color,
		CreatedAt:    h.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) AddHighlight(ctx context.Context, req *grownv1.AddHighlightRequest) (*grownv1.Highlight, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	h, err := s.repo.AddHighlight(ctx, orgID, userID, req.GetBookId(), req.GetLocator(), req.GetSelectedText(), req.GetNote(), req.GetColor())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add highlight: %v", err)
	}
	return highlightToProto(h), nil
}

func (s *Service) ListHighlights(ctx context.Context, req *grownv1.ListHighlightsRequest) (*grownv1.ListHighlightsResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	hs, err := s.repo.ListHighlights(ctx, orgID, userID, req.GetBookId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list highlights: %v", err)
	}
	resp := &grownv1.ListHighlightsResponse{Highlights: make([]*grownv1.Highlight, 0, len(hs))}
	for _, h := range hs {
		resp.Highlights = append(resp.Highlights, highlightToProto(h))
	}
	return resp, nil
}

func (s *Service) DeleteHighlight(ctx context.Context, req *grownv1.DeleteHighlightRequest) (*grownv1.DeleteHighlightResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteHighlight(ctx, orgID, userID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "highlight not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete highlight: %v", err)
	}
	return &grownv1.DeleteHighlightResponse{}, nil
}

// --- Shelves ---

func shelfToProto(s Shelf) *grownv1.Shelf {
	return &grownv1.Shelf{
		Id:          s.ID,
		OrgId:       s.OrgID,
		OwnerUserId: s.OwnerUserID,
		Name:        s.Name,
		CreatedAt:   s.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (s *Service) CreateShelf(ctx context.Context, req *grownv1.CreateShelfRequest) (*grownv1.Shelf, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.GetName())
	if name == "" {
		return nil, status.Error(codes.InvalidArgument, "shelf name is required")
	}
	sh, err := s.repo.CreateShelf(ctx, orgID, userID, name)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create shelf: %v", err)
	}
	return shelfToProto(sh), nil
}

func (s *Service) ListShelves(ctx context.Context, _ *grownv1.ListShelvesRequest) (*grownv1.ListShelvesResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	shelves, err := s.repo.ListShelves(ctx, orgID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list shelves: %v", err)
	}
	resp := &grownv1.ListShelvesResponse{Shelves: make([]*grownv1.Shelf, 0, len(shelves))}
	for _, sh := range shelves {
		resp.Shelves = append(resp.Shelves, shelfToProto(sh))
	}
	return resp, nil
}

func (s *Service) DeleteShelf(ctx context.Context, req *grownv1.DeleteShelfRequest) (*grownv1.DeleteShelfResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.DeleteShelf(ctx, orgID, userID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "shelf not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete shelf: %v", err)
	}
	return &grownv1.DeleteShelfResponse{}, nil
}

func (s *Service) AddToShelf(ctx context.Context, req *grownv1.AddToShelfRequest) (*grownv1.AddToShelfResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.AddToShelf(ctx, orgID, userID, req.GetShelfId(), req.GetBookId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "shelf or book not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add to shelf: %v", err)
	}
	return &grownv1.AddToShelfResponse{}, nil
}

func (s *Service) RemoveFromShelf(ctx context.Context, req *grownv1.RemoveFromShelfRequest) (*grownv1.RemoveFromShelfResponse, error) {
	orgID, userID, err := callerUser(ctx)
	if err != nil {
		return nil, err
	}
	err = s.repo.RemoveFromShelf(ctx, orgID, userID, req.GetShelfId(), req.GetBookId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "shelf item not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "remove from shelf: %v", err)
	}
	return &grownv1.RemoveFromShelfResponse{}, nil
}
