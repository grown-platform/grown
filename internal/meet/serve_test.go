package meet

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// serveHarness mounts Hub.Serve behind an httptest server and exposes a way to
// cancel an individual peer's request context. Cancelling a peer's context
// unblocks its server-side read loop, which is the deterministic way to
// simulate a disconnect (the websocket close handshake is unreliable to drive
// from a test client).
type serveHarness struct {
	srv     *httptest.Server
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func newServeHarness(h *Hub) *serveHarness {
	sh := &serveHarness{cancels: map[string]context.CancelFunc{}}
	sh.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		ctx, cancel := context.WithCancel(r.Context())
		sh.mu.Lock()
		sh.cancels[q.Get("peer")] = cancel
		sh.mu.Unlock()
		h.Serve(w, r.WithContext(ctx), q.Get("room"), q.Get("peer"), q.Get("name"))
	}))
	return sh
}

func (sh *serveHarness) close() { sh.srv.Close() }

// disconnect cancels a peer's server-side context, simulating a drop.
func (sh *serveHarness) disconnect(peer string) {
	sh.mu.Lock()
	cancel := sh.cancels[peer]
	sh.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (sh *serveHarness) dial(t *testing.T, room, peer, name string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(sh.srv.URL, "http") +
		"/?room=" + room + "&peer=" + peer + "&name=" + name
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", peer, err)
	}
	return c
}

func readSignal(t *testing.T, c *websocket.Conn) SignalMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var msg SignalMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return msg
}

