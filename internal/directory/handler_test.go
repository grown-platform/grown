package directory

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/storage"
	"code.pick.haus/grown/grown/internal/users"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- Pure-logic tests (no DB, always run) -----------------------------------

func TestDisplayName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		in    string
		email string
		want  string
	}{
		{"name present", "Alice Smith", "alice@example.com", "Alice Smith"},
		{"empty name falls back to email", "", "bob@example.com", "bob@example.com"},
		{"whitespace name falls back to email", "   ", "carol@example.com", "carol@example.com"},
		{"tab/newline name falls back to email", "\t\n", "dave@example.com", "dave@example.com"},
		{"name kept even with surrounding spaces", "  Eve  ", "eve@example.com", "  Eve  "},
		{"both empty yields empty", "", "", ""},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := displayName(tt.in, tt.email); got != tt.want {
				t.Fatalf("displayName(%q, %q) = %q, want %q", tt.in, tt.email, got, tt.want)
			}
		})
	}
}

// newReq builds a GET /api/v1/directory request, optionally attaching an
// authenticated user and/or an org to its context.
func newReq(t *testing.T, query string, withUser, withOrg bool) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/directory?q="+query, nil)
	ctx := r.Context()
	if withUser {
		ctx = auth.WithUser(ctx, users.User{ID: "caller", OrgID: "org1"})
	}
	if withOrg {
		ctx = auth.WithOrg(ctx, orgs.Org{ID: "org1", Slug: "default"})
	}
	return r.WithContext(ctx)
}

// TestServeHTTP_EarlyReturns covers every code path that returns BEFORE the
// handler touches the users repository, so they run without a database.
func TestServeHTTP_EarlyReturns(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		method     string
		withUser   bool
		withOrg    bool
		wantStatus int
	}{
		{"non-GET rejected", http.MethodPost, true, true, http.StatusMethodNotAllowed},
		{"PUT rejected", http.MethodPut, true, true, http.StatusMethodNotAllowed},
		{"DELETE rejected", http.MethodDelete, true, true, http.StatusMethodNotAllowed},
		{"missing user is unauthorized", http.MethodGet, false, true, http.StatusUnauthorized},
		{"missing org is 500", http.MethodGet, true, false, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// nil repo is safe: none of these paths reach it.
			h := NewHandler(nil, "https://issuer", "", "")
			r := newReq(t, "", tt.withUser, tt.withOrg)
			r.Method = tt.method
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%q)", w.Code, tt.wantStatus, w.Body.String())
			}
		})
	}
}

func TestNewHandler_TrimsZitadelURL(t *testing.T) {
	t.Parallel()
	h := NewHandler(nil, "iss", "https://zitadel.example/", "tok")
	if h.zitadelURL != "https://zitadel.example" {
		t.Fatalf("zitadelURL = %q, want trailing slash trimmed", h.zitadelURL)
	}
	if h.client == nil {
		t.Fatal("expected an http client to be constructed")
	}
	if h.issuer != "iss" || h.zitadelToken != "tok" {
		t.Fatalf("issuer/token not stored: %q / %q", h.issuer, h.zitadelToken)
	}
}

// ---- Integration tests (require GROWN_TEST_DSN) -----------------------------

// setupDB spins up a clean grown schema and returns a pool plus the default
// org's id. It skips the test when GROWN_TEST_DSN is unset, matching the
// convention used by internal/search and internal/contacts.
func setupDB(t *testing.T) (pool *pgxpool.Pool, defaultOrgID string) {
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
	if err := pool.QueryRow(ctx, `SELECT id::text FROM grown.orgs WHERE slug='default'`).Scan(&defaultOrgID); err != nil {
		t.Fatalf("default org: %v", err)
	}
	return pool, defaultOrgID
}

// seedUser inserts a grown.users row and returns its id.
func seedUser(t *testing.T, pool *pgxpool.Pool, orgID, issuer, subject, email, name string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
		orgID, issuer, subject, email, name,
	).Scan(&id); err != nil {
		t.Fatalf("seed user %q: %v", email, err)
	}
	return id
}

