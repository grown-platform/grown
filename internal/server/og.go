package server

import (
	"bytes"
	"html"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
	"sync"
)

// Server-rendered Open Graph / Twitter Card metadata for the SPA shell.
//
// Link-preview crawlers (iMessage, Slack, Twitter/X, Facebook, etc.) do NOT run
// JavaScript, so a single static index.html makes every shared grown URL preview
// identically (just the <title> "Workspace"). To give each route a meaningful
// preview — title, description, and image — we inject route-aware <meta og:*>
// tags into the index.html shell as it's served (the SPA history fallback).
//
// The injection is path-based (and host-based for absolute URLs); the SPA itself
// is unchanged. siteName (GROWN_SITE_NAME) names the product for the homepage
// title + og:site_name, so e.g. grown.haus can preview as "Grown Platform".

// ogTagline is the product motto, used as the link-preview description.
const ogTagline = "Grow your own platform and own what you grow."

// ogRoute is the preview metadata for a route prefix.
type ogRoute struct {
	title string // og:title (line 1 of the preview)
	image string // absolute-from-root image path (og:image)
}

// ogRoutes maps a leading path segment to its preview metadata. The homepage
// (and any unlisted route) falls back to the site default below. Images are
// root-absolute paths resolved against the request's scheme+host at serve time.
var ogRoutes = map[string]ogRoute{
	"games":    {"Games", "/games-og.png"},
	"drive":    {"Drive", "/icon-512.png"},
	"mail":     {"Mail", "/icon-512.png"},
	"calendar": {"Calendar", "/icon-512.png"},
	"contacts": {"Contacts", "/icon-512.png"},
	"docs":     {"Docs", "/icon-512.png"},
	"sheets":   {"Sheets", "/icon-512.png"},
	"slides":   {"Slides", "/icon-512.png"},
	"photos":   {"Photos", "/icon-512.png"},
	"chat":     {"Chat", "/icon-512.png"},
	"meet":     {"Meet", "/icon-512.png"},
	"3d":       {"3D", "/icon-512.png"},
	"tickets":  {"Tickets", "/icon-512.png"},
	"music":    {"Music", "/icon-512.png"},
	"video":    {"Video", "/icon-512.png"},
}

// defaultOGImage is the homepage / fallback preview image.
const defaultOGImage = "/icon-512.png"

// indexShellCache caches the on-disk index.html (re-read when it changes) so the
// per-request injection doesn't hit disk every time.
type indexShell struct {
	mu      sync.RWMutex
	path    string
	modUnix int64
	body    []byte
}

var shellCache indexShell

// load returns the index.html bytes for dir, re-reading on modtime change.
func (c *indexShell) load(file string) ([]byte, error) {
	fi, err := os.Stat(file)
	if err != nil {
		return nil, err
	}
	mod := fi.ModTime().Unix()
	c.mu.RLock()
	if c.path == file && c.modUnix == mod && c.body != nil {
		b := c.body
		c.mu.RUnlock()
		return b, nil
	}
	c.mu.RUnlock()
	b, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.path, c.modUnix, c.body = file, mod, b
	c.mu.Unlock()
	return b, nil
}

var titleRe = regexp.MustCompile(`(?is)<title>.*?</title>`)

// reqScheme infers the external scheme, honoring the edge proxy's
// X-Forwarded-Proto and defaulting to https (grown sits behind TLS in prod).
func reqScheme(r *http.Request) string {
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		if i := strings.IndexByte(p, ','); i >= 0 {
			p = p[:i]
		}
		return strings.TrimSpace(p)
	}
	if r.TLS != nil {
		return "https"
	}
	return "https"
}

// ogFor returns the title and image for a request path.
func ogFor(urlPath, siteName string) (title, image string) {
	seg := strings.Trim(urlPath, "/")
	if i := strings.IndexByte(seg, '/'); i >= 0 {
		seg = seg[:i]
	}
	if seg == "" {
		return siteName, defaultOGImage
	}
	if m, ok := ogRoutes[strings.ToLower(seg)]; ok {
		return m.title, m.image
	}
	return siteName, defaultOGImage
}

// injectOGMeta rewrites the shell's <title> and injects og:/twitter: meta for
// the given request. siteName defaults to "Grown" when empty.
func injectOGMeta(shell []byte, r *http.Request, siteName string) []byte {
	if siteName == "" {
		siteName = "Grown"
	}
	title, image := ogFor(r.URL.Path, siteName)

	base := reqScheme(r) + "://" + r.Host
	pageURL := base + r.URL.Path
	imageURL := base + image
	// og:title is the route title; for non-home routes append the site for context.
	ogTitle := title
	if !strings.EqualFold(title, siteName) {
		ogTitle = title + " · " + siteName
	}

	e := html.EscapeString
	var meta strings.Builder
	meta.WriteString("\n    <meta name=\"description\" content=\"" + e(ogTagline) + "\" />")
	meta.WriteString("\n    <meta property=\"og:type\" content=\"website\" />")
	meta.WriteString("\n    <meta property=\"og:site_name\" content=\"" + e(siteName) + "\" />")
	meta.WriteString("\n    <meta property=\"og:title\" content=\"" + e(ogTitle) + "\" />")
	meta.WriteString("\n    <meta property=\"og:description\" content=\"" + e(ogTagline) + "\" />")
	meta.WriteString("\n    <meta property=\"og:url\" content=\"" + e(pageURL) + "\" />")
	meta.WriteString("\n    <meta property=\"og:image\" content=\"" + e(imageURL) + "\" />")
	meta.WriteString("\n    <meta name=\"twitter:card\" content=\"summary_large_image\" />")
	meta.WriteString("\n    <meta name=\"twitter:title\" content=\"" + e(ogTitle) + "\" />")
	meta.WriteString("\n    <meta name=\"twitter:description\" content=\"" + e(ogTagline) + "\" />")
	meta.WriteString("\n    <meta name=\"twitter:image\" content=\"" + e(imageURL) + "\" />")

	out := titleRe.ReplaceAll(shell, []byte("<title>"+e(ogTitle)+"</title>"))
	// Insert the meta block right before </head> (first occurrence).
	if idx := bytes.Index(bytes.ToLower(out), []byte("</head>")); idx >= 0 {
		var b bytes.Buffer
		b.Write(out[:idx])
		b.WriteString(meta.String())
		b.WriteString("\n  ")
		b.Write(out[idx:])
		return b.Bytes()
	}
	return out
}

// serveSPAShell serves index.html from dir with route-aware OG meta injected.
// Falls back to a plain file serve if the shell can't be read.
func serveSPAShell(w http.ResponseWriter, r *http.Request, dir, siteName string) {
	file := path.Join(dir, "index.html")
	shell, err := shellCache.load(file)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	body := injectOGMeta(shell, r, siteName)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The shell must revalidate so deploys ship a fresh bundle reference.
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(body)
}
