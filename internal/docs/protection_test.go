package docs

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestValidProtection(t *testing.T) {
	for _, m := range []string{"", "readOnly", "comments", "trackedChanges", "forms"} {
		if !ValidProtection(m) {
			t.Errorf("%q should be valid", m)
		}
	}
	for _, m := range []string{"readonly", "none", "x"} {
		if ValidProtection(m) {
			t.Errorf("%q should be invalid", m)
		}
	}
}

func TestProtectionGate_CachesAndKeepsLastOnError(t *testing.T) {
	var calls atomic.Int32
	mode := "readOnly"
	var fail bool
	g := &ProtectionGate{TTL: time.Second, Load: func() (string, error) {
		calls.Add(1)
		if fail {
			return "", errors.New("db down")
		}
		return mode, nil
	}}
	t0 := time.Unix(1000, 0)
	if !g.ReadOnly(t0) || !g.ReadOnly(t0.Add(500*time.Millisecond)) {
		t.Fatal("want read-only")
	}
	if calls.Load() != 1 {
		t.Fatalf("loads = %d, want 1 (cached)", calls.Load())
	}
	mode = ""
	if g.ReadOnly(t0.Add(2 * time.Second)) {
		t.Fatal("protection removed: want writable after the TTL")
	}
	mode, fail = "readOnly", true
	if g.ReadOnly(t0.Add(4 * time.Second)) {
		t.Fatal("a failed lookup keeps the last known mode")
	}
}

// ServeFunc re-checks write access per message: data updates are dropped
// while the check says no and stored again once it says yes.
func TestServeFunc_DropsWritesWhileNotAllowed(t *testing.T) {
	store := newFakeStore()
	h := NewHub(store)
	var allowed atomic.Bool
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeFunc(w, r, "doc1", allowed.Load)
	}))
	defer ts.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	send := func(b byte) {
		if err := c.Write(ctx, websocket.MessageBinary, syncMsg(syncUpdate, []byte{b})); err != nil {
			t.Fatal(err)
		}
	}
	waitCount := func(want int) {
		deadline := time.Now().Add(2 * time.Second)
		for store.count("doc1") != want {
			if time.Now().After(deadline) {
				t.Fatalf("stored %d updates, want %d", store.count("doc1"), want)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	send(1)
	time.Sleep(100 * time.Millisecond)
	waitCount(0)
	allowed.Store(true)
	send(2)
	waitCount(1)
	allowed.Store(false)
	send(3)
	time.Sleep(100 * time.Millisecond)
	waitCount(1)
}
