package music

import (
	"strings"
	"testing"
)

func TestTrimExt(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"simple mp3", "song.mp3", "song"},
		{"multiple dots", "my.cool.song.flac", "my.cool.song"},
		{"no extension", "song", "song"},
		{"trailing dot", "song.", "song"},
		{"leading dot only", ".gitignore", ".gitignore"},
		{"empty", "", ""},
		{"path-like", "a.b.c", "a.b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := trimExt(tt.in); got != tt.want {
				t.Errorf("trimExt(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestTrackID(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"valid", "/api/v1/music/abc123/content", "abc123", true},
		{"uuid", "/api/v1/music/00000000-0000-0000-0000-000000000000/content", "00000000-0000-0000-0000-000000000000", true},
		{"missing prefix", "/music/abc123/content", "", false},
		{"missing suffix", "/api/v1/music/abc123", "", false},
		{"wrong suffix", "/api/v1/music/abc123/stream", "", false},
		{"empty id", "/api/v1/music//content", "", false},
		{"id with slash", "/api/v1/music/a/b/content", "", false},
		{"single segment is treated as id", "/api/v1/music/content", "content", true},
		{"unrelated path", "/api/v1/other/abc/content", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := TrackID(tt.path)
			if ok != tt.wantOK || id != tt.wantID {
				t.Errorf("TrackID(%q) = (%q, %v), want (%q, %v)", tt.path, id, ok, tt.wantID, tt.wantOK)
			}
		})
	}
}

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"clean", "My Song", "My Song"},
		{"slash", "AC/DC", "AC_DC"},
		{"backslash", "a\\b", "a_b"},
		{"colon", "12:34", "12_34"},
		{"reserved chars", `a*b?c"d<e>f|g`, "a_b_c_d_e_f_g"},
		{"empty becomes track", "", "track"},
		{"whitespace becomes track", "   ", "track"},
		{"trims surrounding space", "  hi  ", "hi"},
		{"unicode preserved", "Café", "Café"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeFilename(tt.in); got != tt.want {
				t.Errorf("sanitizeFilename(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestExtFor(t *testing.T) {
	tests := []struct {
		name string
		ct   string
		want string
	}{
		{"mpeg", "audio/mpeg", ".mp3"},
		{"mp4", "audio/mp4", ".m4a"},
		{"aac", "audio/aac", ".m4a"},
		{"ogg", "audio/ogg", ".ogg"},
		{"flac", "audio/flac", ".flac"},
		{"wav", "audio/wav", ".wav"},
		{"x-wav variant", "audio/x-wav", ".wav"},
		{"unknown", "application/octet-stream", ""},
		{"empty", "", ""},
		{"with params", "audio/mpeg; charset=utf-8", ".mp3"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extFor(tt.ct); got != tt.want {
				t.Errorf("extFor(%q) = %q, want %q", tt.ct, got, tt.want)
			}
		})
	}
}

func TestRandKey(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		k := randKey()
		if !strings.HasPrefix(k, "music/") {
			t.Fatalf("randKey() = %q, want music/ prefix", k)
		}
		// 16 bytes hex-encoded = 32 chars after the "music/" prefix.
		if hex := strings.TrimPrefix(k, "music/"); len(hex) != 32 {
			t.Fatalf("randKey() hex part = %q (len %d), want 32", hex, len(hex))
		}
		if seen[k] {
			t.Fatalf("randKey() produced duplicate %q", k)
		}
		seen[k] = true
	}
}
