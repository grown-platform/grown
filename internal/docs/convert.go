package docs

import (
	"bytes"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

// ErrPandocUnavailable is returned when the pandoc binary is not on PATH.
var ErrPandocUnavailable = errors.New("pandoc is not installed on this server")

// ErrPDFUnavailable is returned for a PDF export when no PDF engine is
// installed. The default image ships pandoc without one: Docs and Sheets
// build their PDFs in the browser and only use this path as a fallback.
var ErrPDFUnavailable = errors.New("no PDF engine is installed on this server (PDF files are generated in the browser)")

// pdfEngines are the pandoc --pdf-engine programs we accept, in order of
// preference. tectonic fetches its TeX bundle from the network on first use;
// the others work offline once installed.
var pdfEngines = []string{"tectonic", "xelatex", "lualatex", "pdflatex", "weasyprint", "wkhtmltopdf"}

// PDFEngine returns the PDF engine pandoc would use, or "" when none of
// pdfEngines is on PATH (or pandoc itself is missing).
func PDFEngine() string {
	if _, err := exec.LookPath("pandoc"); err != nil {
		return ""
	}
	for _, e := range pdfEngines {
		if _, err := exec.LookPath(e); err == nil {
			return e
		}
	}
	return ""
}

// ConvertCapabilities is what GET /api/v1/docs/convert/capabilities returns.
type ConvertCapabilities struct {
	// Pandoc reports whether the pandoc binary is installed.
	Pandoc bool `json:"pandoc"`
	// Formats lists the export formats the server can produce now.
	Formats []string `json:"formats"`
	// PDF reports whether ?to=pdf works (pandoc plus a PDF engine).
	PDF       bool   `json:"pdf"`
	PDFEngine string `json:"pdf_engine,omitempty"`
}

// Capabilities probes PATH for pandoc and a PDF engine.
func Capabilities() ConvertCapabilities {
	c := ConvertCapabilities{Formats: []string{}}
	if _, err := exec.LookPath("pandoc"); err != nil {
		return c
	}
	c.Pandoc = true
	c.PDFEngine = PDFEngine()
	c.PDF = c.PDFEngine != ""
	for k := range convertFormats {
		if k != "pdf" || c.PDF {
			c.Formats = append(c.Formats, k)
		}
	}
	sort.Strings(c.Formats)
	return c
}

// ConvertFormat describes a downloadable export target produced by pandoc.
type ConvertFormat struct {
	Pandoc string // pandoc writer name
	Ext    string // file extension
	MIME   string // response Content-Type
	// Standalone passes --standalone: pandoc otherwise emits a body fragment
	// for text writers, which for RTF is not an openable document (no {\rtf1
	// header or font table). Zip writers (docx/odt/epub) are always complete.
	Standalone bool
}

// convertFormats are the binary/markup exports we delegate to pandoc. Plain
// text and HTML are handled client-side and are intentionally absent; PDF is
// built client-side too, "pdf" here is the fallback when a PDF engine exists.
var convertFormats = map[string]ConvertFormat{
	"docx": {"docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", false},
	"odt":  {"odt", "odt", "application/vnd.oasis.opendocument.text", false},
	"rtf":  {"rtf", "rtf", "application/rtf", true},
	"epub": {"epub3", "epub", "application/epub+zip", false},
	"md":   {"gfm", "md", "text/markdown", false},
	"pdf":  {"pdf", "pdf", "application/pdf", false},
}

// ConvertSupported reports whether `to` is a pandoc-backed export format.
func ConvertSupported(to string) (ConvertFormat, bool) {
	f, ok := convertFormats[to]
	return f, ok
}

// ImportFormat describes an external document format pandoc can read into HTML.
type ImportFormat struct {
	Pandoc string // pandoc reader name
	Ext    string // temp input file extension
	MIME   string // accepted upload Content-Type
}

// importFormats are the external formats we accept and convert to HTML via
// pandoc, the inverse of convertFormats. html is round-tripped through pandoc's
// reader/writer to sanitise it; txt is read as (mostly) plain markdown.
var importFormats = map[string]ImportFormat{
	"docx":     {"docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	"odt":      {"odt", "odt", "application/vnd.oasis.opendocument.text"},
	"rtf":      {"rtf", "rtf", "application/rtf"},
	"epub":     {"epub", "epub", "application/epub+zip"},
	"md":       {"gfm", "md", "text/markdown"},
	"markdown": {"gfm", "md", "text/markdown"},
	"html":     {"html", "html", "text/html"},
	"txt":      {"markdown", "txt", "text/plain"},
}

// ImportSupported reports whether `from` is a pandoc-backed import format.
func ImportSupported(from string) (ImportFormat, bool) {
	f, ok := importFormats[from]
	return f, ok
}

// maxConvertBytes bounds the input accepted for conversion in either direction.
const maxConvertBytes = 16 << 20

// MaxConvertBytes is maxConvertBytes, for the HTTP handlers.
const MaxConvertBytes = maxConvertBytes

// ConvertHTML converts an HTML document to the target format via pandoc,
// returning the encoded file bytes. Grown asset URLs are dropped; use
// ConvertHTMLWith to resolve them.
func ConvertHTML(ctx context.Context, html []byte, to string) ([]byte, ConvertFormat, error) {
	return ConvertHTMLWith(ctx, html, to, ExportOptions{})
}

// ConvertHTMLWith is ConvertHTML with the document's pictures resolved
// through opts (see export_images.go). Binary writers (docx/odt/epub) require
// a real output file, so we always route through a temp dir.
func ConvertHTMLWith(ctx context.Context, html []byte, to string, opts ExportOptions) ([]byte, ConvertFormat, error) {
	f, ok := convertFormats[to]
	if !ok {
		return nil, ConvertFormat{}, fmt.Errorf("unsupported format %q", to)
	}
	if len(html) > maxConvertBytes {
		return nil, f, fmt.Errorf("input too large: %d bytes (max %d)", len(html), maxConvertBytes)
	}
	if _, err := exec.LookPath("pandoc"); err != nil {
		return nil, f, ErrPandocUnavailable
	}
	engine := ""
	if f.Pandoc == "pdf" {
		if engine = PDFEngine(); engine == "" {
			return nil, f, ErrPDFUnavailable
		}
	}
	dir, err := os.MkdirTemp("", "grown-docs-export-*")
	if err != nil {
		return nil, f, fmt.Errorf("temp dir: %w", err)
	}
	defer os.RemoveAll(dir)
	outPath := filepath.Join(dir, "out."+f.Ext)

	// Pictures: data: and asset URLs become files in dir, handed to pandoc
	// by a Lua filter; any other src is removed. Markdown keeps them inline.
	html, filter := prepareExportImages(ctx, html, dir, f.Pandoc == "gfm", opts.Assets)
	filterPath := filepath.Join(dir, "images.lua")
	if err := os.WriteFile(filterPath, filter, 0o600); err != nil {
		return nil, f, fmt.Errorf("write filter: %w", err)
	}

	// --sandbox: the HTML is user-supplied, so pandoc must not resolve <img
	// src> / <link href> against the server's filesystem or network (it would
	// otherwise embed e.g. /etc/passwd into the docx, or fetch internal URLs).
	// The pictures come in through the filter's mediabag instead.
	args := []string{"--sandbox", "-f", "html", "-t", f.Pandoc, "--lua-filter", filterPath, "-o", outPath}
	if f.Standalone {
		args = append(args, "--standalone")
	}
	if f.Pandoc == "pdf" {
		// pandoc needs an external engine to render PDF.
		args = append(args, "--pdf-engine="+engine)
	}
	cmd := exec.CommandContext(ctx, "pandoc", args...)
	cmd.Stdin = bytes.NewReader(html)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, f, fmt.Errorf("pandoc: %w: %s", err, stderr.String())
	}
	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, f, fmt.Errorf("read output: %w", err)
	}
	return data, f, nil
}

