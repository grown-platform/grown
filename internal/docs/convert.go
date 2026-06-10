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
