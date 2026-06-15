package gamerooms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// adminID builds an Identity stub with the given authz outcomes.
func adminID(email string, present, admin bool) Identity {
	return Identity{
		Caller:  func(context.Context) (string, bool) { return email, present },
		IsAdmin: func(context.Context) bool { return admin },
	}
}

func newAdmin(hub *Hub, id Identity) *AdminHandler {
	return NewAdminHandler(hub, hub.store, id)
}

func TestAdmin_Match(t *testing.T) {
	h := newAdmin(NewHub(nil), adminID("a@x", true, true))
	cases := map[string]bool{
		adminPrefix + "settings": true,
		adminPrefix + "kick":     true,
		wsPath:                   false,
		listPath:                 false,
	}
	for path, want := range cases {
		if got := h.Match(path); got != want {
			t.Errorf("Match(%q)=%v want %v", path, got, want)
		}
	}
}

func TestAdmin_AuthGates(t *testing.T) {
	tests := []struct {
		name string
		id   Identity
		want int
	}{
		{"no session", adminID("", false, false), http.StatusUnauthorized},
		{"not admin", adminID("u@x", true, false), http.StatusForbidden},
		{"nil caller", Identity{}, http.StatusUnauthorized},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newAdmin(NewHub(nil), tc.id)
			req := httptest.NewRequest(http.MethodGet, adminPrefix+"sessions", nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d want %d", rec.Code, tc.want)
			}
		})
	}
}

func TestAdmin_UnknownRoute404(t *testing.T) {
	h := newAdmin(NewHub(nil), adminID("a@x", true, true))
	req := httptest.NewRequest(http.MethodGet, adminPrefix+"bogus", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d want 404", rec.Code)
	}
}

func TestAdmin_Settings_GetAndToggle(t *testing.T) {
	hub := NewHub(nil) // nil store => SetEnabled tolerated, flag in-memory
	h := newAdmin(hub, adminID("admin@x", true, true))

	// GET reflects the live hub flag.
	getReq := httptest.NewRequest(http.MethodGet, adminPrefix+"settings", nil)
	getRec := httptest.NewRecorder()
	h.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("GET settings status = %d", getRec.Code)
	}
	var got map[string]any
	json.Unmarshal(getRec.Body.Bytes(), &got)
	if got["enabled"] != true {
		t.Errorf("expected enabled=true initially, got %v", got["enabled"])
	}

	// POST disables it and the hub flag must follow.
	postReq := httptest.NewRequest(http.MethodPost, adminPrefix+"settings",
		strings.NewReader(`{"enabled":false}`))
	postRec := httptest.NewRecorder()
	h.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("POST settings status = %d body=%s", postRec.Code, postRec.Body.String())
	}
	if hub.Enabled() {
		t.Error("hub should be disabled after POST {enabled:false}")
	}

	// Bad JSON body => 400.
	badReq := httptest.NewRequest(http.MethodPost, adminPrefix+"settings",
		strings.NewReader(`not json`))
	badRec := httptest.NewRecorder()
	h.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Errorf("bad body status = %d want 400", badRec.Code)
	}

	// Wrong method => 405.
	delReq := httptest.NewRequest(http.MethodDelete, adminPrefix+"settings", nil)
	delRec := httptest.NewRecorder()
	h.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE settings status = %d want 405", delRec.Code)
	}
}

func TestAdmin_Sessions(t *testing.T) {
	hub := NewHub(nil)
	r, _, _ := hub.join("S1", "", "chess", false)
	addPeer(r, "p1", "A")
	h := newAdmin(hub, adminID("admin@x", true, true))

	req := httptest.NewRequest(http.MethodGet, adminPrefix+"sessions", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Enabled  bool          `json:"enabled"`
		Sessions []SessionInfo `json:"sessions"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Sessions) != 1 || body.Sessions[0].Code != "S1" {
		t.Fatalf("unexpected sessions: %+v", body.Sessions)
	}

	// Wrong method => 405.
	postRec := httptest.NewRecorder()
	h.ServeHTTP(postRec, httptest.NewRequest(http.MethodPost, adminPrefix+"sessions", nil))
	if postRec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST sessions status = %d want 405", postRec.Code)
	}
}

func TestAdmin_Kick(t *testing.T) {
	mkHub := func() *Hub {
		hub := NewHub(nil)
		r, _, _ := hub.join("K1", "", "chess", false)
		addPeer(r, "victim", "V")
		addPeer(r, "other", "O")
		return hub
	}

	t.Run("kick a peer", func(t *testing.T) {
		h := newAdmin(mkHub(), adminID("admin@x", true, true))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, adminPrefix+"kick",
			strings.NewReader(`{"room":"K1","peer_id":"victim"}`)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"peer"`) {
			t.Errorf("expected kicked:peer, got %s", rec.Body.String())
		}
	})

	t.Run("kick whole room", func(t *testing.T) {
		hub := mkHub()
		h := newAdmin(hub, adminID("admin@x", true, true))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, adminPrefix+"kick",
			strings.NewReader(`{"room":"K1"}`)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if hub.RoomExists("K1") {
			t.Error("room should be gone after a room kick")
		}
	})

	t.Run("missing room field => 400", func(t *testing.T) {
		h := newAdmin(mkHub(), adminID("admin@x", true, true))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, adminPrefix+"kick",
			strings.NewReader(`{"peer_id":"x"}`)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d want 400", rec.Code)
		}
	})

	t.Run("unknown peer => 404", func(t *testing.T) {
		h := newAdmin(mkHub(), adminID("admin@x", true, true))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, adminPrefix+"kick",
			strings.NewReader(`{"room":"K1","peer_id":"ghost"}`)))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d want 404", rec.Code)
		}
	})

	t.Run("unknown room => 404", func(t *testing.T) {
		h := newAdmin(mkHub(), adminID("admin@x", true, true))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, adminPrefix+"kick",
			strings.NewReader(`{"room":"nope"}`)))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d want 404", rec.Code)
		}
	})

	t.Run("wrong method => 405", func(t *testing.T) {
		h := newAdmin(mkHub(), adminID("admin@x", true, true))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, adminPrefix+"kick", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d want 405", rec.Code)
		}
	})
}

func TestAdmin_Audit_NilStore(t *testing.T) {
	// nil store => ListAudit returns an empty slice, handler still 200s.
	h := newAdmin(NewHub(nil), adminID("admin@x", true, true))
	req := httptest.NewRequest(http.MethodGet,
		adminPrefix+"audit?event=join&room=R1&limit=5&before=2026-01-01T00:00:00Z", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Events []AuditEvent `json:"events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Events) != 0 {
		t.Errorf("expected no events from nil store, got %d", len(body.Events))
	}

	// Wrong method => 405.
	postRec := httptest.NewRecorder()
	h.ServeHTTP(postRec, httptest.NewRequest(http.MethodPost, adminPrefix+"audit", nil))
	if postRec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST audit status = %d want 405", postRec.Code)
	}
}
