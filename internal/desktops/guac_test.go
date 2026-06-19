package desktops

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// newFakeGuac returns an httptest.Server that mimics the Guacamole 1.5.x REST
// API and a GuacClient pre-pointed at it.
//
// The server handles:
//
//	POST   /api/tokens                                           → auth
//	POST   /api/session/data/postgresql/connections             → create connection
//	PATCH  /api/session/data/postgresql/users/{user}/permissions → grant
//	DELETE /api/session/data/postgresql/connections/{id}        → delete
func newFakeGuac(t *testing.T, deleteStatus int) (*httptest.Server, *GuacClient) {
	t.Helper()

	mux := http.NewServeMux()

	// ── POST /api/tokens ──────────────────────────────────────────────────────
	mux.HandleFunc("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "parse form: "+err.Error(), http.StatusBadRequest)
			return
		}
		if r.FormValue("username") == "" || r.FormValue("password") == "" {
			http.Error(w, "missing username or password", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"authToken":  "T",
			"dataSource": "postgresql",
		})
	})

	// ── POST /api/session/data/postgresql/connections ─────────────────────────
	mux.HandleFunc("/api/session/data/postgresql/connections", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		// Token must appear in query string.
		if r.URL.Query().Get("token") != "T" {
			http.Error(w, "bad token", http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		var req struct {
			ParentIdentifier string            `json:"parentIdentifier"`
			Name             string            `json:"name"`
			Protocol         string            `json:"protocol"`
			Parameters       map[string]string `json:"parameters"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "decode body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if req.ParentIdentifier != "ROOT" {
			http.Error(w, "expected parentIdentifier ROOT, got "+req.ParentIdentifier, http.StatusBadRequest)
			return
		}
		if req.Name == "" {
			http.Error(w, "missing name", http.StatusBadRequest)
			return
		}
		if req.Protocol == "" {
			http.Error(w, "missing protocol", http.StatusBadRequest)
			return
		}
		if req.Parameters["hostname"] == "" {
			http.Error(w, "missing parameters.hostname", http.StatusBadRequest)
			return
		}
		if req.Parameters["port"] == "" {
			http.Error(w, "missing parameters.port", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"identifier": "C1"})
	})

	// ── PATCH .../users/{user}/permissions ────────────────────────────────────
	mux.HandleFunc("/api/session/data/postgresql/users/", func(w http.ResponseWriter, r *http.Request) {
		// Path: /api/session/data/postgresql/users/{username}/permissions
		if r.Method != http.MethodPatch {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Query().Get("token") != "T" {
			http.Error(w, "bad token", http.StatusUnauthorized)
			return
		}
		// Verify the path ends with /permissions
		if !strings.HasSuffix(r.URL.Path, "/permissions") {
			http.Error(w, "expected path ending in /permissions", http.StatusNotFound)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		var ops []struct {
			Op    string `json:"op"`
			Path  string `json:"path"`
			Value string `json:"value"`
		}
		if err := json.Unmarshal(body, &ops); err != nil {
			http.Error(w, "decode body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if len(ops) == 0 {
			http.Error(w, "empty patch ops", http.StatusBadRequest)
			return
		}
		op := ops[0]
		if op.Op != "add" {
			http.Error(w, "expected op=add, got "+op.Op, http.StatusBadRequest)
			return
		}
		if !strings.HasPrefix(op.Path, "/connectionPermissions/") {
			http.Error(w, "expected path /connectionPermissions/..., got "+op.Path, http.StatusBadRequest)
			return
		}
		if op.Value != "READ" {
			http.Error(w, "expected value=READ, got "+op.Value, http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── DELETE .../connections/{id} ───────────────────────────────────────────
	mux.HandleFunc("/api/session/data/postgresql/connections/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Query().Get("token") != "T" {
			http.Error(w, "bad token", http.StatusUnauthorized)
			return
		}
		w.WriteHeader(deleteStatus)
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := NewGuacClient(srv.URL, "admin", "secret")
	return srv, client
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestCreateConnection(t *testing.T) {
	_, client := newFakeGuac(t, http.StatusNoContent)
	ctx := context.Background()

	id, err := client.CreateConnection(ctx, ConnSpec{
		Name:     "test-conn",
		Protocol: "vnc",
		Host:     "desktop-1.cluster.local",
		Port:     5900,
		Parameters: map[string]string{
			"password": "s3cr3t",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection returned error: %v", err)
	}
	if id != "C1" {
		t.Fatalf("expected identifier C1, got %q", id)
	}
}

func TestGrantConnectionToUser(t *testing.T) {
	_, client := newFakeGuac(t, http.StatusNoContent)
	ctx := context.Background()

	// Pre-authenticate so we have a token+dataSource.
	if _, err := client.CreateConnection(ctx, ConnSpec{
		Name: "pre", Protocol: "vnc", Host: "h", Port: 1,
	}); err != nil {
		t.Fatalf("setup CreateConnection: %v", err)
	}

	if err := client.GrantConnectionToUser(ctx, "C1", "alice"); err != nil {
		t.Fatalf("GrantConnectionToUser returned error: %v", err)
	}
}

func TestDeleteConnectionOK(t *testing.T) {
	_, client := newFakeGuac(t, http.StatusNoContent)
	ctx := context.Background()

	// Ensure token is primed.
	if _, err := client.CreateConnection(ctx, ConnSpec{
		Name: "pre", Protocol: "vnc", Host: "h", Port: 1,
	}); err != nil {
		t.Fatalf("setup: %v", err)
	}

	if err := client.DeleteConnection(ctx, "C1"); err != nil {
		t.Fatalf("DeleteConnection returned error: %v", err)
	}
}

func TestDeleteConnection404IsSuccess(t *testing.T) {
	_, client := newFakeGuac(t, http.StatusNotFound)
	ctx := context.Background()

	// Ensure token is primed.
	if _, err := client.CreateConnection(ctx, ConnSpec{
		Name: "pre", Protocol: "vnc", Host: "h", Port: 1,
	}); err != nil {
		t.Fatalf("setup: %v", err)
	}

	if err := client.DeleteConnection(ctx, "C1"); err != nil {
		t.Fatalf("DeleteConnection with 404 should be treated as success, got error: %v", err)
	}
}

func TestAuthFormFields(t *testing.T) {
	// Verify that the auth request sends username + password as form values.
	var capturedForm url.Values
	authCalled := 0

	mux := http.NewServeMux()
	mux.HandleFunc("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
		authCalled++
		if err := r.ParseForm(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		capturedForm = r.Form
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"authToken":  "T",
			"dataSource": "postgresql",
		})
	})
	mux.HandleFunc("/api/session/data/postgresql/connections", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"identifier": "X"})
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewGuacClient(srv.URL, "myuser", "mypass")
	if _, err := client.CreateConnection(context.Background(), ConnSpec{
		Name: "x", Protocol: "ssh", Host: "h", Port: 22,
	}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if authCalled != 1 {
		t.Fatalf("expected auth called once, got %d", authCalled)
	}
	if capturedForm.Get("username") != "myuser" {
		t.Errorf("expected username=myuser, got %q", capturedForm.Get("username"))
	}
	if capturedForm.Get("password") != "mypass" {
		t.Errorf("expected password=mypass, got %q", capturedForm.Get("password"))
	}
}

func TestReauthOn401(t *testing.T) {
	authCount := 0
	connectCount := 0

	mux := http.NewServeMux()
	mux.HandleFunc("/api/tokens", func(w http.ResponseWriter, r *http.Request) {
		authCount++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"authToken":  "T",
			"dataSource": "postgresql",
		})
	})
	mux.HandleFunc("/api/session/data/postgresql/connections", func(w http.ResponseWriter, r *http.Request) {
		connectCount++
		if connectCount == 1 {
			// First call: return 401 to trigger re-auth.
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		// Second call (after re-auth): succeed.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"identifier": "C2"})
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Seed a stale token so the first call goes straight to the data endpoint.
	client := NewGuacClient(srv.URL, "u", "p")
	client.authToken = "stale"
	client.dataSource = "postgresql"

	id, err := client.CreateConnection(context.Background(), ConnSpec{
		Name: "n", Protocol: "vnc", Host: "h", Port: 1,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "C2" {
		t.Fatalf("expected C2, got %q", id)
	}
	if authCount != 1 {
		t.Fatalf("expected exactly 1 re-auth, got %d", authCount)
	}
	if connectCount != 2 {
		t.Fatalf("expected 2 connection attempts, got %d", connectCount)
	}
}
