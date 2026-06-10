package cloudimport

import (
	"strings"
	"testing"
	"time"
)

const sampleICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:abc-123@test
SUMMARY:Team standup
DESCRIPTION:Daily sync\nBring notes.
LOCATION:Conference room B
DTSTART:20240315T090000Z
DTEND:20240315T093000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
END:VEVENT
BEGIN:VEVENT
UID:def-456@test
SUMMARY:Birthday party
DTSTART;VALUE=DATE:20240420
END:VEVENT
BEGIN:VEVENT
UID:ghi-789@test
SUMMARY:Folded event
 with a long description that wraps
DTSTART:20240501T140000Z
DTEND:20240501T150000Z
END:VEVENT
END:VCALENDAR`

func TestParseICS_Basic(t *testing.T) {
	events, err := ParseICS(strings.NewReader(sampleICS))
	if err != nil {
		t.Fatalf("ParseICS error: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("got %d events, want 3", len(events))
	}

	e := events[0]
	if e.UID != "abc-123@test" {
		t.Errorf("UID = %q, want abc-123@test", e.UID)
	}
	if e.Summary != "Team standup" {
		t.Errorf("Summary = %q, want 'Team standup'", e.Summary)
	}
	if !strings.Contains(e.Description, "Bring notes.") {
		t.Errorf("Description %q does not contain 'Bring notes.'", e.Description)
	}
	if e.Location != "Conference room B" {
		t.Errorf("Location = %q, want 'Conference room B'", e.Location)
	}
	if e.RRule != "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" {
		t.Errorf("RRule = %q", e.RRule)
	}
	wantStart := time.Date(2024, 3, 15, 9, 0, 0, 0, time.UTC)
	if !e.StartAt.Equal(wantStart) {
		t.Errorf("StartAt = %v, want %v", e.StartAt, wantStart)
	}
	if e.AllDay {
		t.Error("AllDay should be false for timed event")
	}
}

func TestParseICS_AllDay(t *testing.T) {
	events, err := ParseICS(strings.NewReader(sampleICS))
	if err != nil {
		t.Fatalf("ParseICS error: %v", err)
	}
	e := events[1]
	if e.Summary != "Birthday party" {
		t.Errorf("Summary = %q", e.Summary)
	}
	if !e.AllDay {
		t.Error("AllDay should be true for date-only event")
	}
	wantStart := time.Date(2024, 4, 20, 0, 0, 0, 0, time.UTC)
	if !e.StartAt.Equal(wantStart) {
		t.Errorf("StartAt = %v, want %v", e.StartAt, wantStart)
	}
	// Should have auto-extended EndAt by 1 day.
	wantEnd := wantStart.AddDate(0, 0, 1)
	if !e.EndAt.Equal(wantEnd) {
		t.Errorf("EndAt = %v, want %v", e.EndAt, wantEnd)
	}
}

func TestParseICS_FoldedLine(t *testing.T) {
	events, err := ParseICS(strings.NewReader(sampleICS))
	if err != nil {
		t.Fatalf("ParseICS error: %v", err)
	}
	e := events[2]
	// The folded continuation " with a long description that wraps" should be
	// joined to the SUMMARY.
	if !strings.Contains(e.Summary, "with a long description") {
		t.Errorf("folded SUMMARY not joined: %q", e.Summary)
	}
}

func TestParseICS_Empty(t *testing.T) {
	events, err := ParseICS(strings.NewReader("BEGIN:VCALENDAR\nEND:VCALENDAR\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("got %d events, want 0", len(events))
	}
}
