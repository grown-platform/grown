package cloudimport

import (
	"testing"
)

func TestDetectEntries_GoogleTakeout(t *testing.T) {
	entries := []EntryInfo{
		{Path: "Takeout/Contacts/All Contacts/contacts.vcf", Size: 1024},
		{Path: "Takeout/Calendar/calendar.ics", Size: 512},
		{Path: "Takeout/Mail/inbox.mbox", Size: 20480},
		{Path: "Takeout/Google Photos/photo.jpg", Size: 2048},
		{Path: "Takeout/Drive/document.pdf", Size: 4096},
		{Path: "Takeout/archive_browser.html", Size: 256},
	}

	det := DetectEntries(entries)

	if det.Source != SourceGoogleTakeout {
		t.Errorf("source = %q, want %q", det.Source, SourceGoogleTakeout)
	}
	if len(det.ByKind[KindContacts]) != 1 {
		t.Errorf("contacts count = %d, want 1", len(det.ByKind[KindContacts]))
	}
	if len(det.ByKind[KindCalendar]) != 1 {
		t.Errorf("calendar count = %d, want 1", len(det.ByKind[KindCalendar]))
	}
	if len(det.ByKind[KindMail]) != 1 {
		t.Errorf("mail count = %d, want 1", len(det.ByKind[KindMail]))
	}
	if len(det.ByKind[KindPhotos]) != 1 {
		t.Errorf("photos count = %d, want 1", len(det.ByKind[KindPhotos]))
	}
	if len(det.ByKind[KindDrive]) != 1 {
		t.Errorf("drive count = %d, want 1", len(det.ByKind[KindDrive]))
	}
}

func TestDetectEntries_SingleVCF(t *testing.T) {
	entries := []EntryInfo{{Path: "contacts.vcf", Size: 512}}
	det := DetectEntries(entries)
	if det.Source != SourceFile {
		t.Errorf("source = %q, want %q", det.Source, SourceFile)
	}
	if len(det.ByKind[KindContacts]) != 1 {
		t.Errorf("contacts count = %d, want 1", len(det.ByKind[KindContacts]))
	}
}

func TestDetectEntries_SingleICS(t *testing.T) {
	entries := []EntryInfo{{Path: "events.ics", Size: 512}}
	det := DetectEntries(entries)
	if len(det.ByKind[KindCalendar]) != 1 {
		t.Errorf("calendar count = %d, want 1", len(det.ByKind[KindCalendar]))
	}
}
