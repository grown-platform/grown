package forms

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

func authedCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, Email: "tester@test.me", DisplayName: "Tester"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestService_RequiresAuth(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool))
	if _, err := svc.ListForms(context.Background(), &grownv1.ListFormsRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("ListForms without session: got %v want Unauthenticated", err)
	}
}

func TestService_CreateListGet(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authedCtx(orgID, userID)

	f, err := svc.CreateForm(ctx, &grownv1.CreateFormRequest{Title: "Onboarding Survey"})
	if err != nil {
		t.Fatalf("CreateForm: %v", err)
	}
	if f.Id == "" || f.Title != "Onboarding Survey" {
		t.Fatalf("form: %+v", f)
	}

	list, err := svc.ListForms(ctx, &grownv1.ListFormsRequest{})
	if err != nil || len(list.Forms) != 1 {
		t.Fatalf("ListForms: got %d err=%v", len(list.GetForms()), err)
	}

	got, err := svc.GetForm(ctx, &grownv1.GetFormRequest{Id: f.Id})
	if err != nil || got.Id != f.Id {
		t.Fatalf("GetForm: %+v err=%v", got, err)
	}
}
