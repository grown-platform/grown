package telephony

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConnectPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"exact match", connectPath, true},
		{"trailing slash", connectPath + "/", false},
		{"prefix only", "/api/v1/telephony", false},
		{"unrelated", "/api/v1/telephony/calls/log", false},
		{"empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ConnectPath(tt.path); got != tt.want {
				t.Errorf("ConnectPath(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

func TestLogCallHandler_Match(t *testing.T) {
	h := NewLogCallHandler(nil, nil, nil)
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"exact match", logCallMount, true},
		{"trailing slash", logCallMount + "/", false},
		{"connect path", connectPath, false},
		{"empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := h.Match(tt.path); got != tt.want {
				t.Errorf("Match(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}

// ctxFn is a small helper producing org/user-from-context closures with a fixed
// return for tests that only exercise the handler's short-circuit paths.
func ctxFn(id string, ok bool) func(*http.Request) (string, bool) {
	return func(*http.Request) (string, bool) { return id, ok }
}

// TestLogCallHandler_ServeHTTP_ShortCircuits exercises every validation/auth
// branch that returns *before* the repository (and therefore the DB) is
// touched, so no pool is needed. A nil-repo handler is safe here because none
// of these cases reach repo.LogCall.
func TestLogCallHandler_ServeHTTP_ShortCircuits(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		org        func(*http.Request) (string, bool)
		user       func(*http.Request) (string, bool)
		body       string
		wantStatus int
		wantBody   string // substring expected in error body ("" = skip)
	}{
		{
			name:       "wrong method",
			method:     http.MethodGet,
			org:        ctxFn("org1", true),
			user:       ctxFn("u1", true),
			body:       "",
			wantStatus: http.StatusMethodNotAllowed,
			wantBody:   "method not allowed",
		},
		{
			name:       "missing org context",
			method:     http.MethodPost,
			org:        ctxFn("", false),
			user:       ctxFn("u1", true),
			body:       `{"peer_id":"p"}`,
			wantStatus: http.StatusUnauthorized,
			wantBody:   "unauthorized",
		},
		{
			name:       "missing user context",
			method:     http.MethodPost,
			org:        ctxFn("org1", true),
			user:       ctxFn("", false),
			body:       `{"peer_id":"p"}`,
			wantStatus: http.StatusUnauthorized,
			wantBody:   "unauthorized",
		},
		{
			name:       "missing peer_id",
			method:     http.MethodPost,
			org:        ctxFn("org1", true),
			user:       ctxFn("u1", true),
			body:       `{"direction":"outgoing"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "peer_id required",
		},
		{
			name:       "empty peer_id explicit",
			method:     http.MethodPost,
			org:        ctxFn("org1", true),
			user:       ctxFn("u1", true),
			body:       `{"peer_id":""}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "peer_id required",
		},
		{
			name:       "malformed json then missing peer_id",
			method:     http.MethodPost,
			org:        ctxFn("org1", true),
			user:       ctxFn("u1", true),
			body:       `{not json`,
			wantStatus: http.StatusBadRequest,
			wantBody:   "peer_id required",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewLogCallHandler(nil, tt.org, tt.user)
			req := httptest.NewRequest(tt.method, logCallMount, strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status: got %d want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("body: got %q want substring %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

// TestLogCallHandler_ServeHTTP_NilBody verifies the handler tolerates a nil
// request body and still short-circuits on the missing peer_id.
func TestLogCallHandler_ServeHTTP_NilBody(t *testing.T) {
	h := NewLogCallHandler(nil, ctxFn("org1", true), ctxFn("u1", true))
	req := httptest.NewRequest(http.MethodPost, logCallMount, nil)
	req.Body = nil
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rec.Code, http.StatusBadRequest)
	}
}
