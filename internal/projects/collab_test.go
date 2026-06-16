package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// drain reads buffered messages from a peer's outbound channel without blocking.
func drainPeer(p *peer) [][]byte {
	var out [][]byte
	for {
		select {
		case b := <-p.out:
			out = append(out, b)
		default:
			return out
		}
	}
}

func TestWSMessage_JSONShaping(t *testing.T) {
	tests := []struct {
		name string
		msg  WSMessage
		want string
	}{
		{
			name: "issue carries team and payload, omits empties",
			msg:  WSMessage{Type: "issue", TeamID: "t1", Issue: map[string]string{"id": "i1"}},
			want: `{"type":"issue","issue":{"id":"i1"},"team_id":"t1"}`,
		},
		{
			name: "deleted carries id and team",
			msg:  WSMessage{Type: "deleted", TeamID: "t1", ID: "i9"},
			want: `{"type":"deleted","team_id":"t1","id":"i9"}`,
		},
		{
			name: "presence carries online list",
			msg:  WSMessage{Type: "presence", TeamID: "t1", Online: []string{"u1", "u2"}},
			want: `{"type":"presence","online":["u1","u2"],"team_id":"t1"}`,
		},
		{
			name: "empty optionals omitted",
			msg:  WSMessage{Type: "presence", TeamID: "t1"},
			want: `{"type":"presence","team_id":"t1"}`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b, err := json.Marshal(tc.msg)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(b) != tc.want {
				t.Errorf("json:\n got %s\nwant %s", b, tc.want)
			}
		})
	}
}

func TestHub_BroadcastIssue_Guards(t *testing.T) {
	// Nil hub must not panic.
	var nilHub *Hub
	nilHub.BroadcastIssue("t1", map[string]string{"id": "i1"})
	nilHub.BroadcastDeleted("t1", "i1")

	h := NewHub()
	// Empty teamID is a no-op (no room created).
	h.BroadcastIssue("", map[string]string{"id": "x"})
	h.BroadcastDeleted("", "x")
	h.mu.Lock()
	n := len(h.rooms)
	h.mu.Unlock()
	if n != 0 {
		t.Errorf("empty-team broadcast created %d rooms, want 0", n)
	}
}

