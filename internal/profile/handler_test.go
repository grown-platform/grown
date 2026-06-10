package profile_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/profile"
	"code.pick.haus/grown/grown/internal/users"
)

// ---- Fake Zitadel stub ------------------------------------------------------

// stubState holds the mutable state of the fake Zitadel server.
type stubState struct {
	subject       string // caller's Zitadel user id
	resourceOwner string // caller's org in Zitadel

	// current field values (mirrors what /v2/users/{id} returns)
	givenName  string
	familyName string
	username   string
	phone      string
	email      string

	// recorded request details for assertions
	profileBody   map[string]any
	usernameBody  map[string]any
	phoneBody     map[string]any
	emailBody     map[string]any
	orgIDOnMethod map[string]string // method+field → x-zitadel-orgid value

	// controls
	usernameConflict bool // make PUT username return 409
}

// buildStub builds an httptest.Server whose behaviour is controlled by st. It
// records the request bodies for each management v1 PUT so tests can assert on
// them. It also checks that x-zitadel-orgid is set for management calls.
func buildStub(t *testing.T, st *stubState) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// GET /v2/users/{id}
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v2/users/") {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{
					"username": st.username,
					"details":  map[string]any{"resourceOwner": st.resourceOwner},
					"human": map[string]any{
						"profile": map[string]any{
							"givenName":  st.givenName,
							"familyName": st.familyName,
						},
						"email": map[string]any{"email": st.email, "isVerified": true},
						"phone": map[string]any{"phone": st.phone, "isVerified": false},
					},
				},
			})
			return
		}

		// PUT /management/v1/users/{id}/{field}
		if r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/management/v1/users/") {
			// Verify that x-zitadel-orgid is set.
			orgHeader := r.Header.Get("x-zitadel-orgid")
			parts := strings.Split(r.URL.Path, "/")
			field := parts[len(parts)-1] // last segment: profile|username|phone|email

			if st.orgIDOnMethod == nil {
				st.orgIDOnMethod = map[string]string{}
			}
			st.orgIDOnMethod[field] = orgHeader

			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)

			switch field {
			case "profile":
				st.profileBody = body
			case "username":
				st.usernameBody = body
				if st.usernameConflict {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusConflict)
					_ = json.NewEncoder(w).Encode(map[string]any{"message": "already in use CONFLICT"})
					return
				}
			case "phone":
				st.phoneBody = body
			case "email":
				st.emailBody = body
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{})
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	return srv
}

// ---- helpers ----------------------------------------------------------------

func noopCaller(u users.User) profile.Caller {
	return func(_ context.Context) (users.User, bool) { return u, true }
}

func noCaller(_ context.Context) (users.User, bool) { return users.User{}, false }

func jsonBody(t *testing.T, v any) *strings.Reader {
	t.Helper()
	b, _ := json.Marshal(v)
	return strings.NewReader(string(b))
}

// ---- Tests ------------------------------------------------------------------

// TestGet verifies that GET /api/v1/me/profile returns the caller's profile
// from Zitadel.
func TestGet(t *testing.T) {
	st := &stubState{
		subject:       "zid-abc",
		resourceOwner: "ro-org",
		givenName:     "Alice",
		familyName:    "Smith",
		username:      "alice",
		email:         "alice@example.com",
		phone:         "+15551234567",
	}
	stub := buildStub(t, st)
	defer stub.Close()

	u := users.User{OIDCSubject: "zid-abc", OIDCIssuer: "https://auth.example", OrgID: "org1", Email: "alice@example.com"}
	h := profile.NewHandler(stub.URL, "token", nil).WithCaller(noopCaller(u))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/profile", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var out profile.ProfileOut
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.GivenName != "Alice" {
		t.Errorf("given_name = %q; want Alice", out.GivenName)
	}
	if out.Email != "alice@example.com" {
		t.Errorf("email = %q; want alice@example.com", out.Email)
	}
	if out.Username != "alice" {
		t.Errorf("username = %q; want alice", out.Username)
	}
}

