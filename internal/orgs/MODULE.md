# internal/orgs

Data-access layer for `grown.orgs` rows.

## Interfaces

- `NewRepository(pool *pgxpool.Pool) *Repository`
- `(*Repository).GetBySlug(ctx, slug) (Org, error)`
- `(*Repository).GetByID(ctx, id) (Org, error)`
- `ErrNotFound` — sentinel returned when no row matches.

## Depends on

- `internal/storage` (transitively, via the migration that creates `grown.orgs`)
- `github.com/jackc/pgx/v5`

## Used by

- `internal/tenancy` — resolves the org for each request.
- `internal/auth` — populates `WhoamiResponse.org`.
