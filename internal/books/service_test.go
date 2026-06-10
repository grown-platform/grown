package books

import (
	"bytes"
	"context"
	"io"
	"sync"
	"testing"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// memBlobs is an in-memory BlobStore for tests (no S3 dependency).
type memBlobs struct {
	mu   sync.Mutex
	data map[string][]byte
	ct   map[string]string
}

func newMemBlobs() *memBlobs { return &memBlobs{data: map[string][]byte{}, ct: map[string]string{}} }

func (m *memBlobs) Put(_ context.Context, key, mime string, _ int64, body io.Reader) error {
	b, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = b
	m.ct[key] = mime
	return nil
}

func (m *memBlobs) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.data[key]
	if !ok {
		return nil, "", 0, io.EOF
	}
	return io.NopCloser(bytes.NewReader(b)), m.ct[key], int64(len(b)), nil
}

// authCtx builds a context carrying a user + org, like the auth middleware does.
func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestSeedSamples_OneOfEachFormat(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()
	blobs := newMemBlobs()

	SeedSamples(ctx, repo, blobs, orgID)

	list, err := repo.List(ctx, orgID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != len(SupportedFormats) {
		t.Fatalf("expected %d seeded books, got %d", len(SupportedFormats), len(list))
	}
	seen := map[string]bool{}
	for _, b := range list {
		seen[b.Format] = true
		if b.FileKey == nil || *b.FileKey == "" {
			t.Errorf("seeded %s book has no file key", b.Format)
		}
		if !b.HasCover() {
			t.Errorf("seeded %s book has no cover", b.Format)
		}
		// Each seeded file must actually be present in the blob store.
		body, _, size, err := blobs.Get(ctx, *b.FileKey)
		if err != nil || size == 0 {
			t.Errorf("seeded %s file blob missing/empty: err=%v size=%d", b.Format, err, size)
		}
		if body != nil {
			body.Close()
		}
	}
	for _, f := range SupportedFormats {
		if !seen[f] {
			t.Errorf("format %q missing from seeded library", f)
		}
	}

	// Re-running the seeder is a no-op (library already populated).
	SeedSamples(ctx, repo, blobs, orgID)
	again, _ := repo.List(ctx, orgID)
	if len(again) != len(SupportedFormats) {
		t.Errorf("re-seed should be a no-op, got %d books", len(again))
	}
}

func TestService_CRUDFlow(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	// Reject unsupported format.
	if _, err := svc.CreateBook(ctx, &grownv1.CreateBookRequest{Title: "X", Format: "doc"}); err == nil {
		t.Fatalf("expected error for unsupported format")
	}
	// Reject empty title.
	if _, err := svc.CreateBook(ctx, &grownv1.CreateBookRequest{Title: "  ", Format: "pdf"}); err == nil {
		t.Fatalf("expected error for empty title")
	}

	created, err := svc.CreateBook(ctx, &grownv1.CreateBookRequest{Title: "Dune", Author: "Herbert", Format: "EPUB"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Format != "epub" {
		t.Errorf("format should be normalized to lowercase, got %q", created.Format)
	}

	got, err := svc.GetBook(ctx, &grownv1.GetBookRequest{Id: created.Id})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "Dune" {
		t.Errorf("get wrong: %+v", got)
	}

	upd, err := svc.UpdateBook(ctx, &grownv1.UpdateBookRequest{Id: created.Id, Title: "Dune Messiah", Author: "Herbert", Starred: true})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if upd.Title != "Dune Messiah" || !upd.Starred {
		t.Errorf("update wrong: %+v", upd)
	}

	prog, err := svc.UpdateBookProgress(ctx, &grownv1.UpdateBookProgressRequest{Id: created.Id, LastLocation: "loc5", ProgressPercent: 50})
	if err != nil {
		t.Fatalf("progress: %v", err)
	}
	if prog.LastLocation != "loc5" || prog.ProgressPercent != 50 {
		t.Errorf("progress wrong: %+v", prog)
	}

	listResp, err := svc.ListBooks(ctx, &grownv1.ListBooksRequest{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listResp.Books) != 1 {
		t.Errorf("expected 1 book, got %d", len(listResp.Books))
	}

	if _, err := svc.DeleteBook(ctx, &grownv1.DeleteBookRequest{Id: created.Id}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := svc.GetBook(ctx, &grownv1.GetBookRequest{Id: created.Id}); err == nil {
		t.Errorf("expected NotFound after delete")
	}
}
