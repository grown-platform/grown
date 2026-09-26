package docs

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"html"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// Corpus runner: import → export → re-import every supported document under
// $GROWN_CONVERSION_CORPUS and assert conversion invariants.
//
// The intended corpus is OnlyOffice's AGPL fixture documents under
// research/onlyoffice/core (gitignored, never committed):
//
//	GROWN_CONVERSION_CORPUS=$PWD/research/onlyoffice/core \
//	    go test ./internal/docs/ -run Corpus -v
//
// Without the variable (CI) TestConversionCorpus skips; the same pipeline
// always runs over the self-authored fixtures in testdata/corpus.
//
// When the corpus root is a large tree, only files below a directory whose
// name starts with "test" or "example" (case-insensitive) are used, so
// third-party READMEs are not mistaken for fixtures. Set
// GROWN_CONVERSION_CORPUS_ALL=1 to take every supported file.

// corpusReaders maps file extensions to ImportToHTML formats, mirroring the
// client's IMPORT_FORMATS (web/app/src/pages/docs/api.ts), minus txt: a
// source tree is full of .txt files that are not documents.
var corpusReaders = map[string]string{
	".docx":     "docx",
	".odt":      "odt",
	".rtf":      "rtf",
	".epub":     "epub",
	".md":       "md",
	".markdown": "markdown",
	".html":     "html",
	".htm":      "html",
}

// corpusTags maps known OnlyOffice fixture documents (path suffix relative to
// research/onlyoffice/core) to their scoreboard tag; tagged files run as a
// subtest named by the tag so `go test -json` results count as passing ports.
var corpusTags = map[string]string{
	"OdfFile/Test/Test/ExampleFiles/44363.odt":         "oo:core/OdfFile/Test/Test/ExampleFiles#44363.odt",
	"OdfFile/Test/Test/ExampleFiles/57197.odt":         "oo:core/OdfFile/Test/Test/ExampleFiles#57197.odt",
	"OdfFile/Test/Test/ExampleFiles/59708.docx":        "oo:core/OdfFile/Test/Test/ExampleFiles#59708.docx",
	"OdfFile/Test/Test/ExampleFiles/61364.odt":         "oo:core/OdfFile/Test/Test/ExampleFiles#61364.odt",
	"EpubFile/test/Files/1-posledneye-zhelaniye.epub":  "oo:core/EpubFile/test/Files#1-posledneye-zhelaniye.epub",
	"EpubFile/test/Files/2-mech-prednaznacheniya.epub": "oo:core/EpubFile/test/Files#2-mech-prednaznacheniya.epub",
	"EpubFile/test/Files/3-krov-elfov.epub":            "oo:core/EpubFile/test/Files#3-krov-elfov.epub",
	"EpubFile/test/Files/4-chas-prezreniya.epub":       "oo:core/EpubFile/test/Files#4-chas-prezreniya.epub",
	"EpubFile/test/Files/5-kreshcheniye-ognem.epub":    "oo:core/EpubFile/test/Files#5-kreshcheniye-ognem.epub",
	"EpubFile/test/Files/6-bashnya-lastochki.epub":     "oo:core/EpubFile/test/Files#6-bashnya-lastochki.epub",
	"EpubFile/test/Files/7-vladychitsa-ozera.epub":     "oo:core/EpubFile/test/Files#7-vladychitsa-ozera.epub",
	"EpubFile/test/Files/8-sezon-groz.epub":            "oo:core/EpubFile/test/Files#8-sezon-groz.epub",
	"EpubFile/test/Files/Harry Potter 1.epub":          "oo:core/EpubFile/test/Files#Harry Potter 1.epub",
	"EpubFile/test/Files/Robinson Crusoe.epub":         "oo:core/EpubFile/test/Files#Robinson Crusoe.epub",
	"EpubFile/test/Files/Tom Sawyer.epub":              "oo:core/EpubFile/test/Files#Tom Sawyer.epub",
}

// corpusBatchTag is the scoreboard tag for the runner as a whole: the port of
// OnlyOffice's StandardTester batch round-trip converter.
const corpusBatchTag = "oo:core/Test/Applications/StandardTester/main.cpp#batch round trip"

func TestConversionCorpus(t *testing.T) {
	root := os.Getenv("GROWN_CONVERSION_CORPUS")
	if root == "" {
		t.Skip("GROWN_CONVERSION_CORPUS not set (local-only corpus, e.g. research/onlyoffice/core)")
	}
	requirePandoc(t)
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		t.Skipf("GROWN_CONVERSION_CORPUS=%q is not a directory", root)
	}
	all := os.Getenv("GROWN_CONVERSION_CORPUS_ALL") == "1"
	files := collectCorpus(t, root, !all)
	if len(files) == 0 {
		t.Skipf("no supported documents under %s", root)
	}
	res := runCorpus(t, root, files)
	// A leaf subtest carries the batch tag, so the per-file subtests are not
	// nested under it (the scoreboard would count each as a distinct tag).
	t.Run(corpusBatchTag, func(t *testing.T) {
		if res.passed != len(files) {
			t.Errorf("%d/%d corpus documents failed", len(files)-res.passed, len(files))
		}
	})
}

