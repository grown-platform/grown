package calendar

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

// codeOf extracts the gRPC code from an error (or OK if nil).
func codeOf(err error) codes.Code {
	return status.Code(err)
}

// authedCtx returns a context carrying both a user and an org, the way the auth
// middleware would. Used to drive handlers past the auth short-circuit so that
// the next short-circuit (validation) is exercised without touching the DB.
func authedCtx() context.Context {
	ctx := auth.WithOrg(context.Background(), orgs.Org{ID: "org-1", Slug: "default"})
	return auth.WithUser(ctx, users.User{ID: "user-1", OrgID: "org-1", Email: "u@x.io"})
}

// ---- callerOrg ----

func TestCallerOrg(t *testing.T) {
	t.Run("no user", func(t *testing.T) {
		if _, err := callerOrg(context.Background()); codeOf(err) != codes.Unauthenticated {
			t.Fatalf("got %v want Unauthenticated", err)
		}
	})
	t.Run("user but no org", func(t *testing.T) {
		ctx := auth.WithUser(context.Background(), users.User{ID: "u"})
		if _, err := callerOrg(ctx); codeOf(err) != codes.Internal {
			t.Fatalf("got %v want Internal", err)
		}
	})
	t.Run("user and org", func(t *testing.T) {
		org, err := callerOrg(authedCtx())
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if org != "org-1" {
			t.Fatalf("org: got %q want org-1", org)
		}
	})
}

// ---- Handler auth short-circuits (no repo access required) ----
//
// These call handlers with a Service whose repo is nil. Because the auth check
// runs first and returns before any repo method is invoked, no DB is touched.

func TestHandlers_Unauthenticated(t *testing.T) {
	s := NewService(nil)
	ctx := context.Background() // no user, no org

	cases := []struct {
		name string
		call func() error
	}{
		{"ListEvents", func() error { _, e := s.ListEvents(ctx, &grownv1.ListEventsRequest{}); return e }},
		{"CreateEvent", func() error { _, e := s.CreateEvent(ctx, &grownv1.CreateEventRequest{}); return e }},
		{"GetEvent", func() error { _, e := s.GetEvent(ctx, &grownv1.GetEventRequest{}); return e }},
		{"UpdateEvent", func() error { _, e := s.UpdateEvent(ctx, &grownv1.UpdateEventRequest{}); return e }},
		{"DeleteEvent", func() error { _, e := s.DeleteEvent(ctx, &grownv1.DeleteEventRequest{}); return e }},
		{"AddAttendee", func() error { _, e := s.AddAttendee(ctx, &grownv1.AddAttendeeRequest{}); return e }},
		{"ListAttendees", func() error { _, e := s.ListAttendees(ctx, &grownv1.ListAttendeesRequest{}); return e }},
		{"RemoveAttendee", func() error { _, e := s.RemoveAttendee(ctx, &grownv1.RemoveAttendeeRequest{}); return e }},
		{"SetRSVP", func() error { _, e := s.SetRSVP(ctx, &grownv1.SetRSVPRequest{}); return e }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if c := codeOf(tc.call()); c != codes.Unauthenticated {
				t.Fatalf("%s: got %v want Unauthenticated", tc.name, c)
			}
		})
	}
}

// User present but org missing → Internal, before any repo access.
func TestHandlers_MissingOrg(t *testing.T) {
	s := NewService(nil)
	ctx := auth.WithUser(context.Background(), users.User{ID: "u", Email: "u@x.io"})

	cases := []struct {
		name string
		call func() error
	}{
		{"CreateEvent", func() error { _, e := s.CreateEvent(ctx, &grownv1.CreateEventRequest{}); return e }},
		{"UpdateEvent", func() error { _, e := s.UpdateEvent(ctx, &grownv1.UpdateEventRequest{}); return e }},
		{"DeleteEvent", func() error { _, e := s.DeleteEvent(ctx, &grownv1.DeleteEventRequest{}); return e }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if c := codeOf(tc.call()); c != codes.Internal {
				t.Fatalf("%s: got %v want Internal", tc.name, c)
			}
		})
	}
}

