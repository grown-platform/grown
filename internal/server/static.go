package server

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func init() {
	// Go's mime table has no ".webmanifest" entry, so http.ServeFile would sniff
	// PWA manifests as text/plain. Register the spec type so installable games
	// (web/app/public/games/*.webmanifest) are served correctly.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// StaticHandler serves the built React SPA from `dir`. Behavior:
//   - GET /api/* always returns 404 (so the gateway mux handles it via the
//     server's outer routing).
//   - GET /<exact-file> with a file extension serves the file from `dir`,
//     404 if missing.
//   - Any other GET serves index.html (SPA history-API fallback) so client
//     routing works on hard refreshes.
//
// If `dir` is empty or missing, all requests get 404 — letting the operator
// run the backend in API-only mode for tests.
func StaticHandler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never shadow API paths; let the outer router fall through.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		if dir == "" {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(dir); err != nil {
			http.NotFound(w, r)
			return
		}

		// Exact file match (path has an extension and file exists).
		if hasFileExt(r.URL.Path) {
			full := filepath.Join(dir, filepath.Clean(r.URL.Path))
			if !strings.HasPrefix(full, filepath.Clean(dir)+string(filepath.Separator)) && full != filepath.Clean(dir) {
				http.NotFound(w, r) // path-escape guard
				return
			}
			if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
				http.ServeFile(w, r, full)
				return
			}
			http.NotFound(w, r)
			return
		}

		// SPA fallback.
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func hasFileExt(p string) bool {
	base := filepath.Base(p)
	return strings.Contains(base, ".")
}

// PDFStaticHandler serves the built PDF SPA (Vite base "/pdf/") from `dir` for
// requests under /pdf and /pdf/*. The leading "/pdf" segment is stripped before
// resolving files on disk, so /pdf/assets/app.js maps to dir/assets/app.js and
// index.html's "/pdf/assets/..." URLs resolve. Behavior mirrors StaticHandler:
//   - An exact existing file (path has an extension) is served from `dir`.
//   - Anything else under /pdf/ falls back to dir/index.html (client routing).
//
// It deliberately does NOT match /pdf-api/* — that prefix belongs to the PDF
// backend and is routed before this handler. If `dir` is empty or missing, all
// requests get 404 (caller gates on PDFStaticDir being non-empty).
func PDFStaticHandler(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never claim the backend prefix; the outer router handles it first,
		// but guard here too so this handler is safe in isolation.
		if r.URL.Path == "/pdf-api" || strings.HasPrefix(r.URL.Path, "/pdf-api/") {
			http.NotFound(w, r)
			return
		}
		if dir == "" {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(dir); err != nil {
			http.NotFound(w, r)
			return
		}

		// Strip the "/pdf" base prefix to get the on-disk-relative path.
		rel := strings.TrimPrefix(r.URL.Path, "/pdf")
		rel = strings.TrimPrefix(rel, "/") // "/pdf" -> "", "/pdf/x" -> "x"

		// Exact file match (path has an extension and file exists).
		if rel != "" && hasFileExt(rel) {
			full := filepath.Join(dir, filepath.Clean("/"+rel))
			if !strings.HasPrefix(full, filepath.Clean(dir)+string(filepath.Separator)) && full != filepath.Clean(dir) {
				http.NotFound(w, r) // path-escape guard
				return
			}
			if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
				http.ServeFile(w, r, full)
				return
			}
			http.NotFound(w, r)
			return
		}

		// SPA fallback.
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
