package slides_test

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

	"code.pick.haus/grown/grown/internal/slides"
)

type memBlobs struct {
	data map[string][]byte
	mime map[string]string
}

func newMemBlobs() *memBlobs {
	return &memBlobs{data: map[string][]byte{}, mime: map[string]string{}}
}

func (b *memBlobs) Put(_ context.Context, key, mime string, _ int64, body io.Reader) error {
	d, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	b.data[key] = d
	b.mime[key] = mime
	return nil
}

func (b *memBlobs) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	d, ok := b.data[key]
	if !ok {
		return nil, "", 0, errors.New("not found")
	}
	return io.NopCloser(bytes.NewReader(d)), b.mime[key], int64(len(d)), nil
}

// A 1×1 PNG.
var png1 = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\xdac\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82")

func access(read, write map[string]bool) slides.DeckAccess {
	return func(_ *http.Request, id string) (bool, bool) { return read[id], write[id] }
}

func multipartBody(t *testing.T, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", "pic.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write(data)
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestAssetPath(t *testing.T) {
	sha := strings.Repeat("a", 64)
	cases := []struct {
		in   string
		deck string
		sha  string
		ok   bool
	}{
		{"/api/v1/slides/d/abc/assets", "abc", "", true},
		{"/api/v1/slides/d/abc/assets/" + sha, "abc", sha, true},
		{"/api/v1/slides/d/abc/assets/xyz", "", "", false},
		{"/api/v1/slides/d/abc/connect", "", "", false},
		{"/api/v1/slides/d/a/b/assets", "", "", false},
	}
	for _, c := range cases {
		d, s, ok := slides.AssetPath(c.in)
		if d != c.deck || s != c.sha || ok != c.ok {
			t.Errorf("AssetPath(%q) = %q %q %v", c.in, d, s, ok)
		}
	}
}

func TestAssetsUploadAndServe(t *testing.T) {
	blobs := newMemBlobs()
	h := slides.NewAssets(blobs, access(map[string]bool{"d1": true}, map[string]bool{"d1": true}))

	body, ct := multipartBody(t, png1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/d1/assets", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		URL  string `json:"url"`
		Mime string `json:"mime"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.URL, "/api/v1/slides/d/d1/assets/") || out.Mime != "image/png" {
		t.Fatalf("unexpected response %+v", out)
	}

	// Same bytes as a raw body: same content-addressed URL.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/d1/assets", bytes.NewReader(png1))
	req.Header.Set("Content-Type", "image/png")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), out.URL) {
		t.Fatalf("raw upload should dedupe: %s", rec.Body)
	}

	req = httptest.NewRequest(http.MethodGet, out.URL, nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), png1) {
		t.Fatalf("serve: %d", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers: %v", rec.Header())
	}
	etag := rec.Header().Get("ETag")
	req = httptest.NewRequest(http.MethodGet, out.URL, nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("conditional GET: %d", rec.Code)
	}
}

func TestAssetsAccess(t *testing.T) {
	blobs := newMemBlobs()
	// d1: read-only grantee; d2: no access.
	h := slides.NewAssets(blobs, access(map[string]bool{"d1": true}, map[string]bool{}))
	body, ct := multipartBody(t, png1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/d1/assets", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("read-only upload should be refused: %d", rec.Code)
	}
	_ = blobs.Put(context.Background(), "slides/d2/"+strings.Repeat("b", 64), "image/png", 0, bytes.NewReader(png1))
	req = httptest.NewRequest(http.MethodGet, "/api/v1/slides/d/d2/assets/"+strings.Repeat("b", 64), nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("no-access read should 404: %d", rec.Code)
	}
}

func TestAssetsRejectsNonImagesAndSVG(t *testing.T) {
	h := slides.NewAssets(newMemBlobs(), access(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	for _, data := range [][]byte{
		[]byte("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"),
		[]byte("<html><body>hi</body></html>"),
		{},
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/d1/assets", bytes.NewReader(data))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnsupportedMediaType && rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: want 415/400, got %d", data, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/slides/d/d1/assets/"+strings.Repeat("c", 64), nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE: %d", rec.Code)
	}
}

func TestAssetsTooLarge(t *testing.T) {
	h := slides.NewAssets(newMemBlobs(), access(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	big := append(append([]byte{}, png1...), make([]byte, slides.MaxAssetBytes)...)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/d1/assets", bytes.NewReader(big))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d", rec.Code)
	}
}

func upload(t *testing.T, h http.Handler, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/slides/d/d1/assets", bytes.NewReader(data))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// Slides M11: video/audio clips are accepted (sniffed), up to MaxMediaBytes.
func TestAssetsMediaTypes(t *testing.T) {
	h := slides.NewAssets(newMemBlobs(), access(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	pad := func(b []byte) []byte { return append(b, make([]byte, 64)...) }
	cases := []struct {
		name string
		data []byte
		mime string
	}{
		{"mp4", pad([]byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2")), "video/mp4"},
		{"m4a", pad([]byte("\x00\x00\x00\x18ftypM4A \x00\x00\x02\x00isomiso2")), "audio/mp4"},
		{"webm", pad([]byte("\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x84webm")), "video/webm"},
		{"mp3 id3", pad([]byte("ID3\x03\x00\x00\x00\x00\x00\x00")), "audio/mpeg"},
		{"mp3 frame", pad([]byte("\xff\xfb\x90\x64")), "audio/mpeg"},
		{"aac", pad([]byte("\xff\xf1\x50\x80")), "audio/aac"},
		{"ogg audio", pad([]byte("OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x01vorbis")), "audio/ogg"},
		{"ogg video", pad([]byte("OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x80theora")), "video/ogg"},
		{"wav", pad([]byte("RIFF\x24\x00\x00\x00WAVEfmt ")), "audio/wav"},
		{"jpeg", pad([]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00")), "image/jpeg"},
	}
	for _, c := range cases {
		rec := upload(t, h, c.data)
		if rec.Code != http.StatusCreated {
			t.Fatalf("%s: want 201, got %d %s", c.name, rec.Code, rec.Body.String())
		}
		var out struct {
			URL  string `json:"url"`
			Mime string `json:"mime"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if out.Mime != c.mime {
			t.Fatalf("%s: mime %q, want %q", c.name, out.Mime, c.mime)
		}
	}
	for _, bad := range [][]byte{[]byte("MZ\x90\x00\x03\x00\x00\x00"), []byte("%PDF-1.4\n")} {
		if rec := upload(t, h, bad); rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("%q: want 415, got %d", bad, rec.Code)
		}
	}
}