// CreateEvent validates start_at before touching the repo; a bad start with a
// fully-authed context still short-circuits with InvalidArgument.
func TestCreateEvent_BadStartShortCircuits(t *testing.T) {
	s := NewService(nil)
	_, err := s.CreateEvent(authedCtx(), &grownv1.CreateEventRequest{
		Title:   "x",
		StartAt: "not-a-time",
	})
	if codeOf(err) != codes.InvalidArgument {
		t.Fatalf("got %v want InvalidArgument", err)
	}
}

func TestUpdateEvent_BadStartShortCircuits(t *testing.T) {
	s := NewService(nil)
	_, err := s.UpdateEvent(authedCtx(), &grownv1.UpdateEventRequest{
		Id:      "evt",
		StartAt: "bad",
	})
	if codeOf(err) != codes.InvalidArgument {
		t.Fatalf("got %v want InvalidArgument", err)
	}
}

// UpdateEvent with THIS_EVENT scope requires a valid original_start; a bad one is
// rejected (with valid start so it gets past fieldsFrom) before any repo call.
func TestUpdateEvent_ThisEventBadOriginalStart(t *testing.T) {
	s := NewService(nil)
	_, err := s.UpdateEvent(authedCtx(), &grownv1.UpdateEventRequest{
		Id:            "evt",
		StartAt:       "2026-01-01T09:00:00Z",
		Scope:         grownv1.EditScope_EDIT_SCOPE_THIS_EVENT,
		OriginalStart: "garbage",
	})
	if codeOf(err) != codes.InvalidArgument {
		t.Fatalf("got %v want InvalidArgument", err)
	}
}

func TestDeleteEvent_ThisEventBadOriginalStart(t *testing.T) {
	s := NewService(nil)
	_, err := s.DeleteEvent(authedCtx(), &grownv1.DeleteEventRequest{
		Id:            "evt",
		Scope:         grownv1.EditScope_EDIT_SCOPE_THIS_EVENT,
		OriginalStart: "garbage",
	})
	if codeOf(err) != codes.InvalidArgument {
		t.Fatalf("got %v want InvalidArgument", err)
	}
}

// AddAttendee rejects a blank email before any repo access.
func TestAddAttendee_BlankEmail(t *testing.T) {
	s := NewService(nil)
	_, err := s.AddAttendee(authedCtx(), &grownv1.AddAttendeeRequest{EventId: "e", Email: "   "})
	if codeOf(err) != codes.InvalidArgument {
		t.Fatalf("got %v want InvalidArgument", err)
	}
}

// SetRSVP rejects an invalid response_status before any repo access.
func TestSetRSVP_InvalidStatus(t *testing.T) {
	s := NewService(nil)
	cases := []string{"", "maybe", "yes", "no"}
	for _, rs := range cases {
		_, err := s.SetRSVP(authedCtx(), &grownv1.SetRSVPRequest{EventId: "e", ResponseStatus: rs})
		if codeOf(err) != codes.InvalidArgument {
			t.Fatalf("status %q: got %v want InvalidArgument", rs, err)
		}
	}
}

func TestSetRSVP_ValidStatusesPassValidation(t *testing.T) {
	// All four valid statuses must be recognised by validRSVP.
	for _, rs := range []string{"needs_action", "accepted", "declined", "tentative"} {
		if !validRSVP[rs] {
			t.Errorf("validRSVP should accept %q", rs)
		}
	}
}

// ---- proto mapping ----

