package mail

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"code.pick.haus/grown/grown/internal/auth"
)

// BlobStore is the subset of the Drive blob store the mail attachments need.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// Attachments serves attachment upload + download over raw HTTP (not gRPC).
type Attachments struct {
	repo  *Repository
	blobs BlobStore
}

// NewAttachments constructs the attachment handlers.
func NewAttachments(repo *Repository, blobs BlobStore) *Attachments {
	return &Attachments{repo: repo, blobs: blobs}
}

func randKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "mail/att/" + hex.EncodeToString(b)
}

const maxAttachment = 32 << 20 // 32 MiB per request

// UploadHandler stores uploaded files (multipart field "file") in the blob store
// and returns their metadata as {"attachments":[{id,filename,content_type,size}]}.
func (a *Attachments) UploadHandler() http.Handler {
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
		if err := r.ParseMultipartForm(maxAttachment); err != nil {
			http.Error(w, "bad multipart form", http.StatusBadRequest)
			return
		}
		files := r.MultipartForm.File["file"]
		out := make([]Attachment, 0, len(files))
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
			key := randKey()
			if err := a.blobs.Put(r.Context(), key, ct, fh.Size, f); err != nil {
				f.Close()
				http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
				return
			}
			f.Close()
			meta, err := a.repo.CreateAttachment(r.Context(), AttachmentMeta{
				Attachment: Attachment{Filename: fh.Filename, ContentType: ct, Size: fh.Size},
				OrgID:      o.ID, OwnerID: u.ID, BlobKey: key,
			})
			if err != nil {
				http.Error(w, "save attachment", http.StatusInternalServerError)
				return
			}
			out = append(out, meta.Attachment)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"attachments": out})
	})
}

// AttachmentID extracts the id from /api/v1/mail/attachments/{id}/content.
func AttachmentID(path string) (string, bool) {
	const prefix = "/api/v1/mail/attachments/"
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

// DownloadHandler streams an attachment blob with its filename + content type.
func (a *Attachments) DownloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := AttachmentID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		meta, err := a.repo.GetAttachment(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "attachment not found", http.StatusNotFound)
			return
		}
		body, ct, size, err := a.blobs.Get(r.Context(), meta.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		if ct == "" {
			ct = meta.ContentType
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", meta.Filename))
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	})
}
