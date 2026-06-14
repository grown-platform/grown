package forgejo

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeForgejo records the API calls EnsureAccess makes so tests can assert the
// admin → Owners vs member → Maintainers routing.
type fakeForgejo struct {
	mu          sync.Mutex
	createdOrg  string
	teamCreated bool     // POST /orgs/{org}/teams (Maintainers create)
	memberPuts  []string // PUT /teams/{id}/members/{user} paths
}

func newFakeForgejo(t *testing.T) (*httptest.Server, *fakeForgejo) {
	t.Helper()
	f := &fakeForgejo{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/orgs":
			f.createdOrg = "set"
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/teams"):
			// Always report the built-in Owners team (id 1). Maintainers (id 2)
			// only after it has been created, so EnsureMaintainersTeam exercises
			// its create path on first call.
			body := `[{"id":1,"name":"Owners"}`
			if f.teamCreated {
				body += `,{"id":2,"name":"Maintainers"}`
			}
			body += `]`
			_, _ = w.Write([]byte(body))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/teams"):
			f.teamCreated = true
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/members/"):
			f.memberPuts = append(f.memberPuts, r.URL.Path)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, f
}

func newTestProvisioner(srv *httptest.Server) *Provisioner {
	return &Provisioner{
		client:      newTestClient(srv),
		accessCache: make(map[string]time.Time),
	}
}

func TestEnsureAccess_Admin_AddsToOwners(t *testing.T) {
	srv, f := newFakeForgejo(t)
	p := newTestProvisioner(srv)

	p.EnsureAccess(context.Background(), "acme", "Acme", "boss@acme.com", true)

	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createdOrg == "" {
		t.Fatal("org was not created")
	}
	if len(f.memberPuts) != 1 {
		t.Fatalf("member PUTs = %v, want exactly 1", f.memberPuts)
	}
	// Admin → Owners team (id 1), username from local-part of the email.
	if !strings.Contains(f.memberPuts[0], "/teams/1/members/boss") {
		t.Errorf("admin added to %q, want /teams/1/members/boss (Owners)", f.memberPuts[0])
	}
	if f.teamCreated {
		t.Error("admin path should NOT create a Maintainers team")
	}
}

func TestEnsureAccess_Member_AddsToMaintainers(t *testing.T) {
	srv, f := newFakeForgejo(t)
	p := newTestProvisioner(srv)

	p.EnsureAccess(context.Background(), "acme", "Acme", "dev@acme.com", false)

	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.teamCreated {
		t.Fatal("member path should create the Maintainers team")
	}
	if len(f.memberPuts) != 1 {
		t.Fatalf("member PUTs = %v, want exactly 1", f.memberPuts)
	}
	// Member → Maintainers team (id 2).
	if !strings.Contains(f.memberPuts[0], "/teams/2/members/dev") {
		t.Errorf("member added to %q, want /teams/2/members/dev (Maintainers)", f.memberPuts[0])
	}
}

func TestEnsureAccess_SkipsPersonalOrg(t *testing.T) {
	srv, f := newFakeForgejo(t)
	p := newTestProvisioner(srv)

	p.EnsureAccess(context.Background(), "personal-abc", "Personal", "x@y.com", false)

	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createdOrg != "" || len(f.memberPuts) != 0 {
		t.Errorf("personal-* org should be skipped entirely; createdOrg=%q puts=%v", f.createdOrg, f.memberPuts)
	}
}

func TestEnsureAccess_CachedWithinTTL(t *testing.T) {
	srv, f := newFakeForgejo(t)
	p := newTestProvisioner(srv)

	for i := 0; i < 3; i++ {
		p.EnsureAccess(context.Background(), "acme", "Acme", "dev@acme.com", false)
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.memberPuts) != 1 {
		t.Errorf("EnsureAccess called 3x should provision once (TTL cache); member PUTs = %v", f.memberPuts)
	}
}

func TestEnsureAccess_UnconfiguredIsNoop(t *testing.T) {
	// No URL/token → unconfigured client → must not panic or call anything.
	p := &Provisioner{client: NewClient("", ""), accessCache: make(map[string]time.Time)}
	p.EnsureAccess(context.Background(), "acme", "Acme", "dev@acme.com", false)
	if p.Configured() {
		t.Error("Configured() should be false for an empty client")
	}
}
