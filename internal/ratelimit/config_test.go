package ratelimit

import (
	"testing"
)

func TestEnvBool(t *testing.T) {
	tests := []struct {
		name string
		set  bool
		val  string
		def  bool
		want bool
	}{
		{"unset uses default true", false, "", true, true},
		{"unset uses default false", false, "", false, false},
		{"empty uses default", true, "   ", true, true},
		{"explicit true", true, "true", false, true},
		{"explicit false", true, "false", true, false},
		{"numeric 1", true, "1", false, true},
		{"numeric 0", true, "0", true, false},
		{"whitespace trimmed", true, "  true  ", false, true},
		{"invalid uses default", true, "yesplease", true, true},
		{"invalid uses default false", true, "nope", false, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			const key = "GROWN_TEST_RL_BOOL"
			if tc.set {
				t.Setenv(key, tc.val)
			}
			if got := envBool(key, tc.def); got != tc.want {
				t.Errorf("envBool(%q, %v) = %v, want %v", tc.val, tc.def, got, tc.want)
			}
		})
	}
}

func TestEnvFloat(t *testing.T) {
	tests := []struct {
		name string
		set  bool
		val  string
		def  float64
		want float64
	}{
		{"unset uses default", false, "", 30, 30},
		{"empty uses default", true, "   ", 12.5, 12.5},
		{"integer", true, "60", 0, 60},
		{"fractional", true, "0.5", 1, 0.5},
		{"whitespace trimmed", true, "  2.25  ", 0, 2.25},
		{"invalid uses default", true, "fast", 7, 7},
		{"negative parses", true, "-1", 0, -1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			const key = "GROWN_TEST_RL_FLOAT"
			if tc.set {
				t.Setenv(key, tc.val)
			}
			if got := envFloat(key, tc.def); got != tc.want {
				t.Errorf("envFloat(%q, %v) = %v, want %v", tc.val, tc.def, got, tc.want)
			}
		})
	}
}

// TestFromEnvDefaults verifies the documented default tuning is applied when no
// env vars are set, and that Settings reflects the active config.
func TestFromEnvDefaults(t *testing.T) {
	// Force a clean slate so any ambient values don't leak in.
	for _, k := range []string{
		"GROWN_RATELIMIT_ENABLED", "GROWN_RATELIMIT_RPS", "GROWN_RATELIMIT_BURST",
		"GROWN_RATELIMIT_AUTH_RPS", "GROWN_RATELIMIT_AUTH_BURST",
	} {
		t.Setenv(k, "")
	}
	rl := FromEnv()
	s := rl.Settings()
	if !s.Enabled {
		t.Error("Enabled should default to true")
	}
	if s.GeneralRPS != 30 || s.GeneralBurst != 60 {
		t.Errorf("general defaults = %v/%v, want 30/60", s.GeneralRPS, s.GeneralBurst)
	}
	if s.AuthRPS != 0.5 || s.AuthBurst != 10 {
		t.Errorf("auth defaults = %v/%v, want 0.5/10", s.AuthRPS, s.AuthBurst)
	}
	if s.KeyBy != "ip" {
		t.Errorf("KeyBy = %q, want ip", s.KeyBy)
	}
	// The limiters should be wired with the same rates.
	if rl.general.rate != 30 || rl.general.burst != 60 {
		t.Errorf("general limiter = %v/%v, want 30/60", rl.general.rate, rl.general.burst)
	}
	if rl.auth.rate != 0.5 || rl.auth.burst != 10 {
		t.Errorf("auth limiter = %v/%v, want 0.5/10", rl.auth.rate, rl.auth.burst)
	}
}

// TestFromEnvOverrides verifies env vars override the defaults.
func TestFromEnvOverrides(t *testing.T) {
	t.Setenv("GROWN_RATELIMIT_ENABLED", "false")
	t.Setenv("GROWN_RATELIMIT_RPS", "5")
	t.Setenv("GROWN_RATELIMIT_BURST", "9")
	t.Setenv("GROWN_RATELIMIT_AUTH_RPS", "0.25")
	t.Setenv("GROWN_RATELIMIT_AUTH_BURST", "3")

	rl := FromEnv()
	s := rl.Settings()
	if s.Enabled {
		t.Error("Enabled should be false when GROWN_RATELIMIT_ENABLED=false")
	}
	if s.GeneralRPS != 5 || s.GeneralBurst != 9 {
		t.Errorf("general = %v/%v, want 5/9", s.GeneralRPS, s.GeneralBurst)
	}
	if s.AuthRPS != 0.25 || s.AuthBurst != 3 {
		t.Errorf("auth = %v/%v, want 0.25/3", s.AuthRPS, s.AuthBurst)
	}
}
