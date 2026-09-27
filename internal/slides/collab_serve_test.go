package slides

// collab_serve_test.go drives Hub.Serve over real WebSockets (httptest) and
// covers the M10 hardening: the handler must return when its client leaves,
// ops are stamped with a room sequence number, a (re)connecting client
// catches up from the room log without the bounded queue dropping anything,
// stale ops on an element someone else changed are rejected rather than
// relayed, and resent ops are de-duplicated.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type testSrv struct {
	h  *Hub
	ts *httptest.Server
}

func newTestSrv(t *testing.T, canWrite bool) *testSrv {
	t.Helper()
	h := NewHub()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Serve(w, r, "deck1", canWrite)
	}))
	t.Cleanup(ts.Close)
	return &testSrv{h: h, ts: ts}
}

// conn is a test client: a read pump feeds `in`, so a timed-out wait does
// not close the socket (a Read cancelled by its context does).
type conn struct {
	*websocket.Conn
	in chan []byte
}

func (s *testSrv) dial(t *testing.T) *conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.ts.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	c.SetReadLimit(readLimit)
	t.Cleanup(func() { c.CloseNow() })
	cc := &conn{Conn: c, in: make(chan []byte, 4096)}
	go func() {
		defer close(cc.in)
		for {
			_, b, err := c.Read(context.Background())
			if err != nil {
				return
			}
			cc.in <- b
		}
	}()
	return cc
}

func send(t *testing.T, c *conn, v any) {
	t.Helper()
	var b []byte
	switch x := v.(type) {
	case string:
		b = []byte(x)
	default:
		var err error
		if b, err = json.Marshal(v); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("write: %v", err)
	}
}

type msg map[string]any

func recv(t *testing.T, c *conn) msg {
	t.Helper()
	var b []byte
	select {
	case x, ok := <-c.in:
		if !ok {
			t.Fatal("read: connection closed")
		}
		b = x
	case <-time.After(5 * time.Second):
		t.Fatal("read: timeout")
	}
	var m msg
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("decode %q: %v", b, err)
	}
	return m
}

// recvT reads until a message of type typ.
func recvT(t *testing.T, c *conn, typ string) msg {
	t.Helper()
	for i := 0; i < 50; i++ {
		m := recv(t, c)
		if m["t"] == typ {
			return m
		}
	}
	t.Fatalf("no %q message", typ)
	return nil
}

// expectSilence asserts nothing arrives within d.
func expectSilence(t *testing.T, c *conn, d time.Duration) {
	t.Helper()
	select {
	case b := <-c.in:
		t.Fatalf("unexpected message %s", b)
	case <-time.After(d):
	}
}

func num(m msg, k string) int {
	f, _ := m[k].(float64)
	return int(f)
}

// hello sends the handshake and consumes welcome … synced, returning the
// welcome and the replayed ops.
func hello(t *testing.T, c *conn, cid string, since int, epoch string) (msg, []msg) {
	t.Helper()
	send(t, c, msg{"t": "hello", "cid": cid, "since": since, "epoch": epoch})
	w := recv(t, c)
	if w["t"] != "welcome" {
		t.Fatalf("first reply = %v, want welcome", w)
	}
	var ops []msg
	for {
		m := recv(t, c)
		if m["t"] == "synced" {
			return w, ops
		}
		ops = append(ops, m)
	}
}

func upsert(id string, base int, el string) msg {
	return msg{"t": "upsert", "id": id, "base": base, "si": "s1", "el": msg{"id": el, "x": base}}
}

