// Package sheets — Excel-compatible TEXT worksheet functions.
//
// This file registers the text/string function library for the formula engine.
// It builds on the shared API in formula.go (value, callCtx, rangeVal, etc.).
// LEN/LEFT/RIGHT/MID/CONCATENATE already live in formula.go and are NOT
// re-registered here.
//
// All length/substring arithmetic uses rune-based indexing so multi-byte UTF-8
// text is handled correctly. FIND/SEARCH/TEXTBEFORE/TEXTAFTER follow Excel's
// case sensitivity and wildcard rules (FIND: case-sensitive, no wildcards;
// SEARCH: case-insensitive, * and ? wildcards).
package sheets

import (
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

func init() {
	registerFunc("UPPER", txtUpper)
	registerFunc("LOWER", txtLower)
	registerFunc("PROPER", txtProper)
	registerFunc("TRIM", txtTrim)
	registerFunc("CLEAN", txtClean)
	registerFunc("SUBSTITUTE", txtSubstitute)
	registerFunc("REPLACE", txtReplace)
	registerFunc("FIND", txtFind)
	registerFunc("SEARCH", txtSearch)
	registerFunc("REPT", txtRept)
	registerFunc("TEXTJOIN", txtTextjoin)
	registerFunc("CONCAT", txtConcat)
	registerFunc("CHAR", txtChar)
	registerFunc("CODE", txtCode)
	registerFunc("UNICHAR", txtUnichar)
	registerFunc("UNICODE", txtUnicode)
	registerFunc("EXACT", txtExact)
	registerFunc("VALUE", txtValue)
	registerFunc("NUMBERVALUE", txtNumberValue)
	registerFunc("T", txtT)
	registerFunc("FIXED", txtFixed)
	registerFunc("DOLLAR", txtDollar)
	registerFunc("TEXTBEFORE", txtTextbefore)
	registerFunc("TEXTAFTER", txtTextafter)
	registerFunc("TEXT", txtText)
}

// txtFirstErr returns the first error among the scalar values of args[0..n-1],
// or a zero value with ok=false when none is an error.
func txtFirstErr(c *callCtx, n int) (value, bool) {
	if n > c.nargs() {
		n = c.nargs()
	}
	for i := 0; i < n; i++ {
		v := c.scalar(i)
		if v.isErr() {
			return v, true
		}
	}
	return value{}, false
}

// ---- Case / whitespace ------------------------------------------------------

func txtUpper(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	return strVal(strings.ToUpper(c.text(0)))
}

func txtLower(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	return strVal(strings.ToLower(c.text(0)))
}

// txtProper capitalises the first letter of each word and lower-cases the rest.
// Word boundaries are any non-letter rune (matching Excel's PROPER behaviour).
func txtProper(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	var b strings.Builder
	prevLetter := false
	for _, r := range c.text(0) {
		if unicode.IsLetter(r) {
			if prevLetter {
				b.WriteRune(unicode.ToLower(r))
			} else {
				b.WriteRune(unicode.ToUpper(r))
			}
			prevLetter = true
		} else {
			b.WriteRune(r)
			prevLetter = false
		}
	}
	return strVal(b.String())
}

// txtTrim strips leading/trailing spaces and collapses internal runs of spaces
// to a single space. Only the ASCII space (0x20) is treated as whitespace, per
// Excel's TRIM.
func txtTrim(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	var b strings.Builder
	started := false
	pendingSpace := false
	for _, r := range c.text(0) {
		if r == ' ' {
			if started {
				pendingSpace = true
			}
			continue
		}
		if pendingSpace {
			b.WriteByte(' ')
			pendingSpace = false
		}
		b.WriteRune(r)
		started = true
	}
	return strVal(b.String())
}

// txtClean removes all nonprintable control characters below code point 32.
func txtClean(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	var b strings.Builder
	for _, r := range c.text(0) {
		if r >= 32 {
			b.WriteRune(r)
		}
	}
	return strVal(b.String())
}

// ---- Substitution / replacement --------------------------------------------

// txtSubstitute replaces occurrences of old with new in text. With an optional
// 1-based instance number, only that occurrence is replaced; otherwise all are.
func txtSubstitute(c *callCtx) value {
	if e, ok := txtFirstErr(c, 4); ok {
		return e
	}
	if c.nargs() < 3 {
		return errValue
	}
	text := c.text(0)
	old := c.text(1)
	newStr := c.text(2)
	if old == "" {
		return strVal(text)
	}
	if c.nargs() >= 4 {
		inst, ok := c.num(3)
		if !ok {
			return errValue
		}
		n := int(math.Trunc(inst))
		if n < 1 {
			return errValue
		}
		return strVal(txtReplaceNth(text, old, newStr, n))
	}
	return strVal(strings.ReplaceAll(text, old, newStr))
}

// txtReplaceNth replaces only the nth (1-based) occurrence of old with newStr.
func txtReplaceNth(text, old, newStr string, n int) string {
	count := 0
	idx := 0
	for {
		pos := strings.Index(text[idx:], old)
		if pos < 0 {
			return text
		}
		pos += idx
		count++
		if count == n {
			return text[:pos] + newStr + text[pos+len(old):]
		}
		idx = pos + len(old)
	}
}

// txtReplace replaces len runes of text starting at the 1-based rune position
// start with the replacement string new.
func txtReplace(c *callCtx) value {
	if e, ok := txtFirstErr(c, 4); ok {
		return e
	}
	if c.nargs() < 4 {
		return errValue
	}
	runes := []rune(c.text(0))
	startF, ok1 := c.num(1)
	lenF, ok2 := c.num(2)
	if !ok1 || !ok2 {
		return errValue
	}
	start := int(math.Trunc(startF))
	length := int(math.Trunc(lenF))
	if start < 1 || length < 0 {
		return errValue
	}
	newStr := c.text(3)
	s0 := start - 1 // 0-based
	if s0 > len(runes) {
		s0 = len(runes)
	}
	end := s0 + length
	if end > len(runes) {
		end = len(runes)
	}
	return strVal(string(runes[:s0]) + newStr + string(runes[end:]))
}

// ---- Searching --------------------------------------------------------------

// txtStartIndex resolves an optional 1-based start argument at arg index i into
// a 0-based rune index. ok=false signals an invalid (#VALUE!) start position.
func txtStartIndex(c *callCtx, i int) (int, bool) {
	if c.nargs() <= i {
		return 0, true
	}
	sf, ok := c.num(i)
	if !ok {
		return 0, false
	}
	s := int(math.Trunc(sf))
	if s < 1 {
		return 0, false
	}
	return s - 1, true
}

// txtFind is case-sensitive substring search with no wildcards. Returns the
// 1-based rune position of find within within, or #VALUE! if not found.
func txtFind(c *callCtx) value {
	if e, ok := txtFirstErr(c, 3); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	find := c.text(0)
	within := c.text(1)
	withinRunes := []rune(within)
	start, ok := txtStartIndex(c, 2)
	if !ok {
		return errValue
	}
	if start > len(withinRunes) {
		return errValue
	}
	hay := string(withinRunes[start:])
	pos := strings.Index(hay, find)
	if pos < 0 {
		return errValue
	}
	// Convert byte offset within hay to a rune offset.
	runeOff := utf8.RuneCountInString(hay[:pos])
	return numVal(float64(start + runeOff + 1))
}

// txtSearch is case-insensitive substring search supporting * and ? wildcards.
// Returns the 1-based rune position of the first match, or #VALUE! if not found.
func txtSearch(c *callCtx) value {
	if e, ok := txtFirstErr(c, 3); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	find := c.text(0)
	within := c.text(1)
	withinRunes := []rune(within)
	start, ok := txtStartIndex(c, 2)
	if !ok {
		return errValue
	}
	if start > len(withinRunes) {
		return errValue
	}
	// Wildcard search: scan from each position for the earliest position where
	// the pattern matches starting there (matching some prefix of the suffix).
	if strings.ContainsAny(find, "*?") {
		for i := start; i <= len(withinRunes); i++ {
			if txtWildcardMatchAt(find, string(withinRunes[i:])) {
				return numVal(float64(i + 1))
			}
		}
		return errValue
	}
	hay := strings.ToLower(string(withinRunes[start:]))
	needle := strings.ToLower(find)
	pos := strings.Index(hay, needle)
	if pos < 0 {
		return errValue
	}
	runeOff := utf8.RuneCountInString(hay[:pos])
	return numVal(float64(start + runeOff + 1))
}

// txtWildcardMatchAt reports whether the wildcard pattern matches some prefix
// of s (case-insensitive; * matches any run, ? matches one rune, ~ escapes the
// following metacharacter). A pattern that is fully consumed while characters of
// s remain still counts as a match, so SEARCH can locate the start position.
func txtWildcardMatchAt(pat, s string) bool {
	pr := []rune(strings.ToLower(pat))
	sr := []rune(strings.ToLower(s))
	pi, si := 0, 0
	star := -1 // position in pr just after the most recent '*'
	starS := 0 // position in sr where that '*' started matching
	for si <= len(sr) {
		// Pattern fully consumed: a prefix of s has matched.
		if pi == len(pr) {
			return true
		}
		matched := false
		if si < len(sr) {
			if pr[pi] == '~' && pi+1 < len(pr) {
				if sr[si] == pr[pi+1] {
					pi += 2
					si++
					matched = true
				}
			} else if pr[pi] == '?' || pr[pi] == sr[si] {
				pi++
				si++
				matched = true
			}
		}
		if matched {
			continue
		}
		if pr[pi] == '*' {
			star = pi + 1
			starS = si
			pi++
			continue
		}
		if star != -1 {
			pi = star
			starS++
			si = starS
			continue
		}
		return false
	}
	// Consume any trailing '*' in the pattern.
	for pi < len(pr) && pr[pi] == '*' {
		pi++
	}
	return pi == len(pr)
}

// ---- Repetition / joining ---------------------------------------------------

func txtRept(c *callCtx) value {
	if e, ok := txtFirstErr(c, 2); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	text := c.text(0)
	nf, ok := c.num(1)
	if !ok {
		return errValue
	}
	n := int(math.Trunc(nf))
	if n < 0 {
		return errValue
	}
	if n == 0 {
		return strVal("")
	}
	return strVal(strings.Repeat(text, n))
}

// txtTextjoin joins texts (and any range cells) with a delimiter, optionally
// skipping empty values. Signature: TEXTJOIN(delim, ignore_empty, text...).
func txtTextjoin(c *callCtx) value {
	if c.nargs() < 3 {
		return errValue
	}
	if d := c.scalar(0); d.isErr() {
		return d
	}
	if ie := c.scalar(1); ie.isErr() {
		return ie
	}
	delim := c.text(0)
	ignoreEmpty := c.scalar(1).isTruthy()

	var parts []string
	for i := 2; i < c.nargs(); i++ {
		switch v := c.raw(i).(type) {
		case rangeVal:
			for _, cell := range v.flat() {
				if cell.isErr() {
					return cell
				}
				s := cell.toStr()
				if ignoreEmpty && s == "" {
					continue
				}
				parts = append(parts, s)
			}
		case value:
			if v.isErr() {
				return v
			}
			s := v.toStr()
			if ignoreEmpty && s == "" {
				continue
			}
			parts = append(parts, s)
		}
	}
	return strVal(strings.Join(parts, delim))
}

// txtConcat concatenates all arguments (and range cells) with no delimiter.
func txtConcat(c *callCtx) value {
	var b strings.Builder
	for _, v := range c.flat() {
		if v.isErr() {
			return v
		}
		b.WriteString(v.toStr())
	}
	return strVal(b.String())
}

// ---- Character codes --------------------------------------------------------

func txtChar(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	nf, ok := c.num(0)
	if !ok {
		return errValue
	}
	n := int(math.Trunc(nf))
	if n < 1 || n > 255 {
		return errValue
	}
	return strVal(string(rune(n)))
}

func txtCode(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	s := c.text(0)
	if s == "" {
		return errValue
	}
	r, _ := utf8.DecodeRuneInString(s)
	return numVal(float64(r))
}

func txtUnichar(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	nf, ok := c.num(0)
	if !ok {
		return errValue
	}
	n := int(math.Trunc(nf))
	if n < 1 || n > unicode.MaxRune || !utf8.ValidRune(rune(n)) {
		return errValue
	}
	return strVal(string(rune(n)))
}

func txtUnicode(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	s := c.text(0)
	if s == "" {
		return errValue
	}
	r, _ := utf8.DecodeRuneInString(s)
	return numVal(float64(r))
}

// ---- Comparison -------------------------------------------------------------

func txtExact(c *callCtx) value {
	if e, ok := txtFirstErr(c, 2); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	return boolVal(c.text(0) == c.text(1))
}

// ---- Numeric parsing --------------------------------------------------------

// txtValue parses a textual number (Excel VALUE). Handles surrounding spaces,
// a leading currency sign, thousands commas, percent suffix, and parentheses
// for negatives.
func txtValue(c *callCtx) value {
	if e, ok := txtFirstErr(c, 1); ok {
		return e
	}
	v := c.scalar(0)
	if v.kind == kindNum || v.kind == kindBool {
		return numVal(v.num)
	}
	s := strings.TrimSpace(v.toStr())
	if s == "" {
		return numVal(0)
	}
	neg := false
	if strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		neg = true
		s = strings.TrimSpace(s[1 : len(s)-1])
	}
	pct := 0
	for strings.HasSuffix(s, "%") {
		pct++
		s = strings.TrimSpace(s[:len(s)-1])
	}
	// Strip a single leading currency symbol.
	s = strings.TrimSpace(s)
	if len(s) > 0 {
		r, size := utf8.DecodeRuneInString(s)
		if r == '$' || r == '€' || r == '£' || r == '¥' {
			s = strings.TrimSpace(s[size:])
		}
	}
	if strings.HasPrefix(s, "-") {
		neg = !neg
		s = strings.TrimSpace(s[1:])
	} else if strings.HasPrefix(s, "+") {
		s = strings.TrimSpace(s[1:])
	}
	s = strings.ReplaceAll(s, ",", "")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return errValue
	}
	if pct > 0 {
		f /= math.Pow(100, float64(pct))
	}
	if neg {
		f = -f
	}
	return numVal(f)
}

