package gamerooms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestHTTPHandler_Match(t *testing.T) {
	h := NewHTTPHandler(NewHub(nil))
	tests := []struct {
		path string
		want bool
	}{
		{wsPath, true},
		{listPath, true},
		{"/api/v1/gamerooms/admin/settings", false},
		{"/other", false},
		{"", false},
	}
	for _, tc := range tests {
		if got := h.Match(tc.path); got != tc.want {
			t.Errorf("Match(%q)=%v want %v", tc.path, got, tc.want)
		}
	}
}

func TestRandomID(t *testing.T) {
	a, err := randomID()
	if err != nil {
		t.Fatalf("randomID: %v", err)
	}
	if len(a) != 16 { // 8 bytes hex-encoded
		t.Errorf("randomID length = %d want 16", len(a))
	}
	b, _ := randomID()
	if a == b {
		t.Error("randomID should not collide on consecutive calls")
	}
}

func TestServeHTTP_ListEndpoint(t *testing.T) {
	hub := NewHub(nil)
	r, _, _ := hub.join("VIS", "", "chess", true)
	addPeer(r, "p1", "A")
	h := NewHTTPHandler(hub)

	req := httptest.NewRequest(http.MethodGet, listPath, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type = %q", ct)
	}
	var body struct {
		Rooms []RoomInfo `json:"rooms"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Rooms) != 1 || body.Rooms[0].Code != "VIS" {
		t.Fatalf("unexpected rooms: %+v", body.Rooms)
	}
}

func TestServeHTTP_UnknownPath404(t *testing.T) {
	h := NewHTTPHandler(NewHub(nil))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/gamerooms/nope", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d want 404", rec.Code)
	}
}

func TestServeHTTP_WSShortCircuits(t *testing.T) {
	hub := NewHub(nil)
	// Pre-create a password-protected room to trigger the mismatch branch.
	hub.join("LOCK", "secret", "chess", false)
	h := NewHTTPHandler(hub)

	tests := []struct {
		name  string
		query string
		want  int
	}{
		{"missing room code", "name=x", http.StatusBadRequest},
		{"room code too long", "room=" + strings.Repeat("a", 65), http.StatusBadRequest},
		{"wrong password", "room=LOCK&password=wrong", http.StatusForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, wsPath+"?"+tc.query, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d want %d (body %q)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestServeHTTP_WSDisabled503(t *testing.T) {
	hub := NewHub(nil)
	hub.enabled.Store(false)
	h := NewHTTPHandler(hub)
	// Valid params, but the relay is disabled => Serve short-circuits with 503.
	req := httptest.NewRequest(http.MethodGet, wsPath+"?room=ABC&name=x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d want 503", rec.Code)
	}
}

// TestServeHTTP_WSRoundTrip stands up a real httptest server, connects two
// websocket clients to the same room, and verifies the relay forwards a message
// from one peer to the other (and not back to the sender).
func TestServeHTTP_WSRoundTrip(t *testing.T) {
	hub := NewHub(nil)
	srv := httptest.NewServer(NewHTTPHandler(hub))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dial := func(name string) *websocket.Conn {
		c, _, err := websocket.Dial(ctx, wsURL+wsPath+"?room=RT&name="+name, nil)
		if err != nil {
			t.Fatalf("dial %s: %v", name, err)
		}
		return c
	}

	c1 := dial("Alice")
	defer c1.CloseNow()
	// c1 receives its own roster (you-only) first.
	var first map[string]any
	if err := wsjson.Read(ctx, c1, &first); err != nil {
		t.Fatalf("c1 roster read: %v", err)
	}
	if first["type"] != "roster" {
		t.Fatalf("expected roster first, got %v", first["type"])
	}

	c2 := dial("Bob")
	defer c2.CloseNow()
	// c2 reads its own roster.
	var c2roster map[string]any
	if err := wsjson.Read(ctx, c2, &c2roster); err != nil {
		t.Fatalf("c2 roster read: %v", err)
	}

	// c1 should receive a "join" announcement for Bob.
	var joinMsg map[string]any
	if err := wsjson.Read(ctx, c1, &joinMsg); err != nil {
		t.Fatalf("c1 join read: %v", err)
	}
	if joinMsg["type"] != "join" || joinMsg["name"] != "Bob" {
		t.Fatalf("expected Bob join on c1, got %+v", joinMsg)
	}

	// c1 sends a game move; c2 must receive it with from/name injected.
	if err := wsjson.Write(ctx, c1, map[string]any{"type": "move", "x": 3}); err != nil {
		t.Fatalf("c1 write: %v", err)
	}
	var got map[string]any
	if err := wsjson.Read(ctx, c2, &got); err != nil {
		t.Fatalf("c2 move read: %v", err)
	}
	if got["type"] != "move" || got["name"] != "Alice" {
		t.Fatalf("relayed move wrong: %+v", got)
	}
	if got["from"] == "" || got["from"] == nil {
		t.Error("relay should inject a 'from' peer id")
	}

	// The room should now exist with two peers.
	if !hub.RoomExists("RT") {
		t.Fatal("room RT should exist")
	}
}
