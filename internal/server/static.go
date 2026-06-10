package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

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
