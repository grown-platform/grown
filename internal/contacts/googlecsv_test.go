package contacts

import (
	"strings"
	"testing"
)

// googleCSVFullHeader is the complete header produced by Google Contacts export.
// Column indices (0-based):
//
//	0  Name                    25 Notes
//	1  Given Name              26 Language
//	2  Additional Name         27 Photo
//	3  Family Name             28 Group Membership
//	4  Yomi Name               29 E-mail 1 - Type
//	5  Given Name Yomi         30 E-mail 1 - Value
//	6  Additional Name Yomi    31 E-mail 2 - Type
//	7  Family Name Yomi        32 E-mail 2 - Value
//	8  Name Prefix             33 E-mail 3 - Type
//	9  Name Suffix             34 E-mail 3 - Value
//	10 Initials                35 Phone 1 - Type
//	11 Nickname                36 Phone 1 - Value
//	12 Short Name              37 Phone 2 - Type
//	13 Maiden Name             38 Phone 2 - Value
//	14 Birthday                39 Organization 1 - Type
//	15 Gender                  40 Organization 1 - Name
//	16 Location                41 Organization 1 - Yomi Name
//	17 Billing Information     42 Organization 1 - Title
//	18 Directory Server        43 Organization 1 - Department
//	19 Mileage                 44 Organization 1 - Symbol
//	20 Occupation              45 Organization 1 - Location
//	21 Hobby                   46 Organization 1 - Job Description
//	22 Sensitivity
//	23 Priority
//	24 Subject
const googleCSVFullHeader = `Name,Given Name,Additional Name,Family Name,Yomi Name,Given Name Yomi,Additional Name Yomi,Family Name Yomi,Name Prefix,Name Suffix,Initials,Nickname,Short Name,Maiden Name,Birthday,Gender,Location,Billing Information,Directory Server,Mileage,Occupation,Hobby,Sensitivity,Priority,Subject,Notes,Language,Photo,Group Membership,E-mail 1 - Type,E-mail 1 - Value,E-mail 2 - Type,E-mail 2 - Value,E-mail 3 - Type,E-mail 3 - Value,Phone 1 - Type,Phone 1 - Value,Phone 2 - Type,Phone 2 - Value,Organization 1 - Type,Organization 1 - Name,Organization 1 - Yomi Name,Organization 1 - Title,Organization 1 - Department,Organization 1 - Symbol,Organization 1 - Location,Organization 1 - Job Description`

// buildRow builds a 47-column Google CSV row, setting only named columns.
func buildRow(vals map[int]string) string {
	const totalCols = 47
	cells := make([]string, totalCols)
	for i, v := range vals {
		if i < totalCols {
			cells[i] = v
		}
	}
	return strings.Join(cells, ",")
}

func TestParseGoogleCSV_FullHeader(t *testing.T) {
	// Build a properly-aligned 47-column data row.
	dataRow := buildRow(map[int]string{
		0:  "Ada Lovelace",          // Name
		1:  "Ada",                   // Given Name
		3:  "Lovelace",              // Family Name
		25: "First programmer",      // Notes
		28: "* myContacts ::: Work", // Group Membership
		30: "ada@example.com",       // E-mail 1 - Value
		32: "ada@work.com",          // E-mail 2 - Value
		36: "+1 555 0100",           // Phone 1 - Value
		38: "+1 555 0200",           // Phone 2 - Value
		40: "Analytical Engines",    // Organization 1 - Name
		42: "Mathematician",         // Organization 1 - Title
	})

	csvData := googleCSVFullHeader + "\n" + dataRow

	rows, err := ParseGoogleCSV(csvData)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	c := rows[0]

	if c.DisplayName != "Ada Lovelace" {
		t.Errorf("DisplayName = %q, want %q", c.DisplayName, "Ada Lovelace")
	}
	if c.FirstName != "Ada" {
		t.Errorf("FirstName = %q, want %q", c.FirstName, "Ada")
	}
	if c.LastName != "Lovelace" {
		t.Errorf("LastName = %q, want %q", c.LastName, "Lovelace")
	}
	if c.Company != "Analytical Engines" {
		t.Errorf("Company = %q, want %q", c.Company, "Analytical Engines")
	}
	if c.JobTitle != "Mathematician" {
		t.Errorf("JobTitle = %q, want %q", c.JobTitle, "Mathematician")
	}
	if c.Notes != "First programmer" {
		t.Errorf("Notes = %q, want %q", c.Notes, "First programmer")
	}
	if len(c.Emails) != 2 {
		t.Errorf("Emails count = %d, want 2; got %v", len(c.Emails), c.Emails)
	} else {
		if c.Emails[0] != "ada@example.com" {
			t.Errorf("Emails[0] = %q, want %q", c.Emails[0], "ada@example.com")
		}
		if c.Emails[1] != "ada@work.com" {
			t.Errorf("Emails[1] = %q, want %q", c.Emails[1], "ada@work.com")
		}
	}
	if len(c.Phones) != 2 {
		t.Errorf("Phones count = %d, want 2; got %v", len(c.Phones), c.Phones)
	}
	// "Work" label should be included; "myContacts" should be stripped.
	foundWork := false
	for _, l := range c.Labels {
		if l == "Work" {
			foundWork = true
		}
		if strings.EqualFold(l, "myContacts") {
			t.Errorf("Labels should not include myContacts, got %v", c.Labels)
		}
	}
	if !foundWork {
		t.Errorf("expected 'Work' in labels, got %v", c.Labels)
	}
}

