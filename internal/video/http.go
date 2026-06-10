package video

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

// BlobStore is the subset of the Drive blob store the video library needs.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
	Delete(ctx context.Context, key string) error
}

// HTTP serves video upload + stream/download over raw HTTP (not gRPC), mirroring
// the Drive and Mail attachment blob endpoints.
type HTTP struct {
	repo   *Repository
	shares *ShareRepository
	blobs  BlobStore
}

// NewHTTP constructs the raw HTTP handlers. shares may be nil to disable
// share-link stream access (safe for deployments that don't need it).
func NewHTTP(repo *Repository, shares *ShareRepository, blobs BlobStore) *HTTP {
	return &HTTP{repo: repo, shares: shares, blobs: blobs}
}

func randKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "video/" + hex.EncodeToString(b)
}

const maxUpload = 2 << 30 // 2 GiB per upload

// UploadHandler stores an uploaded video (multipart field "file") in the blob
// store, records its metadata, and returns the created Video as JSON. Optional
// form fields: title, description, duration_seconds, thumbnail_data_url.
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
		if ct == "" || !strings.HasPrefix(ct, "video/") {
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
			title = "Untitled video"
		}
		duration, _ := strconv.ParseFloat(r.FormValue("duration_seconds"), 64)

		v, err := h.repo.Create(r.Context(), o.ID, u.ID, CreateParams{
			Title:            title,
			Description:      strings.TrimSpace(r.FormValue("description")),
			ContentType:      ct,
			Size:             fh.Size,
			DurationSeconds:  duration,
			ThumbnailDataURL: r.FormValue("thumbnail_data_url"),
			BlobKey:          key,
		})
		if err != nil {
			// Roll back the orphaned blob; best-effort.
			_ = h.blobs.Delete(r.Context(), key)
			http.Error(w, "save video", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toProto(v))
	})
}

func trimExt(name string) string {
	if i := strings.LastIndex(name, "."); i > 0 {
		return name[:i]
	}
	return name
}

// VideoID extracts the id from /api/v1/videos/{id}/content.
func VideoID(path string) (string, bool) {
	const prefix = "/api/v1/videos/"
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

// StreamHandler streams a video blob with HTTP range support so the HTML5
// <video> element can seek. ?download=1 forces a save-to-disk disposition.
// Access is permitted for: (1) org member whose org owns the video, or (2) an
// org member the video has been individually shared with.
func (h *HTTP) StreamHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		o, hasOrg := auth.OrgFromContext(ctx)
		u, hasUser := auth.UserFromContext(ctx)
		if !hasOrg || !hasUser {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := VideoID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		// Try org-owned.
		v, err := h.repo.Get(ctx, o.ID, id)
		if err != nil && h.shares != nil {
			// Try individually-shared.
			shared, shareErr := h.shares.IsSharedWithUser(ctx, id, u.ID)
			if shareErr == nil && shared {
				v, err = h.repo.GetByID(ctx, id)
			}
		}
		if err != nil {
			http.Error(w, "video not found", http.StatusNotFound)
			return
		}
		body, ct, _, err := h.blobs.Get(r.Context(), v.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = v.ContentType
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Accept-Ranges", "bytes")
		if r.URL.Query().Get("download") == "1" {
			fname := sanitizeFilename(v.Title) + extFor(ct)
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
		http.ServeContent(w, r, "", v.UpdatedAt, bytes.NewReader(data))
	})
}

// SharedTokenID extracts the token from /api/v1/videos/shared/{token} (no
// /content suffix). Returns "", false when the path doesn't match.
func SharedTokenID(path string) (string, bool) {
	const prefix = "/api/v1/videos/shared/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	tok := strings.TrimPrefix(path, prefix)
	// Must not contain a slash (rules out /content variant).
	if tok == "" || strings.Contains(tok, "/") {
		return "", false
	}
	return tok, true
}

// SharedContentToken extracts the token from /api/v1/videos/shared/{token}/content.
func SharedContentToken(path string) (string, bool) {
	const prefix = "/api/v1/videos/shared/"
	const suffix = "/content"
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	tok := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if tok == "" || strings.Contains(tok, "/") {
		return "", false
	}
	return tok, true
}

// SharedMetaHandler is the unauthenticated JSON handler for
// GET /api/v1/videos/shared/{token} — resolves the token and returns video
// metadata including the content URL for the public player.
func (h *HTTP) SharedMetaHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.shares == nil {
			http.Error(w, "sharing not enabled", http.StatusNotImplemented)
			return
		}
		tok, ok := SharedTokenID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		_, v, err := h.shares.GetShareLink(r.Context(), tok)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		type response struct {
			Title            string  `json:"title"`
			Description      string  `json:"description"`
			ContentType      string  `json:"content_type"`
			DurationSeconds  float64 `json:"duration_seconds"`
			ThumbnailDataURL string  `json:"thumbnail_data_url"`
			ContentURL       string  `json:"content_url"`
		}
		resp := response{
			Title:            v.Title,
			Description:      v.Description,
			ContentType:      v.ContentType,
			DurationSeconds:  v.DurationSeconds,
			ThumbnailDataURL: v.ThumbnailDataURL,
			ContentURL:       "/api/v1/videos/shared/" + tok + "/content",
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})
}

