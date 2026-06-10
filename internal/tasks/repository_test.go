package tasks

import (
	"context"
	"os"
	"testing"

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
		 VALUES ($1,'test','subject-tasks','tasks-tester@grown.localtest.me','Tasks Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func TestRepository_ListCRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Create
	l, err := repo.CreateList(ctx, orgID, userID, ListFields{Name: "My Tasks"})
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	if l.Name != "My Tasks" || l.OrgID != orgID {
		t.Fatalf("CreateList round-trip: %+v", l)
	}

	// ListLists
	lists, err := repo.ListLists(ctx, orgID, userID)
	if err != nil || len(lists) != 1 {
		t.Fatalf("ListLists: got %d want 1, err=%v", len(lists), err)
	}

	// Update
	ul, err := repo.UpdateList(ctx, orgID, l.ID, ListFields{Name: "Renamed"})
	if err != nil || ul.Name != "Renamed" {
		t.Fatalf("UpdateList: %+v err=%v", ul, err)
	}

	// Delete
	if err := repo.DeleteList(ctx, orgID, l.ID); err != nil {
		t.Fatalf("DeleteList: %v", err)
	}
	lists, _ = repo.ListLists(ctx, orgID, userID)
	if len(lists) != 0 {
		t.Fatalf("after delete: got %d lists want 0", len(lists))
	}
}

func TestRepository_TaskCRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	l, _ := repo.CreateList(ctx, orgID, userID, ListFields{Name: "Work"})

	// Create
	task, err := repo.CreateTask(ctx, orgID, l.ID, userID, TaskFields{
		Title: "Write tests",
		Notes: "use GROWN_TEST_DSN",
	})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if task.Title != "Write tests" || task.Completed {
		t.Fatalf("CreateTask round-trip: %+v", task)
	}

	// ListTasks
	tasks, err := repo.ListTasks(ctx, orgID, l.ID)
	if err != nil || len(tasks) != 1 {
		t.Fatalf("ListTasks: got %d want 1, err=%v", len(tasks), err)
	}

	// Update
	ut, err := repo.UpdateTask(ctx, orgID, task.ID, TaskFields{Title: "Updated title", Notes: ""})
	if err != nil || ut.Title != "Updated title" {
		t.Fatalf("UpdateTask: %+v err=%v", ut, err)
	}

	// Delete
	if err := repo.DeleteTask(ctx, orgID, task.ID); err != nil {
		t.Fatalf("DeleteTask: %v", err)
	}
	tasks, _ = repo.ListTasks(ctx, orgID, l.ID)
	if len(tasks) != 0 {
		t.Fatalf("after delete: got %d tasks want 0", len(tasks))
	}
}

func TestRepository_ToggleComplete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	l, _ := repo.CreateList(ctx, orgID, userID, ListFields{Name: "Toggle"})
	task, _ := repo.CreateTask(ctx, orgID, l.ID, userID, TaskFields{Title: "Do something"})

	toggled, err := repo.ToggleTask(ctx, orgID, task.ID)
	if err != nil {
		t.Fatalf("ToggleTask: %v", err)
	}
	if !toggled.Completed || toggled.CompletedAt == nil {
		t.Fatalf("after toggle: expected completed=true, got %+v", toggled)
	}

	// Toggle back
	toggled2, err := repo.ToggleTask(ctx, orgID, task.ID)
	if err != nil {
		t.Fatalf("ToggleTask again: %v", err)
	}
	if toggled2.Completed || toggled2.CompletedAt != nil {
		t.Fatalf("after second toggle: expected completed=false, got %+v", toggled2)
	}
}

func TestRepository_Reorder(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	l, _ := repo.CreateList(ctx, orgID, userID, ListFields{Name: "Ordered"})
	t1, _ := repo.CreateTask(ctx, orgID, l.ID, userID, TaskFields{Title: "A"})
	t2, _ := repo.CreateTask(ctx, orgID, l.ID, userID, TaskFields{Title: "B"})
	t3, _ := repo.CreateTask(ctx, orgID, l.ID, userID, TaskFields{Title: "C"})

	// Move t1 (pos 0) to pos 2
	moved, err := repo.ReorderTask(ctx, orgID, t1.ID, 2)
	if err != nil {
		t.Fatalf("ReorderTask: %v", err)
	}
	if moved.Position != 2 {
		t.Fatalf("expected position 2, got %d", moved.Position)
	}

	tasks, _ := repo.ListTasks(ctx, orgID, l.ID)
	posMap := map[string]int32{}
	for _, tk := range tasks {
		posMap[tk.ID] = tk.Position
	}
	if posMap[t2.ID] != 0 || posMap[t3.ID] != 1 || posMap[t1.ID] != 2 {
		t.Fatalf("positions after reorder: %+v", posMap)
	}
}

func TestRepository_OrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('tasks-other','Tasks Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}

	if _, err := repo.CreateList(ctx, orgID, userID, ListFields{Name: "Private list"}); err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	lists, _ := repo.ListLists(ctx, otherOrg, userID)
	if len(lists) != 0 {
		t.Fatalf("cross-org leak: other org saw %d lists", len(lists))
	}
}
