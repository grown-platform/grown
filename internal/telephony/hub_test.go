package telephony

import (
	"encoding/json"
	"testing"
)

// newTestPeer creates a peer with a buffered output channel for testing.
func newTestPeer(userID, name string) *peer {
	return &peer{userID: userID, name: name, out: make(chan []byte, 64)}
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

func TestHub_OnlineAfterAdd(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	h.add("org1", alice)

	if !h.Online("org1", "a") {
		t.Error("expected alice online after add")
	}
	if h.Online("org1", "z") {
		t.Error("did not expect unknown user online")
	}
	if h.Online("org2", "a") {
		t.Error("online status must be org-scoped")
	}

	h.remove("org1", alice)
	if h.Online("org1", "a") {
		t.Error("expected alice offline after remove")
	}
}

func TestHub_OnlineUsers(t *testing.T) {
	h := NewHub()
	h.add("org1", newTestPeer("a", "Alice"))
	h.add("org1", newTestPeer("b", "Bob"))
	ids := h.OnlineUsers("org1")
	if len(ids) != 2 {
		t.Fatalf("online users: got %d want 2", len(ids))
	}
	if h.OnlineUsers("nope") != nil {
		t.Error("expected nil for unknown org")
	}
}

func TestRoute_UnicastToTarget(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	carol := newTestPeer("c", "Carol")
	h.add("org1", alice)
	h.add("org1", bob)
	h.add("org1", carol)

	h.route("org1", SignalMessage{Type: SignalInvite, From: "a", To: "b", Name: "Alice"})

	got := drainMsg(t, bob)
	if got.Type != SignalInvite || got.From != "a" {
		t.Errorf("bob received: %+v", got)
	}
	assertEmpty(t, alice)
	assertEmpty(t, carol)
}

func TestRoute_NoTargetDropped(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	h.add("org1", alice)
	// Missing To — must not deliver anywhere (and must not panic).
	h.route("org1", SignalMessage{Type: SignalOffer, From: "a"})
	assertEmpty(t, alice)
}

func TestRoute_UnknownTargetDropped(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	h.add("org1", alice)
	// Target not connected — silently dropped.
	h.route("org1", SignalMessage{Type: SignalInvite, From: "a", To: "ghost"})
	assertEmpty(t, alice)
}

func TestBroadcastPresence_ReachesAll(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	h.add("org1", alice)
	h.add("org1", bob)

	h.broadcastPresence("org1")

	for _, p := range []*peer{alice, bob} {
		msg := drainMsg(t, p)
		if msg.Type != SignalPresence {
			t.Errorf("%s: type %s want presence", p.userID, msg.Type)
		}
		if len(msg.Online) != 2 {
			t.Errorf("%s: online %d want 2", p.userID, len(msg.Online))
		}
	}
}

func TestSendPresence_OnlyToTarget(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	h.add("org1", alice)
	h.add("org1", bob)
	// Drain the presence emitted by add()-driven flows is not triggered here,
	// since add() does not broadcast on its own.

	h.sendPresence("org1", bob)
	msg := drainMsg(t, bob)
	if msg.Type != SignalPresence {
		t.Errorf("type %s want presence", msg.Type)
	}
	assertEmpty(t, alice)
}

func TestHub_Add_DisplacesStaleConnection(t *testing.T) {
	h := NewHub()
	old := newTestPeer("a", "Alice")
	h.add("org1", old)
	// Reconnect: same user id, new peer. Old out channel should be closed.
	fresh := newTestPeer("a", "Alice")
	h.add("org1", fresh)

	if _, ok := <-old.out; ok {
		t.Error("expected old peer out channel to be closed on displacement")
	}
	if !h.Online("org1", "a") {
		t.Error("user should remain online via the fresh connection")
	}
}
