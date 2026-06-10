package meet

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// SignalType enumerates the WebRTC signaling message types relayed by the hub.
type SignalType string

const (
	SignalJoin        SignalType = "join"
	SignalLeave       SignalType = "leave"
	SignalOffer       SignalType = "offer"
	SignalAnswer      SignalType = "answer"
	SignalCandidate   SignalType = "candidate"
	SignalPresence    SignalType = "presence"     // list of current peers
	SignalChat        SignalType = "chat"         // in-call text message
	SignalMediaState  SignalType = "media_state"  // audio/video mute state update
	SignalHandRaise   SignalType = "hand_raise"   // hand-raise toggle
	SignalRosterState SignalType = "roster_state" // full roster snapshot (includes states)
)

// SignalMessage is the JSON envelope relayed over the WebSocket.
type SignalMessage struct {
	Type    SignalType      `json:"type"`
	From    string          `json:"from,omitempty"`    // sender peer ID
	To      string          `json:"to,omitempty"`      // target peer ID; empty = broadcast
	Name    string          `json:"name,omitempty"`    // display name
	Peers   []PeerInfo      `json:"peers,omitempty"`   // used in "presence" / "roster_state"
	Payload json.RawMessage `json:"payload,omitempty"` // SDP or ICE candidate

	// Chat fields
	Text string `json:"text,omitempty"` // chat message body

	// Media-state fields (used in media_state and join/presence)
	AudioMuted bool `json:"audio_muted,omitempty"`
	VideoOff   bool `json:"video_off,omitempty"`
	HandRaised bool `json:"hand_raised,omitempty"`
}

// PeerInfo carries the info the client needs about a remote peer.
type PeerInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AudioMuted bool   `json:"audio_muted,omitempty"`
	VideoOff   bool   `json:"video_off,omitempty"`
	HandRaised bool   `json:"hand_raised,omitempty"`
}

// ChatMessage is an ephemeral in-call chat entry kept in the hub.
type ChatMessage struct {
	FromID   string `json:"from_id"`
	FromName string `json:"from_name"`
	Text     string `json:"text"`
	SentAt   int64  `json:"sent_at"` // Unix ms
}

const readLimit = 256 << 10 // 256 KB

type peer struct {
	id         string
	name       string
	audioMuted bool
	videoOff   bool
	handRaised bool
	out        chan []byte
}

type callRoom struct {
	mu    sync.Mutex
	peers map[string]*peer // keyed by peer id
}

// Hub manages signaling rooms for WebRTC peer-mesh calls.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*callRoom
}

// NewHub constructs a signaling Hub.
func NewHub() *Hub { return &Hub{rooms: map[string]*callRoom{}} }

func (h *Hub) getOrCreate(roomID string) *callRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[roomID]
	if !ok {
		r = &callRoom{peers: map[string]*peer{}}
		h.rooms[roomID] = r
	}
	return r
}

func (h *Hub) cleanup(roomID string, cr *callRoom) {
	cr.mu.Lock()
	empty := len(cr.peers) == 0
	cr.mu.Unlock()
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[roomID]; ok && cur == cr {
			delete(h.rooms, roomID)
		}
		h.mu.Unlock()
	}
}

// Serve runs the signaling loop for one client. Caller must verify access first.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, roomID, peerID, displayName string) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)

	ctx := r.Context()
	self := &peer{
		id:   peerID,
		name: displayName,
		out:  make(chan []byte, 128),
	}

	cr := h.getOrCreate(roomID)
	cr.mu.Lock()
	cr.peers[peerID] = self
	cr.mu.Unlock()

	defer func() {
		cr.mu.Lock()
		delete(cr.peers, peerID)
		cr.mu.Unlock()
		h.cleanup(roomID, cr)
		// Notify remaining peers of the departure.
		h.broadcast(cr, self, SignalMessage{
			Type: SignalLeave,
			From: peerID,
			Name: displayName,
		})
	}()

	// Send the joiner the current presence list first, then a full roster snapshot
	// that includes mute/camera/hand states.
	h.sendPresence(cr, self)
	h.sendRosterState(cr, self)

	// Announce join to others.
	h.broadcast(cr, self, SignalMessage{
		Type: SignalJoin,
		From: peerID,
		Name: displayName,
	})

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

	// Read loop — relay all messages.
	for {
		typ, data, rerr := c.Read(ctx)
		if rerr != nil {
			break
		}
		if typ != websocket.MessageText {
			continue
		}
		var msg SignalMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		// Stamp from field with the authenticated peer id.
		msg.From = peerID
		h.route(cr, self, msg)
	}
	<-writeDone
}

