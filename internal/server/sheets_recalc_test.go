package server

import "testing"

func TestSheetsRecalcID(t *testing.T) {
	for path, want := range map[string]string{
		"/api/v1/sheets/d/abc/recalc":  "abc",
		"/api/v1/sheets/d/abc/connect": "",
		"/api/v1/sheets/d//recalc":     "",
		"/api/v1/sheets/d/a/b/recalc":  "",
		"/api/v1/docs/d/abc/recalc":    "",
	} {
		id, ok := sheetsRecalcID(path)
		if (want != "") != ok || id != want {
			t.Errorf("sheetsRecalcID(%q) = %q, %v", path, id, ok)
		}
	}
}
