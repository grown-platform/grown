package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/slides"
)

// memAssetBlobs is an in-memory docs/slides AssetBlobStore.
type memAssetBlobs struct {
	mu   sync.Mutex
	data map[string][]byte
	mime map[string]string
}

func newMemAssetBlobs() *memAssetBlobs {
	return &memAssetBlobs{data: map[string][]byte{}, mime: map[string]string{}}
}

func (b *memAssetBlobs) Put(_ context.Context, key, mime string, _ int64, body io.Reader) error {
	d, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.data[key], b.mime[key] = d, mime
	return nil
}

func (b *memAssetBlobs) Get(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	d, ok := b.data[key]
	if !ok {
		return nil, "", 0, errors.New("not found")
	}
	return io.NopCloser(bytes.NewReader(d)), b.mime[key], int64(len(d)), nil
}

// mount serves h behind the production auth middleware on a fresh test
// server (for handlers the server only wires with an S3 blob store).
func (e *authzEnv) mount(h http.Handler) {
	c := e.cfg
	ts := httptest.NewServer(auth.HTTPMiddleware(c.AuthConfig, c.Sessions, c.UsersRepo, c.OrgsRepo, c.DefaultOrg, nil)(h))
	e.t.Cleanup(ts.Close)
	e.ts = ts
}

// A 1×1 PNG.
var authzPNG = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\xdac\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82")

