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
	"time"
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

// MaxMediaBytes caps one uploaded video or audio clip (Slides M11).
const MaxMediaBytes = 100 << 20

// assetTypes are the formats accepted (sniffed, not trusted from the
// client): raster pictures, and since M11 the video/audio containers
// browsers play. SVG is refused: served from our origin it could run script.
var assetTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
	"video/mp4":  true,
	"video/webm": true,
	"video/ogg":  true,
	"audio/mpeg": true,
	"audio/mp4":  true,
	"audio/ogg":  true,
	"audio/wav":  true,
	"audio/aac":  true,
}

// isMedia reports whether an accepted type is a clip (the larger limit, and
// served with byte ranges so players can seek).
func isMedia(mime string) bool {
	return strings.HasPrefix(mime, "video/") || strings.HasPrefix(mime, "audio/")
}

// sniffAsset is http.DetectContentType plus the audio/video signatures it
// lacks or reports generically: MP3 frames without an ID3 tag, ISO-BMFF
// brands (M4A audio vs MP4 video, QuickTime), Ogg with or without a Theora
// video stream, WAVE, and ADTS AAC.
func sniffAsset(data []byte) string {
	head := data
	if len(head) > 512 {
		head = head[:512]
	}
	if len(head) >= 12 && string(head[4:8]) == "ftyp" {
		switch string(head[8:12]) {
		case "M4A ", "M4B ", "M4P ", "F4A ":
			return "audio/mp4"
		}
		return "video/mp4" // isom, mp41/2, avc1, qt, M4V, 3gp…
	}
	if len(head) >= 4 && string(head[:4]) == "OggS" {
		if bytes.Contains(data[:min(len(data), 4096)], []byte("theora")) {
			return "video/ogg"
		}
		return "audio/ogg"
	}
	if len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WAVE" {
		return "audio/wav"
	}
	if len(head) >= 3 && string(head[:3]) == "ID3" {
		return "audio/mpeg"
	}
	if len(head) >= 2 && head[0] == 0xFF {
		switch {
		case head[1]&0xF6 == 0xF0: // ADTS: sync 12 bits, layer 00
			return "audio/aac"
		case head[1]&0xE0 == 0xE0 && head[1]&0x06 != 0: // MPEG audio frame, layer I-III
			return "audio/mpeg"
		}
	}
	m := http.DetectContentType(data)
	switch m {
	case "audio/wave":
		return "audio/wav"
	case "application/ogg":
		return "audio/ogg"
	}
	return m
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
	r.Body = http.MaxBytesReader(w, r.Body, MaxMediaBytes+1<<20)
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
	data, err := io.ReadAll(io.LimitReader(src, MaxMediaBytes+1))
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
	mime := sniffAsset(data)
	if !assetTypes[mime] {
		http.Error(w, "unsupported file type", http.StatusUnsupportedMediaType)
		return
	}
	limit := MaxAssetBytes
	if isMedia(mime) {
		limit = MaxMediaBytes
	}
	if len(data) > limit {
		http.Error(w, "file too large", http.StatusRequestEntityTooLarge)
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
	// Clips are served with byte ranges (players seek and probe the end of
	// the file); they are at most MaxMediaBytes, so buffering is bounded.
	if isMedia(mime) && size <= MaxMediaBytes {
		h.Set("Accept-Ranges", "bytes")
		data, err := io.ReadAll(io.LimitReader(body, MaxMediaBytes+1))
		if err != nil {
			http.Error(w, "read failed", http.StatusBadGateway)
			return
		}
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(data))
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
