package versions

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeDocs is a tiny document table with per-user access: role "" = no
// access, "viewer" = read, "editor" = read+write.
type fakeDocs struct {
	data  map[string]string
	roles map[string]map[string]string // doc -> user -> role
	saved []string
}

func (f *fakeDocs) kind() Kind {
	return Kind{
		Resolve: func(r *http.Request, id string) (Doc, bool, error) {
			user := r.Header.Get("X-User")
			role := f.roles[id][user]
			if role == "" {
				return Doc{}, false, nil
			}
			return Doc{OrgID: "org", Data: f.data[id], CanWrite: role == "editor"}, true, nil
		},
		Save: func(_ context.Context, orgID, id, data string) error {
			f.data[id] = data
			f.saved = append(f.saved, data)
			return nil
		},
	}
}

func newTestHandler() (*Handler, *fakeDocs, *clock) {
	m, _, c := newTestManager(DefaultPolicy)
	f := &fakeDocs{
		data: map[string]string{docID: `{"v":1}`},
		roles: map[string]map[string]string{docID: {
			"ed": "editor", "view": "viewer",
		}},
	}
	h := &Handler{
		M:     m,
		Kinds: map[string]Kind{"sheets": f.kind()},
		UserID: func(r *http.Request) (string, bool) {
			u := r.Header.Get("X-User")
			return u, u != ""
		},
	}
	return h, f, c
}

func call(h http.Handler, user, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-User", user)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestHandlerFlow(t *testing.T) {
	h, f, c := newTestHandler()
	base := Prefix + "sheets/" + docID

	// Name the current version.
	rec := call(h, "ed", http.MethodPost, base, `{"label":"First draft"}`)
	if rec.Code != 200 {
		t.Fatalf("name: %d %s", rec.Code, rec.Body)
	}
	var first VersionJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &first)
	if first.Label != "First draft" || first.Data != "" {
		t.Fatalf("named: %+v", first)
	}

	// Change the document and snapshot it.
	c.advance(time.Hour)
	f.data[docID] = `{"v":2}`
	if ok, _ := h.M.AutoSnapshot(context.Background(), "sheets", docID, "ed", f.data[docID]); !ok {
		t.Fatal("auto snapshot")
	}

	// List (readers too).
	rec = call(h, "view", http.MethodGet, base, "")
	var list struct {
		Versions []VersionJSON `json:"versions"`
		CanEdit  bool          `json:"can_edit"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if rec.Code != 200 || len(list.Versions) != 2 || list.CanEdit {
		t.Fatalf("list as viewer: %d %+v", rec.Code, list)
	}

	// Get one with data.
	rec = call(h, "view", http.MethodGet, base+"/"+first.ID, "")
	var got VersionJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Data != `{"v":1}` {
		t.Fatalf("get: %d %+v", rec.Code, got)
	}

	// Rename.
	rec = call(h, "ed", http.MethodPatch, base+"/"+first.ID, `{"label":"Draft 1"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Draft 1") {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body)
	}

	// Restore writes the old content back and appends a version.
	rec = call(h, "ed", http.MethodPost, base+"/"+first.ID+"/restore", "")
	var restored struct {
		Version VersionJSON `json:"version"`
		Data    string      `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &restored)
	if rec.Code != 200 || restored.Data != `{"v":1}` || f.data[docID] != `{"v":1}` || restored.Version.RestoredFrom != first.ID {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "ed", http.MethodGet, base, "")
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Versions) != 3 || !list.CanEdit {
		t.Fatalf("after restore: %+v", list)
	}
}

func TestHandlerAccess(t *testing.T) {
	h, f, _ := newTestHandler()
	base := Prefix + "sheets/" + docID
	rec := call(h, "ed", http.MethodPost, base, `{"label":"v"}`)
	var v VersionJSON
	_ = json.Unmarshal(rec.Body.Bytes(), &v)

	cases := []struct {
		name, user, method, path, body string
		want                           int
	}{
		{"anonymous", "", http.MethodGet, base, "", 401},
		{"stranger list", "eve", http.MethodGet, base, "", 404},
		{"stranger get", "eve", http.MethodGet, base + "/" + v.ID, "", 404},
		{"viewer names", "view", http.MethodPost, base, `{"label":"x"}`, 403},
		{"viewer renames", "view", http.MethodPatch, base + "/" + v.ID, `{"label":"x"}`, 403},
		{"viewer restores", "view", http.MethodPost, base + "/" + v.ID + "/restore", "", 403},
		{"stranger restores", "eve", http.MethodPost, base + "/" + v.ID + "/restore", "", 404},
		{"unknown kind", "ed", http.MethodGet, Prefix + "docs/" + docID, "", 404},
		{"bad id", "ed", http.MethodGet, Prefix + "sheets/not-a-uuid", "", 404},
		{"bad action", "ed", http.MethodPost, base + "/" + v.ID + "/delete", "", 404},
		{"missing version", "ed", http.MethodGet, base + "/00000000-0000-0000-0000-000000000999", "", 404},
		{"empty label", "ed", http.MethodPost, base, `{"label":"  "}`, 400},
		{"delete", "ed", http.MethodDelete, base + "/" + v.ID, "", 405},
	}
	for _, tc := range cases {
		rec := call(h, tc.user, tc.method, tc.path, tc.body)
		if rec.Code != tc.want {
			t.Errorf("%s: %d, want %d (%s)", tc.name, rec.Code, tc.want, strings.TrimSpace(rec.Body.String()))
		}
	}
	if len(f.saved) != 0 {
		t.Fatalf("a refused request wrote the document: %v", f.saved)
	}
	// A version of one document can't be read through another the caller can see.
	f.data["22222222-2222-2222-2222-222222222222"] = "{}"
	f.roles["22222222-2222-2222-2222-222222222222"] = map[string]string{"ed": "editor"}
	rec = call(h, "ed", http.MethodGet, Prefix+"sheets/22222222-2222-2222-2222-222222222222/"+v.ID, "")
	if rec.Code != 404 {
		t.Fatalf("cross-document get: %d", rec.Code)
	}
}

func TestMatch(t *testing.T) {
	if !Match("/api/v1/versions/sheets/x") || Match("/api/v1/sheets/d/x") {
		t.Fatal("Match")
	}
}
