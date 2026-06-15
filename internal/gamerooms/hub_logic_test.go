package gamerooms

import (
	"context"
	"sync"
	"testing"
	"time"
)

// newPeer is a tiny helper to register a peer directly in a room's map, the way
// Serve does, so we can exercise the hub's pure bookkeeping without a websocket.
func addPeer(r *room, id, name string) *peer {
	p := &peer{id: id, name: name, out: make(chan []byte, 64), joinedAt: time.Now(), kick: make(chan struct{})}
	r.mu.Lock()
	r.peers[id] = p
	r.mu.Unlock()
	return p
}

func TestJoin_CreateExistingAndCap(t *testing.T) {
	t.Run("creates a new room on first join", func(t *testing.T) {
		h := NewHub(nil)
		r, created, ok := h.join("CODE1", "pw", "chess", true)
		if !ok || !created || r == nil {
			t.Fatalf("first join: ok=%v created=%v r=%v", ok, created, r)
		}
		if r.game != "chess" || r.password != "pw" || !r.listed {
			t.Fatalf("room fields not set: %+v", r)
		}
	})

	t.Run("rejoining existing room is not 'created'", func(t *testing.T) {
		h := NewHub(nil)
		h.join("CODE1", "pw", "chess", true)
		r, created, ok := h.join("CODE1", "pw", "ignored", false)
		if !ok || created || r == nil {
			t.Fatalf("rejoin: ok=%v created=%v", ok, created)
		}
		// game/listed come from the first creator, not the rejoiner.
		if r.game != "chess" || !r.listed {
			t.Fatalf("rejoin must not mutate room metadata: %+v", r)
		}
	})

	t.Run("password mismatch on existing room fails", func(t *testing.T) {
		h := NewHub(nil)
		h.join("CODE1", "pw", "chess", true)
		if _, _, ok := h.join("CODE1", "wrong", "", false); ok {
			t.Fatal("join with wrong password must fail")
		}
	})

	t.Run("global room cap is enforced", func(t *testing.T) {
		h := NewHub(nil)
		for i := 0; i < maxRooms; i++ {
			code := "room" + itoa(i)
			if _, _, ok := h.join(code, "", "", false); !ok {
				t.Fatalf("join %d under cap should succeed", i)
			}
		}
		if _, created, ok := h.join("overflow", "", "", false); ok || created {
			t.Fatalf("join past cap should fail: ok=%v created=%v", ok, created)
		}
		// An existing room is still joinable even at the cap (no new allocation).
		if _, _, ok := h.join("room0", "", "", false); !ok {
			t.Fatal("existing room must remain joinable at cap")
		}
	})
}

func TestPasswordOKAndRoomExists(t *testing.T) {
	h := NewHub(nil)
	// Free code: any password is OK (room doesn't exist yet).
	if !h.PasswordOK("FREE", "anything") {
		t.Error("free code should accept any password")
	}
	if h.RoomExists("FREE") {
		t.Error("PasswordOK must not create the room")
	}
	h.join("LOCK", "s3cret", "", false)
	tests := []struct {
		pw   string
		want bool
	}{
		{"s3cret", true},
		{"", false},
		{"nope", false},
	}
	for _, tc := range tests {
		if got := h.PasswordOK("LOCK", tc.pw); got != tc.want {
			t.Errorf("PasswordOK(LOCK,%q)=%v want %v", tc.pw, got, tc.want)
		}
	}
}

func TestList_FilteringRules(t *testing.T) {
	h := NewHub(nil) // store nil => enabled (fail-open)

	// listed + has a player + not full => shown.
	visible, _, _ := h.join("VIS", "", "chess", true)
	addPeer(visible, "p1", "A")

	// unlisted => hidden even with a player.
	priv, _, _ := h.join("PRIV", "", "poker", false)
	addPeer(priv, "p2", "B")

	// listed but empty => hidden (nobody waiting).
	h.join("EMPTY", "", "go", true)

	// listed but full => hidden.
	full, _, _ := h.join("FULL", "pw", "ludo", true)
	for i := 0; i < maxPeersPerRoom; i++ {
		addPeer(full, "f"+itoa(i), "x")
	}

	got := h.List()
	if len(got) != 1 {
		t.Fatalf("expected exactly 1 listed room, got %d: %+v", len(got), got)
	}
	info := got[0]
	if info.Code != "VIS" || info.Game != "chess" || info.Players != 1 || info.HasPassword {
		t.Fatalf("unexpected RoomInfo: %+v", info)
	}
	if info.AgeSec < 0 {
		t.Errorf("AgeSec should be non-negative, got %d", info.AgeSec)
	}
}

