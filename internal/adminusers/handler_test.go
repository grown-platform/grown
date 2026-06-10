package adminusers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/adminusers"
)

// ctxKey carries the test caller's identity through the request context.
type ctxKey string

const (
	emailKey ctxKey = "email"
	userKey  ctxKey = "user"
	orgKey   ctxKey = "org"
)

func withCaller(r *http.Request, email, userID, orgID string) *http.Request {
	ctx := context.WithValue(r.Context(), emailKey, email)
	ctx = context.WithValue(ctx, userKey, userID)
	ctx = context.WithValue(ctx, orgKey, orgID)
	return r.WithContext(ctx)
}

func emailResolver(ctx context.Context) (string, bool) {
	e, _ := ctx.Value(emailKey).(string)
	if e == "" {
		return "", false
	}
	return e, true
}

// fakeRoster is an in-memory AdminRoster for black-box tests. It maps Zitadel id
// → grown user id 1:1 and tracks admin grants per org.
type fakeRoster struct {
	admins map[string]map[string]bool // orgID -> grownUserID -> true
}

func newFakeRoster() *fakeRoster { return &fakeRoster{admins: map[string]map[string]bool{}} }

func (f *fakeRoster) CallerUserID(ctx context.Context) (string, bool) {
	u, _ := ctx.Value(userKey).(string)
	return u, u != ""
}
func (f *fakeRoster) CallerOrgID(ctx context.Context) (string, bool) {
	o, _ := ctx.Value(orgKey).(string)
	return o, o != ""
}
func (f *fakeRoster) GrownUserIDForZitadel(_ context.Context, _, zitadelID string) (string, error) {
	return "grown-" + zitadelID, nil
}
func (f *fakeRoster) AdminZitadelIDs(_ context.Context, orgID string, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	for _, z := range ids {
		if f.admins[orgID]["grown-"+z] {
			out[z] = true
		}
	}
	return out, nil
}
func (f *fakeRoster) Grant(_ context.Context, orgID, target, _ string) error {
	if f.admins[orgID] == nil {
		f.admins[orgID] = map[string]bool{}
	}
	f.admins[orgID][target] = true
	return nil
}
func (f *fakeRoster) Revoke(_ context.Context, orgID, target string) error {
	delete(f.admins[orgID], target)
	return nil
}
func (f *fakeRoster) CountAdmins(_ context.Context, orgID string) (int, error) {
	return len(f.admins[orgID]), nil
}

// orgAdminChecker builds an AdminChecker over the fake roster (mirrors server.go).
func orgAdminChecker(f *fakeRoster) adminusers.AdminChecker {
	return func(ctx context.Context) bool {
		o, _ := ctx.Value(orgKey).(string)
		u, _ := ctx.Value(userKey).(string)
		return f.admins[o][u]
	}
}

// TestAuthorizeRule exercises the core authorization rule on the (non-Zitadel)
// grant route, which only needs the roster — so no upstream is required.
func TestAuthorizeRule(t *testing.T) {
	cases := []struct {
		name        string
		allowlist   string
		email       string // "" = unauthenticated
		callerOrg   string
		callerUser  string
		callerAdmin bool // pre-seed caller as org admin
		wantStatus  int
	}{
		{name: "unauthenticated", allowlist: "", email: "", wantStatus: http.StatusUnauthorized},
		{name: "empty allowlist, not org-admin → forbidden (no open fallback)",
			allowlist: "", email: "nobody@test", callerOrg: "org1", callerUser: "u1", callerAdmin: false,
			wantStatus: http.StatusForbidden},
		{name: "email in allowlist → allowed",
			allowlist: "boss@test", email: "boss@test", callerOrg: "org1", callerUser: "u1",
			wantStatus: http.StatusOK},
		{name: "org-admin grant → allowed even with empty allowlist",
			allowlist: "", email: "member@test", callerOrg: "org1", callerUser: "u1", callerAdmin: true,
			wantStatus: http.StatusOK},
		{name: "authenticated non-admin with non-empty allowlist → forbidden",
			allowlist: "boss@test", email: "member@test", callerOrg: "org1", callerUser: "u1", callerAdmin: false,
			wantStatus: http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			roster := newFakeRoster()
			if tc.callerAdmin {
				_ = roster.Grant(context.Background(), tc.callerOrg, tc.callerUser, "")
			}
			h := adminusers.NewHandler(tc.allowlist, "", "").
				WithResolver(emailResolver).
				WithAdminChecker(orgAdminChecker(roster)).
				WithRoster(roster)

			// POST /api/v1/admin/users/{target}/admin grants a DIFFERENT user, so
			// the last-admin guard never trips here — we test authz only.
			req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/ztarget/admin", nil)
			req = withCaller(req, tc.email, tc.callerUser, tc.callerOrg)
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, req)

			if rr.Code != tc.wantStatus {
				t.Fatalf("status = %d; want %d (body=%s)", rr.Code, tc.wantStatus, rr.Body.String())
			}
		})
	}
}

