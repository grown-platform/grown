package books

// service_logic_test.go — unit tests for the pure proto-mapping helpers and
// the auth short-circuits (Unauthenticated / missing org) of Service methods.
// These exercise the gRPC error codes without any database access, so they run
// without GROWN_TEST_DSN. A nil repo is safe here because every case returns
// before the repo is touched.

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

var fixedTime = time.Date(2026, 6, 11, 13, 30, 0, 0, time.UTC)

func TestToProto(t *testing.T) {
	cover := "books/cover/k"
	b := Book{
		ID: "id1", OrgID: "org1", OwnerID: "owner1",
		Title: "T", Author: "A", Format: "epub", Description: "D",
		FileName: "f.epub", ContentType: "application/epub+zip", SizeBytes: 99,
		CoverKey: &cover, Starred: true, Finished: true,
		LastLocation: "loc", ProgressPercent: 80,
		CreatedAt: fixedTime, UpdatedAt: fixedTime,
	}
	p := toProto(b)
	if p.Id != "id1" || p.Title != "T" || p.Author != "A" || p.Format != "epub" {
		t.Errorf("scalar fields wrong: %+v", p)
	}
	if !p.HasCover {
		t.Errorf("HasCover should be true when CoverKey set")
	}
	if p.SizeBytes != 99 || p.ProgressPercent != 80 || !p.Starred || !p.Finished {
		t.Errorf("numeric/bool fields wrong: %+v", p)
	}
	if p.CreatedAt != "2026-06-11T13:30:00Z" || p.UpdatedAt != "2026-06-11T13:30:00Z" {
		t.Errorf("timestamps not RFC3339 UTC: created=%q updated=%q", p.CreatedAt, p.UpdatedAt)
	}
}

func TestToProto_NoCover(t *testing.T) {
	if toProto(Book{Title: "x"}).HasCover {
		t.Errorf("HasCover should be false with nil CoverKey")
	}
	empty := ""
	if toProto(Book{CoverKey: &empty}).HasCover {
		t.Errorf("HasCover should be false with empty CoverKey")
	}
}

func TestToProto_TimestampConvertedToUTC(t *testing.T) {
	loc := time.FixedZone("EST", -5*3600)
	b := Book{CreatedAt: time.Date(2026, 1, 2, 8, 0, 0, 0, loc), UpdatedAt: fixedTime}
	if got := toProto(b).CreatedAt; got != "2026-01-02T13:00:00Z" {
		t.Errorf("expected UTC-normalized timestamp, got %q", got)
	}
}

func TestProgressToProto(t *testing.T) {
	p := progressToProto(ReadingProgress{UserID: "u", BookID: "b", Locator: "l", Percent: 25, UpdatedAt: fixedTime})
	if p.UserId != "u" || p.BookId != "b" || p.Locator != "l" || p.Percent != 25 {
		t.Errorf("progress mapping wrong: %+v", p)
	}
	if p.UpdatedAt != "2026-06-11T13:30:00Z" {
		t.Errorf("updated_at wrong: %q", p.UpdatedAt)
	}
}

func TestBookmarkToProto(t *testing.T) {
	p := bookmarkToProto(Bookmark{ID: "i", OrgID: "o", UserID: "u", BookID: "b", Locator: "l", Label: "lbl", CreatedAt: fixedTime})
	if p.Id != "i" || p.OrgId != "o" || p.UserId != "u" || p.BookId != "b" || p.Locator != "l" || p.Label != "lbl" {
		t.Errorf("bookmark mapping wrong: %+v", p)
	}
	if p.CreatedAt != "2026-06-11T13:30:00Z" {
		t.Errorf("created_at wrong: %q", p.CreatedAt)
	}
}

func TestHighlightToProto(t *testing.T) {
	p := highlightToProto(Highlight{
		ID: "i", OrgID: "o", UserID: "u", BookID: "b",
		Locator: "l", SelectedText: "sel", Note: "n", Color: "green", CreatedAt: fixedTime,
	})
	if p.Id != "i" || p.SelectedText != "sel" || p.Note != "n" || p.Color != "green" {
		t.Errorf("highlight mapping wrong: %+v", p)
	}
}

