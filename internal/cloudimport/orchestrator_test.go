package cloudimport

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"
)

// ---- stub importers --------------------------------------------------------

type stubContactImporter struct{ contacts []ContactFields }

func (s *stubContactImporter) ImportContact(_ context.Context, _, _ string, f ContactFields) error {
	s.contacts = append(s.contacts, f)
	return nil
}

type stubEventImporter struct{ events []EventFields }

func (s *stubEventImporter) ImportEvent(_ context.Context, _, _ string, f EventFields) error {
	s.events = append(s.events, f)
	return nil
}

type stubFileImporter struct{ files []string }

func (s *stubFileImporter) ImportFile(_ context.Context, _, _, _, name, _ string, _ int64, r io.Reader) error {
	s.files = append(s.files, name)
	return nil
}

// ---- vCard parsing ---------------------------------------------------------

func TestParseVCard_Basic(t *testing.T) {
	card := `BEGIN:VCARD
VERSION:3.0
FN:Jane Doe
N:Doe;Jane;;;
ORG:Acme Corp
TITLE:Engineer
EMAIL;TYPE=INTERNET:jane@example.com
TEL;TYPE=CELL:+1-555-0123
NOTE:Test note
CATEGORIES:Work,Friends
END:VCARD`

	f := parseVCard(card)
	if f.DisplayName != "Jane Doe" {
		t.Errorf("DisplayName = %q", f.DisplayName)
	}
	if f.FirstName != "Jane" {
		t.Errorf("FirstName = %q", f.FirstName)
	}
	if f.LastName != "Doe" {
		t.Errorf("LastName = %q", f.LastName)
	}
	if f.Company != "Acme Corp" {
		t.Errorf("Company = %q", f.Company)
	}
	if len(f.Emails) != 1 || f.Emails[0] != "jane@example.com" {
		t.Errorf("Emails = %v", f.Emails)
	}
	if len(f.Labels) != 2 {
		t.Errorf("Labels = %v", f.Labels)
	}
}

func TestSplitVCards_Multi(t *testing.T) {
	multi := `BEGIN:VCARD
FN:Alice
END:VCARD
BEGIN:VCARD
FN:Bob
END:VCARD`
	cards := splitVCards(strings.NewReader(multi))
	if len(cards) != 2 {
		t.Fatalf("got %d cards, want 2", len(cards))
	}
}

// ---- ICS import dispatch --------------------------------------------------

func TestImportCalendar_Dispatch(t *testing.T) {
	const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:x@x
SUMMARY:Meeting
DTSTART:20240601T100000Z
DTEND:20240601T110000Z
END:VEVENT
END:VCALENDAR`

	ci := &stubContactImporter{}
	ei := &stubEventImporter{}
	fi := &stubFileImporter{}

	// stub repo — nil pool is fine because we call methods directly
	orch := &Orchestrator{contacts: ci, calendar: ei, drive: fi}

	entries := []EntryInfo{{Path: "calendar.ics", Size: int64(len(ics))}}
	openFn := func(p string) (io.ReadCloser, int64, error) {
		return io.NopCloser(strings.NewReader(ics)), int64(len(ics)), nil
	}
	n, _, status := orch.importCalendar(context.Background(), "org1", "user1", entries, openFn)
	if n != 1 {
		t.Errorf("imported = %d, want 1", n)
	}
	if status != ItemDone {
		t.Errorf("status = %q, want %q", status, ItemDone)
	}
	if len(ei.events) != 1 {
		t.Fatalf("events recorded = %d", len(ei.events))
	}
	if ei.events[0].Title != "Meeting" {
		t.Errorf("Title = %q", ei.events[0].Title)
	}
	wantStart := time.Date(2024, 6, 1, 10, 0, 0, 0, time.UTC)
	if !ei.events[0].StartAt.Equal(wantStart) {
		t.Errorf("StartAt = %v, want %v", ei.events[0].StartAt, wantStart)
	}
}

func TestReportPhotos(t *testing.T) {
	orch := &Orchestrator{}
	entries := []EntryInfo{
		{Path: "Google Photos/photo1.jpg"},
		{Path: "Google Photos/photo2.jpg"},
	}
	n, detail, status := orch.reportPhotos(entries)
	if n != 2 {
		t.Errorf("n = %d, want 2", n)
	}
	if status != ItemSkipped {
		t.Errorf("status = %q, want %q", status, ItemSkipped)
	}
	if !strings.Contains(detail, "Immich") {
		t.Errorf("detail should mention Immich: %q", detail)
	}
}
