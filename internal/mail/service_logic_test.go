package mail

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
	"code.pick.haus/grown/grown/internal/orgs"
	"code.pick.haus/grown/grown/internal/users"
)

func TestSnippetOf(t *testing.T) {
	tests := []struct {
		name, in, want string
	}{
		{"collapses whitespace", "hello   world\n\tfoo", "hello world foo"},
		{"empty", "", ""},
		{"short unchanged", "short body", "short body"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := snippetOf(tt.in); got != tt.want {
				t.Errorf("snippetOf(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
	t.Run("truncates long body with ellipsis", func(t *testing.T) {
		long := strings.Repeat("a", 200)
		got := snippetOf(long)
		if !strings.HasSuffix(got, "…") {
			t.Errorf("expected ellipsis suffix, got %q", got)
		}
		// 140 runes + ellipsis.
		if len([]rune(got)) != 141 {
			t.Errorf("rune length = %d, want 141", len([]rune(got)))
		}
	})
}

func TestSnoozeStr(t *testing.T) {
	if got := snoozeStr(nil); got != "" {
		t.Errorf("nil snooze = %q, want empty", got)
	}
	ts := time.Date(2026, 6, 11, 8, 30, 0, 0, time.UTC)
	got := snoozeStr(&ts)
	if got != "2026-06-11T08:30:00Z" {
		t.Errorf("snoozeStr = %q", got)
	}
}

func TestMapErr(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"not found -> NotFound", ErrNotFound, codes.NotFound},
		{"wrapped not found", fmt.Errorf("ctx: %w", ErrNotFound), codes.NotFound},
		{"not implemented -> Unimplemented", ErrNotImplemented, codes.Unimplemented},
		{"other -> Internal", errors.New("boom"), codes.Internal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := mapErr(tt.err, "doing thing")
			if status.Code(err) != tt.want {
				t.Errorf("mapErr code = %v, want %v", status.Code(err), tt.want)
			}
		})
	}
}

func TestCaller(t *testing.T) {
	t.Run("no user -> Unauthenticated", func(t *testing.T) {
		_, err := caller(context.Background())
		if status.Code(err) != codes.Unauthenticated {
			t.Errorf("code = %v, want Unauthenticated", status.Code(err))
		}
	})
	t.Run("no org -> Internal", func(t *testing.T) {
		ctx := auth.WithUser(context.Background(), users.User{ID: "u1", Email: "x@y.com"})
		_, err := caller(ctx)
		if status.Code(err) != codes.Internal {
			t.Errorf("code = %v, want Internal", status.Code(err))
		}
	})
	t.Run("display name used as Name", func(t *testing.T) {
		ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1", Email: "x@y.com", DisplayName: "Ex"})
		ctx = auth.WithOrg(ctx, orgs.Org{ID: "o1"})
		c, err := caller(ctx)
		if err != nil {
			t.Fatalf("caller: %v", err)
		}
		if c.UserID != "u1" || c.OrgID != "o1" || c.Email != "x@y.com" || c.Name != "Ex" {
			t.Errorf("caller = %+v", c)
		}
	})
	t.Run("falls back to email when no display name", func(t *testing.T) {
		ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1", Email: "x@y.com"})
		ctx = auth.WithOrg(ctx, orgs.Org{ID: "o1"})
		c, _ := caller(ctx)
		if c.Name != "x@y.com" {
			t.Errorf("Name = %q, want email fallback", c.Name)
		}
	})
}

func TestToProto(t *testing.T) {
	sent := time.Date(2026, 6, 11, 10, 0, 0, 0, time.UTC)
	snooze := time.Date(2026, 6, 12, 10, 0, 0, 0, time.UTC)
	m := Message{
		ID: "m1", ThreadID: "t1", Folder: "inbox",
		FromAddr: "a@x.com", FromName: "A",
		ToAddrs: []string{"b@x.com"}, CcAddrs: []string{"c@x.com"},
		Subject: "S", Body: "B", Snippet: "Sn",
		IsRead: true, Starred: true, Labels: []string{"L"},
		Attachments: []Attachment{{ID: "att1", Filename: "f.txt", ContentType: "text/plain", Size: 5}},
		SentAt:      sent, SnoozeUntil: &snooze,
	}
	p := toProto(m)
	if p.GetId() != "m1" || p.GetThreadId() != "t1" || p.GetFolder() != "inbox" {
		t.Errorf("ids/folder wrong: %+v", p)
	}
	if p.GetSentAt() != "2026-06-11T10:00:00Z" {
		t.Errorf("sent_at = %q", p.GetSentAt())
	}
	if p.GetSnoozeUntil() != "2026-06-12T10:00:00Z" {
		t.Errorf("snooze_until = %q", p.GetSnoozeUntil())
	}
	if len(p.GetAttachments()) != 1 || p.GetAttachments()[0].GetFilename() != "f.txt" {
		t.Errorf("attachments wrong: %+v", p.GetAttachments())
	}
	if !p.GetIsRead() || !p.GetStarred() {
		t.Errorf("flags lost")
	}
}

func TestAttachmentsToProto(t *testing.T) {
	got := attachmentsToProto(nil)
	if len(got) != 0 {
		t.Errorf("nil -> %d, want empty (non-nil)", len(got))
	}
	got = attachmentsToProto([]Attachment{{ID: "1", Filename: "a", ContentType: "text/x", Size: 9}})
	if len(got) != 1 || got[0].GetId() != "1" || got[0].GetSize() != 9 {
		t.Errorf("attachmentsToProto = %+v", got)
	}
}

func TestThreadToProto(t *testing.T) {
	tr := Thread{
		ThreadID: "t1", MessageCount: 3, AnyUnread: true, Starred: true,
		Labels: []string{"L"}, Participants: []string{"A", "B"},
		Latest: Message{ID: "m1", Body: "should be cleared in latest"},
	}
	p := threadToProto(tr)
	if p.GetThreadId() != "t1" || p.GetMessageCount() != 3 {
		t.Errorf("thread basics wrong: %+v", p)
	}
	if p.GetLatest().GetBody() != "" {
		t.Errorf("latest body should be stripped, got %q", p.GetLatest().GetBody())
	}
	if !p.GetAnyUnread() || !p.GetStarred() {
		t.Errorf("flags lost")
	}
	if len(p.GetParticipants()) != 2 {
		t.Errorf("participants = %v", p.GetParticipants())
	}
}

func TestRuleToProto(t *testing.T) {
	r := Rule{
		ID: "r1", Name: "N", MatchFrom: "f", MatchTo: "t", MatchSubject: "s",
		ActLabel: "l", ActFolder: "fo", ActForward: "fw", ActMarkRead: true, ActStar: true,
	}
	p := ruleToProto(r)
	if p.GetId() != "r1" || p.GetName() != "N" || p.GetMatchFrom() != "f" ||
		p.GetActForward() != "fw" || !p.GetActMarkRead() || !p.GetActStar() {
		t.Errorf("ruleToProto = %+v", p)
	}
}

func TestFilterToProto(t *testing.T) {
	f := Filter{ID: "f1", MatchField: "subject", MatchOp: "contains", MatchValue: "v", ActionType: "label", ActionValue: "L"}
	p := filterToProto(f)
	if p.GetId() != "f1" || p.GetMatchField() != "subject" || p.GetActionValue() != "L" {
		t.Errorf("filterToProto = %+v", p)
	}
}

func TestLabelEntityToProto(t *testing.T) {
	p := labelEntityToProto(LabelEntity{ID: "l1", Name: "Work", Color: "#fff"})
	if p.GetId() != "l1" || p.GetName() != "Work" || p.GetColor() != "#fff" {
		t.Errorf("labelEntityToProto = %+v", p)
	}
}

// --- Service handler auth short-circuits (no DB needed; caller() fails first) ---

func TestService_UnauthenticatedShortCircuits(t *testing.T) {
	s := NewService(&fakeBackend{}, nil)
	ctx := context.Background() // no user/org

	checks := []struct {
		name string
		call func() error
	}{
		{"ListMessages", func() error { _, e := s.ListMessages(ctx, &grownv1.ListMessagesRequest{}); return e }},
		{"GetMessage", func() error { _, e := s.GetMessage(ctx, &grownv1.GetMessageRequest{}); return e }},
		{"ListThreads", func() error { _, e := s.ListThreads(ctx, &grownv1.ListMessagesRequest{}); return e }},
		{"GetThread", func() error { _, e := s.GetThread(ctx, &grownv1.GetThreadRequest{}); return e }},
		{"SendMessage", func() error { _, e := s.SendMessage(ctx, &grownv1.SendMessageRequest{}); return e }},
		{"ModifyMessage", func() error { _, e := s.ModifyMessage(ctx, &grownv1.ModifyMessageRequest{}); return e }},
		{"DeleteMessage", func() error { _, e := s.DeleteMessage(ctx, &grownv1.DeleteMessageRequest{}); return e }},
		{"ListRules", func() error { _, e := s.ListRules(ctx, &grownv1.ListRulesRequest{}); return e }},
		{"CreateRule", func() error { _, e := s.CreateRule(ctx, &grownv1.CreateRuleRequest{}); return e }},
		{"DeleteRule", func() error { _, e := s.DeleteRule(ctx, &grownv1.DeleteRuleRequest{}); return e }},
		{"CreateMailLabel", func() error { _, e := s.CreateMailLabel(ctx, &grownv1.CreateMailLabelRequest{}); return e }},
		{"UpdateMailLabel", func() error { _, e := s.UpdateMailLabel(ctx, &grownv1.UpdateMailLabelRequest{}); return e }},
		{"DeleteMailLabel", func() error { _, e := s.DeleteMailLabel(ctx, &grownv1.DeleteMailLabelRequest{}); return e }},
		{"ApplyMailLabel", func() error { _, e := s.ApplyMailLabel(ctx, &grownv1.ApplyMailLabelRequest{}); return e }},
		{"RemoveMailLabel", func() error { _, e := s.RemoveMailLabel(ctx, &grownv1.RemoveMailLabelRequest{}); return e }},
		{"ListLabels", func() error { _, e := s.ListLabels(ctx, &grownv1.ListLabelsRequest{}); return e }},
		{"ListFilters", func() error { _, e := s.ListFilters(ctx, &grownv1.ListFiltersRequest{}); return e }},
		{"CreateFilter", func() error { _, e := s.CreateFilter(ctx, &grownv1.CreateFilterRequest{}); return e }},
		{"DeleteFilter", func() error { _, e := s.DeleteFilter(ctx, &grownv1.DeleteFilterRequest{}); return e }},
		{"ApplyFilters", func() error { _, e := s.ApplyFilters(ctx, &grownv1.ApplyFiltersRequest{}); return e }},
	}
	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			err := c.call()
			if status.Code(err) != codes.Unauthenticated {
				t.Errorf("%s code = %v, want Unauthenticated", c.name, status.Code(err))
			}
		})
	}
}

