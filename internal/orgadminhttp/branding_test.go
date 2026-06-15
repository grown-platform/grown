package orgadminhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// errBranding fails on Get to exercise the GET error→500 path.
type errBranding struct{ fakeBranding }

func (e *errBranding) Get(_ context.Context, _ string) (Branding, error) {
	return Branding{}, errors.New("boom")
}

func TestAdminBranding_GetShapesJSON(t *testing.T) {
	fb := &fakeBranding{b: Branding{AccentColor: "#112233", LogoBlobKey: "k", ProductName: "Widgets"}}
	h := NewHandler(adminIdentity(true), nil, fb, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/org/branding", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	var out brandingOut
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.AccentColor != "#112233" || !out.HasLogo || out.ProductName != "Widgets" {
		t.Errorf("unexpected branding shape: %+v", out)
	}
}

func TestAdminBranding_GetError500(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &errBranding{}, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/org/branding", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", w.Code)
	}
}

func TestAdminBranding_PatchProductName(t *testing.T) {
	fb := &fakeBranding{}
	h := NewHandler(adminIdentity(true), nil, fb, nil, nil)

	// Too-long product name → 400.
	long := strings.Repeat("x", 41)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/branding", strings.NewReader(`{"product_name":"`+long+`"}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("long product name: got %d, want 400", w.Code)
	}

	// Valid (trimmed) product name stored.
	r = httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/branding", strings.NewReader(`{"product_name":"  Cloud  "}`))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("valid product name: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if fb.b.ProductName != "Cloud" {
		t.Errorf("product name not trimmed/stored: %q", fb.b.ProductName)
	}
}

func TestAdminBranding_PatchEmptyAccentClears(t *testing.T) {
	fb := &fakeBranding{b: Branding{AccentColor: "#000000"}}
	h := NewHandler(adminIdentity(true), nil, fb, nil, nil)
	// accent_color present but empty → stored as "" (clear), no validation error.
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/branding", strings.NewReader(`{"accent_color":"  "}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("empty accent: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if fb.b.AccentColor != "" {
		t.Errorf("expected accent cleared, got %q", fb.b.AccentColor)
	}
}

func TestAdminBranding_PatchBadJSON(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/branding", strings.NewReader(`{not json`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad json: got %d, want 400", w.Code)
	}
}

func TestAdminBranding_WrongMethod405(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, nil, nil)
	r := httptest.NewRequest(http.MethodPut, "/api/v1/admin/org/branding", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("PUT branding: got %d, want 405", w.Code)
	}
}

func TestRenameOrg_BadJSON(t *testing.T) {
	h := NewHandler(adminIdentity(true), &fakeOrgStore{}, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", strings.NewReader(`{bad`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad json rename: got %d, want 400", w.Code)
	}
}

func TestRenameOrg_TooLong(t *testing.T) {
	h := NewHandler(adminIdentity(true), &fakeOrgStore{}, nil, nil, nil)
	long := `{"display_name":"` + strings.Repeat("a", maxOrgNameLen+1) + `"}`
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", strings.NewReader(long))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("too-long name: got %d, want 400", w.Code)
	}
}

// ---- Logo delete -----------------------------------------------------------

// recordingBlobs records Put and returns a canned blob from Get.
type recordingBlobs struct {
	putKey, putMime string
	putErr          error
	getBody         string
	getMime         string
	getErr          error
}

func (b *recordingBlobs) Put(_ context.Context, key, mime string, _ int64, body io.Reader) error {
	b.putKey, b.putMime = key, mime
	_, _ = io.Copy(io.Discard, body)
	return b.putErr
}
func (b *recordingBlobs) Get(_ context.Context, _ string) (io.ReadCloser, string, int64, error) {
	if b.getErr != nil {
		return nil, "", 0, b.getErr
	}
	return io.NopCloser(strings.NewReader(b.getBody)), b.getMime, int64(len(b.getBody)), nil
}

func TestAdminBrandingLogo_Delete(t *testing.T) {
	fb := &fakeBranding{b: Branding{LogoBlobKey: "k", LogoMIME: "image/png"}}
	h := NewHandler(adminIdentity(true), nil, fb, &recordingBlobs{}, nil)
	r := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/org/branding/logo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("delete logo: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if fb.b.LogoBlobKey != "" || fb.b.LogoMIME != "" {
		t.Errorf("logo not cleared: key=%q mime=%q", fb.b.LogoBlobKey, fb.b.LogoMIME)
	}
}

func TestAdminBrandingLogo_WrongMethod405(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, &recordingBlobs{}, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/org/branding/logo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET logo route: got %d, want 405", w.Code)
	}
}

// ---- Logo upload -----------------------------------------------------------

