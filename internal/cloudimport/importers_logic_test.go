package cloudimport

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

// readerOpen builds an openFn that serves a fixed body for any path.
func staticOpen(body string) openFn {
	return func(_ string) (io.ReadCloser, int64, error) {
		return io.NopCloser(strings.NewReader(body)), int64(len(body)), nil
	}
}

// failingOpen returns an openFn that always errors (simulates a missing entry).
func failingOpen() openFn {
	return func(p string) (io.ReadCloser, int64, error) {
		return nil, 0, errors.New("entry not found: " + p)
	}
}

// ---- importContacts -------------------------------------------------------

func TestImportContacts_NilImporter(t *testing.T) {
	o := &Orchestrator{} // contacts == nil
	n, detail, status := o.importContacts(context.Background(), "o", "u",
		[]EntryInfo{{Path: "x.vcf"}}, staticOpen(""))
	if n != 0 || status != ItemSkipped {
		t.Fatalf("n=%d status=%q, want 0/%q", n, status, ItemSkipped)
	}
	if !strings.Contains(detail, "not configured") {
		t.Errorf("detail = %q", detail)
	}
}

func TestImportContacts_VCF(t *testing.T) {
	const vcf = `BEGIN:VCARD
FN:Alice Smith
N:Smith;Alice;;;
EMAIL:alice@example.com
END:VCARD
BEGIN:VCARD
FN:Bob Jones
EMAIL:bob@example.com
END:VCARD`

	ci := &stubContactImporter{}
	o := &Orchestrator{contacts: ci}
	entries := []EntryInfo{{Path: "Contacts/all.vcf", Size: int64(len(vcf))}}

	n, detail, status := o.importContacts(context.Background(), "o", "u", entries, staticOpen(vcf))
	if n != 2 {
		t.Fatalf("imported = %d, want 2; detail=%q", n, detail)
	}
	if status != ItemDone {
		t.Errorf("status = %q", status)
	}
	if len(ci.contacts) != 2 || ci.contacts[0].DisplayName != "Alice Smith" {
		t.Errorf("contacts = %+v", ci.contacts)
	}
}

// TestImportContacts_NonVCFSkipped verifies CSV contacts are collected but
// not parsed (the v2 path) — they don't count as imported.
func TestImportContacts_NonVCFSkipped(t *testing.T) {
	ci := &stubContactImporter{}
	o := &Orchestrator{contacts: ci}
	entries := []EntryInfo{{Path: "Contacts/contacts.csv"}}
	n, _, status := o.importContacts(context.Background(), "o", "u", entries, staticOpen("name,email\n"))
	if n != 0 {
		t.Errorf("imported = %d, want 0 (csv not parsed)", n)
	}
	if status != ItemDone {
		t.Errorf("status = %q", status)
	}
}

func TestImportContacts_OpenError(t *testing.T) {
	ci := &stubContactImporter{}
	o := &Orchestrator{contacts: ci}
	entries := []EntryInfo{{Path: "Contacts/all.vcf"}}
	n, detail, _ := o.importContacts(context.Background(), "o", "u", entries, failingOpen())
	if n != 0 {
		t.Errorf("imported = %d, want 0", n)
	}
	if !strings.Contains(detail, "failed") {
		t.Errorf("detail = %q, want it to mention failures", detail)
	}
}

// ---- importVCF: empty-card skip + importer failure -------------------------

func TestImportVCF_SkipsEmptyAndCountsFailures(t *testing.T) {
	// One valid card, one card with no usable fields (should be skipped before
	// reaching the importer), and one valid card that the importer rejects.
	const vcf = `BEGIN:VCARD
FN:Good One
END:VCARD
BEGIN:VCARD
VERSION:3.0
END:VCARD
BEGIN:VCARD
FN:Rejected
END:VCARD`

	fi := &failingContactImporter{failOn: "Rejected"}
	imported, failed := importVCF(context.Background(), strings.NewReader(vcf), "o", "u", fi)
	if imported != 1 {
		t.Errorf("imported = %d, want 1", imported)
	}
	if failed != 1 {
		t.Errorf("failed = %d, want 1", failed)
	}
}

type failingContactImporter struct {
	failOn string
	ok     []ContactFields
}

func (f *failingContactImporter) ImportContact(_ context.Context, _, _ string, c ContactFields) error {
	if c.DisplayName == f.failOn {
		return errors.New("rejected")
	}
	f.ok = append(f.ok, c)
	return nil
}

// ---- importDrive: MIME mapping & failures ---------------------------------

