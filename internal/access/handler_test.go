package access_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/access"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ctxKey is an unexported key type for test context values.
type ctxKey string

const (
	userIDKey ctxKey = "userID"
	orgIDKey  ctxKey = "orgID"
)

// fakeCaller is a CallerFunc backed by context values (org-scoped tests).
func fakeCaller(ctx context.Context) (userID, orgID string, ok bool) {
	u, _ := ctx.Value(userIDKey).(string)
	o, _ := ctx.Value(orgIDKey).(string)
	if o == "" {
		return "", "", false
	}
	return u, o, true
}

// withCaller stamps test-caller identity onto the request context.
func withCaller(r *http.Request, userID, orgID string) *http.Request {
	ctx := context.WithValue(r.Context(), userIDKey, userID)
	ctx = context.WithValue(ctx, orgIDKey, orgID)
	return r.WithContext(ctx)
}

// fakeAdminChecker reports admin based on context value.
type fakeAdmins map[string]bool // key = "orgID:userID"

func (f fakeAdmins) check(ctx context.Context) bool {
	u, _ := ctx.Value(userIDKey).(string)
	o, _ := ctx.Value(orgIDKey).(string)
	return f[o+":"+u]
}

// ---- Unit tests (in-memory fake repo, no DSN required) ----------------------

// fakeRepo is an in-memory Repository substitute for unit tests.
type fakeRepo struct {
	apps   map[string]access.App // id → app
	nextID int
}

func newFakeRepo() *fakeRepo { return &fakeRepo{apps: map[string]access.App{}} }

// We can't satisfy the *Repository type directly, so we test the handler
// through its full ServeHTTP interface by substituting a real repo wired to
// a real DB when DSN is available, and skip DB-backed tests otherwise.

// TestHandlerAuth verifies authentication + authorization without a real repo
// by wiring a handler whose repo is nil and checking early-exit status codes.
func TestHandlerAuth(t *testing.T) {
	// A handler with no CallerFunc must always return 401.
	h := access.NewHandler(nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/access/apps", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no-caller GET apps = %d; want 401", rr.Code)
	}
}

// TestHandlerValidation exercises URL validation independent of the DB.
func TestHandlerValidation(t *testing.T) {
	cases := []struct {
		desc       string
		body       map[string]any
		wantStatus int
	}{
		{"missing name", map[string]any{"url": "https://example.com"}, http.StatusBadRequest},
		{"missing url", map[string]any{"name": "App"}, http.StatusBadRequest},
		{"non-http url", map[string]any{"name": "App", "url": "ftp://example.com"}, http.StatusBadRequest},
		{"plain string url", map[string]any{"name": "App", "url": "not-a-url"}, http.StatusBadRequest},
	}

	admins := fakeAdmins{"org1:user1": true}
	h := access.NewHandler(nil). // nil repo → will panic if we reach DB calls
					WithCaller(fakeCaller).
					WithAdminChecker(admins.check)

	for _, tc := range cases {
		t.Run(tc.desc, func(t *testing.T) {
			body, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/access/apps", bytes.NewReader(body))
			req = withCaller(req, "user1", "org1")
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)
			if rr.Code != tc.wantStatus {
				t.Fatalf("%s: status=%d body=%s; want %d", tc.desc, rr.Code, rr.Body.String(), tc.wantStatus)
			}
		})
	}
}