func TestParseGoogleCSV_MinimalHeader(t *testing.T) {
	csv := "Name,Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value,Organization 1 - Name,Organization 1 - Title,Notes\n" +
		"Alan Turing,Alan,Turing,alan@example.com,+44 20 0000,GCHQ,Cryptanalyst,Bombe inventor"

	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	c := rows[0]
	if c.DisplayName != "Alan Turing" {
		t.Errorf("DisplayName = %q", c.DisplayName)
	}
	if c.Company != "GCHQ" {
		t.Errorf("Company = %q", c.Company)
	}
}

func TestParseGoogleCSV_MultipleRows(t *testing.T) {
	csv := "Name,Given Name,Family Name,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value\n" +
		"Ada Lovelace,Ada,Lovelace,ada@x.com,ada2@x.com,111\n" +
		"Alan Turing,Alan,Turing,alan@x.com,,222\n" +
		"Grace Hopper,Grace,Hopper,grace@x.com,,333"

	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}
	if rows[0].DisplayName != "Ada Lovelace" {
		t.Errorf("row 0 DisplayName = %q", rows[0].DisplayName)
	}
	if len(rows[0].Emails) != 2 {
		t.Errorf("row 0 Emails = %v, want 2", rows[0].Emails)
	}
	if rows[1].DisplayName != "Alan Turing" {
		t.Errorf("row 1 DisplayName = %q", rows[1].DisplayName)
	}
}

func TestParseGoogleCSV_EmptyFields(t *testing.T) {
	csv := "Name,Given Name,Family Name,E-mail 1 - Value,Phone 1 - Value\n" +
		",,,, \n" + // entirely blank row — should be skipped
		"Bob,,Builder,bob@x.com,"

	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row (blank skipped), got %d", len(rows))
	}
	if rows[0].DisplayName != "Bob" {
		t.Errorf("DisplayName = %q", rows[0].DisplayName)
	}
}

func TestParseGoogleCSV_QuotedFieldsWithCommas(t *testing.T) {
	csv := `Name,Given Name,Family Name,E-mail 1 - Value,Notes
"Smith, John",John,Smith,john@x.com,"Works at Smith, Inc."
`
	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].DisplayName != "Smith, John" {
		t.Errorf("DisplayName = %q, want %q", rows[0].DisplayName, "Smith, John")
	}
	if rows[0].Notes != "Works at Smith, Inc." {
		t.Errorf("Notes = %q", rows[0].Notes)
	}
}

func TestParseGoogleCSV_DeriveDisplayName(t *testing.T) {
	// No Name column value — should derive from Given+Family, fallback to email.
	csv := "Name,Given Name,Family Name,E-mail 1 - Value\n" +
		",Charles,Babbage,charles@x.com\n" +
		",,,noname@x.com"

	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[0].DisplayName != "Charles Babbage" {
		t.Errorf("row 0 DisplayName = %q", rows[0].DisplayName)
	}
	if rows[1].DisplayName != "noname@x.com" {
		t.Errorf("row 1 DisplayName = %q", rows[1].DisplayName)
	}
}

func TestParseGoogleCSV_EmailDeduplication(t *testing.T) {
	csv := "Name,E-mail 1 - Value,E-mail 2 - Value,E-mail 3 - Value\n" +
		"Ada,dup@x.com,DUP@X.COM,other@x.com"

	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows[0].Emails) != 2 {
		t.Errorf("expected 2 unique emails after dedup, got %v", rows[0].Emails)
	}
}

func TestParseGoogleCSV_EmptyFile(t *testing.T) {
	rows, err := ParseGoogleCSV("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rows != nil && len(rows) != 0 {
		t.Errorf("expected nil/empty slice for empty input, got %v", rows)
	}
}

func TestParseGoogleCSV_HeaderOnly(t *testing.T) {
	rows, err := ParseGoogleCSV("Name,Given Name,Family Name,E-mail 1 - Value\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected 0 rows for header-only CSV, got %d", len(rows))
	}
}

func TestParseGoogleCSV_GroupMembership(t *testing.T) {
	csv := "Name,E-mail 1 - Value,Group Membership\n" +
		"Jane,jane@x.com,* myContacts ::: Work ::: VIP"

	rows, err := ParseGoogleCSV(csv)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	labels := rows[0].Labels
	for _, l := range labels {
		if strings.EqualFold(l, "myContacts") {
			t.Errorf("myContacts should be filtered out, got %v", labels)
		}
	}
	hasWork, hasVIP := false, false
	for _, l := range labels {
		if l == "Work" {
			hasWork = true
		}
		if l == "VIP" {
			hasVIP = true
		}
	}
	if !hasWork || !hasVIP {
		t.Errorf("expected Work and VIP in labels, got %v", labels)
	}
}

func TestAppendUniq(t *testing.T) {
	s := appendUniq(nil, "Ada")
	s = appendUniq(s, "ada") // duplicate, case-insensitive
	s = appendUniq(s, "Bob")
	s = appendUniq(s, "") // empty — ignored
	if len(s) != 2 {
		t.Errorf("expected 2 unique items, got %v", s)
	}
}

func TestIsMeaningfulFields(t *testing.T) {
	if isMeaningfulFields(Fields{}) {
		t.Error("empty Fields should not be meaningful")
	}
	if isMeaningfulFields(Fields{Company: "Acme", Notes: "blah"}) {
		t.Error("company+notes only should not be meaningful")
	}
	if !isMeaningfulFields(Fields{FirstName: "Ada"}) {
		t.Error("first name alone should be meaningful")
	}
	if !isMeaningfulFields(Fields{Emails: []string{"x@x.com"}}) {
		t.Error("email alone should be meaningful")
	}
}
