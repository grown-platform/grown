package docs

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

// Pictures in pandoc-backed exports (export_images.go). These run against
// whatever pandoc is on PATH; the production image's is Alpine's 3.1.13,
// which refuses data: URIs under --sandbox, so run them there too (see the
// docs/plans/onlyoffice-parity/docs.md §6.20).

const tinyPNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

var tinyPNG, _ = base64.StdEncoding.DecodeString(tinyPNG64)

const testAssetSHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// stubAssets serves tinyPNG as picture testAssetSHA of doc "doc-ok" and
// denies everything else, counting calls.
func stubAssets(calls *atomic.Int32) AssetLoader {
	return func(_ context.Context, docID, sha string) ([]byte, error) {
		calls.Add(1)
		if docID == "doc-ok" && sha == testAssetSHA {
			return tinyPNG, nil
		}
		return nil, errors.New("not found")
	}
}

// zipFiles returns every entry of a zip archive by name.
func zipFiles(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip archive: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = b
	}
	return out
}

// assertExportHasPNG checks the export of format `to` embeds tinyPNG.
func assertExportHasPNG(t *testing.T, to string, out []byte) {
	t.Helper()
	switch to {
	case "docx", "odt", "epub":
		for name, b := range zipFiles(t, out) {
			if bytes.Equal(b, tinyPNG) {
				t.Logf("%s: picture at %s", to, name)
				return
			}
		}
		t.Fatalf("%s: no zip part holds the picture", to)
	case "rtf":
		s := string(out)
		if !strings.Contains(s, `{\pict`) || !strings.Contains(s, `\pngblip`) {
			t.Fatalf("rtf: no \\pict/\\pngblip picture: %s", firstN(s, 600))
		}
	case "md":
		if !strings.Contains(string(out), "](data:image/png;base64,"+tinyPNG64+")") {
			t.Fatalf("md: picture not inline: %s", out)
		}
	default:
		t.Fatalf("no picture check for %s", to)
	}
}

var exportImageFormats = []string{"docx", "odt", "epub", "rtf", "md"}

func TestExportImagesDataURL(t *testing.T) {
	requirePandoc(t)
	// Sized and wrapped like the editor's pictures: Markdown must still get
	// ![](data:...) syntax, not a raw <img> tag its import would drop.
	html := []byte(`<h1>Pic</h1><p>before <span class="doc-obj" data-kind="picture"><img src="data:image/png;base64,` + tinyPNG64 + `" alt="dot" width="200" style="width:200px"></span> after</p>`)
	for _, to := range exportImageFormats {
		t.Run(to, func(t *testing.T) {
			out, _, err := ConvertHTML(context.Background(), html, to)
			if err != nil {
				t.Fatal(err)
			}
			assertExportHasPNG(t, to, out)
		})
	}
}

func TestExportImagesAssetURL(t *testing.T) {
	requirePandoc(t)
	for _, src := range []string{
		AssetURL("doc-ok", testAssetSHA),
		AssetURL("doc-ok", testAssetSHA) + "?token=abc",
		"https://grown.example" + AssetURL("doc-ok", testAssetSHA),
	} {
		html := []byte(`<p>x <img src="` + src + `" alt="dot"></p>`)
		for _, to := range exportImageFormats {
			t.Run(to, func(t *testing.T) {
				var calls atomic.Int32
				out, _, err := ConvertHTMLWith(context.Background(), html, to, ExportOptions{Assets: stubAssets(&calls)})
				if err != nil {
					t.Fatal(err)
				}
				assertExportHasPNG(t, to, out)
				if calls.Load() != 1 {
					t.Fatalf("asset loader called %d times, want 1", calls.Load())
				}
			})
		}
	}
}