// doRequest runs the handler for an authenticated GET with the given query and
// decodes the returned members.
func doRequest(t *testing.T, h *Handler, org orgs.Org, query string) []Member {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/directory?q="+query, nil)
	ctx := auth.WithOrg(auth.WithUser(r.Context(), users.User{ID: "caller", OrgID: org.ID}), org)
	r = r.WithContext(ctx)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", w.Code, w.Body.String())
	}
	var resp struct {
		Members []Member `json:"members"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if resp.Members == nil {
		t.Fatal("members must be a non-nil array, never null")
	}
	return resp.Members
}

func memberByEmail(ms []Member, email string) (Member, bool) {
	for _, m := range ms {
		if m.Email == email {
			return m, true
		}
	}
	return Member{}, false
}

// TestServeHTTP_GrownKnownUsers checks the Zitadel-disabled path: only grown's
// own users are returned, filtered by query and scoped to the org.
func TestServeHTTP_GrownKnownUsers(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := users.NewRepository(pool)
	seedUser(t, pool, orgID, "iss", "s1", "alice@example.com", "Alice Anderson")
	seedUser(t, pool, orgID, "iss", "s2", "bob@example.com", "Bob Brown")

	// No Zitadel configured → only grown-known users.
	h := NewHandler(repo, "iss", "", "")
	org := orgs.Org{ID: orgID, Slug: "default"}

	t.Run("empty query returns all org users sorted", func(t *testing.T) {
		ms := doRequest(t, h, org, "")
		if len(ms) != 2 {
			t.Fatalf("got %d members, want 2: %+v", len(ms), ms)
		}
		if ms[0].Email != "alice@example.com" || ms[1].Email != "bob@example.com" {
			t.Fatalf("expected alice then bob (sorted), got %+v", ms)
		}
	})

	t.Run("name substring filter", func(t *testing.T) {
		ms := doRequest(t, h, org, "alice")
		if len(ms) != 1 {
			t.Fatalf("got %d, want 1: %+v", len(ms), ms)
		}
		if ms[0].Name != "Alice Anderson" {
			t.Fatalf("name = %q", ms[0].Name)
		}
	})

	t.Run("email substring filter is case-insensitive", func(t *testing.T) {
		ms := doRequest(t, h, org, "BOB@")
		if len(ms) != 1 {
			t.Fatalf("got %d, want 1: %+v", len(ms), ms)
		}
		if ms[0].Email != "bob@example.com" {
			t.Fatalf("email = %q", ms[0].Email)
		}
	})

	t.Run("no match yields empty array", func(t *testing.T) {
		ms := doRequest(t, h, org, "nobody")
		if len(ms) != 0 {
			t.Fatalf("got %d, want 0: %+v", len(ms), ms)
		}
	})
}

// TestServeHTTP_DisplayNameFallback verifies the handler applies the email
// fallback when a grown user has no display name.
func TestServeHTTP_DisplayNameFallback(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := users.NewRepository(pool)
	seedUser(t, pool, orgID, "iss", "s1", "noname@example.com", "")

	h := NewHandler(repo, "iss", "", "")
	ms := doRequest(t, h, orgs.Org{ID: orgID}, "")
	if len(ms) != 1 {
		t.Fatalf("got %d, want 1", len(ms))
	}
	if ms[0].Name != "noname@example.com" {
		t.Fatalf("name = %q, want email fallback", ms[0].Name)
	}
}

// TestServeHTTP_OrgIsolation ensures a search never leaks users from another org.
func TestServeHTTP_OrgIsolation(t *testing.T) {
	pool, org1 := setupDB(t)
	var org2 string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.orgs (slug, display_name) VALUES ('second','Second') RETURNING id::text`,
	).Scan(&org2); err != nil {
		t.Fatalf("seed org2: %v", err)
	}
	repo := users.NewRepository(pool)
	seedUser(t, pool, org1, "iss", "a", "in-org@example.com", "In Org")
	seedUser(t, pool, org2, "iss", "b", "other-org@example.com", "Other Org")

	h := NewHandler(repo, "iss", "", "")
	ms := doRequest(t, h, orgs.Org{ID: org1}, "")
	if len(ms) != 1 {
		t.Fatalf("got %d, want 1 (org isolation): %+v", len(ms), ms)
	}
	if ms[0].Email != "in-org@example.com" {
		t.Fatalf("leaked cross-org user: %+v", ms)
	}
}

