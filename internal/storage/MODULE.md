# internal/storage

Postgres connection pool + embedded migration runner.

## Interfaces

- `NewPool(ctx, dsn) (*pgxpool.Pool, error)` — connect and verify with Ping
- `RunMigrations(ctx, pool) error` — apply any unapplied embedded migrations, idempotent

## Migrations

SQL files live in `migrations/` and are embedded via `go:embed`. Filename format: `NNNN_name.sql` (zero-padded numeric version, underscore, descriptive name). Numbers must be unique and sequential.

## Depends on

- `github.com/jackc/pgx/v5`
- `github.com/jackc/pgx/v5/pgxpool`

## Used by

- `cmd/server` — calls `NewPool` and `RunMigrations` at startup
