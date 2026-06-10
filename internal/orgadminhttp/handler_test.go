package orgadminhttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeOrgStore records the last rename and returns a canned org.
type fakeOrgStore struct {
	gotID, gotName string
}

func (f *fakeOrgStore) UpdateDisplayName(_ context.Context, id, name string) (Org, error) {
	f.gotID, f.gotName = id, name
	return Org{ID: id, Slug: "acme", DisplayName: name}, nil
}

// adminIdentity builds an Identity for an admin caller in org "o1".
func adminIdentity(admin bool) Identity {
	return Identity{
		Caller: func(_ context.Context) (string, string, string, string, bool) {
			return "u1", "a@example.com", "o1", "tok", true
		},
		IsAdmin: func(_ context.Context) bool { return admin },
	}
}

// anonIdentity builds an Identity with no caller.
func anonIdentity() Identity {
	return Identity{
		Caller:  func(_ context.Context) (string, string, string, string, bool) { return "", "", "", "", false },
		IsAdmin: func(_ context.Context) bool { return false },
	}
}

func TestRenameOrg_Admin(t *testing.T) {
	store := &fakeOrgStore{}
	h := NewHandler(adminIdentity(true), store, nil, nil, nil)

	body := strings.NewReader(`{"display_name":"  Acme Corp  "}`)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", body)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if store.gotID != "o1" {
		t.Errorf("rename targeted org %q, want o1", store.gotID)
	}
	if store.gotName != "Acme Corp" {
		t.Errorf("name not trimmed: got %q", store.gotName)
	}
	var resp struct {
		Org struct {
			DisplayName string `json:"display_name"`
			Slug        string `json:"slug"`
		} `json:"org"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Org.DisplayName != "Acme Corp" || resp.Org.Slug != "acme" {
		t.Errorf("unexpected response org: %+v", resp.Org)
	}
}

func TestRenameOrg_NonAdminForbidden(t *testing.T) {
	store := &fakeOrgStore{}
	h := NewHandler(adminIdentity(false), store, nil, nil, nil)

	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", strings.NewReader(`{"display_name":"x"}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want 403", w.Code)
	}
	if store.gotName != "" {
		t.Errorf("rename should not have run for a non-admin")
	}
}

func TestRenameOrg_Unauthenticated(t *testing.T) {
	h := NewHandler(anonIdentity(), &fakeOrgStore{}, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", strings.NewReader(`{"display_name":"x"}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status: got %d, want 401", w.Code)
	}
}

func TestRenameOrg_EmptyName(t *testing.T) {
	h := NewHandler(adminIdentity(true), &fakeOrgStore{}, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", strings.NewReader(`{"display_name":"   "}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400", w.Code)
	}
}

func TestRenameOrg_NilStoreUnavailable(t *testing.T) {
	h := NewHandler(adminIdentity(true), nil, nil, nil, nil)
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org", strings.NewReader(`{"display_name":"x"}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d, want 503", w.Code)
	}
}

// fakeBranding records accent/logo writes.
type fakeBranding struct {
	b Branding
}

func (f *fakeBranding) Get(_ context.Context, orgID string) (Branding, error) {
	f.b.OrgID = orgID
	return f.b, nil
}
func (f *fakeBranding) SetAccentColor(_ context.Context, _, accent string) error {
	f.b.AccentColor = accent
	return nil
}
func (f *fakeBranding) SetProductName(_ context.Context, _, name string) error {
	f.b.ProductName = name
	return nil
}
func (f *fakeBranding) SetLogo(_ context.Context, _, key, mime string) error {
	f.b.LogoBlobKey, f.b.LogoMIME = key, mime
	return nil
}

func TestSetAccentColor_Validation(t *testing.T) {
	fb := &fakeBranding{}
	h := NewHandler(adminIdentity(true), nil, fb, nil, nil)

	// Bad color is rejected.
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/branding", strings.NewReader(`{"accent_color":"green"}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad color status: got %d, want 400", w.Code)
	}

	// Good color is stored.
	r = httptest.NewRequest(http.MethodPatch, "/api/v1/admin/org/branding", strings.NewReader(`{"accent_color":"#3F704D"}`))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("good color status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if fb.b.AccentColor != "#3F704D" {
		t.Errorf("accent not stored: %q", fb.b.AccentColor)
	}
}