func TestAssetsMediaSizeLimits(t *testing.T) {
	h := slides.NewAssets(newMemBlobs(), access(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	mp4 := []byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2")
	// A clip over the picture limit is fine…
	big := append(append([]byte{}, mp4...), make([]byte, slides.MaxAssetBytes+10)...)
	if rec := upload(t, h, big); rec.Code != http.StatusCreated {
		t.Fatalf("25 MB clip: want 201, got %d", rec.Code)
	}
	// …one over the media limit is not.
	huge := append(append([]byte{}, mp4...), make([]byte, slides.MaxMediaBytes)...)
	if rec := upload(t, h, huge); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over MaxMediaBytes: want 413, got %d", rec.Code)
	}
}

func TestAssetsMediaRanges(t *testing.T) {
	h := slides.NewAssets(newMemBlobs(), access(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	clip := append([]byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"), bytes.Repeat([]byte("0123456789"), 100)...)
	rec := upload(t, h, clip)
	var out struct {
		URL string `json:"url"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	req := httptest.NewRequest(http.MethodGet, out.URL, nil)
	req.Header.Set("Range", "bytes=24-33")
	got := httptest.NewRecorder()
	h.ServeHTTP(got, req)
	if got.Code != http.StatusPartialContent {
		t.Fatalf("range: want 206, got %d", got.Code)
	}
	if got.Body.String() != "0123456789" {
		t.Fatalf("range body %q", got.Body.String())
	}
	if ct := got.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("content type %q", ct)
	}
	if got.Header().Get("Accept-Ranges") != "bytes" || got.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers %v", got.Header())
	}
	full := httptest.NewRecorder()
	h.ServeHTTP(full, httptest.NewRequest(http.MethodGet, out.URL, nil))
	if full.Code != http.StatusOK || full.Body.Len() != len(clip) {
		t.Fatalf("full: %d %d", full.Code, full.Body.Len())
	}
}
