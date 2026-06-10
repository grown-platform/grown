package drive

import "testing"

func TestCopyName(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"report.pdf", "report (copy).pdf"},
		{"photo.JPEG", "photo (copy).JPEG"},
		{"archive.tar.gz", "archive.tar (copy).gz"},
		{"README", "README (copy)"},
		{"notes", "notes (copy)"},
		// Leading dot = dotfile with no extension; suffix goes at the end.
		{".gitignore", ".gitignore (copy)"},
		{"", " (copy)"},
	}
	for _, c := range cases {
		if got := copyName(c.in); got != c.want {
			t.Errorf("copyName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
