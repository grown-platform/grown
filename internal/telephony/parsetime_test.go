package telephony

import (
	"testing"
	"time"
)

func TestParseTime(t *testing.T) {
	fallback := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	valid := "2026-06-15T13:45:30Z"
	wantValid, _ := time.Parse(time.RFC3339, valid)

	tests := []struct {
		name string
		in   string
		want time.Time
	}{
		{"empty uses fallback", "", fallback},
		{"valid rfc3339", valid, wantValid},
		{"garbage uses fallback", "not-a-time", fallback},
		{"date-only (not rfc3339) uses fallback", "2026-06-15", fallback},
		{"unix epoch number uses fallback", "1718456730", fallback},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseTime(tt.in, fallback)
			if !got.Equal(tt.want) {
				t.Errorf("parseTime(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestParseTimePtr(t *testing.T) {
	valid := "2026-06-15T13:45:30Z"
	wantValid, _ := time.Parse(time.RFC3339, valid)

	tests := []struct {
		name    string
		in      string
		wantNil bool
		want    time.Time
	}{
		{"empty is nil", "", true, time.Time{}},
		{"garbage is nil", "nope", true, time.Time{}},
		{"valid returns pointer", valid, false, wantValid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseTimePtr(tt.in)
			if tt.wantNil {
				if got != nil {
					t.Errorf("parseTimePtr(%q) = %v, want nil", tt.in, *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("parseTimePtr(%q) = nil, want %v", tt.in, tt.want)
			}
			if !got.Equal(tt.want) {
				t.Errorf("parseTimePtr(%q) = %v, want %v", tt.in, *got, tt.want)
			}
		})
	}
}
