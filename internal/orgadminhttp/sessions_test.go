package orgadminhttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestToSessionOut_ActiveRevokedFlags(t *testing.T) {
	now := time.Now()
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)
	seen := now.Add(-time.Minute)
	revoked := now.Add(-30 * time.Minute)

	cases := []struct {
		name        string
		in          SessionInfo
		wantActive  bool
		wantRevoked bool
		wantSeenSet bool
	}{
		{
			name:       "active non-revoked",
			in:         SessionInfo{ID: "a", ExpiresAt: future, LastSeenAt: &seen},
			wantActive: true, wantRevoked: false, wantSeenSet: true,
		},
		{
			name:       "expired",
			in:         SessionInfo{ID: "b", ExpiresAt: past},
			wantActive: false, wantRevoked: false, wantSeenSet: false,
		},
		{
			name:       "revoked overrides active",
			in:         SessionInfo{ID: "c", ExpiresAt: future, RevokedAt: &revoked},
			wantActive: false, wantRevoked: true, wantSeenSet: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := toSessionOut(tc.in)
			if out.Active != tc.wantActive {
				t.Errorf("active: got %v, want %v", out.Active, tc.wantActive)
			}
			if out.Revoked != tc.wantRevoked {
				t.Errorf("revoked: got %v, want %v", out.Revoked, tc.wantRevoked)
			}
			if (out.LastSeenAt != "") != tc.wantSeenSet {
				t.Errorf("last_seen_at set: got %q, want set=%v", out.LastSeenAt, tc.wantSeenSet)
			}
			if _, err := time.Parse(time.RFC3339, out.CreatedAt); err != nil {
				t.Errorf("created_at not RFC3339: %q", out.CreatedAt)
			}
			if _, err := time.Parse(time.RFC3339, out.ExpiresAt); err != nil {
				t.Errorf("expires_at not RFC3339: %q", out.ExpiresAt)
			}
		})
	}
}

func TestMapSessions_PreservesOrderAndCurrent(t *testing.T) {
	future := time.Now().Add(time.Hour)
	in := []SessionInfo{
		{ID: "1", ExpiresAt: future, Current: true},
		{ID: "2", ExpiresAt: future},
	}
	out := mapSessions(in)
	if len(out) != 2 {
		t.Fatalf("len: got %d, want 2", len(out))
	}
	if out[0].ID != "1" || !out[0].Current {
		t.Errorf("first session: %+v", out[0])
	}
	if out[1].ID != "2" || out[1].Current {
		t.Errorf("second session: %+v", out[1])
	}
}

func TestMapSessions_Empty(t *testing.T) {
	out := mapSessions(nil)
	if out == nil {
		t.Fatalf("expected non-nil empty slice for stable JSON marshaling")
	}
	if len(out) != 0 {
		t.Fatalf("len: got %d, want 0", len(out))
	}
	b, _ := json.Marshal(out)
	if string(b) != "[]" {
		t.Errorf("empty sessions marshal: got %s, want []", b)
	}
}

func TestListOwnSessions_UsesUserID(t *testing.T) {
	future := time.Now().Add(time.Hour)
	fs := &fakeSessions{user: []SessionInfo{{ID: "s1", Email: "me@x.y", ExpiresAt: future}}}
	h := NewHandler(adminIdentity(false), nil, nil, nil, fs)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/sessions", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "s1") {
		t.Errorf("expected own session id in body: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "token") {
		t.Errorf("body must not contain token: %s", w.Body.String())
	}
}

func TestAdminRevokeSession_NotFound404(t *testing.T) {
	fs := &fakeSessions{revokeOrgOK: false}
	h := NewHandler(adminIdentity(true), nil, nil, nil, fs)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sessions/missing/revoke", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("revoke missing: got %d, want 404", w.Code)
	}
}

func TestRevokeOwnSession_NotFound404(t *testing.T) {
	fs := &fakeSessions{revokeUserOK: false}
	h := NewHandler(adminIdentity(false), nil, nil, nil, fs)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/sessions/missing/revoke", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("own revoke missing: got %d, want 404", w.Code)
	}
}

func TestAdminRevokeSession_EmptyID400(t *testing.T) {
	fs := &fakeSessions{}
	h := NewHandler(adminIdentity(true), nil, nil, nil, fs)
	// Path "/api/v1/admin/sessions//revoke" extracts an empty id.
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sessions//revoke", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty id: got %d, want 400 (%s)", w.Code, w.Body.String())
	}
}

func TestRevokeOwnSession_EmptyID400(t *testing.T) {
	fs := &fakeSessions{}
	h := NewHandler(adminIdentity(false), nil, nil, nil, fs)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/sessions//revoke", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty id own: got %d, want 400 (%s)", w.Code, w.Body.String())
	}
}

func TestIsAllowedLogoMIME(t *testing.T) {
	cases := map[string]bool{
		"image/png": true, "image/jpeg": true, "image/jpg": true,
		"image/webp": true, "image/svg+xml": true, "image/gif": true,
		"  IMAGE/PNG  ": true, // trimmed + lowercased
		"application/pdf": false, "text/html": false, "": false,
	}
	for in, want := range cases {
		if got := isAllowedLogoMIME(in); got != want {
			t.Errorf("isAllowedLogoMIME(%q) = %v, want %v", in, got, want)
		}
	}
}
