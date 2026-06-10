package auth

import (
	"encoding/base64"
	"testing"
)

func TestNewState_FormatAndLength(t *testing.T) {
	s, err := NewState()
	if err != nil {
		t.Fatalf("NewState: %v", err)
	}
	// 24 bytes → 32 chars base64url without padding.
	if len(s) != 32 {
		t.Errorf("len: got %d, want 32 (24 bytes RawURL-encoded)", len(s))
	}
	decoded, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("decode: %v (string was %q)", err, s)
	}
	if len(decoded) != 24 {
		t.Errorf("decoded byte length: got %d, want 24", len(decoded))
	}
}

func TestNewState_Uniqueness(t *testing.T) {
	seen := map[string]struct{}{}
	for i := 0; i < 256; i++ {
		s, err := NewState()
		if err != nil {
			t.Fatalf("NewState: %v", err)
		}
		if _, dup := seen[s]; dup {
			t.Fatalf("collision after %d generations: %s", i+1, s)
		}
		seen[s] = struct{}{}
	}
}

func TestClaims_DisplayName_PrefersName(t *testing.T) {
	c := Claims{Name: "Alice", PreferredName: "alice42", Email: "alice@example.com"}
	if got := c.DisplayName(); got != "Alice" {
		t.Errorf("got %q, want Alice", got)
	}
}

func TestClaims_DisplayName_FallsBackToPreferredName(t *testing.T) {
	c := Claims{PreferredName: "alice42", Email: "alice@example.com"}
	if got := c.DisplayName(); got != "alice42" {
		t.Errorf("got %q, want alice42", got)
	}
}

func TestClaims_DisplayName_FallsBackToEmail(t *testing.T) {
	c := Claims{Email: "alice@example.com"}
	if got := c.DisplayName(); got != "alice@example.com" {
		t.Errorf("got %q, want alice@example.com", got)
	}
}

func TestClaims_DisplayName_AllEmpty(t *testing.T) {
	if got := (Claims{}).DisplayName(); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}
