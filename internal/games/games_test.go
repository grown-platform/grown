package games

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func TestIsHTML(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		filename    string
		want        bool
	}{
		{"text/html content type", "text/html", "whatever", true},
		{"text/html with charset", "text/html; charset=utf-8", "x", true},
		{"uppercase content type", "TEXT/HTML", "x", true},
		{".html extension", "", "game.html", true},
		{".htm extension", "", "game.htm", true},
		{"uppercase .HTML extension", "", "GAME.HTML", true},
		{"content type wins over extension", "text/html", "game.txt", true},
		{"plain text non-html", "text/plain", "game.txt", false},
		{"image", "image/png", "logo.png", false},
		{"empty everything", "", "", false},
		{"js file", "application/javascript", "app.js", false},
		{"htmlish but not suffix", "", "html-notes.txt", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isHTML(tc.contentType, tc.filename); got != tc.want {
				t.Errorf("isHTML(%q, %q) = %v, want %v", tc.contentType, tc.filename, got, tc.want)
			}
		})
	}
}

func TestGameID(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"valid", "/api/v1/games/abc123/content", "abc123", true},
		{"valid uuid", "/api/v1/games/550e8400-e29b-41d4-a716-446655440000/content", "550e8400-e29b-41d4-a716-446655440000", true},
		{"missing prefix", "/games/abc/content", "", false},
		{"missing suffix", "/api/v1/games/abc", "", false},
		{"wrong suffix", "/api/v1/games/abc/raw", "", false},
		{"empty id", "/api/v1/games//content", "", false},
		{"id with slash (path traversal)", "/api/v1/games/a/b/content", "", false},
		{"just prefix+suffix", "/api/v1/games//content", "", false},
		{"unrelated path", "/healthz", "", false},
		{"empty path", "", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := GameID(tc.path)
			if ok != tc.wantOK || id != tc.wantID {
				t.Errorf("GameID(%q) = (%q, %v), want (%q, %v)", tc.path, id, ok, tc.wantID, tc.wantOK)
			}
		})
	}
}

func TestRandKey(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		k := randKey()
		if !strings.HasPrefix(k, "games/") {
			t.Fatalf("randKey() = %q, want games/ prefix", k)
		}
		// 16 bytes hex-encoded = 32 chars after the prefix.
		if hexPart := strings.TrimPrefix(k, "games/"); len(hexPart) != 32 {
			t.Fatalf("randKey() hex part = %q (%d chars), want 32", hexPart, len(hexPart))
		}
		if seen[k] {
			t.Fatalf("randKey() produced a duplicate: %q", k)
		}
		seen[k] = true
	}
}

// --- HTTP handler tests (error paths that don't reach the DB) ---

func ctxWithUserOrg() context.Context {
	ctx := context.Background()
	ctx = auth.WithUser(ctx, users.User{ID: "user-1"})
	ctx = auth.WithOrg(ctx, orgs.Org{ID: "org-1"})
	return ctx
}

func TestUploadHandler_Unauthorized(t *testing.T) {
	tests := []struct {
		name     string
		ctx      context.Context
		wantCode int
	}{
		{"no user", context.Background(), http.StatusUnauthorized},
		{"user but no org", auth.WithUser(context.Background(), users.User{ID: "u"}), http.StatusInternalServerError},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := New(nil, nil)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/games", nil).WithContext(tc.ctx)
			rr := httptest.NewRecorder()
			g.UploadHandler().ServeHTTP(rr, req)
			if rr.Code != tc.wantCode {
				t.Errorf("got %d, want %d (body=%q)", rr.Code, tc.wantCode, rr.Body.String())
			}
		})
	}
}

// multipartBody builds a multipart form body with one "file" field.
func multipartBody(t *testing.T, fieldName, filename, contentType, content string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{`form-data; name="` + fieldName + `"; filename="` + filename + `"`}
	if contentType != "" {
		h["Content-Type"] = []string{contentType}
	}
	pw, err := mw.CreatePart(h)
	if err != nil {
		t.Fatalf("CreatePart: %v", err)
	}
	if _, err := io.WriteString(pw, content); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, mw.FormDataContentType()
}

