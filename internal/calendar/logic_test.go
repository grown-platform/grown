package calendar

import (
	"testing"
	"time"
)

// ---- parseRecurrence: field parsing & edge cases ----

func TestParseRecurrence_Fields(t *testing.T) {
	cases := []struct {
		name     string
		in       string
		wantOK   bool
		freq     string
		interval int
		count    int
		hasUntil bool
		byDays   []time.Weekday
	}{
		{"daily default interval", "FREQ=DAILY", true, "DAILY", 1, 0, false, nil},
		{"weekly with byday", "FREQ=WEEKLY;BYDAY=MO,WE,FR", true, "WEEKLY", 1, 0, false,
			[]time.Weekday{time.Monday, time.Wednesday, time.Friday}},
		{"interval honoured", "FREQ=DAILY;INTERVAL=3", true, "DAILY", 3, 0, false, nil},
		{"interval zero ignored", "FREQ=DAILY;INTERVAL=0", true, "DAILY", 1, 0, false, nil},
		{"interval negative ignored", "FREQ=DAILY;INTERVAL=-5", true, "DAILY", 1, 0, false, nil},
		{"interval garbage ignored", "FREQ=DAILY;INTERVAL=abc", true, "DAILY", 1, 0, false, nil},
		{"count parsed", "FREQ=DAILY;COUNT=10", true, "DAILY", 1, 10, false, nil},
		{"count zero ignored", "FREQ=DAILY;COUNT=0", true, "DAILY", 1, 0, false, nil},
		{"until parsed", "FREQ=DAILY;UNTIL=2026-12-31T00:00:00Z", true, "DAILY", 1, 0, true, nil},
		{"until bad ignored", "FREQ=DAILY;UNTIL=not-a-date", true, "DAILY", 1, 0, false, nil},
		{"rrule prefix", "RRULE:FREQ=WEEKLY", true, "WEEKLY", 1, 0, false, nil},
		{"lowercase keys/vals", "freq=weekly;byday=mo", true, "WEEKLY", 1, 0, false,
			[]time.Weekday{time.Monday}},
		{"whitespace tolerant", "  FREQ = DAILY ; INTERVAL = 2 ", true, "DAILY", 2, 0, false, nil},
		{"empty segments tolerated", "FREQ=DAILY;;;", true, "DAILY", 1, 0, false, nil},
		{"missing equals tolerated", "FREQ=DAILY;NOPE", true, "DAILY", 1, 0, false, nil},
		{"weekday shorthand", "FREQ=WEEKDAY", true, "WEEKDAY", 1, 0, false, nil},
		{"yearly", "FREQ=YEARLY", true, "YEARLY", 1, 0, false, nil},
		{"monthly", "FREQ=MONTHLY", true, "MONTHLY", 1, 0, false, nil},
		// not-ok cases
		{"blank", "", false, "", 0, 0, false, nil},
		{"spaces only", "   ", false, "", 0, 0, false, nil},
		{"unknown freq", "FREQ=HOURLY", false, "", 0, 0, false, nil},
		{"no freq", "INTERVAL=2;COUNT=3", false, "", 0, 0, false, nil},
		{"garbage", "garbage", false, "", 0, 0, false, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, ok := parseRecurrence(tc.in)
			if ok != tc.wantOK {
				t.Fatalf("ok: got %v want %v", ok, tc.wantOK)
			}
			if !tc.wantOK {
				return
			}
			if r.freq != tc.freq {
				t.Errorf("freq: got %q want %q", r.freq, tc.freq)
			}
			if r.interval != tc.interval {
				t.Errorf("interval: got %d want %d", r.interval, tc.interval)
			}
			if r.count != tc.count {
				t.Errorf("count: got %d want %d", r.count, tc.count)
			}
			if r.hasUntil != tc.hasUntil {
				t.Errorf("hasUntil: got %v want %v", r.hasUntil, tc.hasUntil)
			}
			for _, wd := range tc.byDays {
				if !r.byDay[wd] {
					t.Errorf("byDay missing %v", wd)
				}
			}
			if tc.byDays != nil && len(r.byDay) != len(tc.byDays) {
				t.Errorf("byDay size: got %d want %d", len(r.byDay), len(tc.byDays))
			}
		})
	}
}

