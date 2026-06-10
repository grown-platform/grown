package contacts

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// ParseVCards
// ---------------------------------------------------------------------------

func TestParseVCards_Single(t *testing.T) {
	vcf := "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada Lovelace\r\nN:Lovelace;Ada;;;\r\nEMAIL;TYPE=INTERNET:ada@example.com\r\nTEL:+1 555 0100\r\nEND:VCARD\r\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	c := cards[0]
	if c.DisplayName != "Ada Lovelace" {
		t.Errorf("DisplayName=%q", c.DisplayName)
	}
	if c.FirstName != "Ada" {
		t.Errorf("FirstName=%q", c.FirstName)
	}
	if c.LastName != "Lovelace" {
		t.Errorf("LastName=%q", c.LastName)
	}
	if len(c.Emails) != 1 || c.Emails[0] != "ada@example.com" {
		t.Errorf("Emails=%v", c.Emails)
	}
	if len(c.Phones) != 1 || c.Phones[0] != "+1 555 0100" {
		t.Errorf("Phones=%v", c.Phones)
	}
}

func TestParseVCards_Multi(t *testing.T) {
	vcf := strings.Join([]string{
		"BEGIN:VCARD", "VERSION:3.0", "FN:Alice", "EMAIL:alice@x.io", "END:VCARD",
		"BEGIN:VCARD", "VERSION:3.0", "FN:Bob", "EMAIL:bob@x.io", "END:VCARD",
	}, "\n")
	cards := ParseVCards(vcf)
	if len(cards) != 2 {
		t.Fatalf("expected 2 cards, got %d", len(cards))
	}
	if cards[0].DisplayName != "Alice" {
		t.Errorf("card[0].DisplayName=%q", cards[0].DisplayName)
	}
	if cards[1].DisplayName != "Bob" {
		t.Errorf("card[1].DisplayName=%q", cards[1].DisplayName)
	}
}

func TestParseVCards_MissingFN_FallsBackToN(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nN:Turing;Alan;;;\nEMAIL:alan@x.io\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if cards[0].DisplayName != "Alan Turing" {
		t.Errorf("DisplayName=%q (want 'Alan Turing')", cards[0].DisplayName)
	}
}

func TestParseVCards_MissingName_FallsBackToEmail(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nEMAIL:nobody@x.io\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if cards[0].DisplayName != "nobody@x.io" {
		t.Errorf("DisplayName=%q", cards[0].DisplayName)
	}
}

func TestParseVCards_OrgAndTitle(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nFN:Jane\nORG:ACME;Engineering\nTITLE:Staff Engineer\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	// ORG should take only the first component.
	if cards[0].Company != "ACME" {
		t.Errorf("Company=%q (want 'ACME')", cards[0].Company)
	}
	if cards[0].JobTitle != "Staff Engineer" {
		t.Errorf("JobTitle=%q", cards[0].JobTitle)
	}
}

func TestParseVCards_Categories(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nFN:Test\nCATEGORIES:friends,work\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	labels := cards[0].Labels
	if len(labels) != 2 || labels[0] != "friends" || labels[1] != "work" {
		t.Errorf("Labels=%v", labels)
	}
}

func TestParseVCards_NoteEscape(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nFN:Test\nNOTE:line1\\nline2\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if cards[0].Notes != "line1\nline2" {
		t.Errorf("Notes=%q", cards[0].Notes)
	}
}

func TestParseVCards_LineFolding(t *testing.T) {
	// The email value is folded across two lines.
	vcf := "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test\r\nEMAIL:long\r\n email@example.com\r\nEND:VCARD\r\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if len(cards[0].Emails) != 1 || cards[0].Emails[0] != "longemail@example.com" {
		t.Errorf("Emails=%v", cards[0].Emails)
	}
}

func TestParseVCards_GroupingPrefix(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nFN:Test\nitem1.EMAIL:me@x.io\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if len(cards[0].Emails) != 1 || cards[0].Emails[0] != "me@x.io" {
		t.Errorf("Emails=%v", cards[0].Emails)
	}
}

func TestParseVCards_DuplicateEmailsDeduped(t *testing.T) {
	vcf := "BEGIN:VCARD\nVERSION:3.0\nFN:Test\nEMAIL:me@x.io\nEMAIL:ME@X.IO\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if len(cards[0].Emails) != 1 {
		t.Errorf("expected 1 email after dedup, got %v", cards[0].Emails)
	}
}

