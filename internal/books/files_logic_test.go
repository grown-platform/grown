package books

// files_logic_test.go — unit tests for the pure path-matching, content-type,
// download-name, key, and JSON-shaping helpers in files.go, plus the
// no-DB short-circuits of the raw HTTP file/cover handlers. None of these
// touch a database, so they run without GROWN_TEST_DSN.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
)

func TestContentTypeFor(t *testing.T) {
	cases := []struct {
		format string
		want   string
	}{
		{"epub", "application/epub+zip"},
		{"pdf", "application/pdf"},
		{"mobi", "application/x-mobipocket-ebook"},
		{"txt", "text/plain; charset=utf-8"},
		{"cbz", "application/vnd.comicbook+zip"},
		{"", "application/octet-stream"},
		{"docx", "application/octet-stream"},
		{"EPUB", "application/octet-stream"}, // case-sensitive: only lowercase known
	}
	for _, c := range cases {
		t.Run(c.format, func(t *testing.T) {
			if got := contentTypeFor(c.format); got != c.want {
				t.Errorf("contentTypeFor(%q) = %q, want %q", c.format, got, c.want)
			}
		})
	}
}

func TestFileID(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"valid", "/api/v1/books/abc123/file", "abc123", true},
		{"valid uuid-ish", "/api/v1/books/11111111-2222/file", "11111111-2222", true},
		{"wrong prefix", "/api/v2/books/abc/file", "", false},
		{"wrong suffix", "/api/v1/books/abc/cover", "", false},
		{"empty id", "/api/v1/books//file", "", false},
		{"id with slash", "/api/v1/books/a/b/file", "", false},
		// "/api/v1/books/file" keeps prefix, but "/file" is not a *trailing*
		// path segment to trim — the literal id becomes "file".
		{"id literally file", "/api/v1/books/file", "file", true},
		{"unrelated", "/health", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, ok := FileID(c.path)
			if id != c.wantID || ok != c.wantOK {
				t.Errorf("FileID(%q) = (%q,%v), want (%q,%v)", c.path, id, ok, c.wantID, c.wantOK)
			}
		})
	}
}

func TestCoverID(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"valid", "/api/v1/books/xyz/cover", "xyz", true},
		{"file suffix not cover", "/api/v1/books/xyz/file", "", false},
		{"empty id", "/api/v1/books//cover", "", false},
		{"nested id", "/api/v1/books/a/b/cover", "", false},
		{"id literally cover", "/api/v1/books/cover", "cover", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, ok := CoverID(c.path)
			if id != c.wantID || ok != c.wantOK {
				t.Errorf("CoverID(%q) = (%q,%v), want (%q,%v)", c.path, id, ok, c.wantID, c.wantOK)
			}
		})
	}
}

func TestMatchID_SuffixIsTrimmedOnce(t *testing.T) {
	// The id portion may itself end with characters that look like the suffix,
	// but matchID only trims the trailing suffix once.
	id, ok := matchID("/api/v1/books/myfile/file", "/api/v1/books/", "/file")
	if !ok || id != "myfile" {
		t.Errorf("matchID = (%q,%v), want (myfile,true)", id, ok)
	}
}

func TestDownloadName(t *testing.T) {
	cases := []struct {
		name string
		book Book
		want string
	}{
		{"normal", Book{Title: "Dune", Format: "epub"}, "Dune.epub"},
		{"empty title", Book{Title: "", Format: "pdf"}, "book.pdf"},
		{"slashes replaced", Book{Title: "a/b/c", Format: "txt"}, "a-b-c.txt"},
		// "/" -> "-" yields "x-.", path.Clean leaves it, then ".txt" appends.
		{"slash before dot", Book{Title: "x/.", Format: "txt"}, "x-..txt"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := downloadName(c.book); got != c.want {
				t.Errorf("downloadName(%+v) = %q, want %q", c.book, got, c.want)
			}
		})
	}
}

