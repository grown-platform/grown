# internal/tenancy

Resolves which Org a request belongs to.

In V1 (single-org mode), the auth middleware attaches the bootstrapped
"default" org to every request. This package re-exports `OrgFromContext`
and `UserFromContext` from `internal/auth` so consumers can depend on a
single tenancy boundary instead of reaching into auth.

In Plan 5 (multi-org mode), the `middleware.go` file will gain a real HTTP
middleware that inspects the request host (subdomain), looks up the matching
`grown.orgs` row, and attaches it before the auth middleware fires.

## Interfaces

- `OrgFromContext(ctx) (Org, bool)` — re-exported from `internal/auth`.
- `UserFromContext(ctx) (User, bool)` — re-exported from `internal/auth`.
- `SingleOrgResolver{Org}` — placeholder type used by tests in multi-org mode.

## Depends on

- `internal/auth` (context keys).
- `internal/orgs` (Org type).

## Used by

- Anywhere downstream of auth that needs to know which org/user the request belongs to.