func writeSignal(t *testing.T, c *websocket.Conn, msg SignalMessage) {
	t.Helper()
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// readUntil reads frames until one with the wanted type appears (or times out).
func readUntil(t *testing.T, c *websocket.Conn, want SignalType) SignalMessage {
	t.Helper()
	for i := 0; i < 10; i++ {
		msg := readSignal(t, c)
		if msg.Type == want {
			return msg
		}
	}
	t.Fatalf("never saw signal type %q", want)
	return SignalMessage{}
}

// --------------------------------------------------------------------------
// Serve — join sends presence + roster, fires OnFirstJoin
// --------------------------------------------------------------------------

func TestServe_FirstJoinHookAndPresence(t *testing.T) {
	h := NewHub()

	var (
		mu       sync.Mutex
		hookArgs []string
		fired    = make(chan struct{}, 1)
	)
	h.OnFirstJoin = func(roomID, peerID, name string) {
		mu.Lock()
		hookArgs = []string{roomID, peerID, name}
		mu.Unlock()
		select {
		case fired <- struct{}{}:
		default:
		}
	}

	sh := newServeHarness(h)
	defer sh.close()

	alice := sh.dial(t, "room1", "alice", "Alice")
	defer alice.CloseNow()

	// Alice (first peer) should receive a presence frame (empty peer list).
	pres := readUntil(t, alice, SignalPresence)
	if len(pres.Peers) != 0 {
		t.Errorf("first joiner presence should be empty, got %+v", pres.Peers)
	}
	// And a roster_state frame.
	readUntil(t, alice, SignalRosterState)

	// OnFirstJoin must have fired with the right arguments.
	select {
	case <-fired:
	case <-time.After(3 * time.Second):
		t.Fatal("OnFirstJoin never fired")
	}
	mu.Lock()
	args := hookArgs
	mu.Unlock()
	want := []string{"room1", "alice", "Alice"}
	for i := range want {
		if args[i] != want[i] {
			t.Errorf("OnFirstJoin arg %d: got %q want %q", i, args[i], want[i])
		}
	}

	// Presence() should now report alice in the room.
	ids := h.Presence("room1")
	if len(ids) != 1 || ids[0] != "alice" {
		t.Errorf("Presence: got %v want [alice]", ids)
	}
}

// OnFirstJoin must NOT fire for the second joiner (room already non-empty).
func TestServe_FirstJoinHookOnlyOnFirst(t *testing.T) {
	h := NewHub()
	var count int
	var mu sync.Mutex
	h.OnFirstJoin = func(string, string, string) {
		mu.Lock()
		count++
		mu.Unlock()
	}

	sh := newServeHarness(h)
	defer sh.close()

	alice := sh.dial(t, "room1b", "alice", "Alice")
	defer alice.CloseNow()
	readUntil(t, alice, SignalRosterState)

	bob := sh.dial(t, "room1b", "bob", "Bob")
	defer bob.CloseNow()
	readUntil(t, alice, SignalJoin) // wait until bob is fully joined

	time.Sleep(100 * time.Millisecond) // allow any stray hook to run
	mu.Lock()
	got := count
	mu.Unlock()
	if got != 1 {
		t.Errorf("OnFirstJoin fired %d times, want 1", got)
	}
}

// --------------------------------------------------------------------------
// Serve — second joiner announces "join"; relay stamps the authenticated From
// --------------------------------------------------------------------------

func TestServe_JoinAnnounceAndRelay(t *testing.T) {
	h := NewHub()
	sh := newServeHarness(h)
	defer sh.close()

	alice := sh.dial(t, "room2", "alice", "Alice")
	defer alice.CloseNow()
	readUntil(t, alice, SignalRosterState) // drain alice's own join frames

	bob := sh.dial(t, "room2", "bob", "Bob")
	defer bob.CloseNow()

	// Alice should be told that bob joined.
	join := readUntil(t, alice, SignalJoin)
	if join.From != "bob" || join.Name != "Bob" {
		t.Errorf("join announce: got from=%q name=%q", join.From, join.Name)
	}

	// Bob sends a chat with a forged From; the hub must overwrite From=bob.
	writeSignal(t, bob, SignalMessage{Type: SignalChat, From: "forged", Text: "hello"})
	chat := readUntil(t, alice, SignalChat)
	if chat.From != "bob" {
		t.Errorf("relay should stamp authenticated From=bob, got %q", chat.From)
	}
	if chat.Text != "hello" {
		t.Errorf("chat text: got %q", chat.Text)
	}
}

// --------------------------------------------------------------------------
// Serve — disconnect notifies remaining peers and cleans up empty rooms
// --------------------------------------------------------------------------

func TestServe_LeaveNotifiesAndCleansUp(t *testing.T) {
	h := NewHub()
	sh := newServeHarness(h)
	defer sh.close()

	alice := sh.dial(t, "room3", "alice", "Alice")
	defer alice.CloseNow()
	readUntil(t, alice, SignalRosterState)

	bob := sh.dial(t, "room3", "bob", "Bob")
	defer bob.CloseNow()
	readUntil(t, alice, SignalJoin) // bob's arrival

	// Bob disconnects (server-side context cancel simulates a dropped client).
	sh.disconnect("bob")

	leave := readUntil(t, alice, SignalLeave)
	if leave.From != "bob" {
		t.Errorf("leave: got from=%q want bob", leave.From)
	}

	// Alice still present; room must still exist.
	if ids := h.Presence("room3"); len(ids) != 1 {
		t.Errorf("after bob leaves: got %v want [alice]", ids)
	}

	// Alice disconnects too → room should be cleaned up.
	sh.disconnect("alice")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if len(h.Presence("room3")) == 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if ids := h.Presence("room3"); len(ids) != 0 {
		t.Errorf("expected empty room after both leave, got %v", ids)
	}
}

// --------------------------------------------------------------------------
// Serve — malformed JSON frames are ignored, not fatal
// --------------------------------------------------------------------------

func TestServe_IgnoresMalformedFrames(t *testing.T) {
	h := NewHub()
	sh := newServeHarness(h)
	defer sh.close()

	alice := sh.dial(t, "room4", "alice", "Alice")
	defer alice.CloseNow()
	readUntil(t, alice, SignalRosterState)

	bob := sh.dial(t, "room4", "bob", "Bob")
	defer bob.CloseNow()
	readUntil(t, alice, SignalJoin)

	// Bob sends garbage; the read loop must skip it and keep the connection.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := bob.Write(ctx, websocket.MessageText, []byte("{not json")); err != nil {
		t.Fatalf("write garbage: %v", err)
	}

	// Bob then sends a valid chat; alice must still receive it.
	writeSignal(t, bob, SignalMessage{Type: SignalChat, Text: "still here"})
	chat := readUntil(t, alice, SignalChat)
	if chat.Text != "still here" {
		t.Errorf("chat after garbage: got %q", chat.Text)
	}
}