func TestUploadHandler_BadMultipart(t *testing.T) {
	g := New(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/games",
		strings.NewReader("not a multipart body")).WithContext(ctxWithUserOrg())
	req.Header.Set("Content-Type", "multipart/form-data; boundary=nope")
	rr := httptest.NewRecorder()
	g.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestUploadHandler_NoFileField(t *testing.T) {
	// A valid multipart form with a non-"file" field => "no file".
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("other", "value")
	_ = mw.Close()

	g := New(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/games", &buf).WithContext(ctxWithUserOrg())
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rr := httptest.NewRecorder()
	g.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d (body=%q)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
}

func TestUploadHandler_NonHTMLRejected(t *testing.T) {
	body, ct := multipartBody(t, "file", "evil.exe", "application/octet-stream", "MZ binary")
	g := New(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/games", body).WithContext(ctxWithUserOrg())
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	g.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d (body=%q)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "self-contained HTML") {
		t.Errorf("expected HTML-only message, got %q", rr.Body.String())
	}
}

func TestUploadHandler_HTMLStoredInBlob(t *testing.T) {
	// HTML passes the content-type gate and reaches the blob store. We make the
	// blob store fail so the handler returns before touching the (nil) repo,
	// which both exercises the Put call and proves an HTML upload is accepted.
	fb := &fakeBlobs{putErr: errFakeBlob}
	g := New(nil, fb)
	body, ct := multipartBody(t, "file", "game.html", "text/html", "<html><body>hi</body></html>")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/games", body).WithContext(ctxWithUserOrg())
	req.Header.Set("Content-Type", ct)
	rr := httptest.NewRecorder()
	g.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want %d (body=%q)", rr.Code, http.StatusInternalServerError, rr.Body.String())
	}
	if !fb.putCalled {
		t.Error("expected blob Put to be called for an accepted HTML upload")
	}
	if fb.putMIME != "text/html; charset=utf-8" {
		t.Errorf("blob stored with MIME %q, want text/html; charset=utf-8", fb.putMIME)
	}
	if !strings.HasPrefix(fb.putKey, "games/") {
		t.Errorf("blob key %q does not start with games/", fb.putKey)
	}
}

func TestListHandler_Unauthorized(t *testing.T) {
	g := New(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/games", nil) // no org in ctx
	rr := httptest.NewRecorder()
	g.ListHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("got %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestContentHandler_Unauthorized(t *testing.T) {
	g := New(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/games/abc/content", nil)
	rr := httptest.NewRecorder()
	g.ContentHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("got %d, want %d", rr.Code, http.StatusUnauthorized)
	}
}

func TestContentHandler_BadPath(t *testing.T) {
	g := New(nil, nil)
	// Authorized, but the path doesn't parse into a game id.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/games/a/b/content", nil).WithContext(ctxWithUserOrg())
	rr := httptest.NewRecorder()
	g.ContentHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("got %d, want %d", rr.Code, http.StatusBadRequest)
	}
}

// TestGameJSONShape pins the public JSON view: GameMeta encodes only the
// embedded Game fields (org/owner/blob key must never leak to clients).
func TestGameJSONShape(t *testing.T) {
	m := GameMeta{
		Game:    Game{ID: "g1", Name: "Pong", ContentType: "text/html; charset=utf-8", Size: 42},
		OrgID:   "org-secret",
		OwnerID: "owner-secret",
		BlobKey: "games/deadbeef",
	}
	b, err := json.Marshal(m.Game)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(b)
	for _, leaked := range []string{"org-secret", "owner-secret", "deadbeef", "BlobKey", "OrgID"} {
		if strings.Contains(s, leaked) {
			t.Errorf("public game JSON leaked %q: %s", leaked, s)
		}
	}
	for _, want := range []string{`"id":"g1"`, `"name":"Pong"`, `"size":42`} {
		if !strings.Contains(s, want) {
			t.Errorf("public game JSON missing %q: %s", want, s)
		}
	}
}
