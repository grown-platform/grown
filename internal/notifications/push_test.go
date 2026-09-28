package notifications

import (
	"strings"
	"testing"
	"time"
)

func TestValidatePush(t *testing.T) {
	cases := []struct {
		name, title, msg, link string
		ok                     bool
	}{
		{"minimal", "Doorbell", "", "", true},
		{"relative link", "Hi", "body", "/calendar", true},
		{"https link", "Hi", "", "https://ha.example.com/lovelace/0", true},
		{"http link", "Hi", "", "http://homeassistant.local:8123/", true},
		{"empty title", "", "x", "", false},
		{"blank title", "   ", "x", "", false},
		{"title 200", strings.Repeat("a", 200), "", "", true},
		{"title 201", strings.Repeat("a", 201), "", "", false},
		{"title 200 runes multibyte", strings.Repeat("é", 200), "", "", true},
		{"message 2000", "t", strings.Repeat("m", 2000), "", true},
		{"message 2001", "t", strings.Repeat("m", 2001), "", false},
		{"protocol-relative", "t", "", "//evil.example/x", false},
		{"javascript", "t", "", "javascript:alert(1)", false},
		{"bare word", "t", "", "calendar", false},
		{"ftp", "t", "", "ftp://x/y", false},
		{"no host", "t", "", "https:///path", false},
		{"newline", "t", "", "/a\nb", false},
	}
	for _, c := range cases {
		got := ValidatePush(c.title, c.msg, c.link) == ""
		if got != c.ok {
			t.Errorf("%s: valid=%v want %v (%q)", c.name, got, c.ok, ValidatePush(c.title, c.msg, c.link))
		}
	}
}

func TestRateLimiter(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newRateLimiter(3, time.Minute, func() time.Time { return now })
	for i := 0; i < 3; i++ {
		if !l.allow("u1") {
			t.Fatalf("hit %d denied", i)
		}
	}
	if l.allow("u1") {
		t.Fatal("4th hit in window allowed")
	}
	if !l.allow("u2") {
		t.Fatal("other user limited")
	}
	now = now.Add(61 * time.Second)
	if !l.allow("u1") {
		t.Fatal("not allowed after window elapsed")
	}
}
