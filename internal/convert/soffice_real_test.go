package convert

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// Tests against a real LibreOffice. They skip unless soffice is found
// (GROWN_SOFFICE_PATH, PATH, or the usual install locations), so CI without
// LibreOffice stays green. A cold soffice start takes 10–40 s, so conversions
// run in parallel and fixtures are made once.

func requireSoffice(t *testing.T) string {
	t.Helper()
	if testing.Short() {
		t.Skip("-short: skipping real LibreOffice runs")
	}
	bin := os.Getenv("GROWN_SOFFICE_PATH")
	if bin == "" {
		bin = DetectBinary()
	}
	if bin == "" {
		t.Skip("soffice not installed (set GROWN_SOFFICE_PATH)")
	}
	return bin
}

// Flat-ODF sources written by the test. LibreOffice reads them without any
// packaging, so the test can author a text document, a spreadsheet and a
// presentation in a few lines and then save them as legacy binaries.
const (
	odfNS = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" office:version="1.3"`

	fodt = `<?xml version="1.0" encoding="UTF-8"?>
<office:document ` + odfNS + ` office:mimetype="application/vnd.oasis.opendocument.text">
<office:body><office:text>
<text:h text:outline-level="1">Legacy DOC heading</text:h>
<text:p>Legacy DOC marker paragraph.</text:p>
<table:table table:name="T1"><table:table-column table:number-columns-repeated="2"/>
<table:table-row><table:table-cell><text:p>cellA</text:p></table:table-cell><table:table-cell><text:p>cellB</text:p></table:table-cell></table:table-row>
</table:table>
</office:text></office:body></office:document>`

	fods = `<?xml version="1.0" encoding="UTF-8"?>
<office:document ` + odfNS + ` office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
<office:body><office:spreadsheet><table:table table:name="Budget">
<table:table-row><table:table-cell office:value-type="string"><text:p>Legacy XLS marker</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Total</text:p></table:table-cell><table:table-cell table:formula="of:=[.B1]*2" office:value-type="float" office:value="84"><text:p>84</text:p></table:table-cell></table:table-row>
</table:table></office:spreadsheet></office:body></office:document>`

	fodp = `<?xml version="1.0" encoding="UTF-8"?>
<office:document ` + odfNS + ` office:mimetype="application/vnd.oasis.opendocument.presentation">
<office:body><office:presentation>
<draw:page draw:name="One"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Legacy PPT marker</text:p></draw:text-box></draw:frame></draw:page>
<draw:page draw:name="Two"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Second slide</text:p></draw:text-box></draw:frame></draw:page>
</office:presentation></office:body></office:document>`
)

var (
	legacyOnce  sync.Once
	legacyDir   string
	legacyFiles map[string][]byte
	legacyErr   error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if legacyDir != "" {
		os.RemoveAll(legacyDir)
	}
	os.Exit(code)
}

// legacyFixtures converts the flat-ODF sources to .doc/.xls/.ppt once.
func legacyFixtures(t *testing.T, bin string) map[string][]byte {
	legacyOnce.Do(func() {
		dir, err := os.MkdirTemp("", "grown-lo-fixtures-*")
		legacyDir = dir
		if err != nil {
			legacyErr = err
			return
		}
		srcs := map[string]struct{ body, name, filter string }{
			"doc": {fodt, "legacy.fodt", "doc:MS Word 97"},
			"xls": {fods, "legacy.fods", "xls:MS Excel 97"},
			"ppt": {fodp, "legacy.fodp", "ppt:MS PowerPoint 97"},
		}
		legacyFiles = map[string][]byte{}
		var mu sync.Mutex
		var wg sync.WaitGroup
		for ext, s := range srcs {
			p := filepath.Join(dir, s.name)
			if err := os.WriteFile(p, []byte(s.body), 0o600); err != nil {
				legacyErr = err
				return
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				prof := filepath.Join(dir, "profile-"+ext)
				ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
				defer cancel()
				cmd := exec.CommandContext(ctx, bin, "-env:UserInstallation="+fileURL(prof), "--headless", "--norestore",
					"--convert-to", s.filter, "--outdir", dir, p)
				cmd.Env = append(os.Environ(), "SAL_USE_VCLPLUGIN=svp")
				out, err := cmd.CombinedOutput()
				b, rerr := os.ReadFile(strings.TrimSuffix(p, filepath.Ext(p)) + "." + ext)
				mu.Lock()
				defer mu.Unlock()
				if err != nil || rerr != nil {
					legacyErr = fmt.Errorf("make .%s: %v %v\n%s", ext, err, rerr, out)
					return
				}
				legacyFiles[ext] = b
			}()
		}
		wg.Wait()
	})
	if legacyErr != nil {
		t.Fatal(legacyErr)
	}
	return legacyFiles
}

