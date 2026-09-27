package slides

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

// Deck image assets (Slides M6). Pictures inserted into a deck are stored in
// the blob store (rustfs/S3, shared with Drive) under
// "slides/<deckID>/<sha256>" instead of as data: URLs inside the deck JSON;
// the element's src is then "/api/v1/slides/d/<deckID>/assets/<sha256>".
// Content addressing makes re-uploads idempotent. Access follows the deck:
// anyone who can read the deck can read its assets, only writers can add.

// AssetBlobStore is the subset of drive.Blobs the handler needs.
type AssetBlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// DeckAccess reports whether the caller may read / write deck id. It is the
// same check as the collab WebSocket (org member or per-user grant).
type DeckAccess func(r *http.Request, deckID string) (read, write bool)

// MaxAssetBytes caps one uploaded picture.
const MaxAssetBytes = 20 << 20

// assetTypes are the raster formats accepted (sniffed, not trusted from the
// client). SVG is refused: served from our origin it could run script.
var assetTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
}

var assetPath = regexp.MustCompile(`^/api/v1/slides/d/([^/]+)/assets(?:/([0-9a-f]{64}))?$`)

// AssetPath parses /api/v1/slides/d/{id}/assets[/{sha}].
func AssetPath(p string) (deckID, sha string, ok bool) {
	m := assetPath.FindStringSubmatch(p)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

// AssetURL is the src an uploaded asset gets.
func AssetURL(deckID, sha string) string {
	return fmt.Sprintf("/api/v1/slides/d/%s/assets/%s", deckID, sha)
}

func assetKey(deckID, sha string) string { return "slides/" + deckID + "/" + sha }

// Assets serves POST /api/v1/slides/d/{id}/assets (multipart "file" or a raw
// image body) and GET /api/v1/slides/d/{id}/assets/{sha256}.
type Assets struct {
	blobs  AssetBlobStore
	access DeckAccess
}

// NewAssets wires the handler; nil blobs disables it (callers keep data: URLs).
func NewAssets(blobs AssetBlobStore, access DeckAccess) *Assets {
	return &Assets{blobs: blobs, access: access}
}

func (a *Assets) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	deckID, sha, ok := AssetPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	read, write := a.access(r, deckID)
	switch {
	case sha == "" && r.Method == http.MethodPost:
		if !write {
			http.Error(w, "deck not found", http.StatusNotFound)
			return
		}
		a.upload(w, r, deckID)
	case sha != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		if !read {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		a.serve(w, r, deckID, sha)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *Assets) upload(w http.ResponseWriter, r *http.Request, deckID string) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxAssetBytes+1<<20)
	var src io.Reader = r.Body
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		f, _, err := r.FormFile("file")
		if err != nil {
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
			http.Error(w, "image too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "read failed", http.StatusBadRequest)
		return
	}
	if len(data) > MaxAssetBytes {
		http.Error(w, "image too large", http.StatusRequestEntityTooLarge)
		return
	}
	if len(data) == 0 {
		http.Error(w, "empty file", http.StatusBadRequest)
		return
	}
	mime := http.DetectContentType(data)
	if !assetTypes[mime] {
		http.Error(w, "unsupported image type", http.StatusUnsupportedMediaType)
		return
	}
	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])
	if err := a.blobs.Put(r.Context(), assetKey(deckID, sha), mime, int64(len(data)), bytes.NewReader(data)); err != nil {
		http.Error(w, "store failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"url": AssetURL(deckID, sha), "mime": mime, "size": len(data)})
}

func (a *Assets) serve(w http.ResponseWriter, r *http.Request, deckID, sha string) {
	body, mime, size, err := a.blobs.Get(r.Context(), assetKey(deckID, sha))
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
