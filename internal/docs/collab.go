package docs

import (
	"context"
	"encoding/binary"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Collaboration transport.
//
// Clients use the Yjs `y-websocket` provider, which speaks the y-protocols
// framing: each binary message begins with an unsigned-varint message type.
//
//	messageSync(0)      then a sync sub-type: syncStep1(0) | syncStep2(1) | update(2)
//	messageAwareness(1) ephemeral presence/cursor state
//	queryAwareness(3)   request for awareness state
//
// We do NOT run Yjs on the server. Instead the hub is a relay with persistence:
//   - every message is broadcast to the other peers in the same document room;
//   - sync messages that carry data (syncStep2 / update) are appended to the
//     update log so a later, solo client can be brought current by replay;
//   - on join we replay the stored updates to the newcomer.
//
// Yjs updates are CRDT-commutative and idempotent, so relaying opaque messages
// plus replaying the stored data updates converges every client without the
// server understanding document internals.
const (
	messageSync      = 0
	messageAwareness = 1

	syncStep1  = 0
	syncStep2  = 1
	syncUpdate = 2
)

// readLimit bounds a single inbound message. A first sync of a large document
// can be sizable; 32 MiB is generous for MVP.
const readLimit = 32 << 20

// updateStore is the persistence port the hub needs. *Repository satisfies it.
type updateStore interface {
	AppendUpdate(ctx context.Context, docID string, update []byte) error
	Updates(ctx context.Context, docID string) ([][]byte, error)
}

// peer is one connected client. Outbound messages are queued on out and drained
// by the connection's writer.
type peer struct {
	out chan []byte
}

// room holds the peers currently connected to a single document.
type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
}

// Hub manages document rooms and relays/persists collaboration messages.
type Hub struct {
	store updateStore

	mu    sync.Mutex
	rooms map[string]*room
}

// NewHub constructs a Hub backed by the given update store.
func NewHub(store updateStore) *Hub {
	return &Hub{store: store, rooms: map[string]*room{}}
}

func (h *Hub) roomFor(docID string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[docID]
	if !ok {
		r = &room{peers: map[*peer]struct{}{}}
		h.rooms[docID] = r
	}
	return r
}

// addPeer registers p in docID's room (creating it if needed) and returns the room.
func (h *Hub) addPeer(docID string, p *peer) *room {
	r := h.roomFor(docID)
	r.mu.Lock()
	r.peers[p] = struct{}{}
	r.mu.Unlock()
	return r
}

// removePeer removes p from r and drops the room from the hub once empty.
func (h *Hub) removePeer(docID string, r *room, p *peer) {
	r.mu.Lock()
	delete(r.peers, p)
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[docID]; ok && cur == r {
			delete(h.rooms, docID)
		}
		h.mu.Unlock()
	}
}

// broadcast queues msg to every peer in r except the sender.
func (r *room) broadcast(from *peer, msg []byte) {
	r.mu.Lock()
	targets := make([]*peer, 0, len(r.peers))
	for p := range r.peers {
		if p != from {
			targets = append(targets, p)
		}
	}
	r.mu.Unlock()
	for _, p := range targets {
		p.enqueue(msg)
	}
}

// enqueue appends msg to the peer's outbound queue, dropping it if the queue is
// full (a slow/dead client must not block the hub).
func (p *peer) enqueue(msg []byte) {
	select {
	case p.out <- msg:
	default:
	}
}

// route relays a single inbound message from `from` to the rest of the room and
// persists it if it carries document data.
func (h *Hub) route(ctx context.Context, docID string, r *room, from *peer, msg []byte) {
	r.broadcast(from, msg)
	if carriesData(msg) {
		if err := h.store.AppendUpdate(ctx, docID, msg); err != nil {
			slog.Error("docs: persist update", "doc", docID, "err", err)
		}
	}
}

// replay sends the document's stored data updates to a freshly joined peer so it
// converges even when no other peer is connected.
func (h *Hub) replay(ctx context.Context, docID string, p *peer) error {
	updates, err := h.store.Updates(ctx, docID)
	if err != nil {
		return err
	}
	for _, u := range updates {
		p.enqueue(u)
	}
	return nil
}

// carriesData reports whether a y-protocols message should be persisted: a sync
// message whose sub-type is syncStep2 or update. Sync-step1 (a state-vector
// query) and awareness (ephemeral) are not persisted.
func carriesData(msg []byte) bool {
	mt, n := binary.Uvarint(msg)
	if n <= 0 || mt != messageSync {
		return false
	}
	st, n2 := binary.Uvarint(msg[n:])
	if n2 <= 0 {
		return false
	}
	return st == syncStep2 || st == syncUpdate
}

// Serve upgrades an HTTP request to a WebSocket and runs the read/write loops
// for one client connected to docID. Caller is responsible for auth + verifying
// access. When canWrite is false (e.g. a viewer share), inbound document
// mutations are dropped — the client still receives updates and may broadcast
// awareness (cursor) state.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, docID string, canWrite bool) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // same-origin behind auth middleware; localtest.me hosts
	})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)

	ctx := r.Context()
	self := &peer{out: make(chan []byte, 256)}
	room := h.addPeer(docID, self)
	defer h.removePeer(docID, room, self)

	if err := h.replay(ctx, docID, self); err != nil {
		slog.Error("docs: replay", "doc", docID, "err", err)
	}

	// Writer: drain the outbound queue to the socket.
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-self.out:
				wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				err := c.Write(wctx, websocket.MessageBinary, msg)
				cancel()
				if err != nil {
					return
				}
			}
		}
	}()

	// Reader: relay inbound messages until the client disconnects.
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		if typ != websocket.MessageBinary {
			continue
		}
		// Read-only viewers may not mutate the document; drop their data
		// updates server-side regardless of what the client sends.
		if !canWrite && carriesData(data) {
			continue
		}
		h.route(ctx, docID, room, self, data)
	}
	<-writerDone
}
