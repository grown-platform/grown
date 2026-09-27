// Package convert runs LibreOffice headless (soffice) as an optional,
// separately installed converter for office formats Grown's own importers
// don't read: legacy binary .doc/.xls/.ppt (and .wpd), plus ODF/RTF when an
// operator opts into LibreOffice for higher fidelity.
//
// LibreOffice is MPL-2.0 and is only ever exec'd over files, never linked, so
// the MIT tree stays clean (see README.md "Licensing"). It is off by default:
// GROWN_LIBREOFFICE=1 turns it on, and the default container image does not
// ship LibreOffice at all.
//
// Every conversion turns an untrusted upload into a well-known OOXML package
// (docx/xlsx/pptx). The browser's existing importers (Docs M6, Sheets M11,
// Slides M1) then take over, so fidelity work isn't duplicated here.
//
// Hardening, per conversion:
//   - input size cap, and a magic-byte check so a file must really be the
//     format its extension claims (no HTML/XML/SVG/"exotic" filters reachable);
//   - an explicit export filter;
//   - a fresh temp dir holding the input, the output and a throwaway user
//     profile (-env:UserInstallation), so concurrent runs never share state;
//   - that profile is pre-seeded with registrymodifications.xcu that disables
//     macro execution outright, pins macro security to "very high" with no
//     trusted locations, blocks linked resources from untrusted referers,
//     never updates external links (Writer/Calc) and refuses "exotic" formats;
//   - a minimal environment (HOME/TMPDIR inside the temp dir, no inherited
//     secrets);
//   - its own process group, killed as a whole on timeout or cancellation;
//   - a semaphore bounding concurrent soffice processes;
//   - an output size cap and a zip magic check on the result;
//   - the temp dir is always removed.
package convert

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

// Target is an OOXML format LibreOffice converts into.
type Target string

const (
	DOCX Target = "docx"
	XLSX Target = "xlsx"
	PPTX Target = "pptx"
)

// exportFilters are the explicit soffice export filters, one per target.
var exportFilters = map[Target]string{
	DOCX: "docx:MS Word 2007 XML",
	XLSX: "xlsx:Calc MS Excel 2007 XML",
	PPTX: "pptx:Impress MS PowerPoint 2007 XML",
}

// MIME returns the Content-Type of a target package.
func (t Target) MIME() string {
	switch t {
	case DOCX:
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case XLSX:
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case PPTX:
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	}
	return "application/octet-stream"
}

// source describes an accepted input extension.
type source struct {
	to     Target
	magic  func([]byte) bool
	legacy bool // true: no in-browser reader; false: LibreOffice is an optional fidelity upgrade
}

var (
	ole2Magic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}
	rtfMagic  = []byte(`{\rtf`)
	wpdMagic  = []byte{0xFF, 'W', 'P', 'C'}
)

func isOLE2(b []byte) bool { return bytes.HasPrefix(b, ole2Magic) }
func isRTF(b []byte) bool  { return bytes.HasPrefix(b, rtfMagic) }

// odfMagic checks for an ODF package whose first, stored "mimetype" entry
// names the expected media type (ODF 1.2 §3.3).
func odfMagic(kind string) func([]byte) bool {
	want := []byte("application/vnd.oasis.opendocument." + kind)
	return func(b []byte) bool {
		return len(b) > 38+len(want) && bytes.HasPrefix(b, []byte("PK\x03\x04")) &&
			string(b[30:38]) == "mimetype" && bytes.Contains(b[38:min(len(b), 38+len(want)+64)], want)
	}
}

// sources maps accepted input extensions to their target and magic check.
var sources = map[string]source{
	"doc": {DOCX, func(b []byte) bool { return isOLE2(b) || isRTF(b) }, true},
	"dot": {DOCX, isOLE2, true},
	"wpd": {DOCX, func(b []byte) bool { return bytes.HasPrefix(b, wpdMagic) }, true},
	"xls": {XLSX, isOLE2, true},
	"xlt": {XLSX, isOLE2, true},
	"ppt": {PPTX, isOLE2, true},
	"pps": {PPTX, isOLE2, true},
	"pot": {PPTX, isOLE2, true},
	"rtf": {DOCX, isRTF, false},
	"odt": {DOCX, odfMagic("text"), false},
	"ods": {XLSX, odfMagic("spreadsheet"), false},
	"odp": {PPTX, odfMagic("presentation"), false},
}

// TargetFor reports the OOXML target for an input extension (without dot).
func TargetFor(ext string) (Target, bool) {
	s, ok := sources[strings.ToLower(ext)]
	return s.to, ok
}

