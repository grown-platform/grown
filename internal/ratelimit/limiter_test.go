package ratelimit

import (
	"sync"
	"testing"
	"time"
)

// TestAllowRefillOverTime verifies tokens accrue at `rate` per second and are
// clamped at `burst`, using an injected clock (the now arg to allow).
func TestAllowRefillOverTime(t *testing.T) {
	l := newLimiter(2, 4) // 2 tokens/s, burst 4
	start := time.Unix(0, 0)

	// Drain the initial burst.
	for i := 0; i < 4; i++ {
		if !l.allow("k", start) {
			t.Fatalf("burst token %d should be allowed", i)
		}
	}
	if l.allow("k", start) {
		t.Fatal("bucket should be empty after draining burst")
	}

	// After 1s, 2 tokens refill (rate=2).
	at1 := start.Add(time.Second)
	if !l.allow("k", at1) || !l.allow("k", at1) {
		t.Fatal("two tokens should refill after 1s")
	}
	if l.allow("k", at1) {
		t.Fatal("only two tokens should have refilled after 1s")
	}
}

// TestAllowRefillClampsAtBurst checks a long idle period does not let the
// bucket exceed burst capacity.
func TestAllowRefillClampsAtBurst(t *testing.T) {
	l := newLimiter(5, 3) // 5/s, burst only 3
	start := time.Unix(0, 0)
	if !l.allow("k", start) { // create bucket at full burst, consume 1 → 2 left
		t.Fatal("first token should be allowed")
	}
	// Idle 1000s would refill 5000 tokens but cap is 3.
	far := start.Add(1000 * time.Second)
	for i := 0; i < 3; i++ {
		if !l.allow("k", far) {
			t.Fatalf("token %d should be allowed up to burst cap", i)
		}
	}
	if l.allow("k", far) {
		t.Fatal("tokens must be clamped at burst (3), not unbounded")
	}
}

// TestAllowZeroRateNoRefill verifies a zero-rate limiter never refills: it
// permits exactly `burst` requests for the life of the key.
func TestAllowZeroRateNoRefill(t *testing.T) {
	l := newLimiter(0, 2)
	now := time.Unix(0, 0)
	if !l.allow("k", now) || !l.allow("k", now) {
		t.Fatal("two burst tokens should be allowed")
	}
	// Even far in the future, no refill.
	if l.allow("k", now.Add(time.Hour)) {
		t.Fatal("zero-rate limiter must never refill")
	}
}

// TestAllowTableDriven exercises a sequence of (key, elapsed) calls.
func TestAllowTableDriven(t *testing.T) {
	base := time.Unix(100, 0)
	tests := []struct {
		name     string
		rate     float64
		burst    float64
		seq      []struct {
			key     string
			elapsed time.Duration
		}
		want []bool
	}{
		{
			name:  "burst then deny same instant",
			rate:  1,
			burst: 2,
			seq: []struct {
				key     string
				elapsed time.Duration
			}{
				{"a", 0}, {"a", 0}, {"a", 0},
			},
			want: []bool{true, true, false},
		},
		{
			name:  "two keys independent",
			rate:  1,
			burst: 1,
			seq: []struct {
				key     string
				elapsed time.Duration
			}{
				{"a", 0}, {"b", 0}, {"a", 0}, {"b", 0},
			},
			want: []bool{true, true, false, false},
		},
		{
			name:  "refill restores one token",
			rate:  1,
			burst: 1,
			seq: []struct {
				key     string
				elapsed time.Duration
			}{
				{"a", 0}, {"a", 0}, {"a", time.Second},
			},
			want: []bool{true, false, true},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			l := newLimiter(tc.rate, tc.burst)
			for i, step := range tc.seq {
				got := l.allow(step.key, base.Add(step.elapsed))
				if got != tc.want[i] {
					t.Errorf("step %d (key=%s elapsed=%s): allow=%v, want %v",
						i, step.key, step.elapsed, got, tc.want[i])
				}
			}
		})
	}
}

// TestSweepEvictsIdleKeys verifies sweep drops buckets idle > 10m but keeps
// recently-used ones.
func TestSweepEvictsIdleKeys(t *testing.T) {
	l := newLimiter(1, 1)
	now := time.Unix(0, 0)
	l.allow("stale", now)
	l.allow("fresh", now)

	// Touch "fresh" just before the sweep instant so it is recent.
	sweepAt := now.Add(20 * time.Minute)
	l.allow("fresh", sweepAt)

	l.sweep(sweepAt)

	l.mu.Lock()
	_, staleExists := l.buckets["stale"]
	_, freshExists := l.buckets["fresh"]
	n := len(l.buckets)
	l.mu.Unlock()

	if staleExists {
		t.Error("stale key (idle > 10m) should have been swept")
	}
	if !freshExists {
		t.Error("fresh key (recently used) should be retained")
	}
	if n != 1 {
		t.Errorf("expected 1 bucket after sweep, got %d", n)
	}
}

// TestSweepKeepsBoundaryKey ensures a key idle exactly at the boundary is not
// evicted (the predicate is strictly greater than 10m).
func TestSweepKeepsBoundaryKey(t *testing.T) {
	l := newLimiter(1, 1)
	now := time.Unix(0, 0)
	l.allow("k", now)
	l.sweep(now.Add(10 * time.Minute)) // exactly 10m, not > 10m
	l.mu.Lock()
	_, exists := l.buckets["k"]
	l.mu.Unlock()
	if !exists {
		t.Error("key idle exactly 10m should be retained (predicate is > 10m)")
	}
}

// TestAllowConcurrentRace exercises allow() and sweep() from many goroutines so
// `go test -race` can detect data races on the shared bucket map.
func TestAllowConcurrentRace(t *testing.T) {
	l := newLimiter(1000, 1000)
	now := time.Unix(0, 0)
	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			keys := []string{"a", "b", "c"}
			for i := 0; i < 500; i++ {
				l.allow(keys[i%len(keys)], now.Add(time.Duration(i)*time.Millisecond))
				if i%50 == 0 {
					l.sweep(now.Add(time.Duration(i) * time.Millisecond))
				}
			}
		}(g)
	}
	wg.Wait()
}
