package sheets

import (
	"regexp"
	"strings"
)

// Google Sheets text/array functions that were missing: REGEXMATCH,
// REGEXEXTRACT, REGEXREPLACE (Go's regexp is RE2, same engine Sheets uses),
// plus SPLIT, JOIN, and FLATTEN. SPLIT and FLATTEN spill via arrayValue.

func init() {
	registerFunc("REGEXMATCH", fnRegexMatch)
	registerFunc("REGEXEXTRACT", fnRegexExtract)
	registerFunc("REGEXREPLACE", fnRegexReplace)
	registerFunc("SPLIT", fnSplit)
	registerFunc("JOIN", fnJoin)
	registerFunc("FLATTEN", fnFlatten)
}

// compileRe compiles a pattern, returning (nil, #VALUE!) on a bad regex.
func compileRe(pat string) (*regexp.Regexp, value) {
	re, err := regexp.Compile(pat)
	if err != nil {
		return nil, errValue
	}
	return re, value{}
}

// REGEXMATCH(text, regex) → TRUE if the text contains a match.
func fnRegexMatch(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	re, e := compileRe(c.text(1))
	if re == nil {
		return e
	}
	return boolVal(re.MatchString(c.text(0)))
}

// REGEXEXTRACT(text, regex) → the first match, or the first capture group when
// the pattern has one. #N/A when there's no match (matching Sheets).
func fnRegexExtract(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	re, e := compileRe(c.text(1))
	if re == nil {
		return e
	}
	m := re.FindStringSubmatch(c.text(0))
	if m == nil {
		return errNA
	}
	if len(m) > 1 {
		return strVal(m[1])
	}
	return strVal(m[0])
}

// REGEXREPLACE(text, regex, replacement) → replace all matches. $1 references a
// capture group (RE2 replacement syntax).
func fnRegexReplace(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	re, e := compileRe(c.text(1))
	if re == nil {
		return e
	}
	return strVal(re.ReplaceAllString(c.text(0), c.text(2)))
}

// splitByAny splits text at every rune that appears in chars, keeping empties.
func splitByAny(text, chars string) []string {
	if chars == "" {
		return []string{text}
	}
	var parts []string
	var cur strings.Builder
	for _, r := range text {
		if strings.ContainsRune(chars, r) {
			parts = append(parts, cur.String())
			cur.Reset()
		} else {
			cur.WriteRune(r)
		}
	}
	parts = append(parts, cur.String())
	return parts
}

// SPLIT(text, delimiter, [split_by_each=TRUE], [remove_empty=TRUE]) → a row of
// cells. By default the delimiter is treated as a set of single characters
// (split_by_each) and empty results are dropped, like Google Sheets.
func fnSplit(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	text := c.text(0)
	delim := c.text(1)
	splitByEach := true
	if c.nargs() >= 3 {
		splitByEach = c.scalar(2).isTruthy()
	}
	removeEmpty := true
	if c.nargs() >= 4 {
		removeEmpty = c.scalar(3).isTruthy()
	}
	var parts []string
	if splitByEach {
		parts = splitByAny(text, delim)
	} else if delim == "" {
		parts = []string{text}
	} else {
		parts = strings.Split(text, delim)
	}
	if removeEmpty {
		parts = dropEmpty(parts)
	}
	if len(parts) == 0 {
		return errVal("#CALC!")
	}
	row := make([]value, len(parts))
	for i, p := range parts {
		row[i] = strVal(p)
	}
	return arrayValue([][]value{row})
}

// JOIN(delimiter, value1, [value2, ...]) → the values (ranges flattened) joined
// by the delimiter.
func fnJoin(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	delim := c.text(0)
	var parts []string
	for i := 1; i < c.nargs(); i++ {
		if rv, ok := c.rangeArg(i); ok {
			for _, v := range rv.flat() {
				parts = append(parts, v.toStr())
			}
		}
	}
	return strVal(strings.Join(parts, delim))
}

// FLATTEN(range1, [range2, ...]) → all values from the ranges as a single
// column, row-major within each range.
func fnFlatten(c *callCtx) value {
	var out [][]value
	for i := 0; i < c.nargs(); i++ {
		rv, ok := c.rangeArg(i)
		if !ok {
			continue
		}
		for r := 0; r < rv.rows; r++ {
			for cc := 0; cc < rv.cols; cc++ {
				out = append(out, []value{rv.cells[r][cc]})
			}
		}
	}
	if len(out) == 0 {
		return errVal("#CALC!")
	}
	return arrayValue(out)
}