func TestParseVCards_Empty(t *testing.T) {
	if cards := ParseVCards(""); len(cards) != 0 {
		t.Errorf("expected 0 cards from empty input, got %d", len(cards))
	}
}

func TestParseVCards_NoBeginEnd(t *testing.T) {
	if cards := ParseVCards("FN:Ada\nEMAIL:ada@x.io\n"); len(cards) != 0 {
		t.Errorf("expected 0 cards (no BEGIN/END), got %d", len(cards))
	}
}

// ---------------------------------------------------------------------------
// SerializeVCards
// ---------------------------------------------------------------------------

func TestSerializeVCards_Basic(t *testing.T) {
	fields := []Fields{{
		DisplayName: "Ada Lovelace",
		FirstName:   "Ada",
		LastName:    "Lovelace",
		Emails:      []string{"ada@example.com"},
		Phones:      []string{"+1 555 0100"},
		Company:     "Babbage & Co",
		JobTitle:    "Analyst",
		Labels:      []string{"friends"},
		Notes:       "line1\nline2",
	}}
	out := SerializeVCards(fields, nil)

	for _, want := range []string{
		"BEGIN:VCARD\r\n",
		"VERSION:3.0\r\n",
		"FN:Ada Lovelace\r\n",
		"N:Lovelace;Ada;;;\r\n",
		"EMAIL;TYPE=INTERNET:ada@example.com\r\n",
		"TEL:+1 555 0100\r\n",
		"ORG:Babbage & Co\r\n",
		"CATEGORIES:friends\r\n",
		"NOTE:line1\\nline2\r\n",
		"END:VCARD\r\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in output:\n%s", want, out)
		}
	}
}

func TestSerializeVCards_EmptyFields(t *testing.T) {
	out := SerializeVCards([]Fields{{DisplayName: "NoEmail"}}, nil)
	if !strings.Contains(out, "FN:NoEmail") {
		t.Errorf("missing FN:NoEmail in output:\n%s", out)
	}
	// Should not include ORG/TITLE lines when company and job title are blank.
	if strings.Contains(out, "ORG:") {
		t.Errorf("unexpected ORG: in output:\n%s", out)
	}
}

// ---------------------------------------------------------------------------
// Round-trip: serialize → parse → compare
// ---------------------------------------------------------------------------

func TestRoundTrip(t *testing.T) {
	original := Fields{
		DisplayName: "Grace Hopper",
		FirstName:   "Grace",
		LastName:    "Hopper",
		Company:     "USN",
		JobTitle:    "Rear Admiral",
		Emails:      []string{"grace@navy.mil", "grace@home.example"},
		Phones:      []string{"+1 555 0200"},
		Labels:      []string{"vip", "navy"},
		Notes:       "Invented COBOL\nAlso coined 'bug'",
	}

	vcf := SerializeVCards([]Fields{original}, nil)
	parsed := ParseVCards(vcf)
	if len(parsed) != 1 {
		t.Fatalf("round-trip: expected 1 card, got %d", len(parsed))
	}
	c := parsed[0]

	checks := []struct {
		label string
		got   string
		want  string
	}{
		{"DisplayName", c.DisplayName, original.DisplayName},
		{"FirstName", c.FirstName, original.FirstName},
		{"LastName", c.LastName, original.LastName},
		{"Company", c.Company, original.Company},
		{"JobTitle", c.JobTitle, original.JobTitle},
		{"Notes", c.Notes, original.Notes},
	}
	for _, tc := range checks {
		if tc.got != tc.want {
			t.Errorf("round-trip %s: got %q, want %q", tc.label, tc.got, tc.want)
		}
	}
	if len(c.Emails) != len(original.Emails) {
		t.Errorf("round-trip Emails: got %v, want %v", c.Emails, original.Emails)
	}
	if len(c.Labels) != len(original.Labels) {
		t.Errorf("round-trip Labels: got %v, want %v", c.Labels, original.Labels)
	}
}

// ---------------------------------------------------------------------------
// IsMeaningful
// ---------------------------------------------------------------------------

func TestIsMeaningful(t *testing.T) {
	yes := []ParsedCard{
		{DisplayName: "X"},
		{FirstName: "X"},
		{LastName: "X"},
		{Emails: []string{"a@b"}},
		{Phones: []string{"123"}},
	}
	for _, c := range yes {
		if !IsMeaningful(c) {
			t.Errorf("IsMeaningful(%+v) = false, want true", c)
		}
	}
	if IsMeaningful(ParsedCard{}) {
		t.Errorf("IsMeaningful(empty) = true, want false")
	}
}
