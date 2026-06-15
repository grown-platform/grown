package tickets

import (
	"strings"
	"testing"
)

// TestNormalizeIntake verifies intake mode is canonicalized to exactly
// "public" or "team", trimming and lowercasing input.
func TestNormalizeIntake(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"public", "public"},
		{"PUBLIC", "public"},
		{"  Public  ", "public"},
		{"team", "team"},
		{"TEAM", "team"},
		{"", "team"},
		{"garbage", "team"},
		{"publicx", "team"},
		{" public", "public"},
	}
	for _, c := range cases {
		if got := normalizeIntake(c.in); got != c.want {
			t.Errorf("normalizeIntake(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestNormalizePriority verifies priority is mapped to the allowed set, with
// anything unrecognized falling back to "normal".
func TestNormalizePriority(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"low", "low"},
		{"LOW", "low"},
		{"  high ", "high"},
		{"HIGH", "high"},
		{"urgent", "urgent"},
		{"Urgent", "urgent"},
		{"normal", "normal"},
		{"", "normal"},
		{"medium", "normal"},
		{"critical", "normal"},
	}
	for _, c := range cases {
		if got := normalizePriority(c.in); got != c.want {
			t.Errorf("normalizePriority(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestNullUUID verifies blank-ish input becomes a nil pointer (NULL in SQL),
// while a real value is returned by pointer unchanged.
func TestNullUUID(t *testing.T) {
	if p := nullUUID(""); p != nil {
		t.Errorf("nullUUID(\"\") = %v, want nil", *p)
	}
	if p := nullUUID("   "); p != nil {
		t.Errorf("nullUUID(spaces) = %v, want nil", *p)
	}
	if p := nullUUID("user-123"); p == nil || *p != "user-123" {
		t.Errorf("nullUUID(\"user-123\") = %v, want pointer to \"user-123\"", p)
	}
}

// TestItoa verifies the local int64 formatter matches expected decimal output,
// including zero and negatives.
func TestItoa(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{0, "0"},
		{1, "1"},
		{7, "7"},
		{42, "42"},
		{1234567890, "1234567890"},
		{-1, "-1"},
		{-256, "-256"},
		{9223372036854775807, "9223372036854775807"},
	}
	for _, c := range cases {
		if got := itoa(c.in); got != c.want {
			t.Errorf("itoa(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestNewToken verifies generated public tokens carry the "pt_" prefix, are
// hex after the prefix, have stable length, and are unique across calls.
func TestNewToken(t *testing.T) {
	seen := map[string]bool{}
	const n = 200
	for i := 0; i < n; i++ {
		tok := newToken()
		if !strings.HasPrefix(tok, "pt_") {
			t.Fatalf("token %q missing pt_ prefix", tok)
		}
		hexPart := strings.TrimPrefix(tok, "pt_")
		// 16 random bytes -> 32 hex chars.
		if len(hexPart) != 32 {
			t.Fatalf("token hex part = %d chars, want 32 (%q)", len(hexPart), tok)
		}
		for _, ch := range hexPart {
			if !strings.ContainsRune("0123456789abcdef", ch) {
				t.Fatalf("token %q has non-hex char %q", tok, ch)
			}
		}
		if seen[tok] {
			t.Fatalf("duplicate token generated: %q", tok)
		}
		seen[tok] = true
	}
}

// TestNewRepositoryNilPool verifies NewRepository returns nil for a nil pool so
// callers can skip wiring the feature cleanly.
func TestNewRepositoryNilPool(t *testing.T) {
	if r := NewRepository(nil); r != nil {
		t.Errorf("NewRepository(nil) = %v, want nil", r)
	}
}

// TestDefaultStatuses guards the starting workflow ordering, which the JSON
// output and UI rely on.
func TestDefaultStatuses(t *testing.T) {
	want := []string{"open", "in_progress", "resolved", "closed"}
	if len(DefaultStatuses) != len(want) {
		t.Fatalf("DefaultStatuses len = %d, want %d", len(DefaultStatuses), len(want))
	}
	for i := range want {
		if DefaultStatuses[i] != want[i] {
			t.Errorf("DefaultStatuses[%d] = %q, want %q", i, DefaultStatuses[i], want[i])
		}
	}
}
