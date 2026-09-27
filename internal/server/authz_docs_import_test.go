package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/users"
)

func convertReq(path string, body []byte, user bool) *http.Request {
	r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	if user {
		r = r.WithContext(auth.WithUser(r.Context(), users.User{ID: "u1", OrgID: "o1"}))
	}
	return r
}

// TestDocsImportRejectsBadInput: POST /api/v1/docs/import refuses anonymous
// callers, oversized uploads (413, not a silently truncated import) and
// files pandoc can't read (422, not 500), without echoing pandoc's output.
func TestDocsImportRejectsBadInput(t *testing.T) {
	cases := []struct {
		name string
		path string
		body []byte
		user bool
		want int
	}{
		{"anonymous", "/api/v1/docs/import?from=md", []byte("# hi"), false, http.StatusUnauthorized},
		{"unsupported format", "/api/v1/docs/import?from=exe", []byte("MZ"), true, http.StatusBadRequest},
		{"format injection", "/api/v1/docs/import?from=md%20--lua-filter%3D%2Ftmp%2Fx", []byte("# hi"), true, http.StatusBadRequest},
		{"oversized", "/api/v1/docs/import?from=md", bytes.Repeat([]byte("a"), docs.MaxConvertBytes+1), true, http.StatusRequestEntityTooLarge},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			serveDocsImport(w, convertReq(c.path, c.body, c.user))
			if w.Code != c.want {
				t.Fatalf("status %d, want %d (%.200s)", w.Code, c.want, w.Body.String())
			}
		})
	}
	if _, err := exec.LookPath("pandoc"); err != nil {
		t.Skip("pandoc not installed")
	}
	// Garbage that claims to be a docx: the uploader's error, not ours.
	w := httptest.NewRecorder()
	serveDocsImport(w, convertReq("/api/v1/docs/import?from=docx", []byte("this is not a zip archive"), true))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("garbage docx: status %d, want 422 (%.200s)", w.Code, w.Body.String())
	}
	if b := w.Body.String(); strings.Contains(b, "grown-docs-import") || strings.Contains(b, "pandoc") || strings.Contains(b, "/") {
		t.Errorf("error leaks pandoc details: %q", b)
	}
	// A valid file imports, with active content stripped by the sanitize
	// filter and no server file inlined through the sandbox.
	w = httptest.NewRecorder()
	serveDocsImport(w, convertReq("/api/v1/docs/import?from=md", []byte("# Title\n\n<script>alert(1)</script>\n\n![x](/etc/passwd)\n\n[a](javascript:alert(2))\n"), true))
	if w.Code != http.StatusOK {
		t.Fatalf("md import: %d %s", w.Code, w.Body.String())
	}
	if b := w.Body.String(); !strings.Contains(b, "Title") || strings.Contains(b, "<script") || strings.Contains(b, "javascript:") || strings.Contains(b, "root:") {
		t.Errorf("unsanitized import: %s", b)
	}
}

// TestDocsConvertRejectsOversize: the export side refuses (413) rather than
// converting a truncated document.
func TestDocsConvertRejectsOversize(t *testing.T) {
	w := httptest.NewRecorder()
	serveDocsConvert(w, convertReq("/api/v1/docs/convert?to=md", bytes.Repeat([]byte("a"), docs.MaxConvertBytes+1), true), nil)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d, want 413", w.Code)
	}
	w = httptest.NewRecorder()
	serveDocsConvert(w, convertReq("/api/v1/docs/convert?to=md", []byte("<p>x</p>"), false), nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: status %d, want 401", w.Code)
	}
}

// TestDocsConvertPDFWithoutEngine: a PDF export on a server with no PDF
// engine is a 501 with a clear message, never a 500, and the capabilities
// endpoint says so.
func TestDocsConvertPDFWithoutEngine(t *testing.T) {
	if docs.PDFEngine() != "" {
		t.Skip("a PDF engine is installed")
	}
	w := httptest.NewRecorder()
	serveDocsConvert(w, convertReq("/api/v1/docs/convert?to=pdf", []byte("<p>x</p>"), true), nil)
	if w.Code != http.StatusNotImplemented && w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d (%s), want 501/503", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "not installed") && !strings.Contains(w.Body.String(), "no PDF engine") {
		t.Errorf("body = %q", w.Body.String())
	}

	w = httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/docs/convert/capabilities", nil)
	serveDocsConvertCapabilities(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous capabilities: %d", w.Code)
	}
	w = httptest.NewRecorder()
	r = r.WithContext(auth.WithUser(r.Context(), users.User{ID: "u1", OrgID: "o1"}))
	serveDocsConvertCapabilities(w, r)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"pdf":false`) {
		t.Errorf("capabilities: %d %s", w.Code, w.Body.String())
	}
}

// exportBlobs is a one-picture blob store for TestDocsConvertResolvesAssets.
type exportBlobs map[string][]byte

func (b exportBlobs) Put(context.Context, string, string, int64, io.Reader) error { return nil }
func (b exportBlobs) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	d, ok := b[key]
	if !ok {
		return nil, "", 0, errors.New("not found")
	}
	return io.NopCloser(bytes.NewReader(d)), "image/png", int64(len(d)), nil
}

// TestDocsConvertResolvesAssets: stored pictures of a readable document are
// embedded in a pandoc export; another document's are left out.
func TestDocsConvertResolvesAssets(t *testing.T) {
	if _, err := exec.LookPath("pandoc"); err != nil {
		t.Skip("pandoc not installed")
	}
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC")
	sha := strings.Repeat("c", 64)
	assets := docs.NewAssets(exportBlobs{"docs/mine/" + sha: png, "docs/theirs/" + sha: png},
		func(_ *http.Request, id string) (bool, bool) { return id == "mine", true })
	for doc, want := range map[string]bool{"mine": true, "theirs": false} {
		w := httptest.NewRecorder()
		body := []byte(`<p>x <img src="` + docs.AssetURL(doc, sha) + `"></p>`)
		serveDocsConvert(w, convertReq("/api/v1/docs/convert?to=odt", body, true), assets)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status %d %s", doc, w.Code, w.Body.String())
		}
		out := w.Body.Bytes()
		zr, err := zip.NewReader(bytes.NewReader(out), int64(len(out)))
		if err != nil {
			t.Fatal(err)
		}
		got := false
		for _, f := range zr.File {
			got = got || strings.HasPrefix(f.Name, "Pictures/")
		}
		if got != want {
			t.Errorf("%s: picture exported = %v, want %v", doc, got, want)
		}
	}
}
