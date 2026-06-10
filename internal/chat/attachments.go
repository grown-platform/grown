package chat

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

// BlobStore is the subset of the Drive blob store the chat attachments need.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// Attachment is the wire-format / JSON representation of a chat attachment.
type Attachment struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
	URL      string `json:"url"`
}

// AttachmentMeta is the full DB record (includes blob key).
type AttachmentMeta struct {
	Attachment
	OrgID     string
	MessageID string // may be "" before the message is posted
	BlobKey   string
}

// Attachments serves attachment upload + download over raw HTTP (not gRPC),
// mirroring the mail/attachments.go pattern exactly.
type Attachments struct {
	repo  *Repository
	blobs BlobStore
}

// NewAttachments constructs the attachment handlers.
func NewAttachments(repo *Repository, blobs BlobStore) *Attachments {
	return &Attachments{repo: repo, blobs: blobs}
}

func randChatKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "chat/att/" + hex.EncodeToString(b)
}

const maxChatAttachment = 32 << 20 // 32 MiB per request

// UploadHandler stores uploaded files (multipart field "file") in the blob
// store and returns their metadata as JSON:
//
//	{"attachments":[{id,name,mime_type,size,url}]}
//
// The attachments are not yet associated with a message; the client passes the
// returned ids when it POSTs the message.
func (a *Attachments) UploadHandler() http.Handler {
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
		if err := r.ParseMultipartForm(maxChatAttachment); err != nil {
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
			key := randChatKey()
			if err := a.blobs.Put(r.Context(), key, ct, fh.Size, f); err != nil {
				f.Close()
				http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
				return
			}
			f.Close()
			meta, err := a.repo.CreateAttachment(r.Context(), AttachmentMeta{
				Attachment: Attachment{Name: fh.Filename, MimeType: ct, Size: fh.Size},
				OrgID:      o.ID,
				BlobKey:    key,
			})
			if err != nil {
				http.Error(w, "save attachment", http.StatusInternalServerError)
				return
			}
			meta.URL = attachmentContentURL(meta.ID)
			out = append(out, meta.Attachment)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"attachments": out})
	})
}

// attachmentContentURL returns the canonical download URL for a chat attachment.
func attachmentContentURL(id string) string {
	return "/api/v1/chat/attachments/" + id + "/content"
}

// ChatAttachmentID extracts the id from /api/v1/chat/attachments/{id}/content.
func ChatAttachmentID(path string) (string, bool) {
	const prefix = "/api/v1/chat/attachments/"
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

// DownloadHandler streams a chat attachment blob with its name and content type.
func (a *Attachments) DownloadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := ChatAttachmentID(r.URL.Path)
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
			ct = meta.MimeType
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", meta.Name))
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	})
}
