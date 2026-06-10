package books

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"

	"google.golang.org/protobuf/encoding/protojson"

	"code.pick.haus/grown/grown/internal/auth"
)

// BlobStore is the subset of the Drive blob store the books library needs.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// Files serves book-file + cover upload/download over raw HTTP (not gRPC).
type Files struct {
	repo  *Repository
	blobs BlobStore
}

// NewFiles constructs the file handlers.
func NewFiles(repo *Repository, blobs BlobStore) *Files {
	return &Files{repo: repo, blobs: blobs}
}

func randKey(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

const maxBookFile = 128 << 20 // 128 MiB per book file
const maxCover = 8 << 20      // 8 MiB per cover image

// contentTypeFor returns a sensible MIME type for an ebook format.
func contentTypeFor(format string) string {
	switch format {
	case "epub":
		return "application/epub+zip"
	case "pdf":
		return "application/pdf"
	case "mobi":
		return "application/x-mobipocket-ebook"
	case "txt":
		return "text/plain; charset=utf-8"
	case "cbz":
		return "application/vnd.comicbook+zip"
	default:
		return "application/octet-stream"
	}
}

// --- path matching -------------------------------------------------------

// FileID extracts the id from /api/v1/books/{id}/file.
func FileID(p string) (string, bool) {
	return matchID(p, "/api/v1/books/", "/file")
}

// CoverID extracts the id from /api/v1/books/{id}/cover.
func CoverID(p string) (string, bool) {
	return matchID(p, "/api/v1/books/", "/cover")
}

func matchID(p, prefix, suffix string) (string, bool) {
	if !strings.HasPrefix(p, prefix) || !strings.HasSuffix(p, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(p, prefix), suffix)
	if id == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

// --- book file -----------------------------------------------------------

// UploadFileHandler stores the uploaded book file (multipart field "file")
// for the book id in the path and returns the updated book metadata.
func (f *Files) UploadFileHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := FileID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		book, err := f.repo.Get(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "book not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(maxBookFile); err != nil {
			http.Error(w, "bad multipart form", http.StatusBadRequest)
			return
		}
		fhs := r.MultipartForm.File["file"]
		if len(fhs) == 0 {
			http.Error(w, "no file uploaded", http.StatusBadRequest)
			return
		}
		fh := fhs[0]
		src, err := fh.Open()
		if err != nil {
			http.Error(w, "open file", http.StatusBadRequest)
			return
		}
		defer src.Close()
		ct := fh.Header.Get("Content-Type")
		if ct == "" || ct == "application/octet-stream" {
			ct = contentTypeFor(book.Format)
		}
		key := randKey("books/file/")
		if err := f.blobs.Put(r.Context(), key, ct, fh.Size, src); err != nil {
			http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
			return
		}
		updated, err := f.repo.SetFile(r.Context(), o.ID, id, key, fh.Filename, ct, fh.Size)
		if err != nil {
			http.Error(w, "save file metadata", http.StatusInternalServerError)
			return
		}
		writeJSON(w, updated)
	})
}

// DownloadFileHandler streams a book file with its filename + content type.
func (f *Files) DownloadFileHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := FileID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		book, err := f.repo.Get(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "book not found", http.StatusNotFound)
			return
		}
		if book.FileKey == nil || *book.FileKey == "" {
			http.Error(w, "book has no file", http.StatusNotFound)
			return
		}
		body, ct, size, err := f.blobs.Get(r.Context(), *book.FileKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = book.ContentType
		}
		filename := book.FileName
		if filename == "" {
			filename = downloadName(book)
		}
		w.Header().Set("Content-Type", ct)
		// inline so the browser can render PDFs in an iframe; the UI offers an
		// explicit "Download" action that re-requests with ?dl=1.
		disp := "inline"
		if r.URL.Query().Get("dl") == "1" {
			disp = "attachment"
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename=%q", disp, filename))
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	})
}

// --- cover ---------------------------------------------------------------

// UploadCoverHandler stores the uploaded cover image (multipart field "file").
func (f *Files) UploadCoverHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := CoverID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		if _, err := f.repo.Get(r.Context(), o.ID, id); err != nil {
			http.Error(w, "book not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(maxCover); err != nil {
			http.Error(w, "bad multipart form", http.StatusBadRequest)
			return
		}
		fhs := r.MultipartForm.File["file"]
		if len(fhs) == 0 {
			http.Error(w, "no file uploaded", http.StatusBadRequest)
			return
		}
		fh := fhs[0]
		src, err := fh.Open()
		if err != nil {
			http.Error(w, "open file", http.StatusBadRequest)
			return
		}
		defer src.Close()
		ct := fh.Header.Get("Content-Type")
		if ct == "" {
			ct = "image/jpeg"
		}
		key := randKey("books/cover/")
		if err := f.blobs.Put(r.Context(), key, ct, fh.Size, src); err != nil {
			http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
			return
		}
		updated, err := f.repo.SetCover(r.Context(), o.ID, id, key)
		if err != nil {
			http.Error(w, "save cover metadata", http.StatusInternalServerError)
			return
		}
		writeJSON(w, updated)
	})
}

// CoverHandler streams a book's cover image (cacheable).
func (f *Files) CoverHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := CoverID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		book, err := f.repo.Get(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "book not found", http.StatusNotFound)
			return
		}
		if book.CoverKey == nil || *book.CoverKey == "" {
			http.Error(w, "no cover", http.StatusNotFound)
			return
		}
		body, ct, size, err := f.blobs.Get(r.Context(), *book.CoverKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = "image/jpeg"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=3600")
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	})
}

func downloadName(b Book) string {
	base := b.Title
	if base == "" {
		base = "book"
	}
	return path.Clean(strings.ReplaceAll(base, "/", "-")) + "." + b.Format
}

// bookJSONMarshaler matches the gateway's marshaler (snake_case proto names,
// unpopulated fields emitted) so raw-route responses are shaped identically to
// the gRPC-gateway JSON the frontend already consumes.
var bookJSONMarshaler = protojson.MarshalOptions{UseProtoNames: true, EmitUnpopulated: true}

func writeJSON(w http.ResponseWriter, b Book) {
	out, err := bookJSONMarshaler.Marshal(toProto(b))
	if err != nil {
		http.Error(w, "encode response", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(out)
}
