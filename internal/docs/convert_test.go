package docs

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Export-side tests for ConvertHTML plus HTML → X → HTML fidelity checks. The
// fixtures are self-authored (testdata/fidelity.html); OnlyOffice documents
// are only ever used by the opt-in corpus runner in corpus_test.go.

const simpleHTML = `<h1>Export Title</h1><p>Hello <strong>world</strong></p>`

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return b
}

// zipEntry returns the named entry of a zip archive, failing the test if the
// archive is invalid or the entry is missing.
func zipEntry(t *testing.T, data []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip archive: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		defer rc.Close()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(b)
	}
	t.Fatalf("zip entry %q missing", name)
	return ""
}

// zipHasPrefix reports whether any entry name in the archive starts with prefix.
func zipHasPrefix(t *testing.T, data []byte, prefix string) bool {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip archive: %v", err)
	}
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, prefix) {
			return true
		}
	}
	return false
}

// TestConvertHTMLExportFormats exports a small document to every
// pandoc-backed format and checks each result is a well-formed container of
// the right kind carrying the document text.
func TestConvertHTMLExportFormats(t *testing.T) {
	requirePandoc(t)
	ctx := context.Background()

	checks := map[string]func(t *testing.T, out []byte){
		"docx": func(t *testing.T, out []byte) {
			doc := zipEntry(t, out, "word/document.xml")
			for _, want := range []string{"Export Title", "Hello", "world", "<w:b"} {
				if !strings.Contains(doc, want) {
					t.Errorf("word/document.xml missing %q", want)
				}
			}
			zipEntry(t, out, "[Content_Types].xml")
		},
		"odt": func(t *testing.T, out []byte) {
			if got := zipEntry(t, out, "mimetype"); got != "application/vnd.oasis.opendocument.text" {
				t.Errorf("odt mimetype = %q", got)
			}
			content := zipEntry(t, out, "content.xml")
			for _, want := range []string{"Export Title", "Hello", "world"} {
				if !strings.Contains(content, want) {
					t.Errorf("content.xml missing %q", want)
				}
			}
		},
		"epub": func(t *testing.T, out []byte) {
			if got := zipEntry(t, out, "mimetype"); got != "application/epub+zip" {
				t.Errorf("epub mimetype = %q", got)
			}
			zipEntry(t, out, "META-INF/container.xml")
		},
		"rtf": func(t *testing.T, out []byte) {
			s := string(out)
			// A bare pandoc RTF fragment is not an openable file; it must be a
			// standalone document with the {\rtf1 header and font table.
			if !strings.HasPrefix(s, `{\rtf1`) {
				t.Errorf("rtf output is not a standalone document, starts %q", firstN(s, 40))
			}
			if !strings.Contains(s, `\fonttbl`) {
				t.Errorf("rtf output missing font table")
			}
			if !strings.Contains(s, "Export Title") || !strings.Contains(s, `{\b world}`) {
				t.Errorf("rtf output missing text/bold run: %s", firstN(s, 400))
			}
		},
		"md": func(t *testing.T, out []byte) {
			s := string(out)
			if !strings.Contains(s, "# Export Title") || !strings.Contains(s, "**world**") {
				t.Errorf("markdown output = %q", s)
			}
		},
		"pdf": func(t *testing.T, out []byte) {
			if !bytes.HasPrefix(out, []byte("%PDF-")) {
				t.Errorf("pdf output missing %%PDF- header")
			}
		},
	}

	for to := range convertFormats {
		check, ok := checks[to]
		if !ok {
			t.Errorf("no export check for supported format %q; add one", to)
			continue
		}
		t.Run(to, func(t *testing.T) {
			if to == "pdf" {
				if _, err := exec.LookPath("tectonic"); err != nil {
					t.Skip("pdf export needs the tectonic engine, not installed")
				}
			}
			out, f, err := ConvertHTML(ctx, []byte(simpleHTML), to)
			if err != nil {
				t.Fatalf("ConvertHTML(%q): %v", to, err)
			}
			if len(out) == 0 {
				t.Fatal("empty output")
			}
			if f.Ext != to {
				t.Errorf("format ext = %q, want %q", f.Ext, to)
			}
			check(t, out)
		})
	}
}