func TestList_EmptyWhenDisabled(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("VIS", "", "chess", true)
	addPeer(r, "p1", "A")
	h.enabled.Store(false)
	if got := h.List(); len(got) != 0 {
		t.Fatalf("List must be empty when disabled, got %+v", got)
	}
	// Sessions ignores the enabled flag (admins still see draining rooms).
	if got := h.Sessions(); len(got) != 1 {
		t.Fatalf("Sessions must ignore enabled flag, got %d", len(got))
	}
}

func TestSessions_Detail(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("S1", "pw", "chess", false)
	addPeer(r, "p1", "Alice")
	addPeer(r, "p2", "Bob")

	sessions := h.Sessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	s := sessions[0]
	if s.Code != "S1" || s.Game != "chess" || !s.HasPassword || s.Listed {
		t.Fatalf("session fields wrong: %+v", s)
	}
	if s.PlayerCount != 2 || len(s.Players) != 2 {
		t.Fatalf("expected 2 players, got count=%d len=%d", s.PlayerCount, len(s.Players))
	}
	names := map[string]bool{}
	for _, p := range s.Players {
		names[p.Name] = true
		if p.JoinedAt == "" {
			t.Error("JoinedAt should be populated")
		}
	}
	if !names["Alice"] || !names["Bob"] {
		t.Fatalf("missing players in roster: %+v", s.Players)
	}
}

func TestKickRoom(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("K1", "", "chess", false)
	pa := addPeer(r, "pa", "A")
	pb := addPeer(r, "pb", "B")

	n, ok := h.KickRoom("K1", "admin@x")
	if !ok || n != 2 {
		t.Fatalf("KickRoom: ok=%v n=%d want true,2", ok, n)
	}
	if h.RoomExists("K1") {
		t.Error("room must be removed after KickRoom")
	}
	// Each peer's kick channel must be closed.
	for _, p := range []*peer{pa, pb} {
		select {
		case <-p.kick:
		default:
			t.Errorf("peer %s kick channel not closed", p.id)
		}
	}
	// Missing room.
	if n, ok := h.KickRoom("nope", "admin@x"); ok || n != 0 {
		t.Errorf("KickRoom(missing): ok=%v n=%d want false,0", ok, n)
	}
}

func TestKickPeer(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("K2", "", "chess", false)
	target := addPeer(r, "victim", "V")
	addPeer(r, "other", "O")

	if !h.KickPeer("K2", "victim", "admin@x") {
		t.Fatal("KickPeer should find the peer")
	}
	select {
	case <-target.kick:
	default:
		t.Error("victim kick channel must be closed")
	}
	// Unknown peer / unknown room.
	if h.KickPeer("K2", "ghost", "admin@x") {
		t.Error("KickPeer must fail for unknown peer")
	}
	if h.KickPeer("nope", "victim", "admin@x") {
		t.Error("KickPeer must fail for unknown room")
	}
}

func TestDoKick_Idempotent(t *testing.T) {
	p := &peer{kick: make(chan struct{})}
	p.doKick()
	p.doKick() // second call must not panic (double-close guard).
	select {
	case <-p.kick:
	default:
		t.Error("kick channel should be closed")
	}
}

func TestCleanup_RemovesEmptyRoomOnly(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("C1", "", "chess", false)
	// Non-empty room: cleanup is a no-op.
	addPeer(r, "p1", "A")
	h.cleanup("C1", r)
	if !h.RoomExists("C1") {
		t.Fatal("cleanup must not remove a non-empty room")
	}
	// Empty room: removed.
	r.mu.Lock()
	delete(r.peers, "p1")
	r.mu.Unlock()
	h.cleanup("C1", r)
	if h.RoomExists("C1") {
		t.Fatal("cleanup must remove an empty room")
	}

	// Stale pointer: a different room reused the code => must NOT delete it.
	r2, _, _ := h.join("C1", "", "chess", false)
	h.cleanup("C1", r) // r is the old, replaced room
	if !h.RoomExists("C1") {
		t.Fatal("cleanup with stale room pointer must not remove the live room")
	}
	_ = r2
}

