package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// TestAuthzVersions drives list/get/name/rename/restore for every kind
// through the real routing (session cookie → auth middleware → handler).
func TestAuthzVersions(t *testing.T) {
	e := authzSetup(t)
	alice := e.users["alice"]
	docs := map[string]struct {
		id, data string
		save     func(string) error
	}{
		"sheets": {e.sheetID, `[{"id":"s1","name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":"ver-secret-sheets"}}]}]`,
			func(d string) error { return e.cfg.SheetsRepo.Save(e.ctx, alice.OrgID, e.sheetID, d) }},
		"slides": {e.deckID, `{"slides":[{"id":"ver-secret-slides"}]}`,
			func(d string) error { return e.cfg.SlidesRepo.Save(e.ctx, alice.OrgID, e.deckID, d) }},
		"whiteboards": {e.boardID, `{"elements":[{"id":"ver-secret-whiteboards"}]}`,
			func(d string) error { return e.cfg.WhiteboardsRepo.Save(e.ctx, alice.OrgID, e.boardID, d) }},
	}
	for kind, d := range docs {
		t.Run(kind, func(t *testing.T) {
			e.t = t
			secret := "ver-secret-" + kind
			if err := d.save(d.data); err != nil {
				t.Fatal(err)
			}
			base := "/api/v1/versions/" + kind + "/" + d.id
			// alice names the current state.
			var v struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal([]byte(e.expect(http.StatusOK, "alice", http.MethodPost, base, `{"label":"v1"}`)), &v); err != nil || v.ID == "" {
				t.Fatalf("name: %v %+v", err, v)
			}
			if err := d.save(strings.Replace(d.data, secret, "later", 1)); err != nil {
				t.Fatal(err)
			}
			one := base + "/" + v.ID
			restore := one + "/restore"

			// Anonymous: 401 everywhere.
			for _, c := range [][3]string{{"GET", base, ""}, {"POST", base, `{"label":"x"}`}, {"GET", one, ""}, {"PATCH", one, `{"label":"x"}`}, {"POST", restore, ""}} {
				e.noLeak(e.expect(http.StatusUnauthorized, anon, c[0], c[1], c[2]), secret, v.ID)
			}
			// Another org: 404, nothing leaked.
			for _, c := range [][3]string{{"GET", base, ""}, {"POST", base, `{"label":"x"}`}, {"GET", one, ""}, {"PATCH", one, `{"label":"x"}`}, {"POST", restore, ""}} {
				e.noLeak(e.expect(http.StatusNotFound, "mallory", c[0], c[1], c[2]), secret, v.ID)
			}
			// Viewer and commenter grantees read, never write.
			for _, u := range []string{"viv", "cara"} {
				if body := e.expect(http.StatusOK, u, "GET", base, ""); !strings.Contains(body, `"can_edit":false`) {
					t.Errorf("%s list: %s", u, body)
				}
				if body := e.expect(http.StatusOK, u, "GET", one, ""); !strings.Contains(body, secret) {
					t.Errorf("%s get: %.200s", u, body)
				}
				e.expect(http.StatusForbidden, u, "POST", base, `{"label":"x"}`)
				e.expect(http.StatusForbidden, u, "PATCH", one, `{"label":"x"}`)
				e.expect(http.StatusForbidden, u, "POST", restore, "")
			}
			// Editors (org member and grantee) name, rename and restore.
			e.expect(http.StatusOK, "bob", "PATCH", one, `{"label":"renamed by bob"}`)
			e.expect(http.StatusOK, "ed", "POST", base, `{"label":"ed's"}`)
			if body := e.expect(http.StatusOK, "ed", "POST", restore, ""); !strings.Contains(body, secret) {
				t.Errorf("restore body: %.200s", body)
			}
			// Malformed / oversized bodies: 4xx, never 5xx.
			for _, b := range []string{``, `{`, `{"label":""}`, `{"label":"` + strings.Repeat("x", 8<<10) + `"}`} {
				if code, body := e.do("alice", "POST", base, "application/json", []byte(b)); code < 400 || code >= 500 {
					t.Errorf("name with %.20q: %d %.100s", b, code, body)
				}
			}
			e.expect(http.StatusMethodNotAllowed, "alice", "DELETE", one, "")
			// Id injection and path games.
			for _, p := range []string{
				"/api/v1/versions/" + kind + "/not-a-uuid",
				"/api/v1/versions/" + kind + "/" + d.id + "/not-a-uuid",
				"/api/v1/versions/" + kind + "/" + d.id + "/" + v.ID + "/delete",
				"/api/v1/versions/" + kind + "/" + d.id + "/" + v.ID + "/restore/x",
				"/api/v1/versions/" + kind + "/../docs/" + d.id,
				"/api/v1/versions/" + kind + "/" + d.id + "/..%2F" + v.ID,
				"/api/v1/versions/docs/" + d.id,
				"/api/v1/versions/" + kind + "/'%20OR%201=1--",
			} {
				if code, body := e.do("alice", "GET", p, "", nil); code != http.StatusNotFound {
					t.Errorf("GET %s: %d %.100s", p, code, body)
				}
			}
			// A version id of this document used through another kind.
			other := map[string]string{"sheets": "slides", "slides": "whiteboards", "whiteboards": "sheets"}[kind]
			otherID := docs[other].id
			e.expect(http.StatusNotFound, "alice", "GET", "/api/v1/versions/"+other+"/"+otherID+"/"+v.ID, "")
		})
	}
}