func TestImportDrive_NilImporter(t *testing.T) {
	o := &Orchestrator{}
	n, detail, status := o.importDrive(context.Background(), "o", "u",
		[]EntryInfo{{Path: "Drive/x.txt"}}, staticOpen("x"))
	if n != 0 || status != ItemSkipped {
		t.Fatalf("n=%d status=%q", n, status)
	}
	if !strings.Contains(detail, "not configured") {
		t.Errorf("detail = %q", detail)
	}
}

func TestImportDrive_MapsMIMEAndSkipsDirs(t *testing.T) {
	fi := &recordingFileImporter{}
	o := &Orchestrator{drive: fi}
	entries := []EntryInfo{
		{Path: "Drive/folder/"},          // directory entry → skipped
		{Path: "Drive/report.pdf"},       // known ext → application/pdf
		{Path: "Drive/notes.txt"},        // known ext → text/plain
		{Path: "Drive/blob.unknownext9"}, // unknown ext → octet-stream
	}
	n, detail, status := o.importDrive(context.Background(), "o", "u", entries, staticOpen("data"))
	if status != ItemDone {
		t.Errorf("status = %q", status)
	}
	if n != 3 {
		t.Fatalf("uploaded = %d, want 3; detail=%q", n, detail)
	}
	if len(fi.records) != 3 {
		t.Fatalf("records = %d, want 3", len(fi.records))
	}
	// base names should be stripped of directory prefix
	if fi.records[0].name != "report.pdf" {
		t.Errorf("name = %q, want report.pdf", fi.records[0].name)
	}
	if !strings.Contains(fi.records[0].mime, "pdf") {
		t.Errorf("pdf mime = %q", fi.records[0].mime)
	}
	if fi.records[2].mime != "application/octet-stream" {
		t.Errorf("unknown-ext mime = %q, want application/octet-stream", fi.records[2].mime)
	}
}

func TestImportDrive_CountsFailures(t *testing.T) {
	fi := &recordingFileImporter{failAll: true}
	o := &Orchestrator{drive: fi}
	entries := []EntryInfo{{Path: "Drive/a.txt"}, {Path: "Drive/b.txt"}}
	n, detail, _ := o.importDrive(context.Background(), "o", "u", entries, staticOpen("x"))
	if n != 0 {
		t.Errorf("uploaded = %d, want 0", n)
	}
	if !strings.Contains(detail, "failed") {
		t.Errorf("detail = %q", detail)
	}
}

type driveRecord struct {
	name, mime string
	size       int64
}

type recordingFileImporter struct {
	records []driveRecord
	failAll bool
}

func (r *recordingFileImporter) ImportFile(_ context.Context, _, _, _, name, mimeType string, size int64, body io.Reader) error {
	if r.failAll {
		return errors.New("upload failed")
	}
	_, _ = io.Copy(io.Discard, body)
	r.records = append(r.records, driveRecord{name: name, mime: mimeType, size: size})
	return nil
}

// ---- importMail & countMboxMessages ---------------------------------------

func TestImportMail_CountsMessages(t *testing.T) {
	const mbox = `From alice@example.com Mon Jan 1 00:00:00 2024
Subject: One

body
From bob@example.com Mon Jan 2 00:00:00 2024
Subject: Two

body
From carol@example.com Mon Jan 3 00:00:00 2024
Subject: Three

body`

	o := &Orchestrator{}
	entries := []EntryInfo{{Path: "Mail/inbox.mbox"}}
	n, detail, status := o.importMail(context.Background(), "o", "u", entries, staticOpen(mbox))
	if n != 3 {
		t.Errorf("messages = %d, want 3", n)
	}
	if status != ItemSkipped {
		t.Errorf("status = %q, want %q", status, ItemSkipped)
	}
	if !strings.Contains(detail, "not yet supported") {
		t.Errorf("detail = %q", detail)
	}
}

func TestImportMail_OpenErrorSkipped(t *testing.T) {
	o := &Orchestrator{}
	entries := []EntryInfo{{Path: "Mail/inbox.mbox"}}
	n, _, status := o.importMail(context.Background(), "o", "u", entries, failingOpen())
	if n != 0 {
		t.Errorf("messages = %d, want 0 on open error", n)
	}
	if status != ItemSkipped {
		t.Errorf("status = %q", status)
	}
}

func TestCountMboxMessages(t *testing.T) {
	tests := []struct {
		name string
		body string
		want int
	}{
		{"empty", "", 0},
		{"no separators", "just some text\nmore text", 0},
		{"single", "From a@b x\nbody", 1},
		{"from-not-separator", "Fromage is cheese\n", 0},
		{"multiple", "From a x\nfoo\nFrom b y\nbar\n", 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := countMboxMessages(strings.NewReader(tt.body)); got != tt.want {
				t.Errorf("countMboxMessages = %d, want %d", got, tt.want)
			}
		})
	}
}

