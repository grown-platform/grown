package server

import (
	"bytes"
	"net/http"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// TestAuthzDocsAssets: document pictures follow the document's access
// (org member, grantee or share link); only writers upload.
func TestAuthzDocsAssets(t *testing.T) {
	e := authzSetup(t)
	e.mount(newDocsAssets(newMemAssetBlobs(), e.cfg.DocsRepo, e.cfg.SharingRepo))
	alice := e.users["alice"]
	view, err := e.cfg.DocsRepo.CreateShare(e.ctx, e.docID, alice.ID, "viewer", "")
	if err != nil {
		t.Fatal(err)
	}
	edit, err := e.cfg.DocsRepo.CreateShare(e.ctx, e.docID, alice.ID, "editor", "")
	if err != nil {
		t.Fatal(err)
	}
	up := "/api/v1/docs/d/" + e.docID + "/assets"

	// Unknown documents and denied callers look alike (404); an anonymous
	// caller without a share link has no access at all.
	for _, c := range []struct{ user, query string }{
		{anon, ""}, {"mallory", ""}, {"viv", ""}, {"cara", ""},
		{anon, "?token=" + view.Token}, {"mallory", "?token=" + view.Token}, {anon, "?token=bogus"},
	} {
		if code, body := e.do(c.user, http.MethodPost, up+c.query, "image/png", authzPNG); code != http.StatusNotFound {
			t.Errorf("upload as %q%s: %d %s", c.user, c.query, code, body)
		}
	}
	code, body := e.do("ed", http.MethodPost, up, "image/png", authzPNG)
	if code != http.StatusCreated {
		t.Fatalf("editor grantee upload: %d %s", code, body)
	}
	img := uploadURL(t, body)
	for _, c := range []struct{ user, query string }{{"bob", ""}, {anon, "?token=" + edit.Token}} {
		if code, _ := e.do(c.user, http.MethodPost, up+c.query, "image/png", authzPNG); code != http.StatusCreated {
			t.Errorf("upload as %q%s: %d", c.user, c.query, code)
		}
	}
	for _, c := range []struct{ user, query string }{
		{"alice", ""}, {"bob", ""}, {"viv", ""}, {"cara", ""}, {"ed", ""}, {anon, "?token=" + view.Token},
	} {
		resp, err := http.DefaultClient.Do(e.req(c.user, http.MethodGet, img+c.query, nil))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		h := resp.Header
		if resp.StatusCode != 200 || h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
			!strings.Contains(h.Get("Content-Security-Policy"), "sandbox") {
			t.Errorf("GET as %q%s: %d %v", c.user, c.query, resp.StatusCode, h)
		}
	}
	for _, c := range []struct{ user, query string }{{anon, ""}, {"mallory", ""}, {anon, "?token=bogus"}} {
		e.expect(http.StatusNotFound, c.user, http.MethodGet, img+c.query, "")
	}
	// A share token of another document doesn't open this one.
	other, _ := e.cfg.DocsRepo.Create(e.ctx, e.users["mallory"].OrgID, e.users["mallory"].ID, "M")
	otherShare, _ := e.cfg.DocsRepo.CreateShare(e.ctx, other.ID, e.users["mallory"].ID, "editor", "")
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, img+"?token="+otherShare.Token, "")
	if code, _ := e.do("mallory", http.MethodPost, up+"?token="+otherShare.Token, "image/png", authzPNG); code != http.StatusNotFound {
		t.Errorf("cross-document token upload: %d", code)
	}

	// Pictures only (no clips, no SVG), sniffed, capped at 20 MiB.
	for name, data := range map[string][]byte{
		"svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`),
		"html": []byte(`<html><script>alert(1)</script></html>`),
		"mp4":  authzMP4,
	} {
		if code, _ := e.do("ed", http.MethodPost, up, "image/png", data); code != http.StatusUnsupportedMediaType {
			t.Errorf("%s upload: %d", name, code)
		}
	}
	big := append(append([]byte{}, authzPNG...), bytes.Repeat([]byte{0}, 20<<20)...)
	if code, _ := e.do("ed", http.MethodPost, up, "image/png", big); code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized picture: %d", code)
	}
	if code, _ := e.do("ed", http.MethodPost, up, "image/png", nil); code != http.StatusBadRequest {
		t.Errorf("empty upload: %d", code)
	}
	sha := img[strings.LastIndex(img, "/")+1:]
	for _, p := range []string{
		"/api/v1/docs/d/../assets/" + sha,
		"/api/v1/docs/d/" + e.docID + "/assets/../../" + sha,
		"/api/v1/docs/d/" + e.docID + "%2F..%2F" + other.ID + "/assets/" + sha,
		"/api/v1/docs/d/" + other.ID + "/assets/" + sha,
		"/api/v1/docs/d/%00/assets/" + sha,
	} {
		if code, _ := e.do("mallory", http.MethodGet, p, "", nil); code < 400 || code >= 500 {
			t.Errorf("GET %s: %d", p, code)
		}
	}
}