// zipText returns the concatenated XML of the package entries matching prefix.
func zipText(t *testing.T, pkg []byte, prefix string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(pkg), int64(len(pkg)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	var sb strings.Builder
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, prefix) || !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		sb.Write(b)
	}
	return sb.String()
}

// TestRealLegacyRoundTrip: flat ODF → (soffice) .doc/.xls/.ppt → Converter →
// docx/xlsx/pptx, checking content survives. The three conversions run
// concurrently through one Converter, so separate profiles are exercised too.
func TestRealLegacyRoundTrip(t *testing.T) {
	bin := requireSoffice(t)
	files := legacyFixtures(t, bin)
	if !bytes.HasPrefix(files["doc"], ole2Magic) || !bytes.HasPrefix(files["xls"], ole2Magic) || !bytes.HasPrefix(files["ppt"], ole2Magic) {
		t.Fatal("fixtures are not OLE2 binaries")
	}
	parent := t.TempDir()
	c := New(Config{Enabled: true, Binary: bin, Concurrency: 3, TempDir: parent, Timeout: 4 * time.Minute})
	checks := map[string]struct {
		to     Target
		prefix string
		want   []string
	}{
		"doc": {DOCX, "word/", []string{"Legacy DOC heading", "Legacy DOC marker paragraph.", "cellA", "cellB", "<w:tbl>"}},
		"xls": {XLSX, "xl/", []string{"Legacy XLS marker", "Budget", "<v>42</v>", "B1*2"}},
		"ppt": {PPTX, "ppt/", []string{"Legacy PPT marker", "Second slide"}},
	}
	var wg sync.WaitGroup
	for ext, want := range checks {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, to, err := c.Convert(context.Background(), files[ext], ext)
			if err != nil {
				t.Errorf(".%s: %v", ext, err)
				return
			}
			if to != want.to {
				t.Errorf(".%s → %s, want %s", ext, to, want.to)
			}
			xml := zipText(t, out, want.prefix)
			for _, w := range want.want {
				if !strings.Contains(xml, w) {
					t.Errorf(".%s → %s lost %q", ext, to, w)
				}
			}
		}()
	}
	wg.Wait()
	if c.peak.Load() < 2 {
		t.Logf("note: conversions did not overlap (peak %d)", c.peak.Load())
	}
	if left, _ := os.ReadDir(parent); len(left) != 0 {
		t.Errorf("temp dirs left behind: %v", left)
	}
}

// TestRealTimeout: a real soffice killed mid-start leaves no process or files.
func TestRealTimeout(t *testing.T) {
	bin := requireSoffice(t)
	files := legacyFixtures(t, bin)
	parent := t.TempDir()
	c := New(Config{Enabled: true, Binary: bin, TempDir: parent, Timeout: 300 * time.Millisecond})
	_, _, err := c.Convert(context.Background(), files["doc"], "doc")
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	// Nothing may still run with a profile under parent.
	time.Sleep(200 * time.Millisecond)
	if out, _ := exec.Command("pgrep", "-f", parent).Output(); len(bytes.TrimSpace(out)) != 0 {
		t.Fatalf("soffice processes survived the timeout: %s", out)
	}
	if left, _ := os.ReadDir(parent); len(left) != 0 {
		t.Errorf("temp dirs left behind: %v", left)
	}
}

// TestRealMacroNotExecuted: an ODT whose Basic macro runs on load (and would
// write a marker file) converts without the macro running.
func TestRealMacroNotExecuted(t *testing.T) {
	bin := requireSoffice(t)
	marker := filepath.Join(t.TempDir(), "MACRO_RAN")
	odt := macroODT(t, marker)
	c := New(Config{Enabled: true, Binary: bin, PreferODF: true, Timeout: 4 * time.Minute})
	out, to, err := c.Convert(context.Background(), odt, "odt")
	if err != nil {
		t.Fatal(err)
	}
	if to != DOCX || !strings.Contains(zipText(t, out, "word/"), "Macro fixture") {
		t.Fatal("macro fixture text missing from output")
	}
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("document macro executed during conversion")
	}
}