// TestGrantRevokeLastAdmin verifies the grant route grants the role and the
// revoke route refuses to remove the org's last admin (409).
func TestGrantRevokeLastAdmin(t *testing.T) {
	roster := newFakeRoster()
	// Caller is a super-admin via allowlist so they always pass authz.
	h := adminusers.NewHandler("boss@test", "", "").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster)).
		WithRoster(roster)

	caller := func(r *http.Request) *http.Request { return withCaller(r, "boss@test", "boss", "org1") }

	// Grant target ztarget → becomes the org's first admin.
	{
		req := caller(httptest.NewRequest(http.MethodPost, "/api/v1/admin/users/ztarget/admin", nil))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("grant status = %d; want 200 (%s)", rr.Code, rr.Body.String())
		}
		var resp map[string]any
		_ = json.NewDecoder(rr.Body).Decode(&resp)
		if resp["isAdmin"] != true {
			t.Fatalf("grant resp isAdmin = %v; want true", resp["isAdmin"])
		}
	}
	if n, _ := roster.CountAdmins(context.Background(), "org1"); n != 1 {
		t.Fatalf("admins after grant = %d; want 1", n)
	}

	// Revoking the ONLY admin must 409 (last-admin protection).
	{
		req := caller(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/ztarget/admin", nil))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusConflict {
			t.Fatalf("revoke-last status = %d; want 409 (%s)", rr.Code, rr.Body.String())
		}
	}
	if n, _ := roster.CountAdmins(context.Background(), "org1"); n != 1 {
		t.Fatalf("admins still = %d; want 1 (revoke blocked)", n)
	}

	// Add a second admin, then revoking the first is allowed.
	_ = roster.Grant(context.Background(), "org1", "grown-zsecond", "")
	{
		req := caller(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/ztarget/admin", nil))
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("revoke status = %d; want 200 (%s)", rr.Code, rr.Body.String())
		}
	}
	if n, _ := roster.CountAdmins(context.Background(), "org1"); n != 1 {
		t.Fatalf("admins after revoke = %d; want 1 (only zsecond left)", n)
	}
}

// TestIsAdmin covers the predicate used by WhoAmI: allowlist OR org-admin, no
// open fallback.
func TestIsAdmin(t *testing.T) {
	roster := newFakeRoster()
	_ = roster.Grant(context.Background(), "org1", "u-admin", "")
	h := adminusers.NewHandler("boss@test", "", "").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster))

	cases := []struct {
		email, user, org string
		want             bool
	}{
		{"boss@test", "x", "orgX", true},         // allowlist
		{"member@test", "u-admin", "org1", true}, // org-admin grant
		{"member@test", "u-none", "org1", false}, // neither → no fallback
		{"", "", "", false},                      // unauthenticated
	}
	for _, tc := range cases {
		ctx := context.WithValue(context.Background(), emailKey, tc.email)
		ctx = context.WithValue(ctx, userKey, tc.user)
		ctx = context.WithValue(ctx, orgKey, tc.org)
		if got := h.IsAdmin(ctx); got != tc.want {
			t.Fatalf("IsAdmin(%q,%q,%q) = %v; want %v", tc.email, tc.user, tc.org, got, tc.want)
		}
	}
}

