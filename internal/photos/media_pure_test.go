package photos

import (
	"strings"
	"testing"
)

// TestIsImage covers content-type sniffing used to reject non-image uploads.
func TestIsImage(t *testing.T) {
	tests := []struct {
		name string
		ct   string
		want bool
	}{
		{"jpeg", "image/jpeg", true},
		{"png", "image/png", true},
		{"gif", "image/gif", true},
		{"webp", "image/webp", true},
		{"uppercase", "IMAGE/PNG", true},
		{"mixed case", "Image/Jpeg", true},
		{"with params", "image/jpeg; charset=binary", true},
		{"empty", "", false},
		{"octet-stream", "application/octet-stream", false},
		{"text", "text/plain", false},
		{"video", "video/mp4", false},
		{"pdf", "application/pdf", false},
		{"image substring not prefix", "x-image/png", false},
		{"just image word", "imagexyz", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isImage(tt.ct); got != tt.want {
				t.Errorf("isImage(%q) = %v, want %v", tt.ct, got, tt.want)
			}
		})
	}
}

// TestPhotoID covers id extraction from the content download path.
func TestPhotoID(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"valid", "/api/v1/photos/abc123/content", "abc123", true},
		{"valid uuid", "/api/v1/photos/00000000-0000-0000-0000-000000000000/content",
			"00000000-0000-0000-0000-000000000000", true},
		{"missing prefix", "/photos/abc/content", "", false},
		{"missing suffix", "/api/v1/photos/abc123", "", false},
		{"wrong suffix", "/api/v1/photos/abc123/raw", "", false},
		{"empty id", "/api/v1/photos//content", "", false},
		{"id with slash (nested)", "/api/v1/photos/a/b/content", "", false},
		// "/api/v1/photos/content": prefix trims to "content", which has no
		// "/content" suffix to trim, so the id is literally "content" (valid).
		{"prefix then content word", "/api/v1/photos/content", "content", true},
		{"empty path", "", "", false},
		{"different api version", "/api/v2/photos/abc/content", "", false},
		{"trailing extra", "/api/v1/photos/abc/content/extra", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, gotOK := PhotoID(tt.path)
			if gotID != tt.wantID || gotOK != tt.wantOK {
				t.Errorf("PhotoID(%q) = (%q, %v), want (%q, %v)",
					tt.path, gotID, gotOK, tt.wantID, tt.wantOK)
			}
		})
	}
}

// TestRandKey verifies blob keys are namespaced, well-formed, and unique.
func TestRandKey(t *testing.T) {
	const prefix = "photos/"
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		k := randKey()
		if !strings.HasPrefix(k, prefix) {
			t.Fatalf("randKey() = %q, want prefix %q", k, prefix)
		}
		hexPart := strings.TrimPrefix(k, prefix)
		if len(hexPart) != 32 { // 16 bytes hex-encoded
			t.Fatalf("randKey() hex part = %q, want 32 chars", hexPart)
		}
		for _, c := range hexPart {
			if !strings.ContainsRune("0123456789abcdef", c) {
				t.Fatalf("randKey() = %q has non-hex char %q", k, c)
			}
		}
		if seen[k] {
			t.Fatalf("randKey() produced duplicate %q", k)
		}
		seen[k] = true
	}
}