// TestAuthzDocsProtection drives GET/PUT …/protection through the real
// routing: read needs document access, write is owner-only.
func TestAuthzDocsProtection(t *testing.T) {
	e := authzSetup(t)
	alice := e.users["alice"]
	view, _ := e.cfg.DocsRepo.CreateShare(e.ctx, e.docID, alice.ID, "viewer", "")
	edit, _ := e.cfg.DocsRepo.CreateShare(e.ctx, e.docID, alice.ID, "editor", "")
	p := "/api/v1/docs/d/" + e.docID + "/protection"

	for _, u := range []string{"alice", "bob", "viv", "cara", "ed"} {
		e.expect(http.StatusOK, u, http.MethodGet, p, "")
	}
	e.expect(http.StatusOK, anon, http.MethodGet, p+"?token="+view.Token, "")
	e.expect(http.StatusNotFound, anon, http.MethodGet, p, "")
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, p, "")
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, p+"?token=nope", "")

	for _, c := range []struct{ user, query string }{
		{"bob", ""}, {"ed", ""}, {"viv", ""}, {"cara", ""}, {anon, "?token=" + edit.Token}, {anon, "?token=" + view.Token},
	} {
		e.expect(http.StatusForbidden, c.user, http.MethodPut, p+c.query, `{"mode":"none"}`)
	}
	e.expect(http.StatusNotFound, "mallory", http.MethodPut, p, `{"mode":"none"}`)
	e.expect(http.StatusNotFound, anon, http.MethodPut, p, `{"mode":"none"}`)
	for _, b := range []string{`{`, `{"mode":"root"}`, `{"mode":"` + strings.Repeat("r", 8000) + `"}`, ``} {
		e.expect(http.StatusBadRequest, "alice", http.MethodPut, p, b)
	}
	e.expect(http.StatusNoContent, "alice", http.MethodPut, p, `{"mode":"readOnly"}`)
	if got := e.expect(http.StatusOK, "viv", http.MethodGet, p, ""); !strings.Contains(got, "readOnly") {
		t.Errorf("mode after PUT: %s", got)
	}
	e.expect(http.StatusMethodNotAllowed, "alice", http.MethodDelete, p, "")
	for _, bad := range injectedIDs {
		if code, _ := e.do("alice", http.MethodGet, "/api/v1/docs/d/"+bad+"/protection", "", nil); code < 400 || code >= 500 {
			t.Errorf("protection id %q: %d", bad, code)
		}
	}
}