// A minimal ISO-BMFF (MP4) header plus padding.
var authzMP4 = append([]byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"), bytes.Repeat([]byte{0}, 4096)...)

func uploadURL(t *testing.T, body string) string {
	t.Helper()
	var out struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil || out.URL == "" {
		t.Fatalf("upload response %q: %v", body, err)
	}
	return out.URL
}

// TestAuthzSlidesAssets: deck pictures/clips follow the deck's access —
// writers upload, readers fetch, everyone else gets the same 404 — with a
// sniffed-type allowlist, size caps and a sandboxing CSP on every response.
func TestAuthzSlidesAssets(t *testing.T) {
	e := authzSetup(t)
	e.mount(newSlidesAssets(newMemAssetBlobs(), e.cfg.SlidesRepo, e.cfg.SharingRepo))
	up := "/api/v1/slides/d/" + e.deckID + "/assets"

	// Only writers upload. Refusals are 404 (as for a missing deck); an
	// anonymous caller has no deck access at all.
	for _, u := range []string{anon, "mallory", "viv", "cara"} {
		if code, body := e.do(u, http.MethodPost, up, "image/png", authzPNG); code != http.StatusNotFound {
			t.Errorf("upload as %q: %d %s", u, code, body)
		}
	}
	code, body := e.do("ed", http.MethodPost, up, "image/png", authzPNG)
	if code != http.StatusCreated {
		t.Fatalf("editor grantee upload: %d %s", code, body)
	}
	img := uploadURL(t, body)
	if code, _ := e.do("bob", http.MethodPost, up, "image/png", authzPNG); code != http.StatusCreated {
		t.Errorf("org member upload: %d", code)
	}

	// Readers fetch; strangers can't.
	for _, u := range []string{"alice", "bob", "viv", "cara", "ed"} {
		resp, err := http.DefaultClient.Do(e.req(u, http.MethodGet, img, nil))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		h := resp.Header
		if resp.StatusCode != 200 || h.Get("Content-Type") != "image/png" || h.Get("X-Content-Type-Options") != "nosniff" ||
			!strings.Contains(h.Get("Content-Security-Policy"), "sandbox") || !strings.Contains(h.Get("Content-Security-Policy"), "default-src 'none'") {
			t.Errorf("GET as %s: %d %v", u, resp.StatusCode, h)
		}
	}
	for _, u := range []string{anon, "mallory"} {
		if code, body := e.do(u, http.MethodGet, img, "", nil); code != http.StatusNotFound || bytes.Contains([]byte(body), []byte("PNG")) {
			t.Errorf("GET as %q: %d", u, code)
		}
	}
	// The same hash under a deck mallory owns is a different object.
	mdeck, err := e.cfg.SlidesRepo.Create(e.ctx, e.users["mallory"].OrgID, e.users["mallory"].ID, "M")
	if err != nil {
		t.Fatal(err)
	}
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, strings.Replace(img, e.deckID, mdeck.ID, 1), "")

	// Sniffed type allowlist: the declared Content-Type is ignored.
	for name, data := range map[string][]byte{
		"svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"html": []byte(`<!DOCTYPE html><html><script>alert(1)</script></html>`),
		"exe":  append([]byte("MZ\x90\x00"), bytes.Repeat([]byte{1}, 64)...),
		"pdf":  []byte("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"),
	} {
		if code, body := e.do("ed", http.MethodPost, up, "image/png", data); code != http.StatusUnsupportedMediaType {
			t.Errorf("%s upload: %d %s", name, code, body)
		}
	}
	if code, _ := e.do("ed", http.MethodPost, up, "image/png", []byte{}); code != http.StatusBadRequest {
		t.Errorf("empty upload: %d", code)
	}
	if code, _ := e.do("ed", http.MethodPost, up, "multipart/form-data; boundary=x", []byte("--x\r\nContent-Disposition: form-data; name=\"nope\"\r\n\r\nz\r\n--x--\r\n")); code != http.StatusBadRequest {
		t.Errorf("multipart without file: %d", code)
	}
	// Pictures are capped at 20 MiB (clips get more).
	big := append(append([]byte{}, authzPNG...), bytes.Repeat([]byte{0}, slides.MaxAssetBytes)...)
	if code, _ := e.do("ed", http.MethodPost, up, "image/png", big); code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized picture: %d", code)
	}

	// Clips are served with byte ranges.
	code, body = e.do("ed", http.MethodPost, up, "video/mp4", authzMP4)
	if code != http.StatusCreated {
		t.Fatalf("mp4 upload: %d %s", code, body)
	}
	clip := uploadURL(t, body)
	r := e.req("viv", http.MethodGet, clip, nil)
	r.Header.Set("Range", "bytes=4-11")
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	part, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || string(part) != "ftypisom" || resp.Header.Get("Content-Type") != "video/mp4" ||
		!strings.Contains(resp.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Errorf("range GET: %d %q %v", resp.StatusCode, part, resp.Header)
	}
	r = e.req("mallory", http.MethodGet, clip, nil)
	r.Header.Set("Range", "bytes=0-10")
	if resp, err := http.DefaultClient.Do(r); err != nil || resp.StatusCode != http.StatusNotFound {
		t.Errorf("stranger range GET: %v %v", err, resp.StatusCode)
	}

	// Path games: never a 2xx for someone else's object, never a 5xx.
	sha := img[strings.LastIndex(img, "/")+1:]
	for _, p := range []string{
		"/api/v1/slides/d/../assets/" + sha,
		"/api/v1/slides/d/" + e.deckID + "/assets/../../" + sha,
		"/api/v1/slides/d/" + e.deckID + "/assets/" + strings.ToUpper(sha),
		"/api/v1/slides/d/" + e.deckID + "/assets/" + sha + "/x",
		"/api/v1/slides/d/" + e.deckID + "%2F..%2F" + mdeck.ID + "/assets/" + sha,
		"/api/v1/slides/d/not-a-uuid/assets/" + sha,
		"/api/v1/slides/d/%00/assets/" + sha,
	} {
		if code, _ := e.do("mallory", http.MethodGet, p, "", nil); code < 400 || code >= 500 {
			t.Errorf("GET %s: %d", p, code)
		}
		if code, _ := e.do("ed", http.MethodPost, strings.TrimSuffix(p, "/"+sha), "image/png", authzPNG); code >= 500 {
			t.Errorf("POST %s: %d", p, code)
		}
	}
	e.expect(http.StatusMethodNotAllowed, "alice", http.MethodDelete, img, "")
}

