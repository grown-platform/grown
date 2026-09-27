package slides

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Collaboration for slides is an op relay: the editor emits change operations
// (and presence) which we relay to the other clients editing the same deck.
// Durability comes from the autosaved deck (SaveDeck / GetDeck).
//
// M10 hardening (additive; see docs/plans/onlyoffice-parity/slides.md §6.16):
//
//   - Every deck-mutating op is stamped with a per-room sequence number
//     ("seq") and the sender's client id ("cid"), kept in a bounded room log,
//     relayed in seq order, and acknowledged to its sender ({"t":"ack"}).
//   - A client opens with {"t":"hello","cid","since","epoch"}: the hub answers
//     {"t":"welcome","epoch","seq","fresh"}, the logged ops after `since`
//     (all of them when `fresh`: a new client, another room epoch, or a gap
//     the log no longer covers), then {"t":"synced"}. The catch-up is written
//     straight to the socket, not through the bounded queue.
//   - An op carrying "base" (the last seq its sender had applied) is rejected
//     ({"t":"reject","id"}) when another client changed an overlapping key
//     (element, slide, slide props, comment, or the whole deck) after base,
//     so a stale edit cannot clobber a newer one; the sender re-bases.
//   - An op id already in the log is acknowledged again, not re-applied.
//   - A peer whose queue overflows is disconnected (it reconnects and catches
//     up) instead of silently missing ops.
//
// Clients that send no hello and no ids (older tabs) keep working: their ops
// are stamped and relayed, never rejected.

const readLimit = 8 << 20

// peerQueue is a peer's outbound queue. A peer that falls this far behind
// is disconnected and catches up from the log when it reconnects.
const peerQueue = 1024

// Room log bounds. Entries a saved snapshot covers ({"t":"saved","seq"}) are
// trimmed past the soft limits; unsaved ones are kept up to the hard limits.
const (
	logMaxEntries     = 2000
	logMaxBytes       = 16 << 20
	logHardMaxEntries = 8000
	logHardMaxBytes   = 64 << 20
)

type peer struct {
	out  chan []byte
	cid  string
	kick func() // closes the connection (queue overflow)
}

type logEntry struct {
	seq  uint64
	cid  string
	id   string
	keys []string
	msg  []byte
}

type room struct {
	mu    sync.Mutex
	peers map[*peer]struct{}
	epoch string
	seq   uint64
	// log holds the ops (base, seq]; base advances as the log is trimmed.
	log      []logEntry
	logBytes int
	base     uint64
	savedSeq uint64
}

func newRoom() *room {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return &room{peers: map[*peer]struct{}{}, epoch: hex.EncodeToString(b[:])}
}

// Hub relays messages between peers editing the same deck.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

// NewHub constructs a Hub.
func NewHub() *Hub { return &Hub{rooms: map[string]*room{}} }

func (h *Hub) roomFor(id string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[id]
	if !ok {
		r = newRoom()
		h.rooms[id] = r
	}
	return r
}

func (h *Hub) add(id string, p *peer) *room {
	for {
		r := h.roomFor(id)
		r.mu.Lock()
		// A room emptied (and dropped from the hub) between roomFor and
		// here must not be joined: retry with the live one.
		h.mu.Lock()
		live := h.rooms[id] == r
		h.mu.Unlock()
		if live {
			r.peers[p] = struct{}{}
			r.mu.Unlock()
			return r
		}
		r.mu.Unlock()
	}
}

func (h *Hub) remove(id string, r *room, p *peer) {
	r.mu.Lock()
	delete(r.peers, p)
	empty := len(r.peers) == 0
	if empty {
		h.mu.Lock()
		if cur, ok := h.rooms[id]; ok && cur == r {
			delete(h.rooms, id)
		}
		h.mu.Unlock()
	}
	r.mu.Unlock()
}

// fanout queues msg for every peer but from. Caller holds r.mu (so every
// peer sees ops in seq order). A full queue kicks that peer: it reconnects
// and catches up from the log rather than silently diverging.
func (r *room) fanout(from *peer, msg []byte) {
	for p := range r.peers {
		if p != from {
			p.enqueue(msg)
		}
	}
}

func (p *peer) enqueue(msg []byte) {
	select {
	case p.out <- msg:
	default:
		if p.kick != nil {
			p.kick()
		}
	}
}

func (r *room) broadcast(from *peer, msg []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.fanout(from, msg)
}

func (r *room) appendLog(e logEntry) {
	r.log = append(r.log, e)
	r.logBytes += len(e.msg)
	r.trim()
}

func (r *room) markSaved(seq uint64) {
	if seq > r.seq {
		seq = r.seq
	}
	if seq > r.savedSeq {
		r.savedSeq = seq
	}
}

