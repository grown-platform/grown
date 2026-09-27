package convert

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/users"
)

// These tests need no LibreOffice: a tiny shell script stands in for soffice
// so the process handling (timeout, process-group kill, concurrency limit,
// cleanup, environment) is always exercised. soffice_real_test.go runs the
// real binary when it is installed.

// tinyZip is a valid (if meaningless) zip package the fake soffice "outputs".
func tinyZip(t testing.TB) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("[Content_Types].xml")
	_, _ = w.Write([]byte(`<Types/>`))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

type fakeSoffice struct {
	path    string // the script
	argsLog string // each run appends its argv + env here
	pidFile string // "hang" mode: pid of the child it leaves running
}

// newFakeSoffice writes a shell script behaving like `soffice --convert-to`.
// mode: "ok" (copy a zip to <outdir>/<name>.<ext> after delay), "hang"
// (start a long-lived child, then wait), "noout" (exit 0, write nothing),
// "fail" (exit 3).
func newFakeSoffice(t *testing.T, mode string, delay time.Duration) fakeSoffice {
	t.Helper()
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "out.zip")
	if err := os.WriteFile(zipPath, tinyZip(t), 0o600); err != nil {
		t.Fatal(err)
	}
	f := fakeSoffice{
		path:    filepath.Join(dir, "soffice"),
		argsLog: filepath.Join(dir, "args.log"),
		pidFile: filepath.Join(dir, "child.pid"),
	}
	script := fmt.Sprintf(`#!/bin/sh
outdir=""; filter=""; input=""
while [ $# -gt 0 ]; do
  case "$1" in
    --outdir) outdir="$2"; shift ;;
    --convert-to) filter="$2"; shift ;;
    -*) ;;
    *) input="$1" ;;
  esac
  shift
done
{ echo "ARGS outdir=$outdir filter=$filter input=$input"; env | sed 's/^/ENV /'; } >> %q
base=$(basename "$input"); name="${base%%.*}"; ext="${filter%%%%:*}"
case %q in
  ok) sleep %s; cp %q "$outdir/$name.$ext" ;;
  hang) sleep 300 & echo $! > %q; wait ;;
  noout) exit 0 ;;
  fail) echo "boom" >&2; exit 3 ;;
esac
`, f.argsLog, mode, strconv.FormatFloat(delay.Seconds(), 'f', 3, 64), zipPath, f.pidFile)
	if err := os.WriteFile(f.path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return f
}

var docBytes = append(append([]byte{}, ole2Magic...), make([]byte, 512)...)

func TestMagicChecks(t *testing.T) {
	odt := append([]byte("PK\x03\x04"), make([]byte, 26)...)
	odt = append(odt, []byte("mimetypeapplication/vnd.oasis.opendocument.textPK\x03\x04")...)
	ods := bytes.Replace(odt, []byte("opendocument.text"), []byte("opendocument.spreadsheet"), 1)
	cases := []struct {
		ext  string
		data []byte
		ok   bool
	}{
		{"doc", docBytes, true},
		{"doc", []byte(`{\rtf1\ansi hello}`), true}, // Word saves RTF as .doc
		{"doc", []byte("plain text pretending"), false},
		{"doc", []byte("<html><img src=http://169.254.169.254/></html>"), false},
		{"xls", docBytes, true},
		{"xls", []byte("a,b,c\n1,2,3"), false},
		{"ppt", docBytes, true},
		{"ppt", []byte("PK\x03\x04"), false},
		{"rtf", []byte(`{\rtf1}`), true},
		{"rtf", docBytes, false},
		{"wpd", []byte("\xffWPC\x10\x00"), true},
		{"odt", odt, true},
		{"odt", ods, false},
		{"ods", ods, true},
		{"odp", odt, false},
	}
	for _, c := range cases {
		if got := sources[c.ext].magic(c.data); got != c.ok {
			t.Errorf("magic(%s, %q…) = %v, want %v", c.ext, c.data[:min(12, len(c.data))], got, c.ok)
		}
	}
}

func TestTargetFor(t *testing.T) {
	for ext, want := range map[string]Target{"doc": DOCX, "DOC": DOCX, "wpd": DOCX, "xls": XLSX, "ods": XLSX, "ppt": PPTX, "odp": PPTX} {
		if got, ok := TargetFor(ext); !ok || got != want {
			t.Errorf("TargetFor(%s) = %v %v, want %v", ext, got, ok, want)
		}
	}
	for _, ext := range []string{"docx", "html", "svg", "xml", "fodt", "exe", ""} {
		if _, ok := TargetFor(ext); ok {
			t.Errorf("TargetFor(%q) accepted", ext)
		}
	}
}