// TestWhoAmI confirms WhoAmI returns the same isAdmin verdict and never 403s.
func TestWhoAmI(t *testing.T) {
	roster := newFakeRoster()
	h := adminusers.NewHandler("", "", "").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/whoami", nil)
	req = withCaller(req, "member@test", "u1", "org1")
	rr := httptest.NewRecorder()
	h.WhoAmI(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("whoami status = %d; want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), `"isAdmin":false`) {
		t.Fatalf("whoami body = %s; want isAdmin:false", rr.Body.String())
	}
}

// ---- Org-scoping, remove-from-org, and hard-delete tests -------------------

// fakeMembership records remove-from-org calls and never touches Zitadel.
type fakeMembership struct {
	removed []string // "orgID/zitadelID" of each RemoveFromOrg call
	members map[string]bool
}

func (f *fakeMembership) RemoveFromOrg(_ context.Context, orgID, zitadelID string) (bool, error) {
	f.removed = append(f.removed, orgID+"/"+zitadelID)
	was := f.members[zitadelID]
	delete(f.members, zitadelID)
	return was, nil
}

// fakeZitadel is an httptest server standing in for the Zitadel User API v2. It
// returns a fixed user search result and records every DELETE it receives so a
// test can assert remove-from-org never deletes from the IdP.
type fakeZitadel struct {
	deletes  []string // paths of DELETE requests received
	allUsers []map[string]any
}

func (z *fakeZitadel) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			z.deletes = append(z.deletes, r.URL.Path)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		// POST /v2/users (search): echo allUsers as the result.
		if r.Method == http.MethodPost && r.URL.Path == "/v2/users" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"result": z.allUsers})
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func zUser(id, email string) map[string]any {
	return map[string]any{
		"userId":   id,
		"state":    "USER_STATE_ACTIVE",
		"username": email,
		"human": map[string]any{
			"profile": map[string]any{"displayName": email},
			"email":   map[string]any{"email": email, "isVerified": true},
		},
	}
}

