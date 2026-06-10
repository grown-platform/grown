package books

// reading_test.go — integration tests for progress, bookmarks, highlights,
// and shelves. All tests skip when GROWN_TEST_DSN is not set (same guard as
// repository_test.go).

import (
	"context"
	"testing"
)

// TestRepository_ProgressUpsert verifies that SetProgress upserts correctly
// and GetProgress returns it, and that org isolation is enforced.
func TestRepository_ProgressUpsert(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "Prog", Format: "epub"})

	// First set.
	p, err := r.SetProgress(ctx, orgID, userID, b.ID, "ch3", 30)
	if err != nil {
		t.Fatalf("SetProgress: %v", err)
	}
	if p.Locator != "ch3" || p.Percent != 30 {
		t.Errorf("unexpected progress: %+v", p)
	}

	// Upsert with updated values.
	p2, err := r.SetProgress(ctx, orgID, userID, b.ID, "ch7", 75)
	if err != nil {
		t.Fatalf("SetProgress upsert: %v", err)
	}
	if p2.Locator != "ch7" || p2.Percent != 75 {
		t.Errorf("upsert not applied: %+v", p2)
	}

	// GetProgress returns the latest.
	got, err := r.GetProgress(ctx, orgID, userID, b.ID)
	if err != nil {
		t.Fatalf("GetProgress: %v", err)
	}
	if got.Locator != "ch7" || got.Percent != 75 {
		t.Errorf("GetProgress returned %+v", got)
	}

	// Percent is clamped at 100.
	pClamped, err := r.SetProgress(ctx, orgID, userID, b.ID, "end", 150)
	if err != nil {
		t.Fatalf("SetProgress clamp: %v", err)
	}
	if pClamped.Percent != 100 {
		t.Errorf("percent not clamped: %d", pClamped.Percent)
	}

	// Cross-org access returns ErrNotFound.
	var otherOrg string
	pool.QueryRow(ctx, `INSERT INTO grown.orgs (slug, display_name) VALUES ('progother','PO') RETURNING id::text`).Scan(&otherOrg)
	if _, err := r.SetProgress(ctx, otherOrg, userID, b.ID, "x", 0); err != ErrNotFound {
		t.Errorf("expected ErrNotFound on cross-org SetProgress, got %v", err)
	}
	if _, err := r.GetProgress(ctx, otherOrg, userID, b.ID); err != ErrNotFound {
		t.Errorf("expected ErrNotFound on cross-org GetProgress, got %v", err)
	}
}

// TestRepository_BookmarkCRUD verifies add / list / delete for bookmarks.
func TestRepository_BookmarkCRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "BmBook", Format: "txt"})

	bm, err := r.AddBookmark(ctx, orgID, userID, b.ID, "p10", "Great quote")
	if err != nil {
		t.Fatalf("AddBookmark: %v", err)
	}
	if bm.Locator != "p10" || bm.Label != "Great quote" {
		t.Errorf("unexpected bookmark: %+v", bm)
	}

	_, _ = r.AddBookmark(ctx, orgID, userID, b.ID, "p20", "Another")
	list, err := r.ListBookmarks(ctx, orgID, userID, b.ID)
	if err != nil {
		t.Fatalf("ListBookmarks: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 bookmarks, got %d", len(list))
	}

	// Delete first bookmark.
	if err := r.DeleteBookmark(ctx, orgID, userID, bm.ID); err != nil {
		t.Fatalf("DeleteBookmark: %v", err)
	}
	list2, _ := r.ListBookmarks(ctx, orgID, userID, b.ID)
	if len(list2) != 1 {
		t.Errorf("expected 1 bookmark after delete, got %d", len(list2))
	}

	// Double-delete returns ErrNotFound.
	if err := r.DeleteBookmark(ctx, orgID, userID, bm.ID); err != ErrNotFound {
		t.Errorf("double delete: want ErrNotFound got %v", err)
	}

	// Cross-org add should fail.
	var otherOrg string
	pool.QueryRow(ctx, `INSERT INTO grown.orgs (slug, display_name) VALUES ('bmotherorg','BO') RETURNING id::text`).Scan(&otherOrg)
	if _, err := r.AddBookmark(ctx, otherOrg, userID, b.ID, "x", "y"); err != ErrNotFound {
		t.Errorf("expected ErrNotFound on cross-org AddBookmark, got %v", err)
	}
}

