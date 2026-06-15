package books

// seed_logic_test.go — unit tests for the pure sample-file builders, escapers,
// and color/format helpers. No database or blob store involved.

import (
	"archive/zip"
	"bytes"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func sample(format string) sampleBook {
	return sampleBook{
		Title: "My (Book) <Title>", Author: "A & B", Format: format,
		Description: "desc", coverColor: color.RGBA{0x10, 0x80, 0xC0, 0xFF},
	}
}

func TestSampleFileBytes_AllFormats(t *testing.T) {
	for _, f := range SupportedFormats {
		t.Run(f, func(t *testing.T) {
			data, err := sampleFileBytes(sample(f))
			if err != nil {
				t.Fatalf("sampleFileBytes(%s): %v", f, err)
			}
			if len(data) == 0 {
				t.Errorf("sampleFileBytes(%s) returned empty", f)
			}
		})
	}
}

func TestSampleFileBytes_UnknownFormat(t *testing.T) {
	if _, err := sampleFileBytes(sample("doc")); err == nil {
		t.Errorf("expected error for unknown format")
	}
}

func TestSampleText(t *testing.T) {
	s := sample("txt")
	got := sampleText(s)
	for _, want := range []string{s.Title, s.Author, s.Description, "txt"} {
		if !strings.Contains(got, want) {
			t.Errorf("sampleText missing %q in:\n%s", want, got)
		}
	}
}

func TestSamplePDF_StructureAndEscaping(t *testing.T) {
	data := samplePDF(sample("pdf"))
	str := string(data)
	if !strings.HasPrefix(str, "%PDF-1.4") {
		t.Errorf("missing PDF header")
	}
	if !strings.Contains(str, "xref") || !strings.HasSuffix(str, "%%EOF") {
		t.Errorf("missing xref/EOF trailer")
	}
	// Parens in the title must be backslash-escaped inside the content stream.
	if !strings.Contains(str, `\(Book\)`) {
		t.Errorf("title parens not escaped in PDF content")
	}
}

func TestPDFEscape(t *testing.T) {
	cases := []struct{ in, want string }{
		{"plain", "plain"},
		{"a(b)c", `a\(b\)c`},
		{`back\slash`, `back\\slash`},
		{"()\\", `\(\)\\`},
	}
	for _, c := range cases {
		if got := pdfEscape(c.in); got != c.want {
			t.Errorf("pdfEscape(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSampleEPUB_ValidZipWithMimetypeFirst(t *testing.T) {
	data, err := sampleEPUB(sample("epub"))
	if err != nil {
		t.Fatalf("sampleEPUB: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a valid zip: %v", err)
	}
	if len(zr.File) == 0 {
		t.Fatal("empty epub zip")
	}
	// mimetype must be the first entry, stored uncompressed.
	first := zr.File[0]
	if first.Name != "mimetype" {
		t.Errorf("first entry = %q, want mimetype", first.Name)
	}
	if first.Method != zip.Store {
		t.Errorf("mimetype must be stored (uncompressed), got method %d", first.Method)
	}
	rc, err := first.Open()
	if err != nil {
		t.Fatalf("open mimetype: %v", err)
	}
	body, _ := readAllClose(rc)
	if string(body) != "application/epub+zip" {
		t.Errorf("mimetype body = %q", body)
	}
	// Required structural entries present.
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	for _, want := range []string{"META-INF/container.xml", "OEBPS/content.opf", "OEBPS/toc.ncx", "OEBPS/chapter1.xhtml"} {
		if !names[want] {
			t.Errorf("epub missing %q", want)
		}
	}
	// XML special chars in title/author must be escaped in the OPF.
	opf := readZipEntry(t, zr, "OEBPS/content.opf")
	if strings.Contains(opf, "<Title>") || !strings.Contains(opf, "&lt;Title&gt;") {
		t.Errorf("OPF did not XML-escape the title:\n%s", opf)
	}
	if !strings.Contains(opf, "A &amp; B") {
		t.Errorf("OPF did not escape ampersand in author")
	}
}

func TestSampleCBZ_ContainsPNGPage(t *testing.T) {
	data, err := sampleCBZ(sample("cbz"))
	if err != nil {
		t.Fatalf("sampleCBZ: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a valid zip: %v", err)
	}
	if len(zr.File) != 1 || zr.File[0].Name != "page-001.png" {
		t.Fatalf("unexpected cbz contents: %+v", zr.File)
	}
	page := readZipEntry(t, zr, "page-001.png")
	if _, err := png.Decode(strings.NewReader(page)); err != nil {
		t.Errorf("cbz page is not a valid PNG: %v", err)
	}
}

func TestSampleMOBI_HeaderAndTruncation(t *testing.T) {
	data := sampleMOBI(sample("mobi"))
	if !bytes.Contains(data, []byte("BOOKMOBI")) {
		t.Errorf("MOBI missing BOOKMOBI signature")
	}
	// First 32 bytes are the (truncated) title header.
	if len(data) < 40 {
		t.Fatalf("MOBI too short: %d bytes", len(data))
	}

	// Title longer than 31 bytes must be truncated into the 32-byte header.
	long := sample("mobi")
	long.Title = strings.Repeat("Z", 50)
	d2 := sampleMOBI(long)
	hdr := d2[:32]
	// "BOOKMOBI" should start exactly at offset 32 (header not overflowed).
	if string(d2[32:40]) != "BOOKMOBI" {
		t.Errorf("BOOKMOBI not at offset 32; header overflowed: %q", d2[32:40])
	}
	if bytes.Count(hdr, []byte("Z")) != 31 {
		t.Errorf("expected 31 Z's in truncated header, got %d", bytes.Count(hdr, []byte("Z")))
	}
}

func TestCoverPNG_DimensionsAndStripes(t *testing.T) {
	data, err := coverPNG(sample("epub"))
	if err != nil {
		t.Fatalf("coverPNG: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("invalid PNG: %v", err)
	}
	b := img.Bounds()
	if b.Dx() != 240 || b.Dy() != 360 {
		t.Errorf("cover dims = %dx%d, want 240x360", b.Dx(), b.Dy())
	}
}

func TestScale(t *testing.T) {
	base := color.RGBA{100, 100, 100, 0xFF}
	// Darken.
	d := scale(base, 0.5)
	if d.R != 50 || d.A != 0xFF {
		t.Errorf("scale darken wrong: %+v", d)
	}
	// Brighten clamps at 255.
	bright := scale(color.RGBA{200, 200, 200, 0xFF}, 2.0)
	if bright.R != 255 || bright.G != 255 || bright.B != 255 {
		t.Errorf("scale should clamp to 255: %+v", bright)
	}
	// Negative factor clamps at 0.
	neg := scale(base, -1.0)
	if neg.R != 0 || neg.G != 0 || neg.B != 0 {
		t.Errorf("scale should clamp to 0: %+v", neg)
	}
}

func TestXMLEscape(t *testing.T) {
	cases := []struct{ in, want string }{
		{"plain", "plain"},
		{"a&b", "a&amp;b"},
		{"<tag>", "&lt;tag&gt;"},
		{`"q"`, "&quot;q&quot;"},
		{"it's", "it&apos;s"},
		{"a<b>&\"'", "a&lt;b&gt;&amp;&quot;&apos;"},
		{"héllo", "héllo"}, // non-ASCII passes through unchanged
	}
	for _, c := range cases {
		if got := xmlEscape(c.in); got != c.want {
			t.Errorf("xmlEscape(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// --- helpers ---

func readAllClose(rc interface{ Read([]byte) (int, error) }) ([]byte, error) {
	var buf bytes.Buffer
	_, err := buf.ReadFrom(rc)
	return buf.Bytes(), err
}

func readZipEntry(t *testing.T, zr *zip.Reader, name string) string {
	t.Helper()
	for _, f := range zr.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open %s: %v", name, err)
			}
			defer rc.Close()
			var buf bytes.Buffer
			if _, err := buf.ReadFrom(rc); err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			return buf.String()
		}
	}
	t.Fatalf("zip entry %q not found", name)
	return ""
}