// TestHandlerAdminGating verifies that POST/PUT/DELETE require admin and that
// GET is open to any member.  We use a real repo wired to a real DB so the
// admin-gating test also exercises org-scoping at the handler level.
func TestHandlerAdminGating(t *testing.T) {
	dsn := os.Getenv("GROWN_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("GROWN_POSTGRES_DSN not set — skipping DB-backed tests")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()

	repo := access.NewRepository(pool)

	// Two orgs, one admin, one plain member.
	const (
		orgA    = "00000000-0000-0000-0000-000000000001"
		orgB    = "00000000-0000-0000-0000-000000000002"
		admin1  = "00000000-0000-0000-0000-000000000010"
		member1 = "00000000-0000-0000-0000-000000000011"
	)

	admins := fakeAdmins{orgA + ":" + admin1: true}
	h := access.NewHandler(repo).
		WithCaller(fakeCaller).
		WithAdminChecker(admins.check)

	// Non-admin POST → 403.
	{
		body, _ := json.Marshal(map[string]any{"name": "Internal Wiki", "url": "https://wiki.internal"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/access/apps", bytes.NewReader(body))
		req = withCaller(req, member1, orgA)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("non-admin POST = %d; want 403", rr.Code)
		}
	}

	// Admin POST → should succeed (201) or fail with a DB constraint (the UUIDs
	// above may not be real org rows, so 500 with a FK error is acceptable — the
	// important thing is that we got PAST the auth gate).
	{
		body, _ := json.Marshal(map[string]any{"name": "Internal Wiki", "url": "https://wiki.internal", "description": "Wiki"})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/access/apps", bytes.NewReader(body))
		req = withCaller(req, admin1, orgA)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		// 201 (success) or 500 (FK constraint) — both mean authz passed.
		if rr.Code == http.StatusForbidden || rr.Code == http.StatusUnauthorized {
			t.Fatalf("admin POST = %d; want anything except 401/403 (got body: %s)", rr.Code, rr.Body.String())
		}
	}
}

// TestOrgScoping verifies that List returns only apps belonging to the caller's
// org and that Create writes to the correct org. Requires a real DB.
func TestOrgScoping(t *testing.T) {
	dsn := os.Getenv("GROWN_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("GROWN_POSTGRES_DSN not set — skipping DB-backed tests")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	defer pool.Close()

	// Insert a temporary org to avoid FK violations.
	var orgID string
	err = pool.QueryRow(ctx, `
		INSERT INTO grown.orgs (slug, display_name, created_at)
		VALUES ($1, $2, $3) RETURNING id
	`, "access-test-"+time.Now().Format("20060102150405"), "Access Test Org", time.Now()).Scan(&orgID)
	if err != nil {
		t.Fatalf("insert test org: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM grown.orgs WHERE id=$1`, orgID)
	})

	repo := access.NewRepository(pool)

	// Create two apps in our test org.
	a1, err := repo.Create(ctx, orgID, "App One", "https://one.internal", "First", "", "")
	if err != nil {
		t.Fatalf("create app1: %v", err)
	}
	_, err = repo.Create(ctx, orgID, "App Two", "https://two.internal", "Second", "", "")
	if err != nil {
		t.Fatalf("create app2: %v", err)
	}

	// List our org — must return exactly 2.
	apps, err := repo.List(ctx, orgID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(apps) != 2 {
		t.Fatalf("list returned %d apps; want 2", len(apps))
	}
	// Every returned app must belong to orgID.
	for _, a := range apps {
		if a.OrgID != orgID {
			t.Fatalf("app %s has org_id=%s; want %s", a.ID, a.OrgID, orgID)
		}
	}

	// Listing a different org must return nothing.
	const otherOrg = "00000000-0000-0000-0000-000000000099"
	other, err := repo.List(ctx, otherOrg)
	if err != nil {
		t.Fatalf("list other org: %v", err)
	}
	if len(other) != 0 {
		t.Fatalf("list other org returned %d apps; want 0 (org-scoping leak)", len(other))
	}

	// Update.
	updated, err := repo.Update(ctx, orgID, a1.ID, "App One Updated", "https://one-v2.internal", "Updated", "RocketLaunch")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "App One Updated" {
		t.Fatalf("updated name = %q; want App One Updated", updated.Name)
	}

	// Update wrong org → ErrNotFound.
	_, err = repo.Update(ctx, otherOrg, a1.ID, "Hacked", "https://hack.example", "", "")
	if err == nil {
		t.Fatal("update wrong org: expected ErrNotFound, got nil")
	}

	// Delete.
	if err := repo.Delete(ctx, orgID, a1.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	apps2, _ := repo.List(ctx, orgID)
	if len(apps2) != 1 {
		t.Fatalf("after delete: %d apps; want 1", len(apps2))
	}

	// Delete wrong org → ErrNotFound.
	if err := repo.Delete(ctx, otherOrg, apps2[0].ID); err == nil {
		t.Fatal("delete wrong org: expected ErrNotFound, got nil")
	}
}