func TestRandKey(t *testing.T) {
	k := randKey("books/file/")
	if !strings.HasPrefix(k, "books/file/") {
		t.Errorf("randKey missing prefix: %q", k)
	}
	// prefix + 32 hex chars (16 bytes).
	if got := len(k) - len("books/file/"); got != 32 {
		t.Errorf("randKey hex part = %d chars, want 32", got)
	}
	// Two calls must not collide.
	if randKey("p") == randKey("p") {
		t.Errorf("randKey produced duplicate keys")
	}
}

func TestWriteJSON_ShapesProtoNames(t *testing.T) {
	rec := httptest.NewRecorder()
	cover := "books/cover/k"
	writeJSON(rec, Book{ID: "b1", Title: "T", Format: "epub", CoverKey: &cover, ProgressPercent: 42})

	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q, want application/json", ct)
	}
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("body not valid JSON: %v\n%s", err, rec.Body.String())
	}
	// snake_case proto names (UseProtoNames) and emitted-unpopulated fields.
	if _, ok := m["progress_percent"]; !ok {
		t.Errorf("expected snake_case key progress_percent, got keys: %v", keysOf(m))
	}
	if m["id"] != "b1" || m["title"] != "T" {
		t.Errorf("unexpected JSON values: %v", m)
	}
	// has_cover is derived from CoverKey; must be true here.
	if hc, ok := m["has_cover"].(bool); !ok || !hc {
		t.Errorf("expected has_cover=true, got %v", m["has_cover"])
	}
	// EmitUnpopulated: author present even though empty.
	if _, ok := m["author"]; !ok {
		t.Errorf("expected author key emitted even when empty")
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// --- handler short-circuits (no DB) -------------------------------------

func orgCtx(orgID string) context.Context {
	return auth.WithOrg(context.Background(), orgs.Org{ID: orgID, Slug: "default"})
}

// fileHandlers gathers the four file/cover handlers under test. We construct
// Files with nil repo/blobs because every case below short-circuits before
// touching them.
func newFilesForShortCircuit() *Files { return NewFiles(nil, nil) }

func TestFileHandlers_Unauthorized(t *testing.T) {
	f := newFilesForShortCircuit()
	handlers := map[string]struct {
		h    http.Handler
		path string
	}{
		"upload-file":   {f.UploadFileHandler(), "/api/v1/books/b1/file"},
		"download-file": {f.DownloadFileHandler(), "/api/v1/books/b1/file"},
		"upload-cover":  {f.UploadCoverHandler(), "/api/v1/books/b1/cover"},
		"cover":         {f.CoverHandler(), "/api/v1/books/b1/cover"},
	}
	for name, tc := range handlers {
		t.Run(name, func(t *testing.T) {
			// No org in context => 401, before any path or repo work.
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			rec := httptest.NewRecorder()
			tc.h.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s no-org: code = %d, want 401", name, rec.Code)
			}
		})
	}
}

func TestFileHandlers_BadPath(t *testing.T) {
	f := newFilesForShortCircuit()
	// Org present, but the path doesn't match the handler's id pattern.
	cases := []struct {
		name string
		h    http.Handler
		path string
	}{
		{"upload-file bad", f.UploadFileHandler(), "/api/v1/books//file"},
		{"download-file bad", f.DownloadFileHandler(), "/api/v1/books/a/b/file"},
		{"upload-cover bad", f.UploadCoverHandler(), "/api/v1/books//cover"},
		{"cover bad", f.CoverHandler(), "/api/v1/books/a/b/cover"},
		// wrong-suffix path also fails the id match.
		{"download wrong suffix", f.DownloadFileHandler(), "/api/v1/books/x/cover"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, c.path, nil).WithContext(orgCtx("org1"))
			rec := httptest.NewRecorder()
			c.h.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("%s: code = %d body=%q, want 400", c.name, rec.Code, rec.Body.String())
			}
		})
	}
}