func (r *room) trim() {
	for len(r.log) > 0 {
		soft := len(r.log) > logMaxEntries || r.logBytes > logMaxBytes
		hard := len(r.log) > logHardMaxEntries || r.logBytes > logHardMaxBytes
		if !hard && !(soft && r.log[0].seq <= r.savedSeq) {
			return
		}
		r.base = r.log[0].seq
		r.logBytes -= len(r.log[0].msg)
		r.log[0] = logEntry{}
		r.log = r.log[1:]
	}
}

// resetLog drops the whole log (the stored deck was replaced).
func (r *room) resetLog() {
	r.log, r.logBytes, r.base = nil, 0, r.seq
}

// ---- envelope ----

type idOnly struct {
	ID string `json:"id"`
}

// envelope is the part of a client message the hub reads.
type envelope struct {
	T         string   `json:"t"`
	Type      string   `json:"type"`
	ID        string   `json:"id"`
	Base      *uint64  `json:"base"`
	Si        string   `json:"si"`
	El        *idOnly  `json:"el"`
	ElID      string   `json:"elId"`
	Els       []idOnly `json:"els"`
	IDs       []string `json:"ids"`
	C         *idOnly  `json:"c"`
	R         *idOnly  `json:"r"`
	CommentID string   `json:"commentId"`
	ReplyID   string   `json:"replyId"`
	// hello / saved
	Cid   string `json:"cid"`
	Since uint64 `json:"since"`
	Seq   uint64 `json:"seq"`
	Epoch string `json:"epoch"`
}

func parseEnvelope(msg []byte) (envelope, error) {
	var e envelope
	err := json.Unmarshal(msg, &e)
	return e, err
}

// keys names what an op changes: "e:<slide>:<element>", "s:<slide>" (the
// slide's element list), "p:<slide>" (slide properties), "c:<comment>" (a
// thread head), "r:<comment>:<reply>" (one reply), or
// "*" (the whole deck, and anything the hub does not recognise).
func (e envelope) keys() []string {
	el := func(ids ...string) []string {
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			out = append(out, "e:"+e.Si+":"+id)
		}
		return out
	}
	switch e.T {
	case "upsert":
		if e.El != nil && e.Si != "" {
			return el(e.El.ID)
		}
	case "remove":
		if e.Si != "" {
			return el(e.ElID)
		}
	case "upsertMany":
		if e.Si != "" {
			ids := make([]string, 0, len(e.Els))
			for _, x := range e.Els {
				ids = append(ids, x.ID)
			}
			return el(ids...)
		}
	case "removeMany":
		if e.Si != "" {
			return el(e.IDs...)
		}
	case "reorder", "setElements":
		if e.Si != "" {
			return []string{"s:" + e.Si}
		}
	case "slideProps":
		if e.Si != "" {
			return []string{"p:" + e.Si}
		}
	case "comment":
		if e.C != nil {
			return []string{"c:" + e.C.ID}
		}
	case "commentRemove", "commentResolve":
		return []string{"c:" + e.CommentID}
	case "commentReply":
		if e.R != nil {
			return []string{"r:" + e.CommentID + ":" + e.R.ID}
		}
	case "commentReplyRemove":
		return []string{"r:" + e.CommentID + ":" + e.ReplyID}
	}
	return []string{"*"}
}

// keyOverlap reports whether changes to keys a and b conflict.
func keyOverlap(a, b string) bool {
	if a == "*" || b == "*" || a == b {
		return true
	}
	slideOf := func(k string) (string, bool) {
		if strings.HasPrefix(k, "s:") {
			return k[2:], true
		}
		return "", false
	}
	elSlide := func(k string) string {
		if !strings.HasPrefix(k, "e:") {
			return "\x00"
		}
		rest := k[2:]
		if i := strings.IndexByte(rest, ':'); i >= 0 {
			return rest[:i]
		}
		return rest
	}
	if s, ok := slideOf(a); ok && elSlide(b) == s {
		return true
	}
	if s, ok := slideOf(b); ok && elSlide(a) == s {
		return true
	}
	return false
}

func anyOverlap(a, b []string) bool {
	for _, x := range a {
		for _, y := range b {
			if keyOverlap(x, y) {
				return true
			}
		}
	}
	return false
}

// stamp prefixes a JSON object with the room seq and the sender's cid.
func stamp(msg []byte, seq uint64, cid string) []byte {
	cidJSON, _ := json.Marshal(cid)
	head := `{"seq":` + strconv.FormatUint(seq, 10) + `,"cid":` + string(cidJSON)
	body := bytes.TrimSpace(msg)
	if len(body) >= 2 && body[0] == '{' {
		rest := bytes.TrimSpace(body[1:])
		if len(rest) > 0 && rest[0] == '}' {
			return []byte(head + "}")
		}
		out := make([]byte, 0, len(head)+1+len(body))
		out = append(out, head...)
		out = append(out, ',')
		return append(out, body[1:]...)
	}
	return msg
}

