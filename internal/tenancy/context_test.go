package tenancy_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/tenancy"
	"code.pick.haus/grown/grown/internal/users"
)

// TestOrgFromContext exercises the re-exported OrgFromContext over the org
// values that the auth/tenancy middleware stamps onto a request context. The
// security-relevant invariants are: (1) an org attached via auth.WithOrg is
// readable through the tenancy boundary, and (2) a context that was never
// stamped reports ok=false (so callers can reject the request rather than
// silently operate against a zero-value org).
func TestOrgFromContext(t *testing.T) {
	orgA := orgs.Org{ID: "org-aaa", Slug: "alpha", DisplayName: "Alpha"}
	orgB := orgs.Org{ID: "org-bbb", Slug: "beta", DisplayName: "Beta"}

	tests := []struct {
		name    string
		ctx     context.Context
		wantOrg orgs.Org
		wantOK  bool
	}{
		{
			name:    "org attached",
			ctx:     auth.WithOrg(context.Background(), orgA),
			wantOrg: orgA,
			wantOK:  true,
		},
		{
			name:    "different org attached",
			ctx:     auth.WithOrg(context.Background(), orgB),
			wantOrg: orgB,
			wantOK:  true,
		},
		{
			name:    "no org attached",
			ctx:     context.Background(),
			wantOrg: orgs.Org{},
			wantOK:  false,
		},
		{
			name:    "nil-ish background context",
			ctx:     context.TODO(),
			wantOrg: orgs.Org{},
			wantOK:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := tenancy.OrgFromContext(tt.ctx)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if got != tt.wantOrg {
				t.Fatalf("org = %+v, want %+v", got, tt.wantOrg)
			}
		})
	}
}

// TestUserFromContext mirrors TestOrgFromContext for the user side of the
// tenancy boundary.
func TestUserFromContext(t *testing.T) {
	userA := users.User{ID: "user-1", OrgID: "org-aaa", Email: "a@example.com"}

	tests := []struct {
		name     string
		ctx      context.Context
		wantUser users.User
		wantOK   bool
	}{
		{
			name:     "user attached",
			ctx:      auth.WithUser(context.Background(), userA),
			wantUser: userA,
			wantOK:   true,
		},
		{
			name:     "no user attached",
			ctx:      context.Background(),
			wantUser: users.User{},
			wantOK:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := tenancy.UserFromContext(tt.ctx)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if got != tt.wantUser {
				t.Fatalf("user = %+v, want %+v", got, tt.wantUser)
			}
		})
	}
}

// TestOrgFromContext_LastWriteWins documents that re-stamping the org on a
// child context overrides the parent's org. This is the mechanism that keeps a
// request from leaking a stale tenant when middleware re-resolves the org.
func TestOrgFromContext_LastWriteWins(t *testing.T) {
	parent := auth.WithOrg(context.Background(), orgs.Org{ID: "org-aaa"})
	child := auth.WithOrg(parent, orgs.Org{ID: "org-bbb"})

	got, ok := tenancy.OrgFromContext(child)
	if !ok {
		t.Fatal("expected org to be present on child context")
	}
	if got.ID != "org-bbb" {
		t.Fatalf("child org = %q, want %q", got.ID, "org-bbb")
	}

	// The parent must be unaffected — context values are immutable, so the
	// override on the child can never bleed back up.
	gotParent, _ := tenancy.OrgFromContext(parent)
	if gotParent.ID != "org-aaa" {
		t.Fatalf("parent org = %q, want %q (override must not mutate parent)", gotParent.ID, "org-aaa")
	}
}

// TestTenancyIsolation_NoCrossTenantLeak verifies that two sibling contexts
// derived from the same root carry independent orgs. A regression here would
// mean one tenant's request could observe another tenant's org.
func TestTenancyIsolation_NoCrossTenantLeak(t *testing.T) {
	root := context.Background()
	ctxA := auth.WithOrg(root, orgs.Org{ID: "org-aaa", Slug: "alpha"})
	ctxB := auth.WithOrg(root, orgs.Org{ID: "org-bbb", Slug: "beta"})

	gotA, okA := tenancy.OrgFromContext(ctxA)
	gotB, okB := tenancy.OrgFromContext(ctxB)
	if !okA || !okB {
		t.Fatalf("expected both contexts to carry an org: okA=%v okB=%v", okA, okB)
	}
	if gotA.ID == gotB.ID {
		t.Fatalf("cross-tenant leak: ctxA org %q == ctxB org %q", gotA.ID, gotB.ID)
	}
	if gotA.ID != "org-aaa" || gotB.ID != "org-bbb" {
		t.Fatalf("orgs swapped: ctxA=%q ctxB=%q", gotA.ID, gotB.ID)
	}
}

// TestOrgFromContext_OverHTTPRequest exercises the boundary the way real
// handlers use it: pull the org off *http.Request.Context() after the
// middleware stamped it. An unauthenticated request (no org stamped) must be
// rejected.
func TestOrgFromContext_OverHTTPRequest(t *testing.T) {
	wantOrg := orgs.Org{ID: "org-aaa", Slug: "alpha"}

	// Handler that 403s when no org is on the request context, echoes the org
	// ID otherwise. This is the canonical tenant-isolation guard.
	guarded := func(w http.ResponseWriter, r *http.Request) {
		org, ok := tenancy.OrgFromContext(r.Context())
		if !ok {
			http.Error(w, "no tenant", http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte(org.ID))
	}

	t.Run("org stamped on request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = req.WithContext(auth.WithOrg(req.Context(), wantOrg))
		rec := httptest.NewRecorder()

		guarded(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if rec.Body.String() != wantOrg.ID {
			t.Fatalf("body = %q, want %q", rec.Body.String(), wantOrg.ID)
		}
	})

	t.Run("no org stamped is rejected", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		guarded(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d (request without a tenant must be rejected)", rec.Code, http.StatusForbidden)
		}
	})
}
