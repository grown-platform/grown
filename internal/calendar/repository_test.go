package calendar

import (
	"context"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupDB(t *testing.T) (*pgxpool.Pool, string, string) {
	t.Helper()
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
	var orgID, userID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-1','tester@grown.localtest.me','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func TestRepository_EventCRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	start := time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC)

	e, err := repo.Create(ctx, orgID, userID, Fields{
		Title: "Standup", Location: "Room A", StartAt: start, EndAt: start.Add(30 * time.Minute),
		Color: "#5e6ad2", Attendees: []string{"a@x.io", "b@x.io"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if e.Title != "Standup" || len(e.Attendees) != 2 {
		t.Fatalf("create round-trip: %+v", e)
	}

	if _, err := repo.Update(ctx, orgID, e.ID, Fields{Title: "Daily Standup", StartAt: start, EndAt: start.Add(time.Hour)}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, err := repo.Get(ctx, orgID, e.ID)
	if err != nil || got.Title != "Daily Standup" {
		t.Fatalf("after update: %+v err=%v", got, err)
	}

	if err := repo.Delete(ctx, orgID, e.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, e.ID); err != ErrNotFound {
		t.Fatalf("after delete: got %v want ErrNotFound", err)
	}
}

func TestRepository_ListTimeWindow(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	jun := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	aug := time.Date(2026, 8, 15, 12, 0, 0, 0, time.UTC)

	inWin, _ := repo.Create(ctx, orgID, userID, Fields{Title: "June", StartAt: jun, EndAt: jun.Add(time.Hour)})
	_, _ = repo.Create(ctx, orgID, userID, Fields{Title: "Aug", StartAt: aug, EndAt: aug.Add(time.Hour)})

	// Window covering only June.
	min := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	max := time.Date(2026, 6, 30, 23, 59, 59, 0, time.UTC)
	got, err := repo.List(ctx, orgID, min, max)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 1 || got[0].ID != inWin.ID {
		t.Fatalf("time-window filter: got %d events want 1 (June)", len(got))
	}
}

func TestRepository_OrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other','Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	now := time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC)
	if _, err := repo.Create(ctx, orgID, userID, Fields{Title: "Private", StartAt: now, EndAt: now.Add(time.Hour)}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	wide := repo
	if got, _ := wide.List(ctx, otherOrg, now.Add(-24*time.Hour), now.Add(24*time.Hour)); len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d events", len(got))
	}
}

// TestRepository_RemindersRoundTrip verifies that a reminder minutes list is
// persisted and returned verbatim (table-driven).
func TestRepository_RemindersRoundTrip(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	base := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)

	cases := []struct {
		name      string
		reminders []int32
	}{
		{"nil", nil},
		{"empty", []int32{}},
		{"single zero", []int32{0}},
		{"multi", []int32{0, 10, 30, 60, 1440}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, err := repo.Create(ctx, orgID, userID, Fields{
				Title:     "Reminder test",
				StartAt:   base,
				EndAt:     base.Add(time.Hour),
				Reminders: tc.reminders,
			})
			if err != nil {
				t.Fatalf("Create: %v", err)
			}
			got, err := repo.Get(ctx, orgID, e.ID)
			if err != nil {
				t.Fatalf("Get: %v", err)
			}
			want := tc.reminders
			if want == nil {
				want = []int32{}
			}
			if len(got.Reminders) != len(want) {
				t.Fatalf("reminders length: got %v want %v", got.Reminders, want)
			}
			for i := range want {
				if got.Reminders[i] != want[i] {
					t.Fatalf("reminders[%d]: got %d want %d", i, got.Reminders[i], want[i])
				}
			}
		})
	}
}

// TestRepository_ItemType verifies that item_type is persisted and can be
// filtered via List (table-driven).
func TestRepository_ItemType(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	base := time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC)

	// Create one of each item type.
	types := []string{ItemTypeEvent, ItemTypeTask, ItemTypeOutOfOffice, ItemTypeFocusTime}
	for _, it := range types {
		_, err := repo.Create(ctx, orgID, userID, Fields{
			Title:    it + " item",
			StartAt:  base,
			EndAt:    base.Add(time.Hour),
			ItemType: it,
		})
		if err != nil {
			t.Fatalf("Create %s: %v", it, err)
		}
	}

	min := base.Add(-time.Hour)
	max := base.Add(2 * time.Hour)

	// All types returned without filter.
	all, err := repo.List(ctx, orgID, min, max)
	if err != nil {
		t.Fatalf("List all: %v", err)
	}
	if len(all) != len(types) {
		t.Fatalf("expected %d items, got %d", len(types), len(all))
	}

	// Each type filters correctly.
	for _, it := range types {
		t.Run("filter_"+it, func(t *testing.T) {
			got, err := repo.List(ctx, orgID, min, max, ListOptions{ItemType: it})
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("want 1 %s, got %d", it, len(got))
			}
			if got[0].ItemType != it {
				t.Fatalf("item_type: got %q want %q", got[0].ItemType, it)
			}
		})
	}
}

// TestRepository_TaskDone verifies the task_done flag round-trips, and can be
// updated.
func TestRepository_TaskDone(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	base := time.Date(2026, 7, 3, 9, 0, 0, 0, time.UTC)

	e, err := repo.Create(ctx, orgID, userID, Fields{
		Title:    "Buy milk",
		StartAt:  base,
		EndAt:    base.Add(time.Hour),
		ItemType: ItemTypeTask,
		TaskDone: false,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if e.TaskDone {
		t.Fatal("expected task_done=false after create")
	}

	// Mark done via Update.
	updated, err := repo.Update(ctx, orgID, e.ID, Fields{
		Title:    e.Title,
		StartAt:  e.StartAt,
		EndAt:    e.EndAt,
		ItemType: ItemTypeTask,
		TaskDone: true,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if !updated.TaskDone {
		t.Fatal("expected task_done=true after update")
	}
}

// TestRepository_StatusVisibility verifies busy/free and visibility fields.
func TestRepository_StatusVisibility(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	base := time.Date(2026, 7, 4, 9, 0, 0, 0, time.UTC)

	cases := []struct {
		status     string
		visibility string
		wantStatus string
		wantVis    string
	}{
		{"busy", "default", StatusBusy, VisibilityDefault},
		{"free", "public", StatusFree, VisibilityPublic},
		{"", "private", StatusBusy, VisibilityPrivate}, // empty status → default busy
		{"free", "", StatusFree, VisibilityDefault},    // empty visibility → default
	}
	for _, tc := range cases {
		t.Run(tc.status+"_"+tc.visibility, func(t *testing.T) {
			e, err := repo.Create(ctx, orgID, userID, Fields{
				Title:      "SV test",
				StartAt:    base,
				EndAt:      base.Add(time.Hour),
				Status:     tc.status,
				Visibility: tc.visibility,
			})
			if err != nil {
				t.Fatalf("Create: %v", err)
			}
			if e.Status != tc.wantStatus {
				t.Errorf("status: got %q want %q", e.Status, tc.wantStatus)
			}
			if e.Visibility != tc.wantVis {
				t.Errorf("visibility: got %q want %q", e.Visibility, tc.wantVis)
			}
		})
	}
}
