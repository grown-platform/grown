package database

import (
	"context"
	"embed"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // pgx stdlib driver for goose
	"github.com/pressly/goose/v3"

	"code.pick.haus/grown/grown/internal/pdf/sqlc"
)

//go:embed migrations/*.sql
var migrations embed.FS

type DB struct {
	pool    *pgxpool.Pool
	Queries *sqlc.Queries
}

func New(ctx context.Context, databaseURL string) (*DB, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}

	return &DB{
		pool:    pool,
		Queries: sqlc.New(pool),
	}, nil
}

func (db *DB) Close() {
	db.pool.Close()
}

func (db *DB) Pool() *pgxpool.Pool {
	return db.pool
}

func Migrate(databaseURL string) error {
	goose.SetBaseFS(migrations)

	db, err := goose.OpenDBWithDriver("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}

	return goose.Up(db, "migrations")
}