// TestPatchProfileHitsCorrectPath verifies that a PATCH that changes first/last
// name sends PUT /management/v1/users/{id}/profile with the right body and the
// x-zitadel-orgid header.
func TestPatchProfileHitsCorrectPath(t *testing.T) {
	st := &stubState{
		subject:       "zid-abc",
		resourceOwner: "ro-org-1",
		givenName:     "Alice",
		familyName:    "Smith",
		username:      "alice",
		email:         "alice@example.com",
	}
	stub := buildStub(t, st)
	defer stub.Close()

	u := users.User{OIDCSubject: "zid-abc", OIDCIssuer: "https://auth", OrgID: "org1", Email: "alice@example.com"}
	h := profile.NewHandler(stub.URL, "token", nil).WithCaller(noopCaller(u))

	body := jsonBody(t, map[string]any{"given_name": "Bob", "family_name": "Jones"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", body)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if st.profileBody == nil {
		t.Fatal("profile PUT was not called")
	}
	if st.profileBody["firstName"] != "Bob" {
		t.Errorf("firstName = %v; want Bob", st.profileBody["firstName"])
	}
	if st.profileBody["lastName"] != "Jones" {
		t.Errorf("lastName = %v; want Jones", st.profileBody["lastName"])
	}
	if st.profileBody["displayName"] != "Bob Jones" {
		t.Errorf("displayName = %v; want 'Bob Jones'", st.profileBody["displayName"])
	}
	// Verify x-zitadel-orgid was sent.
	if st.orgIDOnMethod["profile"] != "ro-org-1" {
		t.Errorf("x-zitadel-orgid for profile = %q; want ro-org-1", st.orgIDOnMethod["profile"])
	}
}

// TestPatchUsernameTaken verifies that a 409 from Zitadel on a username change
// is relayed to the frontend as a 409 with a human-readable message.
func TestPatchUsernameTaken(t *testing.T) {
	st := &stubState{
		subject:          "zid-abc",
		resourceOwner:    "ro-org-1",
		username:         "alice",
		email:            "alice@example.com",
		usernameConflict: true,
	}
	stub := buildStub(t, st)
	defer stub.Close()

	u := users.User{OIDCSubject: "zid-abc"}
	h := profile.NewHandler(stub.URL, "token", nil).WithCaller(noopCaller(u))

	body := jsonBody(t, map[string]any{"username": "bob"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", body)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d; want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "taken") {
		t.Errorf("body = %s; want 'taken'", rr.Body.String())
	}
}

// TestPatchEmailSendsVerification verifies that changing the email sends
// PUT /management/v1/users/{id}/email with isEmailVerified:false and that
// the response includes email_verification_sent:true.
func TestPatchEmailSendsVerification(t *testing.T) {
	st := &stubState{
		subject:       "zid-abc",
		resourceOwner: "ro-org-1",
		email:         "old@example.com",
		username:      "alice",
	}
	stub := buildStub(t, st)
	defer stub.Close()

	u := users.User{OIDCSubject: "zid-abc", Email: "old@example.com"}
	h := profile.NewHandler(stub.URL, "token", nil).WithCaller(noopCaller(u))

	body := jsonBody(t, map[string]any{"email": "new@example.com"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", body)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if st.emailBody == nil {
		t.Fatal("email PUT was not called")
	}
	// isEmailVerified must be false (triggers Zitadel to send a verification email).
	if v, _ := st.emailBody["isEmailVerified"].(bool); v {
		t.Error("isEmailVerified = true; want false (must trigger verification email)")
	}
	if st.emailBody["email"] != "new@example.com" {
		t.Errorf("email body = %v; want new@example.com", st.emailBody["email"])
	}
	// Verify x-zitadel-orgid was sent on the email PUT.
	if st.orgIDOnMethod["email"] != "ro-org-1" {
		t.Errorf("x-zitadel-orgid for email = %q; want ro-org-1", st.orgIDOnMethod["email"])
	}
	// Response should report email_verification_sent:true.
	var resp profile.PatchResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.EmailVerificationSent {
		t.Error("email_verification_sent = false; want true")
	}
	if resp.Email != "new@example.com" {
		t.Errorf("response email = %q; want new@example.com", resp.Email)
	}
}

// TestPatchEmailUnchangedSkipped verifies that when the submitted email matches
// the current email (case-insensitive), no email PUT is issued.
func TestPatchEmailUnchangedSkipped(t *testing.T) {
	st := &stubState{
		subject:       "zid-abc",
		resourceOwner: "ro-org-1",
		email:         "Alice@Example.COM",
		username:      "alice",
	}
	stub := buildStub(t, st)
	defer stub.Close()

	u := users.User{OIDCSubject: "zid-abc", Email: "alice@example.com"}
	h := profile.NewHandler(stub.URL, "token", nil).WithCaller(noopCaller(u))

	// Same email, just different case — should be skipped.
	body := jsonBody(t, map[string]any{"email": "alice@example.com"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", body)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if st.emailBody != nil {
		t.Error("email PUT was called; should have been skipped for unchanged email")
	}
	var resp profile.PatchResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.EmailVerificationSent {
		t.Error("email_verification_sent = true; want false (email unchanged)")
	}
}

// TestUnauthenticated verifies that requests without a resolved caller get 401.
func TestUnauthenticated(t *testing.T) {
	h := profile.NewHandler("https://auth.example", "token", nil).
		WithCaller(noCaller)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/profile", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401", rr.Code)
	}
}

// TestServiceTokenUnconfigured verifies that 503 is returned when the service
// token is empty.
func TestServiceTokenUnconfigured(t *testing.T) {
	u := users.User{OIDCSubject: "zid-abc"}
	// Empty token.
	h := profile.NewHandler("https://auth.example", "", nil).WithCaller(noopCaller(u))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/profile", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", rr.Code)
	}
}

// TestPatchPhoneHitsCorrectPath verifies that a phone update sends PUT
// /management/v1/users/{id}/phone with isPhoneVerified:false and the org header.
func TestPatchPhoneHitsCorrectPath(t *testing.T) {
	st := &stubState{
		subject:       "zid-abc",
		resourceOwner: "ro-org-1",
		email:         "alice@example.com",
		username:      "alice",
		phone:         "+15550000000",
	}
	stub := buildStub(t, st)
	defer stub.Close()

	u := users.User{OIDCSubject: "zid-abc"}
	h := profile.NewHandler(stub.URL, "token", nil).WithCaller(noopCaller(u))

	body := jsonBody(t, map[string]any{"phone": "+15551112222"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/me/profile", body)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if st.phoneBody == nil {
		t.Fatal("phone PUT was not called")
	}
	if st.phoneBody["phone"] != "+15551112222" {
		t.Errorf("phone body = %v; want +15551112222", st.phoneBody["phone"])
	}
	if v, _ := st.phoneBody["isPhoneVerified"].(bool); v {
		t.Error("isPhoneVerified = true; want false")
	}
	if st.orgIDOnMethod["phone"] != "ro-org-1" {
		t.Errorf("x-zitadel-orgid for phone = %q; want ro-org-1", st.orgIDOnMethod["phone"])
	}
}
