package tickets

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// authStub builds AuthFuncs returning the given identity. ok controls whether
// OrgID resolves (i.e. whether the caller is authenticated).
func authStub(orgID, userID, name, email string, ok bool) AuthFuncs {
	return AuthFuncs{
		OrgID:     func(*http.Request) (string, bool) { return orgID, ok },
		UserID:    func(*http.Request) (string, bool) { return userID, userID != "" },
		UserName:  func(*http.Request) string { return name },
		UserEmail: func(*http.Request) string { return email },
	}
}

// TestHandlerMatch verifies the authenticated handler claims exactly its mount
// subtree and nothing else.
func TestHandlerMatch(t *testing.T) {
	h := NewHTTPHandler(nil, AuthFuncs{})
	match := []string{
		"/api/v1/tickets",
		"/api/v1/tickets/projects",
		"/api/v1/tickets/projects/123",
		"/api/v1/tickets/items/abc",
	}
	for _, p := range match {
		if !h.Match(p) {
			t.Errorf("Match(%q) = false, want true", p)
		}
	}
	noMatch := []string{
		"/api/v1/ticketsfoo",
		"/api/v1/tickets-extra",
		"/api/v1/public/tickets/abc",
		"/api/v1/other",
		"/",
	}
	for _, p := range noMatch {
		if h.Match(p) {
			t.Errorf("Match(%q) = true, want false", p)
		}
	}
}

// TestPublicHandlerMatch verifies the public handler claims only its mount
// subtree (and requires a token segment).
func TestPublicHandlerMatch(t *testing.T) {
	p := NewPublicHandler(nil)
	if !p.Match("/api/v1/public/tickets/sometoken") {
		t.Error("Match public token path = false, want true")
	}
	// Bare mount without trailing slash is not matched (handler requires /token).
	if p.Match("/api/v1/public/tickets") {
		t.Error("Match bare mount = true, want false")
	}
	if p.Match("/api/v1/tickets/projects") {
		t.Error("Match authenticated path = true, want false")
	}
}

// TestServeHTTPUnauthorized verifies that a request the auth layer can't resolve
// to an org gets 401 before any repository call (repo is nil here, proving no
// DB access occurs).
func TestServeHTTPUnauthorized(t *testing.T) {
	h := NewHTTPHandler(nil, authStub("", "", "", "", false))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tickets/projects", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

// TestServeHTTPUnknownTopSegment verifies an authorized request to an unknown
// top-level segment returns 404 without touching the repository.
func TestServeHTTPUnknownTopSegment(t *testing.T) {
	h := NewHTTPHandler(nil, authStub("org1", "u1", "Jane", "j@example.com", true))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tickets/bogus", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// TestServeHTTPMountRootIsNotFound verifies the bare mount (no sub-resource)
// resolves to 404 once authorized, without touching the repository.
func TestServeHTTPMountRootNotFound(t *testing.T) {
	h := NewHTTPHandler(nil, authStub("org1", "u1", "Jane", "j@example.com", true))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tickets", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// TestServeHTTPItemsNoIDNotFound verifies /items with no id is 404 before any
// repo call.
func TestServeHTTPItemsNoIDNotFound(t *testing.T) {
	h := NewHTTPHandler(nil, authStub("org1", "u1", "Jane", "j@example.com", true))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tickets/items", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// TestServeHTTPProjectsUnsupportedMethod verifies that an unsupported method on
// /projects/{id} falls through to 404 (the default arm) without a repo call.
func TestServeHTTPProjectsUnsupportedMethod(t *testing.T) {
	h := NewHTTPHandler(nil, authStub("org1", "u1", "Jane", "j@example.com", true))
	// DELETE on a project id is not handled -> default 404.
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tickets/projects/123", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// TestServeHTTPItemsUnsupportedMethod verifies an unsupported method on an item
// falls through to 404 without a repo call.
func TestServeHTTPItemsUnsupportedMethod(t *testing.T) {
	h := NewHTTPHandler(nil, authStub("org1", "u1", "Jane", "j@example.com", true))
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/tickets/items/abc", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

// TestPublicHandlerEmptyToken verifies a missing or slash-bearing token yields
// 404 before any repository call.
func TestPublicHandlerEmptyToken(t *testing.T) {
	p := NewPublicHandler(nil)
	for _, path := range []string{
		"/api/v1/public/tickets/",    // empty token
		"/api/v1/public/tickets/a/b", // contains slash
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rr := httptest.NewRecorder()
		p.ServeHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Errorf("ServeHTTP(%q) status = %d, want 404", path, rr.Code)
		}
	}
}

// TestPublicHandlerMethodNotAllowed verifies non-GET/POST methods on a valid
// token path return 405 before any repository call.
func TestPublicHandlerMethodNotAllowed(t *testing.T) {
	p := NewPublicHandler(nil)
	req := httptest.NewRequest(http.MethodPut, "/api/v1/public/tickets/pt_token", nil)
	rr := httptest.NewRecorder()
	p.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rr.Code)
	}
}

// TestPublicHandlerPostEmptyTitle verifies the public intake POST validates a
// required title and rejects with 400 before any repository call.
func TestPublicHandlerPostEmptyTitle(t *testing.T) {
	p := NewPublicHandler(nil)
	body := strings.NewReader(`{"title":"   ","body":"x","name":"n","email":"e@x.com"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/public/tickets/pt_token", body)
	rr := httptest.NewRecorder()
	p.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "title required") {
		t.Errorf("body = %q, want 'title required'", rr.Body.String())
	}
}
