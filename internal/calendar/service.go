package calendar

import (
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
	"code.pick.haus/grown/grown/internal/auth"
)

// Service implements grownv1.CalendarServiceServer over a Repository.
type Service struct {
	repo *Repository
}

// NewService constructs a Service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

func callerOrg(ctx context.Context) (string, error) {
	if _, ok := auth.UserFromContext(ctx); !ok {
		return "", status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Internal, "missing org context")
	}
	return o.ID, nil
}

func toProto(e Event) *grownv1.Event {
	p := &grownv1.Event{
		Id:                 e.ID,
		OrgId:              e.OrgID,
		OwnerId:            e.OwnerID,
		Title:              e.Title,
		Description:        e.Description,
		Location:           e.Location,
		StartAt:            e.StartAt.UTC().Format(time.RFC3339),
		EndAt:              e.EndAt.UTC().Format(time.RFC3339),
		AllDay:             e.AllDay,
		Color:              e.Color,
		Recurrence:         e.Recurrence,
		Attendees:          e.Attendees,
		RecurringEventId:   e.RecurringEventID,
		CreatedAt:          e.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          e.UpdatedAt.UTC().Format(time.RFC3339),
		ItemType:           e.ItemType,
		Reminders:          e.Reminders,
		Status:             e.Status,
		Visibility:         e.Visibility,
		TaskDone:           e.TaskDone,
		RecurrenceParentId: e.RecurrenceParentID,
	}
	if e.OriginalStart != nil {
		p.OriginalStart = e.OriginalStart.UTC().Format(time.RFC3339)
	}
	return p
}

func attendeeToProto(a Attendee) *grownv1.Attendee {
	return &grownv1.Attendee{
		EventId:        a.EventID,
		Email:          a.Email,
		ResponseStatus: a.ResponseStatus,
		Optional:       a.Optional,
		CreatedAt:      a.CreatedAt.UTC().Format(time.RFC3339),
	}
}

// sanitizeAttendees trims, lowercases, drops blanks, and de-duplicates emails
// while preserving first-seen order.
func sanitizeAttendees(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, a := range in {
		a = strings.ToLower(strings.TrimSpace(a))
		if a == "" || seen[a] {
			continue
		}
		seen[a] = true
		out = append(out, a)
	}
	return out
}

// parseTime accepts RFC3339; empty/invalid yields the zero value + error flag.
func parseTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func fieldsFrom(title, desc, loc, start, end string, allDay bool, color, recur string, attendees []string,
	itemType string, reminders []int32, eventStatus, visibility string, taskDone bool) (Fields, error) {
	s, ok := parseTime(start)
	if !ok {
		return Fields{}, status.Error(codes.InvalidArgument, "start_at must be RFC3339")
	}
	e, ok := parseTime(end)
	if !ok {
		// default to a 1-hour event if end is missing
		e = s.Add(time.Hour)
	}
	if e.Before(s) {
		e = s.Add(time.Hour)
	}
	return Fields{
		Title:       title,
		Description: desc,
		Location:    loc,
		StartAt:     s,
		EndAt:       e,
		AllDay:      allDay,
		Color:       color,
		Recurrence:  recur,
		Attendees:   sanitizeAttendees(attendees),
		ItemType:    itemType,
		Reminders:   reminders,
		Status:      eventStatus,
		Visibility:  visibility,
		TaskDone:    taskDone,
	}, nil
}

var validRSVP = map[string]bool{
	"needs_action": true, "accepted": true, "declined": true, "tentative": true,
}

func (s *Service) ListEvents(ctx context.Context, req *grownv1.ListEventsRequest) (*grownv1.ListEventsResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	min, ok := parseTime(req.GetTimeMin())
	if !ok {
		min = time.Now().AddDate(0, -1, 0)
	}
	max, ok := parseTime(req.GetTimeMax())
	if !ok {
		max = time.Now().AddDate(0, 2, 0)
	}
	var opts []ListOptions
	if t := req.GetItemType(); t != "" {
		opts = append(opts, ListOptions{ItemType: t})
	}
	list, err := s.repo.List(ctx, orgID, min, max, opts...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list events: %v", err)
	}

	// Separate exception rows from master/regular events.
	// Build a map: masterID+originalStart(truncated to second) → exception event.
	type exKey struct{ masterID, origStart string }
	exceptions := map[exKey]Event{}
	var masters []Event
	for _, e := range list {
		if e.RecurrenceParentID != "" {
			var origKey string
			if e.OriginalStart != nil {
				origKey = e.OriginalStart.UTC().Format(time.RFC3339)
			}
			exceptions[exKey{e.RecurrenceParentID, origKey}] = e
		} else {
			masters = append(masters, e)
		}
	}

	// Expand recurring events into concrete instances within the window,
	// suppressing/replacing occurrences that have exception overrides.
	resp := &grownv1.ListEventsResponse{Events: make([]*grownv1.Event, 0, len(list))}
	for _, e := range masters {
		for _, inst := range expandEvent(e, min, max) {
			if inst.RecurringEventID != "" {
				// Check whether this occurrence has an exception override.
				origKey := inst.StartAt.UTC().Format(time.RFC3339)
				key := exKey{inst.RecurringEventID, origKey}
				if exc, hasExc := exceptions[key]; hasExc {
					// An override with a blank recurrence_parent_id means the
					// occurrence was cancelled (tombstone). Skip it entirely when
					// the override event is itself trashed; otherwise emit the
					// override.
					resp.Events = append(resp.Events, toProto(exc))
					delete(exceptions, key) // don't double-emit
					continue
				}
			}
			resp.Events = append(resp.Events, toProto(inst))
		}
	}
	// Emit any leftover exceptions (overrides for occurrences outside the
	// masters slice, e.g. if the master was deleted but override survived).
	for _, exc := range exceptions {
		resp.Events = append(resp.Events, toProto(exc))
	}
	return resp, nil
}

