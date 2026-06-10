package drive

import (
	"context"
	"testing"
)

// TestVersions_CreateOnReplace verifies that uploading new content for an
// existing file creates a version row containing the previous blob key, and
// that the file row is updated to point at the new blob.
func TestVersions_CreateOnReplace(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	f, err := r.CreateFile(ctx, orgID, userID, "", "doc.txt", "text/plain", "blobs/v1", 100)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Snapshot current blob as a version before replacing.
	v1, err := r.CreateVersion(ctx, orgID, f.ID, "blobs/v1", "text/plain", userID, 100)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	if v1.BlobKey != "blobs/v1" {
		t.Errorf("version blob_key: got %q want blobs/v1", v1.BlobKey)
	}

	// Replace the file's blob.
	oldKey, err := r.ReplaceBlob(ctx, orgID, f.ID, "blobs/v2", "text/plain", 200)
	if err != nil {
		t.Fatalf("replace blob: %v", err)
	}
	if oldKey != "blobs/v1" {
		t.Errorf("returned old key: got %q want blobs/v1", oldKey)
	}

	// The file row should now reference the new blob.
	updated, err := r.Get(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("get after replace: %v", err)
	}
	if updated.StorageKey == nil || *updated.StorageKey != "blobs/v2" {
		t.Errorf("file storage_key after replace: got %v want blobs/v2", updated.StorageKey)
	}
	if updated.SizeBytes != 200 {
		t.Errorf("file size_bytes after replace: got %d want 200", updated.SizeBytes)
	}
}

// TestVersions_ListOrdering verifies that ListVersions returns rows most-recent first.
func TestVersions_ListOrdering(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	f, err := r.CreateFile(ctx, orgID, userID, "", "order.txt", "text/plain", "blobs/a", 10)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := r.CreateVersion(ctx, orgID, f.ID, "blobs/a", "text/plain", userID, 10); err != nil {
		t.Fatalf("version a: %v", err)
	}
	if _, err := r.CreateVersion(ctx, orgID, f.ID, "blobs/b", "text/plain", userID, 20); err != nil {
		t.Fatalf("version b: %v", err)
	}
	if _, err := r.CreateVersion(ctx, orgID, f.ID, "blobs/c", "text/plain", userID, 30); err != nil {
		t.Fatalf("version c: %v", err)
	}

	versions, err := r.ListVersions(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(versions) != 3 {
		t.Fatalf("expected 3 versions, got %d", len(versions))
	}
	// Most-recent first: c > b > a (by created_at DESC, but insertion order is
	// deterministic in a single test so rely on the inserted blob keys).
	// Since created_at has microsecond precision and all three inserts happen in
	// rapid succession we use size_bytes as the tie-break proxy: last-inserted
	// has highest size.
	if versions[0].SizeBytes < versions[1].SizeBytes {
		t.Errorf("ordering: versions[0].size=%d should be >= versions[1].size=%d", versions[0].SizeBytes, versions[1].SizeBytes)
	}
}

// TestVersions_Restore verifies that restoring a version swaps the current blob
// and keeps the former current blob in history.
func TestVersions_Restore(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	f, err := r.CreateFile(ctx, orgID, userID, "", "restore.txt", "text/plain", "blobs/orig", 5)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Record version of the original content.
	v1, err := r.CreateVersion(ctx, orgID, f.ID, "blobs/orig", "text/plain", userID, 5)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}

	// Replace with new content.
	if _, err := r.ReplaceBlob(ctx, orgID, f.ID, "blobs/new", "text/plain", 99); err != nil {
		t.Fatalf("replace: %v", err)
	}

	// Restore: snapshot current, then replace back.
	curAfterReplace, _ := r.Get(ctx, orgID, f.ID)
	if _, serr := r.CreateVersion(ctx, orgID, f.ID, *curAfterReplace.StorageKey, curAfterReplace.MimeType, userID, curAfterReplace.SizeBytes); serr != nil {
		t.Fatalf("snapshot before restore: %v", serr)
	}
	if _, rerr := r.ReplaceBlob(ctx, orgID, f.ID, v1.BlobKey, v1.ContentType, v1.SizeBytes); rerr != nil {
		t.Fatalf("restore replace: %v", rerr)
	}
	// Delete the restored version row.
	if _, derr := pool.Exec(ctx, `DELETE FROM grown.drive_file_versions WHERE org_id = $1 AND id = $2`, orgID, v1.ID); derr != nil {
		t.Fatalf("delete version: %v", derr)
	}

	// File now points at the original blob.
	restored, _ := r.Get(ctx, orgID, f.ID)
	if restored.StorageKey == nil || *restored.StorageKey != "blobs/orig" {
		t.Errorf("after restore: storage_key=%v want blobs/orig", restored.StorageKey)
	}

	// History still contains the "new" blob as a version.
	versions, _ := r.ListVersions(ctx, orgID, f.ID)
	found := false
	for _, v := range versions {
		if v.BlobKey == "blobs/new" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected blobs/new to remain in history, got %+v", versions)
	}
}

// TestVersions_Copy verifies that a copied file is independent (its own row
// with no shared versions).
func TestVersions_Copy(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	r := NewRepository(pool)
	ctx := context.Background()

	src, err := r.CreateFile(ctx, orgID, userID, "", "src.txt", "text/plain", "blobs/src", 7)
	if err != nil {
		t.Fatalf("create src: %v", err)
	}
	// Add a version to the source.
	if _, err := r.CreateVersion(ctx, orgID, src.ID, "blobs/src-old", "text/plain", userID, 3); err != nil {
		t.Fatalf("version on src: %v", err)
	}

	// Copy: new file row with a different storage key.
	cpy, err := r.CreateFile(ctx, orgID, userID, "", copyName(src.Name), "text/plain", "blobs/copy", 7)
	if err != nil {
		t.Fatalf("create copy: %v", err)
	}
	if cpy.ID == src.ID {
		t.Errorf("copy has same id as source")
	}

	// Copy has no versions of its own.
	versions, err := r.ListVersions(ctx, orgID, cpy.ID)
	if err != nil {
		t.Fatalf("list copy versions: %v", err)
	}
	if len(versions) != 0 {
		t.Errorf("copy should have 0 versions, got %d", len(versions))
	}
}
