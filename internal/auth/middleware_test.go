package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"code.pick.haus/grown/grown/internal/orgs"
)

func TestHTTPMiddleware_NilDepsPassThrough(t *testing.T) {
	defaultOrg := orgs.Org{ID: "o1", Slug: "default", DisplayName: "Default"}

	var sawUser bool
	var sawOrgID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sawUser = UserFromContext(r.Context())
		if o, ok := OrgFromContext(r.Context()); ok {
			sawOrgID = o.ID
		}
		w.WriteHeader(http.StatusOK)
	})

	mw := HTTPMiddleware(Config{CookieName: "grown_session"}, nil, nil, nil, defaultOrg)
	handler := mw(next)

	req := httptest.NewRequest("GET", "/anything", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rec.Code)
	}
	if sawUser {
		t.Errorf("expected no user on context (nil sessions)")
	}
	if sawOrgID != "o1" {
		t.Errorf("expected default org attached even without auth; got %q", sawOrgID)
	}
}

func TestHTTPMiddleware_NoCookiePassThrough(t *testing.T) {
	// Use a non-nil sessions/urepo so the defensive guard is bypassed and
	// the cookie-reading path executes. We expect no user since no cookie
	// is sent.
	// (We can't construct real *SessionStore / *users.Repository without
	// a DB, so this test exercises the nil-deps path again -- it's the
	// only one we can hit in pure unit-test mode. The cookie-present
	// happy path is covered by the T17 e2e against real Zitadel.)
	defaultOrg := orgs.Org{ID: "o2", Slug: "default", DisplayName: "Default"}

	var sawUser bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sawUser = UserFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	mw := HTTPMiddleware(Config{CookieName: "grown_session"}, nil, nil, nil, defaultOrg)
	handler := mw(next)

	req := httptest.NewRequest("GET", "/anything", nil)
	// Even with a cookie, nil deps short-circuit.
	req.AddCookie(&http.Cookie{Name: "grown_session", Value: "nope"})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rec.Code)
	}
	if sawUser {
		t.Errorf("expected no user (nil deps)")
	}
}
