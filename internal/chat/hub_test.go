package chat

import (
	"encoding/json"
	"sync"
	"testing"
)

// drain reads everything currently buffered on a peer's out channel and
// classifies the envelopes by type.
func drain(p *peer) []WSMessage {
	var out []WSMessage
	for range len(p.out) {
		raw := <-p.out
		var env WSMessage
		if err := json.Unmarshal(raw, &env); err == nil {
			out = append(out, env)
		}
	}
	return out
}

func countType(envs []WSMessage, typ string) int {
	n := 0
	for _, e := range envs {
		if e.Type == typ {
			n++
		}
	}
	return n
}

func TestHub_AddCreatesRoomAndTracksPeer(t *testing.T) {
	h := NewHub()
	p := &peer{userID: "u1", out: make(chan []byte, 4)}
	r := h.add("chan-1", p)

	if r == nil {
		t.Fatal("add returned nil room")
	}
	// The same channel should resolve to the same room.
	if got := h.roomFor("chan-1"); got != r {
		t.Errorf("roomFor returned a different room than add")
	}
	r.mu.Lock()
	_, ok := r.peers[p]
	n := len(r.peers)
	r.mu.Unlock()
	if !ok {
		t.Error("peer not present in room after add")
	}
	if n != 1 {
		t.Errorf("room has %d peers, want 1", n)
	}
}

func TestHub_RemoveLastPeerDeletesRoom(t *testing.T) {
	h := NewHub()
	p := &peer{userID: "u1", out: make(chan []byte, 4)}
	r := h.add("chan-1", p)

	h.remove("chan-1", r, p)

	h.mu.Lock()
	_, stillThere := h.rooms["chan-1"]
	h.mu.Unlock()
	if stillThere {
		t.Error("empty room should have been deleted from hub")
	}
}

func TestHub_RemoveKeepsRoomWithRemainingPeers(t *testing.T) {
	h := NewHub()
	p1 := &peer{userID: "u1", out: make(chan []byte, 4)}
	p2 := &peer{userID: "u2", out: make(chan []byte, 4)}
	r := h.add("chan-1", p1)
	_ = h.add("chan-1", p2)

	h.remove("chan-1", r, p1)

	h.mu.Lock()
	_, stillThere := h.rooms["chan-1"]
	h.mu.Unlock()
	if !stillThere {
		t.Fatal("room with a remaining peer should not be deleted")
	}
	r.mu.Lock()
	_, p1Gone := r.peers[p1]
	_, p2Present := r.peers[p2]
	r.mu.Unlock()
	if p1Gone {
		t.Error("removed peer still present")
	}
	if !p2Present {
		t.Error("remaining peer was dropped")
	}
}

// After a room is recreated under the same channel id, removing a peer that
// belonged to the *old* room instance must not delete the new room.
func TestHub_RemoveStaleRoomDoesNotDeleteCurrent(t *testing.T) {
	h := NewHub()
	p1 := &peer{userID: "u1", out: make(chan []byte, 4)}
	oldRoom := h.add("chan-1", p1)
	h.remove("chan-1", oldRoom, p1) // deletes chan-1

	// New peer creates a fresh room under the same id.
	p2 := &peer{userID: "u2", out: make(chan []byte, 4)}
	newRoom := h.add("chan-1", p2)
	if newRoom == oldRoom {
		t.Fatal("expected a fresh room instance")
	}

	// Removing p1 against the stale room must be a no-op for the new room.
	h.remove("chan-1", oldRoom, p1)

	h.mu.Lock()
	cur, ok := h.rooms["chan-1"]
	h.mu.Unlock()
	if !ok || cur != newRoom {
		t.Error("stale remove wrongly deleted/replaced the current room")
	}
}

func TestHub_BroadcastRoutesToChannelPeersOnly(t *testing.T) {
	h := NewHub()
	a := &peer{userID: "a", out: make(chan []byte, 4)}
	b := &peer{userID: "b", out: make(chan []byte, 4)}
	other := &peer{userID: "c", out: make(chan []byte, 4)}
	h.add("chan-1", a)
	h.add("chan-1", b)
	h.add("chan-2", other)

	h.Broadcast("chan-1", []byte(`{"type":"x"}`))

	if len(a.out) != 1 {
		t.Errorf("peer a: got %d messages, want 1", len(a.out))
	}
	if len(b.out) != 1 {
		t.Errorf("peer b: got %d messages, want 1", len(b.out))
	}
	if len(other.out) != 0 {
		t.Errorf("peer in other channel got %d messages, want 0", len(other.out))
	}
}

func TestHub_BroadcastToUnknownChannelIsNoop(t *testing.T) {
	h := NewHub()
	// Should not panic; roomFor lazily creates an empty room.
	h.Broadcast("nobody-here", []byte(`{"type":"x"}`))
	h.mu.Lock()
	r := h.rooms["nobody-here"]
	h.mu.Unlock()
	if r == nil {
		t.Fatal("expected lazily-created room")
	}
	r.mu.Lock()
	n := len(r.peers)
	r.mu.Unlock()
	if n != 0 {
		t.Errorf("unexpected peers: %d", n)
	}
}