// ImportToHTML converts an external document to HTML via pandoc, returning the
// HTML bytes. Binary readers (docx/odt/epub) require a real input file, so we
// always route through a temp file. Pictures packed in the file are embedded
// as data URIs (by the sanitize filter) so they survive the import once the
// source file is discarded.
func ImportToHTML(ctx context.Context, data []byte, from string) ([]byte, error) {
	f, ok := importFormats[from]
	if !ok {
		return nil, fmt.Errorf("unsupported format %q", from)
	}
	if len(data) > maxConvertBytes {
		return nil, fmt.Errorf("input too large: %d bytes (max %d)", len(data), maxConvertBytes)
	}
	in, err := os.CreateTemp("", "grown-docs-import-*."+f.Ext)
	if err != nil {
		return nil, fmt.Errorf("temp file: %w", err)
	}
	inPath := in.Name()
	defer os.Remove(inPath)
	if _, err := in.Write(data); err != nil {
		in.Close()
		return nil, fmt.Errorf("write input: %w", err)
	}
	if err := in.Close(); err != nil {
		return nil, fmt.Errorf("close input: %w", err)
	}

	filter, err := os.CreateTemp("", "grown-docs-sanitize-*.lua")
	if err != nil {
		return nil, fmt.Errorf("temp file: %w", err)
	}
	filterPath := filter.Name()
	defer os.Remove(filterPath)
	if _, err := filter.Write(importSanitizeFilter); err != nil {
		filter.Close()
		return nil, fmt.Errorf("write filter: %w", err)
	}
	if err := filter.Close(); err != nil {
		return nil, fmt.Errorf("close filter: %w", err)
	}

	html, err := runPandocImport(ctx, f.Pandoc, inPath, filterPath)
	if err != nil {
		return nil, err
	}
	return html, nil
}

// importSanitizeFilter is a pandoc Lua filter run on every import. It drops
// raw HTML (e.g. <script> in markdown/txt), on* attributes and script-capable
// link/image URLs, so an uploaded file cannot smuggle active content into the
// returned HTML. It runs under --sandbox: pandoc loads filters itself.
//
//go:embed import_sanitize.lua
var importSanitizeFilter []byte

// runPandocImport runs pandoc to read inPath as `reader` and write HTML to
// stdout. Pictures packed in the file are inlined as data URIs by the
// sanitize filter, not by --embed-resources: pandoc 3.1.13 (Alpine; what
// production shipped before pandoc was pinned) applies --embed-resources
// outside --sandbox, so an uploaded html/md file could inline arbitrary
// server files (<img src="/etc/passwd">) or fetch internal URLs (SSRF).
func runPandocImport(ctx context.Context, reader, inPath, filterPath string) ([]byte, error) {
	// --sandbox confines pandoc's own IO to inPath.
	// --wrap=none keeps tags and long lines unbroken.
	args := []string{"--sandbox", "-f", reader, "-t", "html", "--wrap=none", "--lua-filter", filterPath, inPath}
	cmd := exec.CommandContext(ctx, "pandoc", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("pandoc: %w: %s", err, stderr.String())
	}
	return stdout.Bytes(), nil
}
