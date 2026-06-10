package cloudimport

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// maxArchiveSize is the upload cap for a single archive (500 MB).
const maxArchiveSize = 500 << 20

// maxEntries is the maximum number of entries we will process in one archive.
const maxEntries = 50_000

// Orchestrator unpacks archives, detects data types, and dispatches to app importers.
type Orchestrator struct {
	repo     *Repository
	contacts ContactImporter // may be nil
	calendar EventImporter   // may be nil
	drive    FileImporter    // may be nil
}

// NewOrchestrator constructs an Orchestrator.  All app importers are optional;
// passing nil disables that data type.
func NewOrchestrator(repo *Repository, contacts ContactImporter, calendar EventImporter, drive FileImporter) *Orchestrator {
	return &Orchestrator{repo: repo, contacts: contacts, calendar: calendar, drive: drive}
}

// ProcessJob runs the import job asynchronously. It is called in a goroutine
// after the upload has been spooled to tmpFile. ProcessJob always removes the
// temp file when done.
func (o *Orchestrator) ProcessJob(jobID, orgID, userID, filename string, tmpFile *os.File) {
	ctx := context.Background()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpFile.Name())
	}()

	if err := o.repo.SetStatus(ctx, jobID, StatusProcessing); err != nil {
		slog.Error("cloudimport: set processing", "job", jobID, "err", err)
		return
	}

	if err := o.processArchive(ctx, jobID, orgID, userID, filename, tmpFile); err != nil {
		slog.Error("cloudimport: process archive", "job", jobID, "err", err)
		_ = o.repo.SetStatus(ctx, jobID, StatusFailed)
		_, _ = o.repo.AddItem(ctx, Item{
			JobID:  jobID,
			Kind:   "error",
			Status: ItemError,
			Detail: err.Error(),
		})
		return
	}

	_ = o.repo.SetStatus(ctx, jobID, StatusDone)
}

// processArchive dispatches to zip or tar+gzip based on the filename extension.
func (o *Orchestrator) processArchive(ctx context.Context, jobID, orgID, userID, filename string, f *os.File) error {
	ext := strings.ToLower(filepath.Ext(filename))
	// Handle .tar.gz / .tgz
	if ext == ".tgz" || strings.HasSuffix(strings.ToLower(filename), ".tar.gz") {
		return o.processTarGz(ctx, jobID, orgID, userID, f)
	}
	// Single file upload (e.g. .vcf, .ics, .mbox)
	if ext != ".zip" {
		return o.processSingleFile(ctx, jobID, orgID, userID, filename, f)
	}
	return o.processZip(ctx, jobID, orgID, userID, f)
}

// ---- ZIP ----------------------------------------------------------------

func (o *Orchestrator) processZip(ctx context.Context, jobID, orgID, userID string, f *os.File) error {
	info, err := f.Stat()
	if err != nil {
		return fmt.Errorf("stat: %w", err)
	}
	if info.Size() > maxArchiveSize {
		return fmt.Errorf("archive too large (%d bytes, max %d)", info.Size(), maxArchiveSize)
	}
	zr, err := zip.NewReader(f, info.Size())
	if err != nil {
		return fmt.Errorf("zip.NewReader: %w", err)
	}

	// Collect entries, reject zip-slip.
	entries := make([]EntryInfo, 0, len(zr.File))
	for _, zf := range zr.File {
		p, err := safeArchivePath(zf.Name)
		if err != nil {
			slog.Warn("cloudimport: zip-slip rejected", "path", zf.Name, "err", err)
			continue
		}
		entries = append(entries, EntryInfo{Path: p, Size: int64(zf.UncompressedSize64)})
	}
	if len(entries) > maxEntries {
		return fmt.Errorf("archive has too many entries (%d, max %d)", len(entries), maxEntries)
	}

	det := DetectEntries(entries)

	// Build a lookup map: safe path → *zip.File
	lookup := make(map[string]*zip.File, len(zr.File))
	for _, zf := range zr.File {
		p, err := safeArchivePath(zf.Name)
		if err != nil {
			continue
		}
		lookup[p] = zf
	}

	openEntry := func(p string) (io.ReadCloser, int64, error) {
		zf, ok := lookup[p]
		if !ok {
			return nil, 0, fmt.Errorf("entry not found: %s", p)
		}
		rc, err := zf.Open()
		return rc, int64(zf.UncompressedSize64), err
	}

	return o.dispatchAll(ctx, jobID, orgID, userID, det, openEntry)
}

