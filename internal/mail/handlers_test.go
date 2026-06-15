package mail

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func ctxWithUserOrg() context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1", Email: "tester@x.com", DisplayName: "Tester"})
	return auth.WithOrg(ctx, orgs.Org{ID: "o1", Slug: "default"})
}

func ctxWithOrgOnly() context.Context {
	return auth.WithOrg(context.Background(), orgs.Org{ID: "o1", Slug: "default"})
}

// fakeBackend implements Backend with canned responses. Only Get/Raw paths are
// exercised by handler tests here; the rest return zero values.
type fakeBackend struct {
	getMsg Message
	getErr error
}

func (f *fakeBackend) List(context.Context, Caller, string, string, string, bool) ([]Message, map[string]int32, error) {
	return nil, nil, nil
}
func (f *fakeBackend) ListThreads(context.Context, Caller, string, string, string, bool) ([]Thread, map[string]int32, error) {
	return nil, nil, nil
}
func (f *fakeBackend) GetThread(context.Context, Caller, string, string) ([]Message, error) {
	return nil, nil
}
func (f *fakeBackend) ListLabels(context.Context, Caller) ([]string, error) { return nil, nil }
func (f *fakeBackend) Get(context.Context, Caller, string) (Message, error) {
	return f.getMsg, f.getErr
}
func (f *fakeBackend) Send(context.Context, Caller, Compose) (Message, error) { return Message{}, nil }
func (f *fakeBackend) Modify(context.Context, Caller, string, Changes) (Message, error) {
	return Message{}, nil
}
func (f *fakeBackend) Delete(context.Context, Caller, string) error { return nil }

// ---- AttachmentID ----

func TestAttachmentID(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		wantID  string
		wantOK  bool
	}{
		{"valid", "/api/v1/mail/attachments/abc123/content", "abc123", true},
		{"missing prefix", "/wrong/abc/content", "", false},
		{"missing suffix", "/api/v1/mail/attachments/abc123", "", false},
		{"empty id", "/api/v1/mail/attachments//content", "", false},
		{"id with slash rejected", "/api/v1/mail/attachments/a/b/content", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := AttachmentID(tt.path)
			if id != tt.wantID || ok != tt.wantOK {
				t.Errorf("AttachmentID(%q) = (%q,%v), want (%q,%v)", tt.path, id, ok, tt.wantID, tt.wantOK)
			}
		})
	}
}

func TestRandKey(t *testing.T) {
	k1 := randKey()
	k2 := randKey()
	if !strings.HasPrefix(k1, "mail/att/") {
		t.Errorf("randKey prefix = %q", k1)
	}
	if k1 == k2 {
		t.Errorf("randKey returned identical keys: %q", k1)
	}
	// "mail/att/" + 32 hex chars (16 bytes).
	if len(k1) != len("mail/att/")+32 {
		t.Errorf("randKey length = %d", len(k1))
	}
}

// ---- UploadHandler short-circuits ----

func TestUploadHandler_Unauthorized(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/upload", nil) // no auth context
	rr := httptest.NewRecorder()
	a.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestUploadHandler_NoOrg(t *testing.T) {
	a := NewAttachments(nil, nil)
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", Email: "x@y.com"})
	req := httptest.NewRequest(http.MethodPost, "/upload", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	a.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rr.Code)
	}
}

func TestUploadHandler_BadMultipart(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("not multipart")).WithContext(ctxWithUserOrg())
	req.Header.Set("Content-Type", "text/plain")
	rr := httptest.NewRecorder()
	a.UploadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
}

// ---- DownloadHandler short-circuits ----

func TestDownloadHandler_Unauthorized(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/attachments/x/content", nil)
	rr := httptest.NewRecorder()
	a.DownloadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestDownloadHandler_BadPath(t *testing.T) {
	a := NewAttachments(nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/attachments//content", nil).WithContext(ctxWithOrgOnly())
	rr := httptest.NewRecorder()
	a.DownloadHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
}

// ---- RawHandler ----

func TestRawHandler_Unauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/messages/1/raw", nil)
	rr := httptest.NewRecorder()
	RawHandler(&fakeBackend{}).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestRawHandler_NoOrg(t *testing.T) {
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", Email: "x@y.com"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/messages/1/raw", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	RawHandler(&fakeBackend{}).ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rr.Code)
	}
}

func TestRawHandler_BadMessageID(t *testing.T) {
	// Path that unescapes to an empty id (just the /raw suffix stripped from prefix).
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/messages//raw", nil).WithContext(ctxWithUserOrg())
	rr := httptest.NewRecorder()
	RawHandler(&fakeBackend{}).ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rr.Code)
	}
}

func TestRawHandler_NotFound(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/messages/99/raw", nil).WithContext(ctxWithUserOrg())
	rr := httptest.NewRecorder()
	RawHandler(&fakeBackend{getErr: ErrNotFound}).ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

// The fakeBackend is not a RawSourcer, so RawHandler falls back to synthSource(Get()).
func TestRawHandler_SynthFallback(t *testing.T) {
	msg := Message{
		FromAddr: "alice@x.com", FromName: "Alice",
		ToAddrs: []string{"bob@x.com"}, Subject: "Hi", Body: "the body",
		SentAt: time.Date(2026, 6, 11, 12, 0, 0, 0, time.UTC),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mail/messages/7/raw", nil).WithContext(ctxWithUserOrg())
	rr := httptest.NewRecorder()
	RawHandler(&fakeBackend{getMsg: msg}).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("content-type = %q", ct)
	}
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("missing nosniff header")
	}
	body := rr.Body.String()
	for _, want := range []string{"From: Alice <alice@x.com>", "To: bob@x.com", "Subject: Hi", "the body"} {
		if !strings.Contains(body, want) {
			t.Errorf("raw body missing %q:\n%s", want, body)
		}
	}
}

func TestSynthSource(t *testing.T) {
	t.Run("full message", func(t *testing.T) {
		m := Message{
			FromAddr: "a@x.com", FromName: "A",
			ToAddrs: []string{"b@x.com", "c@x.com"}, CcAddrs: []string{"d@x.com"},
			Subject: "S", Body: "B",
			SentAt:  time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		}
		got := synthSource(m)
		for _, want := range []string{
			"From: A <a@x.com>\r\n",
			"To: b@x.com, c@x.com\r\n",
			"Cc: d@x.com\r\n",
			"Subject: S\r\n",
			"Date: ",
			"\r\n\r\nB",
		} {
			if !strings.Contains(got, want) {
				t.Errorf("synthSource missing %q:\n%s", want, got)
			}
		}
	})

	t.Run("no name uses bare from, no date when zero", func(t *testing.T) {
		m := Message{FromAddr: "a@x.com", Subject: "S", Body: "B"}
		got := synthSource(m)
		if !strings.Contains(got, "From: a@x.com\r\n") {
			t.Errorf("expected bare From:\n%s", got)
		}
		if strings.Contains(got, "Date:") {
			t.Errorf("did not expect Date for zero time:\n%s", got)
		}
		if strings.Contains(got, "To:") || strings.Contains(got, "Cc:") {
			t.Errorf("did not expect To/Cc when empty:\n%s", got)
		}
	})
}