// txtNumberValue parses text using explicit decimal and group separators.
// NUMBERVALUE(text, [decimal_sep], [group_sep]).
func txtNumberValue(c *callCtx) value {
	if e, ok := txtFirstErr(c, 3); ok {
		return e
	}
	v := c.scalar(0)
	if v.kind == kindNum || v.kind == kindBool {
		return numVal(v.num)
	}
	s := strings.TrimSpace(v.toStr())
	if s == "" {
		return numVal(0)
	}
	decSep := "."
	if c.nargs() >= 2 {
		if d := c.text(1); d != "" {
			decSep = string([]rune(d)[0])
		}
	}
	grpSep := ","
	if c.nargs() >= 3 {
		if g := c.text(2); g != "" {
			grpSep = string([]rune(g)[0])
		}
	}
	pct := 0
	for strings.HasSuffix(s, "%") {
		pct++
		s = s[:len(s)-1]
	}
	s = strings.ReplaceAll(s, grpSep, "")
	if decSep != "." {
		s = strings.ReplaceAll(s, decSep, ".")
	}
	s = strings.TrimSpace(s)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return errValue
	}
	if pct > 0 {
		f /= math.Pow(100, float64(pct))
	}
	return numVal(f)
}

// txtT returns its argument unchanged if it is text, otherwise "".
func txtT(c *callCtx) value {
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	if v.kind == kindStr {
		return v
	}
	return strVal("")
}