// TestExportImagesAssetDenied: a picture of a document the caller can't read
// (the loader refuses) is left out, not fetched some other way.
func TestExportImagesAssetDenied(t *testing.T) {
	requirePandoc(t)
	html := []byte(`<p>x <img src="` + AssetURL("doc-other", testAssetSHA) + `" alt="secret pic"></p>`)
	var calls atomic.Int32
	out, _, err := ConvertHTMLWith(context.Background(), html, "odt", ExportOptions{Assets: stubAssets(&calls)})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("loader calls = %d", calls.Load())
	}
	for name := range zipFiles(t, out) {
		if strings.HasPrefix(name, "Pictures/") {
			t.Fatalf("denied asset exported as %s", name)
		}
	}
	if !strings.Contains(zipEntry(t, out, "content.xml"), "secret pic") {
		t.Fatal("alt text of the dropped picture missing")
	}
}

// TestExportImagesSVGDrawing: drawings are utf8 (percent-encoded) SVG data
// URLs; formats that hold SVG keep them.
func TestExportImagesSVGDrawing(t *testing.T) {
	requirePandoc(t)
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`
	html := []byte(`<p><img src="data:image/svg+xml;utf8,` + url.PathEscape(svg) + `"></p>`)
	out, _, err := ConvertHTML(context.Background(), html, "odt")
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range zipFiles(t, out) {
		if bytes.Contains(b, []byte(`fill="red"`)) {
			return
		}
	}
	t.Fatal("svg drawing missing from odt")
}

// TestExportImagesSandboxEscape is the regression test for the CC2 sandbox:
// resolving pictures server-side must not reopen it. Server paths, file:
// URLs, http(s) URLs and non-picture data: URLs never reach the export, and
// pandoc still fetches nothing.
func TestExportImagesSandboxEscape(t *testing.T) {
	requirePandoc(t)
	path, marker, marker64 := secretFile(t)
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(tinyPNG)
	}))
	defer srv.Close()
	html := []byte(`<p>x</p>` +
		`<p><img src="` + path + `"><img src="file://` + path + `"><img src="/etc/passwd">` +
		`<img src="` + srv.URL + `/pixel.png"><img src="../../../../` + path + `">` +
		`<img src="data:image/png;base64,` + base64.StdEncoding.EncodeToString([]byte(marker)) + `">` +
		`<img src="data:text/html,` + marker + `">` +
		`<embed src="` + path + `"><video src="` + path + `"></video><object data="` + path + `"></object>` +
		`<img src="grown-img-1.png"><img src="images.lua"><img src="out.odt"></p>`)
	for _, to := range exportImageFormats {
		t.Run(to, func(t *testing.T) {
			var calls atomic.Int32
			out, _, err := ConvertHTMLWith(context.Background(), html, to, ExportOptions{Assets: stubAssets(&calls)})
			if err != nil {
				t.Fatal(err)
			}
			parts := map[string][]byte{"": out}
			if to == "docx" || to == "odt" || to == "epub" {
				parts = zipFiles(t, out)
			}
			for name, b := range parts {
				if bytes.Contains(b, []byte(marker)) || bytes.Contains(b, []byte(marker64)) {
					t.Fatalf("server file leaked into %s %s", to, name)
				}
				if bytes.Contains(b, []byte("root:")) {
					t.Fatalf("/etc/passwd leaked into %s %s", to, name)
				}
				if bytes.Contains(b, []byte("GROWN_IMAGES")) {
					t.Fatalf("filter source leaked into %s %s", to, name)
				}
			}
			if calls.Load() != 0 {
				t.Fatalf("asset loader called for a non-asset URL")
			}
		})
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("export fetched a remote resource %d time(s)", n)
	}
}

// TestExportImagesRoundTripODT: an exported .odt (and the other formats)
// re-imports with its pictures.
func TestExportImagesRoundTripODT(t *testing.T) {
	requirePandoc(t)
	var calls atomic.Int32
	html := []byte(`<p>a <img src="data:image/png;base64,` + tinyPNG64 + `"></p><p>b <span class="doc-obj"><img width="20" src="` + AssetURL("doc-ok", testAssetSHA) + `"></span></p>`)
	for _, to := range []string{"odt", "epub", "rtf", "docx", "md"} {
		t.Run(to, func(t *testing.T) {
			out, _, err := ConvertHTMLWith(context.Background(), html, to, ExportOptions{Assets: stubAssets(&calls)})
			if err != nil {
				t.Fatal(err)
			}
			back, err := ImportToHTML(context.Background(), out, to)
			if err != nil {
				t.Fatal(err)
			}
			if n := strings.Count(string(back), `src="data:image/png;base64,`); n != 2 {
				t.Fatalf("re-imported %s has %d pictures, want 2: %s", to, n, back)
			}
		})
	}
}

