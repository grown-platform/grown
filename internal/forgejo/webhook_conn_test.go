package forgejo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// hookFake is an httptest fake Forgejo that records org-webhook API traffic so
// connection tests can assert exactly what grown sends and how it reacts to the
// server's responses. It also handles the org/team/member endpoints so a full
// provisioner run can complete against it.
type hookFake struct {
	mu sync.Mutex

	// inputs (set before the call)
	existingHooks string // JSON array returned by GET .../hooks (default "[]")
	listStatus    int    // status for GET .../hooks (default 200)
	createStatus  int    // status for POST .../hooks (default 201)

	// outputs (observed after the call)
	listCount   int
	createCount int
	lastCreate  map[string]any // decoded POST .../hooks body
}

func newHookFake(t *testing.T) (*httptest.Server, *hookFake) {
	t.Helper()
	f := &hookFake{existingHooks: "[]", listStatus: 200, createStatus: http.StatusCreated}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/hooks"):
			f.listCount++
			w.WriteHeader(f.listStatus)
			if f.listStatus == 200 {
				_, _ = w.Write([]byte(f.existingHooks))
			}
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/hooks"):
			f.createCount++
			_ = json.NewDecoder(r.Body).Decode(&f.lastCreate)
			w.WriteHeader(f.createStatus)
			_, _ = w.Write([]byte(`{"id":1}`))
		// Endpoints used by a full provisioner run:
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/orgs":
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/teams"):
			_, _ = w.Write([]byte(`[{"id":1,"name":"Owners"}]`))
		case r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/members/"):
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, f
}

const webhookURL = "https://grown.example/api/v1/forgejo/webhook"

// EnsureOrgWebhook must POST a hook carrying the right type/events/config so
// Forgejo signs deliveries with our secret. Guards the exact request shape.
func TestEnsureOrgWebhook_SendsCorrectPayload(t *testing.T) {
	srv, f := newHookFake(t)
	c := newTestClient(srv)

	if err := c.EnsureOrgWebhook(context.Background(), "acme", webhookURL, "topsecret"); err != nil {
		t.Fatalf("EnsureOrgWebhook: %v", err)
	}
	if f.createCount != 1 {
		t.Fatalf("createCount=%d want 1", f.createCount)
	}
	body := f.lastCreate
	if body["type"] != "forgejo" {
		t.Errorf("type=%v want forgejo", body["type"])
	}
	if body["active"] != true {
		t.Errorf("active=%v want true", body["active"])
	}
	events, _ := body["events"].([]any)
	if len(events) != 2 || events[0] != "push" || events[1] != "pull_request" {
		t.Errorf("events=%v want [push pull_request]", body["events"])
	}
	cfg, _ := body["config"].(map[string]any)
	if cfg["url"] != webhookURL {
		t.Errorf("config.url=%v want %s", cfg["url"], webhookURL)
	}
	if cfg["content_type"] != "json" {
		t.Errorf("config.content_type=%v want json", cfg["content_type"])
	}
	if cfg["secret"] != "topsecret" {
		t.Errorf("config.secret=%v want topsecret", cfg["secret"])
	}
}

// A 404 from GET .../hooks (org has no hooks yet / endpoint quirk) is treated as
// "none present" and the hook is still created.
func TestEnsureOrgWebhook_CreatesWhenListReturns404(t *testing.T) {
	srv, f := newHookFake(t)
	f.listStatus = http.StatusNotFound
	c := newTestClient(srv)

	if err := c.EnsureOrgWebhook(context.Background(), "acme", webhookURL, "s"); err != nil {
		t.Fatalf("EnsureOrgWebhook: %v", err)
	}
	if f.createCount != 1 {
		t.Fatalf("createCount=%d want 1", f.createCount)
	}
}

// A 500 from GET .../hooks is a real error and must not silently create a hook.
func TestEnsureOrgWebhook_ListErrorIsReturned(t *testing.T) {
	srv, f := newHookFake(t)
	f.listStatus = http.StatusInternalServerError
	c := newTestClient(srv)

	if err := c.EnsureOrgWebhook(context.Background(), "acme", webhookURL, "s"); err == nil {
		t.Fatal("expected an error on 500 list response")
	}
	if f.createCount != 0 {
		t.Errorf("createCount=%d want 0 (must not create on list error)", f.createCount)
	}
}

// An existing hook with a *different* URL must not suppress creation of ours.
func TestEnsureOrgWebhook_CreatesWhenOnlyOtherHooksExist(t *testing.T) {
	srv, f := newHookFake(t)
	f.existingHooks = `[{"id":9,"config":{"url":"https://elsewhere/other"}}]`
	c := newTestClient(srv)

	if err := c.EnsureOrgWebhook(context.Background(), "acme", webhookURL, "s"); err != nil {
		t.Fatalf("EnsureOrgWebhook: %v", err)
	}
	if f.createCount != 1 {
		t.Errorf("createCount=%d want 1 (unrelated hook should not block ours)", f.createCount)
	}
}

// POST returning 422 (already exists, race) is treated as success.
func TestEnsureOrgWebhook_CreateConflictIsSuccess(t *testing.T) {
	srv, f := newHookFake(t)
	f.createStatus = http.StatusUnprocessableEntity
	c := newTestClient(srv)

	if err := c.EnsureOrgWebhook(context.Background(), "acme", webhookURL, "s"); err != nil {
		t.Errorf("422 on create should be success, got: %v", err)
	}
}

// Empty secret or empty URL disables registration entirely (no API traffic).
func TestEnsureOrgWebhook_NoopWhenUnconfigured(t *testing.T) {
	srv, f := newHookFake(t)
	c := newTestClient(srv)

	for _, tc := range []struct{ url, secret string }{{"", "s"}, {webhookURL, ""}} {
		if err := c.EnsureOrgWebhook(context.Background(), "acme", tc.url, tc.secret); err != nil {
			t.Fatalf("EnsureOrgWebhook(%q,%q): %v", tc.url, tc.secret, err)
		}
	}
	if f.listCount != 0 || f.createCount != 0 {
		t.Errorf("made API calls while unconfigured: list=%d create=%d", f.listCount, f.createCount)
	}
}

// A full access-time provisioning run (admin → Owners) must also register the
// org webhook when the provisioner is webhook-configured.
func TestEnsureAccess_RegistersWebhook(t *testing.T) {
	srv, f := newHookFake(t)
	p := &Provisioner{
		client:        newTestClient(srv),
		webhookURL:    webhookURL,
		webhookSecret: "s",
		accessCache:   map[string]time.Time{},
	}

	p.EnsureAccess(context.Background(), "acme", "Acme", "boss@acme.com", true)

	if f.createCount != 1 {
		t.Errorf("createCount=%d want 1 (EnsureAccess should register the hook)", f.createCount)
	}
}

// When the provisioner is not webhook-configured (webhookURL empty), a full run
// must touch no hook endpoints.
func TestEnsureAccess_SkipsWebhookWhenUnconfigured(t *testing.T) {
	srv, f := newHookFake(t)
	p := &Provisioner{
		client:      newTestClient(srv),
		accessCache: map[string]time.Time{},
	}

	p.EnsureAccess(context.Background(), "acme", "Acme", "boss@acme.com", true)

	if f.listCount != 0 || f.createCount != 0 {
		t.Errorf("hook endpoints touched while unconfigured: list=%d create=%d", f.listCount, f.createCount)
	}
}
