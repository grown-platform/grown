package contacts

import (
	"strings"
	"unicode"
)

// ParsedCard holds the fields extracted from a single vCard block.
type ParsedCard struct {
	DisplayName string
	FirstName   string
	LastName    string
	Company     string
	JobTitle    string
	Emails      []string
	Phones      []string
	Labels      []string
	Notes       string
}

// ParseVCards parses one or more vCard 3.0/4.0 records from raw .vcf text.
// It handles RFC 6350 line-folding (CRLF+SPACE continuation), multiple
// BEGIN:VCARD/END:VCARD blocks, FN, N, EMAIL, TEL, ORG, TITLE, NOTE, and
// CATEGORIES properties. Unknown properties are silently ignored.
func ParseVCards(text string) []ParsedCard {
	// Normalise CRLF → LF, then unfold continuation lines (a LF followed by
	// whitespace means the next line is a continuation of the previous one).
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = strings.ReplaceAll(text, "\n ", "")
	text = strings.ReplaceAll(text, "\n\t", "")

	lines := strings.Split(text, "\n")
	var out []ParsedCard
	var cur *ParsedCard

	for _, raw := range lines {
		line := strings.TrimRightFunc(raw, unicode.IsSpace)
		if line == "" {
			continue
		}
		upper := strings.ToUpper(line)
		if upper == "BEGIN:VCARD" {
			cur = &ParsedCard{}
			continue
		}
		if upper == "END:VCARD" {
			if cur != nil {
				if cur.DisplayName == "" {
					cur.DisplayName = strings.TrimSpace(cur.FirstName + " " + cur.LastName)
					if cur.DisplayName == "" && len(cur.Emails) > 0 {
						cur.DisplayName = cur.Emails[0]
					}
				}
				out = append(out, *cur)
			}
			cur = nil
			continue
		}
		if cur == nil {
			continue
		}

		name, value := splitContentLine(line)
		if name == "" {
			continue
		}
		value = unescapeVCard(value)

		switch name {
		case "FN":
			cur.DisplayName = strings.TrimSpace(value)
		case "N":
			// N: Family;Given;Additional;Prefix;Suffix
			parts := strings.SplitN(value, ";", 5)
			if len(parts) >= 1 {
				cur.LastName = strings.TrimSpace(parts[0])
			}
			if len(parts) >= 2 {
				cur.FirstName = strings.TrimSpace(parts[1])
			}
		case "EMAIL":
			if v := strings.TrimSpace(value); v != "" {
				uniqAppend(&cur.Emails, v)
			}
		case "TEL":
			if v := strings.TrimSpace(value); v != "" {
				uniqAppend(&cur.Phones, v)
			}
		case "ORG":
			// ORG: Company;Department — take the first component.
			cur.Company = strings.TrimSpace(strings.SplitN(value, ";", 2)[0])
		case "TITLE":
			cur.JobTitle = strings.TrimSpace(value)
		case "NOTE":
			if cur.Notes != "" {
				cur.Notes += "\n" + value
			} else {
				cur.Notes = value
			}
		case "CATEGORIES":
			for _, cat := range strings.Split(value, ",") {
				if v := strings.TrimSpace(cat); v != "" {
					uniqAppend(&cur.Labels, v)
				}
			}
		}
	}
	return out
}