func TestExportImagesDecodeDataURL(t *testing.T) {
	cases := []struct {
		src  string
		ok   bool
		mime string
	}{
		{"data:image/png;base64," + tinyPNG64, true, "image/png"},
		{"DATA:image/png;BASE64," + tinyPNG64, true, "image/png"},
		{"data:image/png;base64," + strings.TrimRight(tinyPNG64, "="), true, "image/png"},
		{"data:image/png;base64,\n" + tinyPNG64[:20] + "\n" + tinyPNG64[20:], true, "image/png"},
		// Declared png, bytes are not a picture.
		{"data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("<html>hi</html>")), false, ""},
		// Declared jpeg, bytes are png: the sniffed type wins.
		{"data:image/jpeg;base64," + tinyPNG64, true, "image/png"},
		{"data:text/html,<script>alert(1)</script>", false, ""},
		{"data:image/svg+xml,hello", false, ""},
		{"data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22x%22%2F%3E", true, "image/svg+xml"},
		{"data:image/png;base64,!!!", false, ""},
		{"data:,", false, ""},
		{"notdata:image/png;base64," + tinyPNG64, false, ""},
	}
	for _, c := range cases {
		data, declared, ok := decodeDataURL(c.src)
		mime := ""
		if ok {
			mime = sniffImage(data, declared)
		}
		if (mime != "") != c.ok || mime != c.mime {
			t.Errorf("%.60q: mime %q, want ok=%v %q", c.src, mime, c.ok, c.mime)
		}
	}
}

func TestExportImagesRewrite(t *testing.T) {
	dir := t.TempDir()
	var calls atomic.Int32
	in := `<p title="<img src=x>">a</p><script>var s = "<img src=/etc/passwd>";</script>` +
		`<IMG SRC="data:image/png;base64,` + tinyPNG64 + `" srcset="/etc/passwd 2x" onerror="x()" alt='a "q"'>` +
		`<img src="data:image/png;base64,` + tinyPNG64 + `"/><img src="/etc/passwd"><img>`
	out, filter := prepareExportImages(context.Background(), []byte(in), dir, false, stubAssets(&calls))
	s := string(out)
	for _, want := range []string{
		`<p title="<img src=x>">a</p>`,
		`<script>var s = "<img src=/etc/passwd>";</script>`,
		`<img src="grown-img-1.png" onerror="x()" alt="a &#34;q&#34;">`,
		`<img src="grown-img-1.png">`,
		`<img src=""><img>`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("rewritten HTML missing %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "srcset") || strings.Count(s, "grown-img-") != 2 {
		t.Errorf("rewritten HTML: %s", s)
	}
	if !strings.Contains(string(filter), `["grown-img-1.png"]`) || strings.Contains(string(filter), "grown-img-2") {
		t.Errorf("filter table: %s", filter)
	}
}

func TestExportImagesCaps(t *testing.T) {
	dir := t.TempDir()
	e := &exportImages{ctx: context.Background(), dir: dir, bySrc: map[string]string{}}
	e.total = maxExportImagesBytes - len(tinyPNG) + 1
	if name := e.resolve("data:image/png;base64," + tinyPNG64); name != "" {
		t.Fatalf("total cap not enforced: %q", name)
	}
	big := "data:image/png;base64," + strings.Repeat("A", maxExportImageBytes*4/3+8192)
	if _, _, ok := decodeDataURL(big); ok {
		t.Fatal("oversize data URL decoded")
	}
}

func TestExportImagesLuaString(t *testing.T) {
	if got := luaString(`/tmp/a b"]]--\n`); got != `"/tmp/a\032b\034\093\093--\092n"` {
		t.Fatalf("luaString = %s", got)
	}
}
