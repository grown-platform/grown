package meet

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --------------------------------------------------------------------------
// CodesHandler.Match — pure path routing
// --------------------------------------------------------------------------

func TestCodesHandler_Match(t *testing.T) {
	h := &CodesHandler{}
	tests := []struct {
		path     string
		wantCode string
		wantOK   bool
	}{
		{"/api/v1/meet/codes", "", true},          // collection, no trailing slash
		{"/api/v1/meet/codes/", "", true},         // collection, trailing slash
		{"/api/v1/meet/codes/abc-defg-hij", "abc-defg-hij", true},
		{"/api/v1/meet/codes/anything", "anything", true},
		{"/api/v1/meet/codes/a/b", "", false},     // extra segment
		{"/api/v1/meet/codes/abc/", "", false},    // trailing slash after code
		{"/api/v1/meet/codes-extra", "", false},   // prefix not followed by /
		{"/api/v1/meet", "", false},               // unrelated
		{"/", "", false},                          // root
		{"", "", false},                           // empty
	}
	for _, tt := range tests {
		gotCode, gotOK := h.Match(tt.path)
		if gotCode != tt.wantCode || gotOK != tt.wantOK {
			t.Errorf("Match(%q): got (%q,%v) want (%q,%v)",
				tt.path, gotCode, gotOK, tt.wantCode, tt.wantOK)
		}
	}
}

// --------------------------------------------------------------------------
// ServeHTTP routing short-circuits (no repo / DB needed)
// --------------------------------------------------------------------------

// always returns the configured org/user (and ok).
func ctxFns(org, user string, orgOK, userOK bool) (
	func(*http.Request) (string, bool),
	func(*http.Request) (string, bool),
) {
	return func(*http.Request) (string, bool) { return org, orgOK },
		func(*http.Request) (string, bool) { return user, userOK }
}

func TestServeHTTP_Routing(t *testing.T) {
	// repo is nil; these cases must short-circuit before touching it.
	orgFn, userFn := ctxFns("org1", "user1", true, true)
	h := NewCodesHandler(nil, orgFn, userFn)

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
	}{
		{"get collection is 404", http.MethodGet, "/api/v1/meet/codes", http.StatusNotFound},
		{"post to code is 404", http.MethodPost, "/api/v1/meet/codes/abc-defg-hij", http.StatusNotFound},
		{"delete collection is 404", http.MethodDelete, "/api/v1/meet/codes", http.StatusNotFound},
		{"put code is 404", http.MethodPut, "/api/v1/meet/codes/abc-defg-hij", http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus {
				t.Errorf("status: got %d want %d", rec.Code, tt.wantStatus)
			}
		})
	}
}

func TestHandleCreate_Unauthorized(t *testing.T) {
	tests := []struct {
		name   string
		orgOK  bool
		userOK bool
	}{
		{"missing org", false, true},
		{"missing user", true, false},
		{"missing both", false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			orgFn, userFn := ctxFns("org1", "user1", tt.orgOK, tt.userOK)
			h := NewCodesHandler(nil, orgFn, userFn) // nil repo: must not be reached
			req := httptest.NewRequest(http.MethodPost, "/api/v1/meet/codes", nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status: got %d want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestHandleResolve_Unauthorized(t *testing.T) {
	// No org on context: must short-circuit before repo (nil) is used.
	orgFn, userFn := ctxFns("", "", false, false)
	h := NewCodesHandler(nil, orgFn, userFn)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/meet/codes/abc-defg-hij", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rec.Code, http.StatusUnauthorized)
	}
}

// --------------------------------------------------------------------------
// roomToJSON — JSON shaping
// --------------------------------------------------------------------------

func TestRoomToJSON(t *testing.T) {
	created := time.Date(2026, 6, 11, 14, 30, 0, 0, time.FixedZone("EST", -5*3600))
	r := Room{
		ID:        "room-id",
		OrgID:     "org-id",
		OwnerID:   "owner-id",
		Name:      "Standup",
		Code:      "abc-defg-hij",
		CreatedAt: created,
	}
	got := roomToJSON(r)

	if got.ID != "room-id" || got.OrgID != "org-id" || got.OwnerID != "owner-id" {
		t.Errorf("id fields: %+v", got)
	}
	if got.Name != "Standup" || got.Code != "abc-defg-hij" {
		t.Errorf("name/code: %+v", got)
	}
	// CreatedAt must be RFC3339 in UTC (the EST -5 offset becomes 19:30Z).
	if got.CreatedAt != "2026-06-11T19:30:00Z" {
		t.Errorf("created_at: got %q want UTC RFC3339", got.CreatedAt)
	}

	// Verify it actually marshals with the expected JSON keys.
	b, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{"id", "org_id", "owner_id", "name", "code", "created_at"} {
		if _, ok := back[key]; !ok {
			t.Errorf("missing JSON key %q in %s", key, b)
		}
	}
}