// SerializeVCards serialises a slice of Fields into vCard 3.0 text (CRLF
// line endings, one BEGIN:VCARD…END:VCARD block per contact).
func SerializeVCards(contacts []Fields, displayNames []string) string {
	var sb strings.Builder
	for i, f := range contacts {
		dn := f.DisplayName
		if dn == "" && i < len(displayNames) {
			dn = displayNames[i]
		}
		if dn == "" {
			dn = strings.TrimSpace(f.FirstName + " " + f.LastName)
		}
		if dn == "" && len(f.Emails) > 0 {
			dn = f.Emails[0]
		}
		sb.WriteString("BEGIN:VCARD\r\n")
		sb.WriteString("VERSION:3.0\r\n")
		sb.WriteString("FN:")
		sb.WriteString(escapeVCard(dn))
		sb.WriteString("\r\n")
		sb.WriteString("N:")
		sb.WriteString(escapeVCard(f.LastName))
		sb.WriteString(";")
		sb.WriteString(escapeVCard(f.FirstName))
		sb.WriteString(";;;\r\n")
		if f.Company != "" || f.JobTitle != "" {
			sb.WriteString("ORG:")
			sb.WriteString(escapeVCard(f.Company))
			sb.WriteString("\r\n")
			sb.WriteString("TITLE:")
			sb.WriteString(escapeVCard(f.JobTitle))
			sb.WriteString("\r\n")
		}
		for _, e := range f.Emails {
			sb.WriteString("EMAIL;TYPE=INTERNET:")
			sb.WriteString(escapeVCard(e))
			sb.WriteString("\r\n")
		}
		for _, p := range f.Phones {
			sb.WriteString("TEL:")
			sb.WriteString(escapeVCard(p))
			sb.WriteString("\r\n")
		}
		if len(f.Labels) > 0 {
			sb.WriteString("CATEGORIES:")
			for j, l := range f.Labels {
				if j > 0 {
					sb.WriteString(",")
				}
				sb.WriteString(escapeVCard(l))
			}
			sb.WriteString("\r\n")
		}
		if f.Notes != "" {
			sb.WriteString("NOTE:")
			sb.WriteString(escapeVCardNote(f.Notes))
			sb.WriteString("\r\n")
		}
		sb.WriteString("END:VCARD\r\n")
	}
	return sb.String()
}

// splitContentLine splits a vCard content line (possibly with property
// parameters) into a canonical property name and its value. The name is
// upper-cased and any grouping prefix (e.g. "item1.EMAIL") is stripped.
// Returns ("", "") if the line contains no colon.
func splitContentLine(line string) (name, value string) {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return "", ""
	}
	head := line[:colon]
	value = line[colon+1:]

	// Strip parameters: split on ';', the first part is the property name.
	parts := strings.SplitN(head, ";", 2)
	name = strings.ToUpper(strings.TrimSpace(parts[0]))

	// Strip a grouping prefix like "item1.EMAIL".
	if dot := strings.LastIndexByte(name, '.'); dot >= 0 {
		name = name[dot+1:]
	}
	return name, value
}

// unescapeVCard reverses vCard text escaping per RFC 6350 §3.4:
//
//	\n or \N → newline
//	\\ → backslash
//	\, → comma
//	\; → semicolon
func unescapeVCard(s string) string {
	if !strings.ContainsRune(s, '\\') {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	i := 0
	for i < len(s) {
		if s[i] == '\\' && i+1 < len(s) {
			switch s[i+1] {
			case 'n', 'N':
				b.WriteByte('\n')
			case '\\':
				b.WriteByte('\\')
			case ',':
				b.WriteByte(',')
			case ';':
				b.WriteByte(';')
			default:
				b.WriteByte(s[i+1])
			}
			i += 2
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// escapeVCard escapes special characters in a vCard property value (general
// text fields: FN, ORG, TITLE, EMAIL, TEL, CATEGORIES items).
func escapeVCard(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, ";", "\\;")
	return s
}

// escapeVCardNote escapes a NOTE value, additionally converting literal
// newlines to the vCard \n escape.
func escapeVCardNote(s string) string {
	s = escapeVCard(s)
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}

// uniqAppend appends v to *slice only when it is not already present
// (case-insensitive comparison).
func uniqAppend(slice *[]string, v string) {
	lower := strings.ToLower(v)
	for _, existing := range *slice {
		if strings.ToLower(existing) == lower {
			return
		}
	}
	*slice = append(*slice, v)
}

// IsMeaningful returns true when a ParsedCard has enough data to be worth
// creating (has a name, email, or phone number).
func IsMeaningful(c ParsedCard) bool {
	return c.DisplayName != "" || c.FirstName != "" || c.LastName != "" ||
		len(c.Emails) > 0 || len(c.Phones) > 0
}