func multipartLogo(t *testing.T, field, filename, contentType, body string) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	hdr := make(map[string][]string)
	hdr["Content-Disposition"] = []string{`form-data; name="` + field + `"; filename="` + filename + `"`}
	if contentType != "" {
		hdr["Content-Type"] = []string{contentType}
	}
	pw, err := mw.CreatePart(hdr)
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	_, _ = pw.Write([]byte(body))
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestUploadLogo_Success(t *testing.T) {
	fb := &fakeBranding{}
	rb := &recordingBlobs{}
	h := NewHandler(adminIdentity(true), nil, fb, rb, nil)

	buf, ct := multipartLogo(t, "file", "logo.png", "image/png", "PNGDATA")
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/org/branding/logo", buf)
	r.Header.Set("Content-Type", ct)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("upload: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if !strings.HasPrefix(rb.putKey, "branding/o1/logo-") {
		t.Errorf("blob key not per-org: %q", rb.putKey)
	}
	if rb.putMime != "image/png" {
		t.Errorf("blob mime: got %q", rb.putMime)
	}
	if fb.b.LogoBlobKey != rb.putKey {
		t.Errorf("branding key not recorded: %q vs %q", fb.b.LogoBlobKey, rb.putKey)
	}
}

func TestUploadLogo_MissingFileField(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, &recordingBlobs{}, nil)
	// multipart form with a non-"file" field.
	buf, ct := multipartLogo(t, "other", "x.png", "image/png", "data")
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/org/branding/logo", buf)
	r.Header.Set("Content-Type", ct)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing file: got %d, want 400 (%s)", w.Code, w.Body.String())
	}
}

func TestUploadLogo_BadMultipart(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, &recordingBlobs{}, nil)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/org/branding/logo", strings.NewReader("not multipart"))
	r.Header.Set("Content-Type", "multipart/form-data; boundary=nope")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad multipart: got %d, want 400", w.Code)
	}
}

func TestUploadLogo_UnsupportedMIME(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, &recordingBlobs{}, nil)
	buf, ct := multipartLogo(t, "file", "evil.exe", "application/octet-stream", "MZ")
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/org/branding/logo", buf)
	r.Header.Set("Content-Type", ct)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("bad mime: got %d, want 415 (%s)", w.Code, w.Body.String())
	}
}

func TestUploadLogo_BlobPutFails502(t *testing.T) {
	rb := &recordingBlobs{putErr: errors.New("disk full")}
	h := NewHandler(adminIdentity(true), nil, &fakeBranding{}, rb, nil)
	buf, ct := multipartLogo(t, "file", "logo.svg", "image/svg+xml", "<svg/>")
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/org/branding/logo", buf)
	r.Header.Set("Content-Type", ct)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("blob put fail: got %d, want 502 (%s)", w.Code, w.Body.String())
	}
}

// ---- Public branding + logo ------------------------------------------------

func TestPublicBranding_WithStore(t *testing.T) {
	fb := &fakeBranding{b: Branding{AccentColor: "#abcdef", LogoBlobKey: "k", ProductName: "P"}}
	h := NewHandler(adminIdentity(false), nil, fb, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", w.Code)
	}
	var out brandingOut
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.AccentColor != "#abcdef" || !out.HasLogo || out.ProductName != "P" {
		t.Errorf("unexpected public branding: %+v", out)
	}
}

func TestPublicBranding_GetErrorDegrades(t *testing.T) {
	h := NewHandler(adminIdentity(false), nil, &errBranding{}, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("Get error should degrade to 200, got %d", w.Code)
	}
	var out brandingOut
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.AccentColor != "" || out.HasLogo {
		t.Errorf("expected defaults on error, got %+v", out)
	}
}

func TestPublicBrandingLogo_Streams(t *testing.T) {
	fb := &fakeBranding{b: Branding{LogoBlobKey: "k", LogoMIME: "image/png"}}
	rb := &recordingBlobs{getBody: "IMGBYTES", getMime: "image/png"}
	h := NewHandler(adminIdentity(false), nil, fb, rb, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding/logo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("logo stream: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if w.Body.String() != "IMGBYTES" {
		t.Errorf("body: got %q", w.Body.String())
	}
	if w.Header().Get("Content-Type") != "image/png" {
		t.Errorf("content-type: got %q", w.Header().Get("Content-Type"))
	}
	if w.Header().Get("Cache-Control") == "" {
		t.Errorf("expected Cache-Control header")
	}
}

func TestPublicBrandingLogo_NoKey404(t *testing.T) {
	fb := &fakeBranding{b: Branding{LogoBlobKey: ""}}
	h := NewHandler(adminIdentity(false), nil, fb, &recordingBlobs{}, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding/logo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("no logo key: got %d, want 404", w.Code)
	}
}

func TestPublicBrandingLogo_BlobGetFails404(t *testing.T) {
	fb := &fakeBranding{b: Branding{LogoBlobKey: "k"}}
	rb := &recordingBlobs{getErr: errors.New("gone")}
	h := NewHandler(adminIdentity(false), nil, fb, rb, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding/logo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("blob get fail: got %d, want 404", w.Code)
	}
}

func TestPublicBrandingLogo_FallbackMIME(t *testing.T) {
	// Blob Get returns empty mime → handler falls back to stored LogoMIME.
	fb := &fakeBranding{b: Branding{LogoBlobKey: "k", LogoMIME: "image/webp"}}
	rb := &recordingBlobs{getBody: "x", getMime: ""}
	h := NewHandler(adminIdentity(false), nil, fb, rb, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding/logo", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Header().Get("Content-Type") != "image/webp" {
		t.Errorf("fallback mime: got %q, want image/webp", w.Header().Get("Content-Type"))
	}
}
