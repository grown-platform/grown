package docs

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	xhtml "golang.org/x/net/html"
)

// Pictures in pandoc-backed exports (odt, rtf, epub, md and the docx/pdf
// fallbacks).
//
// pandoc runs with --sandbox, so it may not read files or fetch URLs named in
// the posted HTML (that blocked reading /etc/passwd into an export and SSRF).
// The sandbox also stops the pictures a document really has: Grown asset URLs
// (/api/v1/docs/d/<id>/assets/<sha>) can't be fetched, and pandoc 3.1.13 (the
// production image's Alpine package) refuses data: URIs as well. So the server
// resolves the pictures itself, before pandoc runs:
//
//   - every <img src> is rewritten. data: images are decoded, and asset URLs
//     are read from the docs asset store through an AssetLoader, which checks
//     the caller's read access to that document. The bytes must sniff as an
//     allowlisted picture type (the asset types plus SVG), within size caps;
//   - each picture is written to the per-conversion temp dir under a name the
//     server chose ("grown-img-N.png"), and src points at that name. Any other
//     src (file paths, file:, http(s), unknown documents) is removed;
//   - export_images.lua, run by pandoc, hands those files to pandoc's
//     mediabag. Filters are not sandboxed, but this one only opens the paths
//     in a table the server generated; every image whose src is not in the
//     table (whatever pandoc's HTML reader turns into an Image: <img>,
//     <embed>, <video>...) becomes its alt text. pandoc itself still reads
//     nothing but stdin.
//
// Markdown has nowhere to put a media folder in a single .md download, so the
// md export keeps pictures inline as base64 data: URLs (the file stays one
// .md, opens in most Markdown viewers and re-imports into Grown with its
// pictures).

// AssetLoader returns the bytes of picture sha of document docID, or an error
// when the caller may not read the document or the asset does not exist.
type AssetLoader func(ctx context.Context, docID, sha string) ([]byte, error)

// ExportOptions are the optional inputs of ConvertHTMLWith.
type ExportOptions struct {
	// Assets resolves Grown asset URLs; nil drops them from the export.
	Assets AssetLoader
}

const (
	// maxExportImageBytes caps one picture (the asset upload cap).
	maxExportImageBytes = MaxAssetBytes
	// maxExportImagesBytes caps all pictures of one export together.
	maxExportImagesBytes = 64 << 20
	// maxExportImages caps the number of distinct pictures.
	maxExportImages = 1000
)

// exportImageExt maps the accepted picture types to file extensions.
var exportImageExt = map[string]string{
	"image/png":     "png",
	"image/jpeg":    "jpg",
	"image/gif":     "gif",
	"image/webp":    "webp",
	"image/bmp":     "bmp",
	"image/svg+xml": "svg",
}

// exportImage is one picture written for pandoc.
type exportImage struct {
	name string // src in the rewritten HTML, the mediabag key
	path string // file in the temp dir
	mime string
}

//go:embed export_images.lua
var exportImagesFilter []byte

// sniffImage returns the allowlisted type of data, or "". Raster types are
// sniffed from the bytes (the declared type is ignored); SVG, which the
// sniffer reports as text, is accepted only when declared and it has an
// <svg root.
func sniffImage(data []byte, declared string) string {
	if len(data) == 0 {
		return ""
	}
	if t := http.DetectContentType(data); assetTypes[t] {
		return t
	}
	if strings.EqualFold(declared, "image/svg+xml") && bytes.Contains(bytes.ToLower(data[:min(len(data), 4096)]), []byte("<svg")) {
		return "image/svg+xml"
	}
	return ""
}

// decodeDataURL decodes a data: URL (base64 or percent-encoded), returning
// its bytes and declared media type.
func decodeDataURL(src string) ([]byte, string, bool) {
	if len(src) < 5 || !strings.EqualFold(src[:5], "data:") {
		return nil, "", false
	}
	rest := src[5:]
	meta, payload, ok := strings.Cut(rest, ",")
	if !ok {
		return nil, "", false
	}
	parts := strings.Split(meta, ";")
	mime := strings.ToLower(strings.TrimSpace(parts[0]))
	b64 := false
	for _, p := range parts[1:] {
		if strings.EqualFold(strings.TrimSpace(p), "base64") {
			b64 = true
		}
	}
	// Reject before decoding anything larger than one picture may be.
	if len(payload) > maxExportImageBytes*4/3+4096 {
		return nil, "", false
	}
	if b64 {
		clean := strings.Map(func(r rune) rune {
			if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
				return -1
			}
			return r
		}, payload)
		if u, err := url.PathUnescape(clean); err == nil {
			clean = u
		}
		clean = strings.TrimRight(clean, "=")
		data, err := base64.RawStdEncoding.DecodeString(clean)
		if err != nil {
			if data, err = base64.RawURLEncoding.DecodeString(clean); err != nil {
				return nil, "", false
			}
		}
		return data, mime, true
	}
	data, err := url.PathUnescape(payload)
	if err != nil {
		return nil, "", false
	}
	return []byte(data), mime, true
}

