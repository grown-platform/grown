package photos

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"net/http"
	"strings"

	// Register decoders so image.DecodeConfig can read dimensions. Stdlib covers
	// the common web formats; other formats (e.g. webp) still upload fine, they
	// just won't have decoded width/height.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// BlobStore is the subset of the Drive blob store the photo handlers need.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
	Delete(ctx context.Context, key string) error
}

// Media serves photo upload + raw image download over plain HTTP (not gRPC).
type Media struct {
	repo  *Repository
	blobs BlobStore
}

// NewMedia constructs the photo media handlers.
func NewMedia(repo *Repository, blobs BlobStore) *Media {
	return &Media{repo: repo, blobs: blobs}
}

func randKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "photos/" + hex.EncodeToString(b)
}

const maxUpload = 64 << 20 // 64 MiB per request

func isImage(ct string) bool {
	return strings.HasPrefix(strings.ToLower(ct), "image/")
}

// UploadHandler stores uploaded images (multipart field "file") in the blob
// store, decodes their dimensions, and returns the created photos as
// {"photos":[Photo,...]}.
func (m *Media) UploadHandler() http.Handler {
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
		if err := r.ParseMultipartForm(maxUpload); err != nil {
			http.Error(w, "bad multipart form", http.StatusBadRequest)
			return
		}
		files := r.MultipartForm.File["file"]
		out := make([]*grownv1.Photo, 0, len(files))
		for _, fh := range files {
			f, err := fh.Open()
			if err != nil {
				http.Error(w, "open file", http.StatusBadRequest)
				return
			}
			ct := fh.Header.Get("Content-Type")
			if ct == "" {
				ct = "application/octet-stream"
			}
			if !isImage(ct) {
				f.Close()
				http.Error(w, "only image files are supported", http.StatusUnsupportedMediaType)
				return
			}
			// Read the whole file so we can both decode dimensions and re-stream
			// to the blob store. Bounded by maxUpload via ParseMultipartForm.
			data, err := io.ReadAll(io.LimitReader(f, maxUpload))
			f.Close()
			if err != nil {
				http.Error(w, "read file", http.StatusBadRequest)
				return
			}
			width, height := 0, 0
			if cfg, _, derr := image.DecodeConfig(bytes.NewReader(data)); derr == nil {
				width, height = cfg.Width, cfg.Height
			}
			key := randKey()
			if err := m.blobs.Put(r.Context(), key, ct, int64(len(data)), bytes.NewReader(data)); err != nil {
				http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
				return
			}
			p, err := m.repo.CreatePhoto(r.Context(), o.ID, u.ID, NewPhoto{
				Filename:    fh.Filename,
				ContentType: ct,
				Size:        int64(len(data)),
				Width:       int32(width),
				Height:      int32(height),
				BlobKey:     key,
			})
			if err != nil {
				http.Error(w, "save photo", http.StatusInternalServerError)
				return
			}
			out = append(out, photoToProto(p))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"photos": out})
	})
}

// PhotoID extracts the id from /api/v1/photos/{id}/content.
func PhotoID(path string) (string, bool) {
	const prefix = "/api/v1/photos/"
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

// DownloadHandler streams a photo's image bytes. ?download=1 forces an
// attachment (download) disposition; otherwise the image is served inline so it
// can render in <img> tags and the lightbox.
func (m *Media) DownloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := PhotoID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		p, err := m.repo.GetPhoto(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "photo not found", http.StatusNotFound)
			return
		}
		body, ct, size, err := m.blobs.Get(r.Context(), p.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = p.ContentType
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=86400")
		disposition := "inline"
		if r.URL.Query().Get("download") != "" {
			disposition = "attachment"
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename=%q", disposition, p.Filename))
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	})
}
