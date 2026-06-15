package orgadminhttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// nilCallerIdentity has a nil Caller closure, exercising the "no identity wired"
// branch of caller().
func nilCallerIdentity() Identity {
	return Identity{Caller: nil, IsAdmin: func(_ context.Context) bool { return true }}
}

// adminNilCheckerIdentity resolves a caller but leaves IsAdmin nil, exercising
// the "IsAdmin == nil" denial branch of requireAdmin().
func adminNilCheckerIdentity() Identity {
	return Identity{
		Caller:  func(_ context.Context) (string, string, string, string, bool) { return "u1", "a@b.c", "o1", "tok", true },
		IsAdmin: nil,
	}
}

// noOrgAdminIdentity is an admin whose caller has no org context, exercising the
// "no org context" 400 branch of requireAdmin().
func noOrgAdminIdentity() Identity {
	return Identity{
		Caller:  func(_ context.Context) (string, string, string, string, bool) { return "u1", "a@b.c", "", "tok", true },
		IsAdmin: func(_ context.Context) bool { return true },
	}
}

// TestCaller_NilClosure: every admin route returns 401 when Caller is nil.
func TestCaller_NilClosure(t *testing.T) {
	h := NewHandler(nilCallerIdentity(), &fakeOrgStore{}, &fakeBranding{}, nil, &fakeSessions{})
	paths := []struct{ method, path string }{
		{http.MethodPatch, "/api/v1/admin/org"},
		{http.MethodGet, "/api/v1/admin/org/branding"},
		{http.MethodGet, "/api/v1/admin/sessions"},
		{http.MethodGet, "/api/v1/me/sessions"},
		{http.MethodPost, "/api/v1/me/sessions/x/revoke"},
		{http.MethodGet, "/api/v1/org/branding"},
	}
	for _, p := range paths {
		r := httptest.NewRequest(p.method, p.path, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: got %d, want 401", p.method, p.path, w.Code)
		}
	}
}

// TestRequireAdmin_NilChecker: a nil IsAdmin closure denies with 403.
func TestRequireAdmin_NilChecker(t *testing.T) {
	h := NewHandler(adminNilCheckerIdentity(), &fakeOrgStore{}, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("nil IsAdmin: got %d, want 403", w.Code)
	}
}

// TestRequireAdmin_NoOrgContext: an admin without an org gets 400.
func TestRequireAdmin_NoOrgContext(t *testing.T) {
	h := NewHandler(noOrgAdminIdentity(), &fakeOrgStore{}, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("no org context: got %d, want 400", w.Code)
	}
}

// TestAdminGates_AllRoutesDenyNonAdmin checks every admin-gated route returns
// 403 for a non-admin caller, before any store interaction.
func TestAdminGates_AllRoutesDenyNonAdmin(t *testing.T) {
	h := NewHandler(adminIdentity(false), &fakeOrgStore{}, &fakeBranding{}, nil, &fakeSessions{})
	routes := []struct{ method, path string }{
		{http.MethodPatch, "/api/v1/admin/org"},
		{http.MethodGet, "/api/v1/admin/org/branding"},
		{http.MethodPatch, "/api/v1/admin/org/branding"},
		{http.MethodPost, "/api/v1/admin/org/branding/logo"},
		{http.MethodDelete, "/api/v1/admin/org/branding/logo"},
		{http.MethodGet, "/api/v1/admin/sessions"},
		{http.MethodPost, "/api/v1/admin/sessions/abc/revoke"},
	}
	for _, rt := range routes {
		r := httptest.NewRequest(rt.method, rt.path, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s: got %d, want 403", rt.method, rt.path, w.Code)
		}
	}
}
