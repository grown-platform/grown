package contacts

import (
	"reflect"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// splitLabels
// ---------------------------------------------------------------------------

func TestSplitLabels(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"triple colon", "myContacts ::: Work", []string{"myContacts", "Work"}},
		{"triple colon trims", "  A  :::  B  ", []string{"A", "B"}},
		{"triple colon skips blank", "A ::: ::: B", []string{"A", "B"}},
		{"comma fallback", "Friends, Family", []string{"Friends", "Family"}},
		{"comma skips blank", "A, , B,", []string{"A", "B"}},
		{"single value", "Solo", []string{"Solo"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitLabels(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("splitLabels(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// splitGoogleGroups
// ---------------------------------------------------------------------------

func TestSplitGoogleGroups(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"strips asterisk and myContacts", "* myContacts ::: Work", []string{"Work"}},
		{"my contacts spaced variant filtered", "* my Contacts ::: VIP", []string{"VIP"}},
		{"myContacts case-insensitive", "MYCONTACTS ::: Friends", []string{"Friends"}},
		{"multiple real groups", "* myContacts ::: Work ::: VIP", []string{"Work", "VIP"}},
		{"only default group yields none", "* myContacts", nil},
		{"blank segments skipped", "Work ::: ::: Home", []string{"Work", "Home"}},
		{"asterisk prefix only stripped with space", "*Starred", []string{"*Starred"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitGoogleGroups(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("splitGoogleGroups(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ParseGoogleCSV — additional edge cases
// ---------------------------------------------------------------------------

func TestParseGoogleCSV_MoreThanThreeEmails(t *testing.T) {
	csv := "Name,E-mail 1 - Value,E-mail 2 - Value,E-mail 3 - Value,E-mail 4 - Value\n" +
		"Ada,a@x.io,b@x.io,c@x.io,d@x.io"
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 || len(rows[0].Emails) != 4 {
		t.Errorf("expected 4 emails, got %v", rows[0].Emails)
	}
}

func TestParseGoogleCSV_EmailGapStopsScan(t *testing.T) {
	// A blank E-mail 1 stops the scan even though E-mail 2 has a value:
	// the loop breaks at the first empty slot.
	csv := "Name,E-mail 1 - Value,E-mail 2 - Value\n" +
		"Ada,,b@x.io"
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if len(rows[0].Emails) != 0 {
		t.Errorf("expected scan to stop at empty E-mail 1, got %v", rows[0].Emails)
	}
}

func TestParseGoogleCSV_PhoneDedup(t *testing.T) {
	csv := "Name,Phone 1 - Value,Phone 2 - Value\n" +
		"Ada,+1 555,+1 555"
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows[0].Phones) != 1 {
		t.Errorf("expected 1 deduped phone, got %v", rows[0].Phones)
	}
}

func TestParseGoogleCSV_LabelsColumnCommaSeparated(t *testing.T) {
	// The "Labels" column (not "Group Membership") with comma separators.
	csv := "Name,E-mail 1 - Value,Labels\n" +
		"Ada,ada@x.io,\"Work, Friends\""
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if !reflect.DeepEqual(rows[0].Labels, []string{"Work", "Friends"}) {
		t.Errorf("Labels = %v, want [Work Friends]", rows[0].Labels)
	}
}

func TestParseGoogleCSV_LabelsAndGroupMembershipMerged(t *testing.T) {
	// Both columns present: labels are merged and deduped.
	csv := "Name,Labels,Group Membership\n" +
		"Ada,Work,* myContacts ::: Work ::: VIP"
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	labels := rows[0].Labels
	if len(labels) != 2 {
		t.Errorf("expected deduped [Work VIP], got %v", labels)
	}
}

func TestParseGoogleCSV_LazyQuotesLenient(t *testing.T) {
	// LazyQuotes makes the reader tolerant of sloppy quoting, so this parses
	// rather than erroring. Verify we get a clean result and no panic; any
	// error returned must carry the package prefix.
	in := "Name\n\"unterminated"
	rows, err := ParseGoogleCSV(in)
	if err != nil {
		if !strings.Contains(err.Error(), "googlecsv:") {
			t.Errorf("error should be wrapped with package prefix, got %v", err)
		}
		return
	}
	// With a single "Name" header column, the lone data cell becomes a contact.
	if len(rows) != 1 || rows[0].DisplayName != "unterminated" {
		t.Errorf("expected 1 row named 'unterminated', got %v", rows)
	}
}

func TestParseGoogleCSV_ParseErrorWrapped(t *testing.T) {
	// A bare quote inside an unquoted field defeats even LazyQuotes recovery
	// in some inputs; if an error is produced it must be wrapped. This input
	// embeds a stray quote mid-field across a record boundary.
	in := "Name,Notes\nAda,a\"b\"c\nBob,\"x"
	_, err := ParseGoogleCSV(in)
	if err != nil && !strings.Contains(err.Error(), "googlecsv:") {
		t.Errorf("error should be wrapped with package prefix, got %v", err)
	}
}

func TestParseGoogleCSV_ColumnAbsentReturnsEmpty(t *testing.T) {
	// Notes/Organization columns absent — fields stay empty, no panic.
	csv := "Name,E-mail 1 - Value\nAda,ada@x.io"
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rows[0].Company != "" || rows[0].Notes != "" {
		t.Errorf("expected empty Company/Notes, got %+v", rows[0])
	}
}

func TestParseGoogleCSV_ShortRowOutOfRange(t *testing.T) {
	// Header declares many columns but data row is short; get() must not panic
	// and returns empty for out-of-range indices.
	csv := "Name,Given Name,Family Name,E-mail 1 - Value\nAda"
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 || rows[0].DisplayName != "Ada" {
		t.Errorf("expected 1 row named Ada, got %v", rows)
	}
	if len(rows[0].Emails) != 0 {
		t.Errorf("expected no emails for short row, got %v", rows[0].Emails)
	}
}
