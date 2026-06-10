package meet

import (
	"encoding/json"
	"testing"
)

// newTestPeer creates a peer with a buffered output channel for testing.
func newTestPeer(id, name string) *peer {
	return &peer{id: id, name: name, out: make(chan []byte, 64)}
}

// drainMsg reads one message from p.out, failing if the channel is empty.
func drainMsg(t *testing.T, p *peer) SignalMessage {
	t.Helper()
	select {
	case raw := <-p.out:
		var msg SignalMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		return msg
	default:
		t.Fatal("expected a message in channel but it was empty")
		panic("unreachable")
	}
}

// assertEmpty fails if there is a pending message in the channel.
func assertEmpty(t *testing.T, p *peer) {
	t.Helper()
	select {
	case raw := <-p.out:
		t.Fatalf("expected empty channel but got: %s", raw)
	default:
	}
}

// buildRoom creates an in-memory callRoom with the supplied peers already added.
func buildRoom(peers ...*peer) *callRoom {
	cr := &callRoom{peers: map[string]*peer{}}
	for _, p := range peers {
		cr.peers[p.id] = p
	}
	return cr
}

// --------------------------------------------------------------------------
// Broadcast / roster tests
// --------------------------------------------------------------------------

func TestBroadcast_ReachesOtherPeers(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	carol := newTestPeer("c", "Carol")
	cr := buildRoom(alice, bob, carol)

	h.broadcast(cr, alice, SignalMessage{Type: SignalChat, From: "a", Text: "hello"})

	msgB := drainMsg(t, bob)
	if msgB.Type != SignalChat || msgB.Text != "hello" {
		t.Errorf("bob: unexpected msg %+v", msgB)
	}
	msgC := drainMsg(t, carol)
	if msgC.Type != SignalChat || msgC.Text != "hello" {
		t.Errorf("carol: unexpected msg %+v", msgC)
	}
	// Sender should not receive their own broadcast.
	assertEmpty(t, alice)
}

func TestBroadcast_EmptyRoom(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	cr := buildRoom(alice)
	// Should not panic.
	h.broadcast(cr, alice, SignalMessage{Type: SignalChat, Text: "solo"})
	assertEmpty(t, alice)
}

// --------------------------------------------------------------------------
// sendPresence / sendRosterState
// --------------------------------------------------------------------------

func TestSendPresence_PeerInfoIncludesState(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	alice.audioMuted = true
	alice.videoOff = true
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	h.sendPresence(cr, bob)

	msg := drainMsg(t, bob)
	if msg.Type != SignalPresence {
		t.Fatalf("type: got %s want presence", msg.Type)
	}
	if len(msg.Peers) != 1 {
		t.Fatalf("peers: got %d want 1", len(msg.Peers))
	}
	pi := msg.Peers[0]
	if pi.ID != "a" || pi.Name != "Alice" {
		t.Errorf("peer info: %+v", pi)
	}
	if !pi.AudioMuted || !pi.VideoOff {
		t.Errorf("expected AudioMuted+VideoOff: %+v", pi)
	}
	assertEmpty(t, alice)
}

func TestSendRosterState_IncludesHandRaise(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	alice.handRaised = true
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	h.sendRosterState(cr, bob)

	msg := drainMsg(t, bob)
	if msg.Type != SignalRosterState {
		t.Fatalf("type: got %s want roster_state", msg.Type)
	}
	if len(msg.Peers) != 1 || !msg.Peers[0].HandRaised {
		t.Errorf("expected hand_raised in peers: %+v", msg.Peers)
	}
}

// --------------------------------------------------------------------------
// route — media_state
// --------------------------------------------------------------------------

func TestRoute_MediaState_UpdatesStateAndBroadcasts(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	msg := SignalMessage{
		Type:       SignalMediaState,
		From:       "a",
		AudioMuted: true,
		VideoOff:   false,
	}
	h.route(cr, alice, msg)

	// Alice's stored state should be updated.
	cr.mu.Lock()
	muted := alice.audioMuted
	cr.mu.Unlock()
	if !muted {
		t.Error("expected alice.audioMuted to be true after media_state")
	}

	// Bob should receive the broadcast.
	got := drainMsg(t, bob)
	if got.Type != SignalMediaState || !got.AudioMuted {
		t.Errorf("bob received: %+v", got)
	}
	// Alice should NOT receive her own message.
	assertEmpty(t, alice)
}

