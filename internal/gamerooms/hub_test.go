package gamerooms

import "testing"

func TestRoomPasswordGating(t *testing.T) {
	h := NewHub()
	// New code with any password is allowed (creates the room on first join).
	if !h.PasswordOK("ABC123", "secret") {
		t.Fatal("new room should be allowed")
	}
	// Create the room.
	if _, ok := h.join("ABC123", "secret", "", false); !ok {
		t.Fatal("join should create the room")
	}
	// Correct password passes; wrong fails.
	if !h.PasswordOK("ABC123", "secret") {
		t.Error("correct password should pass")
	}
	if h.PasswordOK("ABC123", "nope") {
		t.Error("wrong password should fail")
	}
	if _, ok := h.join("ABC123", "nope", "", false); ok {
		t.Error("join with wrong password should fail")
	}
	if !h.RoomExists("ABC123") {
		t.Error("room should exist")
	}
}