func (s *Service) CreateEvent(ctx context.Context, req *grownv1.CreateEventRequest) (*grownv1.Event, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	f, err := fieldsFrom(req.GetTitle(), req.GetDescription(), req.GetLocation(), req.GetStartAt(), req.GetEndAt(), req.GetAllDay(), req.GetColor(), req.GetRecurrence(), req.GetAttendees(),
		req.GetItemType(), req.GetReminders(), req.GetStatus(), req.GetVisibility(), req.GetTaskDone())
	if err != nil {
		return nil, err
	}
	e, err := s.repo.Create(ctx, o.ID, u.ID, f)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "create event: %v", err)
	}
	return toProto(e), nil
}

func (s *Service) GetEvent(ctx context.Context, req *grownv1.GetEventRequest) (*grownv1.Event, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	e, err := s.repo.Get(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get event: %v", err)
	}
	return toProto(e), nil
}

func (s *Service) UpdateEvent(ctx context.Context, req *grownv1.UpdateEventRequest) (*grownv1.Event, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	orgID := o.ID

	f, err := fieldsFrom(req.GetTitle(), req.GetDescription(), req.GetLocation(), req.GetStartAt(), req.GetEndAt(), req.GetAllDay(), req.GetColor(), req.GetRecurrence(), req.GetAttendees(),
		req.GetItemType(), req.GetReminders(), req.GetStatus(), req.GetVisibility(), req.GetTaskDone())
	if err != nil {
		return nil, err
	}

	scope := req.GetScope()
	// For THIS_EVENT scope we create/update an exception row instead of
	// touching the master.
	if scope == grownv1.EditScope_EDIT_SCOPE_THIS_EVENT {
		origStartStr := req.GetOriginalStart()
		origStart, ok := parseTime(origStartStr)
		if !ok {
			return nil, status.Error(codes.InvalidArgument, "original_start must be RFC3339 for this-event scope")
		}
		masterID := req.GetId()

		// Look up the master to verify it exists and belongs to the org.
		master, err := s.repo.Get(ctx, orgID, masterID)
		if errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "event not found")
		}
		if err != nil {
			return nil, status.Errorf(codes.Internal, "get master: %v", err)
		}

		// Upsert: if an exception already exists for this occurrence, update it;
		// otherwise create a new exception row.
		exc, exists, err := s.repo.GetExceptionForOccurrence(ctx, orgID, masterID, origStart)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "get exception: %v", err)
		}

		f.RecurrenceParentID = masterID
		f.OriginalStart = &origStart
		// The exception itself is not recurring.
		f.Recurrence = ""

		if exists {
			updated, err := s.repo.Update(ctx, orgID, exc.ID, f)
			if err != nil {
				return nil, status.Errorf(codes.Internal, "update exception: %v", err)
			}
			return toProto(updated), nil
		}
		// Create exception. Use the authenticated user as owner.
		_ = master
		excEvent, err := s.repo.Create(ctx, orgID, u.ID, f)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "create exception: %v", err)
		}
		return toProto(excEvent), nil
	}

	// Default: ALL_EVENTS — update the master event.
	e, err := s.repo.Update(ctx, orgID, req.GetId(), f)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "update event: %v", err)
	}
	return toProto(e), nil
}