// ---- TAR.GZ ---------------------------------------------------------------

func (o *Orchestrator) processTarGz(ctx context.Context, jobID, orgID, userID string, f *os.File) error {
	// Two-pass: first collect entries, then re-open for dispatch.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	gr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	tr := tar.NewReader(gr)

	type tarEntry struct {
		header *tar.Header
	}
	var tarHeaders []*tar.Header
	var entries []EntryInfo
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar.Next: %w", err)
		}
		if h.Typeflag == tar.TypeDir {
			continue
		}
		p, err := safeArchivePath(h.Name)
		if err != nil {
			slog.Warn("cloudimport: tar-slip rejected", "path", h.Name)
			continue
		}
		entries = append(entries, EntryInfo{Path: p, Size: h.Size})
		tarHeaders = append(tarHeaders, h)
		_ = tarEntry{h}
	}
	_ = gr.Close()

	if len(entries) > maxEntries {
		return fmt.Errorf("archive has too many entries (%d, max %d)", len(entries), maxEntries)
	}

	det := DetectEntries(entries)

	// Buffer interesting entries from a second read.
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	gr2, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip reopen: %w", err)
	}
	defer gr2.Close()
	tr2 := tar.NewReader(gr2)

	// Collect blobs for entries we'll need.
	needed := needsContent(det)
	blobs := make(map[string][]byte, len(needed))
	for {
		h, err := tr2.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar.Next pass2: %w", err)
		}
		p, err := safeArchivePath(h.Name)
		if err != nil {
			continue
		}
		if _, want := needed[p]; !want {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(tr2, maxArchiveSize))
		if err != nil {
			return fmt.Errorf("read %s: %w", p, err)
		}
		blobs[p] = data
	}

	openEntry := func(p string) (io.ReadCloser, int64, error) {
		data, ok := blobs[p]
		if !ok {
			return nil, 0, fmt.Errorf("entry not found: %s", p)
		}
		return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
	}

	return o.dispatchAll(ctx, jobID, orgID, userID, det, openEntry)
}

// needsContent builds the set of archive paths we need to read content for.
func needsContent(det DetectionResult) map[string]struct{} {
	out := map[string]struct{}{}
	for _, entries := range det.ByKind {
		for _, e := range entries {
			out[e.Path] = struct{}{}
		}
	}
	return out
}

// ---- Single file (no archive) --------------------------------------------

func (o *Orchestrator) processSingleFile(ctx context.Context, jobID, orgID, userID, filename string, f *os.File) error {
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(f, maxArchiveSize))
	if err != nil {
		return fmt.Errorf("read single file: %w", err)
	}
	kind := classifyEntry(filename)
	if kind == "" {
		// Unknown type — just report it.
		_, _ = o.repo.AddItem(ctx, Item{
			JobID: jobID, Kind: "unknown", Count: 1,
			Status: ItemSkipped, Detail: "unrecognised file type: " + filepath.Ext(filename),
		})
		return nil
	}
	det := DetectionResult{
		Source:     SourceFile,
		ByKind:     map[DataKind][]EntryInfo{kind: {{Path: filename, Size: int64(len(data))}}},
		AllEntries: []EntryInfo{{Path: filename, Size: int64(len(data))}},
	}
	openEntry := func(_ string) (io.ReadCloser, int64, error) {
		return io.NopCloser(bytes.NewReader(data)), int64(len(data)), nil
	}
	return o.dispatchAll(ctx, jobID, orgID, userID, det, openEntry)
}

// ---- Dispatch per kind ---------------------------------------------------

type openFn func(path string) (io.ReadCloser, int64, error)