func TestDisabledByDefault(t *testing.T) {
	var nilConv *Converter
	if nilConv.Enabled() {
		t.Fatal("nil converter enabled")
	}
	c := New(Config{Binary: "/bin/true"}) // flag off
	if c.Enabled() || c.Capabilities().Enabled {
		t.Fatal("converter enabled without GROWN_LIBREOFFICE")
	}
	if _, _, err := c.Convert(context.Background(), docBytes, "doc"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv("GROWN_LIBREOFFICE", "1")
	t.Setenv("GROWN_SOFFICE_PATH", "/opt/lo/soffice")
	t.Setenv("GROWN_LIBREOFFICE_ODF", "true")
	t.Setenv("GROWN_LIBREOFFICE_TIMEOUT", "45s")
	t.Setenv("GROWN_LIBREOFFICE_MAX_BYTES", "1048576")
	t.Setenv("GROWN_LIBREOFFICE_CONCURRENCY", "4")
	c := ConfigFromEnv()
	if !c.Enabled || c.Binary != "/opt/lo/soffice" || !c.PreferODF || c.Timeout != 45*time.Second || c.MaxInput != 1<<20 || c.Concurrency != 4 {
		t.Fatalf("ConfigFromEnv = %+v", c)
	}
	t.Setenv("GROWN_LIBREOFFICE", "0")
	if ConfigFromEnv().Enabled {
		t.Fatal("GROWN_LIBREOFFICE=0 enabled the converter")
	}
}

func TestCapabilities(t *testing.T) {
	f := newFakeSoffice(t, "ok", 0)
	caps := New(Config{Enabled: true, Binary: f.path}).Capabilities()
	if !caps.Enabled || caps.Formats["doc"] != "docx" || caps.Formats["xls"] != "xlsx" || caps.Formats["ppt"] != "pptx" {
		t.Fatalf("caps = %+v", caps)
	}
	if strings.Join(caps.Legacy, ",") != "doc,dot,pot,pps,ppt,wpd,xls,xlt" {
		t.Fatalf("legacy = %v", caps.Legacy)
	}
	if len(caps.Preferred) != 0 {
		t.Fatalf("ODF preferred without GROWN_LIBREOFFICE_ODF: %v", caps.Preferred)
	}
	caps = New(Config{Enabled: true, Binary: f.path, PreferODF: true}).Capabilities()
	if strings.Join(caps.Preferred, ",") != "odp,ods,odt,rtf" {
		t.Fatalf("preferred = %v", caps.Preferred)
	}
}

func TestConvertRejectsBeforeExec(t *testing.T) {
	f := newFakeSoffice(t, "ok", 0)
	c := New(Config{Enabled: true, Binary: f.path, MaxInput: 1024})
	ctx := context.Background()
	if _, _, err := c.Convert(ctx, docBytes, "docx"); !errors.Is(err, ErrUnsupported) {
		t.Errorf("docx: %v", err)
	}
	if _, _, err := c.Convert(ctx, append(docBytes, make([]byte, 1024)...), "doc"); !errors.Is(err, ErrTooLarge) {
		t.Errorf("oversize: %v", err)
	}
	if _, _, err := c.Convert(ctx, []byte("<html></html>"), "doc"); !errors.Is(err, ErrBadInput) {
		t.Errorf("html as doc: %v", err)
	}
	if _, err := os.Stat(f.argsLog); err == nil {
		t.Error("soffice ran for a rejected input")
	}
}

func TestConvertRunsSandboxed(t *testing.T) {
	f := newFakeSoffice(t, "ok", 0)
	parent := t.TempDir()
	t.Setenv("GROWN_SECRET_SHOULD_NOT_LEAK", "hunter2")
	c := New(Config{Enabled: true, Binary: f.path, TempDir: parent})
	out, to, err := c.Convert(context.Background(), docBytes, "doc")
	if err != nil {
		t.Fatal(err)
	}
	if to != DOCX || !bytes.Equal(out, tinyZip(t)) {
		t.Fatalf("to=%s out=%d bytes", to, len(out))
	}
	log, _ := os.ReadFile(f.argsLog)
	s := string(log)
	if !strings.Contains(s, "filter=docx:MS Word 2007 XML") {
		t.Errorf("explicit export filter missing:\n%s", s)
	}
	if strings.Contains(s, "hunter2") {
		t.Error("parent environment leaked into soffice")
	}
	for _, want := range []string{"ENV HOME=" + parent, "ENV TMPDIR=" + parent, "ENV SAL_USE_VCLPLUGIN=svp"} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %q in:\n%s", want, s)
		}
	}
	if left, _ := os.ReadDir(parent); len(left) != 0 {
		t.Errorf("temp dir not cleaned: %v", left)
	}
}