// ---- needsContent ---------------------------------------------------------

func TestNeedsContent(t *testing.T) {
	det := DetectionResult{
		ByKind: map[DataKind][]EntryInfo{
			KindContacts: {{Path: "a.vcf"}},
			KindCalendar: {{Path: "b.ics"}, {Path: "c.ics"}},
		},
	}
	got := needsContent(det)
	for _, p := range []string{"a.vcf", "b.ics", "c.ics"} {
		if _, ok := got[p]; !ok {
			t.Errorf("needsContent missing %q", p)
		}
	}
	if len(got) != 3 {
		t.Errorf("len = %d, want 3", len(got))
	}
}

// ---- importCalendar: failure path -----------------------------------------

func TestImportCalendar_OpenErrorCountsFailed(t *testing.T) {
	ei := &stubEventImporter{}
	o := &Orchestrator{calendar: ei}
	entries := []EntryInfo{{Path: "Calendar/x.ics"}}
	n, detail, _ := o.importCalendar(context.Background(), "o", "u", entries, failingOpen())
	if n != 0 {
		t.Errorf("imported = %d, want 0", n)
	}
	if !strings.Contains(detail, "failed") {
		t.Errorf("detail = %q", detail)
	}
}

func TestImportCalendar_NilImporter(t *testing.T) {
	o := &Orchestrator{}
	n, detail, status := o.importCalendar(context.Background(), "o", "u",
		[]EntryInfo{{Path: "x.ics"}}, staticOpen(""))
	if n != 0 || status != ItemSkipped {
		t.Fatalf("n=%d status=%q", n, status)
	}
	if !strings.Contains(detail, "not configured") {
		t.Errorf("detail = %q", detail)
	}
}

// TestImportCalendar_SkipsZeroStart confirms events with no DTSTART are skipped.
func TestImportCalendar_SkipsZeroStart(t *testing.T) {
	const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:no-start@x
SUMMARY:No start time
END:VEVENT
BEGIN:VEVENT
UID:has-start@x
SUMMARY:Has start
DTSTART:20240601T100000Z
END:VEVENT
END:VCALENDAR`
	ei := &stubEventImporter{}
	o := &Orchestrator{calendar: ei}
	entries := []EntryInfo{{Path: "Calendar/c.ics"}}
	n, _, _ := o.importCalendar(context.Background(), "o", "u", entries, staticOpen(ics))
	if n != 1 {
		t.Fatalf("imported = %d, want 1 (zero-start skipped)", n)
	}
	if len(ei.events) != 1 || ei.events[0].Title != "Has start" {
		t.Errorf("events = %+v", ei.events)
	}
}

// ---- adapter constructors -------------------------------------------------

func TestNewContactImporter(t *testing.T) {
	var got ContactFields
	imp := NewContactImporter(func(_ context.Context, org, user string, f ContactFields) error {
		if org != "o" || user != "u" {
			t.Errorf("org/user = %q/%q", org, user)
		}
		got = f
		return nil
	})
	want := ContactFields{DisplayName: "Z"}
	if err := imp.ImportContact(context.Background(), "o", "u", want); err != nil {
		t.Fatalf("ImportContact: %v", err)
	}
	if got.DisplayName != "Z" {
		t.Errorf("got = %+v", got)
	}
}

func TestNewEventImporter(t *testing.T) {
	called := false
	imp := NewEventImporter(func(_ context.Context, _, _ string, _ EventFields) error {
		called = true
		return errors.New("boom")
	})
	err := imp.ImportEvent(context.Background(), "o", "u", EventFields{Title: "T"})
	if !called {
		t.Error("closure not invoked")
	}
	if err == nil || err.Error() != "boom" {
		t.Errorf("err = %v, want boom", err)
	}
}

func TestNewFileImporter(t *testing.T) {
	var gotName, gotMime string
	var gotSize int64
	imp := NewFileImporter(func(_ context.Context, _, _, parent, name, mimeType string, size int64, r io.Reader) error {
		if parent != "" {
			t.Errorf("parent = %q, want empty", parent)
		}
		gotName, gotMime, gotSize = name, mimeType, size
		b, _ := io.ReadAll(r)
		if string(b) != "hi" {
			t.Errorf("body = %q", b)
		}
		return nil
	})
	err := imp.ImportFile(context.Background(), "o", "u", "", "f.txt", "text/plain", 2, strings.NewReader("hi"))
	if err != nil {
		t.Fatalf("ImportFile: %v", err)
	}
	if gotName != "f.txt" || gotMime != "text/plain" || gotSize != 2 {
		t.Errorf("name/mime/size = %q/%q/%d", gotName, gotMime, gotSize)
	}
}
