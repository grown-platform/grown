# internal/auth

OIDC login, session lifecycle, AuthService implementation, and the HTTP
authentication middleware.

## Interfaces

- `Config` struct + `Validate()` — runtime config (issuer, client id/secret, cookie, lifetime, default org slug).
- `NewOIDC(ctx, cfg) (*OIDC, error)` — discovers the issuer's endpoints; returns a helper with `AuthCodeURL` and `Exchange`.
- `NewSessionStore(pool) *SessionStore` — opaque session tokens, `Create` / `Lookup` / `Revoke`. Sentinels: `ErrSessionNotFound`, `ErrSessionExpired`, `ErrSessionRevoked`.
- `NewService(cfg, oidc, sessions, urepo, orepo) *Service` — implements `grownv1.AuthServiceServer`.
- `HTTPMiddleware(cfg, sessions, urepo, defaultOrg)` — wraps the gateway mux; attaches user + org to the request context.
- `WithUser` / `UserFromContext`, `WithOrg` / `OrgFromContext` — context helpers.
- `NewState() (string, error)` — CSRF state generator (24 bytes, base64-url).
- `Claims` struct + `DisplayName()` — OIDC claims projection.

## Depends on

- `internal/orgs` — org lookups for tenancy.
- `internal/users` — user upsert + lookup.
- `internal/storage` — pgxpool transitively.
- `github.com/coreos/go-oidc/v3`
- `golang.org/x/oauth2`
- `google.golang.org/grpc`
- `gen/go/grown/v1`

## Used by

- `internal/server` — registers AuthService and installs HTTPMiddleware.
- `cmd/server` — constructs Config from env and wires the dependency graph.