func waitRoom(t *testing.T, h *Hub, want bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		h.mu.Lock()
		_, ok := h.rooms["deck1"]
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

// A lone client closing its socket must end Serve (and leave the room). The
// writer used to wait on the request context, which is not cancelled for a
// hijacked connection until the handler returns: the handler leaked.
func TestServe_ReturnsAndLeavesRoomWhenClientCloses(t *testing.T) {
	s := newTestSrv(t, true)
	c := s.dial(t)
	send(t, c, msg{"t": "presence", "p": msg{"userId": "u"}})
	waitRoom(t, s.h, true)
	c.Close(websocket.StatusNormalClosure, "bye")
	waitRoom(t, s.h, false)
}

func TestServe_StampsOpsAndAcksSender(t *testing.T) {
	s := newTestSrv(t, true)
	a, b := s.dial(t), s.dial(t)
	hello(t, a, "A", 0, "")
	hello(t, b, "B", 0, "")

	send(t, a, upsert("a1", 0, "x"))
	ack := recvT(t, a, "ack")
	if ack["id"] != "a1" || num(ack, "seq") != 1 {
		t.Fatalf("ack = %v", ack)
	}
	got := recvT(t, b, "upsert")
	if num(got, "seq") != 1 || got["cid"] != "A" || got["si"] != "s1" {
		t.Fatalf("relayed = %v", got)
	}
}

// Reconnect catch-up: a client that saw up to seq 1 gets exactly the ops
// after it, in order, before "synced".
func TestServe_HelloReplaysMissedOps(t *testing.T) {
	s := newTestSrv(t, true)
	a := s.dial(t)
	w, _ := hello(t, a, "A", 0, "")
	epoch, _ := w["epoch"].(string)
	if epoch == "" {
		t.Fatal("welcome has no epoch")
	}
	for i := 1; i <= 3; i++ {
		send(t, a, upsert(fmt.Sprintf("a%d", i), i-1, fmt.Sprintf("e%d", i)))
		recvT(t, a, "ack")
	}

	b := s.dial(t)
	w2, ops := hello(t, b, "B", 1, epoch)
	if w2["fresh"] == true {
		t.Fatalf("same-epoch catch-up flagged fresh: %v", w2)
	}
	if len(ops) != 2 || num(ops[0], "seq") != 2 || num(ops[1], "seq") != 3 {
		t.Fatalf("replay = %v, want seq 2,3", ops)
	}
	if num(w2, "seq") != 3 {
		t.Fatalf("welcome seq = %v", w2["seq"])
	}
}

// The room log routinely holds more ops than a peer's queue (256): the
// catch-up must deliver every one of them rather than drop the overflow.
func TestServe_ReplayIsNotBoundedByTheQueue(t *testing.T) {
	s := newTestSrv(t, true)
	a := s.dial(t)
	hello(t, a, "A", 0, "")
	const n = 1000
	for i := 0; i < n; i++ {
		send(t, a, upsert(fmt.Sprintf("a%d", i), i, "x"))
	}
	for i := 0; i < n; i++ {
		recvT(t, a, "ack")
	}
	b := s.dial(t)
	w, ops := hello(t, b, "B", 0, "")
	if w["fresh"] != true {
		t.Fatalf("new client not fresh: %v", w)
	}
	if len(ops) != n {
		t.Fatalf("replayed %d ops, want %d", len(ops), n)
	}
}

// A different epoch (the room was torn down and recreated) or a gap the log
// no longer covers means the client must reload the snapshot: fresh.
func TestServe_EpochMismatchIsFresh(t *testing.T) {
	s := newTestSrv(t, true)
	a := s.dial(t)
	hello(t, a, "A", 0, "")
	send(t, a, upsert("a1", 0, "x"))
	recvT(t, a, "ack")
	b := s.dial(t)
	w, ops := hello(t, b, "B", 7, "old-epoch")
	if w["fresh"] != true || len(ops) != 1 {
		t.Fatalf("welcome %v ops %v", w, ops)
	}
}

// Stale-op rejection: B changes element x without having seen A's change to
// it (base 0 < A's seq 1): the op is rejected, not relayed, so B cannot
// clobber A. An op on another element, or one based on seq 1, goes through.
func TestServe_RejectsStaleOpOnSameElement(t *testing.T) {
	s := newTestSrv(t, true)
	a, b := s.dial(t), s.dial(t)
	hello(t, a, "A", 0, "")
	hello(t, b, "B", 0, "")

	send(t, a, upsert("a1", 0, "x"))
	recvT(t, a, "ack")
	recvT(t, b, "upsert")

	send(t, b, upsert("b1", 0, "x"))
	rej := recvT(t, b, "reject")
	if rej["id"] != "b1" {
		t.Fatalf("reject = %v", rej)
	}
	expectSilence(t, a, 150*time.Millisecond)

	send(t, b, upsert("b2", 0, "y"))
	if ack := recvT(t, b, "ack"); ack["id"] != "b2" {
		t.Fatalf("ack = %v", ack)
	}
	send(t, b, upsert("b3", 1, "x"))
	if ack := recvT(t, b, "ack"); ack["id"] != "b3" {
		t.Fatalf("ack = %v", ack)
	}
	if got := recvT(t, a, "upsert"); got["id"] != "b2" {
		t.Fatalf("A got %v", got)
	}
}

// A whole-slide op conflicts with an element op on that slide; your own
// earlier ops never make yours stale.
func TestServe_SlideLevelAndOwnOps(t *testing.T) {
	s := newTestSrv(t, true)
	a, b := s.dial(t), s.dial(t)
	hello(t, a, "A", 0, "")
	hello(t, b, "B", 0, "")
	send(t, a, upsert("a1", 0, "x"))
	recvT(t, a, "ack")
	send(t, a, upsert("a2", 0, "x"))
	if ack := recvT(t, a, "ack"); ack["id"] != "a2" {
		t.Fatalf("own op rejected: %v", ack)
	}
	send(t, b, msg{"t": "reorder", "id": "b1", "base": 0, "si": "s1", "ids": []string{"x"}})
	recvT(t, b, "reject")
	send(t, b, msg{"t": "reorder", "id": "b2", "base": 0, "si": "other", "ids": []string{"z"}})
	recvT(t, b, "ack")
}

// A resent op (the ack was lost with the connection) is acknowledged with
// its original seq and not relayed or applied twice.
func TestServe_DedupsResentOp(t *testing.T) {
	s := newTestSrv(t, true)
	a, b := s.dial(t), s.dial(t)
	hello(t, a, "A", 0, "")
	hello(t, b, "B", 0, "")
	send(t, a, upsert("a1", 0, "x"))
	recvT(t, a, "ack")
	recvT(t, b, "upsert")
	send(t, a, upsert("a1", 0, "x"))
	ack := recvT(t, a, "ack")
	if num(ack, "seq") != 1 {
		t.Fatalf("dup ack = %v", ack)
	}
	expectSilence(t, b, 150*time.Millisecond)
}

// Read-only peers get the catch-up but their ops are dropped.
func TestServe_ReadOnlyCatchUpButNoOps(t *testing.T) {
	h := NewHub()
	var writable = true
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.Serve(w, r, "deck1", writable)
	}))
	defer ts.Close()
	s := &testSrv{h: h, ts: ts}
	a := s.dial(t)
	hello(t, a, "A", 0, "")
	send(t, a, upsert("a1", 0, "x"))
	recvT(t, a, "ack")
	writable = false
	v := s.dial(t)
	_, ops := hello(t, v, "V", 0, "")
	if len(ops) != 1 {
		t.Fatalf("viewer replay = %v", ops)
	}
	send(t, v, upsert("v1", 1, "y"))
	expectSilence(t, a, 150*time.Millisecond)
	send(t, v, msg{"t": "presence", "p": msg{"userId": "v"}})
	if got := recv(t, a); got["t"] != "presence" {
		t.Fatalf("A got %v", got)
	}
}

