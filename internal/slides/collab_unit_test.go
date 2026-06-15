package slides

// collab_unit_test.go covers the in-memory broadcast Hub: presence detection,
// room creation/cleanup lifecycle, and the broadcast fan-out semantics
// (excludes the sender, never blocks on a full peer). It also checks that
// Hub.Serve short-circuits cleanly on a plain (non-WebSocket-upgrade) request.
// All pure / in-process — no real WebSocket connections, no network.

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsPresence(t *testing.T) {
	cases := []struct {
		name string
		msg  string
		want bool
	}{
		{"presence cursor", `{"t":"presence","x":1,"y":2}`, true},
		{"presence only", `{"t":"presence"}`, true},
		{"op insert", `{"t":"op","kind":"insert"}`, false},
		{"empty object", `{}`, false},
		{"empty bytes", ``, false},
		{"word presence in field value still matches (substring)", `{"t":"op","note":"presence"}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isPresence([]byte(tc.msg)); got != tc.want {
				t.Errorf("isPresence(%q) = %v want %v", tc.msg, got, tc.want)
			}
		})
	}
}

func TestHub_RoomForIsStable(t *testing.T) {
	h := NewHub()
	r1 := h.roomFor("deck-1")
	r2 := h.roomFor("deck-1")
	if r1 != r2 {
		t.Fatal("roomFor returned different rooms for same id")
	}
	if other := h.roomFor("deck-2"); other == r1 {
		t.Fatal("roomFor returned same room for different ids")
	}
}

// TestHub_AddRemoveLifecycle verifies a room is created on first add and torn
// down only when its last peer leaves.
func TestHub_AddRemoveLifecycle(t *testing.T) {
	h := NewHub()
	p1 := &peer{out: make(chan []byte, 1)}
	p2 := &peer{out: make(chan []byte, 1)}

	r := h.add("deck-1", p1)
	if got := len(r.peers); got != 1 {
		t.Fatalf("after first add: %d peers want 1", got)
	}
	if r2 := h.add("deck-1", p2); r2 != r {
		t.Fatal("second add to same deck created a new room")
	}
	if got := len(r.peers); got != 2 {
		t.Fatalf("after second add: %d peers want 2", got)
	}

	// Removing one peer keeps the room alive (still has a peer).
	h.remove("deck-1", r, p1)
	h.mu.Lock()
	_, stillThere := h.rooms["deck-1"]
	h.mu.Unlock()
	if !stillThere {
		t.Fatal("room removed while a peer remained")
	}

	// Removing the last peer deletes the room.
	h.remove("deck-1", r, p2)
	h.mu.Lock()
	_, present := h.rooms["deck-1"]
	h.mu.Unlock()
	if present {
		t.Fatal("room not cleaned up after last peer left")
	}
}

// TestHub_RemoveStaleRoomNoOp: removing a peer against a room that has already
// been replaced in the hub must not delete the live room.
func TestHub_RemoveDoesNotDeleteReplacedRoom(t *testing.T) {
	h := NewHub()
	p := &peer{out: make(chan []byte, 1)}
	stale := h.add("deck-1", p)

	// Simulate the room being fully drained + a brand new room taking its place.
	h.remove("deck-1", stale, p) // deletes deck-1 (stale now empty)
	fresh := h.add("deck-1", &peer{out: make(chan []byte, 1)})
	if fresh == stale {
		t.Fatal("expected a fresh room after cleanup")
	}

	// Removing the (already-empty) stale room again must NOT remove the fresh one.
	h.remove("deck-1", stale, p)
	h.mu.Lock()
	cur := h.rooms["deck-1"]
	h.mu.Unlock()
	if cur != fresh {
		t.Fatal("stale remove clobbered the live room")
	}
}

// TestRoom_BroadcastExcludesSender confirms the sender does not receive its own
// message but every other peer does.
func TestRoom_BroadcastExcludesSender(t *testing.T) {
	r := &room{peers: map[*peer]struct{}{}}
	sender := &peer{out: make(chan []byte, 1)}
	a := &peer{out: make(chan []byte, 1)}
	b := &peer{out: make(chan []byte, 1)}
	for _, p := range []*peer{sender, a, b} {
		r.peers[p] = struct{}{}
	}

	r.broadcast(sender, []byte("hello"))

	if len(sender.out) != 0 {
		t.Error("sender received its own broadcast")
	}
	for name, p := range map[string]*peer{"a": a, "b": b} {
		select {
		case got := <-p.out:
			if string(got) != "hello" {
				t.Errorf("peer %s got %q want hello", name, got)
			}
		default:
			t.Errorf("peer %s received nothing", name)
		}
	}
}

// TestRoom_BroadcastNonBlockingOnFullPeer: a peer with a full (unread) channel
// must be skipped rather than blocking the broadcast for everyone else.
func TestRoom_BroadcastNonBlockingOnFullPeer(t *testing.T) {
	r := &room{peers: map[*peer]struct{}{}}
	full := &peer{out: make(chan []byte)} // unbuffered, no reader → would block
	ok := &peer{out: make(chan []byte, 1)}
	r.peers[full] = struct{}{}
	r.peers[ok] = struct{}{}

	done := make(chan struct{})
	go func() {
		r.broadcast(&peer{out: make(chan []byte, 1)}, []byte("msg"))
		close(done)
	}()
	<-done // must return despite `full` not being drained

	select {
	case got := <-ok.out:
		if string(got) != "msg" {
			t.Errorf("ok peer got %q", got)
		}
	default:
		t.Error("healthy peer did not receive the message")
	}
}

// TestServe_NonWebSocketRequest: a plain HTTP request cannot be upgraded, so
// websocket.Accept fails and Serve returns without hijacking or panicking.
func TestServe_NonWebSocketRequest(t *testing.T) {
	h := NewHub()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws/deck-1", nil)

	// Should return promptly (Accept fails on the missing Upgrade headers) and
	// must not register a lingering room.
	h.Serve(rec, req, "deck-1", true)

	h.mu.Lock()
	n := len(h.rooms)
	h.mu.Unlock()
	if n != 0 {
		t.Errorf("Serve left %d rooms registered after a failed upgrade", n)
	}
}
