package auth

import (
	"context"
	"testing"

	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func TestUserFromContext_Empty(t *testing.T) {
	if _, ok := UserFromContext(context.Background()); ok {
		t.Error("expected no user on empty context")
	}
}

func TestUserFromContext_RoundTrip(t *testing.T) {
	want := users.User{ID: "u1", OrgID: "o1", Email: "x@example.com"}
	ctx := WithUser(context.Background(), want)
	got, ok := UserFromContext(ctx)
	if !ok {
		t.Fatal("expected user on context")
	}
	if got.ID != want.ID || got.OrgID != want.OrgID || got.Email != want.Email {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestOrgFromContext_Empty(t *testing.T) {
	if _, ok := OrgFromContext(context.Background()); ok {
		t.Error("expected no org on empty context")
	}
}

func TestOrgFromContext_RoundTrip(t *testing.T) {
	want := orgs.Org{ID: "o1", Slug: "default", DisplayName: "Default"}
	ctx := WithOrg(context.Background(), want)
	got, ok := OrgFromContext(ctx)
	if !ok {
		t.Fatal("expected org on context")
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestUserAndOrg_DoNotCollide(t *testing.T) {
	u := users.User{ID: "u1"}
	o := orgs.Org{ID: "o1"}
	ctx := WithUser(WithOrg(context.Background(), o), u)

	gu, _ := UserFromContext(ctx)
	go_, _ := OrgFromContext(ctx)

	if gu.ID != "u1" || go_.ID != "o1" {
		t.Errorf("got user=%+v, org=%+v", gu, go_)
	}
}
