package docs_test

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

	"code.pick.haus/grown/grown/internal/docs"
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

func assetAccess(read, write map[string]bool) docs.DocAccess {
	return func(_ *http.Request, id string) (bool, bool) { return read[id], write[id] }
}

func postAsset(h http.Handler, doc string, data []byte, multipartForm bool) *httptest.ResponseRecorder {
	var body io.Reader = bytes.NewReader(data)
	ct := "image/png"
	if multipartForm {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		fw, _ := mw.CreateFormFile("file", "pic.png")
		_, _ = fw.Write(data)
		_ = mw.Close()
		body, ct = &buf, mw.FormDataContentType()
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/docs/d/"+doc+"/assets", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestDocAssetPath(t *testing.T) {
	sha := strings.Repeat("a", 64)
	cases := []struct {
		in, doc, sha string
		ok           bool
	}{
		{"/api/v1/docs/d/abc/assets", "abc", "", true},
		{"/api/v1/docs/d/abc/assets/" + sha, "abc", sha, true},
		{"/api/v1/docs/d/abc/assets/xyz", "", "", false},
		{"/api/v1/docs/d/abc/assets/" + strings.Repeat("A", 64), "", "", false},
		{"/api/v1/docs/d/abc/connect", "", "", false},
		{"/api/v1/docs/d/a/b/assets", "", "", false},
		{"/api/v1/slides/d/abc/assets", "", "", false},
	}
	for _, c := range cases {
		d, s, ok := docs.AssetPath(c.in)
		if d != c.doc || s != c.sha || ok != c.ok {
			t.Errorf("AssetPath(%q) = %q %q %v", c.in, d, s, ok)
		}
	}
}

func TestDocAssetsUploadAndServe(t *testing.T) {
	blobs := newMemBlobs()
	h := docs.NewAssets(blobs, assetAccess(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	rec := postAsset(h, "d1", png1, true)
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
	if !strings.HasPrefix(out.URL, "/api/v1/docs/d/d1/assets/") || out.Mime != "image/png" {
		t.Fatalf("unexpected response %+v", out)
	}
	if _, ok := blobs.data["docs/d1/"+strings.TrimPrefix(out.URL, "/api/v1/docs/d/d1/assets/")]; !ok {
		t.Fatalf("blob key not under docs/<id>/: %v", blobs.data)
	}
	// Raw body, same bytes: same content-addressed URL.
	if rec := postAsset(h, "d1", png1, false); !strings.Contains(rec.Body.String(), out.URL) {
		t.Fatalf("raw upload should dedupe: %s", rec.Body)
	}
	req := httptest.NewRequest(http.MethodGet, out.URL, nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), png1) {
		t.Fatalf("serve: %d", rec.Code)
	}
	hd := rec.Header()
	if hd.Get("Content-Type") != "image/png" || hd.Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(hd.Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("headers: %v", hd)
	}
	req = httptest.NewRequest(http.MethodGet, out.URL, nil)
	req.Header.Set("If-None-Match", hd.Get("ETag"))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("conditional GET: %d", rec.Code)
	}
}

func TestDocAssetsAccess(t *testing.T) {
	blobs := newMemBlobs()
	h := docs.NewAssets(blobs, assetAccess(map[string]bool{"d1": true}, map[string]bool{}))
	if rec := postAsset(h, "d1", png1, true); rec.Code != http.StatusNotFound {
		t.Fatalf("read-only upload should be refused: %d", rec.Code)
	}
	sha := strings.Repeat("b", 64)
	_ = blobs.Put(context.Background(), "docs/d2/"+sha, "image/png", 0, bytes.NewReader(png1))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/docs/d/d2/assets/"+sha, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("no-access read should 404: %d", rec.Code)
	}
	// A stored blob of a type we don't serve goes out as an opaque download.
	_ = blobs.Put(context.Background(), "docs/d1/"+sha, "text/html", 0, strings.NewReader("<script>"))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/docs/d/d1/assets/"+sha, nil))
	if rec.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("unexpected type served: %v", rec.Header())
	}
}

func TestDocAssetsRejects(t *testing.T) {
	h := docs.NewAssets(newMemBlobs(), assetAccess(map[string]bool{"d1": true}, map[string]bool{"d1": true}))
	for _, data := range [][]byte{
		[]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		[]byte("<html><body>hi</body></html>"),
		[]byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"), // video: Docs takes pictures only
		[]byte("%PDF-1.4\n"),
		{},
	} {
		if rec := postAsset(h, "d1", data, false); rec.Code != http.StatusUnsupportedMediaType && rec.Code != http.StatusBadRequest {
			t.Fatalf("%q: want 415/400, got %d", data, rec.Code)
		}
	}
	big := append(append([]byte{}, png1...), make([]byte, docs.MaxAssetBytes)...)
	if rec := postAsset(h, "d1", big, false); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d", rec.Code)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/v1/docs/d/d1/assets/"+strings.Repeat("c", 64), nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE: %d", rec.Code)
	}
}
