package sheets

import (
	"bytes"
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Collaboration for sheets is a simple op broadcast: FortuneSheet emits change
// operations (onOp); we relay them to the other clients editing the same sheet
// (applyOp). Durability + late-joiner state come from the autosaved workbook
// (SaveSheet / GetSheet), so the hub itself keeps no state — it just broadcasts.

const readLimit = 8 << 20

type peer struct {
	out chan []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
}

// Hub relays op messages between peers editing the same sheet.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

// NewHub constructs a broadcast Hub.
func NewHub() *Hub { return &Hub{rooms: map[string]*room{}} }

func (h *Hub) roomFor(id string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[id]
	if !ok {
		r = &room{peers: map[*peer]struct{}{}}
		h.rooms[id] = r
	}
	return r
}

func (h *Hub) add(id string, p *peer) *room {
	r := h.roomFor(id)
	r.mu.Lock()
	r.peers[p] = struct{}{}
	r.mu.Unlock()
	return r
}

func (h *Hub) remove(id string, r *room, p *peer) {
	r.mu.Lock()
	delete(r.peers, p)
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[id]; ok && cur == r {
			delete(h.rooms, id)
		}
		h.mu.Unlock()
	}
}

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
		select {
		case p.out <- msg:
		default:
		}
	}
}

// isPresence reports whether a client message is an ephemeral presence/cursor
// update (a JSON object with "type":"presence") rather than a document-mutating
// op (a JSON array of FortuneSheet ops). Read-only viewers may still broadcast
// presence; their ops are dropped.
func isPresence(msg []byte) bool {
	t := bytes.TrimLeft(msg, " \t\r\n")
	return len(t) > 0 && t[0] == '{' && bytes.Contains(t, []byte(`"presence"`))
}

// Serve runs the read/write loops for one client connected to sheetID. Caller
// must verify access first. When canWrite is false (a viewer/commenter grant),
// inbound document-mutating ops are dropped server-side; presence still relays.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, sheetID string, canWrite bool) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)

	ctx := r.Context()
	self := &peer{out: make(chan []byte, 256)}
	room := h.add(sheetID, self)
	defer h.remove(sheetID, room, self)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-self.out:
				wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				err := c.Write(wctx, websocket.MessageText, msg)
				cancel()
				if err != nil {
					return
				}
			}
		}
	}()

	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		if typ != websocket.MessageText {
			continue
		}
		// Read-only viewers may not mutate the sheet; relay only presence.
		if !canWrite && !isPresence(data) {
			continue
		}
		room.broadcast(self, data)
	}
	<-done
}