// TestAuthzDocsCollabReadOnly: with read-only protection the collab hub
// drops every non-owner's updates (editors included) and relays the owner's.
// Share-link viewers are read-only regardless.
func TestAuthzDocsCollabReadOnly(t *testing.T) {
	e := authzSetup(t)
	alice := e.users["alice"]
	view, _ := e.cfg.DocsRepo.CreateShare(e.ctx, e.docID, alice.ID, "viewer", "")
	path := "/api/v1/docs/d/" + e.docID + "/connect"
	for _, q := range []string{"", "?token=bogus"} {
		if _, err := e.dial(anon, path+q); err == nil {
			t.Errorf("anonymous dial %q succeeded", q)
		}
		if _, err := e.dial("mallory", path+q); err == nil {
			t.Errorf("stranger dial %q succeeded", q)
		}
	}
	upd := func(tag string) string { return string(syncUpdate([]byte(tag))) }

	// Without protection a share-link viewer is still read-only.
	watcher := e.mustDial("alice", path)
	linkViewer := e.mustDial(anon, path+"?token="+view.Token)
	editor := e.mustDial("bob", path)
	time.Sleep(150 * time.Millisecond)
	wsSend(t, linkViewer, websocket.MessageBinary, upd("link-viewer-update"))
	wsSend(t, editor, websocket.MessageBinary, upd("editor-update"))
	expectNextWithout(t, watcher, "editor-update", "link-viewer-update")
	watcher.CloseNow()
	linkViewer.CloseNow()
	editor.CloseNow()

	e.expect(http.StatusNoContent, "alice", http.MethodPut, "/api/v1/docs/d/"+e.docID+"/protection", `{"mode":"readOnly"}`)
	watcher = e.mustDial("alice", path)
	// Consume the replay of the update stored above.
	if _, ok := wsReadUntil(watcher, "editor-update", 3*time.Second); !ok {
		t.Fatal("stored update not replayed")
	}
	owner := e.mustDial("alice", path)
	bob, ed, viv := e.mustDial("bob", path), e.mustDial("ed", path), e.mustDial("viv", path)
	time.Sleep(150 * time.Millisecond)
	wsSend(t, bob, websocket.MessageBinary, upd("bob-readonly"))
	wsSend(t, ed, websocket.MessageBinary, upd("ed-readonly"))
	wsSend(t, viv, websocket.MessageBinary, upd("viv-readonly"))
	wsSend(t, owner, websocket.MessageBinary, upd("owner-update"))
	expectNextWithout(t, watcher, "owner-update", "bob-readonly", "ed-readonly", "viv-readonly")

	// Nothing the refused writers sent was persisted.
	var n int
	time.Sleep(200 * time.Millisecond)
	if err := e.pool.QueryRow(e.ctx, `SELECT count(*) FROM grown.docs_updates WHERE doc_id=$1 AND position('readonly'::bytea in update_blob) > 0`, e.docID).Scan(&n); err != nil {
		t.Fatal(err)
	} else if n != 0 {
		t.Errorf("%d refused updates persisted", n)
	}
	if err := e.pool.QueryRow(e.ctx, `SELECT count(*) FROM grown.docs_updates WHERE doc_id=$1 AND position('owner-update'::bytea in update_blob) > 0`, e.docID).Scan(&n); err != nil || n != 1 {
		t.Errorf("owner update persisted %d times (%v)", n, err)
	}
}

// TestAuthzDocsImportRouted: the import route needs a session.
func TestAuthzDocsImportRouted(t *testing.T) {
	e := authzSetup(t)
	e.expect(http.StatusUnauthorized, anon, http.MethodPost, "/api/v1/docs/import?from=md", "# hi")
	e.expect(http.StatusUnauthorized, anon, http.MethodPost, "/api/v1/docs/convert?to=md", "<p>x</p>")
	e.expect(http.StatusBadRequest, "mallory", http.MethodPost, "/api/v1/docs/import?from=../../etc/passwd", "# hi")
	if _, err := exec.LookPath("pandoc"); err != nil {
		t.Skip("pandoc not installed")
	}
	if got := e.expect(http.StatusOK, "mallory", http.MethodPost, "/api/v1/docs/import?from=md", "# hi"); !strings.Contains(got, "hi") {
		t.Errorf("import: %s", got)
	}
	e.expect(http.StatusUnprocessableEntity, "mallory", http.MethodPost, "/api/v1/docs/import?from=odt", "not a zip")
}
