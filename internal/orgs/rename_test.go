package orgs

import (
	"context"
	"testing"
)

// TestRepository_UpdateDisplayName renames the default org and confirms the slug
// stays stable and the change round-trips.
func TestRepository_UpdateDisplayName(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	before, err := repo.GetBySlug(ctx, "default")
	if err != nil {
		t.Fatalf("GetBySlug: %v", err)
	}

	updated, err := repo.UpdateDisplayName(ctx, before.ID, "Acme Corp")
	if err != nil {
		t.Fatalf("UpdateDisplayName: %v", err)
	}
	if updated.DisplayName != "Acme Corp" {
		t.Errorf("display_name: got %q, want Acme Corp", updated.DisplayName)
	}
	if updated.Slug != before.Slug {
		t.Errorf("slug changed: got %q, want %q (slug must stay stable)", updated.Slug, before.Slug)
	}
	if updated.ID != before.ID {
		t.Errorf("id changed: got %q, want %q", updated.ID, before.ID)
	}

	// Persisted.
	got, err := repo.GetByID(ctx, before.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.DisplayName != "Acme Corp" {
		t.Errorf("reloaded display_name: got %q, want Acme Corp", got.DisplayName)
	}
}

// TestRepository_UpdateDisplayName_NotFound returns ErrNotFound for an unknown id.
func TestRepository_UpdateDisplayName_NotFound(t *testing.T) {
	pool := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.UpdateDisplayName(context.Background(),
		"00000000-0000-0000-0000-000000000000", "Nope")
	if err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}