// route directs a message either to a specific peer or broadcasts it.
// Certain message types are handled specially before routing.
func (h *Hub) route(cr *callRoom, from *peer, msg SignalMessage) {
	switch msg.Type {
	case SignalMediaState:
		// Update the sender's stored state and rebroadcast the annotated message.
		cr.mu.Lock()
		from.audioMuted = msg.AudioMuted
		from.videoOff = msg.VideoOff
		cr.mu.Unlock()
		// Fall through to broadcast.

	case SignalHandRaise:
		// Update hand-raise state and rebroadcast.
		cr.mu.Lock()
		from.handRaised = msg.HandRaised
		cr.mu.Unlock()
		// Fall through to broadcast.

	case SignalChat:
		// Chat is always broadcast; no state to store (ephemeral).
		// Fall through to broadcast.
	}

	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	if msg.To != "" {
		// Unicast: forward only to the named peer.
		cr.mu.Lock()
		target, ok := cr.peers[msg.To]
		cr.mu.Unlock()
		if ok {
			select {
			case target.out <- out:
			default:
			}
		}
		return
	}
	// Broadcast: forward to every peer except sender.
	cr.mu.Lock()
	targets := make([]*peer, 0, len(cr.peers))
	for _, p := range cr.peers {
		if p != from {
			targets = append(targets, p)
		}
	}
	cr.mu.Unlock()
	for _, p := range targets {
		select {
		case p.out <- out:
		default:
		}
	}
}

// broadcast sends msg (serialized) to everyone except from. Used for join/leave.
func (h *Hub) broadcast(cr *callRoom, from *peer, msg SignalMessage) {
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
	for _, p := range targets {
		select {
		case p.out <- out:
		default:
		}
	}
}

// peerInfoFrom builds a PeerInfo snapshot from a peer (caller must hold cr.mu).
func peerInfoFrom(p *peer) PeerInfo {
	return PeerInfo{
		ID:         p.id,
		Name:       p.name,
		AudioMuted: p.audioMuted,
		VideoOff:   p.videoOff,
		HandRaised: p.handRaised,
	}
}

// sendPresence sends the current peer list only to the named peer (legacy signal type).
func (h *Hub) sendPresence(cr *callRoom, to *peer) {
	cr.mu.Lock()
	peers := make([]PeerInfo, 0, len(cr.peers))
	for _, p := range cr.peers {
		if p != to {
			peers = append(peers, peerInfoFrom(p))
		}
	}
	cr.mu.Unlock()

	msg := SignalMessage{
		Type:  SignalPresence,
		Peers: peers,
	}
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case to.out <- out:
	default:
	}
}

// sendRosterState sends a full roster snapshot (SignalRosterState) to the
// named peer. This is sent on join so the new participant immediately sees
// everyone's mute/camera/hand state.
func (h *Hub) sendRosterState(cr *callRoom, to *peer) {
	cr.mu.Lock()
	peers := make([]PeerInfo, 0, len(cr.peers))
	for _, p := range cr.peers {
		if p != to {
			peers = append(peers, peerInfoFrom(p))
		}
	}
	cr.mu.Unlock()

	msg := SignalMessage{
		Type:  SignalRosterState,
		Peers: peers,
	}
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case to.out <- out:
	default:
	}
}

// Presence returns the peer IDs currently in a room (for diagnostics).
func (h *Hub) Presence(roomID string) []string {
	h.mu.Lock()
	cr, ok := h.rooms[roomID]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	cr.mu.Lock()
	defer cr.mu.Unlock()
	ids := make([]string, 0, len(cr.peers))
	for id := range cr.peers {
		ids = append(ids, id)
	}
	return ids
}

// connectPath returns the WebSocket connect URL path for a room.
func connectPath(roomID string) string {
	return fmt.Sprintf("/api/v1/meet/rooms/%s/connect", roomID)
}

// ConnectPathID extracts the room ID from /api/v1/meet/rooms/{id}/connect.
func ConnectPathID(path string) (string, bool) {
	const prefix = "/api/v1/meet/rooms/"
	const suffix = "/connect"
	if len(path) <= len(prefix)+len(suffix) {
		return "", false
	}
	if path[:len(prefix)] != prefix || path[len(path)-len(suffix):] != suffix {
		return "", false
	}
	id := path[len(prefix) : len(path)-len(suffix)]
	if id == "" {
		return "", false
	}
	// Reject paths with additional segments (e.g. /rooms/a/b/connect).
	for _, ch := range id {
		if ch == '/' {
			return "", false
		}
	}
	return id, true
}

// Ensure connectPath is used (avoids unused-function lint warnings in test mode).
var _ = connectPath
