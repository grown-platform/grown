package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// authzWorkbook is alice's sheet: A1=3, B1==A1*2, secret text in C1, and A1
// in a range protected by alice (no other editors listed).
func authzWorkbook(owner string) string {
	return `[{"id":"s1","name":"Sheet1","celldata":[` +
		`{"r":0,"c":0,"v":{"v":3,"m":"3"}},` +
		`{"r":0,"c":1,"v":{"f":"=A1*2","v":6,"m":"6"}},` +
		`{"r":0,"c":2,"v":{"v":"sheet-secret-7731","m":"sheet-secret-7731"}}],` +
		`"grownProtection":{"sheet":null,"ranges":[{"id":"p1","name":"Locked","ranges":[{"r1":0,"c1":0,"r2":0,"c2":0}],"users":[],"by":"` + owner + `"}]}}]`
}

const sheetSecret = "sheet-secret-7731"

func seedSheet(t *testing.T, e *authzEnv) {
	t.Helper()
	alice := e.users["alice"]
	if err := e.cfg.SheetsRepo.Save(e.ctx, alice.OrgID, e.sheetID, authzWorkbook(alice.ID)); err != nil {
		t.Fatal(err)
	}
}

// TestAuthzSheetsReadEndpoints: recalc, deps (GET+POST) and goalseek need
// read access (org member or any grantee); strangers and anonymous callers
// learn nothing; nothing is ever stored.
func TestAuthzSheetsReadEndpoints(t *testing.T) {
	e := authzSetup(t)
	seedSheet(t, e)
	base := "/api/v1/sheets/d/" + e.sheetID
	recalc := `{"data":` + jsonString(authzWorkbook("x")) + `}`
	deps := `{"cell":"B1"}`
	goal := `{"formulaCell":"B1","target":10,"changingCell":"A1"}`
	type ep struct{ method, path, body string }
	eps := []ep{
		{http.MethodPost, base + "/recalc", recalc},
		{http.MethodGet, base + "/deps?cell=B1", ""},
		{http.MethodPost, base + "/deps", deps},
		{http.MethodPost, base + "/goalseek", goal},
	}
	for _, x := range eps {
		t.Run(x.method+" "+strings.TrimPrefix(x.path, base), func(t *testing.T) {
			e.t = t
			e.noLeak(e.expect(http.StatusUnauthorized, anon, x.method, x.path, x.body), sheetSecret)
			e.noLeak(e.expect(http.StatusNotFound, "mallory", x.method, x.path, x.body), sheetSecret)
			for _, u := range []string{"alice", "bob", "viv", "cara", "ed"} {
				e.expect(http.StatusOK, u, x.method, x.path, x.body)
			}
			// Id injection never reaches a 5xx or another document.
			for _, bad := range injectedIDs {
				p := strings.Replace(x.path, e.sheetID, bad, 1)
				code, body := e.do("alice", x.method, p, "application/json", []byte(x.body))
				if code < 400 || code >= 500 {
					t.Errorf("%s %s: status %d (%.120s)", x.method, p, code, body)
				}
				e.noLeak(body, sheetSecret)
			}
		})
	}
	e.t = t
	// Malformed bodies are 400, never 500.
	for _, x := range []ep{
		{http.MethodPost, base + "/recalc", `{"data":`},
		{http.MethodPost, base + "/recalc", `{"data":"{\"not\":\"a workbook\"}"}`},
		{http.MethodPost, base + "/deps", `[1,2`},
		{http.MethodPost, base + "/deps", `{}`},
		{http.MethodGet, base + "/deps", ""},
		{http.MethodPost, base + "/goalseek", `nope`},
		{http.MethodPost, base + "/goalseek", `{"formulaCell":"ZZZZZZ999999999","changingCell":"A1"}`},
	} {
		e.expect(http.StatusBadRequest, "viv", x.method, x.path, x.body)
	}
	// Wrong methods.
	e.expect(http.StatusMethodNotAllowed, "alice", http.MethodGet, base+"/recalc", "")
	e.expect(http.StatusMethodNotAllowed, "alice", http.MethodGet, base+"/goalseek", "")
	// Oversized bodies are refused with 413 before any parsing.
	big := make([]byte, maxRecalcBody+10)
	for _, p := range []string{"/recalc", "/deps", "/goalseek"} {
		if code, _ := e.do("viv", http.MethodPost, base+p, "application/json", big); code != http.StatusRequestEntityTooLarge {
			t.Errorf("oversized %s: status %d, want 413", p, code)
		}
	}
	// A viewer's goal seek does not write.
	sh, err := e.cfg.SheetsRepo.GetByID(e.ctx, e.sheetID)
	if err != nil || !strings.Contains(sh.Data, `"v":3`) {
		t.Fatalf("stored sheet changed: %v %.200s", err, sh.Data)
	}
}

