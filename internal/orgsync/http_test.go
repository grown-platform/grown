package orgsync

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ctxFunc builds an orgFromCtx/userFromCtx callback returning a fixed value.
func ctxFunc(val string, ok bool) func(*http.Request) (string, bool) {
	return func(*http.Request) (string, bool) { return val, ok }
}

// TestHTTPHandler_Match verifies routing only matches the transfer mount path.
func TestHTTPHandler_Match(t *testing.T) {
	h := NewHTTPHandler(nil, ctxFunc("org", true), ctxFunc("user", true))
	tests := []struct {
		path string
		want bool
	}{
		{"/api/v1/orgsync/transfer", true},
		{"/api/v1/orgsync/transfer/", false},
		{"/api/v1/orgsync", false},
		{"/api/v1/orgsync/transfers", false},
		{"/", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if got := h.Match(tt.path); got != tt.want {
				t.Errorf("Match(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

// TestHTTPHandler_ValidationShortCircuits exercises every request path that
// returns before reaching svc.Transfer. Because these all short-circuit, a nil
// Service is safe and lets us test the routing/validation logic in isolation
// (the concrete Service depends on real repositories that need a database).
func TestHTTPHandler_ValidationShortCircuits(t *testing.T) {
	tests := []struct {
		name     string
		method   string
		path     string
		body     string
		orgOK    bool
		userOK   bool
		wantCode int
	}{
		{
			name:     "wrong path 404",
			method:   http.MethodPost,
			path:     "/api/v1/orgsync/other",
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusNotFound,
		},
		{
			name:     "GET not allowed",
			method:   http.MethodGet,
			path:     mount,
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusMethodNotAllowed,
		},
		{
			name:     "PUT not allowed",
			method:   http.MethodPut,
			path:     mount,
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusMethodNotAllowed,
		},
		{
			name:     "missing org context",
			method:   http.MethodPost,
			path:     mount,
			body:     `{"target_slug":"acme"}`,
			orgOK:    false,
			userOK:   true,
			wantCode: http.StatusUnauthorized,
		},
		{
			name:     "missing user context",
			method:   http.MethodPost,
			path:     mount,
			body:     `{"target_slug":"acme"}`,
			orgOK:    true,
			userOK:   false,
			wantCode: http.StatusUnauthorized,
		},
		{
			name:     "malformed JSON",
			method:   http.MethodPost,
			path:     mount,
			body:     `{not json`,
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "empty body",
			method:   http.MethodPost,
			path:     mount,
			body:     ``,
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "missing target_slug",
			method:   http.MethodPost,
			path:     mount,
			body:     `{"drive_file_ids":["f1"]}`,
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusBadRequest,
		},
		{
			name:     "empty target_slug",
			method:   http.MethodPost,
			path:     mount,
			body:     `{"target_slug":""}`,
			orgOK:    true,
			userOK:   true,
			wantCode: http.StatusBadRequest,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// nil Service: all rows must short-circuit before svc.Transfer.
			h := NewHTTPHandler(nil, ctxFunc("org-1", tt.orgOK), ctxFunc("user-1", tt.userOK))
			req := httptest.NewRequest(tt.method, "http://example.com"+tt.path, strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.wantCode {
				t.Errorf("status = %d, want %d (body: %q)", rec.Code, tt.wantCode, rec.Body.String())
			}
		})
	}
}
