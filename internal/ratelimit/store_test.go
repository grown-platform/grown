package ratelimit

import (
	"context"
	"strings"
	"testing"
)

// TestNewStoreNilPool: a nil pool yields a nil *Store on which every method is a
// tolerated no-op.
func TestNewStoreNilPool(t *testing.T) {
	if s := NewStore(nil); s != nil {
		t.Fatalf("NewStore(nil) = %v, want nil *Store", s)
	}
}

// TestNilStoreMethodsAreNoOps exercises the nil-receiver fast paths so the
// observability surface is simply absent (never panicking, never erroring) when
// no DB is configured.
func TestNilStoreMethodsAreNoOps(t *testing.T) {
	var s *Store // nil
	ctx := context.Background()

	s.Record(Block{IP: "1.2.3.4"}) // must not panic

	recent, err := s.ListRecent(ctx, 50)
	if err != nil {
		t.Errorf("nil ListRecent err = %v, want nil", err)
	}
	if recent == nil || len(recent) != 0 {
		t.Errorf("nil ListRecent = %v, want empty non-nil slice", recent)
	}

	off := s.TopOffenders(ctx, 10)
	if off == nil || len(off) != 0 {
		t.Errorf("nil TopOffenders = %v, want empty non-nil slice", off)
	}

	c := s.CountSummary(ctx)
	if c != (Counts{}) {
		t.Errorf("nil CountSummary = %+v, want zero Counts", c)
	}
}

// TestWithStore wires a (nil) store onto a limiter and returns rl for chaining.
func TestWithStore(t *testing.T) {
	rl := &RateLimiter{settings: Settings{Enabled: true}}
	got := rl.WithStore(nil)
	if got != rl {
		t.Error("WithStore should return the receiver for chaining")
	}
	if rl.store != nil {
		t.Error("WithStore(nil) should leave store nil")
	}
}

func TestClip(t *testing.T) {
	tests := []struct {
		name   string
		in     string
		wantLn int
	}{
		{"short unchanged", "hello", 5},
		{"empty", "", 0},
		{"exactly max", strings.Repeat("x", maxField), maxField},
		{"over max truncated", strings.Repeat("y", maxField+500), maxField},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := clip(tc.in)
			if len(got) != tc.wantLn {
				t.Errorf("clip len = %d, want %d", len(got), tc.wantLn)
			}
			if len(tc.in) <= maxField && got != tc.in {
				t.Errorf("clip altered an in-bounds string: %q -> %q", tc.in, got)
			}
		})
	}
}
