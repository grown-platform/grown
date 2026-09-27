package docs

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// serveHub runs h.Serve for doc "doc1" behind an httptest server and dials it.
func serveHub(t *testing.T, h *Hub) (*websocket.Conn, func()) {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Serve(w, r, "doc1", true)
	}))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil)
	if err != nil {
		ts.Close()
		t.Fatalf("dial: %v", err)
	}
	c.SetReadLimit(readLimit)
	return c, ts.Close
}

// A document's update log routinely holds far more entries than a peer's
// outbound queue (one per keystroke). Replay must deliver all of them, not
// drop the ones that do not fit the queue.
func TestServe_ReplaysMoreUpdatesThanTheQueueHolds(t *testing.T) {
	store := newFakeStore()
	const n = 1000
	for i := 0; i < n; i++ {
		_ = store.AppendUpdate(context.Background(), "doc1", syncMsg(syncUpdate, varint(uint64(i))))
	}
	c, stop := serveHub(t, NewHub(store))
	defer stop()
	defer c.CloseNow()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for i := 0; i < n; i++ {
		_, _, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("read replayed update %d of %d: %v", i, n, err)
		}
	}
}

// When a solo client disconnects, Serve must return (and so leave the room)
// rather than wait on the request context, which is not cancelled for a
// hijacked connection until the handler returns.
func TestServe_ReturnsAndLeavesRoomWhenClientCloses(t *testing.T) {
	h := NewHub(newFakeStore())
	c, stop := serveHub(t, h)
	defer stop()

	waitRoom := func(want bool) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for {
			h.mu.Lock()
			_, ok := h.rooms["doc1"]
			h.mu.Unlock()
			if ok == want {
				return
			}
			if time.Now().After(deadline) {
				t.Fatalf("room present = %v, want %v", ok, want)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	waitRoom(true)
	c.Close(websocket.StatusNormalClosure, "bye")
	waitRoom(false)
}

// The hub answers a client's syncStep1 with a syncStep2 after the replay (so
// y-websocket's provider.synced flips) and echoes its awareness back (so a
// lone client's socket is not silent and y-websocket does not reopen it every
// 30 s).
func TestServe_AnswersSyncStep1AndEchoesAwareness(t *testing.T) {
	store := newFakeStore()
	stored := syncMsg(syncUpdate, []byte{0x07})
	_ = store.AppendUpdate(context.Background(), "doc1", stored)
	c, stop := serveHub(t, NewHub(store))
	defer stop()
	defer c.CloseNow()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	aw := awarenessMsg([]byte{0x01, 0x02})
	if err := c.Write(ctx, websocket.MessageBinary, syncMsg(syncStep1, []byte{0x00})); err != nil {
		t.Fatal(err)
	}
	if err := c.Write(ctx, websocket.MessageBinary, aw); err != nil {
		t.Fatal(err)
	}
	want := [][]byte{stored, syncDone, aw}
	for i, w := range want {
		_, got, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		if string(got) != string(w) {
			t.Fatalf("message %d = %v, want %v", i, got, w)
		}
	}
}
