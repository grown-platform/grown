package server

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"code.pick.haus/grown/grown/internal/convert"
	"code.pick.haus/grown/grown/internal/forms"
)

// TestAuthzOfficeConvert: capabilities and the LibreOffice route need a
// session; the route is off by default; when on, oversized, mislabelled and
// unsupported uploads are refused before soffice would run.
func TestAuthzOfficeConvert(t *testing.T) {
	e := authzSetup(t)
	ole := append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, make([]byte, 512)...)
	e.expect(http.StatusUnauthorized, anon, http.MethodGet, convert.CapabilitiesPath, "")
	if got := e.expect(http.StatusOK, "mallory", http.MethodGet, convert.CapabilitiesPath, ""); strings.TrimSpace(got) != `{"enabled":false}` {
		t.Errorf("default capabilities: %s", got)
	}
	if code, _ := e.do(anon, http.MethodPost, convert.OfficePath+"?from=doc", "", ole); code != http.StatusUnauthorized {
		t.Errorf("anonymous convert: %d", code)
	}
	if code, _ := e.do("alice", http.MethodPost, convert.OfficePath+"?from=doc", "", ole); code != http.StatusNotFound {
		t.Errorf("disabled convert: %d", code)
	}

	on := authzSetup(t, func(c *Config) {
		c.OfficeConverter = convert.New(convert.Config{Enabled: true, Binary: "/nonexistent/soffice", MaxInput: 1024})
	})
	if code, _ := on.do(anon, http.MethodPost, convert.OfficePath+"?from=doc", "", ole); code != http.StatusUnauthorized {
		t.Errorf("anonymous convert (enabled): %d", code)
	}
	on.expect(http.StatusUnauthorized, anon, http.MethodGet, convert.CapabilitiesPath, "")
	for _, c := range []struct {
		path string
		body []byte
		want int
	}{
		{convert.OfficePath + "?from=doc", append(ole, make([]byte, 2048)...), http.StatusRequestEntityTooLarge},
		{convert.OfficePath + "?from=doc", []byte("<html>not a legacy doc</html>"), http.StatusUnprocessableEntity},
		{convert.OfficePath + "?from=doc", nil, http.StatusUnprocessableEntity},
		{convert.OfficePath + "?from=exe", ole, http.StatusUnsupportedMediaType},
		{convert.OfficePath + "?from=../../bin/sh", ole, http.StatusUnsupportedMediaType},
		{convert.OfficePath + "?from=doc&to=pdf", ole, http.StatusBadRequest},
	} {
		if code, body := on.do("mallory", http.MethodPost, c.path, "", c.body); code != c.want {
			t.Errorf("POST %s (%d bytes): %d, want %d (%.120s)", c.path, len(c.body), code, c.want, body)
		}
	}
	if code, _ := on.do("mallory", http.MethodGet, convert.OfficePath+"?from=doc", "", nil); code != http.StatusNotFound {
		t.Errorf("GET office: %d", code)
	}
}

// TestAuthzFormsSubmissionValidation: SubmitFormResponse enforces the form's
// org, required questions and response validation server-side (CC4), so a
// client that skips the browser checks can't store invalid answers.
func TestAuthzFormsSubmissionValidation(t *testing.T) {
	e := authzSetup(t)
	alice := e.users["alice"]
	f, err := e.cfg.FormsRepo.Create(e.ctx, alice.OrgID, alice.ID, forms.Fields{
		Title:     "Survey",
		Accepting: true,
		Questions: []forms.Question{
			{ID: "age", Type: forms.TypeShortAnswer, Title: "Age", Required: true,
				Validation: &forms.Validation{Kind: "number", Op: "gt", Value: "17"}},
			{ID: "stars", Type: forms.TypeRating, Title: "Stars"},
			{ID: "secret", Type: forms.TypeShortAnswer, Title: "form-secret-5521"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/forms/" + f.ID + "/responses"
	answers := func(js string) string { return `{"answers_json":` + jsonString(js) + `}` }
	count := func() int {
		var n int
		if err := e.pool.QueryRow(e.ctx, `SELECT count(*) FROM grown.form_responses WHERE form_id=$1`, f.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	good := answers(`{"age":"30","stars":"4"}`)
	e.noLeak(e.expect(http.StatusUnauthorized, anon, http.MethodPost, path, good), "form-secret-5521")
	e.noLeak(e.expect(http.StatusNotFound, "mallory", http.MethodPost, path, good), "form-secret-5521")
	// Per-user document grants don't extend to forms (org-scoped).
	e.noLeak(e.expect(http.StatusNotFound, "ed", http.MethodPost, path, good), "form-secret-5521")
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, "/api/v1/forms/"+f.ID, "")
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, path, "")
	e.expect(http.StatusNotFound, "mallory", http.MethodGet, "/api/v1/forms/"+f.ID+"/summary", "")
	e.expect(http.StatusNotFound, "mallory", http.MethodDelete, path, "")
	if count() != 0 {
		t.Fatal("refused submissions stored")
	}

	for _, bad := range []string{
		answers(`{}`),                        // required missing
		answers(`{"age":""}`),                // required blank
		answers(`{"age":"12"}`),              // fails "> 17"
		answers(`{"age":"old"}`),             // not a number
		answers(`{"age":"30","stars":"9"}`),  // rating out of range
		answers(`{"age":"30","stars":"-1"}`), // rating out of range
		answers(`{"age":`),                   // malformed answers_json
		answers(`["age"]`),                   // not an object
		`{"answers_json":`,                   // malformed body
		`{"answers_json":["x"]}`,             // wrong type
	} {
		if code, body := e.do("bob", http.MethodPost, path, "application/json", []byte(bad)); code != http.StatusBadRequest {
			t.Errorf("submit %s: %d, want 400 (%.120s)", bad, code, body)
		}
	}
	if count() != 0 {
		t.Fatalf("%d invalid submissions stored", count())
	}
	e.expect(http.StatusOK, "bob", http.MethodPost, path, good)
	if count() != 1 {
		t.Fatalf("valid submission: %d stored", count())
	}
	// A closed form accepts nothing.
	if _, err := e.pool.Exec(e.ctx, `UPDATE grown.forms SET accepting=false WHERE id=$1`, f.ID); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.do("bob", http.MethodPost, path, "application/json", []byte(good)); code < 400 || code >= 500 {
		t.Errorf("closed form: %d", code)
	}
	for _, bad := range injectedIDs {
		if code, _ := e.do("bob", http.MethodPost, "/api/v1/forms/"+bad+"/responses", "application/json", []byte(good)); code < 400 || code >= 500 {
			t.Errorf("form id %q: %d", bad, code)
		}
	}
	// An oversized body is refused, not a 5xx.
	huge := `{"answers_json":` + jsonString(`{"age":"30","junk":"`+string(bytes.Repeat([]byte("x"), 8<<20))+`"}`) + `}`
	if code, _ := e.do("bob", http.MethodPost, path, "application/json", []byte(huge)); code >= 500 {
		t.Errorf("oversized submission: %d", code)
	}
}
