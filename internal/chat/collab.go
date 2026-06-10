package chat

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The chat WebSocket hub broadcasts new messages to all connected clients in
// the same channel. Each connected client also receives a "presence" event
// listing which users are currently online in the channel.
//
// Wire format (JSON):
//
//	Server → Client:
//	  {"type":"message","message":{...ChatMessage...}}
//	  {"type":"presence","online":["userID",...],"channel_id":"..."}
//	  {"type":"deleted","id":"...","channel_id":"..."}
//
//	Client → Server:
//	  (ignored — all writes go through the REST API)

const wsReadLimit = 4 << 10 // 4 KB (clients don't send anything meaningful)

// WSMessage is the envelope sent over the WebSocket.
type WSMessage struct {
	Type      string      `json:"type"`
	Message   interface{} `json:"message,omitempty"`
	Online    []string    `json:"online,omitempty"`
	ChannelID string      `json:"channel_id,omitempty"`
	ID        string      `json:"id,omitempty"`
}

type peer struct {
	userID string
	out    chan []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
}

// Hub manages WebSocket rooms for chat channels.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

// NewHub constructs a Hub.
func NewHub() *Hub { return &Hub{rooms: map[string]*room{}} }

func (h *Hub) roomFor(channelID string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[channelID]
	if !ok {
		r = &room{peers: map[*peer]struct{}{}}
		h.rooms[channelID] = r
	}
	return r
}

func (h *Hub) add(channelID string, p *peer) *room {
	r := h.roomFor(channelID)
	r.mu.Lock()
	r.peers[p] = struct{}{}
	r.mu.Unlock()
	return r
}

func (h *Hub) remove(channelID string, r *room, p *peer) {
	r.mu.Lock()
	delete(r.peers, p)
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[channelID]; ok && cur == r {
			delete(h.rooms, channelID)
		}
		h.mu.Unlock()
	}
}

// Broadcast sends a raw JSON payload to all connected peers in channelID.
func (h *Hub) Broadcast(channelID string, payload []byte) {
	r := h.roomFor(channelID)
	r.mu.Lock()
	targets := make([]*peer, 0, len(r.peers))
	for p := range r.peers {
		targets = append(targets, p)
	}
	r.mu.Unlock()
	for _, p := range targets {
		select {
		case p.out <- payload:
		default:
		}
	}
}

// BroadcastMessage encodes and broadcasts a new chat message event.
func (h *Hub) BroadcastMessage(channelID string, msg interface{}) {
	env := WSMessage{Type: "message", ChannelID: channelID, Message: msg}
	b, _ := json.Marshal(env)
	h.Broadcast(channelID, b)
}

// BroadcastDeleted broadcasts a message-deleted event.
func (h *Hub) BroadcastDeleted(channelID, msgID string) {
	env := WSMessage{Type: "deleted", ChannelID: channelID, ID: msgID}
	b, _ := json.Marshal(env)
	h.Broadcast(channelID, b)
}

func (r *room) presencePayload(channelID string) []byte {
	r.mu.Lock()
	ids := make([]string, 0, len(r.peers))
	for p := range r.peers {
		if p.userID != "" {
			ids = append(ids, p.userID)
		}
	}
	r.mu.Unlock()
	env := WSMessage{Type: "presence", ChannelID: channelID, Online: ids}
	b, _ := json.Marshal(env)
	return b
}

func (r *room) broadcastPresence(channelID string) {
	payload := r.presencePayload(channelID)
	r.mu.Lock()
	targets := make([]*peer, 0, len(r.peers))
	for p := range r.peers {
		targets = append(targets, p)
	}
	r.mu.Unlock()
	for _, p := range targets {
		select {
		case p.out <- payload:
		default:
		}
	}
}

// Serve handles one WebSocket connection. Caller must verify that userID is a
// member of channelID before calling.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, channelID, userID string) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(wsReadLimit)

	ctx := r.Context()
	self := &peer{userID: userID, out: make(chan []byte, 256)}
	room := h.add(channelID, self)
	defer h.remove(channelID, room, self)

	// Broadcast updated presence.
	room.broadcastPresence(channelID)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-self.out:
				if !ok {
					return
				}
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
		_, _, err := c.Read(ctx)
		if err != nil {
			break
		}
		// Clients don't send anything we need to process here.
	}

	// Broadcast presence after disconnect.
	room.broadcastPresence(channelID)
	<-done
}
