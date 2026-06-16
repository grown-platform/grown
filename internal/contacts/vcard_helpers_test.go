package contacts

import (
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// splitContentLine
// ---------------------------------------------------------------------------

func TestSplitContentLine(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantName  string
		wantValue string
	}{
		{"simple", "FN:Ada", "FN", "Ada"},
		{"lowercased property upper-cased", "email:a@x.io", "EMAIL", "a@x.io"},
		{"with single param", "EMAIL;TYPE=INTERNET:a@x.io", "EMAIL", "a@x.io"},
		{"with multiple params", "TEL;TYPE=CELL;PREF=1:+1 555", "TEL", "+1 555"},
		{"grouping prefix stripped", "item1.EMAIL:me@x.io", "EMAIL", "me@x.io"},
		{"grouping prefix with param", "item2.TEL;TYPE=HOME:123", "TEL", "123"},
		{"value contains colon", "URL:https://x.io", "URL", "https://x.io"},
		{"empty value", "NOTE:", "NOTE", ""},
		{"no colon returns empty", "JUST A LINE", "", ""},
		{"surrounding whitespace in head trimmed", "  FN  :Ada", "FN", "Ada"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotName, gotValue := splitContentLine(tt.line)
			if gotName != tt.wantName {
				t.Errorf("name = %q, want %q", gotName, tt.wantName)
			}
			if gotValue != tt.wantValue {
				t.Errorf("value = %q, want %q", gotValue, tt.wantValue)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// unescapeVCard
// ---------------------------------------------------------------------------

func TestUnescapeVCard(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"no escapes returns input", "plain text", "plain text"},
		{"escaped newline lower", `a\nb`, "a\nb"},
		{"escaped newline upper", `a\Nb`, "a\nb"},
		{"escaped comma", `a\,b`, "a,b"},
		{"escaped semicolon", `a\;b`, "a;b"},
		{"escaped backslash", `a\\b`, `a\b`},
		{"unknown escape keeps following char", `a\tb`, "atb"},
		{"trailing lone backslash kept", `abc\`, `abc\`},
		{"multiple escapes", `x\,y\;z\nw`, "x,y;z\nw"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unescapeVCard(tt.in); got != tt.want {
				t.Errorf("unescapeVCard(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// escapeVCard / escapeVCardNote
// ---------------------------------------------------------------------------

func TestEscapeVCard(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "hello", "hello"},
		{"comma", "a,b", `a\,b`},
		{"semicolon", "a;b", `a\;b`},
		{"backslash", `a\b`, `a\\b`},
		{"backslash escaped before others", `a\,b`, `a\\\,b`},
		{"newline not touched by escapeVCard", "a\nb", "a\nb"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := escapeVCard(tt.in); got != tt.want {
				t.Errorf("escapeVCard(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestEscapeVCardNote(t *testing.T) {
	// Note escaping also converts literal newlines to the \n escape.
	if got := escapeVCardNote("line1\nline2"); got != `line1\nline2` {
		t.Errorf("escapeVCardNote newline = %q", got)
	}
	if got := escapeVCardNote("a,b\nc;d"); got != `a\,b\nc\;d` {
		t.Errorf("escapeVCardNote combined = %q", got)
	}
}

func TestEscapeUnescapeRoundTrip(t *testing.T) {
	for _, s := range []string{"plain", "a,b", "a;b", `a\b`, "comma, and; semi"} {
		if got := unescapeVCard(escapeVCard(s)); got != s {
			t.Errorf("round-trip %q -> %q", s, got)
		}
	}
}

// ---------------------------------------------------------------------------
// uniqAppend
// ---------------------------------------------------------------------------

func TestUniqAppend(t *testing.T) {
	var s []string
	uniqAppend(&s, "Ada")
	uniqAppend(&s, "ada") // duplicate, case-insensitive
	uniqAppend(&s, "ADA") // duplicate
	uniqAppend(&s, "Bob")
	if len(s) != 2 {
		t.Fatalf("expected 2 unique items, got %v", s)
	}
	if s[0] != "Ada" || s[1] != "Bob" {
		t.Errorf("unexpected contents (first occurrence kept): %v", s)
	}
}

// ---------------------------------------------------------------------------
// ParseVCards — additional edge cases not covered elsewhere
// ---------------------------------------------------------------------------

func TestParseVCards_NoteMultiLineJoined(t *testing.T) {
	// Two NOTE properties in one card are joined with a newline.
	vcf := "BEGIN:VCARD\nFN:T\nNOTE:first\nNOTE:second\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if cards[0].Notes != "first\nsecond" {
		t.Errorf("Notes = %q, want %q", cards[0].Notes, "first\nsecond")
	}
}

func TestParseVCards_PhonesDeduped(t *testing.T) {
	vcf := "BEGIN:VCARD\nFN:T\nTEL:+1 555\nTEL:+1 555\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 || len(cards[0].Phones) != 1 {
		t.Errorf("expected 1 deduped phone, got %v", cards)
	}
}

func TestParseVCards_TabFolding(t *testing.T) {
	// RFC 6350 also allows a TAB continuation marker.
	vcf := "BEGIN:VCARD\nFN:T\nEMAIL:long\n\temail@x.io\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 || len(cards[0].Emails) != 1 || cards[0].Emails[0] != "longemail@x.io" {
		t.Errorf("tab folding failed: %v", cards)
	}
}

func TestParseVCards_CategoriesTrimAndSkipBlank(t *testing.T) {
	vcf := "BEGIN:VCARD\nFN:T\nCATEGORIES: a , , b ,\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 {
		t.Fatalf("expected 1 card, got %d", len(cards))
	}
	if len(cards[0].Labels) != 2 || cards[0].Labels[0] != "a" || cards[0].Labels[1] != "b" {
		t.Errorf("Labels = %v, want [a b]", cards[0].Labels)
	}
}

func TestParseVCards_LinesBeforeBeginIgnored(t *testing.T) {
	// Content lines outside a BEGIN/END block are ignored (cur == nil).
	vcf := "FN:Ghost\nEMAIL:ghost@x.io\nBEGIN:VCARD\nFN:Real\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 || cards[0].DisplayName != "Real" {
		t.Errorf("expected only 'Real', got %v", cards)
	}
}

func TestParseVCards_BlankAndUnknownLines(t *testing.T) {
	// Blank lines, unknown props, and a line without a colon are all skipped.
	vcf := "BEGIN:VCARD\n\nVERSION:3.0\nX-CUSTOM:ignored\nGARBAGELINE\nFN:OK\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 || cards[0].DisplayName != "OK" {
		t.Errorf("expected 'OK', got %v", cards)
	}
}

func TestParseVCards_EndWithoutBegin(t *testing.T) {
	if cards := ParseVCards("END:VCARD\n"); len(cards) != 0 {
		t.Errorf("expected 0 cards for stray END, got %d", len(cards))
	}
}

func TestParseVCards_OrgFirstComponentOnly(t *testing.T) {
	vcf := "BEGIN:VCARD\nFN:T\nORG:Globex;Sales;West\nEND:VCARD\n"
	cards := ParseVCards(vcf)
	if len(cards) != 1 || cards[0].Company != "Globex" {
		t.Errorf("Company = %q, want Globex", cards[0].Company)
	}
}

// ---------------------------------------------------------------------------
// SerializeVCards — fallback chains and multi-value output
// ---------------------------------------------------------------------------

func TestSerializeVCards_DisplayNameFallbackToParam(t *testing.T) {
	// Empty DisplayName on Fields falls back to the parallel displayNames slice.
	out := SerializeVCards([]Fields{{Emails: []string{"x@y.io"}}}, []string{"Param Name"})
	if !strings.Contains(out, "FN:Param Name\r\n") {
		t.Errorf("expected FN from displayNames param, got:\n%s", out)
	}
}

func TestSerializeVCards_DisplayNameFallbackToFirstLast(t *testing.T) {
	out := SerializeVCards([]Fields{{FirstName: "Jane", LastName: "Doe"}}, nil)
	if !strings.Contains(out, "FN:Jane Doe\r\n") {
		t.Errorf("expected FN from first+last, got:\n%s", out)
	}
}

func TestSerializeVCards_DisplayNameFallbackToEmail(t *testing.T) {
	out := SerializeVCards([]Fields{{Emails: []string{"only@x.io"}}}, nil)
	if !strings.Contains(out, "FN:only@x.io\r\n") {
		t.Errorf("expected FN from email, got:\n%s", out)
	}
}

func TestSerializeVCards_TitleOnlyEmitsOrgBlock(t *testing.T) {
	// JobTitle alone (no Company) still triggers the ORG/TITLE block.
	out := SerializeVCards([]Fields{{DisplayName: "T", JobTitle: "CEO"}}, nil)
	if !strings.Contains(out, "ORG:\r\n") {
		t.Errorf("expected empty ORG line when only JobTitle set, got:\n%s", out)
	}
	if !strings.Contains(out, "TITLE:CEO\r\n") {
		t.Errorf("expected TITLE:CEO, got:\n%s", out)
	}
}

func TestSerializeVCards_MultiEmailMultiPhone(t *testing.T) {
	out := SerializeVCards([]Fields{{
		DisplayName: "Multi",
		Emails:      []string{"a@x.io", "b@x.io"},
		Phones:      []string{"111", "222"},
	}}, nil)
	if strings.Count(out, "EMAIL;TYPE=INTERNET:") != 2 {
		t.Errorf("expected 2 EMAIL lines, got:\n%s", out)
	}
	if strings.Count(out, "TEL:") != 2 {
		t.Errorf("expected 2 TEL lines, got:\n%s", out)
	}
}

func TestSerializeVCards_MultipleLabelsCommaJoined(t *testing.T) {
	out := SerializeVCards([]Fields{{DisplayName: "T", Labels: []string{"a", "b", "c"}}}, nil)
	if !strings.Contains(out, "CATEGORIES:a,b,c\r\n") {
		t.Errorf("expected comma-joined CATEGORIES, got:\n%s", out)
	}
}

func TestSerializeVCards_EscapesSpecialChars(t *testing.T) {
	out := SerializeVCards([]Fields{{DisplayName: "A, B; C", Company: "x;y"}}, nil)
	if !strings.Contains(out, `FN:A\, B\; C`) {
		t.Errorf("expected escaped FN, got:\n%s", out)
	}
}

func TestSerializeVCards_Empty(t *testing.T) {
	if out := SerializeVCards(nil, nil); out != "" {
		t.Errorf("expected empty output for no contacts, got %q", out)
	}
}

func TestSerializeVCards_DisplayNamesParamShorterThanContacts(t *testing.T) {
	// More contacts than displayNames entries: second falls through to other rules.
	out := SerializeVCards(
		[]Fields{{Emails: []string{"a@x.io"}}, {FirstName: "Bo"}},
		[]string{"First Only"},
	)
	if !strings.Contains(out, "FN:First Only\r\n") {
		t.Errorf("expected first FN from param, got:\n%s", out)
	}
	if !strings.Contains(out, "FN:Bo\r\n") {
		t.Errorf("expected second FN derived from FirstName, got:\n%s", out)
	}
}
