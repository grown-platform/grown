package gamerooms

import (
	"context"
	"testing"
	"time"
)

func TestNewStore_NilPool(t *testing.T) {
	if s := NewStore(nil); s != nil {
		t.Fatalf("NewStore(nil) = %v, want nil *Store", s)
	}
}

// All Store methods must tolerate a nil receiver (no-DB deployments).
func TestStore_NilReceiverTolerance(t *testing.T) {
	var s *Store // nil
	ctx := context.Background()

	if got := s.LoadSettings(ctx); !got.Enabled {
		t.Errorf("nil store LoadSettings should fail open (enabled), got %+v", got)
	}
	if err := s.SetEnabled(ctx, false, "a@x"); err != nil {
		t.Errorf("nil store SetEnabled err = %v, want nil", err)
	}
	// LogEvent on a nil store must not panic and must not spawn a DB goroutine.
	s.LogEvent(AuditEvent{Event: "x"})

	got, err := s.ListAudit(ctx, AuditFilter{})
	if err != nil {
		t.Errorf("nil store ListAudit err = %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("nil store ListAudit should return empty slice, got %v", got)
	}
}

func TestItoa(t *testing.T) {
	tests := []struct {
		in   int
		want string
	}{
		{0, "0"},
		{1, "1"},
		{9, "9"},
		{10, "10"},
		{42, "42"},
		{100, "100"},
		{99999, "99999"},
		{maxRooms, "5000"},
	}
	for _, tc := range tests {
		if got := itoa(tc.in); got != tc.want {
			t.Errorf("itoa(%d) = %q want %q", tc.in, got, tc.want)
		}
	}
}

func TestRFC3339OrEmpty(t *testing.T) {
	if got := rfc3339OrEmpty(time.Time{}); got != "" {
		t.Errorf("zero time should yield empty string, got %q", got)
	}
	ts := time.Date(2026, 6, 15, 12, 30, 0, 0, time.UTC)
	if got := rfc3339OrEmpty(ts); got != "2026-06-15T12:30:00Z" {
		t.Errorf("rfc3339OrEmpty = %q want 2026-06-15T12:30:00Z", got)
	}
}
