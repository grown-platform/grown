package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newTestZitadelServer spins up an httptest.Server that responds to
// POST /v2/sessions and POST /v2/users as a minimal Zitadel stub.
//
// rejectCreds: when true, /v2/sessions returns 401.
// userID: the Zitadel user id returned in successful session responses.
func newTestZitadelServer(t *testing.T, rejectCreds bool, userID string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v2/sessions":
			if rejectCreds {
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"message": "invalid credentials"})
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"sessionId":    "sess-abc",
				"sessionToken": "tok-abc",
				"factors": map[string]any{
					"user": map[string]string{"id": userID},
				},
			})

		case r.Method == http.MethodPost && r.URL.Path == "/v2/users":
			if rejectCreds {
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{"result": []any{}})
				return
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"result": []map[string]string{{"userId": userID}},
			})

		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// minimalLoginHandlers creates a LoginHandlers wired with a real ZitadelClient
// pointing at the test stub but nil sessions/users/orgs repos (sufficient for
// unit tests that don't need DB access). The nil session store means
// mintSession will fail if invoked — tests that need the full round-trip must
// use a real DB (GROWN_TEST_DSN) or mock the session store.
func minimalLoginHandlers(t *testing.T, zSrv *httptest.Server, demoEnabled bool, demoUsername string) *LoginHandlers {
	t.Helper()
	cfg := Config{
		CookieName:      "grown_session",
		SessionLifetime: time.Hour,
		DefaultOrgSlug:  "default",
	}
	var zc *ZitadelClient
	if zSrv != nil {
		zc = NewZitadelClient(zSrv.URL, "test-token")
	}
	h := &LoginHandlers{
		cfg:          cfg,
		zitadel:      zc,
		sessions:     nil, // DB not available in unit tests
		users:        nil,
		orgs:         nil,
		issuer:       "https://auth.example.com",
		demoEnabled:  demoEnabled,
		demoUsername: demoUsername,
	}
	return h
}

// ---------------------------------------------------------------------------
// ZitadelClient unit tests (no DB needed)
// ---------------------------------------------------------------------------

func TestZitadelClient_AuthenticatePassword_BadCreds(t *testing.T) {
	srv := newTestZitadelServer(t, true /*rejectCreds*/, "")
	c := NewZitadelClient(srv.URL, "svc-token")

	_, err := c.AuthenticatePassword(t.Context(), "user@example.com", "wrong")
	if err == nil {
		t.Fatal("expected error for bad credentials, got nil")
	}
	if err != ErrZitadelUnauthorized {
		t.Errorf("expected ErrZitadelUnauthorized, got %v", err)
	}
}

func TestZitadelClient_AuthenticatePassword_Success(t *testing.T) {
	srv := newTestZitadelServer(t, false, "zitadel-user-42")
	c := NewZitadelClient(srv.URL, "svc-token")

	res, err := c.AuthenticatePassword(t.Context(), "user@example.com", "correct")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.UserID != "zitadel-user-42" {
		t.Errorf("user id: got %q, want %q", res.UserID, "zitadel-user-42")
	}
	if res.SessionID != "sess-abc" {
		t.Errorf("session id: got %q", res.SessionID)
	}
}

func TestZitadelClient_LookupUserByLoginName_NotFound(t *testing.T) {
	srv := newTestZitadelServer(t, true /*empty result set*/, "")
	c := NewZitadelClient(srv.URL, "svc-token")

	_, err := c.LookupUserByLoginName(t.Context(), "nobody@example.com")
	if err != ErrZitadelUnauthorized {
		t.Errorf("expected ErrZitadelUnauthorized, got %v", err)
	}
}

func TestZitadelClient_LookupUserByLoginName_Found(t *testing.T) {
	srv := newTestZitadelServer(t, false, "z-uid-99")
	c := NewZitadelClient(srv.URL, "svc-token")

	uid, err := c.LookupUserByLoginName(t.Context(), "demo@pick.haus")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if uid != "z-uid-99" {
		t.Errorf("got %q, want %q", uid, "z-uid-99")
	}
}

// ---------------------------------------------------------------------------
// PasswordLogin handler tests (no DB; tests the pre-mintSession path)
// ---------------------------------------------------------------------------

func TestPasswordLogin_MethodNotAllowed(t *testing.T) {
	h := minimalLoginHandlers(t, nil, false, "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login-password", nil)
	rec := httptest.NewRecorder()
	h.PasswordLogin(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("got %d, want 405", rec.Code)
	}
}

