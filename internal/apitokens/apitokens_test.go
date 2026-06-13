package apitokens

import "testing"

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
	}
	for _, c := range cases {
		if got := ScopesAllow(c.scopes, c.path, c.method); got != c.want {
			t.Errorf("ScopesAllow(%v, %q, %q) = %v, want %v", c.scopes, c.path, c.method, got, c.want)
		}
	}
}
