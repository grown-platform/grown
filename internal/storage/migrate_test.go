package storage

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRunMigrations_AppliesInitialSchema exercises the runner against a real
// Postgres pointed at by GROWN_TEST_DSN. The migration must create the
// schema_migrations row for version 1.
func TestRunMigrations_AppliesInitialSchema(t *testing.T) {
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Clean any prior state so the test is idempotent.
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}

	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	var version int
	if err := pool.QueryRow(ctx, "SELECT MAX(version) FROM grown.schema_migrations").Scan(&version); err != nil {
		t.Fatalf("query: %v", err)
	}
	if version < 1 {
		t.Errorf("schema_migrations.max(version): got %d, want >= 1 (the bootstrap migration must have applied)", version)
	}
}
