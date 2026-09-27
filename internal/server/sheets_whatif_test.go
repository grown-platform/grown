package server

import "testing"

func TestSheetsActionID(t *testing.T) {
	for _, tc := range []struct{ path, action, want string }{
		{"/api/v1/sheets/d/abc/deps", "deps", "abc"},
		{"/api/v1/sheets/d/abc/goalseek", "goalseek", "abc"},
		{"/api/v1/sheets/d/abc/goalseek", "deps", ""},
		{"/api/v1/sheets/d//deps", "deps", ""},
		{"/api/v1/sheets/d/a/b/deps", "deps", ""},
		{"/api/v1/docs/d/abc/deps", "deps", ""},
	} {
		id, ok := sheetsActionID(tc.path, tc.action)
		if (tc.want != "") != ok || id != tc.want {
			t.Errorf("sheetsActionID(%q, %q) = %q, %v", tc.path, tc.action, id, ok)
		}
	}
}
