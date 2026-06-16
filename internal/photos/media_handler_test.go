package photos

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// fakeBlobStore is an in-memory BlobStore for handler tests. It records calls so
// tests can assert handlers short-circuit before (or after) touching storage.
type fakeBlobStore struct {
	mu       sync.Mutex
	objects  map[string][]byte
	mime     map[string]string
	putCalls int
	getCalls int
	getErr   error // when set, Get returns this error
	putErr   error // when set, Put returns this error
}

func newFakeBlobStore() *fakeBlobStore {
	return &fakeBlobStore{objects: map[string][]byte{}, mime: map[string]string{}}
}

func (f *fakeBlobStore) Put(_ context.Context, key, mimeType string, _ int64, body io.Reader) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.putCalls++
	if f.putErr != nil {
		return f.putErr
	}
	data, _ := io.ReadAll(body)
	f.objects[key] = data
	f.mime[key] = mimeType
	return nil
}

func (f *fakeBlobStore) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getCalls++
	if f.getErr != nil {
		return nil, "", 0, f.getErr
	}
	data, ok := f.objects[key]
	if !ok {
		return io.NopCloser(strings.NewReader("")), f.mime[key], 0, nil
	}
	return io.NopCloser(bytes.NewReader(data)), f.mime[key], int64(len(data)), nil
}

func (f *fakeBlobStore) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func withAuth(r *http.Request, orgID, userID string) *http.Request {
	ctx := auth.WithOrg(r.Context(), orgs.Org{ID: orgID})
	ctx = auth.WithUser(ctx, users.User{ID: userID, OrgID: orgID})
	return r.WithContext(ctx)
}

func withOrgOnly(r *http.Request, orgID string) *http.Request {
	return r.WithContext(auth.WithOrg(r.Context(), orgs.Org{ID: orgID}))
}

// multipartImage builds a multipart form body with one "file" part.
func multipartImage(t *testing.T, field, filename, contentType string, body []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{`form-data; name="` + field + `"; filename="` + filename + `"`}
	if contentType != "" {
		h["Content-Type"] = []string{contentType}
	}
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatalf("CreatePart: %v", err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, w.FormDataContentType()
}

func TestUploadHandler_ShortCircuits(t *testing.T) {
	tests := []struct {
		name     string
		setupReq func(t *testing.T) *http.Request
		wantCode int
	}{
		{
			name: "no user in context",
			setupReq: func(t *testing.T) *http.Request {
				return httptest.NewRequest(http.MethodPost, "/upload", nil)
			},
			wantCode: http.StatusUnauthorized,
		},
		{
			name: "user but no org",
			setupReq: func(t *testing.T) *http.Request {
				r := httptest.NewRequest(http.MethodPost, "/upload", nil)
				return r.WithContext(auth.WithUser(r.Context(), users.User{ID: "u1"}))
			},
			wantCode: http.StatusInternalServerError,
		},
		{
			name: "bad multipart form",
			setupReq: func(t *testing.T) *http.Request {
				r := httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("not multipart"))
				r.Header.Set("Content-Type", "multipart/form-data; boundary=nope")
				return withAuth(r, "o1", "u1")
			},
			wantCode: http.StatusBadRequest,
		},
		{
			name: "non-image content type rejected",
			setupReq: func(t *testing.T) *http.Request {
				body, ct := multipartImage(t, "file", "doc.txt", "text/plain", []byte("hello"))
				r := httptest.NewRequest(http.MethodPost, "/upload", body)
				r.Header.Set("Content-Type", ct)
				return withAuth(r, "o1", "u1")
			},
			wantCode: http.StatusUnsupportedMediaType,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			blobs := newFakeBlobStore()
			// nil pool repo is safe: every case here short-circuits before any
			// repository (DB) access.
			m := NewMedia(NewRepository(nil), blobs)
			rec := httptest.NewRecorder()
			m.UploadHandler().ServeHTTP(rec, tt.setupReq(t))
			if rec.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body: %q)", rec.Code, tt.wantCode, rec.Body.String())
			}
			if blobs.putCalls != 0 {
				t.Errorf("blob store should not be written on short-circuit, got %d Put calls", blobs.putCalls)
			}
		})
	}
}

// TestUploadHandler_EmptyFileList exercises the success path with zero files:
// the handler must return an empty photos array as JSON without hitting the DB.
func TestUploadHandler_EmptyFileList(t *testing.T) {
	blobs := newFakeBlobStore()
	m := NewMedia(NewRepository(nil), blobs)

	// Multipart form with a non-"file" field so MultipartForm.File["file"] is empty.
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("other", "value")
	_ = w.Close()
	r := httptest.NewRequest(http.MethodPost, "/upload", &buf)
	r.Header.Set("Content-Type", w.FormDataContentType())
	r = withAuth(r, "o1", "u1")

	rec := httptest.NewRecorder()
	m.UploadHandler().ServeHTTP(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"photos":[]}` {
		t.Errorf("body = %q, want empty photos array", got)
	}
	if blobs.putCalls != 0 {
		t.Errorf("no files => no Put, got %d", blobs.putCalls)
	}
}

func TestDownloadHandler_ShortCircuits(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		auth     func(r *http.Request) *http.Request
		wantCode int
	}{
		{
			name:     "no org context",
			path:     "/api/v1/photos/p1/content",
			auth:     func(r *http.Request) *http.Request { return r },
			wantCode: http.StatusUnauthorized,
		},
		{
			name:     "bad path missing suffix",
			path:     "/api/v1/photos/p1",
			auth:     func(r *http.Request) *http.Request { return withOrgOnly(r, "o1") },
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "bad path nested id",
			path:     "/api/v1/photos/a/b/content",
			auth:     func(r *http.Request) *http.Request { return withOrgOnly(r, "o1") },
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "bad path empty id",
			path:     "/api/v1/photos//content",
			auth:     func(r *http.Request) *http.Request { return withOrgOnly(r, "o1") },
			wantCode: http.StatusBadRequest,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			blobs := newFakeBlobStore()
			m := NewMedia(NewRepository(nil), blobs)
			r := tt.auth(httptest.NewRequest(http.MethodGet, tt.path, nil))
			rec := httptest.NewRecorder()
			m.DownloadHandler().ServeHTTP(rec, r)
			if rec.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body %q)", rec.Code, tt.wantCode, rec.Body.String())
			}
			if blobs.getCalls != 0 {
				t.Errorf("blob store should not be read on short-circuit, got %d Get calls", blobs.getCalls)
			}
		})
	}
}
