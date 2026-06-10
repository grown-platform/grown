package useravatar

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// maxAvatarBytes limits uploaded avatar size (avatars are square portraits).
const maxAvatarBytes = 5 << 20 // 5 MiB

// BlobStore is the subset of the Drive blob store the avatar upload/serve needs.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
	Delete(ctx context.Context, key string) error
}

// AvatarStore is the data layer for avatar rows.
type AvatarStore interface {
	Get(ctx context.Context, userID string) (Avatar, error)
	Set(ctx context.Context, userID, blobKey, mime string) error
}

// CallerFunc resolves the caller from the request context, returning the user id
// and whether a caller is present. server.go injects a closure backed by
// auth.UserFromContext so this package stays free of internal/auth's gen/ dep.
type CallerFunc func(ctx context.Context) (userID string, ok bool)

// Handler implements:
//
//	POST   /api/v1/me/avatar         — upload avatar (multipart "file" field)
//	GET    /api/v1/me/avatar         — serve own avatar
//	DELETE /api/v1/me/avatar         — clear own avatar
//	GET    /api/v1/users/{id}/avatar — serve any user's avatar (any org member)
type Handler struct {
	caller CallerFunc
	repo   AvatarStore
	blobs  BlobStore
}

// NewHandler constructs the Handler. All three arguments are required; if any
// is nil the handler returns 503 rather than panicking.
func NewHandler(caller CallerFunc, repo AvatarStore, blobs BlobStore) *Handler {
	return &Handler{caller: caller, repo: repo, blobs: blobs}
}

// ServeHTTP dispatches on method + path.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimRight(r.URL.Path, "/")
	switch {
	case path == "/api/v1/me/avatar":
		h.myAvatar(w, r)
	case strings.HasPrefix(path, "/api/v1/users/") && strings.HasSuffix(path, "/avatar"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/users/"), "/avatar")
		h.userAvatar(w, r, id)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

// myAvatar handles GET/POST/DELETE for the caller's own avatar.
func (h *Handler) myAvatar(w http.ResponseWriter, r *http.Request) {
	if h.caller == nil || h.repo == nil || h.blobs == nil {
		writeError(w, http.StatusServiceUnavailable, "avatar feature unavailable")
		return
	}
	userID, ok := h.caller(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	switch r.Method {
	case http.MethodGet:
		h.serveAvatarBlob(w, r, userID)
	case http.MethodPost:
		h.uploadAvatar(w, r, userID)
	case http.MethodDelete:
		h.deleteAvatar(w, r, userID)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// userAvatar handles GET for any user's avatar (any authenticated member).
func (h *Handler) userAvatar(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if h.caller == nil {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	// Require any authenticated caller to serve others' avatars.
	if _, ok := h.caller(r.Context()); !ok {
		writeError(w, http.StatusUnauthorized, "no session")
		return
	}
	if h.repo == nil || h.blobs == nil {
		writeError(w, http.StatusNotFound, "no avatar")
		return
	}
	h.serveAvatarBlob(w, r, userID)
}

func (h *Handler) serveAvatarBlob(w http.ResponseWriter, r *http.Request, userID string) {
	a, err := h.repo.Get(r.Context(), userID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "no avatar")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	body, mime, size, err := h.blobs.Get(r.Context(), a.BlobKey)
	if err != nil {
		writeError(w, http.StatusNotFound, "avatar not found")
		return
	}
	defer body.Close()
	if mime == "" {
		mime = a.MimeType
	}
	if mime != "" {
		w.Header().Set("Content-Type", mime)
	}
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}
	// Avatars change infrequently; allow short private caching.
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}

func (h *Handler) uploadAvatar(w http.ResponseWriter, r *http.Request, userID string) {
	if err := r.ParseMultipartForm(maxAvatarBytes); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()
	if header.Size > maxAvatarBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "avatar too large (max 5 MiB)")
		return
	}
	mime := header.Header.Get("Content-Type")
	if !isAllowedAvatarMIME(mime) {
		writeError(w, http.StatusUnsupportedMediaType, "avatar must be PNG, JPEG, WEBP or GIF")
		return
	}
	suffix, err := randomHex(8)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Per-user key with a random suffix so a re-upload busts caches.
	key := "avatars/" + userID + "/avatar-" + suffix
	if err := h.blobs.Put(r.Context(), key, mime, header.Size, file); err != nil {
		writeError(w, http.StatusBadGateway, "store avatar: "+err.Error())
		return
	}
	if err := h.repo.Set(r.Context(), userID, key, mime); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"avatar_url": "/api/v1/me/avatar",
	})
}

func (h *Handler) deleteAvatar(w http.ResponseWriter, r *http.Request, userID string) {
	a, err := h.repo.Get(r.Context(), userID)
	if err == nil && a.BlobKey != "" {
		// Best-effort blob delete — don't fail the request if blob is gone.
		_ = h.blobs.Delete(r.Context(), a.BlobKey)
	}
	if err := h.repo.Set(r.Context(), userID, "", ""); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func isAllowedAvatarMIME(mime string) bool {
	switch strings.ToLower(strings.TrimSpace(mime)) {
	case "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif":
		return true
	}
	return false
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", errors.New("rand: " + err.Error())
	}
	return hex.EncodeToString(buf), nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg})
}
