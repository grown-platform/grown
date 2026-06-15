package live

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

func TestTS(t *testing.T) {
	if got := ts(nil); got != "" {
		t.Errorf("ts(nil) = %q, want empty", got)
	}
	tm := time.Date(2026, 6, 15, 10, 30, 0, 0, time.FixedZone("PST", -8*3600))
	if got := ts(&tm); got != "2026-06-15T18:30:00Z" {
		t.Errorf("ts(&tm) = %q, want UTC RFC3339", got)
	}
}

func TestCanWatch(t *testing.T) {
	cases := []struct {
		name      string
		st        Stream
		callerOrg string
		want      bool
	}{
		{"public watchable by anyone", Stream{Visibility: VisibilityPublic, OrgID: "o1"}, "o2", true},
		{"public watchable by same org", Stream{Visibility: VisibilityPublic, OrgID: "o1"}, "o1", true},
		{"org stream same org", Stream{Visibility: VisibilityOrg, OrgID: "o1"}, "o1", true},
		{"org stream different org", Stream{Visibility: VisibilityOrg, OrgID: "o1"}, "o2", false},
		{"unknown visibility treated as org", Stream{Visibility: "weird", OrgID: "o1"}, "o2", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := canWatch(c.st, c.callerOrg); got != c.want {
				t.Errorf("canWatch = %v, want %v", got, c.want)
			}
		})
	}
}

func TestCaller(t *testing.T) {
	t.Run("no user", func(t *testing.T) {
		_, _, err := caller(context.Background())
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("got %v, want Unauthenticated", err)
		}
	})
	t.Run("user but no org", func(t *testing.T) {
		ctx := auth.WithUser(context.Background(), users.User{ID: "u1"})
		_, _, err := caller(ctx)
		if status.Code(err) != codes.Internal {
			t.Errorf("got %v, want Internal", err)
		}
	})
	t.Run("user and org", func(t *testing.T) {
		ctx := auth.WithUser(context.Background(), users.User{ID: "u1"})
		ctx = auth.WithOrg(ctx, orgs.Org{ID: "o1"})
		uid, oid, err := caller(ctx)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if uid != "u1" || oid != "o1" {
			t.Errorf("got (%q,%q), want (u1,o1)", uid, oid)
		}
	})
}

func sampleStream() Stream {
	started := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	return Stream{
		ID:          "id1",
		OrgID:       "org1",
		OwnerID:     "owner1",
		OwnerName:   "Owner One",
		Title:       "My Stream",
		Description: "desc",
		StreamKey:   "secretkey",
		Path:        "path1",
		Status:      StatusLive,
		Visibility:  VisibilityPublic,
		StartedAt:   &started,
		CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC),
	}
}

func TestToProtoSecretsGating(t *testing.T) {
	s := &Service{urls: URLConfig{
		HLSBase:  "/live-hls",
		WHEPBase: "/live-webrtc",
		WHIPBase: "/live-webrtc",
		RTMPHost: "media:1935",
	}}
	st := sampleStream()

	t.Run("includeSecrets true", func(t *testing.T) {
		out := s.toProto(st, true)
		if out.StreamKey != "secretkey" {
			t.Errorf("StreamKey = %q, want secretkey", out.StreamKey)
		}
		if out.IngestRtmpUrl != "rtmp://media:1935/path1" {
			t.Errorf("IngestRtmpUrl = %q", out.IngestRtmpUrl)
		}
		if out.IngestWhipUrl != "/live-webrtc/path1/whip" {
			t.Errorf("IngestWhipUrl = %q", out.IngestWhipUrl)
		}
	})

	t.Run("includeSecrets false blanks secrets", func(t *testing.T) {
		out := s.toProto(st, false)
		if out.StreamKey != "" || out.IngestRtmpUrl != "" || out.IngestWhipUrl != "" {
			t.Errorf("secrets leaked: key=%q rtmp=%q whip=%q", out.StreamKey, out.IngestRtmpUrl, out.IngestWhipUrl)
		}
		// Playback URLs are always present.
		if out.HlsUrl != "/live-hls/path1/index.m3u8" {
			t.Errorf("HlsUrl = %q", out.HlsUrl)
		}
		if out.WhepUrl != "/live-webrtc/path1/whep" {
			t.Errorf("WhepUrl = %q", out.WhepUrl)
		}
	})
}

func TestToProtoFieldMapping(t *testing.T) {
	s := &Service{}
	st := sampleStream()
	out := s.toProto(st, true)
	if out.Id != "id1" || out.OrgId != "org1" || out.OwnerId != "owner1" {
		t.Errorf("id/org/owner mismatch: %+v", out)
	}
	if out.OwnerName != "Owner One" || out.Title != "My Stream" || out.Description != "desc" {
		t.Errorf("name/title/desc mismatch: %+v", out)
	}
	if out.Visibility != VisibilityPublic || out.Status != StatusLive || out.Path != "path1" {
		t.Errorf("vis/status/path mismatch: %+v", out)
	}
	if out.StartedAt != "2026-01-02T03:04:05Z" {
		t.Errorf("StartedAt = %q", out.StartedAt)
	}
	if out.EndedAt != "" {
		t.Errorf("EndedAt = %q, want empty for nil", out.EndedAt)
	}
	if out.CreatedAt != "2026-01-01T00:00:00Z" || out.UpdatedAt != "2026-01-01T01:00:00Z" {
		t.Errorf("created/updated mismatch: %q %q", out.CreatedAt, out.UpdatedAt)
	}
}

// The RPC entrypoints all call caller(ctx) first; with no auth context they
// must short-circuit Unauthenticated before ever touching the (nil) repo.
func TestRPCsUnauthenticated(t *testing.T) {
	s := NewService(nil, URLConfig{})
	ctx := context.Background()
	cases := []struct {
		name string
		call func() error
	}{
		{"CreateStream", func() error { _, e := s.CreateStream(ctx, &grownv1.LiveCreateStreamRequest{}); return e }},
		{"ListStreams", func() error { _, e := s.ListStreams(ctx, &grownv1.LiveListStreamsRequest{}); return e }},
		{"GetStream", func() error { _, e := s.GetStream(ctx, &grownv1.LiveGetStreamRequest{}); return e }},
		{"UpdateStream", func() error { _, e := s.UpdateStream(ctx, &grownv1.LiveUpdateStreamRequest{}); return e }},
		{"DeleteStream", func() error { _, e := s.DeleteStream(ctx, &grownv1.LiveDeleteStreamRequest{}); return e }},
		{"EndStream", func() error { _, e := s.EndStream(ctx, &grownv1.LiveEndStreamRequest{}); return e }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := c.call(); status.Code(err) != codes.Unauthenticated {
				t.Errorf("%s err = %v, want Unauthenticated", c.name, err)
			}
		})
	}
}