func TestHub_BroadcastIssue_DeliversToPeer(t *testing.T) {
	h := NewHub()
	p := &peer{userID: "u1", out: make(chan []byte, 4)}
	h.add("t1", p)

	h.BroadcastIssue("t1", map[string]string{"id": "i1"})
	msgs := drainPeer(p)
	if len(msgs) != 1 {
		t.Fatalf("got %d messages want 1", len(msgs))
	}
	var got WSMessage
	if err := json.Unmarshal(msgs[0], &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != "issue" || got.TeamID != "t1" {
		t.Errorf("message: %+v", got)
	}
}

func TestHub_BroadcastDeleted_DeliversToPeer(t *testing.T) {
	h := NewHub()
	p := &peer{userID: "u1", out: make(chan []byte, 4)}
	h.add("t1", p)

	h.BroadcastDeleted("t1", "i9")
	msgs := drainPeer(p)
	if len(msgs) != 1 {
		t.Fatalf("got %d messages want 1", len(msgs))
	}
	var got WSMessage
	_ = json.Unmarshal(msgs[0], &got)
	if got.Type != "deleted" || got.ID != "i9" || got.TeamID != "t1" {
		t.Errorf("message: %+v", got)
	}
}

func TestHub_BroadcastOnlyToMatchingTeam(t *testing.T) {
	h := NewHub()
	pA := &peer{userID: "a", out: make(chan []byte, 4)}
	pB := &peer{userID: "b", out: make(chan []byte, 4)}
	h.add("teamA", pA)
	h.add("teamB", pB)

	h.BroadcastIssue("teamA", map[string]string{"id": "i1"})
	if got := drainPeer(pA); len(got) != 1 {
		t.Errorf("teamA peer got %d want 1", len(got))
	}
	if got := drainPeer(pB); len(got) != 0 {
		t.Errorf("teamB peer got %d want 0 (cross-team leak)", len(got))
	}
}

func TestHub_BroadcastDropsWhenChannelFull(t *testing.T) {
	h := NewHub()
	// Unbuffered channel with no reader → send must be dropped, not block.
	p := &peer{userID: "u1", out: make(chan []byte)}
	h.add("t1", p)
	done := make(chan struct{})
	go func() {
		h.BroadcastIssue("t1", map[string]string{"id": "i1"})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("BroadcastIssue blocked on a full channel; should drop")
	}
}

func TestHub_AddRemoveRoomLifecycle(t *testing.T) {
	h := NewHub()
	p1 := &peer{userID: "u1", out: make(chan []byte, 1)}
	p2 := &peer{userID: "u2", out: make(chan []byte, 1)}

	r := h.add("t1", p1)
	h.add("t1", p2)
	h.mu.Lock()
	if len(h.rooms) != 1 {
		t.Errorf("rooms after two adds: got %d want 1", len(h.rooms))
	}
	h.mu.Unlock()

	// Removing one peer keeps the room alive.
	h.remove("t1", r, p1)
	h.mu.Lock()
	if _, ok := h.rooms["t1"]; !ok {
		t.Error("room removed while a peer remains")
	}
	h.mu.Unlock()

	// Removing the last peer deletes the room.
	h.remove("t1", r, p2)
	h.mu.Lock()
	if _, ok := h.rooms["t1"]; ok {
		t.Error("empty room not garbage-collected")
	}
	h.mu.Unlock()
}

func TestHub_RoomForReusesSameRoom(t *testing.T) {
	h := NewHub()
	r1 := h.roomFor("t1")
	r2 := h.roomFor("t1")
	if r1 != r2 {
		t.Error("roomFor returned distinct rooms for the same team")
	}
	if r3 := h.roomFor("t2"); r3 == r1 {
		t.Error("roomFor returned the same room for different teams")
	}
}

func TestRoom_BroadcastPresenceListsNonEmptyUsers(t *testing.T) {
	h := NewHub()
	named := &peer{userID: "u1", out: make(chan []byte, 4)}
	anon := &peer{userID: "", out: make(chan []byte, 4)}
	r := h.add("t1", named)
	h.add("t1", anon)

	r.broadcastPresence("t1")

	// Both peers receive the presence message.
	for _, p := range []*peer{named, anon} {
		msgs := drainPeer(p)
		if len(msgs) != 1 {
			t.Fatalf("peer got %d presence messages want 1", len(msgs))
		}
		var got WSMessage
		_ = json.Unmarshal(msgs[0], &got)
		if got.Type != "presence" || got.TeamID != "t1" {
			t.Errorf("presence message: %+v", got)
		}
		// Only the named user appears in the online list.
		if len(got.Online) != 1 || got.Online[0] != "u1" {
			t.Errorf("online list: got %v want [u1]", got.Online)
		}
	}
}

// TestHub_Serve_PresenceRoundTrip drives a real WebSocket connection through an
// httptest server. The client should receive at least one presence frame and the
// hub should clean up the room when the connection closes.
func TestHub_Serve_PresenceRoundTrip(t *testing.T) {
	h := NewHub()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Serve(w, r, "team1", "user1")
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + srv.URL[len("http"):]
	c, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	// First frame should be the initial presence broadcast.
	typ, data, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read presence: %v", err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("frame type: got %v", typ)
	}
	var msg WSMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal presence: %v", err)
	}
	if msg.Type != "presence" || msg.TeamID != "team1" {
		t.Fatalf("presence frame: %+v", msg)
	}
	if len(msg.Online) != 1 || msg.Online[0] != "user1" {
		t.Errorf("online: got %v want [user1]", msg.Online)
	}

	// A broadcast to the team should reach the connected client.
	h.BroadcastIssue("team1", map[string]string{"id": "i1"})
	if _, data, err = c.Read(ctx); err != nil {
		t.Fatalf("read issue: %v", err)
	}
	var issueMsg WSMessage
	_ = json.Unmarshal(data, &issueMsg)
	if issueMsg.Type != "issue" {
		t.Errorf("expected issue frame, got %+v", issueMsg)
	}

	// Close the connection; the hub should eventually drop the now-empty room.
	c.Close(websocket.StatusNormalClosure, "done")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		h.mu.Lock()
		_, ok := h.rooms["team1"]
		h.mu.Unlock()
		if !ok {
			return // room cleaned up
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Error("room not cleaned up after client disconnect")
}

// TestHub_Serve_RejectsNonWebSocket confirms a plain HTTP request (no upgrade
// headers) returns without panicking and leaves no room behind.
func TestHub_Serve_RejectsNonWebSocket(t *testing.T) {
	h := NewHub()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	h.Serve(rec, req, "team1", "user1")
	h.mu.Lock()
	n := len(h.rooms)
	h.mu.Unlock()
	if n != 0 {
		t.Errorf("failed upgrade created %d rooms, want 0", n)
	}
}
