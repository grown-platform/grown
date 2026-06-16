package meet

import (
	"sync"
	"testing"
)

// --------------------------------------------------------------------------
// route — unicast edge cases
// --------------------------------------------------------------------------

func TestRoute_Unicast_UnknownTarget(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	// Target "ghost" doesn't exist: nothing should be delivered and no panic.
	h.route(cr, alice, SignalMessage{Type: SignalOffer, From: "a", To: "ghost"})

	assertEmpty(t, alice)
	assertEmpty(t, bob)
}

func TestRoute_Unicast_FullChannelDropped(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	// bob's channel has capacity 1 and we pre-fill it; the unicast must be
	// dropped (default branch) rather than block.
	bob := &peer{id: "b", name: "Bob", out: make(chan []byte, 1)}
	bob.out <- []byte("prefill")
	cr := buildRoom(alice, bob)

	done := make(chan struct{})
	go func() {
		h.route(cr, alice, SignalMessage{Type: SignalAnswer, From: "a", To: "b"})
		close(done)
	}()
	<-done // must not deadlock

	// Only the prefill remains; the dropped message never arrived.
	got := <-bob.out
	if string(got) != "prefill" {
		t.Errorf("expected prefill to remain, got %q", got)
	}
	select {
	case extra := <-bob.out:
		t.Errorf("expected channel drained, got extra %q", extra)
	default:
	}
}

func TestRoute_Broadcast_FullChannelDoesNotBlock(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := &peer{id: "b", name: "Bob", out: make(chan []byte, 1)}
	bob.out <- []byte("prefill")
	carol := newTestPeer("c", "Carol")
	cr := buildRoom(alice, bob, carol)

	done := make(chan struct{})
	go func() {
		// Broadcast (To == ""): bob's full channel is skipped, carol still gets it.
		h.route(cr, alice, SignalMessage{Type: SignalChat, From: "a", Text: "hi"})
		close(done)
	}()
	<-done

	got := drainMsg(t, carol)
	if got.Type != SignalChat || got.Text != "hi" {
		t.Errorf("carol: %+v", got)
	}
}

// --------------------------------------------------------------------------
// route — media_state only updates the sender, not other peers
// --------------------------------------------------------------------------

func TestRoute_MediaState_DoesNotMutateOthers(t *testing.T) {
	h := NewHub()
	alice := newTestPeer("a", "Alice")
	bob := newTestPeer("b", "Bob")
	cr := buildRoom(alice, bob)

	h.route(cr, alice, SignalMessage{Type: SignalMediaState, From: "a", AudioMuted: true, VideoOff: true})

	cr.mu.Lock()
	bobMuted := bob.audioMuted
	bobVideo := bob.videoOff
	cr.mu.Unlock()
	if bobMuted || bobVideo {
		t.Error("bob's state should be untouched by alice's media_state")
	}
	drainMsg(t, bob) // bob received the broadcast
}

// --------------------------------------------------------------------------
// Concurrency: route + sendPresence under -race
// --------------------------------------------------------------------------

func TestHub_ConcurrentRouteAndPresence_Race(t *testing.T) {
	h := NewHub()
	const nPeers = 8
	peers := make([]*peer, nPeers)
	cr := buildRoom()
	for i := 0; i < nPeers; i++ {
		// Large buffer so sends never block; we only care about data races.
		p := &peer{id: string(rune('a' + i)), name: "P", out: make(chan []byte, 1024)}
		peers[i] = p
		cr.mu.Lock()
		cr.peers[p.id] = p
		cr.mu.Unlock()
	}
	h.mu.Lock()
	h.rooms["r"] = cr
	h.mu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < nPeers; i++ {
		wg.Add(1)
		go func(self *peer) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				h.route(cr, self, SignalMessage{Type: SignalMediaState, From: self.id, AudioMuted: j%2 == 0})
				h.route(cr, self, SignalMessage{Type: SignalHandRaise, From: self.id, HandRaised: true})
				h.sendPresence(cr, self)
				h.sendRosterState(cr, self)
				_ = h.Presence("r")
			}
		}(peers[i])
	}
	wg.Wait()
}
