package auth

import (
	"net/http"

	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// HTTPMiddleware returns a function that authenticates incoming HTTP requests
// based on the session cookie. If the cookie is absent or invalid, the request
// is passed through with no user attached — downstream services that require
// authentication should check `UserFromContext` and return Unauthenticated.
//
// `defaultOrg` is attached for anonymous requests (so they still know the
// default tenant). For an AUTHENTICATED user, the middleware resolves that
// user's actual org fresh from the DB each request (orepo) and attaches it —
// so org renames/branding reflect immediately and personal/multi-org users get
// their own org, not the startup default.
func HTTPMiddleware(cfg Config, sessions *SessionStore, urepo *users.Repository, orepo *orgs.Repository, defaultOrg orgs.Org) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := WithOrg(r.Context(), defaultOrg)
			// Defensive nil-checks: tests may construct the middleware with
			// zero-valued deps. Skip session lookup if either is nil.
			if sessions == nil || urepo == nil {
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			cookie, err := r.Cookie(cfg.CookieName)
			if err == nil && cookie.Value != "" {
				sess, lookupErr := sessions.Lookup(r.Context(), cookie.Value)
				if lookupErr == nil {
					if u, uerr := urepo.GetByID(r.Context(), sess.UserID); uerr == nil {
						ctx = WithUser(ctx, u)
						// Attach the user's real org (fresh) — overrides the
						// startup default so renames/branding and multi-org work.
						if orepo != nil {
							if o, oerr := orepo.GetByID(r.Context(), u.OrgID); oerr == nil {
								ctx = WithOrg(ctx, o)
							}
						}
						// Stash the live token so handlers can flag the caller's
						// own session in the Sessions view (the token is never
						// surfaced — only compared).
						ctx = WithSessionToken(ctx, cookie.Value)
						// Throttled refresh of last_seen_at (no-op unless stale).
						// Best-effort: ignore errors so a write failure never
						// breaks the request.
						_ = sessions.TouchLastSeen(r.Context(), cookie.Value)
					}
				}
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
