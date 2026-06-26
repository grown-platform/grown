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
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const (
	maxRooms        = 5000    // global cap to bound memory
	maxPeersPerRoom = 16      // sane per-room cap
	readLimit       = 1 << 20 // 1 MiB per message
)

type peer struct {
	id       string
	name     string
	seq      int // stable join order within the room (0 = room creator / host)
	out      chan []byte
	joinedAt time.Time
	// kick is closed by an admin Kick to force this peer's relay loop to exit
	// (the connection is then closed by the deferred CloseNow in Serve). Guard
	// with kickOnce so a double-kick can't double-close.
	kick     chan struct{}
	kickOnce sync.Once
}

func (p *peer) doKick() { p.kickOnce.Do(func() { close(p.kick) }) }

type room struct {
	mu       sync.Mutex
	password string
	peers    map[string]*peer
	nextSeq  int       // monotonic join counter -> peer.seq (stable seat order)
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

	// store persists the enable/disable flag + audit trail. May be nil (no DB),
	// in which case multiplayer is always enabled and audit is a no-op.
	store *Store
	// enabled is the cached global on/off flag (loaded from store on boot, kept
	// in sync by SetEnabled). 1 = enabled, 0 = disabled. When disabled, new WS
	// joins are rejected and the public lobby (List) returns empty.
	enabled atomic.Bool
}

// NewHub constructs a Hub. store may be nil (multiplayer then always enabled,
// audit disabled). The enabled flag is seeded from the store.
func NewHub(store *Store) *Hub {
	h := &Hub{rooms: map[string]*room{}, store: store}
	h.enabled.Store(store.LoadSettings(context.Background()).Enabled)
	return h
}

// Enabled reports whether multiplayer is currently enabled.
func (h *Hub) Enabled() bool { return h.enabled.Load() }

// SetEnabled flips the global multiplayer flag, persists it, and records an
// audit event with the acting admin. Existing connections are left to drain
// (they are NOT force-closed) — only NEW joins are blocked while disabled.
func (h *Hub) SetEnabled(ctx context.Context, enabled bool, actorEmail string) error {
	if err := h.store.SetEnabled(ctx, enabled, actorEmail); err != nil {
		return err
	}
	h.enabled.Store(enabled)
	h.store.LogEvent(AuditEvent{
		Event:      "toggled",
		ActorEmail: actorEmail,
		Detail:     map[string]any{"enabled": enabled},
	})
	return nil
}

// join resolves (creating if new) the room for code. Returns ok=false when the
// room exists with a different password, or the room cap is hit. created
// reports whether this call created a brand-new room (for audit).
func (h *Hub) join(code, password, game string, listed bool) (r *room, created, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, exists := h.rooms[code]
	if !exists {
		if len(h.rooms) >= maxRooms {
			return nil, false, false
		}
		r = &room{password: password, peers: map[string]*peer{}, game: game, listed: listed, created: time.Now()}
		h.rooms[code] = r
		return r, true, true
	}
	if r.password != password {
		return nil, false, false
	}
	return r, false, true
}

// List returns open, discoverable rooms (someone waiting, not full) for the
// public lobby so players on the same instance can find a game without a link.
func (h *Hub) List() []RoomInfo {
	// When multiplayer is disabled the public lobby is empty (the relay is off).
	if !h.enabled.Load() {
		return []RoomInfo{}
	}
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

// SessionPeer is one connected player in the admin sessions monitor.
type SessionPeer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	JoinedAt string `json:"joined_at"` // RFC3339
}

// SessionInfo is the detailed, admin-only view of one live room.
type SessionInfo struct {
	Code        string        `json:"code"`
	Game        string        `json:"game"`
	Players     []SessionPeer `json:"players"`
	PlayerCount int           `json:"player_count"`
	HasPassword bool          `json:"has_password"`
	Listed      bool          `json:"listed"`
	CreatedAt   string        `json:"created_at"` // RFC3339
	AgeSec      int64         `json:"age_sec"`
}

// Sessions returns the full live state of every active room (admin monitor).
// Unlike List, this is not filtered by listed/full and ignores the enabled
// flag, so admins can still see (and kick) sessions that are draining after a
// disable.
func (h *Hub) Sessions() []SessionInfo {
	h.mu.Lock()
	rooms := make(map[string]*room, len(h.rooms))
	for code, r := range h.rooms {
		rooms[code] = r
	}
	h.mu.Unlock()

	out := make([]SessionInfo, 0, len(rooms))
	for code, r := range rooms {
		r.mu.Lock()
		players := make([]SessionPeer, 0, len(r.peers))
		for _, p := range r.peers {
			players = append(players, SessionPeer{ID: p.id, Name: p.name, JoinedAt: p.joinedAt.UTC().Format(time.RFC3339)})
		}
		info := SessionInfo{
			Code:        code,
			Game:        r.game,
			Players:     players,
			PlayerCount: len(players),
			HasPassword: r.password != "",
			Listed:      r.listed,
			CreatedAt:   r.created.UTC().Format(time.RFC3339),
			AgeSec:      int64(time.Since(r.created).Seconds()),
		}
		r.mu.Unlock()
		out = append(out, info)
	}
	return out
}