// TestServeHTTP_ZitadelEnrichment exercises the live-search branch against a
// fake Zitadel server. Matches are only surfaced when the user ALSO has a grown
// row in the same org (the security invariant in appendZitadel), and grown-known
// results are not duplicated.
func TestServeHTTP_ZitadelEnrichment(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := users.NewRepository(pool)
	const issuer = "https://auth.example"

	// alice: grown-known AND in Zitadel (must not be duplicated).
	seedUser(t, pool, orgID, issuer, "zid-alice", "alice@example.com", "Alice")
	// carol: has a grown row in this org but only surfaces via Zitadel search.
	carolID := seedUser(t, pool, orgID, issuer, "zid-carol", "carol@example.com", "Carol")

	// Fake Zitadel /v2/users returning alice, carol, and a stranger (eve) who has
	// NO grown row in this org and therefore must be filtered out.
	var gotAuth string
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.Method != http.MethodPost || r.URL.Path != "/v2/users" {
			http.Error(w, "unexpected", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"result":[
			{"userId":"zid-alice","human":{"profile":{"displayName":"Alice Z"},"email":{"email":"alice@example.com"}}},
			{"userId":"zid-carol","human":{"profile":{"givenName":"Carol","familyName":"Carter"},"email":{"email":"carol@example.com"}}},
			{"userId":"zid-eve","human":{"profile":{"displayName":"Eve Stranger"},"email":{"email":"eve@example.com"}}},
			{"userId":"","human":{"profile":{"displayName":"No Id"},"email":{"email":"skip@example.com"}}}
		]}`))
	}))
	t.Cleanup(stub.Close)

	h := NewHandler(repo, issuer, stub.URL, "service-token")
	ms := doRequest(t, h, orgs.Org{ID: orgID}, "a")

	if gotAuth != "Bearer service-token" {
		t.Fatalf("Authorization header = %q, want bearer token", gotAuth)
	}

	// alice appears exactly once; carol surfaces via Zitadel; eve filtered out.
	if _, ok := memberByEmail(ms, "eve@example.com"); ok {
		t.Fatalf("stranger eve must NOT be surfaced: %+v", ms)
	}
	count := 0
	for _, m := range ms {
		if m.Email == "alice@example.com" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("alice should appear exactly once, got %d: %+v", count, ms)
	}
	carol, ok := memberByEmail(ms, "carol@example.com")
	if !ok {
		t.Fatalf("carol should be surfaced via Zitadel: %+v", ms)
	}
	if carol.ID != carolID {
		t.Fatalf("carol id = %q, want grown id %q", carol.ID, carolID)
	}
	// Zitadel displayName/given+family fallback applied.
	if carol.Name != "Carol Carter" {
		t.Fatalf("carol name = %q, want given+family fallback", carol.Name)
	}
}

// TestServeHTTP_ZitadelBestEffort verifies a failing Zitadel server does not
// break the response: grown-known users are still returned.
func TestServeHTTP_ZitadelBestEffort(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := users.NewRepository(pool)
	seedUser(t, pool, orgID, "iss", "s1", "alice@example.com", "Alice")

	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(stub.Close)

	h := NewHandler(repo, "iss", stub.URL, "tok")
	ms := doRequest(t, h, orgs.Org{ID: orgID}, "")
	if len(ms) != 1 || ms[0].Email != "alice@example.com" {
		t.Fatalf("expected grown-known alice despite Zitadel failure: %+v", ms)
	}
}
