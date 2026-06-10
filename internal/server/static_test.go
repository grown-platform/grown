package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticHandler_ServesIndexAtRoot(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "<!doctype html><html>index</html>")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "<!doctype html>") {
		t.Errorf("body: got %q, want index.html content", rr.Body.String())
	}
}

func TestStaticHandler_ServesAssetByExactPath(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "assets/app.js"), "console.log('hi')")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "console.log") {
		t.Errorf("body: got %q, want js content", rr.Body.String())
	}
}

func TestStaticHandler_SPAFallbackToIndex(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "<!doctype html><html>spa</html>")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/coming-soon/drive", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (SPA fallback)", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "spa") {
		t.Errorf("body: got %q, want index.html SPA content", rr.Body.String())
	}
}

func TestStaticHandler_DoesNotShadowAPIPaths(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "index.html"), "spa")

	h := StaticHandler(dir)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/whoami", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("/api/v1/* must return 404 from static handler so the gateway gets it; got %d", rr.Code)
	}
}

func TestStaticHandler_MissingDirReturns404(t *testing.T) {
	h := StaticHandler("/this/path/does/not/exist")
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("missing dir: got %d, want 404", rr.Code)
	}
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}