// TestAuthzSheetsVersionRestoreKeepsProtection: restoring a version is a
// write like SaveSheet, so it must not let a non-owner editor undo a
// protected range (or drop the protection) by restoring an older version.
func TestAuthzSheetsVersionRestoreKeepsProtection(t *testing.T) {
	e := authzSetup(t)
	alice := e.users["alice"]
	unprotected := `[{"id":"s1","name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":"old-value"}}]}]`
	if err := e.cfg.SheetsRepo.Save(e.ctx, alice.OrgID, e.sheetID, unprotected); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/versions/sheets/" + e.sheetID
	var v struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal([]byte(e.expect(http.StatusOK, "alice", http.MethodPost, base, `{"label":"before protection"}`)), &v)
	if v.ID == "" {
		t.Fatal("no version")
	}
	// alice protects A1 and sets a new value.
	protected := `[{"id":"s1","name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":"locked-value"}}],` +
		`"grownProtection":{"sheet":null,"ranges":[{"id":"p1","name":"L","ranges":[{"r1":0,"c1":0,"r2":0,"c2":0}],"users":[],"by":"` + alice.ID + `"}]}}]`
	if err := e.cfg.SheetsRepo.Save(e.ctx, alice.OrgID, e.sheetID, protected); err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{"bob", "ed"} {
		code, body := e.do(u, http.MethodPost, base+"/"+v.ID+"/restore", "", nil)
		sh, _ := e.cfg.SheetsRepo.GetByID(e.ctx, e.sheetID)
		if !strings.Contains(sh.Data, "locked-value") || !strings.Contains(sh.Data, "grownProtection") {
			t.Fatalf("%s's restore (%d %.100s) overwrote the protected range: %.300s", u, code, body, sh.Data)
		}
		if code != http.StatusForbidden {
			t.Errorf("%s's restore: status %d, want 403 (%.200s)", u, code, body)
		}
	}
	// The owner may restore it.
	e.expect(http.StatusOK, "alice", http.MethodPost, base+"/"+v.ID+"/restore", "")
	sh, _ := e.cfg.SheetsRepo.GetByID(e.ctx, e.sheetID)
	if !strings.Contains(sh.Data, "old-value") {
		t.Fatalf("owner restore: %.300s", sh.Data)
	}
}
