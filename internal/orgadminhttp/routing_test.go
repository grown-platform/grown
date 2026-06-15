package orgadminhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRouting_Dispatch exercises ServeHTTP's method/path matrix with a fully
// nil-store handler. Each route should authorize/short-circuit before touching a
// store, so the expected status reflects the routing + auth + method layer only.
func TestRouting_Dispatch(t *testing.T) {
	cases := []struct {
		name   string
		method string
		path   string
		admin  bool
		want   int
	}{
		// Unknown path → 404 regardless of method.
		{"unknown path", http.MethodGet, "/api/v1/admin/nope", true, http.StatusNotFound},
		{"root path", http.MethodGet, "/", true, http.StatusNotFound},
		{"empty admin segment", http.MethodGet, "/api/v1/admin", true, http.StatusNotFound},

		// Admin org rename: wrong method → 405 (method check precedes admin check).
		{"rename wrong method GET", http.MethodGet, "/api/v1/admin/org", true, http.StatusMethodNotAllowed},
		{"rename wrong method POST", http.MethodPost, "/api/v1/admin/org", true, http.StatusMethodNotAllowed},
		// Right method but nil orgs store (admin passes) → 503.
		{"rename nil store", http.MethodPatch, "/api/v1/admin/org", true, http.StatusServiceUnavailable},

		// Admin branding: admin passes, nil branding store → 503 (GET & PATCH).
		{"branding GET nil store", http.MethodGet, "/api/v1/admin/org/branding", true, http.StatusServiceUnavailable},
		{"branding PATCH nil store", http.MethodPatch, "/api/v1/admin/org/branding", true, http.StatusServiceUnavailable},
		// adminBranding has no method guard before requireAdmin; PUT falls to default 405 after store check.
		{"branding wrong method", http.MethodPut, "/api/v1/admin/org/branding", true, http.StatusServiceUnavailable},

		// Admin branding logo: nil branding+blobs → 503.
		{"branding logo POST nil store", http.MethodPost, "/api/v1/admin/org/branding/logo", true, http.StatusServiceUnavailable},
		{"branding logo DELETE nil store", http.MethodDelete, "/api/v1/admin/org/branding/logo", true, http.StatusServiceUnavailable},

		// Admin sessions list: wrong method → 405.
		{"sessions list wrong method", http.MethodPost, "/api/v1/admin/sessions", true, http.StatusMethodNotAllowed},
		{"sessions list nil store", http.MethodGet, "/api/v1/admin/sessions", true, http.StatusServiceUnavailable},

		// Admin revoke: wrong method → 405; right method nil store → 503.
		{"admin revoke wrong method", http.MethodGet, "/api/v1/admin/sessions/abc/revoke", true, http.StatusMethodNotAllowed},
		{"admin revoke nil store", http.MethodPost, "/api/v1/admin/sessions/abc/revoke", true, http.StatusServiceUnavailable},

		// Public branding: any member; wrong method → 405; GET with nil store → 200 (defaults).
		{"public branding wrong method", http.MethodPost, "/api/v1/org/branding", false, http.StatusMethodNotAllowed},
		{"public branding GET defaults", http.MethodGet, "/api/v1/org/branding", false, http.StatusOK},

		// Public logo: wrong method → 405; GET nil store → 404.
		{"public logo wrong method", http.MethodPost, "/api/v1/org/branding/logo", false, http.StatusMethodNotAllowed},
		{"public logo GET nil store", http.MethodGet, "/api/v1/org/branding/logo", false, http.StatusNotFound},

		// Own sessions: wrong method → 405; GET nil store → 503.
		{"me sessions wrong method", http.MethodPost, "/api/v1/me/sessions", false, http.StatusMethodNotAllowed},
		{"me sessions nil store", http.MethodGet, "/api/v1/me/sessions", false, http.StatusServiceUnavailable},

		// Own revoke: wrong method → 405; right method nil store → 503.
		{"me revoke wrong method", http.MethodGet, "/api/v1/me/sessions/abc/revoke", false, http.StatusMethodNotAllowed},
		{"me revoke nil store", http.MethodPost, "/api/v1/me/sessions/abc/revoke", false, http.StatusServiceUnavailable},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := NewHandler(adminIdentity(tc.admin), nil, nil, nil, nil)
			r := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("%s %s: got %d, want %d (%s)", tc.method, tc.path, w.Code, tc.want, w.Body.String())
			}
		})
	}
}

// TestRouting_TrailingSlashNormalized confirms trailing slashes are trimmed so
// "/api/v1/admin/org/" matches the same branch as "/api/v1/admin/org".
func TestRouting_TrailingSlashNormalized(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	// Matched the rename branch, admin ok, nil store → 503 (not 404).
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("trailing slash should match rename branch: got %d, want 503", w.Code)
	}
}

// TestSessionIDFrom verifies the {id} extraction from the revoke paths.
func TestSessionIDFrom(t *testing.T) {
	cases := []struct {
		path, prefix, want string
	}{
		{"/api/v1/admin/sessions/abc123/revoke", "/api/v1/admin/sessions/", "abc123"},
		{"/api/v1/me/sessions/deadbeef/revoke", "/api/v1/me/sessions/", "deadbeef"},
		{"/api/v1/admin/sessions//revoke", "/api/v1/admin/sessions/", ""},
		{"/api/v1/me/sessions/with/slash/revoke", "/api/v1/me/sessions/", "with/slash"},
	}
	for _, c := range cases {
		if got := sessionIDFrom(c.path, c.prefix); got != c.want {
			t.Errorf("sessionIDFrom(%q,%q) = %q, want %q", c.path, c.prefix, got, c.want)
		}
	}
}
