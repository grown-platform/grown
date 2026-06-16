package cloudimport

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ---- caller resolver helpers ----------------------------------------------

func okCaller(_ context.Context) (string, string, bool) {
	return "org1", "user1", true
}

func anonCaller(_ context.Context) (string, string, bool) {
	return "", "", false
}

// ---- ServeHTTP short-circuits ---------------------------------------------

// TestServeHTTP_Unauthorized verifies that an unresolved caller is rejected
// before any repo/orchestrator work happens (so a nil repo is safe here).
func TestServeHTTP_Unauthorized(t *testing.T) {
	h := NewHandler(nil, nil, anonCaller)
	req := httptest.NewRequest(http.MethodGet, mountPrefix+"/jobs", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if got := decodeErr(t, rec.Body.Bytes()); got != "no session" {
		t.Errorf("error = %q, want %q", got, "no session")
	}
}

// TestServeHTTP_Routing exercises the method/path switch. All of these paths
// short-circuit (404 / method-mismatch) before touching repo, so nil repo is
// fine. The authenticated routes that DO hit the repo are covered separately
// and DSN-gated.
func TestServeHTTP_Routing(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		want   int
	}{
		{"unknown path", http.MethodGet, mountPrefix + "/bogus", http.StatusNotFound},
		{"root", http.MethodGet, mountPrefix, http.StatusNotFound},
		{"upload wrong method GET", http.MethodGet, mountPrefix + "/upload", http.StatusNotFound},
		{"jobs wrong method POST", http.MethodPost, mountPrefix + "/jobs", http.StatusNotFound},
		{"jobs/{id} wrong method DELETE", http.MethodDelete, mountPrefix + "/jobs/abc", http.StatusNotFound},
		{"trailing slash unknown", http.MethodGet, mountPrefix + "/something/else", http.StatusNotFound},
	}
	h := NewHandler(nil, nil, okCaller)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Errorf("status = %d, want %d", rec.Code, tt.want)
			}
		})
	}
}

// ---- handleUpload pre-repo short-circuits ---------------------------------

func TestHandleUpload_ParseError(t *testing.T) {
	h := NewHandler(nil, nil, okCaller)
	// Body claims multipart but isn't — ParseMultipartForm fails before repo.
	req := httptest.NewRequest(http.MethodPost, mountPrefix+"/upload", strings.NewReader("not-multipart"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=xyz")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if msg := decodeErr(t, rec.Body.Bytes()); !strings.Contains(msg, "parse multipart") {
		t.Errorf("error = %q, want prefix 'parse multipart'", msg)
	}
}

func TestHandleUpload_MissingFilePart(t *testing.T) {
	// Valid multipart, but no "file" form field.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("notfile", "hello")
	_ = mw.Close()

	h := NewHandler(nil, nil, okCaller)
	req := httptest.NewRequest(http.MethodPost, mountPrefix+"/upload", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if msg := decodeErr(t, rec.Body.Bytes()); msg != "missing file part" {
		t.Errorf("error = %q, want 'missing file part'", msg)
	}
}

// ---- detectSourceFromFilename ---------------------------------------------

func TestDetectSourceFromFilename(t *testing.T) {
	tests := []struct {
		name string
		want ArchiveSource
	}{
		{"takeout-20240101.zip", SourceGoogleTakeout},
		{"Takeout.tgz", SourceGoogleTakeout},
		{"my-TAKEOUT-export.tar.gz", SourceGoogleTakeout},
		{"contacts.vcf", SourceFile},
		{"calendar.ics", SourceFile},
		{"", SourceFile},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detectSourceFromFilename(tt.name); got != tt.want {
				t.Errorf("detectSourceFromFilename(%q) = %q, want %q", tt.name, got, tt.want)
			}
		})
	}
}

// ---- jobToJSON ------------------------------------------------------------

