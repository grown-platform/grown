package music

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
)

// BlobStore is the subset of the Drive blob store the music library needs.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
	Delete(ctx context.Context, key string) error
}

// RadioController is the subset of the radio.Recorder the HTTP layer drives:
// reference-counted start/stop of a station's live tap + recording.
type RadioController interface {
	Start(orgID, stationID, listenerID, ownerID string)
	Stop(stationID, listenerID string)
}

// HTTP serves track upload + stream/download over raw HTTP (not gRPC),
// mirroring the Drive and Video blob endpoints.
type HTTP struct {
	repo  *Repository
	blobs BlobStore
	radio RadioController
}

// NewHTTP constructs the raw HTTP handlers.
func NewHTTP(repo *Repository, blobs BlobStore) *HTTP {
	return &HTTP{repo: repo, blobs: blobs}
}

// WithRadio attaches the radio recorder so the radio control + proxy endpoints
// are active. Returns the receiver for chaining.
func (h *HTTP) WithRadio(rc RadioController) *HTTP {
	h.radio = rc
	return h
}

func randKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "music/" + hex.EncodeToString(b)
}

const maxUpload = 2 << 30 // 2 GiB per upload

// UploadHandler stores an uploaded audio file (multipart field "file") in the
// blob store, records its metadata, and returns the created Track as JSON.
// Optional form fields: title, artist, album, duration_seconds, artwork_data_url.
func (h *HTTP) UploadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "no org context", http.StatusInternalServerError)
			return
		}
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			http.Error(w, "bad multipart form", http.StatusBadRequest)
			return
		}
		fhs := r.MultipartForm.File["file"]
		if len(fhs) == 0 {
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		fh := fhs[0]
		if fh.Size > maxUpload {
			http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
			return
		}
		f, err := fh.Open()
		if err != nil {
			http.Error(w, "open file", http.StatusBadRequest)
			return
		}
		defer f.Close()

		ct := fh.Header.Get("Content-Type")
		if ct == "" || !strings.HasPrefix(ct, "audio/") {
			// Fall back to a sane default; the player still works for most types.
			if ct == "" {
				ct = "application/octet-stream"
			}
		}

		key := randKey()
		if err := h.blobs.Put(r.Context(), key, ct, fh.Size, f); err != nil {
			http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
			return
		}

		title := strings.TrimSpace(r.FormValue("title"))
		if title == "" {
			title = trimExt(fh.Filename)
		}
		if title == "" {
			title = "Untitled track"
		}
		duration, _ := strconv.ParseFloat(r.FormValue("duration_seconds"), 64)

		t, err := h.repo.CreateTrack(r.Context(), o.ID, u.ID, CreateTrackParams{
			Title:           title,
			Artist:          strings.TrimSpace(r.FormValue("artist")),
			Album:           strings.TrimSpace(r.FormValue("album")),
			ContentType:     ct,
			Size:            fh.Size,
			DurationSeconds: duration,
			ArtworkDataURL:  r.FormValue("artwork_data_url"),
			BlobKey:         key,
		})
		if err != nil {
			// Roll back the orphaned blob; best-effort.
			_ = h.blobs.Delete(r.Context(), key)
			http.Error(w, "save track", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(trackToProto(t))
	})
}

func trimExt(name string) string {
	if i := strings.LastIndex(name, "."); i > 0 {
		return name[:i]
	}
	return name
}

// TrackID extracts the id from /api/v1/music/{id}/content.
func TrackID(path string) (string, bool) {
	const prefix = "/api/v1/music/"
	const suffix = "/content"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// StreamHandler streams an audio blob with HTTP range support so the HTML5
// <audio> element can seek. ?download=1 forces a save-to-disk disposition.
func (h *HTTP) StreamHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := TrackID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		t, err := h.repo.GetTrack(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "track not found", http.StatusNotFound)
			return
		}
		body, ct, _, err := h.blobs.Get(r.Context(), t.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = t.ContentType
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Accept-Ranges", "bytes")
		if r.URL.Query().Get("download") == "1" {
			fname := sanitizeFilename(t.Title) + extFor(ct)
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fname))
		}
		// Buffer into a ReadSeeker so http.ServeContent can satisfy range
		// requests (the underlying S3 body is not seekable). Acceptable for the
		// homelab scale this library targets.
		data, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, "read blob", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, "", t.UpdatedAt, bytes.NewReader(data))
	})
}

func sanitizeFilename(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "track"
	}
	repl := func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}
	return strings.Map(repl, s)
}

func extFor(ct string) string {
	switch {
	case strings.Contains(ct, "mpeg"):
		return ".mp3"
	case strings.Contains(ct, "mp4"), strings.Contains(ct, "aac"):
		return ".m4a"
	case strings.Contains(ct, "ogg"):
		return ".ogg"
	case strings.Contains(ct, "flac"):
		return ".flac"
	case strings.Contains(ct, "wav"):
		return ".wav"
	default:
		return ""
	}
}
