package gamerooms

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

// HTTPHandler exposes the public game-room relay:
//
//	GET /api/v1/gamerooms/ws?room=<code>&password=<pw>&name=<displayName>
//
// It is PUBLIC (no workspace account required) — anyone with the room link can
// join. Access control is the room code plus an optional password. The first
// connection to a code creates the room and sets its password.
type HTTPHandler struct {
	hub *Hub
}

// NewHTTPHandler constructs the handler.
func NewHTTPHandler(hub *Hub) *HTTPHandler { return &HTTPHandler{hub: hub} }

const wsPath = "/api/v1/gamerooms/ws"

// Match reports whether path routes to this handler.
func (h *HTTPHandler) Match(path string) bool { return path == wsPath }

func (h *HTTPHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != wsPath {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	code := strings.TrimSpace(q.Get("room"))
	password := q.Get("password")
	name := strings.TrimSpace(q.Get("name"))
	if code == "" || len(code) > 64 {
		http.Error(w, "missing or invalid room code", http.StatusBadRequest)
		return
	}
	if name == "" {
		name = "Player"
	}
	if len(name) > 40 {
		name = name[:40]
	}
	if !h.hub.PasswordOK(code, password) {
		http.Error(w, "wrong room password", http.StatusForbidden)
		return
	}
	peerID, err := randomID()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.hub.Serve(w, r, code, password, peerID, name)
}

func randomID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
