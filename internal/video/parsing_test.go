package video

import "testing"

// These tests exercise the pure path-parsing and filename helpers in http.go.
// They require no database or blob store.

func TestVideoID(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		wantID  string
		wantOK  bool
	}{
		{"valid", "/api/v1/videos/abc123/content", "abc123", true},
		{"valid uuid", "/api/v1/videos/00000000-0000-0000-0000-000000000000/content", "00000000-0000-0000-0000-000000000000", true},
		{"missing prefix", "/videos/abc/content", "", false},
		{"missing suffix", "/api/v1/videos/abc123", "", false},
		{"empty id", "/api/v1/videos//content", "", false},
		{"id with slash", "/api/v1/videos/a/b/content", "", false},
		{"shared path is not a video content path", "/api/v1/videos/shared/tok/content", "", false},
		{"caption path rejected (extra segment)", "/api/v1/videos/captions/cid/content", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := VideoID(tt.path)
			if id != tt.wantID || ok != tt.wantOK {
				t.Errorf("VideoID(%q) = (%q, %v), want (%q, %v)", tt.path, id, ok, tt.wantID, tt.wantOK)
			}
		})
	}
}

func TestSharedTokenID(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantT  string
		wantOK bool
	}{
		{"valid", "/api/v1/videos/shared/deadbeef", "deadbeef", true},
		{"missing prefix", "/api/v1/videos/deadbeef", "", false},
		{"empty token", "/api/v1/videos/shared/", "", false},
		{"content variant rejected", "/api/v1/videos/shared/deadbeef/content", "", false},
		{"token with slash", "/api/v1/videos/shared/a/b", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tok, ok := SharedTokenID(tt.path)
			if tok != tt.wantT || ok != tt.wantOK {
				t.Errorf("SharedTokenID(%q) = (%q, %v), want (%q, %v)", tt.path, tok, ok, tt.wantT, tt.wantOK)
			}
		})
	}
}

func TestSharedContentToken(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantT  string
		wantOK bool
	}{
		{"valid", "/api/v1/videos/shared/deadbeef/content", "deadbeef", true},
		{"missing suffix", "/api/v1/videos/shared/deadbeef", "", false},
		{"missing prefix", "/videos/shared/deadbeef/content", "", false},
		{"empty token", "/api/v1/videos/shared//content", "", false},
		{"token with extra slash", "/api/v1/videos/shared/a/b/content", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tok, ok := SharedContentToken(tt.path)
			if tok != tt.wantT || ok != tt.wantOK {
				t.Errorf("SharedContentToken(%q) = (%q, %v), want (%q, %v)", tt.path, tok, ok, tt.wantT, tt.wantOK)
			}
		})
	}
}

func TestCaptionID(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		wantID string
		wantOK bool
	}{
		{"valid", "/api/v1/videos/captions/cap123/content", "cap123", true},
		{"missing prefix", "/api/v1/videos/cap123/content", "", false},
		{"missing suffix", "/api/v1/videos/captions/cap123", "", false},
		{"empty id", "/api/v1/videos/captions//content", "", false},
		{"id with slash", "/api/v1/videos/captions/a/b/content", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := CaptionID(tt.path)
			if id != tt.wantID || ok != tt.wantOK {
				t.Errorf("CaptionID(%q) = (%q, %v), want (%q, %v)", tt.path, id, ok, tt.wantID, tt.wantOK)
			}
		})
	}
}

func TestTrimExt(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"simple ext", "clip.mp4", "clip"},
		{"multi-dot keeps all but last", "my.cool.clip.webm", "my.cool.clip"},
		{"no ext", "clip", "clip"},
		{"leading dot (hidden file) not stripped", ".mp4", ".mp4"},
		{"empty", "", ""},
		{"trailing dot", "clip.", "clip"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := trimExt(tt.in); got != tt.want {
				t.Errorf("trimExt(%q) = %q, want %q", tt.in, got, tt.want)
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
		{"plain", "My Clip", "My Clip"},
		{"slashes replaced", "a/b\\c", "a_b_c"},
		{"all reserved chars", `:*?"<>|`, "_______"},
		{"empty -> default", "", "video"},
		{"whitespace -> default", "   ", "video"},
		{"trimmed", "  hello  ", "hello"},
		{"mixed", "in/valid:name", "in_valid_name"},
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
		{"mp4", "video/mp4", ".mp4"},
		{"webm", "video/webm", ".webm"},
		{"ogg", "video/ogg", ".ogv"},
		{"quicktime", "video/quicktime", ".mov"},
		{"matroska", "video/x-matroska", ".mkv"},
		{"unknown", "application/octet-stream", ""},
		{"empty", "", ""},
		{"substring match anywhere", "something-mp4-ish", ".mp4"},
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
	k1 := randKey()
	k2 := randKey()
	if k1 == k2 {
		t.Errorf("randKey returned identical keys: %q", k1)
	}
	const prefix = "video/"
	if len(k1) <= len(prefix) || k1[:len(prefix)] != prefix {
		t.Errorf("randKey() = %q, want %q prefix", k1, prefix)
	}
	// 16 random bytes -> 32 hex chars after the prefix.
	if want := len(prefix) + 32; len(k1) != want {
		t.Errorf("randKey() len = %d, want %d", len(k1), want)
	}
}

func TestStreamURL(t *testing.T) {
	if got := streamURL("abc"); got != "/api/v1/videos/abc/content" {
		t.Errorf("streamURL = %q", got)
	}
}

func TestCaptionStreamURL(t *testing.T) {
	if got := captionStreamURL("cid"); got != "/api/v1/videos/captions/cid/content" {
		t.Errorf("captionStreamURL = %q", got)
	}
}
