package chat

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

func TestChatAttachmentID(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"happy path", "/api/v1/chat/attachments/abc123/content", "abc123", true},
		{"uuid id", "/api/v1/chat/attachments/00000000-0000-0000-0000-000000000001/content", "00000000-0000-0000-0000-000000000001", true},
		{"missing prefix", "/api/v1/chat/abc123/content", "", false},
		{"missing suffix", "/api/v1/chat/attachments/abc123", "", false},
		{"empty id", "/api/v1/chat/attachments//content", "", false},
		{"id with slash (path traversal)", "/api/v1/chat/attachments/a/b/content", "", false},
		{"wrong base path", "/api/v1/mail/attachments/abc123/content", "", false},
		{"just suffix", "/content", "", false},
		{"empty", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := ChatAttachmentID(tt.path)
			if ok != tt.wantOK {
				t.Fatalf("ok: got %v want %v", ok, tt.wantOK)
			}
			if id != tt.wantID {
				t.Errorf("id: got %q want %q", id, tt.wantID)
			}
		})
	}
}

func TestAttachmentContentURL(t *testing.T) {
	got := attachmentContentURL("xyz")
	want := "/api/v1/chat/attachments/xyz/content"
	if got != want {
		t.Errorf("got %q want %q", got, want)
	}
	// Round-trips through the parser.
	id, ok := ChatAttachmentID(got)
	if !ok || id != "xyz" {
		t.Errorf("round-trip: id=%q ok=%v", id, ok)
	}
}

func TestRandChatKey(t *testing.T) {
	k1 := randChatKey()
	k2 := randChatKey()
	if !strings.HasPrefix(k1, "chat/att/") {
		t.Errorf("missing prefix: %q", k1)
	}
	// 16 random bytes -> 32 hex chars after the prefix.
	if got := len(strings.TrimPrefix(k1, "chat/att/")); got != 32 {
		t.Errorf("hex length: got %d want 32", got)
	}
	if k1 == k2 {
		t.Error("two keys collided; randomness suspect")
	}
}

func ctxWithOrgUser(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, Email: "u@test.me"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default"})
}

// UploadHandler must reject unauthenticated callers before touching the repo or
// blob store (both are nil here, so any further progress would panic).
func TestUploadHandler_Unauthorized(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/upload", nil)
	rr := httptest.NewRecorder()
	a.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// Authenticated but missing org context -> 500, still before repo/blob use.
func TestUploadHandler_NoOrgContext(t *testing.T) {
	a := NewAttachments(nil, nil)
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1"})
	req := httptest.NewRequest(http.MethodPost, "/upload", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	a.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusInternalServerError)
	}
}

// A non-multipart body should be rejected as a bad request after auth passes.
func TestUploadHandler_BadMultipart(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("not multipart")).
		WithContext(ctxWithOrgUser("org1", "u1"))
	req.Header.Set("Content-Type", "text/plain")
	rr := httptest.NewRecorder()
	a.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

// DownloadHandler must reject when there is no org context before repo use.
func TestDownloadHandler_Unauthorized(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/chat/attachments/abc/content", nil)
	rr := httptest.NewRecorder()
	a.DownloadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// With org context but a malformed path, the handler should 400 on the path
// parse before reaching the (nil) repo.
func TestDownloadHandler_BadPath(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/chat/attachments/a/b/content", nil).
		WithContext(ctxWithOrgUser("org1", "u1"))
	rr := httptest.NewRecorder()
	a.DownloadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}
