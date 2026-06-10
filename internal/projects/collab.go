package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The projects WebSocket hub broadcasts issue create/update/delete events to
// every client viewing the same team, so list and board views update live.
// It also reports presence (which users are currently viewing the team).
//
// Wire format (JSON), server → client:
//
//	{"type":"issue","issue":{...Issue...}}
//	{"type":"deleted","id":"...","team_id":"..."}
//	{"type":"presence","online":["userID",...],"team_id":"..."}
//
// Clients send nothing meaningful (all writes go through REST).

const wsReadLimit = 4 << 10

// WSMessage is the envelope sent over the WebSocket.
type WSMessage struct {
	Type   string      `json:"type"`
	Issue  interface{} `json:"issue,omitempty"`
	Online []string    `json:"online,omitempty"`
	TeamID string      `json:"team_id,omitempty"`
	ID     string      `json:"id,omitempty"`
}

type peer struct {
	userID string
	out    chan []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
}

// Hub manages WebSocket rooms keyed by team id.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func NewHub() *Hub { return &Hub{rooms: map[string]*room{}} }

func (h *Hub) roomFor(teamID string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[teamID]
	if !ok {
		r = &room{peers: map[*peer]struct{}{}}
		h.rooms[teamID] = r
	}
	return r
}

func (h *Hub) add(teamID string, p *peer) *room {
	r := h.roomFor(teamID)
	r.mu.Lock()
	r.peers[p] = struct{}{}
	r.mu.Unlock()
	return r
}

func (h *Hub) remove(teamID string, r *room, p *peer) {
	r.mu.Lock()
	delete(r.peers, p)
	empty := len(r.peers) == 0
	r.mu.Unlock()
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[teamID]; ok && cur == r {
			delete(h.rooms, teamID)
		}
		h.mu.Unlock()
	}
}

func (h *Hub) broadcast(teamID string, payload []byte) {
	r := h.roomFor(teamID)
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

// BroadcastIssue encodes and broadcasts a created/updated issue to its team.
func (h *Hub) BroadcastIssue(teamID string, issue interface{}) {
	if h == nil || teamID == "" {
		return
	}
	b, _ := json.Marshal(WSMessage{Type: "issue", TeamID: teamID, Issue: issue})
	h.broadcast(teamID, b)
}

// BroadcastDeleted broadcasts an issue-deleted event to its team.
func (h *Hub) BroadcastDeleted(teamID, issueID string) {
	if h == nil || teamID == "" {
		return
	}
	b, _ := json.Marshal(WSMessage{Type: "deleted", TeamID: teamID, ID: issueID})
	h.broadcast(teamID, b)
}

func (r *room) broadcastPresence(teamID string) {
	r.mu.Lock()
	ids := make([]string, 0, len(r.peers))
	for p := range r.peers {
		if p.userID != "" {
			ids = append(ids, p.userID)
		}
	}
	targets := make([]*peer, 0, len(r.peers))
	for p := range r.peers {
		targets = append(targets, p)
	}
	r.mu.Unlock()
	b, _ := json.Marshal(WSMessage{Type: "presence", TeamID: teamID, Online: ids})
	for _, p := range targets {
		select {
		case p.out <- b:
		default:
		}
	}
}

// Serve handles one WebSocket connection. Caller must verify userID may view teamID.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, teamID, userID string) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(wsReadLimit)

	ctx := r.Context()
	self := &peer{userID: userID, out: make(chan []byte, 256)}
	rm := h.add(teamID, self)
	defer h.remove(teamID, rm, self)
	rm.broadcastPresence(teamID)

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
		if _, _, err := c.Read(ctx); err != nil {
			break
		}
	}
	rm.broadcastPresence(teamID)
	<-done
}
