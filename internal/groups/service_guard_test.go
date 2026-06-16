package groups

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// ctxNoUser has neither user nor org attached.
func ctxNoUser() context.Context { return context.Background() }

// ctxUserNoOrg has a user but no org (internal error path).
func ctxUserNoOrg() context.Context {
	return auth.WithUser(context.Background(), users.User{ID: "u1", Email: "u1@org"})
}

// ctxFull has both a user and an org attached.
func ctxFull(u users.User) context.Context {
	o := orgs.Org{ID: "o1", Slug: "default", DisplayName: "Default"}
	return auth.WithUser(auth.WithOrg(context.Background(), o), u)
}

func wantCode(t *testing.T, err error, want codes.Code) {
	t.Helper()
	if status.Code(err) != want {
		t.Fatalf("status code = %v, want %v (err=%v)", status.Code(err), want, err)
	}
}

// ── callerOrg / callerUser guards ──────────────────────────────────────────────

func TestCallerOrg(t *testing.T) {
	t.Run("no session", func(t *testing.T) {
		_, err := callerOrg(ctxNoUser())
		wantCode(t, err, codes.Unauthenticated)
	})
	t.Run("missing org", func(t *testing.T) {
		_, err := callerOrg(ctxUserNoOrg())
		wantCode(t, err, codes.Internal)
	})
	t.Run("ok", func(t *testing.T) {
		orgID, err := callerOrg(ctxFull(users.User{ID: "u1"}))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if orgID != "o1" {
			t.Fatalf("orgID = %q, want o1", orgID)
		}
	})
}

func TestCallerUser(t *testing.T) {
	t.Run("no session", func(t *testing.T) {
		_, _, _, err := callerUser(ctxNoUser())
		wantCode(t, err, codes.Unauthenticated)
	})
	t.Run("missing org", func(t *testing.T) {
		_, _, _, err := callerUser(ctxUserNoOrg())
		wantCode(t, err, codes.Internal)
	})
	t.Run("uses display name", func(t *testing.T) {
		id, orgID, name, err := callerUser(ctxFull(users.User{ID: "u1", DisplayName: "Alice", Email: "a@org"}))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if id != "u1" || orgID != "o1" || name != "Alice" {
			t.Fatalf("got (%q,%q,%q), want (u1,o1,Alice)", id, orgID, name)
		}
	})
	t.Run("falls back to email when display name empty", func(t *testing.T) {
		_, _, name, err := callerUser(ctxFull(users.User{ID: "u1", Email: "a@org"}))
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if name != "a@org" {
			t.Fatalf("name = %q, want fallback to email a@org", name)
		}
	})
}

// ── Unauthenticated short-circuits across all RPCs ──────────────────────────────
//
// With no session attached, every RPC must return Unauthenticated before it ever
// touches the (nil) repo. A panic here would mean the guard was bypassed.

func TestRPCs_Unauthenticated(t *testing.T) {
	s := NewService(nil)
	ctx := ctxNoUser()
	tests := []struct {
		name string
		call func() error
	}{
		{"ListMembers", func() error { _, e := s.ListMembers(ctx, &grownv1.ListGroupMembersRequest{}); return e }},
		{"ListGroups", func() error { _, e := s.ListGroups(ctx, &grownv1.ListGroupsRequest{}); return e }},
		{"CreateGroup", func() error { _, e := s.CreateGroup(ctx, &grownv1.CreateGroupRequest{Name: "x"}); return e }},
		{"GetGroup", func() error { _, e := s.GetGroup(ctx, &grownv1.GetGroupRequest{Id: "g"}); return e }},
		{"UpdateGroup", func() error { _, e := s.UpdateGroup(ctx, &grownv1.UpdateGroupRequest{Id: "g", Name: "x"}); return e }},
		{"DeleteGroup", func() error { _, e := s.DeleteGroup(ctx, &grownv1.DeleteGroupRequest{Id: "g"}); return e }},
		{"ListTopics", func() error { _, e := s.ListTopics(ctx, &grownv1.ListTopicsRequest{GroupId: "g"}); return e }},
		{"CreateTopic", func() error { _, e := s.CreateTopic(ctx, &grownv1.CreateTopicRequest{GroupId: "g", Subject: "s"}); return e }},
		{"ListPosts", func() error { _, e := s.ListPosts(ctx, &grownv1.ListPostsRequest{TopicId: "t"}); return e }},
		{"CreatePost", func() error { _, e := s.CreatePost(ctx, &grownv1.CreatePostRequest{TopicId: "t", Body: "b"}); return e }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantCode(t, tt.call(), codes.Unauthenticated)
		})
	}
}

// ── Validation short-circuits (authed, but invalid args, nil repo) ──────────────
//
// These run with a full context so the auth guards pass, but the input fails
// validation before the repo is consulted — so a nil repo must not panic.

func TestRPCs_InvalidArgument(t *testing.T) {
	s := NewService(nil)
	ctx := ctxFull(users.User{ID: "u1", DisplayName: "Alice"})
	tests := []struct {
		name string
		call func() error
	}{
		{"CreateGroup empty name", func() error { _, e := s.CreateGroup(ctx, &grownv1.CreateGroupRequest{}); return e }},
		{"UpdateGroup empty name", func() error { _, e := s.UpdateGroup(ctx, &grownv1.UpdateGroupRequest{Id: "g"}); return e }},
		{"CreateTopic empty subject", func() error { _, e := s.CreateTopic(ctx, &grownv1.CreateTopicRequest{GroupId: "g"}); return e }},
		{"CreatePost empty body", func() error { _, e := s.CreatePost(ctx, &grownv1.CreatePostRequest{TopicId: "t"}); return e }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wantCode(t, tt.call(), codes.InvalidArgument)
		})
	}
}
