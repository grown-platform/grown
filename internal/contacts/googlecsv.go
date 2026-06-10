package contacts

import (
	"encoding/csv"
	"fmt"
	"strings"
)

// ParseGoogleCSV parses a Google Contacts CSV export into Fields records.
//
// Google Contacts exports a file whose first row is a header with columns like:
//
//	Name, Given Name, Family Name, E-mail 1 - Value, Phone 1 - Value,
//	Organization 1 - Name, Organization 1 - Title, Notes, Labels
//
// Multi-value columns follow the pattern "E-mail N - Value" and
// "Phone N - Value" for N = 1, 2, 3 … Google includes up to 3 by default
// but may include more.  Any column that is absent is silently ignored.
//
// The returned slice contains one Fields per data row that carries at least
// one meaningful value; entirely blank rows are skipped.
func ParseGoogleCSV(data string) ([]Fields, error) {
	r := csv.NewReader(strings.NewReader(data))
	r.FieldsPerRecord = -1 // variable column count is OK
	r.LazyQuotes = true    // Google sometimes produces sloppy quoting
	r.TrimLeadingSpace = true

	records, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("googlecsv: CSV parse error: %w", err)
	}
	if len(records) < 2 {
		// No header or no data rows.
		return nil, nil
	}

	header := records[0]
	colIndex := make(map[string]int, len(header))
	for i, h := range header {
		colIndex[strings.TrimSpace(h)] = i
	}

	// Helper: safely get a cell by column name (empty string if absent/out-of-range).
	get := func(row []string, col string) string {
		idx, ok := colIndex[col]
		if !ok || idx >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[idx])
	}

	var out []Fields
	for _, row := range records[1:] {
		f := Fields{}

		f.DisplayName = get(row, "Name")
		f.FirstName = get(row, "Given Name")
		f.LastName = get(row, "Family Name")
		f.Notes = get(row, "Notes")

		// Some Google exports use "Labels" (single column), others use "Group Membership".
		if lv := get(row, "Labels"); lv != "" {
			for _, l := range splitLabels(lv) {
				f.Labels = appendUniq(f.Labels, l)
			}
		}
		if gm := get(row, "Group Membership"); gm != "" {
			for _, l := range splitGoogleGroups(gm) {
				f.Labels = appendUniq(f.Labels, l)
			}
		}

		// Company / job title from the first organization block.
		f.Company = get(row, "Organization 1 - Name")
		f.JobTitle = get(row, "Organization 1 - Title")

		// Multi-value emails: "E-mail 1 - Value", "E-mail 2 - Value", …
		for n := 1; n <= 10; n++ {
			v := get(row, fmt.Sprintf("E-mail %d - Value", n))
			if v == "" {
				break
			}
			f.Emails = appendUniq(f.Emails, v)
		}

		// Multi-value phones: "Phone 1 - Value", …
		for n := 1; n <= 10; n++ {
			v := get(row, fmt.Sprintf("Phone %d - Value", n))
			if v == "" {
				break
			}
			f.Phones = appendUniq(f.Phones, v)
		}

		// Derive display name if absent.
		if f.DisplayName == "" {
			full := strings.TrimSpace(f.FirstName + " " + f.LastName)
			if full != "" {
				f.DisplayName = full
			} else if len(f.Emails) > 0 {
				f.DisplayName = f.Emails[0]
			}
		}

		if isMeaningfulFields(f) {
			out = append(out, f)
		}
	}
	return out, nil
}

// isMeaningfulFields returns true when the record carries enough information
// to be worth creating as a contact.
func isMeaningfulFields(f Fields) bool {
	return f.DisplayName != "" || f.FirstName != "" || f.LastName != "" ||
		len(f.Emails) > 0 || len(f.Phones) > 0
}

// appendUniq appends v to s only when v is non-empty and not already present
// (case-insensitive comparison).
func appendUniq(s []string, v string) []string {
	v = strings.TrimSpace(v)
	if v == "" {
		return s
	}
	vl := strings.ToLower(v)
	for _, x := range s {
		if strings.ToLower(x) == vl {
			return s
		}
	}
	return append(s, v)
}

// splitLabels handles a Google "Labels" cell which uses " ::: " as a separator
// in some exports (e.g. "myContacts ::: Work") or simple commas in others.
func splitLabels(v string) []string {
	var parts []string
	// Try the triple-colon separator first (Google's Group Membership format).
	if strings.Contains(v, ":::") {
		for _, p := range strings.Split(v, ":::") {
			p = strings.TrimSpace(p)
			if p != "" {
				parts = append(parts, p)
			}
		}
		return parts
	}
	// Fall back to comma-separated.
	for _, p := range strings.Split(v, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			parts = append(parts, p)
		}
	}
	return parts
}

// splitGoogleGroups splits a "Group Membership" cell which Google separates
// with " ::: " and may include the built-in group "* myContacts" (prefixed
// with an asterisk).  We strip the asterisk prefix and skip the "myContacts"
// default group since it maps to no user-visible label.
func splitGoogleGroups(v string) []string {
	var parts []string
	for _, p := range strings.Split(v, ":::") {
		p = strings.TrimSpace(p)
		p = strings.TrimPrefix(p, "* ") // strip Google's asterisk marker
		if p == "" || strings.EqualFold(p, "myContacts") || strings.EqualFold(p, "my contacts") {
			continue
		}
		parts = append(parts, p)
	}
	return parts
}