func TestConvertProfileIsPerRunAndHardened(t *testing.T) {
	// The fake records argv; check the -env:UserInstallation arg points into
	// the run's own dir and that dir held the hardened registry while it ran.
	dir := t.TempDir()
	script := filepath.Join(dir, "soffice")
	seen := filepath.Join(dir, "seen")
	zipPath := filepath.Join(dir, "z.zip")
	_ = os.WriteFile(zipPath, tinyZip(t), 0o600)
	_ = os.WriteFile(script, []byte(fmt.Sprintf(`#!/bin/sh
for a in "$@"; do case "$a" in
  -env:UserInstallation=file://*) p="${a#-env:UserInstallation=file://}"; echo "$p" >> %q; cat "$p/user/registrymodifications.xcu" >> %q ;;
esac; done
while [ $# -gt 0 ]; do case "$1" in --outdir) o="$2"; shift ;; esac; shift; done
cp %q "$o/input.docx"
`, seen, seen, zipPath)), 0o755)
	parent := t.TempDir()
	c := New(Config{Enabled: true, Binary: script, TempDir: parent, Concurrency: 4})
	var wg sync.WaitGroup
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := c.Convert(context.Background(), docBytes, "doc"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	b, _ := os.ReadFile(seen)
	profiles := map[string]bool{}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, parent) {
			profiles[line] = true
		}
	}
	if len(profiles) != 3 {
		t.Errorf("want 3 distinct profiles under %s, got %v", parent, profiles)
	}
	for _, want := range []string{
		`"DisableMacrosExecution" oor:op="fuse"><value>true`,
		`"MacroSecurityLevel" oor:op="fuse"><value>3`,
		`"BlockUntrustedRefererLinks" oor:op="fuse"><value>true`,
		`"LoadExoticFileFormats" oor:op="fuse"><value>0`,
	} {
		if !strings.Contains(string(b), want) {
			t.Errorf("profile missing %s", want)
		}
	}
}

func TestConvertTimeoutKillsProcessGroup(t *testing.T) {
	f := newFakeSoffice(t, "hang", 0)
	parent := t.TempDir()
	c := New(Config{Enabled: true, Binary: f.path, TempDir: parent, Timeout: 500 * time.Millisecond})
	start := time.Now()
	_, _, err := c.Convert(context.Background(), docBytes, "doc")
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	if d := time.Since(start); d > 10*time.Second {
		t.Fatalf("timeout took %s", d)
	}
	b, err := os.ReadFile(f.pidFile)
	if err != nil {
		t.Fatalf("child pid: %v", err)
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	deadline := time.Now().Add(3 * time.Second)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
			t.Fatalf("child %d survived the timeout (process group not killed)", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if left, _ := os.ReadDir(parent); len(left) != 0 {
		t.Errorf("temp dir not cleaned after timeout: %v", left)
	}
}

func TestConvertCancellation(t *testing.T) {
	f := newFakeSoffice(t, "hang", 0)
	c := New(Config{Enabled: true, Binary: f.path, Timeout: time.Minute})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	if _, _, err := c.Convert(ctx, docBytes, "doc"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want context deadline", err)
	}
}

func TestConvertNoOutputAndFailure(t *testing.T) {
	for mode, want := range map[string]string{"noout": "no output", "fail": "boom"} {
		f := newFakeSoffice(t, mode, 0)
		c := New(Config{Enabled: true, Binary: f.path})
		_, _, err := c.Convert(context.Background(), docBytes, "doc")
		if !errors.Is(err, ErrFailed) || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v", mode, err)
		}
	}
}

func TestConcurrencyLimit(t *testing.T) {
	f := newFakeSoffice(t, "ok", 300*time.Millisecond)
	c := New(Config{Enabled: true, Binary: f.path, Concurrency: 2})
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := c.Convert(context.Background(), docBytes, "xls")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Error(err)
		}
	}
	if p := c.peak.Load(); p > 2 || p < 1 {
		t.Fatalf("peak concurrency %d, limit 2", p)
	}
}