// TestAuthzSlidesMentions: only deck writers may send @mention
// notifications, and only users who can open the deck receive one.
func TestAuthzSlidesMentions(t *testing.T) {
	e := authzSetup(t)
	path := "/api/v1/slides/d/" + e.deckID + "/mentions"
	ids := func(names ...string) string {
		out := []string{}
		for _, n := range names {
			out = append(out, `"`+e.users[n].ID+`"`)
		}
		return "[" + strings.Join(out, ",") + "]"
	}
	body := `{"user_ids":` + ids("alice", "viv", "mallory") + `,"comment_id":"c1","text":"look @here"}`
	count := func(user string) int {
		var n int
		if err := e.pool.QueryRow(e.ctx, `SELECT count(*) FROM grown.notifications WHERE user_id=$1`, e.users[user].ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	e.expect(http.StatusUnauthorized, anon, http.MethodPost, path, body)
	e.expect(http.StatusNotFound, "mallory", http.MethodPost, path, body)
	e.expect(http.StatusForbidden, "viv", http.MethodPost, path, body)
	e.expect(http.StatusForbidden, "cara", http.MethodPost, path, body)
	if n := count("alice") + count("viv") + count("mallory"); n != 0 {
		t.Fatalf("refused calls notified %d users", n)
	}
	if got := e.expect(http.StatusOK, "ed", http.MethodPost, path, body); !strings.Contains(got, `"notified":2`) {
		t.Errorf("editor mention: %s", got)
	}
	if count("alice") != 1 || count("viv") != 1 || count("mallory") != 0 {
		t.Errorf("notifications: alice %d viv %d mallory %d", count("alice"), count("viv"), count("mallory"))
	}
	// The mentioned outsider learns nothing about the deck.
	var title string
	_ = e.pool.QueryRow(e.ctx, `SELECT title FROM grown.notifications WHERE user_id=$1`, e.users["viv"].ID).Scan(&title)
	if !strings.Contains(title, "Deck") {
		t.Errorf("notification title %q", title)
	}
	// A comment id can't redirect the notification link.
	e.expect(http.StatusOK, "bob", http.MethodPost, path, `{"user_ids":`+ids("alice")+`,"comment_id":"x?next=//evil.example","text":"t"}`)
	var target string
	_ = e.pool.QueryRow(e.ctx, `SELECT target_url FROM grown.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, e.users["alice"].ID).Scan(&target)
	if target != "/slides/d/"+e.deckID {
		t.Errorf("target url %q", target)
	}
	// Malformed and oversized bodies.
	for _, b := range []string{``, `{`, `{"user_ids":"x"}`, `{"user_ids":[` + strings.Repeat(`"x",`, 20000) + `"x"]}`} {
		if code, got := e.do("ed", http.MethodPost, path, "application/json", []byte(b)); code != http.StatusBadRequest {
			t.Errorf("body %.20q: %d %.80s", b, code, got)
		}
	}
	// A flood of ids notifies at most MaxMentions users.
	many := make([]string, 0, 100)
	for i := 0; i < 100; i++ {
		many = append(many, `"`+strconv.Itoa(i)+`"`)
	}
	e.expect(http.StatusOK, "ed", http.MethodPost, path, `{"user_ids":[`+strings.Join(many, ",")+`]}`)
	e.expect(http.StatusMethodNotAllowed, "ed", http.MethodGet, path, "")
	for _, bad := range injectedIDs {
		if code, _ := e.do("ed", http.MethodPost, "/api/v1/slides/d/"+bad+"/mentions", "application/json", []byte(body)); code < 400 || code >= 500 {
			t.Errorf("mentions id %q: %d", bad, code)
		}
	}
}

// TestAuthzSlidesCollab: the deck hub refuses strangers, drops viewer ops
// and spoofed restore notices, and rejects a stale op (seq/base) instead of
// letting it clobber a newer edit.
func TestAuthzSlidesCollab(t *testing.T) {
	e := authzSetup(t)
	path := "/api/v1/slides/d/" + e.deckID + "/connect"
	for _, u := range []string{anon, "mallory"} {
		if _, err := e.dial(u, path); err == nil {
			t.Errorf("dial as %q succeeded", u)
		}
	}
	for _, bad := range injectedIDs {
		if _, err := e.dial("alice", "/api/v1/slides/d/"+bad+"/connect"); err == nil {
			t.Errorf("dial with id %q succeeded", bad)
		}
	}
	join := func(user, cid string) *websocket.Conn {
		c := e.mustDial(user, path)
		wsSend(t, c, websocket.MessageText, `{"t":"hello","cid":"`+cid+`"}`)
		if _, ok := wsReadUntil(c, `"synced"`, 3*time.Second); !ok {
			t.Fatalf("%s: no synced", user)
		}
		return c
	}
	alice, ed, viv := join("alice", "A"), join("ed", "E"), join("viv", "V")

	// Each sender's messages arrive in order: the viewer's presence sentinel
	// comes after everything it sent that must be dropped.
	wsSend(t, viv, websocket.MessageText, `{"t":"upsert","id":"v1","si":"s1","el":{"id":"x","text":"viewer-op"}}`)
	wsSend(t, viv, websocket.MessageText, `{"t":"presence","type":"versionRestored"}`)
	wsSend(t, viv, websocket.MessageText, `{"t":"versionRestored"}`)
	wsSend(t, viv, websocket.MessageText, `{"t":"presence","p":{"userId":"viv-sentinel"}}`)
	expectNextWithout(t, ed, "viv-sentinel", "viewer-op", "versionRestored")
	wsSend(t, alice, websocket.MessageText, `{"t":"upsert","id":"a1","base":0,"si":"s1","el":{"id":"x","text":"alice-op"}}`)
	expectNextWithout(t, ed, "alice-op", "viewer-op", "versionRestored")

	// ed has only seen base 0: an edit of the same element is stale.
	wsSend(t, ed, websocket.MessageText, `{"t":"upsert","id":"e1","base":0,"si":"s1","el":{"id":"x","text":"stale-op"}}`)
	if m, ok := wsReadUntil(ed, `"e1"`, 3*time.Second); !ok || !strings.Contains(m, `"reject"`) {
		t.Fatalf("stale op not rejected: %q", m)
	}
	// Re-based on the latest seq it is accepted and relayed.
	wsSend(t, ed, websocket.MessageText, `{"t":"upsert","id":"e2","base":1,"si":"s1","el":{"id":"x","text":"rebased-op"}}`)
	expectNextWithout(t, alice, "rebased-op", "stale-op", "viewer-op", "versionRestored")
}

// TestAuthzWhiteboardsCollab: a viewer or commenter grant is read-only on
// the board socket; an editor grant writes.
func TestAuthzWhiteboardsCollab(t *testing.T) {
	e := authzSetup(t)
	path := "/api/v1/whiteboards/d/" + e.boardID + "/connect"
	for _, u := range []string{anon, "mallory"} {
		if _, err := e.dial(u, path); err == nil {
			t.Errorf("dial as %q succeeded", u)
		}
	}
	alice, ed, viv, cara := e.mustDial("alice", path), e.mustDial("ed", path), e.mustDial("viv", path), e.mustDial("cara", path)
	time.Sleep(150 * time.Millisecond)
	// Each sender ends with a presence sentinel (relayed in order after what
	// it sent before).
	wsSend(t, viv, websocket.MessageText, `{"type":"scene","elements":[{"id":"viewer-scene"}]}`)
	wsSend(t, viv, websocket.MessageText, `{"type":"versionRestored","presence":{}}`)
	wsSend(t, viv, websocket.MessageText, `{"type":"presence","presence":{"userId":"viv-presence"}}`)
	expectNextWithout(t, alice, "viv-presence", "viewer-scene", "versionRestored")
	wsSend(t, cara, websocket.MessageText, `{"type":"scene","elements":[{"id":"commenter-scene"}]}`)
	wsSend(t, cara, websocket.MessageText, `{"type":"presence","presence":{"userId":"cara-presence"}}`)
	expectNextWithout(t, alice, "cara-presence", "commenter-scene")
	wsSend(t, ed, websocket.MessageText, `{"type":"scene","elements":[{"id":"editor-scene"}]}`)
	expectNextWithout(t, alice, "editor-scene", "viewer-scene", "commenter-scene")
}
