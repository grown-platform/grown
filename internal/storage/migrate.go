package storage

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type migration struct {
	version int
	name    string
	sql     string
}

// RunMigrations applies any pending migrations from the embedded migrations/ tree
// to the database. Idempotent: already-applied migrations are skipped.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	migs, err := loadMigrations()
	if err != nil {
		return err
	}

	// Ensure the schema_migrations table exists before reading it. We do this by
	// always running migration 0001 — which is idempotent (CREATE TABLE IF NOT EXISTS).
	for _, m := range migs {
		if m.version != 1 {
			continue
		}
		if _, err := pool.Exec(ctx, m.sql); err != nil {
			return fmt.Errorf("apply migration %04d: %w", m.version, err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO grown.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
			m.version); err != nil {
			return fmt.Errorf("record migration %04d: %w", m.version, err)
		}
		break
	}

	// Now read which versions have been applied and run the rest in order.
	rows, err := pool.Query(ctx, `SELECT version FROM grown.schema_migrations`)
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	applied := map[int]bool{}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return fmt.Errorf("scan schema_migrations row: %w", err)
		}
		applied[v] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate schema_migrations: %w", err)
	}

	for _, m := range migs {
		if applied[m.version] {
			continue
		}
		// Atomic apply+record: if either step fails, neither persists.
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin tx for migration %04d_%s: %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %04d_%s: %w", m.version, m.name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO grown.schema_migrations (version) VALUES ($1)`,
			m.version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %04d_%s: %w", m.version, m.name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %04d_%s: %w", m.version, m.name, err)
		}
	}
	return nil
}

func loadMigrations() ([]migration, error) {
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	migs := make([]migration, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		// Filename format: 0001_init.sql  → version 1, name "init"
		parts := strings.SplitN(strings.TrimSuffix(e.Name(), ".sql"), "_", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("malformed migration filename: %s", e.Name())
		}
		v, err := strconv.Atoi(parts[0])
		if err != nil {
			return nil, fmt.Errorf("migration filename version not numeric: %s", e.Name())
		}
		data, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err != nil {
			return nil, err
		}
		migs = append(migs, migration{version: v, name: parts[1], sql: string(data)})
	}
	sort.Slice(migs, func(i, j int) bool { return migs[i].version < migs[j].version })
	return migs, nil
}
