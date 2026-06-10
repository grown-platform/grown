package telephony

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, Email: "tester@test.me", DisplayName: "Tester"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestService_RequiresAuth(t *testing.T) {
	pool, _ := setupDB(t)
	svc := NewService(NewRepository(pool), NewHub())
	if _, err := svc.ListDirectory(context.Background(), &grownv1.ListDirectoryRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("ListDirectory without session: got %v want Unauthenticated", err)
	}
}

func TestService_GetMyExtension_Provisions(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo, NewHub())
	u := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	ctx := authCtx(orgID, u)

	ext, err := svc.GetMyExtension(ctx, &grownv1.GetMyExtensionRequest{})
	if err != nil {
		t.Fatalf("GetMyExtension: %v", err)
	}
	if ext.Extension != "1001" {
		t.Errorf("extension: got %q want 1001", ext.Extension)
	}
	if ext.UserId != u {
		t.Errorf("user id: got %q want %q", ext.UserId, u)
	}
}

func TestService_ListDirectory_ExcludesSelf_OnlineStatus(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	hub := NewHub()
	svc := NewService(repo, hub)
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	u2 := seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")
	ctx := authCtx(orgID, u1)

	// Mark u2 online by injecting a peer into the hub.
	hub.add(orgID, &peer{userID: u2, name: "Bob", out: make(chan []byte, 1)})

	resp, err := svc.ListDirectory(ctx, &grownv1.ListDirectoryRequest{})
	if err != nil {
		t.Fatalf("ListDirectory: %v", err)
	}
	if len(resp.Entries) != 1 {
		t.Fatalf("entries: got %d want 1 (self excluded)", len(resp.Entries))
	}
	e := resp.Entries[0]
	if e.UserId != u2 {
		t.Errorf("entry user: got %q want %q", e.UserId, u2)
	}
	if !e.Online {
		t.Errorf("expected u2 online")
	}
}

func TestService_ListCallHistory_Direction(t *testing.T) {
	pool, orgID := setupDB(t)
	repo := NewRepository(pool)
	svc := NewService(repo, NewHub())
	u1 := seedUser(t, pool, orgID, "s1", "a@grown.localtest.me", "Alice")
	u2 := seedUser(t, pool, orgID, "s2", "b@grown.localtest.me", "Bob")
	ctx := authCtx(orgID, u1)

	if _, err := repo.LogCall(context.Background(), orgID, u1, u2, "completed", time.Now(), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.LogCall(context.Background(), orgID, u2, u1, "missed", time.Now(), nil); err != nil {
		t.Fatal(err)
	}

	resp, err := svc.ListCallHistory(ctx, &grownv1.ListCallHistoryRequest{})
	if err != nil {
		t.Fatalf("ListCallHistory: %v", err)
	}
	if len(resp.Calls) != 2 {
		t.Fatalf("calls: got %d want 2", len(resp.Calls))
	}
	for _, c := range resp.Calls {
		if c.CallerId == u1 && c.Direction != "outgoing" {
			t.Errorf("u1-as-caller: got direction %q want outgoing", c.Direction)
		}
		if c.CalleeId == u1 && c.Direction != "incoming" {
			t.Errorf("u1-as-callee: got direction %q want incoming", c.Direction)
		}
		if c.PeerName != "Bob" {
			t.Errorf("peer name: got %q want Bob", c.PeerName)
		}
	}
}