// TestConversionCorpusTestdata runs the corpus pipeline over the tracked,
// self-authored fixtures so the runner itself is exercised in CI.
func TestConversionCorpusTestdata(t *testing.T) {
	requirePandoc(t)
	root := "testdata/corpus"
	files := collectCorpus(t, root, false)
	if len(files) < 3 {
		t.Fatalf("expected self-authored fixtures in %s, found %d", root, len(files))
	}
	res := runCorpus(t, root, files)
	if res.passed != len(files) || res.empty != 0 {
		t.Fatalf("self-authored corpus: %d/%d passed", res.passed, len(files))
	}
}

var fixtureDir = regexp.MustCompile(`(?i)^(test|example)`)

func collectCorpus(t *testing.T, root string, fixturesOnly bool) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if n := d.Name(); path != root && (strings.HasPrefix(n, ".") || n == "node_modules") {
				return filepath.SkipDir
			}
			return nil
		}
		if _, ok := corpusReaders[strings.ToLower(filepath.Ext(path))]; !ok {
			return nil
		}
		if fixturesOnly && !underFixtureDir(root, path) {
			return nil
		}
		files = append(files, path)
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	sort.Strings(files)
	return files
}

// underFixtureDir reports whether some directory between root's base name and
// path's parent looks like a test/example fixture directory.
func underFixtureDir(root, path string) bool {
	rel, err := filepath.Rel(filepath.Dir(filepath.Clean(root)), filepath.Dir(path))
	if err != nil {
		return false
	}
	for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
		if fixtureDir.MatchString(seg) {
			return true
		}
	}
	return false
}

type corpusResult struct {
	passed, empty int
	failed        map[string][]string // rel path -> reasons
	stats         map[string][2]int   // ext -> {passed, total}
}

func runCorpus(t *testing.T, root string, files []string) corpusResult {
	t.Helper()
	res := corpusResult{failed: map[string][]string{}, stats: map[string][2]int{}}
	var mu sync.Mutex
	start := time.Now()
	t.Run("files", func(t *testing.T) {
		for _, path := range files {
			rel, _ := filepath.Rel(root, path)
			rel = filepath.ToSlash(rel)
			ext := strings.ToLower(filepath.Ext(path))
			t.Run(corpusName(path, rel), func(t *testing.T) {
				t.Parallel()
				c := checkCorpusFile(path, corpusReaders[ext])
				for _, r := range c.reasons {
					t.Error(r)
				}
				if c.note != "" {
					t.Log(c.note)
				}
				mu.Lock()
				defer mu.Unlock()
				s := res.stats[ext]
				s[1]++
				if len(c.reasons) == 0 {
					s[0]++
					res.passed++
					if c.empty {
						res.empty++
					}
				} else {
					res.failed[rel] = c.reasons
				}
				res.stats[ext] = s
			})
		}
	})

	var b strings.Builder
	fmt.Fprintf(&b, "conversion corpus %s: %d/%d passed (%.1f%%; %d of them empty documents) in %s\n",
		root, res.passed, len(files), 100*float64(res.passed)/float64(len(files)), res.empty, time.Since(start).Round(time.Millisecond))
	exts := make([]string, 0, len(res.stats))
	for e := range res.stats {
		exts = append(exts, e)
	}
	sort.Strings(exts)
	for _, e := range exts {
		fmt.Fprintf(&b, "  %-6s %d/%d\n", e, res.stats[e][0], res.stats[e][1])
	}
	failed := make([]string, 0, len(res.failed))
	for f := range res.failed {
		failed = append(failed, f)
	}
	sort.Strings(failed)
	for _, f := range failed {
		fmt.Fprintf(&b, "  FAIL %s: %s\n", f, strings.Join(res.failed[f], "; "))
	}
	t.Log("\n" + b.String())
	return res
}

// corpusName is the subtest name: the scoreboard tag for known OnlyOffice
// fixtures, else the root-relative path.
func corpusName(path, rel string) string {
	p := filepath.ToSlash(path)
	for suffix, tag := range corpusTags {
		if strings.HasSuffix(p, "/"+suffix) {
			return tag
		}
	}
	return rel
}

type corpusCheck struct {
	reasons []string // invariant violations; empty means pass
	empty   bool     // the source has no visible content (passes if the import is empty too)
	note    string
}

