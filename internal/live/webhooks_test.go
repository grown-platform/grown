package live

import "testing"

func TestKeyMatches(t *testing.T) {
	const key = "abc123"
	cases := []struct {
		name string
		req  authRequest
		want bool
	}{
		{"password match", authRequest{Password: key}, true},
		{"user match", authRequest{User: key}, true},
		{"query key match", authRequest{Query: "?key=abc123"}, true},
		{"query pass match", authRequest{Query: "pass=abc123&x=1"}, true},
		{"query password match", authRequest{Query: "x=1&password=abc123"}, true},
		{"query token match", authRequest{Query: "token=abc123"}, true},
		{"wrong password", authRequest{Password: "nope"}, false},
		{"empty creds", authRequest{}, false},
		{"wrong query value", authRequest{Query: "?key=wrong"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := keyMatches(c.req, key); got != c.want {
				t.Errorf("keyMatches(%+v) = %v, want %v", c.req, got, c.want)
			}
		})
	}
	if keyMatches(authRequest{Password: ""}, "") {
		t.Error("empty key must never match")
	}
}

func TestStreamID(t *testing.T) {
	cases := []struct {
		path, suffix, wantID string
		wantOK               bool
	}{
		{"/api/v1/live/abc/_ready", ReadyPath, "abc", true},
		{"/api/v1/live/abc/_notready", NotReadyPath, "abc", true},
		{"/api/v1/live//_ready", ReadyPath, "", false},
		{"/api/v1/live/a/b/_ready", ReadyPath, "", false},
		{"/api/v1/live/abc/_ready", NotReadyPath, "", false},
		{"/other/abc/_ready", ReadyPath, "", false},
	}
	for _, c := range cases {
		id, ok := streamID(c.path, c.suffix)
		if ok != c.wantOK || id != c.wantID {
			t.Errorf("streamID(%q,%q) = (%q,%v), want (%q,%v)", c.path, c.suffix, id, ok, c.wantID, c.wantOK)
		}
	}
}
