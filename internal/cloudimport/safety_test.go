package cloudimport

import (
	"testing"
)

func TestSafeArchivePath_Rejects(t *testing.T) {
	bad := []string{
		"../etc/passwd",
		"foo/../../etc/passwd",
		"/etc/passwd",
		"foo/../../../etc/passwd",
	}
	for _, p := range bad {
		_, err := safeArchivePath(p)
		if err == nil {
			t.Errorf("safeArchivePath(%q) should have been rejected", p)
		}
	}
}

func TestSafeArchivePath_Accepts(t *testing.T) {
	good := []string{
		"Takeout/Contacts/contacts.vcf",
		"Drive/folder/file.pdf",
		"some-file.ics",
		"a/b/c/d.mbox",
	}
	for _, p := range good {
		out, err := safeArchivePath(p)
		if err != nil {
			t.Errorf("safeArchivePath(%q) returned error: %v", p, err)
		}
		if out == "" {
			t.Errorf("safeArchivePath(%q) returned empty string", p)
		}
	}
}