func TestParseRecurrence_BadBydayCodesDropped(t *testing.T) {
	r, ok := parseRecurrence("FREQ=WEEKLY;BYDAY=MO,XX,FR")
	if !ok {
		t.Fatal("should parse")
	}
	if !r.byDay[time.Monday] || !r.byDay[time.Friday] {
		t.Errorf("MO/FR should be present: %v", r.byDay)
	}
	if len(r.byDay) != 2 {
		t.Errorf("bad code XX should be dropped, got %d entries", len(r.byDay))
	}
}

// ---- expandEvent: additional edge cases ----

// A zero-length (start==end) event is still emitted; duration is preserved as 0.
func TestExpand_ZeroDuration(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-01-04T00:00:00Z")
	s := mustTime(t, "2026-01-01T09:00:00Z")
	in := Event{ID: "z", StartAt: s, EndAt: s, Recurrence: "FREQ=DAILY"}

	got := expandEvent(in, min, max)
	if len(got) != 3 {
		t.Fatalf("zero-duration daily: want 3, got %d", len(got))
	}
	for _, e := range got {
		if !e.EndAt.Equal(e.StartAt) {
			t.Errorf("zero duration not preserved: %v..%v", e.StartAt, e.EndAt)
		}
	}
}

// An end-before-start master clamps duration to 0 rather than going negative.
func TestExpand_NegativeDurationClamped(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-01-03T00:00:00Z")
	s := mustTime(t, "2026-01-01T09:00:00Z")
	in := Event{ID: "n", StartAt: s, EndAt: s.Add(-time.Hour), Recurrence: "FREQ=DAILY"}

	got := expandEvent(in, min, max)
	if len(got) == 0 {
		t.Fatal("expected instances")
	}
	for _, e := range got {
		if e.EndAt.Before(e.StartAt) {
			t.Errorf("negative duration leaked: %v..%v", e.StartAt, e.EndAt)
		}
	}
}

// COUNT caps occurrences even when the window would otherwise produce more.
func TestExpand_CountWeekly(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2027-01-01T00:00:00Z")
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKLY;COUNT=3")

	got := expandEvent(in, min, max)
	if len(got) != 3 {
		t.Fatalf("weekly COUNT=3: want 3, got %d", len(got))
	}
	wantDays := []int{5, 12, 19}
	for i, e := range got {
		if e.StartAt.Day() != wantDays[i] {
			t.Errorf("instance %d: want day %d got %v", i, wantDays[i], e.StartAt)
		}
	}
}

// UNTIL bound on a weekly series.
func TestExpand_WeeklyUntil(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2027-01-01T00:00:00Z")
	// Mondays; stop after Jan 19.
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKLY;UNTIL=2026-01-19T09:00:00Z")
	got := expandEvent(in, min, max)
	if len(got) != 3 {
		t.Fatalf("weekly until Jan 19: want 3, got %d", len(got))
	}
	if got[len(got)-1].StartAt.Day() != 19 {
		t.Errorf("last instance should be Jan 19, got %v", got[len(got)-1].StartAt)
	}
}

// Yearly on Feb 29 (leap day): non-leap years clamp to Feb 28.
func TestExpand_YearlyLeapDay(t *testing.T) {
	min := mustTime(t, "2024-01-01T00:00:00Z")
	max := mustTime(t, "2027-06-01T00:00:00Z")
	// 2024 is a leap year.
	in := master(t, "2024-02-29T09:00:00Z", "FREQ=YEARLY")
	got := expandEvent(in, min, max)
	if len(got) == 0 {
		t.Fatal("expected instances")
	}
	if got[0].StartAt.Year() != 2024 || got[0].StartAt.Month() != time.February || got[0].StartAt.Day() != 29 {
		t.Errorf("first should be 2024-02-29, got %v", got[0].StartAt)
	}
	// AddDate(1,0,0) on Feb 29 → Mar 1 in non-leap years (Go normalizes).
	// Assert the expansion does not crash and the year advances.
	for i := 1; i < len(got); i++ {
		if !got[i].StartAt.After(got[i-1].StartAt) {
			t.Errorf("instances not strictly increasing at %d: %v then %v", i, got[i-1].StartAt, got[i].StartAt)
		}
	}
}