// SharedStreamHandler is the unauthenticated range-capable stream handler for
// GET /api/v1/videos/shared/{token}/content — validates the token and streams
// the blob exactly like StreamHandler.
func (h *HTTP) SharedStreamHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.shares == nil {
			http.Error(w, "sharing not enabled", http.StatusNotImplemented)
			return
		}
		tok, ok := SharedContentToken(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		_, v, err := h.shares.GetShareLink(r.Context(), tok)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		body, ct, _, err := h.blobs.Get(r.Context(), v.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = v.ContentType
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Accept-Ranges", "bytes")
		data, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, "read blob", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, "", v.UpdatedAt, bytes.NewReader(data))
	})
}

// CaptionID extracts the caption id from /api/v1/videos/captions/{id}/content.
func CaptionID(path string) (string, bool) {
	const prefix = "/api/v1/videos/captions/"
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

const maxCaptionUpload = 10 << 20 // 10 MiB

// CaptionUploadHandler handles POST /api/v1/videos/{videoId}/captions/upload.
// Multipart field "file" must be a .vtt file. Optional form fields: lang, label.
func (h *HTTP) CaptionUploadHandler(captions *CaptionRepository) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, ok := auth.UserFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "no org context", http.StatusInternalServerError)
			return
		}
		// Extract video id from /api/v1/videos/{videoId}/captions/upload
		const pathPrefix = "/api/v1/videos/"
		const pathSuffix = "/captions/upload"
		path := r.URL.Path
		if !strings.HasPrefix(path, pathPrefix) || !strings.HasSuffix(path, pathSuffix) {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		videoID := strings.TrimSuffix(strings.TrimPrefix(path, pathPrefix), pathSuffix)
		if videoID == "" || strings.Contains(videoID, "/") {
			http.Error(w, "bad video id", http.StatusBadRequest)
			return
		}
		// Verify video exists in org.
		if _, err := h.repo.Get(r.Context(), o.ID, videoID); err != nil {
			http.Error(w, "video not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(maxCaptionUpload); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		fhs := r.MultipartForm.File["file"]
		if len(fhs) == 0 {
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		fh := fhs[0]
		f, err := fh.Open()
		if err != nil {
			http.Error(w, "open file", http.StatusBadRequest)
			return
		}
		defer f.Close()

		// Reuse randKey but with caption/ prefix.
		key := "caption/" + strings.TrimPrefix(randKey(), "video/")
		if err := h.blobs.Put(r.Context(), key, "text/vtt", fh.Size, f); err != nil {
			http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
			return
		}
		lang := strings.TrimSpace(r.FormValue("lang"))
		if lang == "" {
			lang = "en"
		}
		label := strings.TrimSpace(r.FormValue("label"))
		if label == "" {
			label = lang
		}
		c, err := captions.CreateCaption(r.Context(), o.ID, videoID, lang, label, key)
		if err != nil {
			_ = h.blobs.Delete(r.Context(), key)
			http.Error(w, "save caption", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(toCaptionProto(c))
	})
}

// CaptionStreamHandler streams a .vtt blob for GET /api/v1/videos/captions/{id}/content.
func (h *HTTP) CaptionStreamHandler(captions *CaptionRepository) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		o, ok := auth.OrgFromContext(ctx)
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := CaptionID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		c, err := captions.GetCaption(ctx, o.ID, id)
		if err != nil {
			http.Error(w, "caption not found", http.StatusNotFound)
			return
		}
		body, _, _, err := h.blobs.Get(ctx, c.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		w.Header().Set("Content-Type", "text/vtt")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		_, _ = io.Copy(w, body)
	})
}

func sanitizeFilename(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "video"
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
	case strings.Contains(ct, "mp4"):
		return ".mp4"
	case strings.Contains(ct, "webm"):
		return ".webm"
	case strings.Contains(ct, "ogg"):
		return ".ogv"
	case strings.Contains(ct, "quicktime"):
		return ".mov"
	case strings.Contains(ct, "x-matroska"):
		return ".mkv"
	default:
		return ""
	}
}
