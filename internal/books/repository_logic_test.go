package books

// repository_logic_test.go — unit tests for the pure helpers in repository.go
// that don't need a database (format validation, HasCover).

import "testing"

func TestFormatSupported(t *testing.T) {
	cases := []struct {
		format string
		want   bool
	}{
		{"epub", true},
		{"pdf", true},
		{"mobi", true},
		{"txt", true},
		{"cbz", true},
		{"doc", false},
		{"", false},
		{"EPUB", false}, // case-sensitive: callers normalize to lowercase first
		{"pdf ", false}, // no trimming done here
	}
	for _, c := range cases {
		t.Run(c.format, func(t *testing.T) {
			if got := FormatSupported(c.format); got != c.want {
				t.Errorf("FormatSupported(%q) = %v, want %v", c.format, got, c.want)
			}
		})
	}
}

func TestSupportedFormats_NonEmptyAndAllValid(t *testing.T) {
	if len(SupportedFormats) == 0 {
		t.Fatal("SupportedFormats is empty")
	}
	for _, f := range SupportedFormats {
		if !FormatSupported(f) {
			t.Errorf("SupportedFormats lists %q but FormatSupported rejects it", f)
		}
	}
}

func TestBook_HasCover(t *testing.T) {
	key := "books/cover/abc"
	empty := ""
	cases := []struct {
		name string
		book Book
		want bool
	}{
		{"nil cover key", Book{}, false},
		{"empty cover key", Book{CoverKey: &empty}, false},
		{"set cover key", Book{CoverKey: &key}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.book.HasCover(); got != c.want {
				t.Errorf("HasCover() = %v, want %v", got, c.want)
			}
		})
	}
}