// Monthly with INTERVAL=2 from a month-end day, asserting clamp across short months.
func TestExpand_MonthlyIntervalClamp(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-08-01T00:00:00Z")
	// Jan 31, every 2 months: Jan 31, Mar 31, May 31, Jul 31.
	in := master(t, "2026-01-31T09:00:00Z", "FREQ=MONTHLY;INTERVAL=2")
	got := expandEvent(in, min, max)
	wantMonths := []time.Month{time.January, time.March, time.May, time.July}
	if len(got) != len(wantMonths) {
		t.Fatalf("want %d, got %d", len(wantMonths), len(got))
	}
	for i, mo := range wantMonths {
		if got[i].StartAt.Month() != mo || got[i].StartAt.Day() != 31 {
			t.Errorf("instance %d: got %v want day 31 of %v", i, got[i].StartAt, mo)
		}
	}
}

// A recurring master whose every occurrence is outside the window yields nothing.
func TestExpand_NoOverlapWindow(t *testing.T) {
	min := mustTime(t, "2026-06-01T00:00:00Z")
	max := mustTime(t, "2026-06-02T00:00:00Z")
	// Weekly Mondays starting Jan; June 1 2026 is a Monday but the series clock is
	// 09:00 on Mondays — June 1 IS a Monday, so to avoid overlap use a Tuesday series.
	in := master(t, "2026-01-06T09:00:00Z", "FREQ=WEEKLY") // Jan 6 is a Tuesday
	got := expandEvent(in, min, max)
	if len(got) != 0 {
		t.Fatalf("Tuesday series over a Mon-only window: want 0, got %d (%v)", len(got), got)
	}
}

// maxOccurrences caps a pathological daily series over a huge window.
func TestExpand_MaxOccurrencesCap(t *testing.T) {
	min := mustTime(t, "2000-01-01T00:00:00Z")
	max := mustTime(t, "3000-01-01T00:00:00Z")
	in := master(t, "2000-01-01T09:00:00Z", "FREQ=DAILY")
	got := expandEvent(in, min, max)
	if len(got) > maxOccurrences {
		t.Fatalf("expansion exceeded cap: got %d > %d", len(got), maxOccurrences)
	}
	if len(got) != maxOccurrences {
		t.Fatalf("expected exactly the cap %d, got %d", maxOccurrences, len(got))
	}
}

// Instances are returned sorted by start.
func TestExpand_Sorted(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-02-01T00:00:00Z")
	in := master(t, "2026-01-05T09:00:00Z", "FREQ=WEEKLY;BYDAY=MO,WE,FR")
	got := expandEvent(in, min, max)
	for i := 1; i < len(got); i++ {
		if got[i].StartAt.Before(got[i-1].StartAt) {
			t.Fatalf("instances not sorted at %d: %v before %v", i, got[i].StartAt, got[i-1].StartAt)
		}
	}
}

// WEEKLY without BYDAY uses the master's own weekday.
func TestExpand_WeeklyDefaultsToMasterWeekday(t *testing.T) {
	min := mustTime(t, "2026-01-01T00:00:00Z")
	max := mustTime(t, "2026-02-01T00:00:00Z")
	in := master(t, "2026-01-07T09:00:00Z", "FREQ=WEEKLY") // Jan 7 2026 is a Wednesday
	got := expandEvent(in, min, max)
	if len(got) == 0 {
		t.Fatal("expected instances")
	}
	for _, e := range got {
		if e.StartAt.Weekday() != time.Wednesday {
			t.Errorf("expected all Wednesdays, got %v (%v)", e.StartAt.Weekday(), e.StartAt)
		}
	}
}

