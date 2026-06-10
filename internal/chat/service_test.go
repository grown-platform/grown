package chat

import (
	"context"
	"encoding/json"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// jsonUnmarshal is a thin wrapper so test code doesn't import encoding/json
// directly in multiple places.
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func authCtx(orgID, userID, displayName string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{
		ID:          userID,
		OrgID:       orgID,
		Email:       displayName + "@test.me",
		DisplayName: displayName,
	})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestService_CreateListGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	// Create a group channel.
	ch, err := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "General"})
	if err != nil {
		t.Fatalf("CreateChatChannel: %v", err)
	}
	if ch.GetId() == "" || ch.GetName() != "General" {
		t.Fatalf("unexpected channel: %+v", ch)
	}

	// List returns it.
	list, err := svc.ListChatChannels(ctx, &grownv1.ListChatChannelsRequest{})
	if err != nil {
		t.Fatalf("ListChatChannels: %v", err)
	}
	if len(list.GetChannels()) != 1 {
		t.Fatalf("got %d channels, want 1", len(list.GetChannels()))
	}

	// GetChatChannel works.
	got, err := svc.GetChatChannel(ctx, &grownv1.GetChatChannelRequest{Id: ch.GetId()})
	if err != nil {
		t.Fatalf("GetChatChannel: %v", err)
	}
	if got.GetId() != ch.GetId() {
		t.Errorf("id mismatch")
	}
}

func TestService_DM_Deduplication(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	other := seedSecondUser(t, pool, orgID)
	svc := NewService(NewRepository(pool), nil)

	ctxA := authCtx(orgID, userID, "Tester")
	ctxB := authCtx(orgID, other, "Other")

	ch1, err := svc.CreateChatChannel(ctxA, &grownv1.CreateChatChannelRequest{
		Kind:      "dm",
		MemberIds: []string{other},
	})
	if err != nil {
		t.Fatalf("CreateChatChannel (1): %v", err)
	}
	ch2, err := svc.CreateChatChannel(ctxB, &grownv1.CreateChatChannelRequest{
		Kind:      "dm",
		MemberIds: []string{userID},
	})
	if err != nil {
		t.Fatalf("CreateChatChannel (2): %v", err)
	}
	if ch1.GetId() != ch2.GetId() {
		t.Errorf("DM was not deduplicated: %q vs %q", ch1.GetId(), ch2.GetId())
	}
}

func TestService_PostAndListMessages(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})

	_, err := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{
		ChannelId: ch.GetId(),
		Body:      "hello",
	})
	if err != nil {
		t.Fatalf("PostChatMessage: %v", err)
	}

	msgs, err := svc.ListChatMessages(ctx, &grownv1.ListChatMessagesRequest{
		ChannelId: ch.GetId(),
	})
	if err != nil {
		t.Fatalf("ListChatMessages: %v", err)
	}
	if len(msgs.GetMessages()) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs.GetMessages()))
	}
	if msgs.GetMessages()[0].GetBody() != "hello" {
		t.Errorf("body: got %q", msgs.GetMessages()[0].GetBody())
	}
}

func TestService_DeleteMessage(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})
	m, _ := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{ChannelId: ch.GetId(), Body: "bye"})

	_, err := svc.DeleteChatMessage(ctx, &grownv1.DeleteChatMessageRequest{
		ChannelId: ch.GetId(),
		Id:        m.GetId(),
	})
	if err != nil {
		t.Fatalf("DeleteChatMessage: %v", err)
	}
	_, err = svc.DeleteChatMessage(ctx, &grownv1.DeleteChatMessageRequest{
		ChannelId: ch.GetId(),
		Id:        m.GetId(),
	})
	if status.Code(err) != codes.NotFound {
		t.Errorf("double delete: got code %v, want NotFound", status.Code(err))
	}
}

func TestService_Unauthenticated(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool), nil)

	_, err := svc.ListChatChannels(context.Background(), &grownv1.ListChatChannelsRequest{})
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("want Unauthenticated, got %v", status.Code(err))
	}
}

func TestService_Reactions(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})
	m, _ := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{ChannelId: ch.GetId(), Body: "hello"})

	// Add a reaction.
	resp, err := svc.ReactToChatMessage(ctx, &grownv1.ReactToChatMessageRequest{
		ChannelId: ch.GetId(),
		MessageId: m.GetId(),
		Emoji:     "👍",
	})
	if err != nil {
		t.Fatalf("ReactToChatMessage add: %v", err)
	}
	if len(resp.GetReactionDetails()) != 1 || resp.GetReactionDetails()[0].GetEmoji() != "👍" {
		t.Errorf("unexpected reactions: %v", resp.GetReactionDetails())
	}
	if !resp.GetReactionDetails()[0].GetMe() {
		t.Error("me flag should be true after adding")
	}

	// Toggle off.
	resp2, err := svc.ReactToChatMessage(ctx, &grownv1.ReactToChatMessageRequest{
		ChannelId: ch.GetId(),
		MessageId: m.GetId(),
		Emoji:     "👍",
	})
	if err != nil {
		t.Fatalf("ReactToChatMessage remove: %v", err)
	}
	if len(resp2.GetReactionDetails()) != 0 {
		t.Errorf("expected empty after toggle-off, got: %v", resp2.GetReactionDetails())
	}
}

