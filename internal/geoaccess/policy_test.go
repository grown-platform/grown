package geoaccess

import (
	"context"
	"reflect"
	"testing"
)

func TestPolicyAllows(t *testing.T) {
	cases := []struct {
		name      string
		mode      string
		countries []string
		country   string
		want      bool
	}{
		// Mode off ignores the country entirely.
		{"off allows listed", ModeOff, []string{"US"}, "US", true},
		{"off allows unlisted", ModeOff, []string{"US"}, "DE", true},
		{"off allows empty country", ModeOff, nil, "", true},

		// Unknown / empty / Tor countries always pass (fail-open).
		{"block empty country", ModeBlock, []string{"US"}, "", true},
		{"block XX unknown", ModeBlock, []string{"US"}, "XX", true},
		{"block T1 tor", ModeBlock, []string{"T1"}, "T1", true},
		{"allow empty country", ModeAllow, []string{"US"}, "", true},
		{"allow XX unknown", ModeAllow, []string{"US"}, "XX", true},
		{"allow T1 tor", ModeAllow, []string{"US"}, "T1", true},

		// Blocklist: listed countries denied, everything else allowed.
		{"block denies listed", ModeBlock, []string{"US", "DE"}, "US", false},
		{"block denies other listed", ModeBlock, []string{"US", "DE"}, "DE", false},
		{"block allows unlisted", ModeBlock, []string{"US", "DE"}, "FR", true},
		{"block empty list allows all", ModeBlock, nil, "US", true},

		// Allowlist: only listed countries allowed, everything else denied.
		{"allow permits listed", ModeAllow, []string{"US", "DE"}, "US", true},
		{"allow denies unlisted", ModeAllow, []string{"US", "DE"}, "FR", false},
		{"allow empty list denies all known", ModeAllow, nil, "US", false},

		// Case-insensitivity and whitespace normalization of the header value.
		{"block lowercase header", ModeBlock, []string{"US"}, "us", false},
		{"allow padded header", ModeAllow, []string{"US"}, "  us  ", true},

		// Unrecognized mode fails open.
		{"unknown mode fails open", "weird", []string{"US"}, "US", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := Policy{Mode: c.mode, Countries: c.countries}
			if got := p.Allows(c.country); got != c.want {
				t.Errorf("Policy{mode:%q countries:%v}.Allows(%q) = %v, want %v",
					c.mode, c.countries, c.country, got, c.want)
			}
		})
	}
}

func TestNormalizeCountries(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"nil yields empty non-nil", nil, []string{}},
		{"empty yields empty non-nil", []string{}, []string{}},
		{"uppercases", []string{"us", "de"}, []string{"US", "DE"}},
		{"trims whitespace", []string{"  us  ", "\tde\n"}, []string{"US", "DE"}},
		{"drops blanks", []string{"US", "", "  ", "DE"}, []string{"US", "DE"}},
		{"de-duplicates", []string{"US", "us", "US"}, []string{"US"}},
		{"preserves first-seen order", []string{"de", "us", "DE", "fr"}, []string{"DE", "US", "FR"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := NormalizeCountries(c.in)
			if got == nil {
				t.Fatal("NormalizeCountries returned nil; must be non-nil")
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("NormalizeCountries(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestValidMode(t *testing.T) {
	valid := []string{ModeOff, ModeBlock, ModeAllow}
	for _, m := range valid {
		if !ValidMode(m) {
			t.Errorf("ValidMode(%q) = false, want true", m)
		}
	}
	invalid := []string{"", "OFF", "Block", "deny", "allowlist", "xyz"}
	for _, m := range invalid {
		if ValidMode(m) {
			t.Errorf("ValidMode(%q) = true, want false", m)
		}
	}
}

func TestModeConstants(t *testing.T) {
	if ModeOff != "off" || ModeBlock != "block" || ModeAllow != "allow" {
		t.Fatalf("mode constants drifted: off=%q block=%q allow=%q", ModeOff, ModeBlock, ModeAllow)
	}
}

// A nil *Store is a valid no-DB configuration: LoadPolicy returns the inert
// default and SetPolicy is a no-op (never errors).
func TestNilStoreFailsOpen(t *testing.T) {
	var s *Store // nil
	p := s.LoadPolicy(context.Background())
	if p.Mode != ModeOff {
		t.Errorf("nil store LoadPolicy mode = %q, want %q", p.Mode, ModeOff)
	}
	if p.Countries == nil {
		t.Error("default policy Countries should be non-nil")
	}
	if len(p.Countries) != 0 {
		t.Errorf("default policy Countries = %v, want empty", p.Countries)
	}
	if err := s.SetPolicy(context.Background(), ModeBlock, []string{"US"}, "admin@x"); err != nil {
		t.Errorf("nil store SetPolicy should be a no-op, got err: %v", err)
	}
}

func TestNewStoreNilPool(t *testing.T) {
	if got := NewStore(nil); got != nil {
		t.Errorf("NewStore(nil) = %v, want nil", got)
	}
}

func TestDefaultPolicyIsInert(t *testing.T) {
	p := defaultPolicy()
	if p.Mode != ModeOff {
		t.Errorf("defaultPolicy mode = %q, want off", p.Mode)
	}
	// Inert: must allow any country.
	for _, c := range []string{"US", "DE", "CN", "", "XX"} {
		if !p.Allows(c) {
			t.Errorf("defaultPolicy must allow %q", c)
		}
	}
}