func TestPublicBranding_DegradesToDefaults(t *testing.T) {
	// No branding store wired → an authenticated member still gets a 200 with
	// empty (default) branding rather than an error.
	h := NewHandler(adminIdentity(false), nil, nil, nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/api/v1/org/branding", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", w.Code)
	}
	var out brandingOut
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.AccentColor != "" || out.HasLogo {
		t.Errorf("expected empty branding, got %+v", out)
	}
}

// fakeSessions returns canned listings and records revokes.
type fakeSessions struct {
	org, user      []SessionInfo
	revokedOrgID   string
	revokedID      string
	revokeOrgOK    bool
	revokedUserID  string
	revokedUserSID string
	revokeUserOK   bool
}

func (f *fakeSessions) ListByOrg(_ context.Context, _, _ string) ([]SessionInfo, error) {
	return f.org, nil
}
func (f *fakeSessions) ListByUser(_ context.Context, _, _ string) ([]SessionInfo, error) {
	return f.user, nil
}
func (f *fakeSessions) RevokeByOrgAndID(_ context.Context, orgID, id string) (bool, error) {
	f.revokedOrgID, f.revokedID = orgID, id
	return f.revokeOrgOK, nil
}
func (f *fakeSessions) RevokeByUserAndID(_ context.Context, userID, id string) (bool, error) {
	f.revokedUserID, f.revokedUserSID = userID, id
	return f.revokeUserOK, nil
}

func TestAdminListSessions_OmitsToken(t *testing.T) {
	fs := &fakeSessions{org: []SessionInfo{{ID: "abc123", Email: "x@y.z", IP: "1.2.3.4", UserAgent: "ua"}}}
	h := NewHandler(adminIdentity(true), nil, nil, nil, fs)

	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/sessions", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if strings.Contains(body, "token") {
		t.Errorf("session JSON must not contain a token field: %s", body)
	}
	if !strings.Contains(body, "abc123") {
		t.Errorf("expected session id in body: %s", body)
	}
}

func TestAdminRevokeSession_OrgScoped(t *testing.T) {
	fs := &fakeSessions{revokeOrgOK: true}
	h := NewHandler(adminIdentity(true), nil, nil, nil, fs)

	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/sessions/abc123/revoke", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if fs.revokedOrgID != "o1" || fs.revokedID != "abc123" {
		t.Errorf("revoke called with org=%q id=%q; want o1/abc123", fs.revokedOrgID, fs.revokedID)
	}
}

func TestRevokeOwnSession_AnyMember(t *testing.T) {
	fs := &fakeSessions{revokeUserOK: true}
	// Non-admin caller may still revoke their OWN session.
	h := NewHandler(adminIdentity(false), nil, nil, nil, fs)

	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/sessions/deadbeef/revoke", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (%s)", w.Code, w.Body.String())
	}
	if fs.revokedUserID != "u1" || fs.revokedUserSID != "deadbeef" {
		t.Errorf("own-revoke called with user=%q id=%q; want u1/deadbeef", fs.revokedUserID, fs.revokedUserSID)
	}
}

func TestAdminSessions_NonAdminForbidden(t *testing.T) {
	h := NewHandler(adminIdentity(false), nil, nil, nil, &fakeSessions{})
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/sessions", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status: got %d, want 403", w.Code)
	}
}

func TestIsHexColor(t *testing.T) {
	cases := map[string]bool{
		"#3F704D": true, "#abc": true, "#ABCDEF": true,
		"3F704D": false, "#12345": false, "green": false, "#GGGGGG": false, "": false,
	}
	for in, want := range cases {
		if got := isHexColor(in); got != want {
			t.Errorf("isHexColor(%q) = %v, want %v", in, got, want)
		}
	}
}