// ---- Formatted numbers ------------------------------------------------------

// txtFixed formats a number with a fixed number of decimals and optional commas.
// FIXED(number, [decimals=2], [no_commas=FALSE]).
func txtFixed(c *callCtx) value {
	if e, ok := txtFirstErr(c, 3); ok {
		return e
	}
	n, ok := c.num(0)
	if !ok {
		return errValue
	}
	decimals := 2
	if c.nargs() >= 2 {
		df, dok := c.num(1)
		if !dok {
			return errValue
		}
		decimals = int(math.Trunc(df))
	}
	noCommas := false
	if c.nargs() >= 3 {
		noCommas = c.scalar(2).isTruthy()
	}
	return strVal(txtFormatNumber(n, decimals, !noCommas))
}

// txtDollar formats a number as currency. DOLLAR(number, [decimals=2]).
func txtDollar(c *callCtx) value {
	if e, ok := txtFirstErr(c, 2); ok {
		return e
	}
	n, ok := c.num(0)
	if !ok {
		return errValue
	}
	decimals := 2
	if c.nargs() >= 2 {
		df, dok := c.num(1)
		if !dok {
			return errValue
		}
		decimals = int(math.Trunc(df))
	}
	neg := n < 0
	body := txtFormatNumber(math.Abs(n), decimals, true)
	if neg {
		return strVal("($" + body + ")")
	}
	return strVal("$" + body)
}