func TestJobToJSON(t *testing.T) {
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	updated := created.Add(time.Hour)
	j := Job{
		ID:        "job-1",
		OrgID:     "org-1",
		UserID:    "user-1",
		Source:    "google_takeout",
		Filename:  "takeout.zip",
		Status:    StatusDone,
		CreatedAt: created,
		UpdatedAt: updated,
		Items: []Item{
			{ID: "it-1", Kind: "contacts", Count: 5, Status: ItemDone, Detail: "5 contacts imported"},
			{ID: "it-2", Kind: "photos", Count: 10, Status: ItemSkipped, Detail: "see Immich"},
		},
	}

	out := jobToJSON(j)

	if out["id"] != "job-1" {
		t.Errorf("id = %v", out["id"])
	}
	if out["status"] != StatusDone {
		t.Errorf("status = %v", out["status"])
	}
	if out["created_at"] != created.Unix() {
		t.Errorf("created_at = %v, want %d", out["created_at"], created.Unix())
	}
	if out["updated_at"] != updated.Unix() {
		t.Errorf("updated_at = %v, want %d", out["updated_at"], updated.Unix())
	}
	items, ok := out["items"].([]map[string]any)
	if !ok {
		t.Fatalf("items wrong type: %T", out["items"])
	}
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	if items[0]["kind"] != "contacts" || items[0]["count"] != 5 {
		t.Errorf("item0 = %v", items[0])
	}

	// Ensure it round-trips through JSON cleanly.
	if _, err := json.Marshal(out); err != nil {
		t.Errorf("json.Marshal: %v", err)
	}
}

func TestJobToJSON_EmptyItems(t *testing.T) {
	out := jobToJSON(Job{ID: "x"})
	items, ok := out["items"].([]map[string]any)
	if !ok {
		t.Fatalf("items wrong type: %T", out["items"])
	}
	if len(items) != 0 {
		t.Errorf("items len = %d, want 0", len(items))
	}
}

// ---- writeJSON / writeErr -------------------------------------------------

func TestWriteJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusTeapot, map[string]any{"hello": "world"})

	if rec.Code != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["hello"] != "world" {
		t.Errorf("body = %v", got)
	}
}

func TestWriteErr(t *testing.T) {
	rec := httptest.NewRecorder()
	writeErr(rec, http.StatusForbidden, "nope")
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d", rec.Code)
	}
	if msg := decodeErr(t, rec.Body.Bytes()); msg != "nope" {
		t.Errorf("error = %q", msg)
	}
}

// ---- limitedCopy ----------------------------------------------------------

func TestLimitedCopy_UnderLimit(t *testing.T) {
	src := strings.NewReader("hello world")
	var dst bytes.Buffer
	n, err := limitedCopy(&dst, src)
	if err != nil {
		t.Fatalf("limitedCopy: %v", err)
	}
	if n != int64(len("hello world")) {
		t.Errorf("n = %d, want %d", n, len("hello world"))
	}
	if dst.String() != "hello world" {
		t.Errorf("dst = %q", dst.String())
	}
}

// TestLimitedCopy_CapsAtLimit confirms the copy stops at maxArchiveSize+1,
// which the handler uses to detect oversized uploads without reading forever.
func TestLimitedCopy_CapsAtLimit(t *testing.T) {
	// Endless reader of 'a' bytes.
	src := endlessReader{}
	n, err := limitedCopy(io.Discard, src)
	if err != nil {
		t.Fatalf("limitedCopy: %v", err)
	}
	if n != maxArchiveSize+1 {
		t.Errorf("n = %d, want %d (maxArchiveSize+1)", n, maxArchiveSize+1)
	}
}

type endlessReader struct{}

func (endlessReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'a'
	}
	return len(p), nil
}

// ---- test helpers ---------------------------------------------------------

func decodeErr(t *testing.T, body []byte) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body %q: %v", body, err)
	}
	s, _ := m["error"].(string)
	return s
}