// --------------------------------------------------------------------------
// route — hand_raise
// --------------------------------------------------------------------------

func TestRoute_HandRaise_UpdatesStateAndBroadcasts(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	h.route(cr, alice, SignalMessage{
		Type:       SignalHandRaise,
		From:       "a",
		HandRaised: true,
	})

	cr.mu.Lock()
	raised := alice.handRaised
	cr.mu.Unlock()
	if !raised {
		t.Error("expected alice.handRaised to be true")
	}
	got := drainMsg(t, bob)
	if got.Type != SignalHandRaise || !got.HandRaised {
		t.Errorf("bob received: %+v", got)
	}
	assertEmpty(t, alice)
}

func TestRoute_HandRaise_CanLower(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	alice.handRaised = true
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	h.route(cr, alice, SignalMessage{
		Type:       SignalHandRaise,
		From:       "a",
		HandRaised: false,
	})

	cr.mu.Lock()
	raised := alice.handRaised
	cr.mu.Unlock()
	if raised {
		t.Error("expected alice.handRaised to be false after lowering")
	}
}

// --------------------------------------------------------------------------
// route — chat relay
// --------------------------------------------------------------------------

func TestRoute_Chat_Broadcast(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	carol := newTestPeer("c", "Carol")
	cr := buildRoom(alice, bob, carol)

	h.route(cr, alice, SignalMessage{
		Type: SignalChat,
		From: "a",
		Name: "Alice",
		Text: "hey everyone",
	})

	for _, p := range []*peer{bob, carol} {
		got := drainMsg(t, p)
		if got.Type != SignalChat || got.Text != "hey everyone" {
			t.Errorf("%s got %+v", p.name, got)
		}
	}
	assertEmpty(t, alice)
}

// --------------------------------------------------------------------------
// route — unicast (offer/answer/candidate unaffected)
// --------------------------------------------------------------------------

func TestRoute_Unicast_OnlyReachesTarget(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	carol := newTestPeer("c", "Carol")
	cr := buildRoom(alice, bob, carol)

	h.route(cr, alice, SignalMessage{
		Type: SignalOffer,
		From: "a",
		To:   "b",
	})

	drainMsg(t, bob) // bob should get it
	assertEmpty(t, alice)
	assertEmpty(t, carol)
}

// --------------------------------------------------------------------------
// Hub.Presence
// --------------------------------------------------------------------------

func TestHub_Presence_ReturnsCurrentPeers(t *testing.T) {
	h := NewHub()
	// Directly inject a room.
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)
	h.mu.Lock()
	h.rooms["room1"] = cr
	h.mu.Unlock()

	ids := h.Presence("room1")
	if len(ids) != 2 {
		t.Fatalf("got %d peers want 2", len(ids))
	}
}

func TestHub_Presence_UnknownRoom(t *testing.T) {
	h := NewHub()
	if ids := h.Presence("nope"); ids != nil {
		t.Errorf("expected nil for unknown room, got %v", ids)
	}
}

// --------------------------------------------------------------------------
// cleanup
// --------------------------------------------------------------------------

func TestHub_Cleanup_RemovesEmptyRoom(t *testing.T) {
	h := NewHub()
	cr := buildRoom()
	h.mu.Lock()
	h.rooms["r1"] = cr
	h.mu.Unlock()

	h.cleanup("r1", cr)

	h.mu.Lock()
	_, exists := h.rooms["r1"]
	h.mu.Unlock()
	if exists {
		t.Error("expected empty room to be removed from hub")
	}
}

func TestHub_Cleanup_KeepsNonEmptyRoom(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	cr := buildRoom(alice)
	h.mu.Lock()
	h.rooms["r1"] = cr
	h.mu.Unlock()

	h.cleanup("r1", cr)

	h.mu.Lock()
	_, exists := h.rooms["r1"]
	h.mu.Unlock()
	if !exists {
		t.Error("expected non-empty room to remain in hub")
	}
}