// TestRepository_HighlightCRUD verifies add / list / delete for highlights.
func TestRepository_HighlightCRUD(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "HlBook", Format: "epub"})

	h, err := r.AddHighlight(ctx, orgID, userID, b.ID, "loc1", "some text", "my note", "green")
	if err != nil {
		t.Fatalf("AddHighlight: %v", err)
	}
	if h.SelectedText != "some text" || h.Color != "green" || h.Note != "my note" {
		t.Errorf("unexpected highlight: %+v", h)
	}

	// Unknown color defaults to yellow.
	h2, err := r.AddHighlight(ctx, orgID, userID, b.ID, "loc2", "text2", "", "neon")
	if err != nil {
		t.Fatalf("AddHighlight unknown color: %v", err)
	}
	if h2.Color != "yellow" {
		t.Errorf("expected color yellow, got %q", h2.Color)
	}

	list, err := r.ListHighlights(ctx, orgID, userID, b.ID)
	if err != nil {
		t.Fatalf("ListHighlights: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 highlights, got %d", len(list))
	}

	// Delete.
	if err := r.DeleteHighlight(ctx, orgID, userID, h.ID); err != nil {
		t.Fatalf("DeleteHighlight: %v", err)
	}
	list2, _ := r.ListHighlights(ctx, orgID, userID, b.ID)
	if len(list2) != 1 {
		t.Errorf("expected 1 highlight after delete, got %d", len(list2))
	}
	if err := r.DeleteHighlight(ctx, orgID, userID, h.ID); err != ErrNotFound {
		t.Errorf("double delete highlight: want ErrNotFound got %v", err)
	}
}

// TestRepository_ShelfMembership verifies shelf CRUD + book membership.
func TestRepository_ShelfMembership(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	sh, err := r.CreateShelf(ctx, orgID, userID, "Favourites")
	if err != nil {
		t.Fatalf("CreateShelf: %v", err)
	}
	if sh.Name != "Favourites" {
		t.Errorf("shelf name mismatch: %+v", sh)
	}

	shelves, _ := r.ListShelves(ctx, orgID, userID)
	if len(shelves) != 1 || shelves[0].ID != sh.ID {
		t.Errorf("expected 1 shelf, got %+v", shelves)
	}

	b, _ := r.Create(ctx, orgID, userID, Fields{Title: "ShelfBook", Format: "pdf"})
	if err := r.AddToShelf(ctx, orgID, userID, sh.ID, b.ID); err != nil {
		t.Fatalf("AddToShelf: %v", err)
	}

	// Duplicate add is a no-op.
	if err := r.AddToShelf(ctx, orgID, userID, sh.ID, b.ID); err != nil {
		t.Fatalf("duplicate AddToShelf should not error: %v", err)
	}

	listed, err := r.ListByShelf(ctx, orgID, sh.ID)
	if err != nil {
		t.Fatalf("ListByShelf: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != b.ID {
		t.Errorf("unexpected shelf contents: %+v", listed)
	}

	// RemoveFromShelf.
	if err := r.RemoveFromShelf(ctx, orgID, userID, sh.ID, b.ID); err != nil {
		t.Fatalf("RemoveFromShelf: %v", err)
	}
	listed2, _ := r.ListByShelf(ctx, orgID, sh.ID)
	if len(listed2) != 0 {
		t.Errorf("expected empty shelf after remove, got %+v", listed2)
	}

	// DeleteShelf.
	if err := r.DeleteShelf(ctx, orgID, userID, sh.ID); err != nil {
		t.Fatalf("DeleteShelf: %v", err)
	}
	shelves2, _ := r.ListShelves(ctx, orgID, userID)
	if len(shelves2) != 0 {
		t.Errorf("expected 0 shelves after delete, got %+v", shelves2)
	}
	if err := r.DeleteShelf(ctx, orgID, userID, sh.ID); err != ErrNotFound {
		t.Errorf("double delete shelf: want ErrNotFound got %v", err)
	}
}

// TestRepository_ShelfOrgIsolation ensures shelf / highlight / bookmark
// operations respect org boundaries.
func TestRepository_ShelfOrgIsolation(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	var otherOrg, otherUser string
	pool.QueryRow(ctx, `INSERT INTO grown.orgs (slug, display_name) VALUES ('isol2','I2') RETURNING id::text`).Scan(&otherOrg)
	pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'a2','b2','c2@d','D2') RETURNING id::text`, otherOrg).Scan(&otherUser)

	sh, _ := r.CreateShelf(ctx, orgID, userID, "Mine")
	otherBook, _ := r.Create(ctx, otherOrg, otherUser, Fields{Title: "Theirs", Format: "txt"})

	// Adding a book from another org to a shelf should fail.
	if err := r.AddToShelf(ctx, orgID, userID, sh.ID, otherBook.ID); err != ErrNotFound {
		t.Errorf("cross-org AddToShelf: want ErrNotFound got %v", err)
	}

	// ListByShelf with wrong org returns ErrNotFound.
	if _, err := r.ListByShelf(ctx, otherOrg, sh.ID); err != ErrNotFound {
		t.Errorf("cross-org ListByShelf: want ErrNotFound got %v", err)
	}
}