func (o *Orchestrator) dispatchAll(ctx context.Context, jobID, orgID, userID string, det DetectionResult, open openFn) error {
	for kind, entries := range det.ByKind {
		var count int
		var detail string
		var itemStatus string

		switch kind {
		case KindContacts:
			count, detail, itemStatus = o.importContacts(ctx, orgID, userID, entries, open)
		case KindCalendar:
			count, detail, itemStatus = o.importCalendar(ctx, orgID, userID, entries, open)
		case KindDrive:
			count, detail, itemStatus = o.importDrive(ctx, orgID, userID, entries, open)
		case KindPhotos:
			count, detail, itemStatus = o.reportPhotos(entries)
		case KindMail:
			count, detail, itemStatus = o.importMail(ctx, orgID, userID, entries, open)
		default:
			continue
		}

		_, _ = o.repo.AddItem(ctx, Item{
			JobID:  jobID,
			Kind:   string(kind),
			Count:  count,
			Status: itemStatus,
			Detail: detail,
		})
	}

	// Report detected items with no entries as "skipped".
	if len(det.ByKind) == 0 {
		_, _ = o.repo.AddItem(ctx, Item{
			JobID:  jobID,
			Kind:   "unknown",
			Status: ItemSkipped,
			Detail: "no recognised data types found in archive",
		})
	}
	return nil
}

// ---- Contacts ------------------------------------------------------------

func (o *Orchestrator) importContacts(ctx context.Context, orgID, userID string, entries []EntryInfo, open openFn) (int, string, string) {
	if o.contacts == nil {
		return 0, "contacts importer not configured", ItemSkipped
	}
	var imported, failed int
	for _, e := range entries {
		if strings.HasSuffix(strings.ToLower(e.Path), ".vcf") {
			rc, _, err := open(e.Path)
			if err != nil {
				slog.Warn("cloudimport: open vcf", "path", e.Path, "err", err)
				failed++
				continue
			}
			n, f := importVCF(ctx, rc, orgID, userID, o.contacts)
			_ = rc.Close()
			imported += n
			failed += f
		}
		// Google CSV contacts are collected but not yet parsed (v2).
	}
	if failed > 0 {
		return imported, fmt.Sprintf("%d imported, %d failed", imported, failed), ItemDone
	}
	return imported, fmt.Sprintf("%d contacts imported", imported), ItemDone
}

// importVCF parses a vCard stream and imports each contact.
func importVCF(ctx context.Context, r io.Reader, orgID, userID string, ci ContactImporter) (imported, failed int) {
	cards := splitVCards(r)
	for _, card := range cards {
		f := parseVCard(card)
		if f.DisplayName == "" && f.FirstName == "" && f.LastName == "" && len(f.Emails) == 0 {
			continue
		}
		if err := ci.ImportContact(ctx, orgID, userID, f); err != nil {
			slog.Warn("cloudimport: import contact", "err", err)
			failed++
		} else {
			imported++
		}
	}
	return
}

// splitVCards splits a multi-vCard stream into individual vCard strings.
func splitVCards(r io.Reader) []string {
	scanner := bufio.NewScanner(r)
	var cards []string
	var cur strings.Builder
	inCard := false
	for scanner.Scan() {
		line := scanner.Text()
		upper := strings.ToUpper(strings.TrimSpace(line))
		if upper == "BEGIN:VCARD" {
			inCard = true
			cur.Reset()
		}
		if inCard {
			cur.WriteString(line)
			cur.WriteByte('\n')
		}
		if upper == "END:VCARD" && inCard {
			cards = append(cards, cur.String())
			inCard = false
		}
	}
	return cards
}

