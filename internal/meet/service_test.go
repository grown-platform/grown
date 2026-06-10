package meet

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

func authCtx(orgID, userID string) context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: userID, OrgID: orgID, Email: "tester@test.me", DisplayName: "Tester"})
	return auth.WithOrg(ctx, orgs.Org{ID: orgID, Slug: "default", DisplayName: "Default"})
}

func TestService_RequiresAuth(t *testing.T) {
	pool, _, _ := setupDB(t)
	svc := NewService(NewRepository(pool))
	if _, err := svc.ListMeetRooms(context.Background(), &grownv1.ListMeetRoomsRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("ListMeetRooms without session: got %v want Unauthenticated", err)
	}
}

func TestService_RoomCRUDRoundTrip(t *testing.T) {
	pool, orgID, userID := setupDB(t)
	svc := NewService(NewRepository(pool))
	ctx := authCtx(orgID, userID)

	room, err := svc.CreateMeetRoom(ctx, &grownv1.CreateMeetRoomRequest{Name: "Standup"})
	if err != nil {
		t.Fatalf("CreateMeetRoom: %v", err)
	}
	if room.Id == "" || room.Name != "Standup" {
		t.Fatalf("room: %+v", room)
	}

	got, err := svc.GetMeetRoom(ctx, &grownv1.GetMeetRoomRequest{Id: room.Id})
	if err != nil || got.Id != room.Id {
		t.Fatalf("GetMeetRoom: %+v err=%v", got, err)
	}

	list, err := svc.ListMeetRooms(ctx, &grownv1.ListMeetRoomsRequest{})
	if err != nil || len(list.Rooms) != 1 {
		t.Fatalf("ListMeetRooms: got %d err=%v", len(list.GetRooms()), err)
	}

	if _, err := svc.DeleteMeetRoom(ctx, &grownv1.DeleteMeetRoomRequest{Id: room.Id}); err != nil {
		t.Fatalf("DeleteMeetRoom: %v", err)
	}
	if _, err := svc.GetMeetRoom(ctx, &grownv1.GetMeetRoomRequest{Id: room.Id}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetMeetRoom after delete: got %v want NotFound", err)
	}
}
