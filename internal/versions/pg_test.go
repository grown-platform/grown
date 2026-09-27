package versions

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"code.pick.haus/grown/grown/internal/storage"
)

// TestPGStore runs the policy against Postgres. It needs GROWN_TEST_DSN and
// drops the grown schema of that database, so never point it at real data.
func TestPGStore(t *testing.T) {
	dsn := os.Getenv("GROWN_TEST_DSN")
	if dsn == "" {
		t.Skip("GROWN_TEST_DSN not set; skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, "DROP SCHEMA IF EXISTS grown CASCADE"); err != nil {
		t.Fatalf("drop schema: %v", err)
	}
	if err := storage.RunMigrations(ctx, pool); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	var orgID, userID, sheetID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-1','tester@grown.localtest.me','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.sheets_documents (org_id, owner_id) VALUES ($1,$2) RETURNING id::text`,
		orgID, userID).Scan(&sheetID); err != nil {
		t.Fatalf("seed sheet: %v", err)
	}

	p := DefaultPolicy
	p.MaxAuto = 2
	m := NewManager(NewPGStore(pool), p)
	clk := time.Now()
	m.now = func() time.Time { return clk }

	if ok, err := m.AutoSnapshot(ctx, "sheets", sheetID, userID, `{"a":1}`); err != nil || !ok {
		t.Fatalf("first auto: %v %v", ok, err)
	}
	if ok, _ := m.AutoSnapshot(ctx, "sheets", sheetID, userID, `{"a":2}`); ok {
		t.Fatal("throttle ignored")
	}
	named, err := m.NameCurrent(ctx, "sheets", sheetID, userID, "Named", `{"a":2}`)
	if err != nil {
		t.Fatalf("NameCurrent: %v", err)
	}
	if named.AuthorName != "Tester" || named.ID == "" || named.SizeBytes != 7 {
		t.Fatalf("named: %+v", named)
	}
	for i := 0; i < 3; i++ {
		clk = clk.Add(time.Hour)
		if _, err := m.AutoSnapshot(ctx, "sheets", sheetID, userID, `{"auto":`+string(rune('0'+i))+`}`); err != nil {
			t.Fatal(err)
		}
	}
	list, err := m.List(ctx, "sheets", sheetID)
	if err != nil {
		t.Fatal(err)
	}
	autos := 0
	for _, v := range list {
		if v.IsAuto {
			autos++
		}
		if v.Data != "" {
			t.Fatal("List returned data")
		}
	}
	if autos != 2 {
		t.Fatalf("auto kept = %d, want 2 (%+v)", autos, list)
	}
	var saved string
	r, err := m.Restore(ctx, "sheets", sheetID, userID, named.ID, `{"auto":2}`, func(d string) error {
		saved = d
		return nil
	})
	if err != nil || saved != `{"a":2}` || r.RestoredFrom != named.ID {
		t.Fatalf("restore: %+v %v saved=%q", r, err, saved)
	}
	got, err := m.Get(ctx, "sheets", sheetID, r.ID)
	if err != nil || got.Data != `{"a":2}` {
		t.Fatalf("get restored: %+v %v", got, err)
	}
	if _, err := m.Get(ctx, "slides", sheetID, r.ID); err != ErrNotFound {
		t.Fatalf("kind scoping: %v", err)
	}
	if v, err := m.Rename(ctx, "sheets", sheetID, r.ID, "Back to named"); err != nil || v.Label != "Back to named" {
		t.Fatalf("rename: %+v %v", v, err)
	}
}