// parseVCard extracts contact fields from a single vCard string.
func parseVCard(card string) ContactFields {
	var f ContactFields
	scanner := bufio.NewScanner(strings.NewReader(card))
	var lines []string
	for scanner.Scan() {
		raw := scanner.Text()
		if len(raw) > 0 && (raw[0] == ' ' || raw[0] == '\t') && len(lines) > 0 {
			lines[len(lines)-1] += raw[1:]
		} else {
			lines = append(lines, raw)
		}
	}
	for _, line := range lines {
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		prop := strings.ToUpper(line[:colon])
		val := strings.TrimSpace(line[colon+1:])
		// Strip param portion (everything after first ';' before colon).
		semi := strings.IndexByte(prop, ';')
		baseProp := prop
		if semi >= 0 {
			baseProp = prop[:semi]
		}
		switch baseProp {
		case "FN":
			f.DisplayName = unescapeVCard(val)
		case "N":
			parts := strings.Split(val, ";")
			if len(parts) >= 2 {
				f.LastName = unescapeVCard(parts[0])
				f.FirstName = unescapeVCard(parts[1])
			}
		case "ORG":
			f.Company = unescapeVCard(val)
		case "TITLE":
			f.JobTitle = unescapeVCard(val)
		case "EMAIL":
			if v := strings.TrimSpace(val); v != "" {
				f.Emails = append(f.Emails, v)
			}
		case "TEL":
			if v := strings.TrimSpace(val); v != "" {
				f.Phones = append(f.Phones, v)
			}
		case "NOTE":
			f.Notes = unescapeVCard(val)
		case "CATEGORIES":
			for _, cat := range strings.Split(val, ",") {
				if c := strings.TrimSpace(cat); c != "" {
					f.Labels = append(f.Labels, c)
				}
			}
		}
	}
	return f
}

func unescapeVCard(s string) string {
	s = strings.ReplaceAll(s, "\\n", "\n")
	s = strings.ReplaceAll(s, "\\N", "\n")
	s = strings.ReplaceAll(s, "\\,", ",")
	s = strings.ReplaceAll(s, "\\;", ";")
	s = strings.ReplaceAll(s, "\\\\", "\\")
	return s
}

// ---- Calendar ------------------------------------------------------------

func (o *Orchestrator) importCalendar(ctx context.Context, orgID, userID string, entries []EntryInfo, open openFn) (int, string, string) {
	if o.calendar == nil {
		return 0, "calendar importer not configured", ItemSkipped
	}
	var imported, failed int
	for _, e := range entries {
		rc, _, err := open(e.Path)
		if err != nil {
			slog.Warn("cloudimport: open ics", "path", e.Path, "err", err)
			failed++
			continue
		}
		events, err := ParseICS(rc)
		_ = rc.Close()
		if err != nil {
			slog.Warn("cloudimport: parse ics", "path", e.Path, "err", err)
			failed++
			continue
		}
		for _, ev := range events {
			ef := EventFields{
				Title:       ev.Summary,
				Description: ev.Description,
				Location:    ev.Location,
				StartAt:     ev.StartAt,
				EndAt:       ev.EndAt,
				AllDay:      ev.AllDay,
				Recurrence:  ev.RRule,
			}
			if ef.StartAt.IsZero() {
				continue // skip invalid events
			}
			if err := o.calendar.ImportEvent(ctx, orgID, userID, ef); err != nil {
				slog.Warn("cloudimport: import event", "summary", ev.Summary, "err", err)
				failed++
			} else {
				imported++
			}
		}
	}
	if failed > 0 {
		return imported, fmt.Sprintf("%d imported, %d failed", imported, failed), ItemDone
	}
	return imported, fmt.Sprintf("%d events imported", imported), ItemDone
}

// ---- Drive ---------------------------------------------------------------

func (o *Orchestrator) importDrive(ctx context.Context, orgID, userID string, entries []EntryInfo, open openFn) (int, string, string) {
	if o.drive == nil {
		return 0, "drive importer not configured", ItemSkipped
	}
	var imported, failed int
	for _, e := range entries {
		if strings.HasSuffix(e.Path, "/") {
			continue
		}
		rc, size, err := open(e.Path)
		if err != nil {
			slog.Warn("cloudimport: open drive file", "path", e.Path, "err", err)
			failed++
			continue
		}
		name := path.Base(e.Path)
		mimeType := mime.TypeByExtension(path.Ext(name))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		// Preserve the directory structure: use the parent portion of the path as
		// the Drive "virtual folder" prefix in the name (simple flat import for v1).
		if err := o.drive.ImportFile(ctx, orgID, userID, "", name, mimeType, size, rc); err != nil {
			slog.Warn("cloudimport: import file", "path", e.Path, "err", err)
			failed++
		} else {
			imported++
		}
		_ = rc.Close()
	}
	if failed > 0 {
		return imported, fmt.Sprintf("%d uploaded, %d failed", imported, failed), ItemDone
	}
	return imported, fmt.Sprintf("%d files uploaded to Drive", imported), ItemDone
}