// txtFormatNumber rounds n to the given number of decimals (which may be
// negative, rounding to the left of the decimal point as Excel does) and
// formats it, optionally with thousands separators.
func txtFormatNumber(n float64, decimals int, commas bool) string {
	neg := math.Signbit(n)
	a := math.Abs(n)
	if decimals < 0 {
		factor := math.Pow(10, float64(-decimals))
		a = math.Round(a/factor) * factor
		s := strconv.FormatFloat(a, 'f', 0, 64)
		if commas {
			s = txtAddCommas(s)
		}
		if neg && a != 0 {
			return "-" + s
		}
		return s
	}
	s := strconv.FormatFloat(a, 'f', decimals, 64)
	intPart := s
	fracPart := ""
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		intPart = s[:dot]
		fracPart = s[dot:]
	}
	if commas {
		intPart = txtAddCommas(intPart)
	}
	out := intPart + fracPart
	if neg && a != 0 {
		return "-" + out
	}
	return out
}

// txtAddCommas inserts thousands separators into a plain integer digit string.
func txtAddCommas(digits string) string {
	neg := false
	if strings.HasPrefix(digits, "-") {
		neg = true
		digits = digits[1:]
	}
	n := len(digits)
	if n <= 3 {
		if neg {
			return "-" + digits
		}
		return digits
	}
	var b strings.Builder
	first := n % 3
	if first == 0 {
		first = 3
	}
	b.WriteString(digits[:first])
	for i := first; i < n; i += 3 {
		b.WriteByte(',')
		b.WriteString(digits[i : i+3])
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

// ---- TEXTBEFORE / TEXTAFTER -------------------------------------------------

// txtTextbefore returns the text before the nth occurrence of a delimiter.
// TEXTBEFORE(text, delimiter, [instance_num=1]). Negative instance counts from
// the end.
func txtTextbefore(c *callCtx) value {
	if e, ok := txtFirstErr(c, 3); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	text := c.text(0)
	delim := c.text(1)
	inst := 1
	if c.nargs() >= 3 {
		nf, ok := c.num(2)
		if !ok {
			return errValue
		}
		inst = int(math.Trunc(nf))
	}
	if inst == 0 {
		return errValue
	}
	if delim == "" {
		return strVal("")
	}
	pos := txtNthDelimPos(text, delim, inst)
	if pos < 0 {
		return errNA
	}
	return strVal(text[:pos])
}

// txtTextafter returns the text after the nth occurrence of a delimiter.
// TEXTAFTER(text, delimiter, [instance_num=1]). Negative instance counts from
// the end.
func txtTextafter(c *callCtx) value {
	if e, ok := txtFirstErr(c, 3); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	text := c.text(0)
	delim := c.text(1)
	inst := 1
	if c.nargs() >= 3 {
		nf, ok := c.num(2)
		if !ok {
			return errValue
		}
		inst = int(math.Trunc(nf))
	}
	if inst == 0 {
		return errValue
	}
	if delim == "" {
		return strVal(text)
	}
	pos := txtNthDelimPos(text, delim, inst)
	if pos < 0 {
		return errNA
	}
	return strVal(text[pos+len(delim):])
}

// txtNthDelimPos returns the byte offset of the nth occurrence of delim in text.
// A positive n counts from the start; a negative n counts from the end. Returns
// -1 when there are fewer than |n| occurrences.
func txtNthDelimPos(text, delim string, n int) int {
	// Collect all occurrence byte offsets.
	var offs []int
	idx := 0
	for {
		p := strings.Index(text[idx:], delim)
		if p < 0 {
			break
		}
		offs = append(offs, idx+p)
		idx += p + len(delim)
	}
	if len(offs) == 0 {
		return -1
	}
	if n > 0 {
		if n > len(offs) {
			return -1
		}
		return offs[n-1]
	}
	// Negative: from the end.
	k := len(offs) + n
	if k < 0 {
		return -1
	}
	return offs[k]
}

// ---- TEXT -------------------------------------------------------------------

// txtText formats a value with an Excel-style format code. A pragmatic subset
// of numeric and date/time codes is supported (see txtApplyFormat); unknown
// codes fall back to the value's default string representation.
func txtText(c *callCtx) value {
	if e, ok := txtFirstErr(c, 2); ok {
		return e
	}
	if c.nargs() < 2 {
		return errValue
	}
	v := c.scalar(0)
	format := c.text(1)
	return strVal(txtApplyFormat(v, format))
}

// txtApplyFormat applies a (subset of) Excel format codes to a value.
func txtApplyFormat(v value, format string) string {
	num, isNum := v.toNum()
	lower := strings.ToLower(strings.TrimSpace(format))

	// Date/time formats require a numeric serial.
	if isNum && txtIsDateFormat(lower) {
		return txtFormatDate(serialToTime(num), format)
	}

	if !isNum {
		// Non-numeric text: format codes generally pass the text through.
		return v.toStr()
	}

	switch strings.TrimSpace(format) {
	case "0":
		return txtFormatNumber(math.Round(num), 0, false)
	case "0.0":
		return txtFormatNumber(num, 1, false)
	case "0.00":
		return txtFormatNumber(num, 2, false)
	case "0.000":
		return txtFormatNumber(num, 3, false)
	case "#,##0":
		return txtFormatNumber(num, 0, true)
	case "#,##0.0":
		return txtFormatNumber(num, 1, true)
	case "#,##0.00":
		return txtFormatNumber(num, 2, true)
	case "0%":
		return txtFormatNumber(num*100, 0, false) + "%"
	case "0.0%":
		return txtFormatNumber(num*100, 1, false) + "%"
	case "0.00%":
		return txtFormatNumber(num*100, 2, false) + "%"
	case "$#,##0":
		return txtCurrency(num, 0, true)
	case "$#,##0.00":
		return txtCurrency(num, 2, true)
	case "$0":
		return txtCurrency(num, 0, false)
	case "$0.00":
		return txtCurrency(num, 2, false)
	}

	// Generic numeric patterns: a run of 0/#/, and an optional fractional part
	// of trailing zeros (e.g. "000", "0.0000", "#,###.##").
	if dec, commas, pct, ok := txtParseNumericPattern(format); ok {
		val := num
		if pct {
			val *= 100
		}
		out := txtFormatNumber(val, dec, commas)
		if pct {
			out += "%"
		}
		return out
	}

	// Unknown format → default string.
	return v.toStr()
}

// txtCurrency formats a (possibly negative) currency value with a leading "$".
func txtCurrency(n float64, decimals int, commas bool) string {
	if n < 0 {
		return "-$" + txtFormatNumber(math.Abs(n), decimals, commas)
	}
	return "$" + txtFormatNumber(n, decimals, commas)
}

// txtParseNumericPattern recognises generic numeric format codes consisting of
// '0', '#', ',', '.', and a trailing '%'. It returns the number of decimal
// places (count of digit placeholders after '.'), whether thousands commas are
// requested, and whether the pattern is a percentage.
func txtParseNumericPattern(format string) (decimals int, commas, pct bool, ok bool) {
	f := strings.TrimSpace(format)
	if f == "" {
		return 0, false, false, false
	}
	if strings.HasSuffix(f, "%") {
		pct = true
		f = f[:len(f)-1]
	}
	// Only digit placeholders, separators and a single dot are allowed.
	for _, r := range f {
		switch r {
		case '0', '#', ',', '.':
		default:
			return 0, false, false, false
		}
	}
	if strings.Count(f, ".") > 1 {
		return 0, false, false, false
	}
	if strings.Contains(f, ",") {
		commas = true
	}
	if dot := strings.IndexByte(f, '.'); dot >= 0 {
		frac := f[dot+1:]
		for _, r := range frac {
			if r == '0' || r == '#' {
				decimals++
			}
		}
	}
	// Require at least one digit placeholder to consider this a numeric pattern.
	if !strings.ContainsAny(f, "0#") {
		return 0, false, false, false
	}
	return decimals, commas, pct, true
}

// ---- Date/time formatting ---------------------------------------------------

// txtIsDateFormat reports whether a (lower-cased) format code looks like a
// supported date/time pattern.
func txtIsDateFormat(lower string) bool {
	switch lower {
	case "yyyy-mm-dd", "mm/dd/yyyy", "m/d/yyyy", "yyyy", "mmm", "mmmm",
		"hh:mm", "hh:mm:ss", "h:mm am/pm":
		return true
	}
	// Heuristic: contains date/time letters and no numeric placeholders.
	if strings.ContainsAny(lower, "ymdhs") && !strings.ContainsAny(lower, "0#%") {
		// Avoid treating bare words; require a separator typical of dates/times.
		if strings.ContainsAny(lower, "-/: ") || lower == "yyyy" || lower == "mmm" || lower == "mmmm" {
			return true
		}
	}
	return false
}

// txtFormatDate renders t according to a supported date/time format code.
func txtFormatDate(t time.Time, format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "yyyy-mm-dd":
		return t.Format("2006-01-02")
	case "mm/dd/yyyy":
		return t.Format("01/02/2006")
	case "m/d/yyyy":
		return t.Format("1/2/2006")
	case "yyyy":
		return t.Format("2006")
	case "mmm":
		return t.Format("Jan")
	case "mmmm":
		return t.Format("January")
	case "hh:mm":
		return t.Format("15:04")
	case "hh:mm:ss":
		return t.Format("15:04:05")
	case "h:mm am/pm":
		return t.Format("3:04 PM")
	}
	// Token-based fallback for compound codes.
	return txtFormatDateTokens(t, format)
}

// txtFormatDateTokens performs a best-effort token replacement for date/time
// format codes not matched exactly above (e.g. "yyyy/mm/dd hh:mm").
func txtFormatDateTokens(t time.Time, format string) string {
	// Replace longest tokens first to avoid partial collisions.
	replacements := []struct{ from, to string }{
		{"yyyy", t.Format("2006")},
		{"yy", t.Format("06")},
		{"mmmm", t.Format("January")},
		{"mmm", t.Format("Jan")},
		{"mm", t.Format("01")},
		{"dd", t.Format("02")},
		{"hh", t.Format("15")},
		{"ss", t.Format("05")},
		{"m", t.Format("1")},
		{"d", t.Format("2")},
		{"h", t.Format("3")},
		{"s", t.Format("5")},
	}
	// Process case-insensitively but only on date letters; build by scanning.
	lower := strings.ToLower(format)
	var b strings.Builder
	i := 0
	for i < len(lower) {
		matched := false
		// "am/pm" token.
		if strings.HasPrefix(lower[i:], "am/pm") {
			b.WriteString(t.Format("PM"))
			i += len("am/pm")
			continue
		}
		for _, rp := range replacements {
			if strings.HasPrefix(lower[i:], rp.from) {
				b.WriteString(rp.to)
				i += len(rp.from)
				matched = true
				break
			}
		}
		if !matched {
			b.WriteByte(format[i])
			i++
		}
	}
	return b.String()
}