// Errors callers map to HTTP statuses.
var (
	ErrDisabled    = errors.New("libreoffice conversion is disabled")
	ErrUnsupported = errors.New("unsupported source format")
	ErrTooLarge    = errors.New("input too large")
	ErrBadInput    = errors.New("file content does not match its format")
	ErrBusy        = errors.New("converter busy")
	ErrTimeout     = errors.New("conversion timed out")
	ErrFailed      = errors.New("conversion failed")
)

// Config configures a Converter. Zero values take the defaults below.
type Config struct {
	Enabled     bool          // GROWN_LIBREOFFICE=1
	Binary      string        // GROWN_SOFFICE_PATH, else auto-detected
	PreferODF   bool          // GROWN_LIBREOFFICE_ODF=1: route odt/ods/odp/rtf through LibreOffice too
	Timeout     time.Duration // GROWN_LIBREOFFICE_TIMEOUT (Go duration), default 120s
	MaxInput    int64         // GROWN_LIBREOFFICE_MAX_BYTES, default 32 MiB
	MaxOutput   int64         // default 4 × MaxInput, at least 64 MiB
	Concurrency int           // GROWN_LIBREOFFICE_CONCURRENCY, default 2
	QueueWait   time.Duration // how long a request waits for a slot, default 30s
	TempDir     string        // parent of per-conversion dirs, default os.TempDir()
}

const (
	defaultTimeout     = 120 * time.Second
	defaultMaxInput    = 32 << 20
	defaultConcurrency = 2
	defaultQueueWait   = 30 * time.Second
)

// ConfigFromEnv reads the GROWN_LIBREOFFICE* / GROWN_SOFFICE_PATH variables.
func ConfigFromEnv() Config {
	c := Config{
		Enabled:   truthy(os.Getenv("GROWN_LIBREOFFICE")),
		Binary:    os.Getenv("GROWN_SOFFICE_PATH"),
		PreferODF: truthy(os.Getenv("GROWN_LIBREOFFICE_ODF")),
	}
	if d, err := time.ParseDuration(os.Getenv("GROWN_LIBREOFFICE_TIMEOUT")); err == nil && d > 0 {
		c.Timeout = d
	}
	if n, err := strconv.ParseInt(os.Getenv("GROWN_LIBREOFFICE_MAX_BYTES"), 10, 64); err == nil && n > 0 {
		c.MaxInput = n
	}
	if n, err := strconv.Atoi(os.Getenv("GROWN_LIBREOFFICE_CONCURRENCY")); err == nil && n > 0 {
		c.Concurrency = n
	}
	return c
}

func truthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// DetectBinary finds soffice: PATH (soffice, libreoffice), then the usual
// macOS and Linux install locations. It returns "" when none exists.
func DetectBinary() string {
	for _, name := range []string{"soffice", "libreoffice"} {
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
	}
	candidates := []string{
		"/usr/lib/libreoffice/program/soffice",
		"/opt/libreoffice/program/soffice",
		"/usr/local/lib/libreoffice/program/soffice",
	}
	if runtime.GOOS == "darwin" {
		candidates = append([]string{"/Applications/LibreOffice.app/Contents/MacOS/soffice"}, candidates...)
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return p
		}
	}
	return ""
}

// Converter runs bounded, sandboxed soffice conversions. A nil *Converter
// (or one built with Enabled=false / no binary) reports Enabled()==false.
type Converter struct {
	cfg     Config
	binary  string
	sem     chan struct{}
	running atomic.Int32
	peak    atomic.Int32 // highest observed concurrency (tests)
}

// New builds a Converter. It returns a disabled converter (never nil) when
// the flag is off or no soffice binary can be found; Enabled reports which.
func New(cfg Config) *Converter {
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultTimeout
	}
	if cfg.MaxInput <= 0 {
		cfg.MaxInput = defaultMaxInput
	}
	if cfg.MaxOutput <= 0 {
		cfg.MaxOutput = max(4*cfg.MaxInput, 64<<20)
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = defaultConcurrency
	}
	if cfg.QueueWait <= 0 {
		cfg.QueueWait = defaultQueueWait
	}
	c := &Converter{cfg: cfg, sem: make(chan struct{}, cfg.Concurrency)}
	if cfg.Enabled {
		c.binary = cfg.Binary
		if c.binary == "" {
			c.binary = DetectBinary()
		}
	}
	return c
}

// Enabled reports whether conversions will run.
func (c *Converter) Enabled() bool { return c != nil && c.cfg.Enabled && c.binary != "" }

