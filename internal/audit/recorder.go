package audit

import (
	"context"
	"log"
)

// Actor is the minimal caller identity the recorder needs. server.go resolves
// it from auth.UserFromContext / auth.OrgFromContext via an injected closure,
// keeping this package free of internal/auth (and its gen/ dependency) so it
// builds and tests standalone — the same decoupling internal/adminusers and
// internal/zitadelproxy use.
type Actor struct {
	OrgID  string
	UserID string
	Email  string
}

// ActorResolver pulls the caller's org/user/email off the request context, and
// reports whether an org was resolvable (the minimum needed to record an event).
type ActorResolver func(ctx context.Context) (Actor, bool)

// Recorder writes audit events best-effort. Resolution of the caller is
// delegated to an injected ActorResolver so the package stays decoupled from
// internal/auth.
type Recorder struct {
	repo    *Repository
	resolve ActorResolver
}

// NewRecorder constructs a Recorder. A nil repo or resolver makes Record a
// no-op (so audit can be disabled by simply not wiring a repo).
func NewRecorder(repo *Repository, resolve ActorResolver) *Recorder {
	return &Recorder{repo: repo, resolve: resolve}
}

// Record persists one event, filling actor/org from the context resolver when
// the event doesn't already carry them. It is BEST-EFFORT: it never blocks the
// caller's request path on the insert failing, and it swallows (logs) errors so
// auditing can never break a user action. Events with no resolvable org are
// dropped (we can't scope them).
//
// The insert runs synchronously but the surrounding interceptor/middleware call
// Record only AFTER the handler has produced its response, so the user-visible
// latency is already incurred; we simply add the (small) write. Errors are
// logged and discarded.
func (r *Recorder) Record(ctx context.Context, e Event) {
	if r == nil || r.repo == nil {
		return
	}
	if r.resolve != nil {
		if a, ok := r.resolve(ctx); ok {
			if e.OrgID == "" {
				e.OrgID = a.OrgID
			}
			if e.ActorID == "" {
				e.ActorID = a.UserID
			}
			if e.ActorEmail == "" {
				e.ActorEmail = a.Email
			}
		}
	}
	if e.OrgID == "" {
		// No org context (e.g. an unauthenticated or pre-auth request) — nothing
		// to scope the row to, so drop it silently.
		return
	}
	if err := r.repo.Insert(ctx, e); err != nil {
		log.Printf("audit: record %s/%s failed: %v", e.Service, e.Action, err)
	}
}