// TestListIsOrgScoped verifies the Users list returns ONLY users in the caller's
// org-member set: a Zitadel user not among the org members is excluded even
// though Zitadel returns it.
func TestListIsOrgScoped(t *testing.T) {
	z := &fakeZitadel{allUsers: []map[string]any{
		zUser("z-member", "member@org"),
		zUser("z-outsider", "outsider@elsewhere"), // not an org member
	}}
	srv := z.server(t)

	roster := newFakeRoster()
	h := adminusers.NewHandler("boss@test", srv.URL, "service-token").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster)).
		WithRoster(roster).
		// Only z-member is an org member.
		WithOrgMembers(func(ctx context.Context, _ string) ([]string, bool) {
			if o, _ := ctx.Value(orgKey).(string); o == "org1" {
				return []string{"z-member"}, true
			}
			return nil, false
		})

	req := withCaller(httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil), "boss@test", "boss", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d; want 200 (%s)", rr.Code, rr.Body.String())
	}
	var resp struct {
		Users []struct {
			ID string `json:"id"`
		} `json:"users"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, rr.Body.String())
	}
	if len(resp.Users) != 1 || resp.Users[0].ID != "z-member" {
		t.Fatalf("users = %+v; want only z-member (outsider must be excluded)", resp.Users)
	}
}

// TestListWithoutResolverIsEmpty confirms the list fails closed: with no
// OrgMemberResolver it returns no users (never a global Zitadel search).
func TestListWithoutResolverIsEmpty(t *testing.T) {
	z := &fakeZitadel{allUsers: []map[string]any{zUser("z1", "a@b")}}
	srv := z.server(t)
	roster := newFakeRoster()
	h := adminusers.NewHandler("boss@test", srv.URL, "service-token").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster)).
		WithRoster(roster)

	req := withCaller(httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil), "boss@test", "boss", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), `"users":[]`) {
		t.Fatalf("body = %s; want empty users", rr.Body.String())
	}
}

// TestRemoveFromOrgDeletesGrownRowNotZitadel verifies DELETE /{id} removes the
// org membership (DB) and NEVER issues a Zitadel delete.
func TestRemoveFromOrgDeletesGrownRowNotZitadel(t *testing.T) {
	z := &fakeZitadel{}
	srv := z.server(t)
	roster := newFakeRoster()
	mem := &fakeMembership{members: map[string]bool{"z-member": true}}
	h := adminusers.NewHandler("boss@test", srv.URL, "service-token").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster)).
		WithRoster(roster).
		WithMembershipStore(mem)

	req := withCaller(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/z-member", nil), "boss@test", "boss", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("remove status = %d; want 200 (%s)", rr.Code, rr.Body.String())
	}
	if len(mem.removed) != 1 || mem.removed[0] != "org1/z-member" {
		t.Fatalf("membership removals = %v; want [org1/z-member]", mem.removed)
	}
	if len(z.deletes) != 0 {
		t.Fatalf("Zitadel DELETE calls = %v; want none (remove-from-org must not touch the IdP)", z.deletes)
	}
}

// TestRemoveFromOrgWorksWithoutServiceToken confirms remove-from-org is served
// even when the Zitadel service token is absent (it's a DB-only operation).
func TestRemoveFromOrgWorksWithoutServiceToken(t *testing.T) {
	roster := newFakeRoster()
	mem := &fakeMembership{members: map[string]bool{"z-member": true}}
	h := adminusers.NewHandler("boss@test", "", ""). // no service token
								WithResolver(emailResolver).
								WithAdminChecker(orgAdminChecker(roster)).
								WithRoster(roster).
								WithMembershipStore(mem)

	req := withCaller(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/z-member", nil), "boss@test", "boss", "org1")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("remove status = %d; want 200 even without service token (%s)", rr.Code, rr.Body.String())
	}
	if len(mem.removed) != 1 {
		t.Fatalf("removals = %v; want 1", mem.removed)
	}
}

// TestHardDeleteRequiresSuperAdmin verifies DELETE /{id}/zitadel is super-admin
// only: a plain org-admin (grant, not on the allowlist) gets 403 and NO Zitadel
// delete fires; a super-admin (allowlist) succeeds and the IdP delete fires.
func TestHardDeleteRequiresSuperAdmin(t *testing.T) {
	// Plain org-admin: in org_admins but NOT on the GROWN_ADMIN_EMAILS allowlist.
	t.Run("org-admin forbidden", func(t *testing.T) {
		z := &fakeZitadel{}
		srv := z.server(t)
		roster := newFakeRoster()
		_ = roster.Grant(context.Background(), "org1", "u-admin", "")
		h := adminusers.NewHandler("boss@test", srv.URL, "service-token").
			WithResolver(emailResolver).
			WithAdminChecker(orgAdminChecker(roster)).
			WithRoster(roster)

		// caller email "member@test" is NOT on the allowlist but IS an org admin
		// (user id u-admin in org1), so they pass the org-admin authz gate.
		req := withCaller(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/z-target/zitadel", nil), "member@test", "u-admin", "org1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("hard-delete status = %d; want 403 for org-admin (%s)", rr.Code, rr.Body.String())
		}
		if len(z.deletes) != 0 {
			t.Fatalf("Zitadel DELETE calls = %v; want none (org-admin blocked)", z.deletes)
		}
	})

	// Super-admin: email on the allowlist.
	t.Run("super-admin allowed", func(t *testing.T) {
		z := &fakeZitadel{}
		srv := z.server(t)
		roster := newFakeRoster()
		h := adminusers.NewHandler("boss@test", srv.URL, "service-token").
			WithResolver(emailResolver).
			WithAdminChecker(orgAdminChecker(roster)).
			WithRoster(roster)

		req := withCaller(httptest.NewRequest(http.MethodDelete, "/api/v1/admin/users/z-target/zitadel", nil), "boss@test", "boss", "org1")
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("hard-delete status = %d; want 200 for super-admin (%s)", rr.Code, rr.Body.String())
		}
		if len(z.deletes) != 1 || z.deletes[0] != "/v2/users/z-target" {
			t.Fatalf("Zitadel DELETE calls = %v; want [/v2/users/z-target]", z.deletes)
		}
	})
}

// TestWhoAmIExposesSuperAdminAndPersonal verifies the whoami payload carries the
// new isSuperAdmin + isPersonal flags used by the SPA gating.
func TestWhoAmIExposesSuperAdminAndPersonal(t *testing.T) {
	roster := newFakeRoster()
	h := adminusers.NewHandler("boss@test", "", "").
		WithResolver(emailResolver).
		WithAdminChecker(orgAdminChecker(roster)).
		WithPersonalOrgChecker(func(ctx context.Context) bool {
			o, _ := ctx.Value(orgKey).(string)
			return o == "personal-org"
		})

	// Super-admin in a personal org.
	req := withCaller(httptest.NewRequest(http.MethodGet, "/api/v1/admin/whoami", nil), "boss@test", "boss", "personal-org")
	rr := httptest.NewRecorder()
	h.WhoAmI(rr, req)
	body := rr.Body.String()
	if !strings.Contains(body, `"isSuperAdmin":true`) {
		t.Fatalf("whoami = %s; want isSuperAdmin:true", body)
	}
	if !strings.Contains(body, `"isPersonal":true`) {
		t.Fatalf("whoami = %s; want isPersonal:true", body)
	}

	// Plain member in a team org: not super-admin, not personal.
	req2 := withCaller(httptest.NewRequest(http.MethodGet, "/api/v1/admin/whoami", nil), "member@test", "u1", "org1")
	rr2 := httptest.NewRecorder()
	h.WhoAmI(rr2, req2)
	body2 := rr2.Body.String()
	if !strings.Contains(body2, `"isSuperAdmin":false`) || !strings.Contains(body2, `"isPersonal":false`) {
		t.Fatalf("whoami = %s; want isSuperAdmin:false + isPersonal:false", body2)
	}
}