// Binary is the soffice path in use ("" when disabled).
func (c *Converter) Binary() string {
	if !c.Enabled() {
		return ""
	}
	return c.binary
}

// Capabilities is what GET /api/v1/convert/capabilities returns.
type Capabilities struct {
	Enabled bool `json:"enabled"`
	// Formats maps every accepted source extension to its OOXML target.
	Formats map[string]string `json:"formats,omitempty"`
	// Legacy lists extensions only LibreOffice can read (offer them in pickers).
	Legacy []string `json:"legacy,omitempty"`
	// Preferred lists extensions the client should send through LibreOffice
	// even though it has its own reader (GROWN_LIBREOFFICE_ODF=1).
	Preferred []string `json:"preferred,omitempty"`
	MaxBytes  int64    `json:"max_bytes,omitempty"`
}

// Capabilities describes what this converter accepts.
func (c *Converter) Capabilities() Capabilities {
	if !c.Enabled() {
		return Capabilities{Enabled: false}
	}
	caps := Capabilities{Enabled: true, Formats: map[string]string{}, Legacy: []string{}, Preferred: []string{}, MaxBytes: c.cfg.MaxInput}
	for _, ext := range sortedExts() {
		s := sources[ext]
		caps.Formats[ext] = string(s.to)
		if s.legacy {
			caps.Legacy = append(caps.Legacy, ext)
		} else if c.cfg.PreferODF {
			caps.Preferred = append(caps.Preferred, ext)
		}
	}
	return caps
}

func sortedExts() []string {
	out := make([]string, 0, len(sources))
	for k := range sources {
		out = append(out, k)
	}
	// Tiny set: insertion sort keeps this dependency-free and deterministic.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// MaxInput is the largest accepted input in bytes.
func (c *Converter) MaxInput() int64 { return c.cfg.MaxInput }

// Convert turns data (a file with extension `from`) into its OOXML target.
func (c *Converter) Convert(ctx context.Context, data []byte, from string) ([]byte, Target, error) {
	if !c.Enabled() {
		return nil, "", ErrDisabled
	}
	from = strings.ToLower(strings.TrimPrefix(from, "."))
	src, ok := sources[from]
	if !ok {
		return nil, "", fmt.Errorf("%w: %q", ErrUnsupported, from)
	}
	if int64(len(data)) > c.cfg.MaxInput {
		return nil, src.to, fmt.Errorf("%w: %d bytes (max %d)", ErrTooLarge, len(data), c.cfg.MaxInput)
	}
	if !src.magic(data) {
		return nil, src.to, fmt.Errorf("%w: not a .%s file", ErrBadInput, from)
	}

	// Bounded concurrency: wait for a slot, but not forever.
	wait, cancelWait := context.WithTimeout(ctx, c.cfg.QueueWait)
	select {
	case c.sem <- struct{}{}:
		cancelWait()
	case <-wait.Done():
		cancelWait()
		if ctx.Err() != nil {
			return nil, src.to, ctx.Err()
		}
		return nil, src.to, ErrBusy
	}
	defer func() { <-c.sem }()
	n := c.running.Add(1)
	defer c.running.Add(-1)
	for {
		p := c.peak.Load()
		if n <= p || c.peak.CompareAndSwap(p, n) {
			break
		}
	}

	out, err := c.run(ctx, data, from, src.to)
	return out, src.to, err
}

// run does one conversion in its own temp dir and profile.
func (c *Converter) run(ctx context.Context, data []byte, from string, to Target) ([]byte, error) {
	dir, err := os.MkdirTemp(c.cfg.TempDir, "grown-soffice-*")
	if err != nil {
		return nil, fmt.Errorf("%w: temp dir: %v", ErrFailed, err)
	}
	defer os.RemoveAll(dir)

	profile := filepath.Join(dir, "profile")
	outDir := filepath.Join(dir, "out")
	home := filepath.Join(dir, "home")
	tmp := filepath.Join(dir, "tmp")
	for _, d := range []string{filepath.Join(profile, "user"), outDir, home, tmp} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrFailed, err)
		}
	}
	if err := os.WriteFile(filepath.Join(profile, "user", "registrymodifications.xcu"), []byte(HardenedRegistry), 0o600); err != nil {
		return nil, fmt.Errorf("%w: profile: %v", ErrFailed, err)
	}
	inPath := filepath.Join(dir, "input."+from)
	if err := os.WriteFile(inPath, data, 0o600); err != nil {
		return nil, fmt.Errorf("%w: write input: %v", ErrFailed, err)
	}

	runCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	args := []string{
		"-env:UserInstallation=" + fileURL(profile),
		"--headless", "--invisible", "--nologo", "--nodefault",
		"--norestore", "--nolockcheck", "--nofirststartwizard",
		"--convert-to", exportFilters[to],
		"--outdir", outDir,
		inPath,
	}
	cmd := exec.Command(c.binary, args...)
	cmd.Dir = dir
	cmd.Env = []string{
		"HOME=" + home,
		"TMPDIR=" + tmp,
		"TMP=" + tmp,
		"TEMP=" + tmp,
		"PATH=/usr/bin:/bin:/usr/sbin:/sbin",
		"LANG=C.UTF-8",
		"SAL_USE_VCLPLUGIN=svp", // headless VCL backend, no display
	}
	var stderr, stdout limitedBuffer
	stderr.max, stdout.max = 16<<10, 16<<10
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("%w: start soffice: %v", ErrFailed, err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var waitErr error
	select {
	case waitErr = <-done:
		// soffice can leave helpers behind (oosplash → soffice.bin); reap the group.
		killGroup(cmd.Process.Pid)
	case <-runCtx.Done():
		killGroup(cmd.Process.Pid)
		<-done
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w after %s", ErrTimeout, c.cfg.Timeout)
	}
	if waitErr != nil {
		return nil, fmt.Errorf("%w: soffice: %v: %s", ErrFailed, waitErr, strings.TrimSpace(stderr.String()))
	}

	outPath := filepath.Join(outDir, "input."+string(to))
	st, err := os.Stat(outPath)
	if err != nil {
		// soffice exits 0 when it can't load the source ("Error: source file
		// could not be loaded"); the missing output is the only signal.
		msg := strings.TrimSpace(stderr.String() + " " + stdout.String())
		return nil, fmt.Errorf("%w: no output produced: %s", ErrFailed, msg)
	}
	if st.Size() > c.cfg.MaxOutput {
		return nil, fmt.Errorf("%w: output too large (%d bytes)", ErrFailed, st.Size())
	}
	out, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("%w: read output: %v", ErrFailed, err)
	}
	if _, err := zip.NewReader(bytes.NewReader(out), int64(len(out))); err != nil {
		return nil, fmt.Errorf("%w: output is not a valid package: %v", ErrFailed, err)
	}
	return out, nil
}

