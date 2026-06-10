package forms

import (
	"context"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupDB drops and recreates the grown schema, runs migrations, and seeds an
// org + user so form rows can satisfy their foreign keys. Skips unless
// GROWN_TEST_DSN points at a throwaway Postgres.
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

	var orgID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM grown.orgs WHERE slug = 'default'`).Scan(&orgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	var userID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', 'subject-1', 'tester@grown.localtest.me', 'Tester')
		 RETURNING id::text`, orgID).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return pool, orgID, userID
}

func sampleQuestions() []Question {
	return []Question{
		{ID: "q1", Type: TypeShortAnswer, Title: "Name", Required: true},
		{ID: "q2", Type: TypeMultipleChoice, Title: "Color", Options: []string{"Red", "Blue"}},
		{ID: "q3", Type: TypeCheckboxes, Title: "Pets", Options: []string{"Cat", "Dog", "Fish"}},
		{ID: "q4", Type: TypeLinearScale, Title: "Rating", ScaleMin: 1, ScaleMax: 5},
	}
}

func TestRepository_CreateAndGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	created, err := repo.Create(ctx, orgID, userID, Fields{
		Title:       "Survey",
		Description: "A test survey",
		Questions:   sampleQuestions(),
		Accepting:   true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if created.Title != "Survey" || created.Description != "A test survey" {
		t.Errorf("title/desc mismatch: %+v", created)
	}
	if created.OrgID != orgID || created.OwnerID != userID {
		t.Errorf("org/owner mismatch: %+v", created)
	}
	if len(created.Questions) != 4 {
		t.Fatalf("questions len: got %d want 4", len(created.Questions))
	}
	if created.Questions[1].Type != TypeMultipleChoice || len(created.Questions[1].Options) != 2 {
		t.Errorf("question option round-trip failed: %+v", created.Questions[1])
	}
	if !created.Accepting {
		t.Error("expected accepting=true")
	}

	got, err := repo.Get(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != created.ID || got.Title != "Survey" || len(got.Questions) != 4 {
		t.Errorf("Get mismatch: %+v", got)
	}
}

func TestRepository_Get_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.Get(context.Background(), orgID, "00000000-0000-0000-0000-000000000000")
	if err != ErrNotFound {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func TestRepository_Get_ScopedByOrg(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	f, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Private"})

	// Create a second org and confirm it cannot read the first org's form.
	var otherOrg string
	if err := pool.QueryRow(ctx,
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('other', 'Other') RETURNING id::text`).Scan(&otherOrg); err != nil {
		t.Fatalf("seed other org: %v", err)
	}
	if _, err := repo.Get(ctx, otherOrg, f.ID); err != ErrNotFound {
		t.Errorf("cross-org Get: got %v want ErrNotFound", err)
	}
}

func TestRepository_List(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	if _, err := repo.Create(ctx, orgID, userID, Fields{Title: "A"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Create(ctx, orgID, userID, Fields{Title: "B"}); err != nil {
		t.Fatal(err)
	}
	list, err := repo.List(ctx, orgID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("List len: got %d want 2", len(list))
	}
}

func TestRepository_Update(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	f, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Before", Accepting: true})
	got, err := repo.Update(ctx, orgID, f.ID, Fields{
		Title:       "After",
		Description: "now with desc",
		Questions:   sampleQuestions(),
		Settings:    Settings{CollectEmail: true, ShowProgressBar: true},
		Accepting:   false,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got.Title != "After" || got.Description != "now with desc" {
		t.Errorf("update fields: %+v", got)
	}
	if len(got.Questions) != 4 {
		t.Errorf("questions len after update: got %d want 4", len(got.Questions))
	}
	if !got.Settings.CollectEmail || !got.Settings.ShowProgressBar {
		t.Errorf("settings round-trip failed: %+v", got.Settings)
	}
	if got.Accepting {
		t.Error("expected accepting=false after update")
	}
}

func TestRepository_Update_NotFound(t *testing.T) {
	pool, orgID, _ := setupDB(t)
	repo := NewRepository(pool)
	_, err := repo.Update(context.Background(), orgID,
		"00000000-0000-0000-0000-000000000000", Fields{Title: "x"})
	if err != ErrNotFound {
		t.Errorf("got %v want ErrNotFound", err)
	}
}

func TestRepository_Trash_HidesFromGetAndList(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	f, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Doomed"})
	if err := repo.Trash(ctx, orgID, f.ID); err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if _, err := repo.Get(ctx, orgID, f.ID); err != ErrNotFound {
		t.Errorf("Get after trash: got %v want ErrNotFound", err)
	}
	list, _ := repo.List(ctx, orgID)
	if len(list) != 0 {
		t.Errorf("List after trash: got %d want 0", len(list))
	}
	if err := repo.Trash(ctx, orgID, f.ID); err != ErrNotFound {
		t.Errorf("double trash: got %v want ErrNotFound", err)
	}
}

func TestRepository_Responses_RoundTripAndCount(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	f, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Poll", Questions: sampleQuestions(), Accepting: true})

	_, err := repo.SubmitResponse(ctx, orgID, f.ID, userID, "a@example.com", map[string]any{
		"q1": "Ada",
		"q2": "Red",
		"q3": []any{"Cat", "Dog"},
		"q4": "5",
	}, nil)
	if err != nil {
		t.Fatalf("SubmitResponse: %v", err)
	}
	// Anonymous submission (no respondent id).
	if _, err := repo.SubmitResponse(ctx, orgID, f.ID, "", "", map[string]any{
		"q1": "Alan", "q2": "Blue", "q3": []any{"Fish"}, "q4": "3",
	}, nil); err != nil {
		t.Fatalf("anonymous SubmitResponse: %v", err)
	}

	list, err := repo.ListResponses(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("ListResponses: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("responses len: got %d want 2", len(list))
	}
	// Newest first; verify checkbox list round-trips as []any.
	if got, ok := list[0].Answers["q3"].([]any); !ok || len(got) != 1 {
		t.Errorf("anonymous q3 answer: %#v", list[0].Answers["q3"])
	}

	// response_count reflected on the form Get.
	got, _ := repo.Get(ctx, orgID, f.ID)
	if got.ResponseCount != 2 {
		t.Errorf("ResponseCount: got %d want 2", got.ResponseCount)
	}
}

func TestRepository_DeleteResponses(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	f, _ := repo.Create(ctx, orgID, userID, Fields{Title: "Poll", Accepting: true})
	for i := 0; i < 3; i++ {
		if _, err := repo.SubmitResponse(ctx, orgID, f.ID, userID, "", map[string]any{"q1": "x"}, nil); err != nil {
			t.Fatalf("SubmitResponse: %v", err)
		}
	}
	n, err := repo.DeleteResponses(ctx, orgID, f.ID)
	if err != nil {
		t.Fatalf("DeleteResponses: %v", err)
	}
	if n != 3 {
		t.Errorf("deleted: got %d want 3", n)
	}
	list, _ := repo.ListResponses(ctx, orgID, f.ID)
	if len(list) != 0 {
		t.Errorf("responses after delete: got %d want 0", len(list))
	}
}