// TestAuthzSheetsStructure: structure ops write, so they need edit access;
// the protected range blocks non-owner editors; bad input is 4xx.
func TestAuthzSheetsStructure(t *testing.T) {
	e := authzSetup(t)
	seedSheet(t, e)
	path := "/api/v1/sheets/d/" + e.sheetID + "/structure"
	op := `{"op":{"kind":"insert","axis":"row","sheet":"s1","index":5,"count":1}}`

	e.noLeak(e.expect(http.StatusUnauthorized, anon, http.MethodPost, path, op), sheetSecret)
	e.noLeak(e.expect(http.StatusNotFound, "mallory", http.MethodPost, path, op), sheetSecret)
	e.noLeak(e.expect(http.StatusForbidden, "viv", http.MethodPost, path, op), sheetSecret)
	e.noLeak(e.expect(http.StatusForbidden, "cara", http.MethodPost, path, op), sheetSecret)
	// Editors are allowed in general, but the sheet has a range only its
	// owner may change, so structure ops are refused for them.
	e.expect(http.StatusForbidden, "bob", http.MethodPost, path, op)
	e.expect(http.StatusForbidden, "ed", http.MethodPost, path, op)
	e.expect(http.StatusOK, "alice", http.MethodPost, path, op)

	// Without protection an editor grantee may restructure.
	alice := e.users["alice"]
	plain := `[{"id":"s1","name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":1}}]}]`
	if err := e.cfg.SheetsRepo.Save(e.ctx, alice.OrgID, e.sheetID, plain); err != nil {
		t.Fatal(err)
	}
	e.expect(http.StatusOK, "ed", http.MethodPost, path, op)
	e.expect(http.StatusOK, "bob", http.MethodPost, path, op)
	e.expect(http.StatusForbidden, "viv", http.MethodPost, path, op)

	for _, body := range []string{
		`{`, `{}`, `{"op":null}`, `{"op":{"kind":"explode","sheet":"s1"}}`,
		`{"op":{"kind":"insert","axis":"row","sheet":"s1","index":-1,"count":1}}`,
		`{"op":{"kind":"insert","axis":"row","sheet":"nope","index":0,"count":1}}`,
		`{"op":{"kind":"insert","axis":"row","sheet":"s1","index":0,"count":100000000}}`,
	} {
		e.expect(http.StatusBadRequest, "ed", http.MethodPost, path, body)
	}
	big := `{"op":{"kind":"insert","axis":"row","sheet":"` + strings.Repeat("x", maxStructureBody) + `"}}`
	e.expect(http.StatusRequestEntityTooLarge, "ed", http.MethodPost, path, big)
	e.expect(http.StatusMethodNotAllowed, "alice", http.MethodGet, path, "")
	for _, bad := range injectedIDs {
		p := strings.Replace(path, e.sheetID, bad, 1)
		if code, body := e.do("alice", http.MethodPost, p, "application/json", []byte(op)); code < 400 || code >= 500 {
			t.Errorf("POST %s: status %d (%.120s)", p, code, body)
		}
	}
}

