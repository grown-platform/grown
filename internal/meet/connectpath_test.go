package meet

import "testing"

// --------------------------------------------------------------------------
// ConnectPathID — room id extraction from the WebSocket connect path
// --------------------------------------------------------------------------

func TestConnectPathID(t *testing.T) {
	tests := []struct {
		path   string
		wantID string
		wantOK bool
	}{
		{"/api/v1/meet/rooms/room123/connect", "room123", true},
		{"/api/v1/meet/rooms/abc-defg-hij/connect", "abc-defg-hij", true},
		{"/api/v1/meet/rooms/x/connect", "x", true},
		{"/api/v1/meet/rooms//connect", "", false},          // empty id
		{"/api/v1/meet/rooms/a/b/connect", "", false},       // extra segment in id
		{"/api/v1/meet/rooms/room123/connect/", "", false},  // trailing slash → bad suffix
		{"/api/v1/meet/rooms/room123", "", false},           // missing suffix
		{"/api/v1/meet/rooms/connect", "", false},           // too short, no id
		{"/wrong/prefix/room123/connect", "", false},        // wrong prefix
		{"", "", false},                                     // empty
		{"/api/v1/meet/rooms/", "", false},                  // truncated
	}
	for _, tt := range tests {
		gotID, gotOK := ConnectPathID(tt.path)
		if gotID != tt.wantID || gotOK != tt.wantOK {
			t.Errorf("ConnectPathID(%q): got (%q,%v) want (%q,%v)",
				tt.path, gotID, gotOK, tt.wantID, tt.wantOK)
		}
	}
}

// connectPath and ConnectPathID should round-trip.
func TestConnectPath_RoundTrip(t *testing.T) {
	for _, id := range []string{"room1", "abc-defg-hij", "z"} {
		path := connectPath(id)
		got, ok := ConnectPathID(path)
		if !ok {
			t.Errorf("ConnectPathID(%q) returned !ok", path)
			continue
		}
		if got != id {
			t.Errorf("round-trip: connectPath(%q)=%q → ConnectPathID=%q", id, path, got)
		}
	}
}

// --------------------------------------------------------------------------
// peerInfoFrom — snapshot conversion
// --------------------------------------------------------------------------

func TestPeerInfoFrom(t *testing.T) {
	p := &peer{
		id:         "p1",
		name:       "Pat",
		audioMuted: true,
		videoOff:   false,
		handRaised: true,
	}
	pi := peerInfoFrom(p)
	if pi.ID != "p1" || pi.Name != "Pat" {
		t.Errorf("id/name: %+v", pi)
	}
	if !pi.AudioMuted || pi.VideoOff || !pi.HandRaised {
		t.Errorf("state flags: %+v", pi)
	}
}

// --------------------------------------------------------------------------
// getOrCreate — room reuse and creation
// --------------------------------------------------------------------------

func TestHub_GetOrCreate(t *testing.T) {
	h := NewHub()
	r1 := h.getOrCreate("room-x")
	if r1 == nil || r1.peers == nil {
		t.Fatal("expected a non-nil room with initialized peers map")
	}
	// Same room id returns the same instance.
	r2 := h.getOrCreate("room-x")
	if r1 != r2 {
		t.Error("getOrCreate returned a different room for the same id")
	}
	// A different id yields a different room.
	r3 := h.getOrCreate("room-y")
	if r3 == r1 {
		t.Error("getOrCreate returned the same room for different ids")
	}
}
