package meet

import (
	"strings"
	"testing"
)

func TestGenerateCode_Format(t *testing.T) {
	code, err := GenerateCode()
	if err != nil {
		t.Fatalf("GenerateCode: %v", err)
	}
	if !ValidCode(code) {
		t.Errorf("generated code %q does not match xxx-xxxx-xxx pattern", code)
	}
	parts := strings.Split(code, "-")
	if len(parts) != 3 {
		t.Fatalf("expected 3 parts, got %d: %q", len(parts), code)
	}
	if len(parts[0]) != 3 || len(parts[1]) != 4 || len(parts[2]) != 3 {
		t.Errorf("segment lengths: got %d-%d-%d, want 3-4-3", len(parts[0]), len(parts[1]), len(parts[2]))
	}
}

func TestGenerateCode_AlphabetOnly(t *testing.T) {
	for range 50 {
		code, err := GenerateCode()
		if err != nil {
			t.Fatalf("GenerateCode: %v", err)
		}
		plain := strings.ReplaceAll(code, "-", "")
		for _, ch := range plain {
			if !strings.ContainsRune(codeAlphabet, ch) {
				t.Errorf("code %q contains character %q not in alphabet", code, ch)
			}
			// Ambiguous chars should never appear.
			if ch == 'l' || ch == 'o' || ch == 'i' {
				t.Errorf("code %q contains ambiguous character %q", code, ch)
			}
		}
	}
}

func TestGenerateCode_Uniqueness(t *testing.T) {
	const n = 1000
	seen := make(map[string]struct{}, n)
	for range n {
		code, err := GenerateCode()
		if err != nil {
			t.Fatalf("GenerateCode: %v", err)
		}
		if _, dup := seen[code]; dup {
			t.Errorf("duplicate code %q among %d generated", code, n)
		}
		seen[code] = struct{}{}
	}
}

func TestValidCode(t *testing.T) {
	tests := []struct {
		code  string
		valid bool
	}{
		{"abc-defg-hij", true},
		{"zzz-zzzz-zzz", true},
		{"aaa-bbbb-ccc", true},
		{"", false},
		{"abc-def-hij", false},   // middle segment too short
		{"abc-defgh-ij", false},  // middle segment too long
		{"ab-defg-hij", false},   // first segment too short
		{"abcd-defg-hij", false}, // first segment too long
		{"ABC-DEFG-HIJ", false},  // uppercase not valid
		{"abc-defg-hi1", false},  // digit not in alphabet
		{"abc-defg-hij-", false}, // trailing dash
	}
	for _, tt := range tests {
		got := ValidCode(tt.code)
		if got != tt.valid {
			t.Errorf("ValidCode(%q): got %v, want %v", tt.code, got, tt.valid)
		}
	}
}
