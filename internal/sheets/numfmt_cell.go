package sheets

// Glue between the number-format port (numfmt.go) and the formula engine:
// TEXT(), VALUE() fallbacks and the display text `m` of computed cells.

import "strings"

// cellDisplayText is the display text `m` of a computed value in a cell with
// content type ct: numbers go through the cell's number format (General when
// it has none), like the grid renders typed-in numbers.
func cellDisplayText(v value, ct *FsCellType) string {
	if v.kind == kindArray {
		v = v.topLeft()
	}
	fa := ""
	if ct != nil {
		fa = strings.TrimSpace(ct.FA)
	}
	switch v.kind {
	case kindNum:
		if v.str == omittedTag || v.blank {
			return v.toStr()
		}
		if fa == "" || fa == "@" {
			fa = "General"
		}
		return FormatNumberText(v.num, fa, false)
	case kindStr:
		if fa != "" && fa != "@" && !strings.EqualFold(fa, "general") {
			return FormatNumberText(v.str, fa, false)
		}
	}
	return v.toStr()
}

// textFormat implements TEXT(value, format_text). Numbers, numeric text and
// date/time text are formatted as numbers; other text goes through the
// format's text section. Booleans pass through unchanged.
func textFormat(v value, format string) value {
	if v.kind == kindArray {
		v = v.topLeft()
	}
	switch v.kind {
	case kindErr, kindBool:
		return v
	case kindNum:
		return strVal(FormatNumberText(v.num, format, false))
	}
	s := v.toStr()
	if f, ok := v.toNum(); ok && strings.TrimSpace(s) != "" {
		return strVal(FormatNumberText(f, format, false))
	}
	if n, ok := dtTextSerial(strings.TrimSpace(s)); ok {
		return strVal(FormatNumberText(n, format, false))
	}
	return strVal(FormatNumberText(s, format, false))
}

// parseTypedNumber reads text the way typed input is read (grouped numbers,
// currency, percent, fractions, dates, times). VALUE() falls back to it.
func parseTypedNumber(s string) (float64, bool) {
	p, ok := nfParseInput(s, nfParseOpts{})
	if !ok {
		return 0, false
	}
	return p.value, true
}