// ---- Photos --------------------------------------------------------------

func (o *Orchestrator) reportPhotos(entries []EntryInfo) (int, string, string) {
	return len(entries), fmt.Sprintf(
		"%d photos detected — import these into Immich (your Photos app); Cloud Import does not move media files",
		len(entries)), ItemSkipped
}

// ---- Mail ----------------------------------------------------------------

func (o *Orchestrator) importMail(ctx context.Context, orgID, userID string, entries []EntryInfo, open openFn) (int, string, string) {
	// Count mbox messages for reporting; actual ingest is v2 (mbox parsing is
	// complex and mail is optional). Report count + mark as "not yet supported".
	total := 0
	for _, e := range entries {
		rc, _, err := open(e.Path)
		if err != nil {
			continue
		}
		n := countMboxMessages(rc)
		_ = rc.Close()
		total += n
	}
	return total, fmt.Sprintf(
		"%d messages found in .mbox files — mail import not yet supported in v1", total), ItemSkipped
}

// countMboxMessages counts "From " separator lines in a mbox stream.
func countMboxMessages(r io.Reader) int {
	scanner := bufio.NewScanner(io.LimitReader(r, 10<<20)) // 10 MB cap for counting
	var n int
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "From ") {
			n++
		}
	}
	return n
}

// ---- Safety --------------------------------------------------------------

// safeArchivePath normalises p and rejects any path that would escape the
// extraction root (zip-slip protection).  Returns an error if unsafe.
func safeArchivePath(p string) (string, error) {
	// Normalise separators (Windows archives may use \).
	p = filepath.ToSlash(filepath.Clean(p))
	// Reject absolute paths and parent-directory traversals.
	if path.IsAbs(p) || strings.HasPrefix(p, "..") || strings.Contains(p, "/../") {
		return "", fmt.Errorf("unsafe archive path: %q", p)
	}
	return p, nil
}

// ---- Adapters that wire concrete repos to the importer interfaces ---------

// ContactsRepoImporter adapts the contacts.Repository to ContactImporter.
// It is defined here in cloudimport to avoid a reverse import from contacts →
// cloudimport; the concrete type is passed from server/main.go.
type contactsRepoImporter struct {
	create func(ctx context.Context, orgID, userID string, f ContactFields) error
}

func (c *contactsRepoImporter) ImportContact(ctx context.Context, orgID, userID string, f ContactFields) error {
	return c.create(ctx, orgID, userID, f)
}

// NewContactImporter builds a ContactImporter from a creation function.
// server.go supplies a closure that calls contacts.Repository.Create.
func NewContactImporter(fn func(ctx context.Context, orgID, userID string, f ContactFields) error) ContactImporter {
	return &contactsRepoImporter{create: fn}
}

// calendarRepoImporter adapts calendar.Repository to EventImporter.
type calendarRepoImporter struct {
	create func(ctx context.Context, orgID, userID string, f EventFields) error
}

func (c *calendarRepoImporter) ImportEvent(ctx context.Context, orgID, userID string, f EventFields) error {
	return c.create(ctx, orgID, userID, f)
}

// NewEventImporter builds an EventImporter from a creation function.
func NewEventImporter(fn func(ctx context.Context, orgID, userID string, f EventFields) error) EventImporter {
	return &calendarRepoImporter{create: fn}
}

// driveImporter adapts drive.Service to FileImporter.
type driveImporter struct {
	upload func(ctx context.Context, orgID, userID, parent, name, mimeType string, size int64, r io.Reader) error
}

func (d *driveImporter) ImportFile(ctx context.Context, orgID, userID, parent, name, mimeType string, size int64, r io.Reader) error {
	return d.upload(ctx, orgID, userID, parent, name, mimeType, size, r)
}

// NewFileImporter builds a FileImporter from an upload function.
func NewFileImporter(fn func(ctx context.Context, orgID, userID, parent, name, mimeType string, size int64, r io.Reader) error) FileImporter {
	return &driveImporter{upload: fn}
}
