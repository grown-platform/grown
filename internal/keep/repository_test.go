package keep

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
		 VALUES ($1,'test','subject-1','tester@grown.localtest.me','Tester') RETURNING id::text`,
		orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func TestRepository_NoteCRUDAndChecklist(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	n, err := repo.Create(ctx, orgID, userID, Fields{
		Title: "Groceries", Color: "#ffd", Pinned: true,
		Checklist: []ChecklistItem{{Text: "Milk", Checked: false}, {Text: "Eggs", Checked: true}},
		Labels:    []string{"home"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if !n.Pinned || len(n.Checklist) != 2 || len(n.Labels) != 1 {
		t.Fatalf("create round-trip: %+v", n)
	}

	if _, err := repo.Update(ctx, orgID, n.ID, Fields{Title: "Groceries", Archived: true}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	got, err := repo.Get(ctx, orgID, n.ID)
	if err != nil || !got.Archived {
		t.Fatalf("after update: %+v err=%v", got, err)
	}

	// Archived note must NOT appear in default view, but must appear in archive view.
	if list, _ := repo.ListFiltered(ctx, orgID, false, ""); len(list) != 0 {
		t.Fatalf("archived note appeared in default list: got %d want 0", len(list))
	}
	if list, _ := repo.ListFiltered(ctx, orgID, true, ""); len(list) != 1 {
		t.Fatalf("archived note missing from archive list: got %d want 1", len(list))
	}
	if err := repo.Trash(ctx, orgID, n.ID); err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, n.ID); err != ErrNotFound {
		t.Fatalf("after trash: got %v want ErrNotFound", err)
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
	if _, err := repo.Create(ctx, orgID, userID, Fields{Title: "Private"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got, _ := repo.ListFiltered(ctx, otherOrg, false, ""); len(got) != 0 {
		t.Fatalf("cross-org leak: other org saw %d notes", len(got))
	}
}

// TestRepository_ArchiveExcludesFromDefault proves that archived notes do NOT
// appear in the default (non-archived) list view, and DO appear in the archive
// view. It also proves that unarchiving restores a note to the default view.
func TestRepository_ArchiveExcludesFromDefault(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Create two notes: one regular, one archived.
	regular, err := repo.Create(ctx, orgID, userID, Fields{Title: "Regular"})
	if err != nil {
		t.Fatalf("Create regular: %v", err)
	}
	archived, err := repo.Create(ctx, orgID, userID, Fields{Title: "Archived", Archived: true})
	if err != nil {
		t.Fatalf("Create archived: %v", err)
	}

	// Default view: only non-archived notes.
	defaults, err := repo.ListFiltered(ctx, orgID, false, "")
	if err != nil {
		t.Fatalf("ListFiltered default: %v", err)
	}
	for _, n := range defaults {
		if n.ID == archived.ID {
			t.Fatalf("archived note appeared in default list")
		}
	}
	found := false
	for _, n := range defaults {
		if n.ID == regular.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("regular note missing from default list")
	}

	// Archive view: only archived notes.
	archiveList, err := repo.ListFiltered(ctx, orgID, true, "")
	if err != nil {
		t.Fatalf("ListFiltered archive: %v", err)
	}
	foundArchived := false
	for _, n := range archiveList {
		if n.ID == regular.ID {
			t.Fatalf("regular note appeared in archive list")
		}
		if n.ID == archived.ID {
			foundArchived = true
		}
	}
	if !foundArchived {
		t.Fatalf("archived note missing from archive list")
	}

	// Unarchive: note should move back to default view.
	if _, err := repo.SetArchived(ctx, orgID, archived.ID, false); err != nil {
		t.Fatalf("SetArchived(false): %v", err)
	}
	defaults2, err := repo.ListFiltered(ctx, orgID, false, "")
	if err != nil {
		t.Fatalf("ListFiltered after unarchive: %v", err)
	}
	restoredFound := false
	for _, n := range defaults2 {
		if n.ID == archived.ID {
			restoredFound = true
		}
	}
	if !restoredFound {
		t.Fatalf("unarchived note did not appear in default list")
	}
}

// TestRepository_LabelCRUDAndFilter covers creating/deleting labels, applying
// and removing them from notes, and filtering notes by label.
func TestRepository_LabelCRUDAndFilter(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	// Create a label.
	label, err := repo.CreateLabel(ctx, orgID, userID, "work")
	if err != nil {
		t.Fatalf("CreateLabel: %v", err)
	}
	if label.Name != "work" {
		t.Fatalf("label name: got %q want %q", label.Name, "work")
	}

	// List labels: one entry.
	labels, err := repo.ListLabels(ctx, orgID, userID)
	if err != nil {
		t.Fatalf("ListLabels: %v", err)
	}
	if len(labels) != 1 || labels[0].ID != label.ID {
		t.Fatalf("ListLabels: got %v", labels)
	}

	// Create two notes; apply the label to only one.
	n1, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Work note"})
	n2, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Personal note"})
	if err := repo.ApplyLabel(ctx, orgID, n1.ID, label.ID); err != nil {
		t.Fatalf("ApplyLabel: %v", err)
	}

	// Filter by label: only n1 should appear.
	filtered, err := repo.ListFiltered(ctx, orgID, false, label.ID)
	if err != nil {
		t.Fatalf("ListFiltered(label): %v", err)
	}
	if len(filtered) != 1 || filtered[0].ID != n1.ID {
		t.Fatalf("ListFiltered(label): got %v want [%s]", filtered, n1.ID)
	}
	_ = n2 // n2 should not appear in label-filtered list

	// RemoveLabel: n1 should no longer appear in filtered results.
	if err := repo.RemoveLabel(ctx, orgID, n1.ID, label.ID); err != nil {
		t.Fatalf("RemoveLabel: %v", err)
	}
	filtered2, _ := repo.ListFiltered(ctx, orgID, false, label.ID)
	if len(filtered2) != 0 {
		t.Fatalf("after RemoveLabel, got %d notes want 0", len(filtered2))
	}

	// DeleteLabel: should remove the label.
	if err := repo.DeleteLabel(ctx, orgID, userID, label.ID); err != nil {
		t.Fatalf("DeleteLabel: %v", err)
	}
	labels2, _ := repo.ListLabels(ctx, orgID, userID)
	if len(labels2) != 0 {
		t.Fatalf("after DeleteLabel, got %d labels want 0", len(labels2))
	}
}
