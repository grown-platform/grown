package telephony

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// SignalType enumerates the WebRTC signaling message types relayed by the hub.
type SignalType string

const (
	SignalPresence  SignalType = "presence"  // server → client: who is online now
	SignalInvite    SignalType = "invite"    // caller → callee: ring
	SignalAccept    SignalType = "accept"    // callee → caller: call accepted
	SignalReject    SignalType = "reject"    // callee → caller: call declined
	SignalBusy      SignalType = "busy"      // callee → caller: already on a call
	SignalHangup    SignalType = "hangup"    // either party: end the call
	SignalOffer     SignalType = "offer"     // SDP offer
	SignalAnswer    SignalType = "answer"    // SDP answer
	SignalCandidate SignalType = "candidate" // ICE candidate
)

// SignalMessage is the JSON envelope relayed over the WebSocket. Routing is by
// user ID: From is stamped server-side; To names the target peer (the other
// party in a 1:1 call). Presence carries the online user list instead.
type SignalMessage struct {
	Type    SignalType      `json:"type"`
	From    string          `json:"from,omitempty"`    // sender user ID
	To      string          `json:"to,omitempty"`      // target user ID
	Name    string          `json:"name,omitempty"`    // sender display name
	Online  []string        `json:"online,omitempty"`  // used in "presence"
	Payload json.RawMessage `json:"payload,omitempty"` // SDP or ICE candidate
}

const readLimit = 256 << 10 // 256 KB

type peer struct {
	userID string
	name   string
	out    chan []byte
}

// Hub manages telephony signaling connections for a single deployment. Peers
// are keyed by org and then by user ID; signaling is routed between the two
// user connections of a 1:1 call. Presence (online membership) is scoped per
// org so the directory can show who is reachable.
type Hub struct {
	mu    sync.Mutex
	orgs  map[string]map[string]*peer // orgID → userID → peer
}

// NewHub constructs a signaling Hub.
func NewHub() *Hub { return &Hub{orgs: map[string]map[string]*peer{}} }

// Online reports whether userID currently has a live telephony connection in
// orgID. Used by the directory to surface online status.
func (h *Hub) Online(orgID, userID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	peers, ok := h.orgs[orgID]
	if !ok {
		return false
	}
	_, ok = peers[userID]
	return ok
}

// OnlineUsers returns the user IDs currently connected in orgID.
func (h *Hub) OnlineUsers(orgID string) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	peers, ok := h.orgs[orgID]
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(peers))
	for id := range peers {
		ids = append(ids, id)
	}
	return ids
}

func (h *Hub) add(orgID string, p *peer) {
	h.mu.Lock()
	peers, ok := h.orgs[orgID]
	if !ok {
		peers = map[string]*peer{}
		h.orgs[orgID] = peers
	}
	// Displace any stale connection for the same user (e.g. a reconnect).
	if old, ok := peers[p.userID]; ok {
		close(old.out)
	}
	peers[p.userID] = p
	h.mu.Unlock()
}

func (h *Hub) remove(orgID string, p *peer) {
	h.mu.Lock()
	if peers, ok := h.orgs[orgID]; ok {
		// Only delete if this exact peer is still the registered one.
		if cur, ok := peers[p.userID]; ok && cur == p {
			delete(peers, p.userID)
		}
		if len(peers) == 0 {
			delete(h.orgs, orgID)
		}
	}
	h.mu.Unlock()
}

// Serve runs the signaling loop for one client. Caller must verify access first.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, orgID, userID, displayName string) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)

	ctx := r.Context()
	self := &peer{
		userID: userID,
		name:   displayName,
		out:    make(chan []byte, 128),
	}

	h.add(orgID, self)
	defer func() {
		h.remove(orgID, self)
		h.broadcastPresence(orgID)
	}()

	// Send the joiner the current presence list, then announce them to others.
	h.sendPresence(orgID, self)
	h.broadcastPresence(orgID)

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

	// Read loop — relay signaling to the named target peer.
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
		// Stamp from field with the authenticated user id and name.
		msg.From = userID
		if msg.Name == "" {
			msg.Name = displayName
		}
		h.route(orgID, msg)
	}
	<-writeDone
}

// route forwards a signaling message to its target peer (1:1 routing by user
// ID). Messages without a target are dropped.
func (h *Hub) route(orgID string, msg SignalMessage) {
	if msg.To == "" {
		return
	}
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.Lock()
	var target *peer
	if peers, ok := h.orgs[orgID]; ok {
		target = peers[msg.To]
	}
	h.mu.Unlock()
	if target == nil {
		return
	}
	select {
	case target.out <- out:
	default:
	}
}

// sendPresence sends the current online user list only to the named peer.
func (h *Hub) sendPresence(orgID string, to *peer) {
	msg := SignalMessage{Type: SignalPresence, Online: h.OnlineUsers(orgID)}
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case to.out <- out:
	default:
	}
}

// broadcastPresence pushes the current online list to every peer in orgID.
func (h *Hub) broadcastPresence(orgID string) {
	online := h.OnlineUsers(orgID)
	msg := SignalMessage{Type: SignalPresence, Online: online}
	out, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.Lock()
	targets := make([]*peer, 0)
	if peers, ok := h.orgs[orgID]; ok {
		for _, p := range peers {
			targets = append(targets, p)
		}
	}
	h.mu.Unlock()
	for _, p := range targets {
		select {
		case p.out <- out:
		default:
		}
	}
}
