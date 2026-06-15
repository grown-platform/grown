package audit

import (
	"context"
	"testing"
)

func TestRecorder_NilSafety(t *testing.T) {
	// A nil *Recorder must not panic.
	var nilRec *Recorder
	nilRec.Record(context.Background(), Event{OrgID: "o"})

	// A Recorder with a nil repo is a no-op.
	rec := NewRecorder(nil, nil)
	rec.Record(context.Background(), Event{OrgID: "o"})

	// A Recorder over a Repository whose pool is nil is also a no-op (no panic).
	rec2 := NewRecorder(NewRepository(nil), nil)
	rec2.Record(context.Background(), Event{OrgID: "o", Service: "video", Action: "create"})
}

// TestRecorder_ResolverFillsBlanks verifies the resolver populates org/actor/
// email only when the event does not already carry them. We can't observe the
// (nil-pool) insert, so we assert on the resolver invocation and short-circuit
// behavior instead: the resolver IS consulted, and an event lacking an org is
// dropped when the resolver yields ok=false.
func TestRecorder_ResolverConsultedAndOrgGate(t *testing.T) {
	cases := []struct {
		name       string
		event      Event
		actor      Actor
		resolverOK bool
		wantCalled bool
	}{
		{
			name:       "resolver consulted to fill org",
			event:      Event{Service: "video", Action: "create"},
			actor:      Actor{OrgID: "org-1", UserID: "u1", Email: "a@b.com"},
			resolverOK: true,
			wantCalled: true,
		},
		{
			name:       "resolver consulted even when event has org",
			event:      Event{OrgID: "pre", Service: "video", Action: "create"},
			actor:      Actor{OrgID: "org-1"},
			resolverOK: true,
			wantCalled: true,
		},
		{
			name:       "resolver not-ok leaves blanks => dropped silently",
			event:      Event{Service: "video", Action: "create"},
			resolverOK: false,
			wantCalled: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			called := false
			resolve := ActorResolver(func(context.Context) (Actor, bool) {
				called = true
				return c.actor, c.resolverOK
			})
			rec := NewRecorder(NewRepository(nil), resolve)
			rec.Record(context.Background(), c.event)
			if called != c.wantCalled {
				t.Errorf("resolver called = %v, want %v", called, c.wantCalled)
			}
		})
	}
}

// TestRecorder_NilRepo_SkipsResolver confirms the nil-repo short-circuit happens
// BEFORE the resolver runs (Record returns early).
func TestRecorder_NilRepo_SkipsResolver(t *testing.T) {
	called := false
	rec := NewRecorder(nil, func(context.Context) (Actor, bool) {
		called = true
		return Actor{OrgID: "o"}, true
	})
	rec.Record(context.Background(), Event{Service: "video"})
	if called {
		t.Error("resolver should not be consulted when repo is nil")
	}
}
