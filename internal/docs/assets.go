package docs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

// Document image assets (Docs M7). Pictures inserted into a document are
// stored in the blob store (rustfs/S3, shared with Drive) under
// "docs/<docID>/<sha256>" instead of as data: URLs inside the Yjs document;
// the image's src is then "/api/v1/docs/d/<docID>/assets/<sha256>". This is
// the Slides M6 asset endpoint (internal/slides/assets.go) with the same
// security properties, restricted to raster pictures:
//
//   - the type is sniffed from the bytes (the client's Content-Type is
//     ignored) and must be PNG, JPEG, GIF, WebP or BMP. SVG is refused:
//     served from our origin it could run script;
//   - responses carry nosniff and a `default-src 'none'; sandbox` CSP;
//   - content addressing makes uploads idempotent and lets responses be
//     cached as immutable;
//   - access follows the document: whoever can read it (org member, grantee,
//     or a share-link token in ?token=) can read its assets, only writers can
//     add. Unknown documents and denied callers get the same 404.

// AssetBlobStore is the subset of drive.Blobs the handler needs.
type AssetBlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// DocAccess reports whether the caller may read / write document id. It is
// the same check as the collab WebSocket.
type DocAccess func(r *http.Request, docID string) (read, write bool)

// MaxAssetBytes caps one uploaded picture.
const MaxAssetBytes = 20 << 20

// assetTypes are the sniffed formats accepted and served.
var assetTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

var assetPath = regexp.MustCompile(`^/api/v1/docs/d/([^/]+)/assets(?:/([0-9a-f]{64}))?$`)

// AssetPath parses /api/v1/docs/d/{id}/assets[/{sha}].
func AssetPath(p string) (docID, sha string, ok bool) {
	m := assetPath.FindStringSubmatch(p)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

// AssetURL is the src an uploaded asset gets.
func AssetURL(docID, sha string) string {
	return fmt.Sprintf("/api/v1/docs/d/%s/assets/%s", docID, sha)
}

func assetKey(docID, sha string) string { return "docs/" + docID + "/" + sha }

// Assets serves POST /api/v1/docs/d/{id}/assets (multipart "file" or a raw
// image body) and GET /api/v1/docs/d/{id}/assets/{sha256}.
type Assets struct {
	blobs  AssetBlobStore
	access DocAccess
}

// NewAssets wires the handler; the server leaves it nil without a blob store
// (the client then keeps data: URLs).
func NewAssets(blobs AssetBlobStore, access DocAccess) *Assets {
	return &Assets{blobs: blobs, access: access}
}

func (a *Assets) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	docID, sha, ok := AssetPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	read, write := a.access(r, docID)
	switch {
	case sha == "" && r.Method == http.MethodPost:
		if !write {
			http.Error(w, "document not found", http.StatusNotFound)
			return
		}
		a.upload(w, r, docID)
	case sha != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		if !read {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		a.serve(w, r, docID, sha)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *Assets) upload(w http.ResponseWriter, r *http.Request, docID string) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAssetBytes+1<<20)
	var src io.Reader = r.Body
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		f, _, err := r.FormFile("file")
		if err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, "missing file", http.StatusBadRequest)
			return
		}
		defer f.Close()
		src = f
	}
	data, err := io.ReadAll(io.LimitReader(src, MaxAssetBytes+1))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "read failed", http.StatusBadRequest)
		return
	}
	if len(data) == 0 {
		http.Error(w, "empty file", http.StatusBadRequest)
		return
	}
	if len(data) > MaxAssetBytes {
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
		return
	}
	mime := http.DetectContentType(data)
	if !assetTypes[mime] {
		http.Error(w, "unsupported file type", http.StatusUnsupportedMediaType)
		return
	}
	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])
	if err := a.blobs.Put(r.Context(), assetKey(docID, sha), mime, int64(len(data)), bytes.NewReader(data)); err != nil {
		http.Error(w, "store failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"url": AssetURL(docID, sha), "mime": mime, "size": len(data)})
}

func (a *Assets) serve(w http.ResponseWriter, r *http.Request, docID, sha string) {
	body, mime, size, err := a.blobs.Get(r.Context(), assetKey(docID, sha))
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer body.Close()
	if !assetTypes[mime] {
		mime = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	// Content-addressed: the bytes behind a URL never change.
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("ETag", `"`+sha+`"`)
	if r.Header.Get("If-None-Match") == `"`+sha+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if size > 0 {
		h.Set("Content-Length", fmt.Sprint(size))
	}
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.Copy(w, body)
}

// Loader returns an AssetLoader for exports requested by r: it reads a
// picture only when r's caller may read that document (the same check as
// GET), and only through the blob store. Access is decided once per document.
func (a *Assets) Loader(r *http.Request) AssetLoader {
	if a == nil {
		return nil
	}
	allowed := map[string]bool{}
	return func(ctx context.Context, docID, sha string) ([]byte, error) {
		ok, seen := allowed[docID]
		if !seen {
			ok, _ = a.access(r, docID)
			allowed[docID] = ok
		}
		if !ok {
			return nil, errors.New("not found")
		}
		body, _, _, err := a.blobs.Get(ctx, assetKey(docID, sha))
		if err != nil {
			return nil, err
		}
		defer body.Close()
		data, err := io.ReadAll(io.LimitReader(body, MaxAssetBytes+1))
		if err != nil {
			return nil, err
		}
		if len(data) > MaxAssetBytes {
			return nil, errors.New("asset too large")
		}
		return data, nil
	}
}