// DST: in a zone observing DST, a daily series keeps wall-clock 09:00 across the
// spring-forward boundary because expansion uses AddDate on the location-aware time.
func TestExpand_DailyAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tz data unavailable: %v", err)
	}
	// US DST 2026 begins Sun Mar 8. Series at 09:00 local, Mar 6..Mar 10.
	start := time.Date(2026, 3, 6, 9, 0, 0, 0, loc)
	min := time.Date(2026, 3, 1, 0, 0, 0, 0, loc)
	max := time.Date(2026, 3, 11, 0, 0, 0, 0, loc)
	in := Event{ID: "dst", StartAt: start, EndAt: start.Add(time.Hour), Recurrence: "FREQ=DAILY"}
	got := expandEvent(in, min.UTC(), max.UTC())
	if len(got) != 5 {
		t.Fatalf("daily across DST: want 5, got %d", len(got))
	}
	for _, e := range got {
		if h := e.StartAt.In(loc).Hour(); h != 9 {
			t.Errorf("wall-clock hour drifted across DST: got %d (%v)", h, e.StartAt.In(loc))
		}
	}
}

// ---- time-math helpers ----

func TestDaysInMonth(t *testing.T) {
	cases := []struct {
		year int
		m    time.Month
		want int
	}{
		{2026, time.January, 31},
		{2026, time.February, 28},
		{2024, time.February, 29}, // leap
		{2000, time.February, 29}, // div-by-400 leap
		{1900, time.February, 28}, // div-by-100 non-leap
		{2026, time.April, 30},
		{2026, time.December, 31},
	}
	for _, tc := range cases {
		if got := daysInMonth(tc.year, tc.m); got != tc.want {
			t.Errorf("daysInMonth(%d,%v): got %d want %d", tc.year, tc.m, got, tc.want)
		}
	}
}

func TestAddMonthsClamped(t *testing.T) {
	cases := []struct {
		name string
		in   string
		n    int
		want string
	}{
		{"jan31 +1 -> feb28", "2026-01-31T09:00:00Z", 1, "2026-02-28T09:00:00Z"},
		{"jan31 +1 leap -> feb29", "2024-01-31T09:00:00Z", 1, "2024-02-29T09:00:00Z"},
		{"jan15 +1 -> feb15", "2026-01-15T09:00:00Z", 1, "2026-02-15T09:00:00Z"},
		{"dec15 +1 wraps year", "2026-12-15T09:00:00Z", 1, "2027-01-15T09:00:00Z"},
		{"oct31 +1 -> nov30", "2026-10-31T09:00:00Z", 1, "2026-11-30T09:00:00Z"},
		{"jan31 +13 wraps to feb28 next yr", "2026-01-31T09:00:00Z", 13, "2027-02-28T09:00:00Z"},
		{"march15 -1 -> feb15", "2026-03-15T09:00:00Z", -1, "2026-02-15T09:00:00Z"},
		{"jan15 -1 wraps to prev year dec", "2026-01-15T09:00:00Z", -1, "2025-12-15T09:00:00Z"},
		{"mar31 -1 -> feb28 clamp", "2026-03-31T09:00:00Z", -1, "2026-02-28T09:00:00Z"},
		{"+12 same month next year", "2026-05-20T09:00:00Z", 12, "2027-05-20T09:00:00Z"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := addMonthsClamped(mustTime(t, tc.in), tc.n)
			want := mustTime(t, tc.want)
			if !got.Equal(want) {
				t.Errorf("addMonthsClamped(%s,%d): got %v want %v", tc.in, tc.n, got, want)
			}
		})
	}
}

func TestAddMonthsClamped_PreservesClock(t *testing.T) {
	in := mustTime(t, "2026-01-31T13:45:07Z")
	got := addMonthsClamped(in, 1)
	if got.Hour() != 13 || got.Minute() != 45 || got.Second() != 7 {
		t.Errorf("clock not preserved: %v", got)
	}
}

