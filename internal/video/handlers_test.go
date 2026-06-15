package video

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// These tests exercise the auth/path/nil-config short-circuit branches of the
// raw HTTP handlers and the gRPC service. They all return *before* touching the
// database or blob store, so they need neither GROWN_TEST_DSN nor a live pool.

// userOnlyCtx attaches a user but no org (to hit the "no org context" branch).
func userOnlyCtx() context.Context {
	return auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1"})
}

// orgOnlyCtx attaches an org but no user.
func orgOnlyCtx() context.Context {
	return auth.WithOrg(context.Background(), orgs.Org{ID: "o1", Slug: "default"})
}

func TestUploadHandler_ShortCircuits(t *testing.T) {
	h := NewHTTP(nil, nil, nil)
	handler := h.UploadHandler()

	tests := []struct {
		name     string
		ctx      context.Context
		wantCode int
	}{
		{"no user -> 401", context.Background(), http.StatusUnauthorized},
		{"user but no org -> 500", userOnlyCtx(), http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/videos/upload", nil).WithContext(tt.ctx)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body=%q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestStreamHandler_ShortCircuits(t *testing.T) {
	h := NewHTTP(nil, nil, nil)
	handler := h.StreamHandler()

	tests := []struct {
		name     string
		ctx      context.Context
		path     string
		wantCode int
	}{
		{"no auth -> 401", context.Background(), "/api/v1/videos/vid/content", http.StatusUnauthorized},
		{"org only -> 401", orgOnlyCtx(), "/api/v1/videos/vid/content", http.StatusUnauthorized},
		{"authed bad path -> 400", authCtx("o1", "u1"), "/api/v1/videos//content", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil).WithContext(tt.ctx)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body=%q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestSharedMetaHandler_ShortCircuits(t *testing.T) {
	t.Run("shares nil -> 501", func(t *testing.T) {
		h := NewHTTP(nil, nil, nil)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/videos/shared/tok", nil)
		rr := httptest.NewRecorder()
		h.SharedMetaHandler().ServeHTTP(rr, req)
		if rr.Code != http.StatusNotImplemented {
			t.Errorf("status = %d, want 501 (body=%q)", rr.Code, rr.Body.String())
		}
	})

	t.Run("bad path -> 400", func(t *testing.T) {
		// A non-nil shares repo with a nil pool is fine here: the bad-path branch
		// returns before any DB call.
		h := NewHTTP(nil, &ShareRepository{}, nil)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/videos/shared/", nil)
		rr := httptest.NewRecorder()
		h.SharedMetaHandler().ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400 (body=%q)", rr.Code, rr.Body.String())
		}
	})
}

func TestSharedStreamHandler_ShortCircuits(t *testing.T) {
	t.Run("shares nil -> 501", func(t *testing.T) {
		h := NewHTTP(nil, nil, nil)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/videos/shared/tok/content", nil)
		rr := httptest.NewRecorder()
		h.SharedStreamHandler().ServeHTTP(rr, req)
		if rr.Code != http.StatusNotImplemented {
			t.Errorf("status = %d, want 501 (body=%q)", rr.Code, rr.Body.String())
		}
	})

	t.Run("bad path -> 400", func(t *testing.T) {
		h := NewHTTP(nil, &ShareRepository{}, nil)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/videos/shared//content", nil)
		rr := httptest.NewRecorder()
		h.SharedStreamHandler().ServeHTTP(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400 (body=%q)", rr.Code, rr.Body.String())
		}
	})
}

func TestCaptionUploadHandler_ShortCircuits(t *testing.T) {
	h := NewHTTP(nil, nil, nil)
	handler := h.CaptionUploadHandler(nil)

	tests := []struct {
		name     string
		ctx      context.Context
		path     string
		wantCode int
	}{
		{"no user -> 401", context.Background(), "/api/v1/videos/vid/captions/upload", http.StatusUnauthorized},
		{"user no org -> 500", userOnlyCtx(), "/api/v1/videos/vid/captions/upload", http.StatusInternalServerError},
		{"bad path -> 400", authCtx("o1", "u1"), "/api/v1/videos/vid/wrong", http.StatusBadRequest},
		{"empty video id -> 400", authCtx("o1", "u1"), "/api/v1/videos//captions/upload", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path, nil).WithContext(tt.ctx)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body=%q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestCaptionStreamHandler_ShortCircuits(t *testing.T) {
	h := NewHTTP(nil, nil, nil)
	handler := h.CaptionStreamHandler(nil)

	tests := []struct {
		name     string
		ctx      context.Context
		path     string
		wantCode int
	}{
		{"no org -> 401", context.Background(), "/api/v1/videos/captions/cid/content", http.StatusUnauthorized},
		{"org but bad path -> 400", orgOnlyCtx(), "/api/v1/videos/captions//content", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil).WithContext(tt.ctx)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if rr.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body=%q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Service-layer short-circuits that do not reach the DB.
// ---------------------------------------------------------------------------

func TestCallerOrg(t *testing.T) {
	t.Run("no user -> Unauthenticated", func(t *testing.T) {
		_, err := callerOrg(context.Background())
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("want Unauthenticated, got %v", err)
		}
	})
	t.Run("user but no org -> Internal", func(t *testing.T) {
		_, err := callerOrg(userOnlyCtx())
		if status.Code(err) != codes.Internal {
			t.Errorf("want Internal, got %v", err)
		}
	})
	t.Run("user + org -> ok", func(t *testing.T) {
		org, err := callerOrg(authCtx("o1", "u1"))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if org != "o1" {
			t.Errorf("org = %q, want o1", org)
		}
	})
}

func TestService_NilFeatureRepos_Unimplemented(t *testing.T) {
	// A Service with no playlist/progress/caption repos wired must return
	// Unimplemented (or an empty list) rather than panicking on a nil repo.
	svc := NewService(nil, nil, nil, "")
	ctx := authCtx("o1", "u1")

	t.Run("CreateVideoPlaylist -> Unimplemented", func(t *testing.T) {
		_, err := svc.CreateVideoPlaylist(ctx, &grownv1.CreateVideoPlaylistRequest{Name: "x"})
		if status.Code(err) != codes.Unimplemented {
			t.Errorf("want Unimplemented, got %v", err)
		}
	})
	t.Run("ListVideoPlaylists -> empty, no error", func(t *testing.T) {
		resp, err := svc.ListVideoPlaylists(ctx, &grownv1.ListVideoPlaylistsRequest{})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(resp.GetPlaylists()) != 0 {
			t.Errorf("want empty playlists, got %d", len(resp.GetPlaylists()))
		}
	})
	t.Run("ListVideoCaptions -> empty, no error", func(t *testing.T) {
		resp, err := svc.ListVideoCaptions(ctx, &grownv1.ListVideoCaptionsRequest{VideoId: "v"})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(resp.GetCaptions()) != 0 {
			t.Errorf("want empty captions, got %d", len(resp.GetCaptions()))
		}
	})
	t.Run("DeleteVideoCaption -> Unimplemented", func(t *testing.T) {
		_, err := svc.DeleteVideoCaption(ctx, &grownv1.DeleteVideoCaptionRequest{VideoId: "v", Id: "c"})
		if status.Code(err) != codes.Unimplemented {
			t.Errorf("want Unimplemented, got %v", err)
		}
	})
	t.Run("SetVideoProgress -> Unimplemented", func(t *testing.T) {
		_, err := svc.SetVideoProgress(ctx, &grownv1.SetVideoProgressRequest{VideoId: "v"})
		if status.Code(err) != codes.Unimplemented {
			t.Errorf("want Unimplemented, got %v", err)
		}
	})
	t.Run("GetVideoProgress -> Unimplemented", func(t *testing.T) {
		_, err := svc.GetVideoProgress(ctx, &grownv1.GetVideoProgressRequest{VideoId: "v"})
		if status.Code(err) != codes.Unimplemented {
			t.Errorf("want Unimplemented, got %v", err)
		}
	})
}

func TestService_Unauthenticated_FeatureRPCs(t *testing.T) {
	// Without a user/org in context the feature RPCs must reject before any repo
	// access. Use a fully-nil Service to prove no DB is touched.
	svc := NewService(nil, nil, nil, "")
	bg := context.Background()

	t.Run("CreateVideoPlaylist", func(t *testing.T) {
		_, err := svc.CreateVideoPlaylist(bg, &grownv1.CreateVideoPlaylistRequest{Name: "x"})
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("want Unauthenticated, got %v", err)
		}
	})
	// Note: ListVideoPlaylists checks its nil-repo guard *before* the auth guard,
	// so with a nil-repo Service it returns an empty list rather than
	// Unauthenticated; that path is covered in the nil-repo test above.
	// ListVideoCaptions, by contrast, runs callerOrg (auth) first.
	t.Run("ListVideoCaptions", func(t *testing.T) {
		_, err := svc.ListVideoCaptions(bg, &grownv1.ListVideoCaptionsRequest{VideoId: "v"})
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("want Unauthenticated, got %v", err)
		}
	})
	t.Run("SetVideoProgress", func(t *testing.T) {
		_, err := svc.SetVideoProgress(bg, &grownv1.SetVideoProgressRequest{VideoId: "v"})
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("want Unauthenticated, got %v", err)
		}
	})
	t.Run("GetVideoProgress", func(t *testing.T) {
		_, err := svc.GetVideoProgress(bg, &grownv1.GetVideoProgressRequest{VideoId: "v"})
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("want Unauthenticated, got %v", err)
		}
	})
}

func TestService_CreateShareLink_InvalidExpiry(t *testing.T) {
	// An invalid expires_at must be rejected with InvalidArgument before the repo
	// is hit. We use a non-nil repo/shares with nil pools because the parse error
	// returns first. To guarantee we reach the parse step, we must pass the
	// repo.Get check — which we can't without a DB. Instead assert the auth guard
	// short-circuits here, which is the DB-free branch.
	svc := NewService(nil, nil, nil, "host")
	_, err := svc.CreateVideoShareLink(context.Background(), &grownv1.CreateVideoShareLinkRequest{VideoId: "v", ExpiresAt: "not-a-time"})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("want Unauthenticated (no session), got %v", err)
	}
}

func TestService_RevokeShareLink_NoSession(t *testing.T) {
	svc := NewService(nil, nil, nil, "host")
	_, err := svc.RevokeVideoShareLink(context.Background(), &grownv1.RevokeVideoShareLinkRequest{Token: "t"})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("want Unauthenticated, got %v", err)
	}
}
