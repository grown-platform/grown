package cloudimport

import "testing"

// ---- detectSource: apple + ordering ---------------------------------------

func TestDetectSource(t *testing.T) {
	tests := []struct {
		name  string
		paths []string
		want  ArchiveSource
	}{
		{"takeout subdir", []string{"foo/Takeout/Contacts/x.vcf"}, SourceGoogleTakeout},
		{"takeout top", []string{"takeout/Calendar/x.ics"}, SourceGoogleTakeout},
		{"apple health dir", []string{"apple_health_export/export.xml"}, SourceApple},
		{"apple library.sqlite", []string{"some/Library.sqlite"}, SourceApple},
		{"plain file", []string{"contacts.vcf", "notes.txt"}, SourceFile},
		{"empty", nil, SourceFile},
		// Google takeout wins when both present (it is checked first per path).
		{"takeout before apple", []string{"Takeout/x", "apple_health/y"}, SourceGoogleTakeout},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detectSource(tt.paths); got != tt.want {
				t.Errorf("detectSource = %q, want %q", got, tt.want)
			}
		})
	}
}

// ---- classifyEntry: edge cases not covered by the happy-path tests ---------

func TestClassifyEntry(t *testing.T) {
	tests := []struct {
		name string
		path string
		want DataKind
	}{
		{"vcf anywhere", "random/dir/foo.vcf", KindContacts},
		{"contacts.csv at root", "contacts.csv", KindContacts},
		{"contacts dir json", "Takeout/Contacts/My Contacts/data.json", KindContacts},
		{"contacts dir csv", "x/contacts/export.csv", KindContacts},
		{"ics anywhere", "deep/path/event.ics", KindCalendar},
		{"calendar dir ical", "Takeout/Calendar/cal.ical", KindCalendar},
		{"mbox", "Mail/inbox.mbox", KindMail},
		{"eml", "Mail/msg.eml", KindMail},
		{"google photos slash", "Takeout/Google Photos/2020/img.jpg", KindPhotos},
		{"photos subfolder media", "x/photos/clip.mp4", KindPhotos},
		{"photos subfolder heic", "x/photos/pic.heic", KindPhotos},
		{"photos subfolder non-media", "x/photos/metadata.json", ""},
		{"drive prefix", "drive/doc.pdf", KindDrive},
		{"drive subdir", "Takeout/Drive/sheet.xlsx", KindDrive},
		{"directory entry", "Takeout/Drive/", ""},
		{"unrecognised metadata", "Takeout/archive_browser.html", ""},
		{"random json no kind", "foo/bar.json", ""},
		{"empty path", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyEntry(tt.path); got != tt.want {
				t.Errorf("classifyEntry(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

// ---- isMediaExt -----------------------------------------------------------

func TestIsMediaExt(t *testing.T) {
	media := []string{"a.jpg", "a.jpeg", "a.png", "a.gif", "a.heic", "a.heif",
		"a.mp4", "a.mov", "a.avi", "a.mkv", "a.webm"}
	for _, m := range media {
		if !isMediaExt(m) {
			t.Errorf("isMediaExt(%q) = false, want true", m)
		}
	}
	// isMediaExt is case-sensitive on the extension (path.Ext, no lowercasing),
	// so an uppercase extension is NOT treated as media.
	notMedia := []string{"a.txt", "a.json", "a.pdf", "noext", "a.tar.gz", "a.JPEG"}
	for _, m := range notMedia {
		if isMediaExt(m) {
			t.Errorf("isMediaExt(%q) = true, want false", m)
		}
	}
}
