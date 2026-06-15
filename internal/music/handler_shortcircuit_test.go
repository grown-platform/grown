package music

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// newHTTP builds an HTTP handler set over a Repository with a nil pool. This is
// safe for tests that only exercise the auth / method / validation
// short-circuits, which all return BEFORE any repository (DB) call.
func newHTTP() *HTTP {
	return NewHTTP(NewRepository(nil), &fakeBlobs{})
}

func withUser(ctx context.Context) context.Context {
	return auth.WithUser(ctx, users.User{ID: "u1", OrgID: "o1"})
}

func withOrg(ctx context.Context) context.Context {
	return auth.WithOrg(ctx, orgs.Org{ID: "o1", Slug: "default", DisplayName: "Default"})
}

// serve runs req through h and returns the recorded response.
func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestUploadHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	tests := []struct {
		name     string
		ctx      func(context.Context) context.Context
		wantCode int
	}{
		{"no user", func(c context.Context) context.Context { return c }, http.StatusUnauthorized},
		{"user but no org", withUser, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/music/upload", nil)
			req = req.WithContext(tt.ctx(req.Context()))
			rr := serve(h.UploadHandler(), req)
			if rr.Code != tt.wantCode {
				t.Errorf("code = %d, want %d (body %q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestUploadHandler_BadMultipart(t *testing.T) {
	h := newHTTP()
	// Authenticated + org present, but the body is not a valid multipart form.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/music/upload", strings.NewReader("not-multipart"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=zzz")
	req = req.WithContext(withOrg(withUser(req.Context())))
	rr := serve(h.UploadHandler(), req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400 (body %q)", rr.Code, rr.Body.String())
	}
}

func TestStreamHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	tests := []struct {
		name     string
		path     string
		ctx      func(context.Context) context.Context
		wantCode int
	}{
		{"no org", "/api/v1/music/abc/content", func(c context.Context) context.Context { return c }, http.StatusUnauthorized},
		{"bad path", "/api/v1/music//content", withOrg, http.StatusBadRequest},
		{"bad path no suffix", "/api/v1/music/abc", withOrg, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			req = req.WithContext(tt.ctx(req.Context()))
			rr := serve(h.StreamHandler(), req)
			if rr.Code != tt.wantCode {
				t.Errorf("code = %d, want %d (body %q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestListStationsHandler_Unauthorized(t *testing.T) {
	h := newHTTP()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/music/radio", nil)
	rr := serve(h.ListStationsHandler(), req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", rr.Code)
	}
}

func TestCreateStationHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	tests := []struct {
		name     string
		body     string
		ctx      func(context.Context) context.Context
		wantCode int
	}{
		{"no org", `{}`, func(c context.Context) context.Context { return c }, http.StatusUnauthorized},
		{"bad json", `{not json`, withOrg, http.StatusBadRequest},
		{"missing name", `{"stream_url":"https://x/y"}`, withOrg, http.StatusBadRequest},
		{"missing stream", `{"name":"N"}`, withOrg, http.StatusBadRequest},
		{"non-http scheme", `{"name":"N","stream_url":"ftp://x/y"}`, withOrg, http.StatusBadRequest},
		{"relative url", `{"name":"N","stream_url":"/local/x"}`, withOrg, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/music/radio/stations", strings.NewReader(tt.body))
			req = req.WithContext(tt.ctx(req.Context()))
			rr := serve(h.CreateStationHandler(), req)
			if rr.Code != tt.wantCode {
				t.Errorf("code = %d, want %d (body %q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestPlayHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	tests := []struct {
		name     string
		path     string
		ctx      func(context.Context) context.Context
		wantCode int
	}{
		{"no user", "/api/v1/music/radio/s1/play", func(c context.Context) context.Context { return c }, http.StatusUnauthorized},
		{"user no org", "/api/v1/music/radio/s1/play", withUser, http.StatusInternalServerError},
		{"bad path", "/api/v1/music/radio/", func(c context.Context) context.Context { return withOrg(withUser(c)) }, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.path, nil)
			req = req.WithContext(tt.ctx(req.Context()))
			rr := serve(h.PlayHandler(), req)
			if rr.Code != tt.wantCode {
				t.Errorf("code = %d, want %d (body %q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestStopHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	// No user → unauthorized.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/music/radio/s1/stop", nil)
	if rr := serve(h.StopHandler(), req); rr.Code != http.StatusUnauthorized {
		t.Errorf("no user: code = %d, want 401", rr.Code)
	}
	// Authenticated but bad path → 400.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/music/radio/", nil)
	req = req.WithContext(withUser(req.Context()))
	if rr := serve(h.StopHandler(), req); rr.Code != http.StatusBadRequest {
		t.Errorf("bad path: code = %d, want 400", rr.Code)
	}
	// Authenticated, valid path, no radio controller attached → 204 (no-op).
	req = httptest.NewRequest(http.MethodPost, "/api/v1/music/radio/s1/stop", nil)
	req = req.WithContext(withUser(req.Context()))
	if rr := serve(h.StopHandler(), req); rr.Code != http.StatusNoContent {
		t.Errorf("valid stop: code = %d, want 204", rr.Code)
	}
}

func TestRetentionHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	tests := []struct {
		name     string
		method   string
		path     string
		body     string
		ctx      func(context.Context) context.Context
		wantCode int
	}{
		{"no org", http.MethodGet, "/api/v1/music/radio/s1/retention", "", func(c context.Context) context.Context { return c }, http.StatusUnauthorized},
		{"bad path", http.MethodGet, "/api/v1/music/radio/", "", withOrg, http.StatusBadRequest},
		{"unsupported method", http.MethodDelete, "/api/v1/music/radio/s1/retention", "", withOrg, http.StatusMethodNotAllowed},
		{"put bad body", http.MethodPut, "/api/v1/music/radio/s1/retention", `{not json`, withOrg, http.StatusBadRequest},
		{"put invalid mode", http.MethodPut, "/api/v1/music/radio/s1/retention", `{"retention_mode":"forever"}`, withOrg, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body *strings.Reader
			if tt.body != "" {
				body = strings.NewReader(tt.body)
			} else {
				body = strings.NewReader("")
			}
			req := httptest.NewRequest(tt.method, tt.path, body)
			req = req.WithContext(tt.ctx(req.Context()))
			rr := serve(h.RetentionHandler(), req)
			if rr.Code != tt.wantCode {
				t.Errorf("code = %d, want %d (body %q)", rr.Code, tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestStreamProxyHandler_ShortCircuits(t *testing.T) {
	h := newHTTP()
	// No org → unauthorized.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/music/radio/s1/stream", nil)
	if rr := serve(h.StreamProxyHandler(), req); rr.Code != http.StatusUnauthorized {
		t.Errorf("no org: code = %d, want 401", rr.Code)
	}
	// Authed but bad path → 400.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/music/radio/", nil)
	req = req.WithContext(withOrg(req.Context()))
	if rr := serve(h.StreamProxyHandler(), req); rr.Code != http.StatusBadRequest {
		t.Errorf("bad path: code = %d, want 400", rr.Code)
	}
}
