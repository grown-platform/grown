package forms

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

// limitForm creates an accepting form with one optional question and the
// given "Limit to 1 response" setting.
func limitForm(t *testing.T, repo *Repository, orgID, userID string, limit bool) Form {
	t.Helper()
	f, err := repo.Create(context.Background(), orgID, userID, Fields{
		Title:     "Once only",
		Questions: []Question{{ID: "q1", Type: TypeShortAnswer, Title: "Name"}},
		Settings:  Settings{LimitOneResponse: limit},
		Accepting: true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return f
}

func seedUser(t *testing.T, pool *pgxpool.Pool, orgID, subject string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1, 'test', $2, $2 || '@grown.localtest.me', $2) RETURNING id::text`,
		orgID, subject).Scan(&id); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return id
}

func countResponses(t *testing.T, repo *Repository, orgID, formID string) int {
	t.Helper()
	list, err := repo.ListResponses(context.Background(), orgID, formID)
	if err != nil {
		t.Fatalf("ListResponses: %v", err)
	}
	return len(list)
}

func submitReq(formID string) *grownv1.SubmitFormResponseRequest {
	return &grownv1.SubmitFormResponseRequest{FormId: formID, AnswersJson: `{"q1":"Ada"}`}
}

func TestLimitOne_SecondSubmitRejected(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authedCtx(orgID, userID)
	f := limitForm(t, repo, orgID, userID, true)

	if _, err := svc.SubmitFormResponse(ctx, submitReq(f.ID)); err != nil {
		t.Fatalf("first submit: %v", err)
	}
	_, err := svc.SubmitFormResponse(ctx, submitReq(f.ID))
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("second submit: got %v, want AlreadyExists", err)
	}
	if !strings.Contains(status.Convert(err).Message(), "already responded") {
		t.Errorf("message: %q", status.Convert(err).Message())
	}
	if n := countResponses(t, repo, orgID, f.ID); n != 1 {
		t.Fatalf("responses: got %d want 1", n)
	}

	// Another signed-in user can still respond once.
	other := seedUser(t, pool, orgID, "other")
	if _, err := svc.SubmitFormResponse(authedCtx(orgID, other), submitReq(f.ID)); err != nil {
		t.Fatalf("other user's submit: %v", err)
	}
	if n := countResponses(t, repo, orgID, f.ID); n != 2 {
		t.Fatalf("responses: got %d want 2", n)
	}
}

func TestLimitOne_ConcurrentSubmitsYieldOneResponse(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	f := limitForm(t, repo, orgID, userID, true)

	// Run the race several times: each round a fresh user fires two
	// submissions at once, and exactly one may land.
	for round := 0; round < 10; round++ {
		uid := seedUser(t, pool, orgID, "racer-"+string(rune('a'+round)))
		start := make(chan struct{})
		errs := make([]error, 2)
		var wg sync.WaitGroup
		for i := range errs {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				_, errs[i] = repo.SubmitResponse(context.Background(), orgID, f.ID, uid, "", map[string]any{"q1": "x"}, nil)
			}(i)
		}
		close(start)
		wg.Wait()

		ok, dup := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ErrAlreadyResponded):
				dup++
			default:
				t.Fatalf("round %d: unexpected error %v", round, err)
			}
		}
		if ok != 1 || dup != 1 {
			t.Fatalf("round %d: %d succeeded, %d rejected; want 1 and 1", round, ok, dup)
		}
	}
	if n := countResponses(t, repo, orgID, f.ID); n != 10 {
		t.Fatalf("responses: got %d want 10", n)
	}
}

func TestLimitOne_AnonymousRefused(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	f := limitForm(t, repo, orgID, userID, true)

	_, err := repo.SubmitResponse(context.Background(), orgID, f.ID, "", "", map[string]any{"q1": "x"}, nil)
	if !errors.Is(err, ErrSignInRequired) {
		t.Fatalf("anonymous repo submit: got %v, want ErrSignInRequired", err)
	}
	if _, err := svc.SubmitFormResponse(context.Background(), submitReq(f.ID)); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("anonymous service submit: got %v, want Unauthenticated", err)
	}
	if n := countResponses(t, repo, orgID, f.ID); n != 0 {
		t.Fatalf("responses: got %d want 0", n)
	}
}

func TestLimitOne_OffAllowsMultiple(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authedCtx(orgID, userID)
	f := limitForm(t, repo, orgID, userID, false)

	for i := 0; i < 3; i++ {
		if _, err := svc.SubmitFormResponse(ctx, submitReq(f.ID)); err != nil {
			t.Fatalf("submit %d: %v", i, err)
		}
	}
	// Anonymous responses are still allowed without the limit.
	if _, err := repo.SubmitResponse(context.Background(), orgID, f.ID, "", "", map[string]any{"q1": "x"}, nil); err != nil {
		t.Fatalf("anonymous submit: %v", err)
	}
	if n := countResponses(t, repo, orgID, f.ID); n != 4 {
		t.Fatalf("responses: got %d want 4", n)
	}
}

// Turning the limit on after someone responded still stops their second
// response, even though their first row predates the limit.
func TestLimitOne_TurnedOnAfterResponding(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authedCtx(orgID, userID)
	f := limitForm(t, repo, orgID, userID, false)

	if _, err := svc.SubmitFormResponse(ctx, submitReq(f.ID)); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if _, err := svc.UpdateForm(ctx, &grownv1.UpdateFormRequest{
		Id: f.ID, Title: f.Title, Questions: []*grownv1.FormQuestion{questionToProto(f.Questions[0])},
		Settings: &grownv1.FormSettings{LimitOneResponse: true}, Accepting: true,
	}); err != nil {
		t.Fatalf("UpdateForm: %v", err)
	}
	if _, err := svc.SubmitFormResponse(ctx, submitReq(f.ID)); status.Code(err) != codes.AlreadyExists {
		t.Fatalf("submit after limit on: got %v, want AlreadyExists", err)
	}
}

func TestLimitOne_MyResponse(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo)
	ctx := authedCtx(orgID, userID)
	f := limitForm(t, repo, orgID, userID, true)

	st, err := svc.MyResponse(ctx, f.ID)
	if err != nil || st.Responded {
		t.Fatalf("before submit: %+v err=%v", st, err)
	}
	resp, err := svc.SubmitFormResponse(ctx, submitReq(f.ID))
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	st, err = svc.MyResponse(ctx, f.ID)
	if err != nil || !st.Responded || st.ResponseID != resp.Id {
		t.Fatalf("after submit: %+v err=%v", st, err)
	}

	// Over HTTP.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/forms/"+f.ID+"/my-response", nil).WithContext(ctx)
	svc.ServeMyResponse(rec, req, f.ID)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"responded":true`) {
		t.Fatalf("HTTP: %d %s", rec.Code, rec.Body.String())
	}

	// Unknown form.
	if _, err := svc.MyResponse(ctx, "00000000-0000-0000-0000-000000000000"); status.Code(err) != codes.NotFound {
		t.Fatalf("unknown form: got %v, want NotFound", err)
	}
}
