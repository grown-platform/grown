package drive

import (
	"context"
	"testing"
	"time"
)

func TestACL_CreateAndLookup(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	acl := NewACL(pool)
	ctx := context.Background()

	file, _ := repo.CreateFile(ctx, orgID, userID, "", "x.txt", "text/plain", "blobs/x", 1)

	tok, err := acl.CreateShare(ctx, file.ID, userID, "viewer", time.Time{})
	if err != nil {
		t.Fatalf("CreateShare: %v", err)
	}
	if len(tok) != 64 {
		t.Errorf("token length %d, want 64", len(tok))
	}

	share, err := acl.LookupShare(ctx, tok)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if share.Role != "viewer" || share.FileID != file.ID {
		t.Errorf("unexpected: %+v", share)
	}
}

func TestACL_Revoke(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	acl := NewACL(pool)
	ctx := context.Background()
	file, _ := repo.CreateFile(ctx, orgID, userID, "", "y.txt", "text/plain", "blobs/y", 1)

	tok, _ := acl.CreateShare(ctx, file.ID, userID, "viewer", time.Time{})
	if err := acl.RevokeShare(ctx, tok); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if _, err := acl.LookupShare(ctx, tok); err != ErrShareRevoked {
		t.Errorf("got %v, want ErrShareRevoked", err)
	}
}
