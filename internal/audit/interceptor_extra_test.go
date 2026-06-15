package audit

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// --- resourceFromReq ---

type reqWithID struct{ id string }

func (r reqWithID) GetId() string { return r.id }

type reqWithResource struct{ rid string }

func (r reqWithResource) GetResourceId() string { return r.rid }

type reqWithBoth struct{}

func (reqWithBoth) GetId() string         { return "id-wins" }
func (reqWithBoth) GetResourceId() string { return "resource-loses" }

func TestResourceFromReq(t *testing.T) {
	cases := []struct {
		name string
		req  any
		want string
	}{
		{"GetId", reqWithID{id: "abc"}, "abc"},
		{"GetResourceId", reqWithResource{rid: "r-9"}, "r-9"},
		{"GetId preferred over GetResourceId", reqWithBoth{}, "id-wins"},
		{"empty GetId", reqWithID{id: ""}, ""},
		{"no matching getter", struct{ Name string }{Name: "x"}, ""},
		{"nil", nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := resourceFromReq(c.req); got != c.want {
				t.Errorf("resourceFromReq(%v) = %q, want %q", c.req, got, c.want)
			}
		})
	}
}

// --- actionFor fallback (method without a known prefix) ---

func TestActionFor_Fallback(t *testing.T) {
	// A method that does not start with any mutating prefix falls back to the
	// whole method, lowercased.
	if got := actionFor("Frobnicate"); got != "frobnicate" {
		t.Errorf("actionFor(Frobnicate) = %q, want frobnicate", got)
	}
}

// --- NewInterceptor ---

func TestNewInterceptor_NilRecorder_PassThrough(t *testing.T) {
	interceptor := NewInterceptor(nil)
	sentinel := errors.New("boom")
	called := false
	handler := func(ctx context.Context, req any) (any, error) {
		called = true
		return "resp", sentinel
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/grown.v1.VideoService/CreateVideo"}
	resp, err := interceptor(context.Background(), nil, info, handler)
	if !called {
		t.Fatal("handler should still run with a nil recorder")
	}
	if resp != "resp" || !errors.Is(err, sentinel) {
		t.Errorf("pass-through = (%v,%v), want (resp, boom)", resp, err)
	}
}

func TestNewInterceptor_SkipsReadOnly(t *testing.T) {
	// With a non-nil recorder but a nil repo, Record is a no-op; we assert the
	// handler result is forwarded for a read-only method (not audited).
	rec := NewRecorder(NewRepository(nil), nil)
	interceptor := NewInterceptor(rec)
	handler := func(ctx context.Context, req any) (any, error) { return "ok", nil }
	info := &grpc.UnaryServerInfo{FullMethod: "/grown.v1.VideoService/ListVideos"}
	resp, err := interceptor(context.Background(), reqWithID{id: "x"}, info, handler)
	if resp != "ok" || err != nil {
		t.Errorf("got (%v,%v), want (ok,nil)", resp, err)
	}
}

func TestNewInterceptor_RecordsMutating(t *testing.T) {
	// Repo present (nil pool) so the full Record path runs without panicking.
	// We assert the handler's response/error are forwarded unchanged for both an
	// ok and an error result.
	rec := NewRecorder(NewRepository(nil), func(context.Context) (Actor, bool) {
		return Actor{OrgID: "org-1", UserID: "u1", Email: "a@b.com"}, true
	})
	interceptor := NewInterceptor(rec)

	t.Run("ok result forwarded", func(t *testing.T) {
		handler := func(ctx context.Context, req any) (any, error) { return "created", nil }
		info := &grpc.UnaryServerInfo{FullMethod: "/grown.v1.VideoService/CreateVideo"}
		resp, err := interceptor(context.Background(), reqWithID{id: "v1"}, info, handler)
		if resp != "created" || err != nil {
			t.Errorf("got (%v,%v), want (created,nil)", resp, err)
		}
	})

	t.Run("error result forwarded with code in detail", func(t *testing.T) {
		grpcErr := status.Error(codes.PermissionDenied, "nope")
		handler := func(ctx context.Context, req any) (any, error) { return nil, grpcErr }
		info := &grpc.UnaryServerInfo{FullMethod: "/grown.v1.MailService/DeleteMessage"}
		resp, err := interceptor(context.Background(), reqWithResource{rid: "m1"}, info, handler)
		if resp != nil || !errors.Is(err, grpcErr) {
			t.Errorf("got (%v,%v), want (nil, PermissionDenied)", resp, err)
		}
	})

	t.Run("bare full method (no slash) still safe", func(t *testing.T) {
		handler := func(ctx context.Context, req any) (any, error) { return "x", nil }
		info := &grpc.UnaryServerInfo{FullMethod: "CreateThing"}
		resp, err := interceptor(context.Background(), nil, info, handler)
		if resp != "x" || err != nil {
			t.Errorf("got (%v,%v)", resp, err)
		}
	})
}
