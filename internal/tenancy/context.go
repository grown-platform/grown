// Package tenancy resolves the org context for every incoming request.
package tenancy

import (
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
)

// We piggy-back on auth's context keys so other packages have one place to
// look up `Org`/`User`. This re-export keeps the public surface tidy.

// OrgFromContext is re-exported from auth for callers that depend only on tenancy.
var OrgFromContext = auth.OrgFromContext

// UserFromContext is re-exported from auth for callers that depend only on tenancy.
var UserFromContext = auth.UserFromContext

// SingleOrgResolver is a Resolver that always returns the org passed at
// construction time. Used in single-org mode.
type SingleOrgResolver struct {
	Org orgs.Org
}

// Resolve returns the configured org regardless of the request.
func (r SingleOrgResolver) Resolve() orgs.Org { return r.Org }