// macroODT builds an .odt with an embedded Basic library and an OnLoad
// (dom:load) binding to a macro that writes `marker`.
func macroODT(t *testing.T, marker string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	mt, _ := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	_, _ = mt.Write([]byte("application/vnd.oasis.opendocument.text"))
	files := map[string]string{
		"content.xml": `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dom="http://www.w3.org/2001/xml-events" office:version="1.3">
<office:scripts><office:event-listeners><script:event-listener script:language="ooo:script" script:event-name="dom:load" xlink:href="vnd.sun.star.script:Standard.Module1.Main?language=Basic&amp;location=document"/></office:event-listeners></office:scripts>
<office:body><office:text><text:p>Macro fixture</text:p></office:text></office:body></office:document-content>`,
		"Basic/script-lc.xml": `<?xml version="1.0" encoding="UTF-8"?>
<library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink"><library:library library:name="Standard" library:link="false"/></library:libraries>`,
		"Basic/Standard/script-lb.xml": `<?xml version="1.0" encoding="UTF-8"?>
<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false"><library:element library:name="Module1"/></library:library>`,
		"Basic/Standard/Module1.xml": `<?xml version="1.0" encoding="UTF-8"?>
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">Sub Main
Open "` + marker + `" For Output As #1
Print #1, "ran"
Close #1
End Sub
</script:module>`,
		"META-INF/manifest.xml": `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Basic/script-lc.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Basic/Standard/script-lb.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Basic/Standard/Module1.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`,
	}
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		w, _ := zw.Create(n)
		_, _ = w.Write([]byte(files[n]))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestLegacyCorpus walks a local corpus (e.g. research/onlyoffice/core) for
// legacy office files and reports the conversion pass rate. Local-only:
// skipped unless GROWN_LIBREOFFICE_CORPUS (or GROWN_CONVERSION_CORPUS) is set.
//
//	GROWN_LIBREOFFICE_CORPUS=$PWD/research/onlyoffice/core \
//	  go test ./internal/convert/ -run LegacyCorpus -v -timeout 30m
//
// Files whose bytes don't match their extension (e.g. plain-text notes named
// .doc) are counted as "rejected", not failures: refusing them is the point
// of the magic check.
func TestLegacyCorpus(t *testing.T) {
	root := os.Getenv("GROWN_LIBREOFFICE_CORPUS")
	if root == "" {
		root = os.Getenv("GROWN_CONVERSION_CORPUS")
	}
	if root == "" {
		t.Skip("GROWN_LIBREOFFICE_CORPUS not set (local-only corpus)")
	}
	bin := requireSoffice(t)
	var paths []string
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && (d.Name() == "node_modules" || d.Name() == ".git") {
			return filepath.SkipDir
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
		if s, ok := sources[ext]; ok && s.legacy && !d.IsDir() {
			paths = append(paths, p)
		}
		return nil
	})
	if len(paths) == 0 {
		t.Skipf("no legacy office files under %s", root)
	}
	c := New(Config{Enabled: true, Binary: bin, Concurrency: 3, Timeout: 4 * time.Minute, QueueWait: time.Hour})
	type result struct{ path, status, detail string }
	results := make([]result, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func() {
			defer wg.Done()
			data, err := os.ReadFile(p)
			rel, _ := filepath.Rel(root, p)
			if err != nil {
				results[i] = result{rel, "fail", err.Error()}
				return
			}
			ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
			out, to, err := c.Convert(context.Background(), data, ext)
			switch {
			case errors.Is(err, ErrBadInput):
				results[i] = result{rel, "rejected", "not a real ." + ext}
			case err != nil:
				results[i] = result{rel, "fail", err.Error()}
			default:
				main := map[Target]string{DOCX: "word/document.xml", XLSX: "xl/workbook.xml", PPTX: "ppt/presentation.xml"}[to]
				zr, zerr := zip.NewReader(bytes.NewReader(out), int64(len(out)))
				ok := false
				if zerr == nil {
					for _, f := range zr.File {
						ok = ok || f.Name == main
					}
				}
				if ok {
					results[i] = result{rel, "pass", fmt.Sprintf("%s, %d bytes", to, len(out))}
				} else {
					results[i] = result{rel, "fail", "output lacks " + main}
				}
			}
		}()
	}
	wg.Wait()
	pass, rejected, fail := 0, 0, 0
	for _, r := range results {
		t.Logf("%-8s %s (%s)", r.status, r.path, r.detail)
		switch r.status {
		case "pass":
			pass++
		case "rejected":
			rejected++
		default:
			fail++
		}
	}
	real := pass + fail
	t.Logf("legacy corpus: %d/%d real legacy files converted (%.0f%%); %d rejected by the magic check", pass, real, 100*float64(pass)/float64(max(real, 1)), rejected)
	if fail > 0 {
		t.Errorf("%d legacy files failed to convert", fail)
	}
}
