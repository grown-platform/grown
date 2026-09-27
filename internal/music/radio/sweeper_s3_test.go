package radio

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/drive"
	"code.pick.haus/grown/grown/internal/music"
)

// TestJanitor_S3DeletesObjects runs the janitor against a real S3 endpoint
// (the local rustfs) and verifies the objects are really gone. Gated on
// GROWN_TEST_S3_ENDPOINT, e.g.:
//
//	GROWN_TEST_S3_ENDPOINT=http://127.0.0.1:9100 GROWN_TEST_S3_ACCESS_KEY=grown \
//	GROWN_TEST_S3_SECRET_KEY='DevPassword!1' GROWN_TEST_S3_BUCKET=grown-default \
//	go test ./internal/music/radio/ -run S3
//
// It only touches keys it creates under a random music/radio/it-<hex>/ prefix:
// the orphan sweep is fed a repo that claims every other key exists.
func TestJanitor_S3DeletesObjects(t *testing.T) {
	endpoint := os.Getenv("GROWN_TEST_S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("GROWN_TEST_S3_ENDPOINT not set; skipping S3 integration test")
	}
	bucket := os.Getenv("GROWN_TEST_S3_BUCKET")
	if bucket == "" {
		bucket = "grown-default"
	}
	ctx := context.Background()
	blobs, err := drive.NewBlobs(ctx, drive.BlobsConfig{
		Endpoint:  endpoint,
		AccessKey: os.Getenv("GROWN_TEST_S3_ACCESS_KEY"),
		SecretKey: os.Getenv("GROWN_TEST_S3_SECRET_KEY"),
		Bucket:    bucket,
	})
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	prefix := blobPrefix + "it-" + hex.EncodeToString(b) + "/"

	put := func(key string) {
		t.Helper()
		body := bytes.Repeat([]byte{7}, 100)
		if err := blobs.Put(ctx, key, "audio/mpeg", int64(len(body)), bytes.NewReader(body)); err != nil {
			t.Fatalf("put %s: %v", key, err)
		}
	}
	exists := func(key string) bool {
		rc, _, _, err := blobs.Get(ctx, key)
		if err != nil {
			return false
		}
		rc.Close()
		return true
	}

	repo := &memRepo{tracks: map[string]*memTrack{}}
	for i, id := range []string{"old", "mid", "new"} {
		key := prefix + id
		put(key)
		repo.tracks[id] = &memTrack{id: id, key: key, size: 100, created: t0.Add(time.Duration(i) * time.Hour)}
	}
	orphan := prefix + "orphan"
	put(orphan)
	t.Cleanup(func() {
		for _, k := range []string{prefix + "old", prefix + "mid", prefix + "new", orphan} {
			_ = blobs.Delete(ctx, k)
		}
	})

	j := NewJanitor(&onlyOursRepo{memRepo: repo, prefix: prefix}, blobs, music.RadioCacheLimits{MaxBytes: 100}, time.Hour)
	j.now = func() time.Time { return time.Now().Add(2 * orphanGrace) }
	rep, err := j.RunOnce(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if rep.CapEvicted != 2 || rep.Purged != 2 || rep.Orphans != 1 {
		t.Fatalf("report = %+v", rep)
	}
	if exists(prefix+"old") || exists(prefix+"mid") || exists(orphan) {
		t.Fatal("evicted/orphaned objects still present in S3")
	}
	if !exists(prefix + "new") {
		t.Fatal("kept object was deleted")
	}
}

// onlyOursRepo reports every key outside prefix as referenced, so the orphan
// sweep can never touch real objects in a shared dev bucket.
type onlyOursRepo struct {
	*memRepo
	prefix string
}

func (o *onlyOursRepo) RadioBlobKeysExist(ctx context.Context, keys []string) (map[string]bool, error) {
	res, err := o.memRepo.RadioBlobKeysExist(ctx, keys)
	if err != nil {
		return nil, err
	}
	for _, k := range keys {
		if len(k) < len(o.prefix) || k[:len(o.prefix)] != o.prefix {
			res[k] = true
		}
	}
	return res, nil
}