// killGroup SIGKILLs the whole process group led by pid.
func killGroup(pid int) {
	if pid > 0 {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}

// fileURL renders an absolute path as a file:// URL for -env:UserInstallation.
func fileURL(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	// Escape the few characters that would break a URL; temp paths are
	// otherwise plain ASCII.
	r := strings.NewReplacer("%", "%25", " ", "%20", "#", "%23", "?", "%3F")
	return "file://" + r.Replace(filepath.ToSlash(abs))
}

// limitedBuffer keeps the first max bytes written and discards the rest.
type limitedBuffer struct {
	bytes.Buffer
	max int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if room := b.max - b.Len(); room > 0 {
		if len(p) > room {
			b.Buffer.Write(p[:room])
		} else {
			b.Buffer.Write(p)
		}
	}
	return len(p), nil
}

var _ io.Writer = (*limitedBuffer)(nil)

// HardenedRegistry is written as the throwaway profile's
// user/registrymodifications.xcu before every run:
//
//   - Common/Security/Scripting/DisableMacrosExecution = true: no Basic,
//     Python or JavaScript macro runs, including document-event macros.
//   - Common/Security/Scripting/MacroSecurityLevel = 3 ("very high": only
//     trusted locations) and SecureURL (trusted locations) empty: a second line
//     of defence should the switch above be ignored by some code path.
//   - Common/Security/Scripting/BlockUntrustedRefererLinks = true: linked
//     images and other resources referenced by the document aren't fetched
//     (no SSRF or local-file reads via links).
//   - Common/Security/LoadExoticFileFormats = 0: never load formats
//     LibreOffice flags as exotic (we also magic-check the input).
//   - Writer/Content/Update/Link = 2 and Calc/Content/Update/Link = 1
//     ("never"): external links, DDE and linked sheets aren't refreshed on
//     load. Writer/Content/Update/Field = false: fields aren't recalculated.
//   - Common/Misc/UseLocking = false: no lock files next to the input.
var HardenedRegistry = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="SecureURL" oor:op="fuse"><value/></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security"><prop oor:name="LoadExoticFileFormats" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseLocking" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Field" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
</oor:items>
`
