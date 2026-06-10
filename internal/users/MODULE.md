# internal/users

Data-access layer for `grown.users` rows. The authoritative identity lives
in the upstream OIDC provider; this table caches issuer+subject and the
email/display_name claims for fast local lookup.

## Interfaces

- `NewRepository(pool *pgxpool.Pool) *Repository`
- `(*Repository).UpsertByOIDC(ctx, UpsertInput) (User, error)` — insert-or-update on (org_id, oidc_issuer, oidc_subject).
- `(*Repository).GetByID(ctx, id) (User, error)`
- `ErrNotFound`

## Depends on

- `internal/storage` (transitively)
- `github.com/jackc/pgx/v5`

## Used by

- `internal/auth` — upserts users on OIDC callback, looks them up on whoami.