func ctlMsg(v map[string]any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// isPresence reports whether a client message is an ephemeral presence/cursor
// update ({"t":"presence",...}) rather than a deck-mutating op. Read-only
// viewers may still broadcast presence; their ops are dropped.
func isPresence(msg []byte) bool {
	return bytes.Contains(msg, []byte(`"presence"`))
}

// join adds p to the room for a hello and returns the welcome and catch-up.
func (h *Hub) join(deckID string, p *peer, hi envelope) (*room, [][]byte) {
	r := h.add(deckID, p)
	r.mu.Lock()
	defer r.mu.Unlock()
	fresh := hi.Epoch == "" || hi.Epoch != r.epoch || hi.Since < r.base || hi.Since > r.seq
	from := hi.Since
	if fresh {
		from = 0
	}
	out := [][]byte{ctlMsg(map[string]any{"t": "welcome", "epoch": r.epoch, "seq": r.seq, "fresh": fresh})}
	for _, e := range r.log {
		if e.seq > from {
			out = append(out, e.msg)
		}
	}
	out = append(out, ctlMsg(map[string]any{"t": "synced", "seq": r.seq}))
	return r, out
}

// route handles one message from a joined peer.
func (h *Hub) route(r *room, self *peer, data []byte, canWrite bool) {
	env, err := parseEnvelope(data)
	if err != nil {
		return
	}
	t := env.T
	if t == "" {
		t = env.Type
	}
	switch t {
	case "presence":
		// Anyone, viewers included, may relay presence, so it must not also
		// carry another type the clients act on (a "versionRestored" notice
		// makes every editor reload).
		if env.Type != "" && env.Type != "presence" {
			return
		}
		r.broadcast(self, data)
		return
	case "hello":
		return
	case "saved":
		if canWrite {
			r.mu.Lock()
			r.markSaved(env.Seq)
			r.trim()
			r.mu.Unlock()
		}
		return
	}
	if !canWrite {
		// Read-only viewers may not mutate the deck.
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if t == "versionRestored" {
		// The stored deck was replaced: everything logged is obsolete.
		r.seq++
		r.resetLog()
		r.fanout(self, data)
		return
	}
	cid := self.cid
	if env.ID != "" && cid != "" {
		for _, e := range r.log {
			if e.cid == cid && e.id == env.ID {
				self.enqueue(ctlMsg(map[string]any{"t": "ack", "id": env.ID, "seq": e.seq}))
				return
			}
		}
	}
	keys := env.keys()
	if env.Base != nil {
		base := *env.Base
		stale := base < r.base
		if !stale {
			for _, e := range r.log {
				if e.seq > base && (e.cid != cid || cid == "") && anyOverlap(keys, e.keys) {
					stale = true
					break
				}
			}
		}
		if stale {
			self.enqueue(ctlMsg(map[string]any{"t": "reject", "id": env.ID, "seq": r.seq}))
			return
		}
	}
	r.seq++
	stamped := stamp(data, r.seq, cid)
	r.appendLog(logEntry{seq: r.seq, cid: cid, id: env.ID, keys: keys, msg: stamped})
	r.fanout(self, stamped)
	if env.ID != "" {
		self.enqueue(ctlMsg(map[string]any{"t": "ack", "id": env.ID, "seq": r.seq}))
	}
}

// Serve runs the read/write loops for one client connected to deckID. Caller
// must verify access first. When canWrite is false (a viewer/commenter grant),
// inbound deck-mutating ops are dropped server-side; presence still relays.
func (h *Hub) Serve(w http.ResponseWriter, r *http.Request, deckID string, canWrite bool) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(readLimit)

	// The request context of a hijacked connection is not cancelled when the
	// client goes away, only when this handler returns, so the writer stops on
	// this derived context, cancelled once the reader sees the socket close
	// (or a full queue kicks the peer).
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	self := &peer{out: make(chan []byte, peerQueue), kick: cancel}

	write := func(msg []byte) error {
		wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
		defer wcancel()
		return c.Write(wctx, websocket.MessageText, msg)
	}

	// The first message decides the protocol: a hello joins with a catch-up
	// written straight to the socket (ops relayed meanwhile queue behind it);
	// anything else is an older client, which joins and is routed as usual.
	typ, first, err := c.Read(ctx)
	if err != nil {
		return
	}
	var room *room
	if env, perr := parseEnvelope(first); typ == websocket.MessageText && perr == nil && env.T == "hello" {
		self.cid = env.Cid
		var catchUp [][]byte
		room, catchUp = h.join(deckID, self, env)
		defer h.remove(deckID, room, self)
		for _, m := range catchUp {
			if write(m) != nil {
				return
			}
		}
		first = nil
	} else {
		room = h.add(deckID, self)
		defer h.remove(deckID, room, self)
	}

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-self.out:
				if write(msg) != nil {
					cancel()
					return
				}
			}
		}
	}()

	if first != nil && typ == websocket.MessageText {
		h.route(room, self, first, canWrite)
	}
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			break
		}
		if typ != websocket.MessageText {
			continue
		}
		h.route(room, self, data, canWrite)
	}
	cancel()
	<-writerDone
}
