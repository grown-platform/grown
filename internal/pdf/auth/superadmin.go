package auth

import (
	"context"
	"net/http"

	"code.pick.haus/grown/grown/internal/pdf/sqlc"
)

// SuperadminChecker is the minimal sqlc interface RequireSuperadmin needs.
// Defined here so tests can pass a fake without dragging in a real DB.
type SuperadminChecker interface {
	IsSuperadmin(ctx context.Context, email string) (bool, error)
}

// IsSuperadmin returns true iff the caller's email currently has the
// super_admin role. Returns false (with no error) on DB errors so a
// transient DB blip cannot elevate privilege.
func IsSuperadmin(ctx context.Context, q SuperadminChecker, email string) bool {
	if email == "" {
		return false
	}
	ok, err := q.IsSuperadmin(ctx, email)
	if err != nil {
		return false
	}
	return ok
}

// RequireSuperadmin wraps an http.Handler so it only runs for callers
// the auth middleware has identified AND who have the super_admin role.
// 401 if no verified email in context, 403 if the email is not a
// superadmin.
func RequireSuperadmin(q SuperadminChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			email := UserEmailFromContext(r.Context())
			if email == "" {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
			if !IsSuperadmin(r.Context(), q, email) {
				http.Error(w, "superadmin required", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Compile-time check: sqlc-generated *Queries satisfies SuperadminChecker.
var _ SuperadminChecker = (*sqlc.Queries)(nil)
