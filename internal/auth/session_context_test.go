package auth

import (
	"context"
	"testing"
	"time"
)

// TestSessionStore_CreateWithContext verifies the IP + user agent captured at
// sign-in round-trip through Lookup and the admin/own session listings.
func TestSessionStore_CreateWithContext(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.CreateWithContext(ctx, userID, time.Hour, "203.0.113.7", "Mozilla/5.0 Test")
	if err != nil {
		t.Fatalf("CreateWithContext: %v", err)
	}
	sess, err := store.Lookup(ctx, tok)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if sess.IP != "203.0.113.7" {
		t.Errorf("ip: got %q, want 203.0.113.7", sess.IP)
	}
	if sess.UserAgent != "Mozilla/5.0 Test" {
		t.Errorf("user_agent: got %q", sess.UserAgent)
	}
	if sess.LastSeenAt == nil {
		t.Errorf("last_seen_at should be set on create")
	}
}

// TestSessionStore_ListByOrg checks the org-scoped listing reports IP/UA, the
// public id (16 hex chars), and flags the caller's own session as Current.
func TestSessionStore_ListByOrg(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.CreateWithContext(ctx, userID, time.Hour, "198.51.100.2", "agent-a")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// A second session for the same org/user.
	if _, err := store.CreateWithContext(ctx, userID, time.Hour, "198.51.100.3", "agent-b"); err != nil {
		t.Fatalf("create 2: %v", err)
	}

	var orgID string
	if err := pool.QueryRow(ctx, `SELECT org_id::text FROM grown.users WHERE id=$1`, userID).Scan(&orgID); err != nil {
		t.Fatalf("org id: %v", err)
	}

	infos, err := store.ListByOrg(ctx, orgID, tok)
	if err != nil {
		t.Fatalf("ListByOrg: %v", err)
	}
	if len(infos) != 2 {
		t.Fatalf("session count: got %d, want 2", len(infos))
	}
	var current int
	for _, s := range infos {
		if len(s.ID) != 16 {
			t.Errorf("public id length: got %d (%q), want 16", len(s.ID), s.ID)
		}
		if s.Email != "z@example.com" {
			t.Errorf("email: got %q", s.Email)
		}
		if s.Current {
			current++
		}
	}
	if current != 1 {
		t.Errorf("exactly one session should be Current; got %d", current)
	}
}

// TestSessionStore_RevokeByOrgAndID revokes via the public id and confirms a
// cross-org revoke is refused (org-scoping).
func TestSessionStore_RevokeByOrgAndID(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.CreateWithContext(ctx, userID, time.Hour, "203.0.113.9", "agent")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var orgID string
	if err := pool.QueryRow(ctx, `SELECT org_id::text FROM grown.users WHERE id=$1`, userID).Scan(&orgID); err != nil {
		t.Fatalf("org id: %v", err)
	}
	infos, err := store.ListByOrg(ctx, orgID, "")
	if err != nil || len(infos) != 1 {
		t.Fatalf("list: %v len=%d", err, len(infos))
	}
	id := infos[0].ID

	// A revoke scoped to a different (random) org must NOT revoke it.
	otherOrg := "00000000-0000-0000-0000-000000000000"
	if ok, err := store.RevokeByOrgAndID(ctx, otherOrg, id); err != nil || ok {
		t.Fatalf("cross-org revoke should be a no-op: ok=%v err=%v", ok, err)
	}
	if _, err := store.Lookup(ctx, tok); err != nil {
		t.Fatalf("session should still be valid after cross-org revoke: %v", err)
	}

	// The correct org revokes it.
	ok, err := store.RevokeByOrgAndID(ctx, orgID, id)
	if err != nil || !ok {
		t.Fatalf("RevokeByOrgAndID: ok=%v err=%v", ok, err)
	}
	if _, err := store.Lookup(ctx, tok); err != ErrSessionRevoked {
		t.Errorf("got %v, want ErrSessionRevoked", err)
	}
	// Revoking again is a no-op (already revoked).
	if ok, _ := store.RevokeByOrgAndID(ctx, orgID, id); ok {
		t.Errorf("second revoke should report no rows affected")
	}
}

// TestSessionStore_TouchLastSeen confirms the throttled refresh updates the
// column without erroring.
func TestSessionStore_TouchLastSeen(t *testing.T) {
	pool, userID := sessionDB(t)
	store := NewSessionStore(pool)
	ctx := context.Background()

	tok, err := store.Create(ctx, userID, time.Hour)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := store.TouchLastSeen(ctx, tok); err != nil {
		t.Fatalf("TouchLastSeen: %v", err)
	}
}
