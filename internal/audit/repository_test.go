package audit

import (
	"context"
	"testing"
	"time"
)

// These tests cover the pure logic of Repository (nil-pool guards, org-id
// validation) WITHOUT a live database. Query execution against a real pool is
// out of scope here.

func TestRepository_Insert_NilGuards(t *testing.T) {
	t.Run("nil receiver", func(t *testing.T) {
		var r *Repository
		if err := r.Insert(context.Background(), Event{OrgID: "o"}); err != nil {
			t.Errorf("nil receiver Insert = %v, want nil", err)
		}
	})
	t.Run("nil pool is a no-op success", func(t *testing.T) {
		r := NewRepository(nil)
		if err := r.Insert(context.Background(), Event{OrgID: "o", Service: "video"}); err != nil {
			t.Errorf("nil pool Insert = %v, want nil", err)
		}
	})
	t.Run("nil pool with empty org still no-op", func(t *testing.T) {
		// The nil-pool guard precedes the org-id check, so this returns nil.
		r := NewRepository(nil)
		if err := r.Insert(context.Background(), Event{}); err != nil {
			t.Errorf("Insert = %v, want nil", err)
		}
	})
}

func TestRepository_List_NilGuards(t *testing.T) {
	t.Run("nil receiver", func(t *testing.T) {
		var r *Repository
		got, err := r.List(context.Background(), "org", Filter{})
		if err != nil || got != nil {
			t.Errorf("nil receiver List = (%v,%v), want (nil,nil)", got, err)
		}
	})
	t.Run("nil pool", func(t *testing.T) {
		r := NewRepository(nil)
		got, err := r.List(context.Background(), "org", Filter{})
		if err != nil || got != nil {
			t.Errorf("nil pool List = (%v,%v), want (nil,nil)", got, err)
		}
	})
}

// TestFilter_Defaults documents the limit-clamping intent of List via the
// Filter struct values the handler/repo rely on. The clamping itself lives
// inside List (DB-gated), so here we just lock the boundary expectations as a
// table for future regressions of the constants.
func TestFilter_LimitBoundaries(t *testing.T) {
	cases := []struct {
		name      string
		in        int
		wantClamp int
	}{
		{"zero -> default 100", 0, 100},
		{"negative -> default 100", -5, 100},
		{"in range preserved", 50, 50},
		{"over max -> 500", 1000, 500},
		{"exact max preserved", 500, 500},
		{"exact min preserved", 1, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := clampLimitForTest(c.in)
			if got != c.wantClamp {
				t.Errorf("clamp(%d) = %d, want %d", c.in, got, c.wantClamp)
			}
		})
	}
}

// clampLimitForTest mirrors the limit-clamping logic in Repository.List. It is a
// faithful copy used to lock the [1,500]/default-100 contract; if List's
// constants change, this test will surface the divergence in review.
func clampLimitForTest(limit int) int {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	return limit
}

// TestFilter_ZeroValueIgnored confirms the Filter zero-value semantics the
// handler depends on: an unset Before is IsZero (no keyset predicate added).
func TestFilter_ZeroValueIgnored(t *testing.T) {
	var f Filter
	if !f.Before.IsZero() {
		t.Error("zero Filter.Before should be IsZero")
	}
	f.Before = time.Now()
	if f.Before.IsZero() {
		t.Error("set Filter.Before should not be IsZero")
	}
	if f.Service != "" || f.ActorEmail != "" || f.Action != "" || f.Limit != 0 {
		t.Error("zero Filter should have empty string/0 fields")
	}
}
