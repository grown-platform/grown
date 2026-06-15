package alexa

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/music"
)

// --- fake blob store ---

type fakeBlobs struct {
	data []byte
	ct   string
	err  error
}

func (b fakeBlobs) Get(_ context.Context, _ string) (io.ReadCloser, string, int64, error) {
	if b.err != nil {
		return nil, "", 0, b.err
	}
	return io.NopCloser(bytes.NewReader(b.data)), b.ct, int64(len(b.data)), nil
}

func newStreamHandler(tracks []music.Track, blobs BlobStore) *Handler {
	return New(Options{
		Repo:       fakeRepo{tracks: tracks},
		Blobs:      blobs,
		OrgID:      "org-1",
		Secret:     []byte("stream-secret"),
		BaseURL:    "https://pick.haus",
		SkipVerify: true,
	})
}

// --- POST /alexa entry point ---

func TestHandlerRejectsNonPost(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	rr := httptest.NewRecorder()
	h.Handler(rr, httptest.NewRequest(http.MethodGet, "/alexa", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d want %d", rr.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandlerRejectsBadJSON(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/alexa", strings.NewReader("{not json"))
	h.Handler(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("bad json status = %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestHandlerHappyPathLaunch(t *testing.T) {
	h := newTestHandler(makeTracks(3))
	body, _ := json.Marshal(Request{Request: ReqBody{Type: TypeLaunchRequest, RequestID: "r1"}})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/alexa", bytes.NewReader(body))
	h.Handler(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("launch status = %d want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q want application/json", ct)
	}
	var resp Response
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not valid JSON: %v", err)
	}
	if len(resp.Body.Directives) != 1 || resp.Body.Directives[0].Type != DirectivePlay {
		t.Fatalf("expected Play directive, got %+v", resp.Body.Directives)
	}
}

func TestHandlerVerifierRejectsUnsigned(t *testing.T) {
	// SkipVerify false → a real verifier is attached; an unsigned request must be
	// rejected at the signature step (before any routing).
	h := New(Options{
		Repo:    fakeRepo{tracks: makeTracks(2)},
		OrgID:   "org-1",
		Secret:  []byte("k"),
		BaseURL: "https://pick.haus",
	})
	body, _ := json.Marshal(Request{Request: ReqBody{Type: TypeLaunchRequest}})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/alexa", bytes.NewReader(body))
	h.Handler(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("unsigned request status = %d want %d", rr.Code, http.StatusBadRequest)
	}
	if !strings.Contains(rr.Body.String(), "invalid signature") {
		t.Fatalf("expected invalid-signature error, got %q", rr.Body.String())
	}
}

// --- signed stream handler ---

// signedURLPath builds the path+query for a validly-signed stream request.
func signedURLPath(secret []byte, id string, e int64) string {
	sig := signStream(secret, id, e)
	return streamPathPrefix + id + "?e=" + strconv.FormatInt(e, 10) + "&s=" + sig
}

func TestStreamHandlerServesBytes(t *testing.T) {
	secret := []byte("stream-secret")
	track := music.Track{ID: "abc", BlobKey: "k", ContentType: "audio/mpeg", UpdatedAt: time.Unix(1000, 0)}
	h := newStreamHandler([]music.Track{track}, fakeBlobs{data: []byte("hello-bytes"), ct: "audio/mpeg"})

	e := time.Now().Add(time.Hour).Unix()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, signedURLPath(secret, "abc", e), nil)
	h.StreamHandler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("stream status = %d want 200 (body %q)", rr.Code, rr.Body.String())
	}
	if rr.Body.String() != "hello-bytes" {
		t.Fatalf("body = %q want hello-bytes", rr.Body.String())
	}
	if ar := rr.Header().Get("Accept-Ranges"); ar != "bytes" {
		t.Fatalf("Accept-Ranges = %q want bytes", ar)
	}
}

func TestStreamHandlerBadPath(t *testing.T) {
	h := newStreamHandler(nil, fakeBlobs{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/not/a/stream/path", nil)
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("bad path status = %d want 400", rr.Code)
	}
}

func TestStreamHandlerMissingSignature(t *testing.T) {
	h := newStreamHandler(nil, fakeBlobs{})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, streamPathPrefix+"abc", nil) // no e/s
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("missing sig status = %d want 403", rr.Code)
	}
}

func TestStreamHandlerExpired(t *testing.T) {
	secret := []byte("stream-secret")
	h := newStreamHandler(nil, fakeBlobs{})
	e := time.Now().Add(-time.Minute).Unix() // already expired
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, signedURLPath(secret, "abc", e), nil)
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expired status = %d want 403", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "expired") {
		t.Fatalf("expected expiry error, got %q", rr.Body.String())
	}
}

func TestStreamHandlerWrongSignature(t *testing.T) {
	h := newStreamHandler(nil, fakeBlobs{})
	e := time.Now().Add(time.Hour).Unix()
	// Sign with a DIFFERENT secret than the handler's.
	bad := signStream([]byte("other-secret"), "abc", e)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		streamPathPrefix+"abc?e="+strconv.FormatInt(e, 10)+"&s="+bad, nil)
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("wrong sig status = %d want 403", rr.Code)
	}
}

func TestStreamHandlerTrackNotFound(t *testing.T) {
	secret := []byte("stream-secret")
	// Valid signature for an id the repo doesn't have.
	h := newStreamHandler([]music.Track{{ID: "other"}}, fakeBlobs{})
	e := time.Now().Add(time.Hour).Unix()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, signedURLPath(secret, "missing", e), nil)
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("not-found status = %d want 404", rr.Code)
	}
}

func TestStreamHandlerBlobError(t *testing.T) {
	secret := []byte("stream-secret")
	track := music.Track{ID: "abc", BlobKey: "k"}
	h := newStreamHandler([]music.Track{track}, fakeBlobs{err: errors.New("blob down")})
	e := time.Now().Add(time.Hour).Unix()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, signedURLPath(secret, "abc", e), nil)
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("blob-error status = %d want 500", rr.Code)
	}
}

func TestStreamHandlerFallsBackToTrackContentType(t *testing.T) {
	secret := []byte("stream-secret")
	// Blob returns an empty/non-audio content type → handler uses the track's.
	track := music.Track{ID: "abc", BlobKey: "k", ContentType: "audio/flac"}
	h := newStreamHandler([]music.Track{track}, fakeBlobs{data: []byte("x"), ct: "application/octet-stream"})
	e := time.Now().Add(time.Hour).Unix()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, signedURLPath(secret, "abc", e), nil)
	h.StreamHandler().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "audio/flac" {
		t.Fatalf("Content-Type = %q want audio/flac (track fallback)", ct)
	}
}

func TestLoadTracks(t *testing.T) {
	h := newTestHandler(makeTracks(4))
	got, err := h.loadTracks(context.Background())
	if err != nil {
		t.Fatalf("loadTracks err: %v", err)
	}
	if len(got) != 4 {
		t.Fatalf("loadTracks len = %d want 4", len(got))
	}
}
