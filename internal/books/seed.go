package books

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log/slog"
)

// sampleBook describes a placeholder book seeded on first run.
type sampleBook struct {
	Title       string
	Author      string
	Format      string
	Description string
	coverColor  color.RGBA
}

var samples = []sampleBook{
	{Title: "A Sample EPUB", Author: "Grown Library", Format: "epub",
		Description: "A minimal valid EPUB publication, seeded to demonstrate EPUB support.",
		coverColor:  color.RGBA{0x5B, 0x92, 0x79, 0xFF}},
	{Title: "A Sample PDF", Author: "Grown Library", Format: "pdf",
		Description: "A minimal valid PDF document, seeded to demonstrate PDF support.",
		coverColor:  color.RGBA{0xB5, 0x23, 0x0D, 0xFF}},
	{Title: "A Sample MOBI", Author: "Grown Library", Format: "mobi",
		Description: "A placeholder MOBI file, seeded to demonstrate MOBI support (download only).",
		coverColor:  color.RGBA{0xC4, 0x6B, 0x45, 0xFF}},
	{Title: "A Sample TXT", Author: "Grown Library", Format: "txt",
		Description: "A plain-text book, seeded to demonstrate TXT support.",
		coverColor:  color.RGBA{0x3D, 0x5A, 0x80, 0xFF}},
	{Title: "A Sample CBZ", Author: "Grown Library", Format: "cbz",
		Description: "A minimal comic-book archive (CBZ), seeded to demonstrate CBZ support.",
		coverColor:  color.RGBA{0xD9, 0xA4, 0x41, 0xFF}},
}

// SeedSamples populates one sample book of each supported format for orgID, but
// only when the org's library is empty. It is safe to call on every boot.
// Errors are logged, not fatal — seeding sample content must never block start.
func SeedSamples(ctx context.Context, repo *Repository, blobs BlobStore, orgID string) {
	n, err := repo.CountForOrg(ctx, orgID)
	if err != nil {
		slog.Warn("books seed: count failed", "err", err)
		return
	}
	if n > 0 {
		return // library already has books; nothing to seed
	}
	ownerID, err := repo.FirstOwner(ctx, orgID)
	if err != nil {
		// No users yet in the org — can't attribute the seed. Skip silently;
		// it'll seed on a later boot once a user exists.
		return
	}

	for _, s := range samples {
		data, err := sampleFileBytes(s)
		if err != nil {
			slog.Warn("books seed: build file failed", "format", s.Format, "err", err)
			continue
		}
		book, err := repo.Create(ctx, orgID, ownerID, Fields{
			Title: s.Title, Author: s.Author, Format: s.Format, Description: s.Description,
		})
		if err != nil {
			slog.Warn("books seed: create row failed", "format", s.Format, "err", err)
			continue
		}
		ct := contentTypeFor(s.Format)
		fileKey := randKey("books/file/")
		if err := blobs.Put(ctx, fileKey, ct, int64(len(data)), bytes.NewReader(data)); err != nil {
			slog.Warn("books seed: put file failed", "format", s.Format, "err", err)
			continue
		}
		fileName := fmt.Sprintf("sample.%s", s.Format)
		if _, err := repo.SetFile(ctx, orgID, book.ID, fileKey, fileName, ct, int64(len(data))); err != nil {
			slog.Warn("books seed: set file failed", "format", s.Format, "err", err)
			continue
		}
		cover, err := coverPNG(s)
		if err == nil {
			coverKey := randKey("books/cover/")
			if err := blobs.Put(ctx, coverKey, "image/png", int64(len(cover)), bytes.NewReader(cover)); err == nil {
				_, _ = repo.SetCover(ctx, orgID, book.ID, coverKey)
			}
		}
	}
	slog.Info("books seed: seeded sample books", "org", orgID, "count", len(samples))
}

// sampleFileBytes returns the placeholder bytes for a given format. All are
// small but structurally valid enough that viewers/downloaders accept them.
func sampleFileBytes(s sampleBook) ([]byte, error) {
	switch s.Format {
	case "txt":
		return []byte(sampleText(s)), nil
	case "pdf":
		return samplePDF(s), nil
	case "epub":
		return sampleEPUB(s)
	case "cbz":
		return sampleCBZ(s)
	case "mobi":
		return sampleMOBI(s), nil
	default:
		return nil, fmt.Errorf("no sample builder for format %q", s.Format)
	}
}

func sampleText(s sampleBook) string {
	return fmt.Sprintf("%s\nby %s\n\n%s\n\nThis is a seeded sample book in the %s format. "+
		"It exists so that every supported format is represented in a fresh library.\n",
		s.Title, s.Author, s.Description, s.Format)
}

