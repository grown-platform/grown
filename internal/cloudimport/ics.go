package cloudimport

import (
	"bufio"
	"fmt"
	"io"
	"strings"
	"time"
)

// ICSEvent holds the fields of a VEVENT extracted from an iCalendar file.
type ICSEvent struct {
	UID         string
	Summary     string
	Description string
	Location    string
	StartAt     time.Time
	EndAt       time.Time
	AllDay      bool
	RRule       string // raw RRULE value, e.g. "FREQ=WEEKLY;COUNT=5"
}

// ParseICS reads an iCalendar (.ics) stream and returns every VEVENT found.
// Only SUMMARY, DTSTART, DTEND, RRULE, DESCRIPTION, LOCATION, and UID are
// extracted; unrecognised properties are silently skipped.
func ParseICS(r io.Reader) ([]ICSEvent, error) {
	lines, err := unfoldLines(r)
	if err != nil {
		return nil, fmt.Errorf("ics parse: %w", err)
	}

	var events []ICSEvent
	var cur *ICSEvent

	for _, line := range lines {
		name, params, value := splitProperty(line)
		_ = params

		switch strings.ToUpper(name) {
		case "BEGIN":
			if strings.ToUpper(value) == "VEVENT" {
				e := ICSEvent{}
				cur = &e
			}
		case "END":
			if strings.ToUpper(value) == "VEVENT" && cur != nil {
				if cur.EndAt.IsZero() && !cur.StartAt.IsZero() {
					// All-day events with only DTSTART get a 1-day span.
					if cur.AllDay {
						cur.EndAt = cur.StartAt.AddDate(0, 0, 1)
					} else {
						cur.EndAt = cur.StartAt.Add(time.Hour)
					}
				}
				events = append(events, *cur)
				cur = nil
			}
		default:
			if cur == nil {
				continue
			}
			switch strings.ToUpper(name) {
			case "UID":
				cur.UID = value
			case "SUMMARY":
				cur.Summary = unescapeICS(value)
			case "DESCRIPTION":
				cur.Description = unescapeICS(value)
			case "LOCATION":
				cur.Location = unescapeICS(value)
			case "RRULE":
				cur.RRule = value
			case "DTSTART", "DTSTART;VALUE=DATE":
				t, allDay, err := parseICSTime(name, value)
				if err == nil {
					cur.StartAt = t
					cur.AllDay = allDay
				}
			case "DTEND", "DTEND;VALUE=DATE":
				t, _, err := parseICSTime(name, value)
				if err == nil {
					cur.EndAt = t
				}
			}
		}
	}
	return events, nil
}

// unfoldLines reads an RFC 5545 content stream and unfolds continuation lines
// (lines beginning with a space or tab are joined to the previous line).
func unfoldLines(r io.Reader) ([]string, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1<<16), 1<<16)
	var lines []string
	for scanner.Scan() {
		raw := scanner.Text()
		if len(raw) > 0 && (raw[0] == ' ' || raw[0] == '\t') {
			// Continuation — append to previous line.
			if len(lines) > 0 {
				lines[len(lines)-1] += raw[1:]
			}
		} else {
			lines = append(lines, raw)
		}
	}
	return lines, scanner.Err()
}

// splitProperty splits "NAME;PARAMS:VALUE" into its three parts.
// params is everything between the first semicolon and the first colon (may be empty).
func splitProperty(line string) (name, params, value string) {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return line, "", ""
	}
	lhs := line[:colon]
	value = line[colon+1:]
	semi := strings.IndexByte(lhs, ';')
	if semi < 0 {
		return lhs, "", value
	}
	return lhs[:semi], lhs[semi+1:], value
}

// parseICSTime parses a DTSTART/DTEND value.  It handles:
//   - DATE (all-day): YYYYMMDD
//   - DATE-TIME floating: YYYYMMDDTHHmmss
//   - DATE-TIME UTC:      YYYYMMDDTHHmmssZ
//   - TZID params are ignored (treated as local) for simplicity.
func parseICSTime(propLine, value string) (time.Time, bool, error) {
	// If the property line contains VALUE=DATE (passed as the name param here
	// for the DATE-only variant), treat as all-day.
	isDateOnly := strings.Contains(strings.ToUpper(propLine), "VALUE=DATE") ||
		len(value) == 8 // YYYYMMDD

	if isDateOnly && len(value) >= 8 {
		t, err := time.Parse("20060102", value[:8])
		return t, true, err
	}
	// DATE-TIME
	v := strings.TrimSuffix(value, "Z")
	isUTC := strings.HasSuffix(value, "Z")
	if len(v) < 15 {
		return time.Time{}, false, fmt.Errorf("short datetime: %q", value)
	}
	v = v[:15]
	t, err := time.Parse("20060102T150405", v)
	if err != nil {
		return time.Time{}, false, err
	}
	if isUTC {
		t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC)
	}
	return t, false, nil
}

// unescapeICS reverses RFC 5545 text escapes (\n → newline, \, \; \,).
func unescapeICS(s string) string {
	s = strings.ReplaceAll(s, "\\n", "\n")
	s = strings.ReplaceAll(s, "\\N", "\n")
	s = strings.ReplaceAll(s, "\\,", ",")
	s = strings.ReplaceAll(s, "\\;", ";")
	s = strings.ReplaceAll(s, "\\\\", "\\")
	return s
}