// authedCtxNoDB has a user+org but the service has no real backend/repo, so we
// only test validation short-circuits that run before any backend/repo call.
func authedCtxNoDB() context.Context {
	ctx := auth.WithUser(context.Background(), users.User{ID: "u1", OrgID: "o1", Email: "x@y.com", DisplayName: "X"})
	return auth.WithOrg(ctx, orgs.Org{ID: "o1"})
}

func TestCreateMailLabel_RequiresName(t *testing.T) {
	s := NewService(&fakeBackend{}, nil)
	_, err := s.CreateMailLabel(authedCtxNoDB(), &grownv1.CreateMailLabelRequest{Name: "   "})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestUpdateMailLabel_RequiresName(t *testing.T) {
	s := NewService(&fakeBackend{}, nil)
	_, err := s.UpdateMailLabel(authedCtxNoDB(), &grownv1.UpdateMailLabelRequest{Id: "l1", Name: ""})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestCreateFilter_RequiresMatchValue(t *testing.T) {
	s := NewService(&fakeBackend{}, nil)
	_, err := s.CreateFilter(authedCtxNoDB(), &grownv1.CreateFilterRequest{MatchValue: ""})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", status.Code(err))
	}
}

func TestModifyMessage_RejectsBadSnoozeNoDB(t *testing.T) {
	s := NewService(&fakeBackend{}, nil)
	_, err := s.ModifyMessage(authedCtxNoDB(), &grownv1.ModifyMessageRequest{
		Id: "m1", SetSnooze: true, SnoozeUntil: "not-a-time",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", status.Code(err))
	}
}

// ApplyFilters on a non-LocalBackend backend returns Unimplemented (after auth).
func TestApplyFilters_NonLocalBackendUnimplemented(t *testing.T) {
	s := NewService(&fakeBackend{}, nil)
	_, err := s.ApplyFilters(authedCtxNoDB(), &grownv1.ApplyFiltersRequest{})
	if status.Code(err) != codes.Unimplemented {
		t.Errorf("code = %v, want Unimplemented", status.Code(err))
	}
}
