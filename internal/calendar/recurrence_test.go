package calendar

import (
	"testing"
	"time"
)

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	tm, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parse time %q: %v", s, err)
	}
	return tm
}

// master builds a 1-hour recurring master event starting at start.
func master(t *testing.T, start, recurrence string) Event {
	t.Helper()
	s := mustTime(t, start)
	return Event{
		ID:         "evt-1",
		Title:      "Standup",
		StartAt:    s,
		EndAt:      s.Add(time.Hour),
		Recurrence: recurrence,
	}
}

func TestExpand_NonRecurring(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-02-01T00:00:00Z")

	in := master(t, "2026-01-10T09:00:00Z", "")
	got := expandEvent(in, min, max)
	if len(got) != 1 {
		t.Fatalf("non-recurring: want 1 instance, got %d", len(got))
	}
	if got[0].RecurringEventID != "" {
		t.Errorf("non-recurring instance should not carry RecurringEventID, got %q", got[0].RecurringEventID)
	}

	// Outside the window → nothing.
	out := master(t, "2026-03-10T09:00:00Z", "")
	if g := expandEvent(out, min, max); len(g) != 0 {
		t.Fatalf("event outside window: want 0, got %d", len(g))
	}
}

// A weekly event yields N instances in a month — the headline test.
func TestExpand_WeeklyInMonth(t *testing.T) {
	// Jan 2026: Mondays fall on the 5th, 12th, 19th, 26th → 4 instances.
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-02-01T00:00:00Z")
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKLY") // Jan 5 2026 is a Monday

	got := expandEvent(in, min, max)
	if len(got) != 4 {
		t.Fatalf("weekly in Jan: want 4 instances, got %d", len(got))
	}
	wantDays := []int{5, 12, 19, 26}
	for i, e := range got {
		if e.StartAt.Day() != wantDays[i] {
			t.Errorf("instance %d: want day %d, got %v", i, wantDays[i], e.StartAt)
		}
		if e.StartAt.Hour() != 9 {
			t.Errorf("instance %d: want hour 9 preserved, got %d", i, e.StartAt.Hour())
		}
		if e.EndAt.Sub(e.StartAt) != time.Hour {
			t.Errorf("instance %d: duration not preserved: %v", i, e.EndAt.Sub(e.StartAt))
		}
		if e.RecurringEventID != "evt-1" {
			t.Errorf("instance %d: want RecurringEventID evt-1, got %q", i, e.RecurringEventID)
		}
	}
}

func TestExpand_WeeklyByDay(t *testing.T) {
	// Mon/Wed/Fri in the first week of Jan 2026 only.
	min := mustTime(t, "2026-01-05T00:00:00Z")
	max := mustTime(t, "2026-01-10T00:00:00Z") // through Jan 9 (Fri)
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKLY;BYDAY=MO,WE,FR")

	got := expandEvent(in, min, max)
	// Jan 5 (Mon), 7 (Wed), 9 (Fri) → 3.
	if len(got) != 3 {
		t.Fatalf("weekly MWF: want 3, got %d", len(got))
	}
	wantDays := []int{5, 7, 9}
	for i, e := range got {
		if e.StartAt.Day() != wantDays[i] {
			t.Errorf("instance %d: want day %d, got %v", i, wantDays[i], e.StartAt)
		}
	}
}

func TestExpand_WeeklyInterval(t *testing.T) {
	// Every 2 weeks from Jan 5: Jan 5, 19 in January.
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-02-01T00:00:00Z")
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKLY;INTERVAL=2")

	got := expandEvent(in, min, max)
	if len(got) != 2 {
		t.Fatalf("biweekly: want 2, got %d", len(got))
	}
	if got[0].StartAt.Day() != 5 || got[1].StartAt.Day() != 19 {
		t.Errorf("biweekly days: got %v, %v", got[0].StartAt, got[1].StartAt)
	}
}

func TestExpand_Daily(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-01-08T00:00:00Z") // 7-day window
	in := master(t, "2026-01-01T09:00:00Z", "FREQ=DAILY")

	got := expandEvent(in, min, max)
	if len(got) != 7 {
		t.Fatalf("daily for a week: want 7, got %d", len(got))
	}
}

