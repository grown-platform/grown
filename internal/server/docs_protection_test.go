package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/docs"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/sharing"
	"code.pick.haus/grown/grown/internal/users"
)

func TestDocsProtectionID(t *testing.T) {
	cases := map[string]string{
		"/api/v1/docs/d/abc/protection": "abc",
		"/api/v1/docs/d//protection":    "",
		"/api/v1/docs/d/a/b/protection": "",
		"/api/v1/docs/d/abc/connect":    "",
	}
	for path, want := range cases {
		got, ok := docsProtectionID(path)
		if (want != "") != ok || got != want {
			t.Errorf("%s: got %q %v, want %q", path, got, ok, want)
		}
	}
}

func TestDocsWriteGate(t *testing.T) {
	mode := "readOnly"
	gate := &docs.ProtectionGate{TTL: time.Nanosecond, Load: func() (string, error) { return mode, nil }}
	if docsWriteGate(false, true, gate)() {
		t.Error("a viewer never writes")
	}
	if !docsWriteGate(true, true, gate)() {
		t.Error("the owner writes a read-only document")
	}
	if docsWriteGate(true, false, gate)() {
		t.Error("an editor can't write a read-only document")
	}
	mode = "forms"
	time.Sleep(time.Millisecond)
	if !docsWriteGate(true, false, gate)() {
		t.Error("other modes are enforced by the editors, not the server")
	}
}

// fakeDocsStore is an in-memory docsProtectionStore: one document "doc1" in
// org "orgA", owned by "alice", with share-link token "tok-view".
type fakeDocsStore struct {
	mode string
}

func (f *fakeDocsStore) Get(_ context.Context, orgID, id string) (docs.Doc, error) {
	if orgID == "orgA" && id == "doc1" {
		return docs.Doc{ID: "doc1", OrgID: "orgA", OwnerID: "alice"}, nil
	}
	return docs.Doc{}, docs.ErrNotFound
}

func (f *fakeDocsStore) GetByID(_ context.Context, id string) (docs.Doc, error) {
	if id == "doc1" {
		return docs.Doc{ID: "doc1", OrgID: "orgA", OwnerID: "alice"}, nil
	}
	return docs.Doc{}, docs.ErrNotFound
}

func (f *fakeDocsStore) GetShareByToken(_ context.Context, token string) (docs.ShareGrant, error) {
	if token == "tok-view" {
		return docs.ShareGrant{Share: docs.Share{Token: token, DocID: "doc1", Role: "viewer"}}, nil
	}
	return docs.ShareGrant{}, docs.ErrNotFound
}

func (f *fakeDocsStore) GetProtection(_ context.Context, id string) (string, error) {
	if id != "doc1" {
		return "", docs.ErrNotFound
	}
	return f.mode, nil
}

func (f *fakeDocsStore) SetProtection(_ context.Context, id, mode string) error {
	if id != "doc1" {
		return docs.ErrNotFound
	}
	f.mode = mode
	return nil
}

// fakeGrants grants "carol" (another org) a viewer role on doc1.
type fakeGrants struct{}

func (fakeGrants) RoleFor(_ context.Context, userID, objectType, objectID string) (string, bool, error) {
	if userID == "carol" && objectType == sharing.TypeDocsDoc && objectID == "doc1" {
		return sharing.RoleViewer, true, nil
	}
	return "", false, nil
}

func protectionReq(method, userID, orgID, query, body string) *http.Request {
	r := httptest.NewRequest(method, "/api/v1/docs/d/doc1/protection"+query, strings.NewReader(body))
	ctx := r.Context()
	if userID != "" {
		ctx = auth.WithUser(ctx, users.User{ID: userID, OrgID: orgID})
		ctx = auth.WithOrg(ctx, orgs.Org{ID: orgID})
	}
	return r.WithContext(ctx)
}

// TestDocsProtectionRequiresReadAccess: GET needs read access to the document
// (org member, grantee or share link, as the collab route), not merely a
// session in some org; PUT stays owner-only.
func TestDocsProtectionRequiresReadAccess(t *testing.T) {
	store := &fakeDocsStore{mode: "readOnly"}
	cases := []struct {
		name, method, user, org, query, body string
		want                                 int
	}{
		{"owner reads", http.MethodGet, "alice", "orgA", "", "", http.StatusOK},
		{"org member reads", http.MethodGet, "bob", "orgA", "", "", http.StatusOK},
		{"grantee in another org reads", http.MethodGet, "carol", "orgC", "", "", http.StatusOK},
		{"share-link viewer reads", http.MethodGet, "", "", "?token=tok-view", "", http.StatusOK},
		{"member of another org is refused", http.MethodGet, "mallory", "orgM", "", "", http.StatusNotFound},
		{"wrong share token is refused", http.MethodGet, "mallory", "orgM", "?token=nope", "", http.StatusNotFound},
		{"anonymous is refused", http.MethodGet, "", "", "", "", http.StatusNotFound},
		{"org member cannot set", http.MethodPut, "bob", "orgA", "", `{"mode":"none"}`, http.StatusForbidden},
		{"grantee cannot set", http.MethodPut, "carol", "orgC", "", `{"mode":"none"}`, http.StatusForbidden},
		{"outsider cannot set", http.MethodPut, "mallory", "orgM", "", `{"mode":"none"}`, http.StatusNotFound},
		{"owner sets", http.MethodPut, "alice", "orgA", "", `{"mode":"forms"}`, http.StatusNoContent},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			serveDocsProtection(w, protectionReq(c.method, c.user, c.org, c.query, c.body), "doc1", store, fakeGrants{})
			if w.Code != c.want {
				t.Fatalf("status %d, want %d (%s)", w.Code, c.want, w.Body.String())
			}
			if c.method == http.MethodGet && c.want == http.StatusOK && !strings.Contains(w.Body.String(), `"mode":"readOnly"`) {
				t.Fatalf("body %s", w.Body.String())
			}
		})
	}
	if store.mode != "forms" {
		t.Fatalf("mode %q after the owner's PUT, want forms", store.mode)
	}
	// Without a grant repository the grant path is off.
	w := httptest.NewRecorder()
	serveDocsProtection(w, protectionReq(http.MethodGet, "carol", "orgC", "", ""), "doc1", store, nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("grantee without grant repo: status %d, want 404", w.Code)
	}
}
