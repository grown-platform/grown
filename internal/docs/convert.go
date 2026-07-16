package docs

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
)

// ConvertFormat describes a downloadable export target produced by pandoc.
type ConvertFormat struct {
	Pandoc string // pandoc writer name
	Ext    string // file extension
	MIME   string // response Content-Type
}

// convertFormats are the binary/markup exports we delegate to pandoc. Plain
// text, HTML, and PDF are handled client-side and are intentionally absent.
var convertFormats = map[string]ConvertFormat{
	"docx": {"docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	"odt":  {"odt", "odt", "application/vnd.oasis.opendocument.text"},
	"rtf":  {"rtf", "rtf", "application/rtf"},
	"epub": {"epub3", "epub", "application/epub+zip"},
	"md":   {"gfm", "md", "text/markdown"},
	"pdf":  {"pdf", "pdf", "application/pdf"},
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

// maxConvertBytes bounds the HTML accepted for conversion.
const maxConvertBytes = 16 << 20

// ConvertHTML converts an HTML document to the target format via pandoc,
// returning the encoded file bytes. Binary writers (docx/odt/epub) require a
// real output file, so we always route through a temp file.
func ConvertHTML(ctx context.Context, html []byte, to string) ([]byte, ConvertFormat, error) {
	f, ok := convertFormats[to]
	if !ok {
		return nil, ConvertFormat{}, fmt.Errorf("unsupported format %q", to)
	}
	out, err := os.CreateTemp("", "grown-docs-*."+f.Ext)
	if err != nil {
		return nil, f, fmt.Errorf("temp file: %w", err)
	}
	outPath := out.Name()
	out.Close()
	defer os.Remove(outPath)

	args := []string{"-f", "html", "-t", f.Pandoc, "-o", outPath}
	if f.Pandoc == "pdf" {
		// pandoc needs an external engine to render PDF; tectonic compiles via LaTeX.
		args = append(args, "--pdf-engine=tectonic")
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
// always route through a temp file. Images are embedded as data URIs so they
// survive the import once the source file is discarded.
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

	// Prefer --embed-resources (inline images as data URIs). Older pandoc builds
	// lack the flag, so fall back to a plain conversion if the first run fails.
	html, err := runPandocImport(ctx, f.Pandoc, inPath, true)
	if err != nil {
		if html, err = runPandocImport(ctx, f.Pandoc, inPath, false); err != nil {
			return nil, err
		}
	}
	return html, nil
}

// runPandocImport runs pandoc to read inPath as `reader` and write HTML to
// stdout, optionally embedding external resources as data URIs.
func runPandocImport(ctx context.Context, reader, inPath string, embed bool) ([]byte, error) {
	args := []string{"-f", reader, "-t", "html"}
	if embed {
		args = append(args, "--embed-resources")
	}
	args = append(args, inPath)
	cmd := exec.CommandContext(ctx, "pandoc", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("pandoc: %w: %s", err, stderr.String())
	}
	return stdout.Bytes(), nil
}
