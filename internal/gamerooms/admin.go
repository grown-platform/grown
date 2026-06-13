package gamerooms

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// AdminHandler is the admin-gated control plane for the game-room relay. It
// serves, under /api/v1/gamerooms/admin/*:
//
//	GET  /settings          – current enabled flag + who/when last changed
//	POST /settings          – {"enabled":bool} toggle multiplayer on/off
//	GET  /sessions          – live room/peer monitor
//	POST /kick              – {"room":"..", "peer_id":".."} kick a peer or whole room
//	GET  /audit             – paginated, filterable event log
//
// Every route is gated by the injected Identity (caller email + IsAdmin). This
// handler is mounted INSIDE grown's auth middleware in server.go (driveAuthWrap),
// so the caller's session is resolvable from the request context — unlike the
// public WS/list relay, which bypasses the auth wall.
type AdminHandler struct {
	hub      *Hub
	store    *Store
	identity Identity
}

// Identity resolves the calling admin off the request context. server.go injects
// a closure backed by auth.UserFromContext + the org_admins/allowlist check,
// keeping this package free of internal/auth's gen/ dependency (same pattern as
// internal/audit and internal/adminusers).
type Identity struct {
	// Caller returns the caller's grown email and whether a session is present.
	Caller func(ctx context.Context) (email string, ok bool)
	// IsAdmin reports whether the caller is a grown admin (allowlist or org_admins).
	IsAdmin func(ctx context.Context) bool
}

const adminPrefix = "/api/v1/gamerooms/admin/"

// NewAdminHandler constructs the admin handler over a hub + its store.
func NewAdminHandler(hub *Hub, store *Store, id Identity) *AdminHandler {
	return &AdminHandler{hub: hub, store: store, identity: id}
}

// Match reports whether path routes to the admin handler.
func (h *AdminHandler) Match(path string) bool { return strings.HasPrefix(path, adminPrefix) }

func (h *AdminHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Authorize: a present session whose caller IsAdmin. No open fallback.
	email, ok := "", false
	if h.identity.Caller != nil {
		email, ok = h.identity.Caller(r.Context())
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "no session"})
		return
	}
	if h.identity.IsAdmin == nil || !h.identity.IsAdmin(r.Context()) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin privileges required"})
		return
	}

	switch strings.TrimPrefix(r.URL.Path, adminPrefix) {
	case "settings":
		h.settings(w, r, email)
	case "sessions":
		h.sessions(w, r)
	case "kick":
		h.kick(w, r, email)
	case "audit":
		h.audit(w, r)
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
	}
}

// settings: GET returns the current flag; POST {"enabled":bool} toggles it.
func (h *AdminHandler) settings(w http.ResponseWriter, r *http.Request, email string) {
	switch r.Method {
	case http.MethodGet:
		s := h.store.LoadSettings(r.Context())
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled":    h.hub.Enabled(),
			"updated_at": rfc3339OrEmpty(s.UpdatedAt),
			"updated_by": s.UpdatedBy,
		})
	case http.MethodPost:
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid body"})
			return
		}
		if err := h.hub.SetEnabled(r.Context(), body.Enabled, email); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"enabled": body.Enabled})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
	}
}

// sessions: GET the live room/peer monitor.
func (h *AdminHandler) sessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":  h.hub.Enabled(),
		"sessions": h.hub.Sessions(),
	})
}

// kick: POST {"room":"..","peer_id":".."}. With peer_id empty, kicks the whole
// room; otherwise just that peer.
func (h *AdminHandler) kick(w http.ResponseWriter, r *http.Request, email string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	var body struct {
		Room   string `json:"room"`
		PeerID string `json:"peer_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Room) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "room required"})
		return
	}
	if body.PeerID != "" {
		if !h.hub.KickPeer(body.Room, body.PeerID, email) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "peer not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"kicked": "peer"})
		return
	}
	n, ok := h.hub.KickRoom(body.Room, email)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "room not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kicked": "room", "peers": n})
}

// audit: GET the event log, filtered by ?event=&room=&limit=&before=.
func (h *AdminHandler) audit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	q := r.URL.Query()
	f := AuditFilter{
		Event: strings.TrimSpace(q.Get("event")),
		Room:  strings.TrimSpace(q.Get("room")),
	}
	if l := q.Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			f.Limit = n
		}
	}
	if b := q.Get("before"); b != "" {
		if t, err := time.Parse(time.RFC3339Nano, b); err == nil {
			f.Before = t
		}
	}
	events, err := h.store.ListAudit(r.Context(), f)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func rfc3339OrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