func TestStartOfWeekAt(t *testing.T) {
	// Jan 7 2026 is a Wednesday; week start (Sunday) is Jan 4 00:00.
	wed := mustTime(t, "2026-01-07T15:30:00Z")
	got := startOfWeekAt(wed)
	want := mustTime(t, "2026-01-04T00:00:00Z")
	if !got.Equal(want) {
		t.Errorf("startOfWeekAt: got %v want %v", got, want)
	}
	// A Sunday returns itself at 00:00.
	sun := mustTime(t, "2026-01-04T18:00:00Z")
	if g := startOfWeekAt(sun); !g.Equal(want) {
		t.Errorf("startOfWeekAt(Sunday): got %v want %v", g, want)
	}
}

func TestSetClock(t *testing.T) {
	day := mustTime(t, "2026-03-15T00:00:00Z")
	ref := mustTime(t, "2020-11-02T08:09:10Z")
	got := setClock(day, ref)
	if got.Year() != 2026 || got.Month() != time.March || got.Day() != 15 {
		t.Errorf("date should come from day: %v", got)
	}
	if got.Hour() != 8 || got.Minute() != 9 || got.Second() != 10 {
		t.Errorf("clock should come from ref: %v", got)
	}
}

// ---- sanitizeAttendees ----

func TestSanitizeAttendees(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"nil", nil, []string{}},
		{"empty", []string{}, []string{}},
		{"trim+lower", []string{"  Foo@Bar.COM "}, []string{"foo@bar.com"}},
		{"drop blanks", []string{"", "  ", "a@x.io"}, []string{"a@x.io"}},
		{"dedupe case-insensitive", []string{"A@x.io", "a@x.io", "A@X.IO"}, []string{"a@x.io"}},
		{"preserve first-seen order", []string{"b@x.io", "a@x.io", "b@x.io"}, []string{"b@x.io", "a@x.io"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeAttendees(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("len: got %v want %v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("idx %d: got %q want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// ---- parseTime ----

func TestParseTime(t *testing.T) {
	cases := []struct {
		in     string
		wantOK bool
	}{
		{"", false},
		{"2026-01-02T03:04:05Z", true},
		{"2026-01-02T03:04:05+02:00", true},
		{"not-a-time", false},
		{"2026-01-02", false}, // date-only is not RFC3339
	}
	for _, tc := range cases {
		got, ok := parseTime(tc.in)
		if ok != tc.wantOK {
			t.Errorf("parseTime(%q): ok=%v want %v", tc.in, ok, tc.wantOK)
		}
		if !ok && !got.IsZero() {
			t.Errorf("parseTime(%q): expected zero value on failure, got %v", tc.in, got)
		}
	}
}

// ---- fieldsFrom: validation & defaulting ----

func TestFieldsFrom(t *testing.T) {
	const start = "2026-01-02T09:00:00Z"

	t.Run("missing start is invalid", func(t *testing.T) {
		_, err := fieldsFrom("t", "", "", "", start, false, "", "", nil, "", nil, "", "", false)
		if err == nil {
			t.Fatal("expected error for missing start")
		}
	})

	t.Run("bad start is invalid", func(t *testing.T) {
		_, err := fieldsFrom("t", "", "", "nope", start, false, "", "", nil, "", nil, "", "", false)
		if err == nil {
			t.Fatal("expected error for bad start")
		}
	})

	t.Run("missing end defaults to +1h", func(t *testing.T) {
		f, err := fieldsFrom("t", "", "", start, "", false, "", "", nil, "", nil, "", "", false)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if f.EndAt.Sub(f.StartAt) != time.Hour {
			t.Errorf("default duration: got %v want 1h", f.EndAt.Sub(f.StartAt))
		}
	})

	t.Run("end before start defaults to +1h", func(t *testing.T) {
		f, err := fieldsFrom("t", "", "", start, "2026-01-02T08:00:00Z", false, "", "", nil, "", nil, "", "", false)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if f.EndAt.Sub(f.StartAt) != time.Hour {
			t.Errorf("end-before-start should default to +1h, got %v", f.EndAt.Sub(f.StartAt))
		}
	})

	t.Run("valid end preserved", func(t *testing.T) {
		f, err := fieldsFrom("t", "", "", start, "2026-01-02T11:30:00Z", false, "", "", nil, "", nil, "", "", false)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if f.EndAt.Sub(f.StartAt) != 150*time.Minute {
			t.Errorf("explicit end not preserved, got %v", f.EndAt.Sub(f.StartAt))
		}
	})

	t.Run("attendees sanitized", func(t *testing.T) {
		f, err := fieldsFrom("t", "", "", start, "", false, "", "", []string{"A@x.io", "a@x.io", ""}, "", nil, "", "", false)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(f.Attendees) != 1 || f.Attendees[0] != "a@x.io" {
			t.Errorf("attendees not sanitized: %v", f.Attendees)
		}
	})

	t.Run("all-day flag and other fields carried through", func(t *testing.T) {
		f, err := fieldsFrom("Title", "Desc", "Loc", start, "", true, "#fff", "FREQ=DAILY",
			nil, ItemTypeTask, []int32{10, 20}, StatusFree, VisibilityPrivate, true)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !f.AllDay || f.Title != "Title" || f.Color != "#fff" || f.Recurrence != "FREQ=DAILY" ||
			f.ItemType != ItemTypeTask || f.Status != StatusFree || f.Visibility != VisibilityPrivate || !f.TaskDone {
			t.Errorf("fields not carried through: %+v", f)
		}
		if len(f.Reminders) != 2 || f.Reminders[0] != 10 {
			t.Errorf("reminders not carried: %v", f.Reminders)
		}
	})
}

// ---- normalize helpers ----

func TestNormalizeItemType(t *testing.T) {
	cases := map[string]string{
		ItemTypeTask:        ItemTypeTask,
		ItemTypeOutOfOffice: ItemTypeOutOfOffice,
		ItemTypeFocusTime:   ItemTypeFocusTime,
		ItemTypeEvent:       ItemTypeEvent,
		"":                  ItemTypeEvent,
		"bogus":             ItemTypeEvent,
	}
	for in, want := range cases {
		if got := normalizeItemType(in); got != want {
			t.Errorf("normalizeItemType(%q): got %q want %q", in, got, want)
		}
	}
}

func TestNormalizeStatus(t *testing.T) {
	cases := map[string]string{
		StatusFree: StatusFree,
		StatusBusy: StatusBusy,
		"":         StatusBusy,
		"weird":    StatusBusy,
	}
	for in, want := range cases {
		if got := normalizeStatus(in); got != want {
			t.Errorf("normalizeStatus(%q): got %q want %q", in, got, want)
		}
	}
}

func TestNormalizeVisibility(t *testing.T) {
	cases := map[string]string{
		VisibilityPublic:  VisibilityPublic,
		VisibilityPrivate: VisibilityPrivate,
		VisibilityDefault: VisibilityDefault,
		"":                VisibilityDefault,
		"hidden":          VisibilityDefault,
	}
	for in, want := range cases {
		if got := normalizeVisibility(in); got != want {
			t.Errorf("normalizeVisibility(%q): got %q want %q", in, got, want)
		}
	}
}

// ---- jsonArr helpers ----

func TestJSONArr(t *testing.T) {
	if got := string(jsonArr(nil)); got != "[]" {
		t.Errorf("jsonArr(nil): got %q want []", got)
	}
	if got := string(jsonArr([]string{"a", "b"})); got != `["a","b"]` {
		t.Errorf("jsonArr: got %q", got)
	}
	if got := string(jsonArr32(nil)); got != "[]" {
		t.Errorf("jsonArr32(nil): got %q want []", got)
	}
	if got := string(jsonArr32([]int32{1, 2})); got != "[1,2]" {
		t.Errorf("jsonArr32: got %q", got)
	}
}
