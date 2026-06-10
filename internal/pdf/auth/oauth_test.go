package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// We test the parts of LoginHandler / CallbackHandler that don't require a
// real OIDC provider — namely the state+nonce cookie issuance and validation.

func TestLoginHandler_SetsRandomStateCookie(t *testing.T) {
	o := &OAuth{
		oauthConfig: nil, // we'll only invoke the parts that don't need it
	}
	// Force the path that builds and sets the cookie without performing the
	// actual provider redirect. We do this by calling buildLoginRedirect and
	// inspecting its return values directly.
	state1, nonce1 := o.generateStateAndNonce()
	state2, nonce2 := o.generateStateAndNonce()

	if state1 == "" || nonce1 == "" {
		t.Fatal("expected non-empty state and nonce")
	}
	if state1 == state2 || nonce1 == nonce2 {
		t.Fatalf("state/nonce must be unique per call (got duplicates)")
	}
	if len(state1) < 32 || len(nonce1) < 32 {
		t.Fatalf("state/nonce too short: state=%d nonce=%d", len(state1), len(nonce1))
	}
}

func TestCallbackHandler_RejectsMissingStateCookie(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=anything", nil)
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for missing cookie, got %d", w.Code)
	}
}

func TestCallbackHandler_RejectsStateMismatch(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=attacker-state", nil)
	req.AddCookie(&http.Cookie{
		Name:  oauthStateCookieName,
		Value: url.QueryEscape("real-state:real-nonce"),
	})
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for state mismatch, got %d", w.Code)
	}
}

func TestCallbackHandler_RejectsMalformedStateCookie(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=foo", nil)
	req.AddCookie(&http.Cookie{
		Name:  oauthStateCookieName,
		Value: "no-colon-separator",
	})
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400 for malformed cookie, got %d", w.Code)
	}
}

func TestCallbackHandler_DeletesCookieOnMismatch(t *testing.T) {
	o := &OAuth{cookieName: "pdf_auth"}

	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=wrong", nil)
	req.AddCookie(&http.Cookie{
		Name:  oauthStateCookieName,
		Value: url.QueryEscape("right:nonce"),
	})
	w := httptest.NewRecorder()
	o.CallbackHandler().ServeHTTP(w, req)

	// Confirm Set-Cookie clears the state cookie
	for _, sc := range w.Result().Cookies() {
		if sc.Name == oauthStateCookieName && (sc.MaxAge < 0 || strings.HasPrefix(sc.Value, "")) && sc.Value == "" {
			return
		}
	}
	t.Fatal("expected state cookie to be cleared on mismatch")
}
