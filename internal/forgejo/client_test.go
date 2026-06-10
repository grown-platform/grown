package forgejo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestClient builds a Client pointed at the given httptest.Server.
func newTestClient(srv *httptest.Server) *Client {
	return &Client{
		baseURL:    srv.URL,
		token:      "test-token",
		httpClient: srv.Client(),
	}
}

// ---------- CreateOrg -------------------------------------------------------

func TestCreateOrg_Success(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	if err := c.CreateOrg(context.Background(), "acme", "Acme Corp"); err != nil {
		t.Fatalf("CreateOrg: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/api/v1/orgs" {
		t.Errorf("path = %q, want /api/v1/orgs", gotPath)
	}
	if gotBody["username"] != "acme" {
		t.Errorf("body username = %v, want acme", gotBody["username"])
	}
	if gotBody["full_name"] != "Acme Corp" {
		t.Errorf("body full_name = %v, want Acme Corp", gotBody["full_name"])
	}
}

func TestCreateOrg_IdempotentOn422(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity) // 422 already exists
	}))
	defer srv.Close()

	c := newTestClient(srv)
	if err := c.CreateOrg(context.Background(), "acme", "Acme Corp"); err != nil {
		t.Fatalf("CreateOrg on 422 should be nil, got: %v", err)
	}
}

func TestCreateOrg_ErrorOnUnexpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	err := c.CreateOrg(context.Background(), "acme", "Acme Corp")
	if err == nil {
		t.Fatal("expected error for 500, got nil")
	}
}

func TestCreateOrg_NoopWhenUnconfigured(t *testing.T) {
	c := NewClient("", "")
	// Must not panic or make any real HTTP call.
	if err := c.CreateOrg(context.Background(), "acme", "Acme Corp"); err != nil {
		t.Fatalf("unconfigured CreateOrg should return nil, got: %v", err)
	}
}

// ---------- AddOrgOwner -----------------------------------------------------

func TestAddOrgOwner_Success(t *testing.T) {
	type call struct{ method, path string }
	var calls []call

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, call{r.Method, r.URL.Path})
		switch r.URL.Path {
		case "/api/v1/orgs/acme/teams":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": float64(42), "name": "Owners"},
			})
		case "/api/v1/teams/42/members/alice":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := newTestClient(srv)
	if err := c.AddOrgOwner(context.Background(), "acme", "alice"); err != nil {
		t.Fatalf("AddOrgOwner: %v", err)
	}
	if len(calls) != 2 {
		t.Fatalf("expected 2 HTTP calls, got %d: %v", len(calls), calls)
	}
	// First call: list teams
	if calls[0].method != http.MethodGet || calls[0].path != "/api/v1/orgs/acme/teams" {
		t.Errorf("call[0] = %+v, want GET /api/v1/orgs/acme/teams", calls[0])
	}
	// Second call: add member
	if calls[1].method != http.MethodPut || calls[1].path != "/api/v1/teams/42/members/alice" {
		t.Errorf("call[1] = %+v, want PUT /api/v1/teams/42/members/alice", calls[1])
	}
}

func TestAddOrgOwner_NonFatalWhenUserNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/teams") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": float64(7), "name": "Owners"},
			})
			return
		}
		w.WriteHeader(http.StatusNotFound) // user not in Forgejo
	}))
	defer srv.Close()

	c := newTestClient(srv)
	// 404 on the member-add should be swallowed.
	if err := c.AddOrgOwner(context.Background(), "acme", "nobody"); err != nil {
		t.Fatalf("AddOrgOwner with 404 should be nil, got: %v", err)
	}
}

func TestAddOrgOwner_NoopWhenUnconfigured(t *testing.T) {
	c := NewClient("", "")
	if err := c.AddOrgOwner(context.Background(), "acme", "alice"); err != nil {
		t.Fatalf("unconfigured AddOrgOwner should return nil, got: %v", err)
	}
}

// ---------- SetSiteAdmin ----------------------------------------------------

func TestSetSiteAdmin_Grant(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	if err := c.SetSiteAdmin(context.Background(), "alice", true); err != nil {
		t.Fatalf("SetSiteAdmin: %v", err)
	}
	if gotMethod != http.MethodPatch {
		t.Errorf("method = %q, want PATCH", gotMethod)
	}
	if gotPath != "/api/v1/admin/users/alice" {
		t.Errorf("path = %q, want /api/v1/admin/users/alice", gotPath)
	}
	if gotBody["admin"] != true {
		t.Errorf("body admin = %v, want true", gotBody["admin"])
	}
}

func TestSetSiteAdmin_NonFatalWhenUserNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	if err := c.SetSiteAdmin(context.Background(), "nobody", true); err != nil {
		t.Fatalf("SetSiteAdmin with 404 should be nil, got: %v", err)
	}
}

func TestSetSiteAdmin_NoopWhenUnconfigured(t *testing.T) {
	c := NewClient("", "")
	if err := c.SetSiteAdmin(context.Background(), "alice", true); err != nil {
		t.Fatalf("unconfigured SetSiteAdmin should return nil, got: %v", err)
	}
}

// ---------- Auth header -----------------------------------------------------

func TestAuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	_ = c.CreateOrg(context.Background(), "acme", "Acme")
	if gotAuth != "token test-token" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "token test-token")
	}
}

// ---------- UsernameFromEmail -----------------------------------------------

func TestUsernameFromEmail(t *testing.T) {
	tests := []struct {
		email string
		want  string
	}{
		{"alice@example.com", "alice"},
		{"bob.smith@pick.haus", "bob.smith"},
		{"noatsign", "noatsign"},
		{"@startsat", "@startsat"}, // idx == 0 → return full string
	}
	for _, tt := range tests {
		got := UsernameFromEmail(tt.email)
		if got != tt.want {
			t.Errorf("UsernameFromEmail(%q) = %q, want %q", tt.email, got, tt.want)
		}
	}
}