// A version restore replaces the stored deck: the log before it is obsolete,
// so later joiners must not replay it (they would re-apply pre-restore ops,
// or reload forever on the restore message).
func TestServe_VersionRestoreClearsLog(t *testing.T) {
	s := newTestSrv(t, true)
	a := s.dial(t)
	w, _ := hello(t, a, "A", 0, "")
	send(t, a, upsert("a1", 0, "x"))
	recvT(t, a, "ack")
	send(t, a, msg{"t": "versionRestored", "type": "versionRestored"})
	b := s.dial(t)
	w2, ops := hello(t, b, "B", 1, w["epoch"].(string))
	if len(ops) != 0 || w2["fresh"] != true {
		t.Fatalf("after restore: welcome %v replay %v", w2, ops)
	}
}

// Legacy clients (no hello, no id/base) keep working: their ops relay.
func TestServe_LegacyClientsStillRelay(t *testing.T) {
	s := newTestSrv(t, true)
	a, b := s.dial(t), s.dial(t)
	send(t, a, msg{"t": "presence", "p": msg{"userId": "a"}})
	send(t, b, msg{"t": "presence", "p": msg{"userId": "b"}})
	recvT(t, a, "presence")
	send(t, a, msg{"t": "upsert", "si": "s1", "el": msg{"id": "x"}})
	got := recvT(t, b, "upsert")
	if num(got, "seq") != 1 {
		t.Fatalf("legacy op = %v", got)
	}
}
