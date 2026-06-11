package groups_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
)

// routeStub records which RPC the gateway dispatched to. It only overrides the
// two methods that collide on /api/v1/groups/members.
type routeStub struct {
	grownv1.UnimplementedGroupsServiceServer
	called string
}

func (s *routeStub) ListMembers(context.Context, *grownv1.ListGroupMembersRequest) (*grownv1.ListGroupMembersResponse, error) {
	s.called = "ListMembers"
	return &grownv1.ListGroupMembersResponse{}, nil
}

func (s *routeStub) GetGroup(_ context.Context, req *grownv1.GetGroupRequest) (*grownv1.Group, error) {
	s.called = "GetGroup:" + req.GetId()
	return &grownv1.Group{}, nil
}

// TestGroupsMembersRouting pins the fix for the /api/v1/groups/members vs
// /api/v1/groups/{id} collision: the literal members route must reach
// ListMembers, not GetGroup with id="members" (which 500s on the UUID cast).
func TestGroupsMembersRouting(t *testing.T) {
	stub := &routeStub{}
	mux := runtime.NewServeMux()
	if err := grownv1.RegisterGroupsServiceHandlerServer(context.Background(), mux, stub); err != nil {
		t.Fatalf("register gateway: %v", err)
	}

	// The literal members route must reach ListMembers.
	stub.called = ""
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/groups/members", nil))
	if stub.called != "ListMembers" {
		t.Fatalf("GET /api/v1/groups/members routed to %q, want ListMembers (HTTP %d)", stub.called, rec.Code)
	}

	// A real group id must still reach GetGroup with the id captured.
	stub.called = ""
	rec = httptest.NewRecorder()
	const id = "0b5d9c4e-2f1a-4d3b-8c7e-1a2b3c4d5e6f"
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/groups/"+id, nil))
	if stub.called != "GetGroup:"+id {
		t.Fatalf("GET /api/v1/groups/%s routed to %q, want GetGroup:%s (HTTP %d)", id, stub.called, id, rec.Code)
	}
}
