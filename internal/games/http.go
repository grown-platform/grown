package games

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

// BlobStore is the subset of the Drive blob store the games handlers need.
// It matches mail.BlobStore so the same Drive blob store satisfies both.
type BlobStore interface {
	Put(ctx context.Context, key, mimeType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error)
}

// Games serves imported-game upload, list, and content over raw HTTP.
//
// SECURITY: uploaded HTML is UNTRUSTED. ContentHandler streams it with a
// nosniff + frame-ancestors CSP, and the frontend renders it ONLY inside a
// sandboxed iframe (no allow-same-origin), so it gets an opaque origin and
// cannot reach grown's cookies/session/APIs.
type Games struct {
	repo  *Repository
	blobs BlobStore
}

// New constructs the games handlers.
func New(repo *Repository, blobs BlobStore) *Games {
	return &Games{repo: repo, blobs: blobs}
}

func randKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "games/" + hex.EncodeToString(b)
}

// maxGame caps an uploaded HTML game at ~2 MiB.
const maxGame = 2 << 20

func isHTML(contentType, filename string) bool {
	if strings.Contains(strings.ToLower(contentType), "text/html") {
		return true
	}
	return strings.HasSuffix(strings.ToLower(filename), ".html") ||
		strings.HasSuffix(strings.ToLower(filename), ".htm")
}

// UploadHandler stores an uploaded HTML game (multipart field "file") in the
// blob store, records its metadata, and returns the game JSON.
func (g *Games) UploadHandler() http.Handler {
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
		// Cap the body so an oversized upload can't exhaust memory.
		r.Body = http.MaxBytesReader(w, r.Body, maxGame+(1<<16))
		if err := r.ParseMultipartForm(maxGame); err != nil {
			http.Error(w, "file too large or bad multipart form", http.StatusBadRequest)
			return
		}
		files := r.MultipartForm.File["file"]
		if len(files) == 0 {
			http.Error(w, "no file", http.StatusBadRequest)
			return
		}
		fh := files[0]
		if fh.Size > maxGame {
			http.Error(w, "file too large", http.StatusBadRequest)
			return
		}
		ct := fh.Header.Get("Content-Type")
		if !isHTML(ct, fh.Filename) {
			http.Error(w, "only self-contained HTML games are supported", http.StatusBadRequest)
			return
		}
		f, err := fh.Open()
		if err != nil {
			http.Error(w, "open file", http.StatusBadRequest)
			return
		}
		// Always store + serve as text/html; the bytes are treated as untrusted.
		const storeCT = "text/html; charset=utf-8"
		key := randKey()
		if err := g.blobs.Put(r.Context(), key, storeCT, fh.Size, f); err != nil {
			f.Close()
			http.Error(w, "store blob: "+err.Error(), http.StatusInternalServerError)
			return
		}
		f.Close()
		name := fh.Filename
		if name == "" {
			name = "game"
		}
		meta, err := g.repo.Create(r.Context(), GameMeta{
			Game:    Game{Name: name, ContentType: storeCT, Size: fh.Size},
			OrgID:   o.ID,
			OwnerID: u.ID,
			BlobKey: key,
		})
		if err != nil {
			http.Error(w, "save game", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(meta.Game)
	})
}

// ListHandler returns {"games":[...]} for the caller's org.
func (g *Games) ListHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		list, err := g.repo.ListByOrg(r.Context(), o.ID)
		if err != nil {
			http.Error(w, "list games", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"games": list})
	})
}

// GameID extracts the id from /api/v1/games/{id}/content.
func GameID(path string) (string, bool) {
	const prefix = "/api/v1/games/"
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

// ContentHandler streams the raw (untrusted) HTML for a game.
//
// SECURITY headers: nosniff prevents content-type confusion; frame-ancestors
// 'self' restricts who can embed it. The bytes are only ever loaded into a
// sandboxed iframe (no allow-same-origin) on the frontend. Org-scoped: a game
// belonging to another org returns 404.
func (g *Games) ContentHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o, ok := auth.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		id, ok := GameID(r.URL.Path)
		if !ok {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		meta, err := g.repo.Get(r.Context(), o.ID, id)
		if err != nil {
			http.Error(w, "game not found", http.StatusNotFound)
			return
		}
		body, _, size, err := g.blobs.Get(r.Context(), meta.BlobKey)
		if err != nil {
			http.Error(w, "fetch blob", http.StatusInternalServerError)
			return
		}
		defer body.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
		if size > 0 {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	})
}