func TestPasswordLogin_Unconfigured(t *testing.T) {
	// nil ZitadelClient → 503
	h := minimalLoginHandlers(t, nil, false, "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-password",
		strings.NewReader(`{"username":"x","password":"y"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.PasswordLogin(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("got %d, want 503", rec.Code)
	}
}

func TestPasswordLogin_EmptyFields(t *testing.T) {
	srv := newTestZitadelServer(t, false, "uid")
	h := minimalLoginHandlers(t, srv, false, "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-password",
		strings.NewReader(`{"username":"","password":""}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.PasswordLogin(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("got %d, want 401", rec.Code)
	}
}

func TestPasswordLogin_BadCredentials(t *testing.T) {
	srv := newTestZitadelServer(t, true /*rejectCreds*/, "")
	h := minimalLoginHandlers(t, srv, false, "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-password",
		strings.NewReader(`{"username":"a@b.com","password":"wrong"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.PasswordLogin(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("got %d, want 401", rec.Code)
	}
	// The response must NOT contain the real reason (no user enumeration).
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "invalid email or password") {
		t.Errorf("expected generic error message, got: %s", body)
	}
}

// TestPasswordLogin_NoPasswordInLogs verifies that the password is not logged.
// We can't intercept slog directly here but we ensure it never appears in our
// JSON error body (which is the only user-visible output on failure).
func TestPasswordLogin_NoPasswordInResponseBody(t *testing.T) {
	srv := newTestZitadelServer(t, true, "")
	h := minimalLoginHandlers(t, srv, false, "")
	const secretPassword = "s3cr3t-do-not-leak"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-password",
		strings.NewReader(`{"username":"a@b.com","password":"`+secretPassword+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.PasswordLogin(rec, req)
	body, _ := io.ReadAll(rec.Body)
	if strings.Contains(string(body), secretPassword) {
		t.Errorf("password appeared in response body: %s", body)
	}
}

// ---------------------------------------------------------------------------
// DemoLogin handler tests
// ---------------------------------------------------------------------------

func TestDemoLogin_Probe_Disabled(t *testing.T) {
	h := minimalLoginHandlers(t, nil, false /*disabled*/, "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.DemoLogin(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("probe: got %d, want 200", rec.Code)
	}
	var body map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["enabled"] {
		t.Errorf("expected enabled=false, got true")
	}
}

func TestDemoLogin_Probe_Enabled(t *testing.T) {
	h := minimalLoginHandlers(t, nil, true /*enabled*/, "demo@pick.haus")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.DemoLogin(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("probe: got %d, want 200", rec.Code)
	}
	var body map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body["enabled"] {
		t.Errorf("expected enabled=true, got false")
	}
}

func TestDemoLogin_POST_WhenDisabled(t *testing.T) {
	h := minimalLoginHandlers(t, nil, false, "demo@pick.haus")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/demo-login", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	h.DemoLogin(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("got %d, want 403 (demo disabled)", rec.Code)
	}
}

func TestDemoLogin_POST_NoZitadel(t *testing.T) {
	// demoEnabled=true but ZitadelClient is nil → 503
	h := minimalLoginHandlers(t, nil, true, "demo@pick.haus")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/demo-login", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	h.DemoLogin(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("got %d, want 503", rec.Code)
	}
}

func TestDemoLogin_SingleAccountOnly(t *testing.T) {
	// The demo endpoint must never honour a caller-supplied username.
	// The configured demo user is "demo@pick.haus"; a POST with a body
	// containing a different username must still look up "demo@pick.haus" only.
	// We verify this by using a stub that returns a specific user id for any
	// lookup, and checking that the Zitadel stub was called with the right body.
	var capturedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v2/users" {
			capturedBody, _ = io.ReadAll(r.Body)
			// Return empty — the test just wants to see the lookup was called
			// and reach the "user not found" 503 (no DB to mint from).
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"result": []any{}})
		} else {
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	h := minimalLoginHandlers(t, srv, true, "demo@pick.haus")
	body := `{"username":"attacker@evil.com"}` // caller tries to hijack another user
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/demo-login", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.DemoLogin(rec, req)

	// We got 503 because Zitadel said "not found" — but the important check is
	// that the Zitadel lookup used "demo@pick.haus", not "attacker@evil.com".
	if strings.Contains(string(capturedBody), "attacker@evil.com") {
		t.Errorf("demo login forwarded caller-supplied username: %s", capturedBody)
	}
	if !strings.Contains(string(capturedBody), "demo@pick.haus") {
		t.Errorf("demo login did not use configured demo username; body: %s", capturedBody)
	}
}

func TestDemoLogin_MethodNotAllowed(t *testing.T) {
	h := minimalLoginHandlers(t, nil, true, "demo@pick.haus")
	req := httptest.NewRequest(http.MethodPut, "/api/v1/auth/demo-login", nil)
	rec := httptest.NewRecorder()
	h.DemoLogin(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("got %d, want 405", rec.Code)
	}
}
