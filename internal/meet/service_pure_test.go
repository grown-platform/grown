package meet

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

// --------------------------------------------------------------------------
// toProto — proto shaping (no DB)
// --------------------------------------------------------------------------

func TestToProto(t *testing.T) {
	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.FixedZone("PST", -8*3600))
	r := Room{
		ID:        "id-1",
		OrgID:     "org-1",
		OwnerID:   "owner-1",
		Name:      "Sprint review",
		Code:      "abc-defg-hij",
		CreatedAt: created,
	}
	p := toProto(r)
	if p.GetId() != "id-1" || p.GetOrgId() != "org-1" || p.GetOwnerId() != "owner-1" {
		t.Errorf("id fields: %+v", p)
	}
	if p.GetName() != "Sprint review" {
		t.Errorf("name: %q", p.GetName())
	}
	// CreatedAt is RFC3339 in UTC; PST -8 → 11:04:05Z.
	if p.GetCreatedAt() != "2026-01-02T11:04:05Z" {
		t.Errorf("created_at: got %q want UTC RFC3339", p.GetCreatedAt())
	}
}

// --------------------------------------------------------------------------
// callerOrg — auth short-circuits (no DB)
// --------------------------------------------------------------------------

func TestCallerOrg(t *testing.T) {
	withUser := func(ctx context.Context) context.Context {
		return auth.WithUser(ctx, users.User{ID: "u1", OrgID: "o1"})
	}
	withOrg := func(ctx context.Context) context.Context {
		return auth.WithOrg(ctx, orgs.Org{ID: "o1", Slug: "default"})
	}

	tests := []struct {
		name     string
		ctx      context.Context
		wantOrg  string
		wantCode codes.Code
	}{
		{
			name:     "no session",
			ctx:      context.Background(),
			wantCode: codes.Unauthenticated,
		},
		{
			name:     "user but no org",
			ctx:      withUser(context.Background()),
			wantCode: codes.Internal,
		},
		{
			name:    "user and org",
			ctx:     withOrg(withUser(context.Background())),
			wantOrg: "o1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			org, err := callerOrg(tt.ctx)
			if tt.wantCode != codes.OK {
				if status.Code(err) != tt.wantCode {
					t.Errorf("err code: got %v want %v", status.Code(err), tt.wantCode)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if org != tt.wantOrg {
				t.Errorf("org: got %q want %q", org, tt.wantOrg)
			}
		})
	}
}

// --------------------------------------------------------------------------
// Service gRPC methods — auth short-circuits without a repo/DB.
// --------------------------------------------------------------------------

func TestService_MethodsRequireSession(t *testing.T) {
	// nil repo: every path below must return before touching it.
	svc := NewService(nil)
	bg := context.Background()

	if _, err := svc.ListMeetRooms(bg, nil); status.Code(err) != codes.Unauthenticated {
		t.Errorf("ListMeetRooms: got %v want Unauthenticated", err)
	}
	if _, err := svc.CreateMeetRoom(bg, nil); status.Code(err) != codes.Unauthenticated {
		t.Errorf("CreateMeetRoom: got %v want Unauthenticated", err)
	}
	if _, err := svc.GetMeetRoom(bg, nil); status.Code(err) != codes.Unauthenticated {
		t.Errorf("GetMeetRoom: got %v want Unauthenticated", err)
	}
	if _, err := svc.DeleteMeetRoom(bg, nil); status.Code(err) != codes.Unauthenticated {
		t.Errorf("DeleteMeetRoom: got %v want Unauthenticated", err)
	}
}

func TestService_MethodsMissingOrg(t *testing.T) {
	svc := NewService(nil)
	// User on context but no org → Internal, still before repo use.
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1"})

	if _, err := svc.ListMeetRooms(ctx, nil); status.Code(err) != codes.Internal {
		t.Errorf("ListMeetRooms: got %v want Internal", err)
	}
	if _, err := svc.CreateMeetRoom(ctx, nil); status.Code(err) != codes.Internal {
		t.Errorf("CreateMeetRoom: got %v want Internal", err)
	}
	if _, err := svc.GetMeetRoom(ctx, nil); status.Code(err) != codes.Internal {
		t.Errorf("GetMeetRoom: got %v want Internal", err)
	}
	if _, err := svc.DeleteMeetRoom(ctx, nil); status.Code(err) != codes.Internal {
		t.Errorf("DeleteMeetRoom: got %v want Internal", err)
	}
}