// samplePDF builds a minimal one-page PDF that renders the title text. Hand-
// assembled with a correct xref table so pdf.js (and browsers) accept it.
func samplePDF(s sampleBook) []byte {
	content := fmt.Sprintf("BT /F1 24 Tf 72 700 Td (%s) Tj ET\nBT /F1 14 Tf 72 670 Td (by %s) Tj ET",
		pdfEscape(s.Title), pdfEscape(s.Author))
	var buf bytes.Buffer
	offsets := make([]int, 6)
	write := func(str string) { buf.WriteString(str) }

	write("%PDF-1.4\n")
	offsets[1] = buf.Len()
	write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	offsets[2] = buf.Len()
	write("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
	offsets[3] = buf.Len()
	write("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
		"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n")
	offsets[4] = buf.Len()
	write(fmt.Sprintf("4 0 obj\n<< /Length %d >>\nstream\n%s\nendstream\nendobj\n", len(content), content))
	offsets[5] = buf.Len()
	write("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")

	xrefPos := buf.Len()
	write("xref\n0 6\n")
	write("0000000000 65535 f \n")
	for i := 1; i <= 5; i++ {
		write(fmt.Sprintf("%010d 00000 n \n", offsets[i]))
	}
	write(fmt.Sprintf("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF", xrefPos))
	return buf.Bytes()
}

func pdfEscape(s string) string {
	out := make([]byte, 0, len(s))
	for _, c := range []byte(s) {
		if c == '(' || c == ')' || c == '\\' {
			out = append(out, '\\')
		}
		out = append(out, c)
	}
	return string(out)
}

// sampleEPUB builds a minimal valid EPUB 2 (zip with mimetype, container, OPF,
// one XHTML chapter). The mimetype entry must be first and stored uncompressed.
func sampleEPUB(s sampleBook) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// mimetype — must be the first entry and STORED (no compression).
	mw, err := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	if err != nil {
		return nil, err
	}
	if _, err := mw.Write([]byte("application/epub+zip")); err != nil {
		return nil, err
	}

	add := func(name, body string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(body))
		return err
	}

	if err := add("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`); err != nil {
		return nil, err
	}

	opf := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>%s</dc:title>
    <dc:creator>%s</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">grown-sample-epub</dc:identifier>
  </metadata>
  <manifest>
    <item id="chap1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chap1"/>
  </spine>
</package>`, xmlEscape(s.Title), xmlEscape(s.Author))
	if err := add("OEBPS/content.opf", opf); err != nil {
		return nil, err
	}

	ncx := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="grown-sample-epub"/></head>
  <docTitle><text>%s</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`, xmlEscape(s.Title))
	if err := add("OEBPS/toc.ncx", ncx); err != nil {
		return nil, err
	}

	chapter := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>%s</title></head>
<body>
  <h1>%s</h1>
  <p><em>by %s</em></p>
  <p>%s</p>
  <p>This is a seeded sample EPUB so that the library represents every supported format.</p>
</body>
</html>`, xmlEscape(s.Title), xmlEscape(s.Title), xmlEscape(s.Author), xmlEscape(s.Description))
	if err := add("OEBPS/chapter1.xhtml", chapter); err != nil {
		return nil, err
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// sampleCBZ builds a minimal comic archive: a zip containing one PNG "page".
func sampleCBZ(s sampleBook) ([]byte, error) {
	page, err := coverPNG(s)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("page-001.png")
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(page); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// sampleMOBI builds a placeholder file with a PalmDOC/MOBI-style header. It is
// not a fully-readable MOBI (the library treats MOBI as download-only), but it
// carries the BOOKMOBI signature so tooling recognizes the type.
func sampleMOBI(s sampleBook) []byte {
	var buf bytes.Buffer
	name := []byte(s.Title)
	if len(name) > 31 {
		name = name[:31]
	}
	hdr := make([]byte, 32)
	copy(hdr, name)
	buf.Write(hdr)
	buf.Write([]byte("BOOKMOBI"))
	buf.WriteString(fmt.Sprintf("\n%s\nby %s\n\n%s\n", s.Title, s.Author, s.Description))
	return buf.Bytes()
}

// coverPNG renders a simple solid-color cover thumbnail (no font rendering;
// just a colored panel with a lighter spine stripe) so library tiles have art.
func coverPNG(s sampleBook) ([]byte, error) {
	const w, h = 240, 360
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	base := s.coverColor
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := base
			// spine stripe on the left
			if x < 16 {
				c = scale(base, 0.7)
			}
			// header band
			if y < 80 {
				c = scale(base, 1.15)
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func scale(c color.RGBA, f float64) color.RGBA {
	clamp := func(v float64) uint8 {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return uint8(v)
	}
	return color.RGBA{clamp(float64(c.R) * f), clamp(float64(c.G) * f), clamp(float64(c.B) * f), 0xFF}
}

func xmlEscape(s string) string {
	r := bytes.NewBuffer(nil)
	for _, c := range s {
		switch c {
		case '&':
			r.WriteString("&amp;")
		case '<':
			r.WriteString("&lt;")
		case '>':
			r.WriteString("&gt;")
		case '"':
			r.WriteString("&quot;")
		case '\'':
			r.WriteString("&apos;")
		default:
			r.WriteRune(c)
		}
	}
	return r.String()
}