func TestService_Threads(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})
	parent, _ := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{ChannelId: ch.GetId(), Body: "root"})

	// Post a thread reply.
	reply, err := svc.PostThreadReply(ctx, &grownv1.PostThreadReplyRequest{
		ChannelId: ch.GetId(),
		ParentId:  parent.GetId(),
		Body:      "reply 1",
	})
	if err != nil {
		t.Fatalf("PostThreadReply: %v", err)
	}
	if reply.GetParentId() != parent.GetId() {
		t.Errorf("parent_id: got %q want %q", reply.GetParentId(), parent.GetId())
	}

	// List thread replies.
	thread, err := svc.ListThreadReplies(ctx, &grownv1.ListThreadRepliesRequest{
		ChannelId: ch.GetId(),
		ParentId:  parent.GetId(),
	})
	if err != nil {
		t.Fatalf("ListThreadReplies: %v", err)
	}
	if len(thread.GetMessages()) != 1 {
		t.Fatalf("got %d replies, want 1", len(thread.GetMessages()))
	}
	if thread.GetMessages()[0].GetBody() != "reply 1" {
		t.Errorf("reply body: %q", thread.GetMessages()[0].GetBody())
	}

	// Top-level list should include reply_count.
	list, _ := svc.ListChatMessages(ctx, &grownv1.ListChatMessagesRequest{ChannelId: ch.GetId()})
	if len(list.GetMessages()) != 1 {
		t.Fatalf("top-level: got %d, want 1", len(list.GetMessages()))
	}
	if list.GetMessages()[0].GetReplyCount() != 1 {
		t.Errorf("reply_count: got %d, want 1", list.GetMessages()[0].GetReplyCount())
	}
}

func TestService_OrgScoping(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	_, err := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})
	if err != nil {
		t.Fatal(err)
	}

	// Different org context should see 0 channels.
	ctxOther := authCtx("00000000-0000-0000-0000-000000000001", userID, "Tester")
	list, err := svc.ListChatChannels(ctxOther, &grownv1.ListChatChannelsRequest{})
	if err != nil {
		t.Fatalf("list with different org: %v", err)
	}
	if len(list.GetChannels()) != 0 {
		t.Errorf("cross-org leak: got %d channels", len(list.GetChannels()))
	}
}

func TestService_NonceEchoedInResponse(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool), nil)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})

	const nonce = "abc123testNonce"
	m, err := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{
		ChannelId:   ch.GetId(),
		Body:        "hello with nonce",
		ClientNonce: nonce,
	})
	if err != nil {
		t.Fatalf("PostChatMessage: %v", err)
	}
	if m.GetClientNonce() != nonce {
		t.Errorf("nonce: got %q, want %q", m.GetClientNonce(), nonce)
	}
}

func TestService_HubBroadcastOnPost(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	hub := NewHub()
	svc := NewService(NewRepository(pool), hub)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})

	// Subscribe a fake peer so we can receive the broadcast.
	p := &peer{userID: userID, out: make(chan []byte, 8)}
	room := hub.add(ch.GetId(), p)
	defer hub.remove(ch.GetId(), room, p)

	_, err := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{
		ChannelId: ch.GetId(),
		Body:      "broadcast test",
	})
	if err != nil {
		t.Fatalf("PostChatMessage: %v", err)
	}

	// The hub should have delivered exactly one message event to our peer.
	// (Plus possibly a presence event — drain and count "message" type.)
	messageCount := 0
	for range len(p.out) {
		raw := <-p.out
		var env WSMessage
		if err := jsonUnmarshal(raw, &env); err == nil && env.Type == "message" {
			messageCount++
		}
	}
	if messageCount != 1 {
		t.Errorf("expected 1 broadcast message event, got %d", messageCount)
	}
}

func TestService_HubBroadcastOnDelete(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	hub := NewHub()
	svc := NewService(NewRepository(pool), hub)
	ctx := authCtx(orgID, userID, "Tester")

	ch, _ := svc.CreateChatChannel(ctx, &grownv1.CreateChatChannelRequest{Kind: "group", Name: "G"})
	msg, _ := svc.PostChatMessage(ctx, &grownv1.PostChatMessageRequest{ChannelId: ch.GetId(), Body: "to delete"})

	// Subscribe after post so the post broadcast is not in the buffer.
	p := &peer{userID: userID, out: make(chan []byte, 8)}
	room := hub.add(ch.GetId(), p)
	defer hub.remove(ch.GetId(), room, p)

	_, err := svc.DeleteChatMessage(ctx, &grownv1.DeleteChatMessageRequest{
		ChannelId: ch.GetId(),
		Id:        msg.GetId(),
	})
	if err != nil {
		t.Fatalf("DeleteChatMessage: %v", err)
	}

	deleteCount := 0
	for range len(p.out) {
		raw := <-p.out
		var env WSMessage
		if err := jsonUnmarshal(raw, &env); err == nil && env.Type == "deleted" {
			deleteCount++
		}
	}
	if deleteCount != 1 {
		t.Errorf("expected 1 broadcast deleted event, got %d", deleteCount)
	}
}
