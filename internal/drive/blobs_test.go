package drive

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"
)

func skipUnlessRustfs(t *testing.T) {
	t.Helper()
	if os.Getenv("GROWN_RUSTFS_ENDPOINT") == "" {
		t.Skip("GROWN_RUSTFS_ENDPOINT not set; skipping blob integration test")
	}
}

func newTestBlobs(t *testing.T) *Blobs {
	t.Helper()
	skipUnlessRustfs(t)
	b, err := NewBlobs(context.Background(), BlobsConfig{
		Endpoint:  os.Getenv("GROWN_RUSTFS_ENDPOINT"),
		AccessKey: os.Getenv("GROWN_RUSTFS_ACCESS_KEY"),
		SecretKey: os.Getenv("GROWN_RUSTFS_SECRET_KEY"),
		Bucket:    os.Getenv("GROWN_RUSTFS_BUCKET"),
		Region:    "us-east-1",
	})
	if err != nil {
		t.Fatalf("NewBlobs: %v", err)
	}
	return b
}

func TestBlobs_PutGetDelete(t *testing.T) {
	b := newTestBlobs(t)
	ctx := context.Background()

	body := "hello, drive"
	if err := b.Put(ctx, "test/hello.txt", "text/plain", int64(len(body)), strings.NewReader(body)); err != nil {
		t.Fatalf("Put: %v", err)
	}

	rc, _, _, err := b.Get(ctx, "test/hello.txt")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	out, _ := io.ReadAll(rc)
	rc.Close()
	if string(out) != body {
		t.Errorf("got %q, want %q", out, body)
	}

	if err := b.Delete(ctx, "test/hello.txt"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
}