func TestShelfToProto(t *testing.T) {
	p := shelfToProto(Shelf{ID: "i", OrgID: "o", OwnerUserID: "u", Name: "Fav", CreatedAt: fixedTime})
	if p.Id != "i" || p.OrgId != "o" || p.OwnerUserId != "u" || p.Name != "Fav" {
		t.Errorf("shelf mapping wrong: %+v", p)
	}
}

// --- callerOrg / callerUser context extraction --------------------------

func userOnlyCtx() context.Context {
	// User present but no org => Internal "missing org context".
	return auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1"})
}

func orgOnlyCtx() context.Context {
	// Org present but no user => Unauthenticated.
	return auth.WithOrg(context.Background(), orgs.Org{ID: "o1", Slug: "default"})
}

func TestCallerOrg(t *testing.T) {
	if _, err := callerOrg(context.Background()); status.Code(err) != codes.Unauthenticated {
		t.Errorf("no session: want Unauthenticated, got %v", err)
	}
	if _, err := callerOrg(userOnlyCtx()); status.Code(err) != codes.Internal {
		t.Errorf("missing org: want Internal, got %v", err)
	}
	id, err := callerOrg(authCtx("o1", "u1"))
	if err != nil || id != "o1" {
		t.Errorf("happy path: got (%q,%v)", id, err)
	}
}

func TestCallerUser(t *testing.T) {
	if _, _, err := callerUser(context.Background()); status.Code(err) != codes.Unauthenticated {
		t.Errorf("no session: want Unauthenticated, got %v", err)
	}
	if _, _, err := callerUser(userOnlyCtx()); status.Code(err) != codes.Internal {
		t.Errorf("missing org: want Internal, got %v", err)
	}
	org, user, err := callerUser(authCtx("o1", "u1"))
	if err != nil || org != "o1" || user != "u1" {
		t.Errorf("happy path: got (%q,%q,%v)", org, user, err)
	}
}

// --- Service method auth short-circuits (nil repo never reached) ---------