func TestToProto(t *testing.T) {
	start := mustTime(t, "2026-01-02T09:00:00Z")
	end := mustTime(t, "2026-01-02T10:00:00Z")
	orig := mustTime(t, "2026-01-01T09:00:00Z")
	created := mustTime(t, "2025-12-01T00:00:00Z")
	updated := mustTime(t, "2025-12-02T00:00:00Z")

	e := Event{
		ID: "id-1", OrgID: "org-1", OwnerID: "owner-1",
		Title: "Title", Description: "Desc", Location: "Loc",
		StartAt: start, EndAt: end, AllDay: true, Color: "#abc",
		Recurrence: "FREQ=DAILY", Attendees: []string{"a@x.io"},
		RecurringEventID: "master-1", CreatedAt: created, UpdatedAt: updated,
		ItemType: ItemTypeTask, Reminders: []int32{10, 20},
		Status: StatusFree, Visibility: VisibilityPrivate, TaskDone: true,
		RecurrenceParentID: "parent-1", OriginalStart: &orig,
	}
	p := toProto(e)

	if p.GetId() != "id-1" || p.GetOrgId() != "org-1" || p.GetOwnerId() != "owner-1" {
		t.Errorf("ids not mapped: %+v", p)
	}
	if p.GetStartAt() != "2026-01-02T09:00:00Z" || p.GetEndAt() != "2026-01-02T10:00:00Z" {
		t.Errorf("times not RFC3339-UTC: start=%q end=%q", p.GetStartAt(), p.GetEndAt())
	}
	if !p.GetAllDay() || p.GetColor() != "#abc" || p.GetRecurrence() != "FREQ=DAILY" {
		t.Errorf("flags/strings not mapped: %+v", p)
	}
	if p.GetRecurringEventId() != "master-1" || p.GetRecurrenceParentId() != "parent-1" {
		t.Errorf("recurrence ids not mapped: %+v", p)
	}
	if p.GetItemType() != ItemTypeTask || p.GetStatus() != StatusFree ||
		p.GetVisibility() != VisibilityPrivate || !p.GetTaskDone() {
		t.Errorf("event-type fields not mapped: %+v", p)
	}
	if len(p.GetReminders()) != 2 || p.GetReminders()[0] != 10 {
		t.Errorf("reminders not mapped: %v", p.GetReminders())
	}
	if len(p.GetAttendees()) != 1 || p.GetAttendees()[0] != "a@x.io" {
		t.Errorf("attendees not mapped: %v", p.GetAttendees())
	}
	if p.GetOriginalStart() != "2026-01-01T09:00:00Z" {
		t.Errorf("original_start not mapped: %q", p.GetOriginalStart())
	}
}

func TestToProto_NilOriginalStart(t *testing.T) {
	e := Event{ID: "x", StartAt: time.Now(), EndAt: time.Now()}
	p := toProto(e)
	if p.GetOriginalStart() != "" {
		t.Errorf("nil OriginalStart should map to empty string, got %q", p.GetOriginalStart())
	}
}

func TestToProto_ConvertsToUTC(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tz unavailable: %v", err)
	}
	start := time.Date(2026, 1, 2, 9, 0, 0, 0, loc) // 09:00 EST == 14:00 UTC
	e := Event{ID: "x", StartAt: start, EndAt: start}
	p := toProto(e)
	if p.GetStartAt() != "2026-01-02T14:00:00Z" {
		t.Errorf("expected UTC normalization, got %q", p.GetStartAt())
	}
}

func TestAttendeeToProto(t *testing.T) {
	created := mustTime(t, "2026-01-01T00:00:00Z")
	a := Attendee{
		EventID: "e1", Email: "a@x.io", ResponseStatus: "accepted",
		Optional: true, CreatedAt: created,
	}
	p := attendeeToProto(a)
	if p.GetEventId() != "e1" || p.GetEmail() != "a@x.io" ||
		p.GetResponseStatus() != "accepted" || !p.GetOptional() {
		t.Errorf("attendee not mapped: %+v", p)
	}
	if p.GetCreatedAt() != "2026-01-01T00:00:00Z" {
		t.Errorf("created_at not RFC3339-UTC: %q", p.GetCreatedAt())
	}
}
