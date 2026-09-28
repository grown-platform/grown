// Package hacomponent serves the grown Home Assistant custom integration as a
// zip at GET /integrations/homeassistant/grown.zip (public, no auth).
//
// The zip holds custom_components/grown/... so `unzip grown.zip` inside an HA
// config directory installs it. It is built once from the embedded sources
// and is byte-for-byte deterministic (sorted entries, fixed mtimes, fixed
// compression) so its ETag only changes when the integration does. The Helm
// chart's Home Assistant pod downloads it on every start, keeping the
// integration in lockstep with the Grown version.
package hacomponent

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
)

// Path is the public URL path the zip is served at.
const Path = "/integrations/homeassistant/grown.zip"

// modTime is stamped on every zip entry (the zip epoch is 1980; use a fixed,
// recognisable date instead of the build time).
var modTime = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// skip reports whether an embedded path is a build/test artifact.
func skip(p string, d fs.DirEntry) bool {
	base := path.Base(p)
	if d.IsDir() {
		return base == "__pycache__" || base == ".pytest_cache" || strings.HasPrefix(base, ".")
	}
	return strings.HasSuffix(base, ".pyc") || strings.HasPrefix(base, ".")
}

// Build zips every file under root in fsys into prefix/<relative path>.
func Build(fsys fs.FS, root, prefix string) ([]byte, error) {
	var files []string
	err := fs.WalkDir(fsys, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != root && skip(p, d) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !d.IsDir() {
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("hacomponent: no files under %s", root)
	}
	sort.Strings(files)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, p := range files {
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return nil, err
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(p, root), "/")
		hdr := &zip.FileHeader{Name: path.Join(prefix, rel), Method: zip.Deflate}
		hdr.Modified = modTime
		hdr.SetMode(0o644)
		w, err := zw.CreateHeader(hdr)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Handler serves one prebuilt zip with a strong ETag.
type Handler struct {
	fsys   fs.FS
	root   string
	prefix string

	once sync.Once
	zip  []byte
	etag string
	err  error
}

// New returns a handler that lazily zips root (in fsys) under prefix.
func New(fsys fs.FS, root, prefix string) *Handler {
	return &Handler{fsys: fsys, root: root, prefix: prefix}
}

func (h *Handler) build() {
	h.zip, h.err = Build(h.fsys, h.root, h.prefix)
	if h.err == nil {
		sum := sha256.Sum256(h.zip)
		h.etag = `"` + hex.EncodeToString(sum[:16]) + `"`
	}
}

// ServeHTTP answers GET/HEAD with the zip (304 on a matching If-None-Match).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	h.once.Do(h.build)
	if h.err != nil {
		http.Error(w, "integration bundle unavailable", http.StatusInternalServerError)
		return
	}
	hdr := w.Header()
	hdr.Set("Content-Type", "application/zip")
	hdr.Set("Content-Disposition", `attachment; filename="grown.zip"`)
	// Public and cacheable, but revalidated: the ETag changes with the Grown
	// version, and HA pods fetch it on every start.
	hdr.Set("Cache-Control", "public, max-age=300, must-revalidate")
	hdr.Set("ETag", h.etag)
	hdr.Set("X-Content-Type-Options", "nosniff")
	if inm := r.Header.Get("If-None-Match"); inm != "" && etagMatch(inm, h.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	hdr.Set("Content-Length", fmt.Sprint(len(h.zip)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(h.zip)
	}
}

func etagMatch(header, etag string) bool {
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(part), "W/"))
		if part == "*" || part == etag {
			return true
		}
	}
	return false
}
