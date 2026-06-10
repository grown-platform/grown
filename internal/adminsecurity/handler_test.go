package adminsecurity_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/adminsecurity"
)

// ---- test identity helpers --------------------------------------------------

type ctxKey string

const subjectKey ctxKey = "subject"

func withSubject(r *http.Request, subject string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), subjectKey, subject))
}

func makeCaller(ctx context.Context) (subject, email, orgID string, ok bool) {
	s, _ := ctx.Value(subjectKey).(string)
	if s == "" {
		return "", "", "", false
	}
	return s, "admin@test", "grown-org", true
}

func adminChecker(isAdmin bool) func(ctx context.Context) bool {
	return func(_ context.Context) bool { return isAdmin }
}

// ---- authorization tests (no Zitadel needed) --------------------------------

func makeHandler(isAdmin bool, zURL, token string) *adminsecurity.Handler {
	return adminsecurity.NewHandler(adminsecurity.Identity{
		Caller:  makeCaller,
		IsAdmin: adminChecker(isAdmin),
	}, zURL, token)
}

func TestUnauthenticated(t *testing.T) {
	h := makeHandler(false, "http://z", "tok")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/security/policies", nil)
	// no withSubject → Caller returns ok=false
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d; want 401", rr.Code)
	}
}

func TestNonAdmin(t *testing.T) {
	h := makeHandler(false, "http://z", "tok")
	req := withSubject(httptest.NewRequest(http.MethodGet, "/api/v1/admin/security/policies", nil), "sub-1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d; want 403", rr.Code)
	}
}

func TestNoServiceToken(t *testing.T) {
	h := makeHandler(true, "http://z", "") // empty token ⇒ 503
	req := withSubject(httptest.NewRequest(http.MethodGet, "/api/v1/admin/security/policies", nil), "sub-1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d; want 503", rr.Code)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	z := newStubZitadel(t, stubState{resourceOwner: "ro-1"})
	h := makeHandler(true, z.URL, "tok")
	// PUT to a read-only path
	req := withSubject(httptest.NewRequest(http.MethodPut, "/api/v1/admin/security/policies", nil), "sub-1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d; want 405 (body=%s)", rr.Code, rr.Body.String())
	}
}

// ---- stub Zitadel -----------------------------------------------------------

type stubState struct {
	resourceOwner string
	// passwordExists controls whether the org password policy PUT 404s first.
	passwordMissing bool
	// captured records the x-zitadel-orgid header seen on the last policy call.
	captured *capturedReq
}

type capturedReq struct {
	orgHeader string
	method    string
	path      string
	body      map[string]any
}

// newStubZitadel spins up a minimal Zitadel stub serving the user lookup + the
// three policy GETs, plus password PUT/POST for the create-before-update test.
func newStubZitadel(t *testing.T, st stubState) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		// User lookup → resourceOwner
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v2/users/"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"user": map[string]any{
					"details": map[string]any{"resourceOwner": st.resourceOwner},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/management/v1/policies/password/complexity":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"policy": map[string]any{
					"minLength": "8", "hasUppercase": true, "hasLowercase": true,
					"hasNumber": true, "hasSymbol": false, "isDefault": true,
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/management/v1/policies/login":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"policy": map[string]any{
					"forceMfa": false, "forceMfaLocalOnly": false,
					"passwordlessType":      "PASSWORDLESS_TYPE_ALLOWED",
					"allowUsernamePassword": true, "isDefault": true,
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/management/v1/policies/lockout":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"policy": map[string]any{
					"maxPasswordAttempts": "5", "maxOtpAttempts": "0", "isDefault": true,
				},
			})
		case r.Method == http.MethodPut && r.URL.Path == "/management/v1/policies/password/complexity":
			if st.captured != nil {
				st.captured.orgHeader = r.Header.Get("x-zitadel-orgid")
				st.captured.method = r.Method
				st.captured.path = r.URL.Path
				_ = json.NewDecoder(r.Body).Decode(&st.captured.body)
			}
			if st.passwordMissing {
				// Org on the instance default → first PUT 404s.
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(map[string]any{"message": "policy not found"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{})
		case r.Method == http.MethodPost && r.URL.Path == "/management/v1/policies/password/complexity":
			// Create the org policy; subsequent PUTs then succeed.
			st.passwordMissing = false
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// ---- policy mapping + scoping tests -----------------------------------------

func TestGetPoliciesMapping(t *testing.T) {
	z := newStubZitadel(t, stubState{resourceOwner: "ro-1"})
	h := makeHandler(true, z.URL, "tok")
	req := withSubject(httptest.NewRequest(http.MethodGet, "/api/v1/admin/security/policies", nil), "sub-1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var resp adminsecurity.PoliciesResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.OrgID != "ro-1" {
		t.Errorf("org_id = %q; want ro-1 (resourceOwner)", resp.OrgID)
	}
	if resp.Password.MinLength != 8 || !resp.Password.HasUppercase || !resp.Password.IsDefault {
		t.Errorf("password policy mapped wrong: %+v", resp.Password)
	}
	if resp.Login.PasswordlessType != "PASSWORDLESS_TYPE_ALLOWED" || !resp.Login.IsDefault {
		t.Errorf("login policy mapped wrong: %+v", resp.Login)
	}
	if resp.Lockout.MaxPasswordAttempts != 5 || !resp.Lockout.IsDefault {
		t.Errorf("lockout policy mapped wrong: %+v", resp.Lockout)
	}
}

// TestPutPasswordCreateBeforeUpdate verifies the default-vs-org policy dance:
// the first PUT 404s (org on instance default), the handler POSTs to create the
// org policy, then retries the PUT and succeeds — and the x-zitadel-orgid header
// carries the caller's resourceOwner on the write.
func TestPutPasswordCreateBeforeUpdate(t *testing.T) {
	cap := &capturedReq{}
	z := newStubZitadel(t, stubState{resourceOwner: "ro-9", passwordMissing: true, captured: cap})
	h := makeHandler(true, z.URL, "tok")
	body := `{"min_length":12,"has_uppercase":true,"has_lowercase":true,"has_number":true,"has_symbol":true}`
	req := withSubject(httptest.NewRequest(http.MethodPut, "/api/v1/admin/security/password", strings.NewReader(body)), "sub-1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if cap.orgHeader != "ro-9" {
		t.Errorf("x-zitadel-orgid = %q; want ro-9 (org scoping)", cap.orgHeader)
	}
	if got, _ := cap.body["minLength"].(float64); got != 12 {
		t.Errorf("minLength sent = %v; want 12", cap.body["minLength"])
	}
}