func firstN(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func TestConvertSupported(t *testing.T) {
	want := map[string]string{
		"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"odt":  "application/vnd.oasis.opendocument.text",
		"rtf":  "application/rtf",
		"epub": "application/epub+zip",
		"md":   "text/markdown",
		"pdf":  "application/pdf",
	}
	for to, mime := range want {
		f, ok := ConvertSupported(to)
		if !ok {
			t.Errorf("ConvertSupported(%q) = false", to)
			continue
		}
		if f.MIME != mime || f.Ext != to {
			t.Errorf("ConvertSupported(%q) = %+v, want MIME %q ext %q", to, f, mime, to)
		}
	}
	// Plain text and HTML are client-side exports.
	for _, to := range []string{"txt", "html", "doc", ""} {
		if _, ok := ConvertSupported(to); ok {
			t.Errorf("ConvertSupported(%q) = true, want false", to)
		}
	}
}

func TestConvertHTMLUnsupportedFormat(t *testing.T) {
	// No pandoc needed: the format check rejects before shelling out.
	if _, _, err := ConvertHTML(context.Background(), []byte(simpleHTML), "txt"); err == nil {
		t.Fatal("ConvertHTML(txt): want error, got nil")
	}
}

// TestConvertHTMLOversize is a regression test: maxConvertBytes documents the
// export bound but ConvertHTML never enforced it, so any caller that did not
// pre-truncate handed pandoc an unbounded document.
func TestConvertHTMLOversize(t *testing.T) {
	big := make([]byte, maxConvertBytes+1)
	if _, _, err := ConvertHTML(context.Background(), big, "docx"); err == nil {
		t.Fatal("ConvertHTML with oversize input: want error, got nil")
	}
}

func TestConvertHTMLAtSizeLimit(t *testing.T) {
	requirePandoc(t)
	if testing.Short() {
		t.Skip("large conversion skipped in -short mode")
	}
	// Exactly maxConvertBytes of HTML is accepted. The bulk is an HTML comment
	// so pandoc scans rather than builds a 16 MiB document (~5s, not ~20s).
	head, tail := []byte("<p>lorem ipsum</p><!--"), []byte("-->")
	html := append(append(head, bytes.Repeat([]byte("x"), maxConvertBytes-len(head)-len(tail))...), tail...)
	out, _, err := ConvertHTML(context.Background(), html, "md")
	if err != nil {
		t.Fatalf("ConvertHTML at limit: %v", err)
	}
	if !bytes.Contains(out, []byte("lorem ipsum")) {
		t.Fatal("ConvertHTML at limit: text missing from output")
	}
}

// TestConvertPandocMissing exercises the path taken when pandoc is not on
// PATH: both directions must return a clean error rather than panic or
// produce an empty file. (Every other pandoc test skips via requirePandoc.)
func TestConvertPandocMissing(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := exec.LookPath("pandoc"); err == nil {
		t.Skip("pandoc still resolvable with an empty PATH")
	}
	ctx := context.Background()
	if out, _, err := ConvertHTML(ctx, []byte(simpleHTML), "docx"); err == nil {
		t.Fatalf("ConvertHTML without pandoc: want error, got %d bytes", len(out))
	} else if !strings.Contains(err.Error(), "pandoc") {
		t.Errorf("ConvertHTML error %q should mention pandoc", err)
	}
	if _, err := ImportToHTML(ctx, []byte(simpleHTML), "html"); err == nil {
		t.Fatal("ImportToHTML without pandoc: want error, got nil")
	}
}

func TestConvertHTMLCancelledContext(t *testing.T) {
	requirePandoc(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := ConvertHTML(ctx, []byte(simpleHTML), "docx"); err == nil {
		t.Fatal("ConvertHTML with cancelled context: want error, got nil")
	}
	ctx, cancel = context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	time.Sleep(time.Millisecond)
	if _, err := ImportToHTML(ctx, []byte(simpleHTML), "html"); err == nil {
		t.Fatal("ImportToHTML with expired context: want error, got nil")
	}
}

func TestConvertHTMLNoTempLeak(t *testing.T) {
	requirePandoc(t)
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	if _, _, err := ConvertHTML(context.Background(), []byte(simpleHTML), "docx"); err != nil {
		t.Fatal(err)
	}
	if _, err := ImportToHTML(context.Background(), []byte(simpleHTML), "html"); err != nil {
		t.Fatal(err)
	}
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		t.Errorf("temp file left behind: %s", e.Name())
	}
}

// ---- fidelity ---------------------------------------------------------------

// feature is one structural element of testdata/fidelity.html and a pattern
// that proves it survived a round trip into pandoc's HTML.
type feature struct {
	name string
	re   *regexp.Regexp
}

var fidelityFeatures = []feature{
	{"h1", regexp.MustCompile(`<h1[^>]*>(<span[^>]*></span>)?Fidelity Heading</h1>`)},
	{"h2", regexp.MustCompile(`<h2[^>]*>(<span[^>]*></span>)?Second Level</h2>`)},
	{"h3", regexp.MustCompile(`<h3[^>]*>(<span[^>]*></span>)?Third Level</h3>`)},
	{"bold", regexp.MustCompile(`<strong>bold words</strong>`)},
	{"italic", regexp.MustCompile(`<em>italic words</em>`)},
	{"underline", regexp.MustCompile(`<u>underlined words</u>`)},
	{"strike", regexp.MustCompile(`<del>struck words</del>`)},
	{"link", regexp.MustCompile(`<a href="https://example.com/grown">a\s+grown\s+link</a>`)},
	{"bullet list", regexp.MustCompile(`(?s)<ul>\s*<li>bullet alpha</li>`)},
	{"nested list", regexp.MustCompile(`(?s)<ul>\s*<li>bullet nested</li>\s*</ul>\s*</li>`)},
	{"ordered list", regexp.MustCompile(`(?s)<ol[^>]*>\s*<li>ordered one</li>\s*<li>ordered two</li>`)},
	{"table", regexp.MustCompile(`(?s)<table.*<th>Col A</th>.*<td>cell b2</td>.*</table>`)},
	{"image", regexp.MustCompile(`<img [^>]*src="data:image/png;base64,iVBOR`)},
	{"blockquote", regexp.MustCompile(`(?s)<blockquote>\s*<p>quoted passage</p>`)},
	{"code block", regexp.MustCompile(`<pre><code>code_sample\(\)</code></pre>`)},
	{"alignment", regexp.MustCompile(`text-align:\s*center`)},
}

// fidelityLosses are features pandoc is known to drop for a given format's
// round trip. They are asserted as *expected* losses so a pandoc upgrade that
// starts preserving them fails loudly and this table gets updated.
var fidelityLosses = map[string]map[string]string{
	"docx": {
		"alignment": "pandoc's AST has no paragraph alignment; inline styles are dropped",
	},
	"odt": {
		"underline": "pandoc's odt reader maps underline to <em>",
		"alignment": "pandoc's AST has no paragraph alignment",
	},
	"epub": {
		"alignment": "pandoc's AST has no paragraph alignment",
	},
	"md": {
		"alignment": "Markdown has no paragraph alignment",
	},
	"rtf": {
		"bullet list":  "pandoc's rtf reader flattens lists into '•' paragraphs",
		"nested list":  "pandoc's rtf reader flattens lists into '–' paragraphs",
		"ordered list": "pandoc's rtf reader flattens lists into '1.' paragraphs",
		"table":        "pandoc's rtf reader loses the header row (<th> becomes <td>)",
		"blockquote":   "RTF has no blockquote; it becomes an indented paragraph",
		"alignment":    "pandoc's AST has no paragraph alignment",
	},
}

// TestConvertFidelityRoundTrip exports testdata/fidelity.html to each
// round-trippable format, imports it back with ImportToHTML, and checks which
// structural features survived. Tagged as the port of OnlyOffice's
// TestOOOXml2Odf format-to-format harness.
func TestConvertFidelityRoundTrip(t *testing.T) {
	requirePandoc(t)
	ctx := context.Background()
	src := readFixture(t, "fidelity.html")

	for _, format := range []string{"docx", "odt", "rtf", "epub", "md"} {
		t.Run(format, func(t *testing.T) {
			encoded, _, err := ConvertHTML(ctx, src, format)
			if err != nil {
				t.Fatalf("ConvertHTML(%q): %v", format, err)
			}
			back, err := ImportToHTML(ctx, encoded, format)
			if err != nil {
				t.Fatalf("ImportToHTML(%q): %v", format, err)
			}
			assertFeatures(t, string(back), fidelityLosses[format])
		})
	}
}

// assertFeatures checks every fidelity feature is present unless listed in
// losses, in which case it must be absent (an "expected loss").
func assertFeatures(t *testing.T, html string, losses map[string]string) {
	t.Helper()
	for _, f := range fidelityFeatures {
		got := f.re.MatchString(html)
		reason, lost := losses[f.name]
		switch {
		case lost && got:
			t.Errorf("%s: listed as expected loss (%s) but now survives; update fidelityLosses", f.name, reason)
		case !lost && !got:
			t.Errorf("%s: lost in round trip (pattern %s)\n%s", f.name, f.re, html)
		}
	}
}

// TestConvertHTMLImportPassthroughFidelity checks the html importer (used to
// sanitise pasted/uploaded HTML) keeps every structural feature except
// alignment.
func TestConvertHTMLImportPassthroughFidelity(t *testing.T) {
	requirePandoc(t)
	back, err := ImportToHTML(context.Background(), readFixture(t, "fidelity.html"), "html")
	if err != nil {
		t.Fatal(err)
	}
	assertFeatures(t, string(back), map[string]string{
		"alignment": "pandoc's AST has no paragraph alignment",
	})
}

// TestConvertDocxToOdt ports the idea of OnlyOffice's TestOOOXml2Odf harness
// (OOXML → ODF): a docx imported into Grown and re-exported as odt keeps its
// headings, emphasis, list, and table.
func TestConvertDocxToOdt(t *testing.T) {
	t.Run("oo:core/X2tConverter/test/TestOOOXml2Odf/test.cpp#docx to odt", func(t *testing.T) {
		requirePandoc(t)
		ctx := context.Background()
		docx, _, err := ConvertHTML(ctx, readFixture(t, "fidelity.html"), "docx")
		if err != nil {
			t.Fatal(err)
		}
		html, err := ImportToHTML(ctx, docx, "docx")
		if err != nil {
			t.Fatal(err)
		}
		odt, _, err := ConvertHTML(ctx, html, "odt")
		if err != nil {
			t.Fatal(err)
		}
		content := zipEntry(t, odt, "content.xml")
		for _, want := range []string{"Fidelity Heading", "bold words", "bullet nested", "cell b2", "https://example.com/grown"} {
			if !strings.Contains(content, want) {
				t.Errorf("odt content.xml missing %q", want)
			}
		}
		if !zipHasPrefix(t, odt, "Pictures/") {
			t.Error("odt lost the embedded image (no Pictures/ entry)")
		}
		back, err := ImportToHTML(ctx, odt, "odt")
		if err != nil {
			t.Fatal(err)
		}
		assertFeatures(t, string(back), map[string]string{
			"underline": "pandoc's odt reader maps underline to <em>",
			"alignment": "pandoc's AST has no paragraph alignment",
		})
	})
}

// ---- sandboxing (regression) --------------------------------------------------

// secretFile writes a file only the server can see and returns its path and
// the marker it contains (plain and base64, as pandoc would embed it).
func secretFile(t *testing.T) (path, marker, marker64 string) {
	t.Helper()
	marker = "GROWNSERVERSECRET7f3a" // no chars pandoc would percent-encode
	path = t.TempDir() + "/secret.txt"
	if err := os.WriteFile(path, []byte(marker), 0o600); err != nil {
		t.Fatal(err)
	}
	return path, marker, base64.StdEncoding.EncodeToString([]byte(marker))[:16]
}

// TestImportToHTMLSandboxLocalFile is a regression test: with
// --embed-resources and no --sandbox, an uploaded html/md file referencing a
// server path had that file inlined as a data: URI in the returned HTML.
func TestImportToHTMLSandboxLocalFile(t *testing.T) {
	requirePandoc(t)
	path, marker, marker64 := secretFile(t)
	inputs := map[string]string{
		"html": `<p>x</p><p><img src="` + path + `"></p><link rel="stylesheet" href="` + path + `">`,
		"md":   "x\n\n![leak](" + path + ")\n",
		"txt":  "x\n\n![leak](" + path + ")\n",
	}
	for from, in := range inputs {
		t.Run(from, func(t *testing.T) {
			out, err := ImportToHTML(context.Background(), []byte(in), from)
			if err != nil {
				t.Fatalf("ImportToHTML: %v", err)
			}
			if s := string(out); strings.Contains(s, marker) || strings.Contains(s, marker64) {
				t.Fatalf("server file leaked into imported HTML: %s", s)
			}
		})
	}
}

// TestConvertHTMLSandboxLocalFile: the export side had the same hole — a
// posted <img src="/server/path"> was packed into the docx/odt/epub media.
func TestConvertHTMLSandboxLocalFile(t *testing.T) {
	requirePandoc(t)
	path, marker, _ := secretFile(t)
	html := []byte(`<p>x</p><p><img src="` + path + `"></p>`)
	for _, to := range []string{"docx", "odt", "epub"} {
		t.Run(to, func(t *testing.T) {
			out, _, err := ConvertHTML(context.Background(), html, to)
			if err != nil {
				t.Fatalf("ConvertHTML: %v", err)
			}
			zr, err := zip.NewReader(bytes.NewReader(out), int64(len(out)))
			if err != nil {
				t.Fatal(err)
			}
			for _, f := range zr.File {
				rc, _ := f.Open()
				b, _ := io.ReadAll(rc)
				rc.Close()
				if bytes.Contains(b, []byte(marker)) {
					t.Fatalf("server file leaked into %s entry %s", to, f.Name)
				}
			}
		})
	}
}

// TestConvertSandboxNoFetch: neither direction may make network requests on
// behalf of user content (SSRF against internal services).
func TestConvertSandboxNoFetch(t *testing.T) {
	requirePandoc(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("\x89PNG\r\n\x1a\n"))
	}))
	defer srv.Close()
	html := []byte(`<p>x</p><p><img src="` + srv.URL + `/pixel.png"></p>`)
	ctx := context.Background()
	if _, err := ImportToHTML(ctx, html, "html"); err != nil {
		t.Fatalf("ImportToHTML: %v", err)
	}
	if _, _, err := ConvertHTML(ctx, html, "docx"); err != nil {
		t.Fatalf("ConvertHTML: %v", err)
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("pandoc fetched a remote resource %d time(s)", n)
	}
}

// TestSandboxKeepsEmbeddedMedia guards the other side of --sandbox: images
// packed inside the uploaded document itself must still come back inline.
func TestSandboxKeepsEmbeddedMedia(t *testing.T) {
	requirePandoc(t)
	ctx := context.Background()
	for _, format := range []string{"docx", "odt", "epub", "rtf"} {
		t.Run(format, func(t *testing.T) {
			enc, _, err := ConvertHTML(ctx, readFixture(t, "fidelity.html"), format)
			if err != nil {
				t.Fatal(err)
			}
			back, err := ImportToHTML(ctx, enc, format)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(back), `src="data:image/png;base64,`) {
				t.Fatalf("embedded image not inlined after import: %s", back)
			}
		})
	}
}