// KickRoom force-closes every peer in a room and removes it. Returns the number
// of peers kicked and whether the room existed.
func (h *Hub) KickRoom(code, actorEmail string) (int, bool) {
	h.mu.Lock()
	r, ok := h.rooms[code]
	if ok {
		delete(h.rooms, code)
	}
	h.mu.Unlock()
	if !ok {
		return 0, false
	}
	r.mu.Lock()
	game := r.game
	peers := make([]*peer, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	r.mu.Unlock()
	for _, p := range peers {
		p.doKick()
	}
	h.store.LogEvent(AuditEvent{
		Event: "kicked", Room: code, Game: game, ActorEmail: actorEmail,
		Detail: map[string]any{"scope": "room", "peers": len(peers)},
	})
	return len(peers), true
}

// KickPeer force-closes a single peer by id. Returns whether the peer was found.
// The peer's own deferred cleanup removes it from the room (and deletes the room
// if it becomes empty).
func (h *Hub) KickPeer(code, peerID, actorEmail string) bool {
	h.mu.Lock()
	r, ok := h.rooms[code]
	h.mu.Unlock()
	if !ok {
		return false
	}
	r.mu.Lock()
	p := r.peers[peerID]
	game := r.game
	r.mu.Unlock()
	if p == nil {
		return false
	}
	p.doKick()
	h.store.LogEvent(AuditEvent{
		Event: "kicked", Room: code, Game: game, PeerID: peerID, PeerName: p.name,
		ActorEmail: actorEmail, Detail: map[string]any{"scope": "peer"},
	})
	return true
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
	// Reject new connections while multiplayer is globally disabled. Existing
	// sessions are unaffected (left to drain).
	if !h.enabled.Load() {
		http.Error(w, "multiplayer disabled", http.StatusServiceUnavailable)
		return
	}
	cr, created, ok := h.join(code, password, game, listed)
	if !ok {
		http.Error(w, "room full or password mismatch", http.StatusForbidden)
		return
	}
	if created {
		h.store.LogEvent(AuditEvent{Event: "room_created", Room: code, Game: game})
	}
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)
	ctx := req.Context()

	self := &peer{id: peerID, name: name, out: make(chan []byte, 64), joinedAt: time.Now(), kick: make(chan struct{})}

	cr.mu.Lock()
	if len(cr.peers) >= maxPeersPerRoom {
		cr.mu.Unlock()
		_ = c.Close(websocket.StatusTryAgainLater, "room full")
		h.cleanup(code, cr)
		return
	}
	self.seq = cr.nextSeq
	cr.nextSeq++
	cr.peers[peerID] = self
	cr.mu.Unlock()
	h.store.LogEvent(AuditEvent{Event: "peer_joined", Room: code, Game: game, PeerID: peerID, PeerName: name})

	defer func() {
		cr.mu.Lock()
		delete(cr.peers, peerID)
		cr.mu.Unlock()
		h.broadcast(cr, self, map[string]any{"type": "leave", "from": peerID, "name": name})
		h.store.LogEvent(AuditEvent{Event: "peer_left", Room: code, Game: game, PeerID: peerID, PeerName: name})
		h.cleanup(code, cr)
	}()

	// Send the joiner the current roster, then announce the join to others.
	h.sendRoster(cr, self)
	h.broadcast(cr, self, map[string]any{"type": "join", "from": peerID, "name": name, "seq": self.seq})

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

	// Kick watcher — an admin Kick closes self.kick, which closes the socket so
	// the blocking Read below returns and the deferred cleanup runs.
	go func() {
		select {
		case <-ctx.Done():
		case <-self.kick:
			_ = c.Close(websocket.StatusPolicyViolation, "kicked by admin")
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
		// A "to" field directs the message to a single peer (private delivery,
		// e.g. dealing a hidden hand). Otherwise it broadcasts to the room.
		if toID, ok := msg["to"].(string); ok && toID != "" {
			h.sendTo(cr, toID, msg)
		} else {
			h.broadcast(cr, self, msg)
		}
	}
	<-writeDone
}

func (h *Hub) sendRoster(cr *room, to *peer) {
	cr.mu.Lock()
	peers := make([]*peer, 0, len(cr.peers))
	for _, p := range cr.peers {
		peers = append(peers, p)
	}
	cr.mu.Unlock()
	// Order by join sequence so every client agrees on seat assignment (seat =
	// index, seat 0 = room creator / host).
	sort.Slice(peers, func(i, j int) bool { return peers[i].seq < peers[j].seq })
	list := make([]map[string]any, 0, len(peers))
	for _, p := range peers {
		list = append(list, map[string]any{"id": p.id, "name": p.name, "seq": p.seq})
	}
	out, err := json.Marshal(map[string]any{"type": "roster", "peers": list, "you": to.id})
	if err != nil {
		return
	}
	select {
	case to.out <- out:
	default:
	}
}

// sendTo delivers a message to a single peer by id (private/targeted delivery).
func (h *Hub) sendTo(cr *room, toID string, msg map[string]any) {
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	cr.mu.Lock()
	target := cr.peers[toID]
	cr.mu.Unlock()
	if target == nil {
		return
	}
	select {
	case target.out <- out:
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
