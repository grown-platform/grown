// Package gamerooms is a lightweight, game-agnostic realtime relay: players
// join a room by a short code (shared via link), optionally protected by a
// password, and the hub broadcasts every JSON message to the other players in
// the room. The game logic lives entirely in the client — the hub only relays
// messages and tracks presence — so the same backend serves any multiplayer
// game. Rooms are public (no workspace account required) and ephemeral.
package gamerooms

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	maxRooms        = 5000    // global cap to bound memory
	maxPeersPerRoom = 16      // sane per-room cap
	readLimit       = 1 << 20 // 1 MiB per message
)

type peer struct {
	id   string
	name string
	out  chan []byte
}

type room struct {
	mu       sync.Mutex
	password string
	peers    map[string]*peer
	game     string    // display name, for the public lobby
	listed   bool      // discoverable in the open-games lobby
	created  time.Time // for lobby age display
}

// RoomInfo is a public-lobby summary of an open room.
type RoomInfo struct {
	Code        string `json:"code"`
	Game        string `json:"game"`
	Players     int    `json:"players"`
	HasPassword bool   `json:"has_password"`
	AgeSec      int64  `json:"age_sec"`
}

// Hub holds all active rooms.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

// NewHub constructs a Hub.
func NewHub() *Hub { return &Hub{rooms: map[string]*room{}} }

// join resolves (creating if new) the room for code. Returns ok=false when the
// room exists with a different password, or the room cap is hit.
func (h *Hub) join(code, password, game string, listed bool) (*room, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[code]
	if !ok {
		if len(h.rooms) >= maxRooms {
			return nil, false
		}
		r = &room{password: password, peers: map[string]*peer{}, game: game, listed: listed, created: time.Now()}
		h.rooms[code] = r
		return r, true
	}
	if r.password != password {
		return nil, false
	}
	return r, true
}

// List returns open, discoverable rooms (someone waiting, not full) for the
// public lobby so players on the same instance can find a game without a link.
func (h *Hub) List() []RoomInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]RoomInfo, 0, len(h.rooms))
	for code, r := range h.rooms {
		r.mu.Lock()
		n := len(r.peers)
		info := RoomInfo{Code: code, Game: r.game, Players: n, HasPassword: r.password != "", AgeSec: int64(time.Since(r.created).Seconds())}
		listed := r.listed
		r.mu.Unlock()
		if listed && n >= 1 && n < maxPeersPerRoom {
			out = append(out, info)
		}
	}
	return out
}

func (h *Hub) cleanup(code string, r *room) {
	r.mu.Lock()
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[code]; ok && cur == r {
			delete(h.rooms, code)
		}
		h.mu.Unlock()
	}
}

// RoomExists reports whether a room is currently active.
func (h *Hub) RoomExists(code string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.rooms[code]
	return ok
}

// PasswordOK reports whether code is free (new room) or matches the password.
func (h *Hub) PasswordOK(code, password string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[code]
	if !ok {
		return true
	}
	return r.password == password
}

// Serve runs the relay loop for one connected player. The caller has already
// validated the password.
func (h *Hub) Serve(w http.ResponseWriter, req *http.Request, code, password, peerID, name, game string, listed bool) {
	cr, ok := h.join(code, password, game, listed)
	if !ok {
		http.Error(w, "room full or password mismatch", http.StatusForbidden)
		return
	}
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)
	ctx := req.Context()

	self := &peer{id: peerID, name: name, out: make(chan []byte, 64)}

	cr.mu.Lock()
	if len(cr.peers) >= maxPeersPerRoom {
		cr.mu.Unlock()
		_ = c.Close(websocket.StatusTryAgainLater, "room full")
		h.cleanup(code, cr)
		return
	}
	cr.peers[peerID] = self
	cr.mu.Unlock()

	defer func() {
		cr.mu.Lock()
		delete(cr.peers, peerID)
		cr.mu.Unlock()
		h.broadcast(cr, self, map[string]any{"type": "leave", "from": peerID, "name": name})
		h.cleanup(code, cr)
	}()

	// Send the joiner the current roster, then announce the join to others.
	h.sendRoster(cr, self)
	h.broadcast(cr, self, map[string]any{"type": "join", "from": peerID, "name": name})

	// Write loop.
	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-self.out:
				if !ok {
					return
				}
				wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
				werr := c.Write(wctx, websocket.MessageText, msg)
				cancel()
				if werr != nil {
					return
				}
			}
		}
	}()

	// Read loop — relay every message to the rest of the room.
	for {
		typ, data, rerr := c.Read(ctx)
		if rerr != nil {
			break
		}
		if typ != websocket.MessageText {
			continue
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		msg["from"] = peerID
		msg["name"] = name
		h.broadcast(cr, self, msg)
	}
	<-writeDone
}

func (h *Hub) sendRoster(cr *room, to *peer) {
	cr.mu.Lock()
	peers := make([]map[string]string, 0, len(cr.peers))
	for _, p := range cr.peers {
		peers = append(peers, map[string]string{"id": p.id, "name": p.name})
	}
	cr.mu.Unlock()
	out, err := json.Marshal(map[string]any{"type": "roster", "peers": peers, "you": to.id})
	if err != nil {
		return
	}
	select {
	case to.out <- out:
	default:
	}
}

func (h *Hub) broadcast(cr *room, from *peer, msg map[string]any) {
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	cr.mu.Lock()
	targets := make([]*peer, 0, len(cr.peers))
	for _, p := range cr.peers {
		if p != from {
			targets = append(targets, p)
		}
	}
	cr.mu.Unlock()
	for _, t := range targets {
		select {
		case t.out <- out:
		default:
		}
	}
}