func TestBroadcastSendToAndRoster(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("B1", "", "chess", false)
	from := addPeer(r, "from", "From")
	a := addPeer(r, "a", "A")
	b := addPeer(r, "b", "B")

	// broadcast goes to everyone except the sender.
	h.broadcast(r, from, map[string]any{"type": "move"})
	if len(from.out) != 0 {
		t.Error("sender should not receive its own broadcast")
	}
	if len(a.out) != 1 || len(b.out) != 1 {
		t.Fatalf("broadcast should reach a and b: a=%d b=%d", len(a.out), len(b.out))
	}

	// sendTo targets a single peer.
	h.sendTo(r, "a", map[string]any{"type": "deal"})
	if len(a.out) != 2 {
		t.Errorf("sendTo should deliver to a, got %d", len(a.out))
	}
	if len(b.out) != 1 {
		t.Errorf("sendTo must not touch b, got %d", len(b.out))
	}
	// sendTo unknown peer is a no-op (no panic).
	h.sendTo(r, "ghost", map[string]any{"type": "x"})

	// roster goes only to the addressed peer and contains everyone.
	h.sendRoster(r, b)
	if len(b.out) != 2 {
		t.Fatalf("roster should be delivered to b, got %d", len(b.out))
	}
}

func TestBroadcast_DropsOnFullChannel(t *testing.T) {
	h := NewHub(nil)
	r, _, _ := h.join("FULLCH", "", "chess", false)
	from := addPeer(r, "from", "From")
	slow := &peer{id: "slow", name: "Slow", out: make(chan []byte, 1), kick: make(chan struct{})}
	r.mu.Lock()
	r.peers["slow"] = slow
	r.mu.Unlock()
	// Saturate the slow peer's buffer; the non-blocking send must drop, not hang.
	slow.out <- []byte("x")
	done := make(chan struct{})
	go func() {
		h.broadcast(r, from, map[string]any{"type": "move"})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("broadcast blocked on a full peer channel")
	}
}

// TestHub_ConcurrentAccess exercises the hub under -race with many goroutines
// joining, listing, kicking, and cleaning up rooms simultaneously.
func TestHub_ConcurrentAccess(t *testing.T) {
	h := NewHub(nil)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			code := "rc" + itoa(i%10)
			r, _, ok := h.join(code, "", "chess", true)
			if ok {
				p := addPeer(r, "p"+itoa(i), "n")
				h.broadcast(r, p, map[string]any{"type": "ping"})
				h.sendRoster(r, p)
				r.mu.Lock()
				delete(r.peers, p.id)
				r.mu.Unlock()
				h.cleanup(code, r)
			}
		}(i)
	}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = h.List() }()
		wg.Add(1)
		go func() { defer wg.Done(); _ = h.Sessions() }()
		wg.Add(1)
		go func(i int) { defer wg.Done(); h.KickRoom("rc"+itoa(i%10), "admin") }(i)
	}
	wg.Wait()
}

func TestNewHub_NilStoreEnabledAndSetEnabled(t *testing.T) {
	h := NewHub(nil)
	if !h.Enabled() {
		t.Fatal("nil-store hub should fail open (enabled)")
	}
	// SetEnabled tolerates a nil store and flips the cached flag + logs an event.
	if err := h.SetEnabled(context.Background(), false, "admin@x"); err != nil {
		t.Fatalf("SetEnabled(nil store): %v", err)
	}
	if h.Enabled() {
		t.Fatal("Enabled should be false after disabling")
	}
	if err := h.SetEnabled(context.Background(), true, "admin@x"); err != nil {
		t.Fatalf("SetEnabled re-enable: %v", err)
	}
	if !h.Enabled() {
		t.Fatal("Enabled should be true after re-enabling")
	}
}