// assetRef parses a Grown asset URL (path only, or an absolute http(s) URL on
// any host; only the path is used, nothing is fetched).
func assetRef(src string) (docID, sha string, ok bool) {
	u, err := url.Parse(strings.TrimSpace(src))
	if err != nil {
		return "", "", false
	}
	if u.Scheme != "" && u.Scheme != "http" && u.Scheme != "https" {
		return "", "", false
	}
	docID, sha, ok = AssetPath(u.Path)
	return docID, sha, ok && sha != ""
}

// exportImages rewrites every <img> of an export and writes its pictures.
type exportImages struct {
	ctx    context.Context
	dir    string
	inline bool
	assets AssetLoader
	bySrc  map[string]string // original src -> name ("" = dropped)
	images []exportImage
	total  int
}

// resolve returns the new src for an <img src>, or "" to drop it.
func (e *exportImages) resolve(src string) string {
	if name, ok := e.bySrc[src]; ok {
		return name
	}
	name := e.load(src)
	e.bySrc[src] = name
	return name
}

func (e *exportImages) load(src string) string {
	var data []byte
	declared := ""
	if d, m, ok := decodeDataURL(strings.TrimSpace(src)); ok {
		data, declared = d, m
	} else if docID, sha, ok := assetRef(src); ok && e.assets != nil {
		d, err := e.assets(e.ctx, docID, sha)
		if err != nil {
			return ""
		}
		data = d
	} else {
		return ""
	}
	mime := sniffImage(data, declared)
	if mime == "" || len(data) > maxExportImageBytes ||
		e.total+len(data) > maxExportImagesBytes || len(e.images) >= maxExportImages {
		return ""
	}
	name := fmt.Sprintf("grown-img-%d.%s", len(e.images)+1, exportImageExt[mime])
	path := filepath.Join(e.dir, name)
	body := data
	if e.inline {
		body = []byte("data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data))
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return ""
	}
	e.total += len(data)
	e.images = append(e.images, exportImage{name: name, path: path, mime: mime})
	return name
}

// rewrite returns doc with every <img>'s src replaced by resolve (empty
// when dropped) and srcset dropped. All other markup is copied byte for byte.
func (e *exportImages) rewrite(doc []byte) []byte {
	var out bytes.Buffer
	out.Grow(len(doc))
	z := xhtml.NewTokenizer(bytes.NewReader(doc))
	for {
		tt := z.Next()
		if tt == xhtml.ErrorToken {
			break
		}
		raw := append([]byte(nil), z.Raw()...)
		if tt != xhtml.StartTagToken && tt != xhtml.SelfClosingTagToken {
			out.Write(raw)
			continue
		}
		name, hasAttr := z.TagName()
		if string(name) != "img" {
			out.Write(raw)
			continue
		}
		var attrs [][2]string
		for hasAttr {
			var k, v []byte
			k, v, hasAttr = z.TagAttr()
			attrs = append(attrs, [2]string{string(k), string(v)})
		}
		out.WriteString("<img")
		for _, a := range attrs {
			switch a[0] {
			case "src":
				// A dropped picture keeps an empty src: pandoc's reader
				// skips an <img> without one, and the filter turns this
				// one into its alt text.
				fmt.Fprintf(&out, ` src="%s"`, html.EscapeString(e.resolve(a[1])))
			case "srcset":
			default:
				if !validAttrName(a[0]) {
					continue
				}
				fmt.Fprintf(&out, ` %s="%s"`, a[0], html.EscapeString(a[1]))
			}
		}
		out.WriteString(">")
	}
	return out.Bytes()
}

// validAttrName reports whether k can be written back as an attribute name.
func validAttrName(k string) bool {
	if k == "" {
		return false
	}
	for i := 0; i < len(k); i++ {
		c := k[i]
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == ':' || c == '.') {
			return false
		}
	}
	return true
}

// luaString quotes s as a Lua string literal (decimal escapes for anything
// but letters, digits and a few path characters).
func luaString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte("/._-", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "\\%03d", c)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// filter returns export_images.lua with the table of pictures prepended.
func (e *exportImages) filter() []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "local GROWN_INLINE = %t\nlocal GROWN_IMAGES = {\n", e.inline)
	for _, im := range e.images {
		fmt.Fprintf(&b, "  [%s] = { path = %s, mime = %s },\n", luaString(im.name), luaString(im.path), luaString(im.mime))
	}
	b.WriteString("}\n")
	b.Write(exportImagesFilter)
	return b.Bytes()
}

// prepareExportImages rewrites the pictures of doc for a pandoc run in dir,
// returning the new HTML and the Lua filter source that feeds them to pandoc.
func prepareExportImages(ctx context.Context, doc []byte, dir string, inline bool, assets AssetLoader) ([]byte, []byte) {
	e := &exportImages{ctx: ctx, dir: dir, inline: inline, assets: assets, bySrc: map[string]string{}}
	out := e.rewrite(doc)
	return out, e.filter()
}
