package adminanalytics

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestDemoUniqueIPsQueryMatchesLocalPart guards the demo-IP query against a
// regression of the original bug: matching only the full email
// (lower(u.email) = lower($2)) made the tile read 0 when GROWN_DEMO_USERNAME is
// a bare login name (e.g. "demo") but the user's email is "demo@grown.haus".
// The query must also match the email local-part.
func TestDemoUniqueIPsQueryMatchesLocalPart(t *testing.T) {
	q := strings.ToLower(demoUniqueIPsQuery)
	if !strings.Contains(q, "lower(u.email) = lower($2)") {
		t.Errorf("query should still match the full email")
	}
	if !strings.Contains(q, "split_part(u.email, '@', 1)") {
		t.Errorf("query must also match the email local-part (split_part) so a bare\n"+
			"GROWN_DEMO_USERNAME like \"demo\" matches demo@example.com; got:\n%s", demoUniqueIPsQuery)
	}
}

// TestDemoUniqueIPsQueryDB exercises the real query against a database when one
// is configured (TEST_DATABASE_URL / GROWN_DATABASE_URL). It seeds a throwaway
// org + demo user + two distinct-IP sessions, then asserts the query — driven by
// the bare login NAME (local-part), not the full email — returns 2. This is the
// exact scenario that previously returned 0. Skipped when no DSN is set; the
// seed rows are cleaned up at the end.
func TestDemoUniqueIPsQueryDB(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("GROWN_DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL / GROWN_DATABASE_URL not set; skipping DB test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// A real org to scope to.
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs LIMIT 1`).Scan(&orgID); err != nil {
		t.Skipf("no orgs found in test DB: %v", err)
	}

	const demoEmail = "demo-honeypot-test@grown.haus"
	const demoName = "demo-honeypot-test" // bare local-part, the configured GROWN_DEMO_USERNAME style

	var userID string
	err = pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, email) VALUES ($1, $2) RETURNING id::text`,
		orgID, demoEmail).Scan(&userID)
	if err != nil {
		t.Skipf("could not seed demo user (schema mismatch?): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM grown.sessions WHERE user_id = $1`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM grown.users WHERE id = $1`, userID)
	})

	for _, ip := range []string{"203.0.113.1", "203.0.113.2"} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO grown.sessions (user_id, ip) VALUES ($1, $2)`, userID, ip); err != nil {
			t.Skipf("could not seed session (schema mismatch?): %v", err)
		}
	}

	n := countOne(ctx, pool, demoUniqueIPsQuery, orgID, demoName)
	if n != 2 {
		t.Errorf("demo unique IPs = %d; want 2 (bare login name should match email local-part)", n)
	}
}
