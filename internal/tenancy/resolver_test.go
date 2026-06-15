package tenancy_test

import (
	"testing"

	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/tenancy"
)

// TestSingleOrgResolver_Resolve confirms the single-org resolver always returns
// the org it was constructed with, regardless of how many times it's called.
// In single-org mode this is the sole source of tenant identity, so a wrong or
// drifting value would route every request to the wrong tenant.
func TestSingleOrgResolver_Resolve(t *testing.T) {
	tests := []struct {
		name string
		org  orgs.Org
	}{
		{
			name: "default shared org",
			org:  orgs.Org{ID: "org-default", Slug: "default", DisplayName: "Default"},
		},
		{
			name: "personal org",
			org:  orgs.Org{ID: "org-personal", Slug: "personal-deadbeef", DisplayName: "Me", IsPersonal: true},
		},
		{
			name: "zero-value org",
			org:  orgs.Org{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := tenancy.SingleOrgResolver{Org: tt.org}

			got := r.Resolve()
			if got != tt.org {
				t.Fatalf("Resolve() = %+v, want %+v", got, tt.org)
			}

			// Resolve must be idempotent — repeated calls return the same org.
			if again := r.Resolve(); again != tt.org {
				t.Fatalf("second Resolve() = %+v, want %+v", again, tt.org)
			}
		})
	}
}

// TestSingleOrgResolver_DistinctInstances verifies two resolvers configured
// with different orgs never bleed into one another. This is the structural
// guarantee that one tenant's resolver can't return another tenant's org.
func TestSingleOrgResolver_DistinctInstances(t *testing.T) {
	a := tenancy.SingleOrgResolver{Org: orgs.Org{ID: "org-aaa"}}
	b := tenancy.SingleOrgResolver{Org: orgs.Org{ID: "org-bbb"}}

	if a.Resolve().ID == b.Resolve().ID {
		t.Fatalf("distinct resolvers returned same org id %q", a.Resolve().ID)
	}
	if a.Resolve().ID != "org-aaa" {
		t.Fatalf("resolver a = %q, want org-aaa", a.Resolve().ID)
	}
	if b.Resolve().ID != "org-bbb" {
		t.Fatalf("resolver b = %q, want org-bbb", b.Resolve().ID)
	}
}