func TestService_AuthShortCircuits(t *testing.T) {
	s := NewService(nil)
	noSess := context.Background()
	noOrg := userOnlyCtx()

	type call func(ctx context.Context) error
	// callerOrg-based methods (need only a session+org).
	orgCalls := map[string]call{
		"ListBooks":          func(c context.Context) error { _, e := s.ListBooks(c, &grownv1.ListBooksRequest{}); return e },
		"GetBook":            func(c context.Context) error { _, e := s.GetBook(c, &grownv1.GetBookRequest{Id: "x"}); return e },
		"UpdateBook":         func(c context.Context) error { _, e := s.UpdateBook(c, &grownv1.UpdateBookRequest{Id: "x", Title: "t"}); return e },
		"UpdateBookProgress": func(c context.Context) error { _, e := s.UpdateBookProgress(c, &grownv1.UpdateBookProgressRequest{Id: "x"}); return e },
		"DeleteBook":         func(c context.Context) error { _, e := s.DeleteBook(c, &grownv1.DeleteBookRequest{Id: "x"}); return e },
	}
	// callerUser-based methods.
	userCalls := map[string]call{
		"SetProgress":     func(c context.Context) error { _, e := s.SetProgress(c, &grownv1.SetProgressRequest{BookId: "x"}); return e },
		"GetProgress":     func(c context.Context) error { _, e := s.GetProgress(c, &grownv1.GetProgressRequest{BookId: "x"}); return e },
		"AddBookmark":     func(c context.Context) error { _, e := s.AddBookmark(c, &grownv1.AddBookmarkRequest{BookId: "x"}); return e },
		"ListBookmarks":   func(c context.Context) error { _, e := s.ListBookmarks(c, &grownv1.ListBookmarksRequest{BookId: "x"}); return e },
		"DeleteBookmark":  func(c context.Context) error { _, e := s.DeleteBookmark(c, &grownv1.DeleteBookmarkRequest{Id: "x"}); return e },
		"AddHighlight":    func(c context.Context) error { _, e := s.AddHighlight(c, &grownv1.AddHighlightRequest{BookId: "x"}); return e },
		"ListHighlights":  func(c context.Context) error { _, e := s.ListHighlights(c, &grownv1.ListHighlightsRequest{BookId: "x"}); return e },
		"DeleteHighlight": func(c context.Context) error { _, e := s.DeleteHighlight(c, &grownv1.DeleteHighlightRequest{Id: "x"}); return e },
		"CreateShelf":     func(c context.Context) error { _, e := s.CreateShelf(c, &grownv1.CreateShelfRequest{Name: "n"}); return e },
		"ListShelves":     func(c context.Context) error { _, e := s.ListShelves(c, &grownv1.ListShelvesRequest{}); return e },
		"DeleteShelf":     func(c context.Context) error { _, e := s.DeleteShelf(c, &grownv1.DeleteShelfRequest{Id: "x"}); return e },
		"AddToShelf":      func(c context.Context) error { _, e := s.AddToShelf(c, &grownv1.AddToShelfRequest{ShelfId: "s", BookId: "x"}); return e },
		"RemoveFromShelf": func(c context.Context) error { _, e := s.RemoveFromShelf(c, &grownv1.RemoveFromShelfRequest{ShelfId: "s", BookId: "x"}); return e },
	}

	for name, fn := range orgCalls {
		t.Run(name+"/no-session", func(t *testing.T) {
			if got := status.Code(fn(noSess)); got != codes.Unauthenticated {
				t.Errorf("want Unauthenticated, got %v", got)
			}
		})
		t.Run(name+"/missing-org", func(t *testing.T) {
			if got := status.Code(fn(noOrg)); got != codes.Internal {
				t.Errorf("want Internal, got %v", got)
			}
		})
	}
	for name, fn := range userCalls {
		t.Run(name+"/no-session", func(t *testing.T) {
			if got := status.Code(fn(noSess)); got != codes.Unauthenticated {
				t.Errorf("want Unauthenticated, got %v", got)
			}
		})
		t.Run(name+"/missing-org", func(t *testing.T) {
			if got := status.Code(fn(noOrg)); got != codes.Internal {
				t.Errorf("want Internal, got %v", got)
			}
		})
	}
}

// CreateBook has its own auth path (UserFromContext / OrgFromContext) plus
// validation that runs before the repo is touched.
func TestCreateBook_AuthAndValidation(t *testing.T) {
	s := NewService(nil)

	if _, err := s.CreateBook(context.Background(), &grownv1.CreateBookRequest{Title: "t", Format: "pdf"}); status.Code(err) != codes.Unauthenticated {
		t.Errorf("no session: want Unauthenticated, got %v", err)
	}
	if _, err := s.CreateBook(userOnlyCtx(), &grownv1.CreateBookRequest{Title: "t", Format: "pdf"}); status.Code(err) != codes.Internal {
		t.Errorf("missing org: want Internal, got %v", err)
	}

	ctx := authCtx("o1", "u1")
	// Unsupported format => InvalidArgument (before repo).
	if _, err := s.CreateBook(ctx, &grownv1.CreateBookRequest{Title: "t", Format: "doc"}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("bad format: want InvalidArgument, got %v", err)
	}
	// Empty title => InvalidArgument (before repo).
	if _, err := s.CreateBook(ctx, &grownv1.CreateBookRequest{Title: "   ", Format: "pdf"}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("empty title: want InvalidArgument, got %v", err)
	}
}

// CreateShelf and UpdateBook validate before the repo runs.
func TestValidation_BeforeRepo(t *testing.T) {
	s := NewService(nil)
	ctx := authCtx("o1", "u1")

	if _, err := s.CreateShelf(ctx, &grownv1.CreateShelfRequest{Name: "  "}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("empty shelf name: want InvalidArgument, got %v", err)
	}
	if _, err := s.UpdateBook(ctx, &grownv1.UpdateBookRequest{Id: "x", Title: ""}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("empty update title: want InvalidArgument, got %v", err)
	}
}
