package docs

import (
	"context"
	"encoding/binary"
	"sync"
	"testing"
)

// --- y-protocols message helpers ---

func varint(x uint64) []byte {
	b := make([]byte, binary.MaxVarintLen64)
	n := binary.PutUvarint(b, x)
	return b[:n]
}

func syncMsg(sub int, payload []byte) []byte {
	out := append([]byte{}, varint(messageSync)...)
	out = append(out, varint(uint64(sub))...)
	return append(out, payload...)
}

func awarenessMsg(payload []byte) []byte {
	return append(append([]byte{}, varint(messageAwareness)...), payload...)
}

// --- fake store ---

type fakeStore struct {
	mu      sync.Mutex
	updates map[string][][]byte
}

func newFakeStore() *fakeStore { return &fakeStore{updates: map[string][][]byte{}} }

func (f *fakeStore) AppendUpdate(_ context.Context, docID string, u []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := append([]byte{}, u...)
	f.updates[docID] = append(f.updates[docID], cp)
	return nil
}

func (f *fakeStore) Updates(_ context.Context, docID string) ([][]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]byte{}, f.updates[docID]...), nil
}

func (f *fakeStore) count(docID string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.updates[docID])
}

// drain returns all currently-queued messages on a peer without blocking.
func drain(p *peer) [][]byte {
	var out [][]byte
	for {
		select {
		case m := <-p.out:
			out = append(out, m)
		default:
			return out
		}
	}
}

func TestCarriesData(t *testing.T) {
	cases := []struct {
		name string
		msg  []byte
		want bool
	}{
		{"update", syncMsg(syncUpdate, []byte{0xaa}), true},
		{"syncStep2", syncMsg(syncStep2, []byte{0xbb}), true},
		{"syncStep1", syncMsg(syncStep1, []byte{0xcc}), false},
		{"awareness", awarenessMsg([]byte{0xdd}), false},
		{"empty", []byte{}, false},
	}
	for _, c := range cases {
		if got := carriesData(c.msg); got != c.want {
			t.Errorf("%s: carriesData = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestRoute_BroadcastsToOthersAndPersistsData(t *testing.T) {
	store := newFakeStore()
	h := NewHub(store)
	a := &peer{out: make(chan []byte, 8)}
	b := &peer{out: make(chan []byte, 8)}
	r := h.addPeer("doc1", a)
	h.addPeer("doc1", b)

	msg := syncMsg(syncUpdate, []byte{0x01, 0x02})
	h.route(context.Background(), "doc1", r, a, msg)

	if got := drain(a); len(got) != 0 {
		t.Errorf("sender should not receive its own message, got %d", len(got))
	}
	gotB := drain(b)
	if len(gotB) != 1 || string(gotB[0]) != string(msg) {
		t.Errorf("peer B should receive the message, got %v", gotB)
	}
	if store.count("doc1") != 1 {
		t.Errorf("data update should be persisted once, got %d", store.count("doc1"))
	}
}

func TestRoute_AwarenessBroadcastNotPersisted(t *testing.T) {
	store := newFakeStore()
	h := NewHub(store)
	a := &peer{out: make(chan []byte, 8)}
	b := &peer{out: make(chan []byte, 8)}
	r := h.addPeer("doc1", a)
	h.addPeer("doc1", b)

	h.route(context.Background(), "doc1", r, a, awarenessMsg([]byte{0x09}))

	if len(drain(b)) != 1 {
		t.Errorf("awareness should broadcast to peer B")
	}
	if store.count("doc1") != 0 {
		t.Errorf("awareness must not be persisted, got %d", store.count("doc1"))
	}
}

func TestRoute_SyncStep1NotPersisted(t *testing.T) {
	store := newFakeStore()
	h := NewHub(store)
	a := &peer{out: make(chan []byte, 8)}
	r := h.addPeer("doc1", a)

	h.route(context.Background(), "doc1", r, a, syncMsg(syncStep1, []byte{0x00}))
	if store.count("doc1") != 0 {
		t.Errorf("syncStep1 (query) must not be persisted")
	}
}

func TestReplay_SendsStoredUpdatesToNewPeer(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	_ = store.AppendUpdate(ctx, "doc1", syncMsg(syncUpdate, []byte{0x01}))
	_ = store.AppendUpdate(ctx, "doc1", syncMsg(syncUpdate, []byte{0x02}))
	h := NewHub(store)

	p := &peer{out: make(chan []byte, 8)}
	if err := h.replay(ctx, "doc1", p); err != nil {
		t.Fatalf("replay: %v", err)
	}
	got := drain(p)
	if len(got) != 2 {
		t.Fatalf("expected 2 replayed updates, got %d", len(got))
	}
}

func TestRemovePeer_DropsEmptyRoom(t *testing.T) {
	h := NewHub(newFakeStore())
	p := &peer{out: make(chan []byte, 1)}
	r := h.addPeer("doc1", p)
	h.removePeer("doc1", r, p)

	h.mu.Lock()
	_, exists := h.rooms["doc1"]
	h.mu.Unlock()
	if exists {
		t.Errorf("empty room should be removed from hub")
	}
}