func TestBusyWhenQueueWaitExpires(t *testing.T) {
	f := newFakeSoffice(t, "ok", time.Second)
	c := New(Config{Enabled: true, Binary: f.path, Concurrency: 1, QueueWait: 50 * time.Millisecond})
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		_, _, err := c.Convert(context.Background(), docBytes, "ppt")
		done <- err
	}()
	<-started
	time.Sleep(150 * time.Millisecond) // let the first take the only slot
	if _, _, err := c.Convert(context.Background(), docBytes, "ppt"); !errors.Is(err, ErrBusy) {
		t.Fatalf("err = %v, want ErrBusy", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func withUser(r *http.Request) *http.Request {
	return r.WithContext(auth.WithUser(r.Context(), users.User{}))
}

func TestHandler(t *testing.T) {
	f := newFakeSoffice(t, "ok", 0)
	on := Handler(New(Config{Enabled: true, Binary: f.path, MaxInput: 4096}))
	off := Handler(New(Config{}))

	do := func(h http.Handler, method, target string, body []byte, user bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, target, bytes.NewReader(body))
		if user {
			r = withUser(r)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	if w := do(on, "GET", CapabilitiesPath, nil, false); w.Code != 401 {
		t.Errorf("anonymous capabilities: %d", w.Code)
	}
	if w := do(off, "GET", CapabilitiesPath, nil, true); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"enabled":false}` {
		t.Errorf("disabled capabilities: %d %s", w.Code, w.Body)
	}
	if w := do(on, "GET", CapabilitiesPath, nil, true); w.Code != 200 || !strings.Contains(w.Body.String(), `"doc":"docx"`) {
		t.Errorf("enabled capabilities: %d %s", w.Code, w.Body)
	}
	if w := do(off, "POST", OfficePath+"?from=doc", docBytes, true); w.Code != 404 {
		t.Errorf("disabled convert: %d", w.Code)
	}
	if w := do(on, "POST", OfficePath+"?from=doc", docBytes, false); w.Code != 401 {
		t.Errorf("anonymous convert: %d", w.Code)
	}
	w := do(on, "POST", OfficePath+"?from=doc&to=docx&name=Report", docBytes, true)
	if w.Code != 200 || w.Header().Get("Content-Type") != DOCX.MIME() || !strings.Contains(w.Header().Get("Content-Disposition"), `"Report.docx"`) {
		t.Errorf("convert: %d %v", w.Code, w.Header())
	}
	for _, c := range []struct {
		target string
		body   []byte
		code   int
	}{
		{OfficePath + "?from=exe", docBytes, 415},
		{OfficePath + "?from=doc&to=xlsx", docBytes, 400},
		{OfficePath + "?from=doc", []byte("<html>"), 422},
		{OfficePath + "?from=doc", append(docBytes, make([]byte, 4096)...), 413},
	} {
		if w := do(on, "POST", c.target, c.body, true); w.Code != c.code {
			t.Errorf("%s: %d, want %d (%s)", c.target, w.Code, c.code, w.Body)
		}
	}
	if w := do(on, "GET", OfficePath, nil, true); w.Code != 404 {
		t.Errorf("GET convert: %d", w.Code)
	}
}

// processAlive reports whether pid is a live (non-zombie) process. A killed
// child whose parent is gone is reparented to the container's PID 1; when
// that isn't a reaping init (as in CI job containers) it lingers as a zombie,
// which kill(pid, 0) still reports as present. Linux exposes the state in
// /proc/<pid>/stat ("Z"); elsewhere kill(pid, 0) is the whole answer.
func processAlive(pid int) bool {
	if syscall.Kill(pid, 0) != nil {
		return false
	}
	if b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid)); err == nil {
		// Format: pid (comm) state ...; comm may contain spaces/parens.
		if i := strings.LastIndexByte(string(b), ')'); i >= 0 && i+2 < len(b) && b[i+2] == 'Z' {
			return false
		}
	}
	return true
}
