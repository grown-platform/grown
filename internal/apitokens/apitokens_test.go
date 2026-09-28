package apitokens

import "testing"

var haPreset = []string{"calendar:read", "calendar:write", "tasks:read", "tasks:write", "notifications:read", "notifications:write"}

func TestScopesAllow(t *testing.T) {
	cases := []struct {
		scopes []string
		path   string
		method string
		want   bool
	}{
		{[]string{"*"}, "/api/v1/drive/files", "POST", true},
		{[]string{"*"}, "/api/v1/anything/x", "DELETE", true},
		{[]string{"drive"}, "/api/v1/drive/files", "POST", true},
		{[]string{"drive"}, "/api/v1/drive/files", "GET", true},
		{[]string{"drive:read"}, "/api/v1/drive/files", "GET", true},
		{[]string{"drive:read"}, "/api/v1/drive/files", "POST", false}, // read-only blocks writes
		{[]string{"drive"}, "/api/v1/mail/messages", "GET", false},     // wrong service
		{[]string{"mail", "calendar"}, "/api/v1/calendar/events", "PATCH", true},
		{[]string{"drive:read"}, "/games/mightymike/play.html", "GET", true}, // non-api always allowed
		{[]string{}, "/api/v1/drive/files", "GET", false},                    // no scopes -> deny api
		// Home Assistant preset: calendar/tasks/notifications read+write.
		{haPreset, "/api/v1/calendar/events", "GET", true},
		{haPreset, "/api/v1/calendar/events", "POST", true},
		{haPreset, "/api/v1/calendar/events/abc", "PATCH", true},
		{haPreset, "/api/v1/calendar/events/abc", "DELETE", true},
		{haPreset, "/api/v1/tasks/lists", "GET", true},
		{haPreset, "/api/v1/tasks/lists/l1/tasks", "POST", true},
		{haPreset, "/api/v1/tasks/lists/l1/tasks/t1", "PATCH", true},
		{haPreset, "/api/v1/tasks/lists/l1/tasks/t1/toggle", "POST", true},
		{haPreset, "/api/v1/notifications", "GET", true},
		{haPreset, "/api/v1/notifications/push", "POST", true},
		{haPreset, "/api/v1/notifications/read-all", "POST", true},
		{haPreset, "/api/v1/drive/files", "GET", false},
		{haPreset, "/api/v1/integrations/homeassistant/info", "GET", true},
		// The info endpoint is scope-free for reads only, and only that path.
		{[]string{"drive:read"}, "/api/v1/integrations/homeassistant/info", "GET", true},
		{[]string{"drive:read"}, "/api/v1/integrations/homeassistant/info", "POST", false},
		{[]string{"drive:read"}, "/api/v1/integrations/homeassistant/other", "GET", false},
		{[]string{"calendar:read"}, "/api/v1/notifications/push", "POST", false},
		{[]string{"notifications:read"}, "/api/v1/notifications/push", "POST", false},
	}
	for _, c := range cases {
		if got := ScopesAllow(c.scopes, c.path, c.method); got != c.want {
			t.Errorf("ScopesAllow(%v, %q, %q) = %v, want %v", c.scopes, c.path, c.method, got, c.want)
		}
	}
}
