package useravatar_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"code.pick.haus/grown/grown/internal/useravatar"
)

// --- stubs ---

type stubRepo struct {
	avatars map[string]useravatar.Avatar
}

func newStubRepo() *stubRepo { return &stubRepo{avatars: make(map[string]useravatar.Avatar)} }

func (r *stubRepo) Get(_ context.Context, userID string) (useravatar.Avatar, error) {
	a, ok := r.avatars[userID]
	if !ok {
		return useravatar.Avatar{}, useravatar.ErrNotFound
	}
	return a, nil
}

func (r *stubRepo) Set(_ context.Context, userID, blobKey, mime string) error {
	if blobKey == "" {
		delete(r.avatars, userID)
		return nil
	}
	r.avatars[userID] = useravatar.Avatar{UserID: userID, BlobKey: blobKey, MimeType: mime}
	return nil
}

type stubBlobs struct {
	data map[string][]byte
}

func newStubBlobs() *stubBlobs { return &stubBlobs{data: make(map[string][]byte)} }

func (b *stubBlobs) Put(_ context.Context, key, _ string, _ int64, body io.Reader) error {
	d, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	b.data[key] = d
	return nil
}

func (b *stubBlobs) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	d, ok := b.data[key]
	if !ok {
		return nil, "", 0, errors.New("not found")
	}
	return io.NopCloser(bytes.NewReader(d)), "image/png", int64(len(d)), nil
}

func (b *stubBlobs) Delete(_ context.Context, key string) error {
	delete(b.data, key)
	return nil
}

// --- helpers ---

func newHandler(userID string) (*useravatar.Handler, *stubRepo, *stubBlobs) {
	repo := newStubRepo()
	blobs := newStubBlobs()
	caller := func(_ context.Context) (string, bool) {
		if userID == "" {
			return "", false
		}
		return userID, true
	}
	h := useravatar.NewHandler(caller, repo, blobs)
	return h, repo, blobs
}

func multipartBody(t *testing.T, content []byte, mime string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	// Use CreatePart so we can set the Content-Type on the part header explicitly;
	// CreateFormFile doesn't set it and the handler reads it from the part header.
	part, err := w.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="avatar.png"`},
		"Content-Type":        {mime},
	})
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	part.Write(content)
	w.Close()
	return &buf, w.FormDataContentType()
}

// --- tests ---

func TestMyAvatar_NoSession_Returns401(t *testing.T) {
	h, _, _ := newHandler("")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/avatar", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", rec.Code)
	}
}

func TestMyAvatar_GetNoAvatar_Returns404(t *testing.T) {
	h, _, _ := newHandler("user1")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/avatar", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", rec.Code)
	}
}

func TestMyAvatar_UploadAndGet(t *testing.T) {
	h, repo, blobs := newHandler("user1")
	imgData := []byte("fake-image-data")
	body, ct := multipartBody(t, imgData, "image/png")

	// Upload
	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/avatar", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("upload: want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify repo was populated
	a, err := repo.Get(context.Background(), "user1")
	if err != nil {
		t.Fatalf("repo.Get after upload: %v", err)
	}
	if a.BlobKey == "" {
		t.Error("blob key not set")
	}
	if len(blobs.data) == 0 {
		t.Error("blob store empty after upload")
	}

	// GET after upload
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/me/avatar", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("get after upload: want 200, got %d", rec2.Code)
	}
	if !bytes.Equal(rec2.Body.Bytes(), imgData) {
		t.Errorf("get body mismatch: got %q, want %q", rec2.Body.Bytes(), imgData)
	}
}

func TestMyAvatar_Delete(t *testing.T) {
	h, repo, _ := newHandler("user1")
	// Seed an avatar first
	_ = repo.Set(context.Background(), "user1", "avatars/user1/avatar-abc", "image/png")

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me/avatar", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete: want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	// Verify it's gone
	if _, err := repo.Get(context.Background(), "user1"); !errors.Is(err, useravatar.ErrNotFound) {
		t.Errorf("want ErrNotFound after delete, got %v", err)
	}
}

func TestUserAvatar_OtherUser_RequiresAuth(t *testing.T) {
	h, _, _ := newHandler("") // no caller
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/other-user/avatar", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", rec.Code)
	}
}

func TestMyAvatar_InvalidMIME_Returns415(t *testing.T) {
	h, _, _ := newHandler("user1")
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", "avatar.pdf")
	fw.Write([]byte("not-an-image"))
	w.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/me/avatar", &buf)
	// Set a content-type that reports the file as PDF (the multipart part header
	// is what the handler reads, but for simplicity the stub sets it on the part).
	// In this test we rely on the part's Content-Type being set by CreateFormFile.
	req.Header.Set("Content-Type", w.FormDataContentType())
	// Override the part's Content-Type header to "application/pdf":
	// re-build the body manually so we can control the part MIME.
	var buf2 bytes.Buffer
	w2 := multipart.NewWriter(&buf2)
	h2, _ := w2.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="avatar.pdf"`},
		"Content-Type":        {"application/pdf"},
	})
	h2.Write([]byte("not-an-image"))
	w2.Close()

	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/me/avatar", &buf2)
	req2.Header.Set("Content-Type", w2.FormDataContentType())
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusUnsupportedMediaType {
		t.Errorf("want 415, got %d", rec2.Code)
	}
}
