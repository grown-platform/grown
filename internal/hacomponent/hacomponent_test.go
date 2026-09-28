package hacomponent

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
	"time"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"c/grown/manifest.json":               {Data: []byte(`{"domain":"grown"}`)},
		"c/grown/__init__.py":                 {Data: []byte("# init\n")},
		"c/grown/translations/en.json":        {Data: []byte("{}")},
		"c/grown/__pycache__/api.cpython.pyc": {Data: []byte("junk")},
		"c/grown/stale.pyc":                   {Data: []byte("junk")},
		"c/grown/.DS_Store":                   {Data: []byte("junk")},
		"c/other/ignored.py":                  {Data: []byte("nope")},
	}
}

func unzip(t *testing.T, b []byte) map[string]*zip.File {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	out := map[string]*zip.File{}
	for _, f := range zr.File {
		out[f.Name] = f
	}
	return out
}

func TestBuildLayoutAndFiltering(t *testing.T) {
	b, err := Build(testFS(), "c/grown", "custom_components/grown")
	if err != nil {
		t.Fatal(err)
	}
	files := unzip(t, b)
	want := []string{
		"custom_components/grown/__init__.py",
		"custom_components/grown/manifest.json",
		"custom_components/grown/translations/en.json",
	}
	if len(files) != len(want) {
		t.Fatalf("got %d entries %v, want %v", len(files), keys(files), want)
	}
	for _, name := range want {
		f, ok := files[name]
		if !ok {
			t.Fatalf("missing %s in %v", name, keys(files))
		}
		if !f.Modified.Equal(modTime) {
			t.Errorf("%s mtime %v, want fixed %v", name, f.Modified, modTime)
		}
	}
	rc, _ := files["custom_components/grown/manifest.json"].Open()
	body, _ := io.ReadAll(rc)
	if string(body) != `{"domain":"grown"}` {
		t.Errorf("manifest body %q", body)
	}
}

func TestBuildIsDeterministic(t *testing.T) {
	a, err := Build(testFS(), "c/grown", "p")
	if err != nil {
		t.Fatal(err)
	}
	// Different source mtimes must not change the bytes.
	fs2 := testFS()
	for k, v := range fs2 {
		v.ModTime = time.Now()
		fs2[k] = v
	}
	b, err := Build(fs2, "c/grown", "p")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Fatal("zip bytes differ between builds")
	}
}

func TestBuildEmptyRootFails(t *testing.T) {
	if _, err := Build(fstest.MapFS{"x/.hidden": {}}, "x", "p"); err == nil {
		t.Fatal("expected an error for an empty component")
	}
}

func TestHandler(t *testing.T) {
	h := New(testFS(), "c/grown", "custom_components/grown")

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, Path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("content-type %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc == "" || !bytes.Contains([]byte(cc), []byte("public")) {
		t.Errorf("cache-control %q", cc)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag")
	}
	unzip(t, rec.Body.Bytes())

	req := httptest.NewRequest(http.MethodGet, Path, nil)
	req.Header.Set("If-None-Match", `"other", `+etag)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Fatalf("If-None-Match: status %d body %d", rec.Code, rec.Body.Len())
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodHead, Path, nil))
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 || rec.Header().Get("Content-Length") == "" {
		t.Fatalf("HEAD: status %d body %d", rec.Code, rec.Body.Len())
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, Path, nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status %d", rec.Code)
	}
}

// TestEmbeddedComponent checks the real embedded integration: __init__.py is
// included (go:embed drops _-prefixed files without all:) and the manifest
// is valid for Home Assistant.
func TestEmbeddedComponent(t *testing.T) {
	rec := httptest.NewRecorder()
	Embedded().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, Path, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	files := unzip(t, rec.Body.Bytes())
	for _, name := range []string{
		"custom_components/grown/__init__.py",
		"custom_components/grown/manifest.json",
		"custom_components/grown/config_flow.py",
		"custom_components/grown/translations/en.json",
	} {
		if _, ok := files[name]; !ok {
			t.Errorf("embedded zip lacks %s (have %v)", name, keys(files))
		}
	}
	for name := range files {
		if bytes.Contains([]byte(name), []byte("__pycache__")) || bytes.Contains([]byte(name), []byte("/tests/")) {
			t.Errorf("unexpected entry %s", name)
		}
	}
	rc, err := files["custom_components/grown/manifest.json"].Open()
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Domain     string `json:"domain"`
		ConfigFlow bool   `json:"config_flow"`
		IotClass   string `json:"iot_class"`
		Version    string `json:"version"`
	}
	if err := json.NewDecoder(rc).Decode(&m); err != nil {
		t.Fatal(err)
	}
	if m.Domain != "grown" || !m.ConfigFlow || m.IotClass != "cloud_polling" || m.Version == "" {
		t.Errorf("manifest %+v", m)
	}
}

func keys(m map[string]*zip.File) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
