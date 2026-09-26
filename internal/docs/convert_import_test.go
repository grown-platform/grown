package docs

import (
	"context"
	"os/exec"
	"strings"
	"testing"
)

// requirePandoc skips the test when pandoc is unavailable so CI without it still
// passes. The import path shells out to pandoc, exactly like ConvertHTML.
func requirePandoc(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("pandoc"); err != nil {
		t.Skip("pandoc not installed")
	}
}

// assertRoundTrip checks the imported HTML preserved the document's structure:
// the heading text, body text, and a bold run around "world".
func assertRoundTrip(t *testing.T, html string) {
	t.Helper()
	if !strings.Contains(html, "Title") {
		t.Errorf("imported HTML missing heading text %q: %s", "Title", html)
	}
	if !strings.Contains(html, "Hello") {
		t.Errorf("imported HTML missing body text %q: %s", "Hello", html)
	}
	// pandoc renders emphasis as <strong>world</strong>; assert bold survived.
	if !strings.Contains(html, "<strong>world</strong>") {
		t.Errorf("imported HTML missing bold run <strong>world</strong>: %s", html)
	}
}

// TestImportToHTMLRoundTrip exports known HTML to each binary/markup format with
// the existing ConvertHTML, then imports it back and asserts the structure
// survives the round trip.
func TestImportToHTMLRoundTrip(t *testing.T) {
	requirePandoc(t)
	const html = `<h1>Title</h1><p>Hello <strong>world</strong></p>`
	ctx := context.Background()

	for _, format := range []string{"docx", "md", "odt"} {
		t.Run(format, func(t *testing.T) {
			encoded, _, err := ConvertHTML(ctx, []byte(html), format)
			if err != nil {
				t.Fatalf("ConvertHTML(%q): %v", format, err)
			}
			imported, err := ImportToHTML(ctx, encoded, format)
			if err != nil {
				t.Fatalf("ImportToHTML(%q): %v", format, err)
			}
			assertRoundTrip(t, string(imported))
		})
	}
}

// TestImportToHTMLHTMLPassthrough imports HTML directly (pandoc sanitises it via
// its reader/writer round trip).
func TestImportToHTMLHTMLPassthrough(t *testing.T) {
	requirePandoc(t)
	const html = `<h1>Title</h1><p>Hello <strong>world</strong></p>`
	imported, err := ImportToHTML(context.Background(), []byte(html), "html")
	if err != nil {
		t.Fatalf("ImportToHTML(html): %v", err)
	}
	assertRoundTrip(t, string(imported))
}

func TestImportSupported(t *testing.T) {
	for _, from := range []string{"docx", "odt", "rtf", "epub", "md", "markdown", "html", "txt"} {
		if _, ok := ImportSupported(from); !ok {
			t.Errorf("ImportSupported(%q) = false, want true", from)
		}
	}
	if _, ok := ImportSupported("nope"); ok {
		t.Errorf("ImportSupported(%q) = true, want false", "nope")
	}
}

func TestImportToHTMLUnsupportedFormat(t *testing.T) {
	// No pandoc needed: the format check rejects before shelling out.
	if _, err := ImportToHTML(context.Background(), []byte("data"), "nope"); err == nil {
		t.Fatal("ImportToHTML with unsupported format: want error, got nil")
	}
}

func TestImportToHTMLOversize(t *testing.T) {
	big := make([]byte, maxConvertBytes+1)
	if _, err := ImportToHTML(context.Background(), big, "docx"); err == nil {
		t.Fatal("ImportToHTML with oversize input: want error, got nil")
	}
}

func TestImportToHTMLGarbage(t *testing.T) {
	requirePandoc(t)
	// Bytes that are not a valid docx (zip) archive must error, not panic.
	garbage := []byte("this is definitely not a docx file")
	if _, err := ImportToHTML(context.Background(), garbage, "docx"); err == nil {
		t.Fatal("ImportToHTML with garbage docx: want error, got nil")
	}
}

// TestImportToHTMLSanitizesActiveContent is the regression test for the CC2
// follow-up: markdown/txt import used to pass raw HTML (<script>, <iframe>,
// on* handlers) and javascript: URLs straight through pandoc.
func TestImportToHTMLSanitizesActiveContent(t *testing.T) {
	requirePandoc(t)
	const src = "# Title\n\nHello **world**\n\n" +
		"<script>alert('s')</script>\n\n" +
		"<style>p{color:red}</style>\n\n" +
		"<img src=\"x\" onerror=\"alert('e')\">\n\n" +
		"inline <iframe src=\"https://evil.example\"></iframe> text\n\n" +
		"[click](javascript:alert('j')) [up](JavaScript:alert('J'))\n\n" +
		"[data](data:text/html,<b>x</b>)\n\n" +
		"[ok](https://example.com) and <u>under</u>\n"
	bad := []string{"<script", "alert(", "<style", "<iframe", "onerror", "javascript:", "data:text/html"}
	cases := map[string]string{"md": src, "markdown": src, "txt": src + "\n[s]{onclick=\"alert('a')\"}\n"}
	cases["html"] = `<h1>Title</h1><p>Hello <strong>world</strong></p><p onclick="alert('c')"><a href="javascript:alert('j')">x</a><a href="https://example.com">ok</a> <u>under</u></p>`
	for from, in := range cases {
		t.Run(from, func(t *testing.T) {
			out, err := ImportToHTML(context.Background(), []byte(in), from)
			if err != nil {
				t.Fatalf("ImportToHTML(%q): %v", from, err)
			}
			html := string(out)
			assertRoundTrip(t, html)
			low := strings.ToLower(html)
			for _, b := range bad {
				if strings.Contains(low, strings.ToLower(b)) {
					t.Errorf("imported %s HTML still contains %q: %s", from, b, html)
				}
			}
			if !strings.Contains(html, `href="https://example.com"`) {
				t.Errorf("safe link was dropped: %s", html)
			}
			// Bare formatting tags (Grown's gfm export writes underline as
			// raw <u>) must survive the sanitizer.
			if !strings.Contains(html, "<u>under</u>") {
				t.Errorf("bare <u> formatting was dropped: %s", html)
			}
		})
	}
}

// TestImportToHTMLKeepsDataImages guards the sanitizer against over-reach:
// embedded images arrive as data:image URIs and must survive.
func TestImportToHTMLKeepsDataImages(t *testing.T) {
	requirePandoc(t)
	const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	out, err := ImportToHTML(context.Background(), []byte("![pic]("+png+")\n"), "md")
	if err != nil {
		t.Fatalf("ImportToHTML: %v", err)
	}
	if !strings.Contains(string(out), png) {
		t.Errorf("data:image was stripped: %s", out)
	}
}