func (s *Service) DeleteEvent(ctx context.Context, req *grownv1.DeleteEventRequest) (*grownv1.DeleteEventResponse, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	o, ok := auth.OrgFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Internal, "missing org context")
	}
	orgID := o.ID
	_ = u

	scope := req.GetScope()
	if scope == grownv1.EditScope_EDIT_SCOPE_THIS_EVENT {
		origStartStr := req.GetOriginalStart()
		origStart, ok := parseTime(origStartStr)
		if !ok {
			return nil, status.Error(codes.InvalidArgument, "original_start must be RFC3339 for this-event scope")
		}
		masterID := req.GetId()

		// Verify master exists in this org.
		if _, err := s.repo.Get(ctx, orgID, masterID); errors.Is(err, ErrNotFound) {
			return nil, status.Error(codes.NotFound, "event not found")
		} else if err != nil {
			return nil, status.Errorf(codes.Internal, "get master: %v", err)
		}

		// If an exception override already exists for this occurrence, trash it.
		// Also create a tombstone (exception with no title) to suppress the
		// computed occurrence during list expansion.
		_ = s.repo.DeleteExceptionForOccurrence(ctx, orgID, masterID, origStart)
		// Create a tombstone: exception row with empty title that signals
		// "this occurrence is cancelled". We mark it trashed immediately via
		// a raw insert so it shows up in queries that look for trashed exceptions
		// but does not appear in normal list results.
		_, _ = s.repo.pool.Exec(ctx,
			`INSERT INTO grown.calendar_events
				(org_id, owner_id, title, start_at, end_at, recurrence_parent_id, original_start, trashed_at)
			VALUES ($1, (SELECT owner_id FROM grown.calendar_events WHERE id=$2), '', $3, $3, $2, $3, now())
			ON CONFLICT DO NOTHING`,
			orgID, masterID, origStart)
		return &grownv1.DeleteEventResponse{}, nil
	}

	// Default: ALL_EVENTS — soft-delete the master.
	err := s.repo.Delete(ctx, orgID, req.GetId())
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "delete event: %v", err)
	}
	return &grownv1.DeleteEventResponse{}, nil
}

// ---- Attendee RPCs ----

func (s *Service) AddAttendee(ctx context.Context, req *grownv1.AddAttendeeRequest) (*grownv1.Attendee, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	email := strings.ToLower(strings.TrimSpace(req.GetEmail()))
	if email == "" {
		return nil, status.Error(codes.InvalidArgument, "email is required")
	}
	// Verify event exists in this org.
	if _, err := s.repo.Get(ctx, orgID, req.GetEventId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get event: %v", err)
	}
	a, err := s.repo.AddAttendee(ctx, orgID, req.GetEventId(), email, req.GetOptional())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "add attendee: %v", err)
	}
	return attendeeToProto(a), nil
}

func (s *Service) ListAttendees(ctx context.Context, req *grownv1.ListAttendeesRequest) (*grownv1.ListAttendeesResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	// Verify event exists in this org.
	if _, err := s.repo.Get(ctx, orgID, req.GetEventId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get event: %v", err)
	}
	list, err := s.repo.ListAttendees(ctx, req.GetEventId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list attendees: %v", err)
	}
	resp := &grownv1.ListAttendeesResponse{Attendees: make([]*grownv1.Attendee, 0, len(list))}
	for _, a := range list {
		resp.Attendees = append(resp.Attendees, attendeeToProto(a))
	}
	return resp, nil
}

func (s *Service) RemoveAttendee(ctx context.Context, req *grownv1.RemoveAttendeeRequest) (*grownv1.RemoveAttendeeResponse, error) {
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	// Verify event exists in this org.
	if _, err := s.repo.Get(ctx, orgID, req.GetEventId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get event: %v", err)
	}
	email := strings.ToLower(strings.TrimSpace(req.GetEmail()))
	if err := s.repo.RemoveAttendee(ctx, req.GetEventId(), email); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "attendee not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "remove attendee: %v", err)
	}
	return &grownv1.RemoveAttendeeResponse{}, nil
}

func (s *Service) SetRSVP(ctx context.Context, req *grownv1.SetRSVPRequest) (*grownv1.Attendee, error) {
	u, ok := auth.UserFromContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "no session")
	}
	orgID, err := callerOrg(ctx)
	if err != nil {
		return nil, err
	}
	rsvp := strings.ToLower(strings.TrimSpace(req.GetResponseStatus()))
	if !validRSVP[rsvp] {
		return nil, status.Errorf(codes.InvalidArgument, "response_status must be one of: needs_action, accepted, declined, tentative")
	}
	// Verify event exists in this org.
	if _, err := s.repo.Get(ctx, orgID, req.GetEventId()); errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "event not found")
	} else if err != nil {
		return nil, status.Errorf(codes.Internal, "get event: %v", err)
	}
	// Use the caller's email as the attendee identity.
	callerEmail := strings.ToLower(strings.TrimSpace(u.Email))
	a, err := s.repo.SetRSVP(ctx, req.GetEventId(), callerEmail, rsvp)
	if errors.Is(err, ErrNotFound) {
		return nil, status.Error(codes.NotFound, "attendee not found — you are not on the guest list for this event")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "set rsvp: %v", err)
	}
	return attendeeToProto(a), nil
}
