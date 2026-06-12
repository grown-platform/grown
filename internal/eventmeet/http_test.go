package eventmeet

import "testing"

func TestMatch(t *testing.T) {
	h := &HTTPHandler{}
	cases := []struct {
		path   string
		wantID string
		wantOK bool
	}{
		{"/api/v1/calendar/events/abc123/meet", "abc123", true},
		{"/api/v1/calendar/events/9f8e-uuid-1234/meet", "9f8e-uuid-1234", true},
		{"/api/v1/calendar/events//meet", "", false},          // empty id
		{"/api/v1/calendar/events/abc/meet/extra", "", false}, // trailing segment
		{"/api/v1/calendar/events/abc/attendees", "", false},  // wrong suffix
		{"/api/v1/calendar/events/abc", "", false},            // no /meet
		{"/api/v1/calendar/events/abc/sub/meet", "", false},   // nested id
		{"/api/v1/meet/codes", "", false},                     // unrelated
	}
	for _, c := range cases {
		id, ok := h.Match(c.path)
		if ok != c.wantOK || id != c.wantID {
			t.Errorf("Match(%q) = (%q,%v), want (%q,%v)", c.path, id, ok, c.wantID, c.wantOK)
		}
	}
}