func TestExpand_Weekday(t *testing.T) {
	// Jan 5 (Mon) through Jan 11 (Sun): weekdays are 5,6,7,8,9 → 5 instances.
	min := mustTime(t, "2026-01-05T00:00:00Z")
	max := mustTime(t, "2026-01-12T00:00:00Z")
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKDAY")

	got := expandEvent(in, min, max)
	if len(got) != 5 {
		t.Fatalf("weekday: want 5, got %d", len(got))
	}
	for _, e := range got {
		if wd := e.StartAt.Weekday(); wd == time.Saturday || wd == time.Sunday {
			t.Errorf("weekday rule emitted a weekend day: %v", e.StartAt)
		}
	}
}

func TestExpand_Monthly(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-04-01T00:00:00Z") // Jan, Feb, Mar
	in := master(t, "2026-01-15T09:00:00Z", "FREQ=MONTHLY")

	got := expandEvent(in, min, max)
	if len(got) != 3 {
		t.Fatalf("monthly: want 3, got %d", len(got))
	}
	for i, mo := range []time.Month{time.January, time.February, time.March} {
		if got[i].StartAt.Month() != mo || got[i].StartAt.Day() != 15 {
			t.Errorf("monthly instance %d: got %v, want day 15 of %v", i, got[i].StartAt, mo)
		}
	}
}

func TestExpand_MonthlyClampsShortMonth(t *testing.T) {
	// A "31st" series must land on Feb 28 (2026 is not a leap year), not roll
	// into March.
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-03-15T00:00:00Z")
	in := master(t, "2026-01-31T09:00:00Z", "FREQ=MONTHLY")

	got := expandEvent(in, min, max)
	// Jan 31, Feb 28, no March (March instance would be Mar 31 > max... actually
	// addMonthsClamped(Feb28)→Mar28 which is < max, so include it).
	if len(got) < 2 {
		t.Fatalf("monthly clamp: want >=2, got %d", len(got))
	}
	if got[1].StartAt.Month() != time.February || got[1].StartAt.Day() != 28 {
		t.Errorf("second instance should clamp to Feb 28, got %v", got[1].StartAt)
	}
}

func TestExpand_Yearly(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2029-01-01T00:00:00Z") // 2026, 2027, 2028
	in := master(t, "2026-07-04T09:00:00Z", "FREQ=YEARLY")

	got := expandEvent(in, min, max)
	if len(got) != 3 {
		t.Fatalf("yearly: want 3, got %d", len(got))
	}
	for i, y := range []int{2026, 2027, 2028} {
		if got[i].StartAt.Year() != y {
			t.Errorf("yearly instance %d: want year %d, got %v", i, y, got[i].StartAt)
		}
	}
}

func TestExpand_Count(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2027-01-01T00:00:00Z")
	in := master(t, "2026-01-01T09:00:00Z", "FREQ=DAILY;COUNT=3")

	got := expandEvent(in, min, max)
	if len(got) != 3 {
		t.Fatalf("daily COUNT=3: want 3, got %d", len(got))
	}
}

func TestExpand_Until(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2027-01-01T00:00:00Z")
	in := master(t, "2026-01-01T09:00:00Z", "FREQ=DAILY;UNTIL=2026-01-03T09:00:00Z")

	got := expandEvent(in, min, max)
	// Jan 1, 2, 3 (until is inclusive of the 3rd's 09:00 occurrence).
	if len(got) != 3 {
		t.Fatalf("daily UNTIL: want 3, got %d", len(got))
	}
}

func TestExpand_WindowClipsLeadingTrailing(t *testing.T) {
	// Daily series spanning a year, but window is only one week mid-series.
	min := mustTime(t, "2026-06-01T00:00:00Z")
	max := mustTime(t, "2026-06-08T00:00:00Z")
	in := master(t, "2026-01-01T09:00:00Z", "FREQ=DAILY")

	got := expandEvent(in, min, max)
	if len(got) != 7 {
		t.Fatalf("daily within 1-week window: want 7, got %d", len(got))
	}
	for _, e := range got {
		if e.StartAt.Before(min) || !e.StartAt.Before(max) {
			t.Errorf("instance outside window: %v", e.StartAt)
		}
	}
}

func TestParseRecurrence_Unrecognised(t *testing.T) {
	for _, s := range []string{"", "   ", "FREQ=HOURLY", "garbage", "INTERVAL=2"} {
		if _, ok := parseRecurrence(s); ok {
			t.Errorf("parseRecurrence(%q) should be not-ok", s)
		}
	}
	if _, ok := parseRecurrence("RRULE:FREQ=DAILY"); !ok {
		t.Errorf("RRULE: prefix should parse")
	}
}