// checkCorpusFile runs one document through import → docx/odt/md export →
// docx re-import and reports every invariant that did not hold.
func checkCorpusFile(path, from string) (c corpusCheck) {
	fail := func(format string, args ...any) corpusCheck {
		c.reasons = append(c.reasons, fmt.Sprintf(format, args...))
		return c
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fail("read: %v", err)
	}
	if len(data) > maxConvertBytes {
		c.note = "skipped: larger than the import cap"
		return c
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	html1, err := ImportToHTML(ctx, data, from)
	if err != nil {
		return fail("import %s: %v", from, err)
	}
	s1 := statsOf(string(html1))
	if s1.words == 0 && s1.imgs == 0 {
		// Only acceptable when the source itself has nothing to show (e.g.
		// libxml2 parser edge cases, an ODT of empty paragraphs).
		if n := sourceWords(data, from); n != 0 {
			return fail("import lost all content: source has %d words, HTML is %q", n, firstN(string(html1), 200))
		}
		c.empty = true
		c.note = "empty source document"
	}

	var docx []byte
	for _, to := range []string{"docx", "odt", "md"} {
		out, _, err := ConvertHTML(ctx, html1, to)
		if err != nil {
			return fail("export %s: %v", to, err)
		}
		if len(out) == 0 {
			return fail("export %s: empty output", to)
		}
		if to == "docx" {
			docx = out
		}
	}

	html2, err := ImportToHTML(ctx, docx, "docx")
	if err != nil {
		return fail("re-import docx: %v", err)
	}
	s2 := statsOf(string(html2))
	// Basic structure must survive the docx round trip: nearly all words,
	// every heading and table, and most list items and embedded images.
	if s2.words < s1.words*95/100 {
		fail("words %d -> %d after docx round trip", s1.words, s2.words)
	}
	for _, k := range []struct {
		name   string
		a, b   int
		minPct int
	}{
		{"headings", s1.headings, s2.headings, 100},
		{"tables", s1.tables, s2.tables, 100},
		{"list items", s1.items, s2.items, 90},
		{"embedded images", s1.imgs, s2.imgs, 90},
	} {
		if k.b*100 < k.a*k.minPct {
			fail("%s %d -> %d after docx round trip (want ≥%d%%)", k.name, k.a, k.b, k.minPct)
		}
	}
	if c.note == "" {
		c.note = fmt.Sprintf("%s: %d words, %d headings, %d tables, %d list items, %d images → %d/%d/%d/%d/%d",
			from, s1.words, s1.headings, s1.tables, s1.items, s1.imgs, s2.words, s2.headings, s2.tables, s2.items, s2.imgs)
	}
	return c
}

var (
	reHead    = regexp.MustCompile(`(?is)<head[\s>].*?</head>|<!--.*?-->|<\?.*?\?>|<!doctype[^>]*>`)
	reOdfBody = regexp.MustCompile(`(?s)<office:body>.*</office:body>`)
)

// sourceWords estimates the visible words in the source document without
// pandoc, to tell an empty document from an import that lost everything.
// Formats it cannot inspect report -1 (never "empty").
func sourceWords(data []byte, from string) int {
	switch from {
	case "html":
		return statsOf(reHead.ReplaceAllString(string(data), " ")).words
	case "md", "markdown":
		return len(strings.Fields(string(data)))
	case "docx", "odt":
		entry := map[string]string{"docx": "word/document.xml", "odt": "content.xml"}[from]
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return -1
		}
		for _, f := range zr.File {
			if f.Name != entry {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				return -1
			}
			b, _ := io.ReadAll(rc)
			rc.Close()
			x := string(b)
			if from == "odt" {
				x = reOdfBody.FindString(x)
			}
			return statsOf(x).words
		}
	}
	return -1
}

type htmlStats struct {
	words, headings, tables, items, imgs int
}

var (
	reHeading = regexp.MustCompile(`(?i)<h[1-6][\s>]`)
	reTable   = regexp.MustCompile(`(?i)<table[\s>]`)
	reItem    = regexp.MustCompile(`(?i)<li[\s>]\s*[^<\s]|<li[\s>]\s*<[^/]`) // non-empty items
	// Only data: URIs count: a relative or remote src in a source HTML file
	// cannot be embedded (pandoc runs sandboxed), so it is not a loss.
	reImg   = regexp.MustCompile(`(?i)<(img|embed)\s[^>]*src="data:`)
	reTag   = regexp.MustCompile(`(?s)<[^>]*>`)
	reStyle = regexp.MustCompile(`(?is)<(style|script)[\s>].*?</(style|script)>`)
)

func statsOf(h string) htmlStats {
	text := html.UnescapeString(reTag.ReplaceAllString(reStyle.ReplaceAllString(h, " "), " "))
	return htmlStats{
		words:    len(strings.Fields(text)),
		headings: len(reHeading.FindAllStringIndex(h, -1)),
		tables:   len(reTable.FindAllStringIndex(h, -1)),
		items:    len(reItem.FindAllStringIndex(h, -1)),
		imgs:     len(reImg.FindAllStringIndex(h, -1)),
	}
}
