package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSheetsStructureID(t *testing.T) {
	for path, want := range map[string]string{
		"/api/v1/sheets/d/abc/structure": "abc",
		"/api/v1/sheets/d/abc/recalc":    "",
		"/api/v1/sheets/d//structure":    "",
		"/api/v1/sheets/d/a/b/structure": "",
		"/api/v1/docs/d/abc/structure":   "",
	} {
		id, ok := sheetsStructureID(path)
		if (want != "") != ok || id != want {
			t.Errorf("sheetsStructureID(%q) = %q, %v", path, id, ok)
		}
	}
}

func TestSheetsStructureRejectsBeforeStorage(t *testing.T) {
	// Wrong method and missing user are refused before the repository is touched.
	rec := httptest.NewRecorder()
	serveSheetsStructure(rec, httptest.NewRequest(http.MethodGet, "/api/v1/sheets/d/x/structure", nil), "x", nil, nil)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET: code %d, want 405", rec.Code)
	}
	rec = httptest.NewRecorder()
	serveSheetsStructure(rec, httptest.NewRequest(http.MethodPost, "/api/v1/sheets/d/x/structure", nil), "x", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("POST without user: code %d, want 401", rec.Code)
	}
}