// A full out-channel must not block the broadcaster (the select has a default).
func TestHub_BroadcastDropsToFullPeer(t *testing.T) {
	h := NewHub()
	full := &peer{userID: "slow", out: make(chan []byte, 1)}
	full.out <- []byte("preexisting") // fill the buffer
	h.add("chan-1", full)

	done := make(chan struct{})
	go func() {
		h.Broadcast("chan-1", []byte(`{"type":"x"}`))
		close(done)
	}()
	<-done // would deadlock if Broadcast blocked on the full channel

	if len(full.out) != 1 {
		t.Errorf("expected the new payload to be dropped, buffer len=%d", len(full.out))
	}
}

func TestHub_BroadcastMessageEnvelope(t *testing.T) {
	h := NewHub()
	p := &peer{userID: "u1", out: make(chan []byte, 4)}
	h.add("chan-7", p)

	h.BroadcastMessage("chan-7", map[string]any{"id": "m1", "body": "hi"})

	envs := drain(p)
	if countType(envs, "message") != 1 {
		t.Fatalf("want 1 message envelope, got %d (envs=%+v)", countType(envs, "message"), envs)
	}
	e := envs[0]
	if e.ChannelID != "chan-7" {
		t.Errorf("channel_id: got %q want chan-7", e.ChannelID)
	}
	if e.Message == nil {
		t.Error("message payload should be present")
	}
}

func TestHub_BroadcastDeletedEnvelope(t *testing.T) {
	h := NewHub()
	p := &peer{userID: "u1", out: make(chan []byte, 4)}
	h.add("chan-7", p)

	h.BroadcastDeleted("chan-7", "msg-42")

	envs := drain(p)
	if len(envs) != 1 {
		t.Fatalf("want 1 envelope, got %d", len(envs))
	}
	if envs[0].Type != "deleted" {
		t.Errorf("type: got %q want deleted", envs[0].Type)
	}
	if envs[0].ID != "msg-42" {
		t.Errorf("id: got %q want msg-42", envs[0].ID)
	}
	if envs[0].ChannelID != "chan-7" {
		t.Errorf("channel_id: got %q want chan-7", envs[0].ChannelID)
	}
}

func TestRoom_PresencePayloadListsNonEmptyUsers(t *testing.T) {
	h := NewHub()
	p1 := &peer{userID: "alice", out: make(chan []byte, 4)}
	p2 := &peer{userID: "bob", out: make(chan []byte, 4)}
	anon := &peer{userID: "", out: make(chan []byte, 4)} // anonymous peers are excluded
	r := h.add("chan-1", p1)
	h.add("chan-1", p2)
	h.add("chan-1", anon)

	var env WSMessage
	if err := json.Unmarshal(r.presencePayload("chan-1"), &env); err != nil {
		t.Fatalf("unmarshal presence: %v", err)
	}
	if env.Type != "presence" {
		t.Errorf("type: got %q want presence", env.Type)
	}
	if env.ChannelID != "chan-1" {
		t.Errorf("channel_id: got %q want chan-1", env.ChannelID)
	}
	got := map[string]bool{}
	for _, id := range env.Online {
		got[id] = true
	}
	if !got["alice"] || !got["bob"] {
		t.Errorf("online missing expected users: %v", env.Online)
	}
	if got[""] {
		t.Error("anonymous peer should not appear in presence")
	}
	if len(env.Online) != 2 {
		t.Errorf("online count: got %d want 2", len(env.Online))
	}
}

func TestRoom_BroadcastPresenceReachesAllPeers(t *testing.T) {
	h := NewHub()
	p1 := &peer{userID: "alice", out: make(chan []byte, 4)}
	p2 := &peer{userID: "bob", out: make(chan []byte, 4)}
	r := h.add("chan-1", p1)
	h.add("chan-1", p2)

	r.broadcastPresence("chan-1")

	for name, p := range map[string]*peer{"alice": p1, "bob": p2} {
		envs := drain(p)
		if countType(envs, "presence") != 1 {
			t.Errorf("peer %s: want 1 presence event, got %d", name, countType(envs, "presence"))
		}
	}
}

// Concurrency smoke test: parallel add/remove/broadcast must not race or panic.
// Run with -race to be meaningful.
func TestHub_ConcurrentAddRemoveBroadcast(t *testing.T) {
	h := NewHub()
	var wg sync.WaitGroup
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p := &peer{userID: "u", out: make(chan []byte, 8)}
			r := h.add("chan-1", p)
			h.Broadcast("chan-1", []byte(`{"type":"x"}`))
			r.broadcastPresence("chan-1")
			h.remove("chan-1", r, p)
		}()
	}
	wg.Wait()
}