// TestAuthzSheetsSaveEnforcesProtection: SaveSheet (PUT …/data) reverts a
// non-owner's change to a protected cell and to the protection itself,
// and refuses callers outside the sheet's org.
func TestAuthzSheetsSaveEnforcesProtection(t *testing.T) {
	e := authzSetup(t)
	seedSheet(t, e)
	path := "/api/v1/sheets/d/" + e.sheetID + "/data"
	tampered := `[{"id":"s1","name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":999}},{"r":0,"c":2,"v":{"v":"bob-was-here"}}]}]`
	body := `{"data":` + jsonString(tampered) + `}`
	e.expect(http.StatusUnauthorized, anon, http.MethodPut, path, body)
	e.expect(http.StatusNotFound, "mallory", http.MethodPut, path, body)
	e.expect(http.StatusOK, "bob", http.MethodPut, path, body)
	sh, _ := e.cfg.SheetsRepo.GetByID(e.ctx, e.sheetID)
	if !strings.Contains(sh.Data, `"v":3`) || strings.Contains(sh.Data, "999") || !strings.Contains(sh.Data, "grownProtection") {
		t.Fatalf("protected cell or protection not kept: %.400s", sh.Data)
	}
	if !strings.Contains(sh.Data, "bob-was-here") {
		t.Fatalf("unprotected edit lost: %.400s", sh.Data)
	}
	// The owner may change anything.
	e.expect(http.StatusOK, "alice", http.MethodPut, path, body)
	sh, _ = e.cfg.SheetsRepo.GetByID(e.ctx, e.sheetID)
	if !strings.Contains(sh.Data, "999") {
		t.Fatalf("owner edit not stored: %.400s", sh.Data)
	}
}

// TestAuthzSheetsCollab: the collab socket refuses strangers, drops a
// viewer's ops, drops a non-owner editor's ops on protected cells, and
// relays everything else.
func TestAuthzSheetsCollab(t *testing.T) {
	e := authzSetup(t)
	seedSheet(t, e)
	path := "/api/v1/sheets/d/" + e.sheetID + "/connect"
	if _, err := e.dial(anon, path); err == nil {
		t.Error("anonymous dial succeeded")
	}
	if _, err := e.dial("mallory", path); err == nil {
		t.Error("stranger dial succeeded")
	}
	for _, bad := range injectedIDs {
		if _, err := e.dial("alice", "/api/v1/sheets/d/"+bad+"/connect"); err == nil {
			t.Errorf("dial with id %q succeeded", bad)
		}
	}
	alice := e.mustDial("alice", path)
	bob := e.mustDial("bob", path)
	viv := e.mustDial("viv", path)
	time.Sleep(150 * time.Millisecond)

	op := func(r, c int, v string) string {
		return `[{"op":"replace","id":"s1","path":["data",` + itoa(r) + `,` + itoa(c) + `],"value":{"v":"` + v + `"}}]`
	}
	// A connection's messages are relayed in order, so each sender ends with
	// an allowed sentinel: once it arrives, everything before it was handled.
	// Viewer op, a spoofed restore notice dressed as presence (it would make
	// every editor reload and drop unsaved work), then viewer presence.
	wsSend(t, viv, websocket.MessageText, op(0, 3, "viewer-op"))
	wsSend(t, viv, websocket.MessageText, `{"type":"versionRestored","presence":{"userId":"x"}}`)
	wsSend(t, viv, websocket.MessageText, `{"type":"presence","presence":{"userId":"viv-presence"}}`)
	expectNextWithout(t, alice, "viv-presence", "viewer-op", "versionRestored")
	// bob's op on the protected A1, then his allowed op on D1.
	wsSend(t, bob, websocket.MessageText, op(0, 0, "bob-protected"))
	wsSend(t, bob, websocket.MessageText, op(0, 3, "bob-allowed"))
	expectNextWithout(t, alice, "bob-allowed", "bob-protected")
	// The owner may edit the protected cell.
	wsSend(t, alice, websocket.MessageText, op(0, 0, "alice-protected"))
	expectNextWithout(t, bob, "alice-protected")
}

// expectNextWithout reads c until a message containing want, failing if a
// message before it contains any of forbidden.
func expectNextWithout(t *testing.T, c *websocket.Conn, want string, forbidden ...string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m, ok := wsRead(c, time.Until(deadline))
		if !ok {
			break
		}
		for _, f := range forbidden {
			if strings.Contains(m, f) {
				t.Fatalf("relayed a message that must be dropped (%q): %.200s", f, m)
			}
		}
		if strings.Contains(m, want) {
			return
		}
	}
	t.Fatalf("did not receive %q", want)
}

func itoa(n int) string { return strconv.Itoa(n) }

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
