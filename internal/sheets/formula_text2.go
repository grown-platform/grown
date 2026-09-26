package sheets

import (
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// formula_text2.go — text functions added for OnlyOffice parity (M2):
//
//   - the byte-count variants FINDB, LEFTB, LENB, MIDB, REPLACEB, RIGHTB,
//     SEARCHB. Grown uses a single-byte (non-DBCS) default language, where
//     Excel defines each *B function to count characters exactly like its
//     plain counterpart, so they share one implementation;
//   - ASC (full-width ASCII forms → half-width);
//   - REGEXTEST(text, pattern, [case_sensitivity]).
//
// The helpers here read arguments the way Excel does for text functions:
// errors propagate left to right, an omitted argument is empty text, and an
// array argument contributes its top-left element.

func init() {
	registerFunc("LENB", txt2Len)
	registerFunc("LEFTB", func(c *callCtx) value { return txt2LeftRight(c, true) })
	registerFunc("RIGHTB", func(c *callCtx) value { return txt2LeftRight(c, false) })
	registerFunc("MIDB", txt2Mid)
	registerFunc("REPLACEB", txt2Replace)
	registerFunc("FINDB", func(c *callCtx) value { return funcTable["FIND"](c) })
	registerFunc("SEARCHB", func(c *callCtx) value { return funcTable["SEARCH"](c) })
	registerFunc("ASC", txt2Asc)
	registerFunc("REGEXTEST", txt2RegexTest)

	for _, n := range []string{"LENB", "LEFTB", "RIGHTB", "MIDB", "REPLACEB", "FINDB", "SEARCHB", "ASC"} {
		arrayBroadcastFuncs[n] = true
	}
}

// txt2Arg returns argument i as a scalar (top-left of an array), or ok=false
// with the error when it is an error value.
func txt2Arg(c *callCtx, i int) (value, bool) {
	v := c.scalar(i).topLeft()
	if v.isErr() {
		return v, false
	}
	return v, true
}

// txt2Str reads argument i as text.
func txt2Str(c *callCtx, i int) (string, value, bool) {
	v, ok := txt2Arg(c, i)
	if !ok {
		return "", v, false
	}
	if isOmitted(v) {
		return "", value{}, true
	}
	return v.toStr(), value{}, true
}

// txt2Int reads argument i as a truncated count/position; def is used when the
// argument is absent. Values beyond the text length limit are clamped so the
// int conversion cannot overflow.
func txt2Int(c *callCtx, i int, def int) (int, value, bool) {
	if i >= c.nargs() {
		return def, value{}, true
	}
	v, ok := txt2Arg(c, i)
	if !ok {
		return 0, v, false
	}
	n, nok := v.toNum()
	if !nok {
		return 0, errValue, false
	}
	n = math.Trunc(n)
	if n > math.MaxInt32 {
		n = math.MaxInt32
	} else if n < math.MinInt32 {
		n = math.MinInt32
	}
	return int(n), value{}, true
}

func txt2Len(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	s, e, ok := txt2Str(c, 0)
	if !ok {
		return e
	}
	return numVal(float64(utf8.RuneCountInString(s)))
}

func txt2LeftRight(c *callCtx, left bool) value {
	if c.nargs() < 1 || c.nargs() > 2 {
		return errNA
	}
	s, e, ok := txt2Str(c, 0)
	if !ok {
		return e
	}
	n, e, ok := txt2Int(c, 1, 1)
	if !ok {
		return e
	}
	if n < 0 {
		return errValue
	}
	r := []rune(s)
	if n > len(r) {
		n = len(r)
	}
	if left {
		return strVal(string(r[:n]))
	}
	return strVal(string(r[len(r)-n:]))
}

func txt2Mid(c *callCtx) value {
	if c.nargs() != 3 {
		return errNA
	}
	s, e, ok := txt2Str(c, 0)
	if !ok {
		return e
	}
	start, e, ok := txt2Int(c, 1, 1)
	if !ok {
		return e
	}
	n, e, ok := txt2Int(c, 2, 0)
	if !ok {
		return e
	}
	if start < 1 || n < 0 {
		return errValue
	}
	r := []rune(s)
	if start > len(r) {
		return strVal("")
	}
	end := start - 1 + n
	if end > len(r) || end < 0 {
		end = len(r)
	}
	return strVal(string(r[start-1 : end]))
}

func txt2Replace(c *callCtx) value {
	if c.nargs() != 4 {
		return errNA
	}
	s, e, ok := txt2Str(c, 0)
	if !ok {
		return e
	}
	start, e, ok := txt2Int(c, 1, 1)
	if !ok {
		return e
	}
	n, e, ok := txt2Int(c, 2, 0)
	if !ok {
		return e
	}
	repl, e, ok := txt2Str(c, 3)
	if !ok {
		return e
	}
	if start < 1 || n < 0 {
		return errValue
	}
	r := []rune(s)
	if start > len(r) {
		start = len(r) + 1
	}
	end := start - 1 + n
	if end > len(r) || end < 0 {
		end = len(r)
	}
	return strVal(string(r[:start-1]) + repl + string(r[end:]))
}

// txt2Asc converts full-width ASCII forms (U+FF01..U+FF5E) to their
// half-width ASCII equivalents. Booleans pass through unchanged; numbers
// become text.
func txt2Asc(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	v, ok := txt2Arg(c, 0)
	if !ok {
		return v
	}
	if v.kind == kindBool {
		return v
	}
	s := v.toStr()
	if isOmitted(v) {
		s = ""
	}
	return strVal(strings.Map(func(r rune) rune {
		if r >= 0xFF01 && r <= 0xFF5E {
			return r - 0xFEE0
		}
		return r
	}, s))
}

// txt2RegexTest implements REGEXTEST(text, pattern, [case_sensitivity]):
// TRUE when pattern matches any part of text. case_sensitivity 0 (default)
// is case-sensitive, 1 is case-insensitive. An array/range text argument
// yields an array of results.
func txt2RegexTest(c *callCtx) value {
	if c.nargs() < 2 || c.nargs() > 3 {
		return errNA
	}
	pat, e, ok := txt2Str(c, 1)
	if !ok {
		return e
	}
	mode, e, ok := txt2Int(c, 2, 0)
	if !ok {
		return e
	}
	if mode != 0 && mode != 1 {
		return errValue
	}
	if mode == 1 {
		pat = "(?i)" + pat
	}
	re, err := regexp.Compile(pat)
	if err != nil {
		return errValue
	}
	test := func(v value) value {
		if v.isErr() {
			return v
		}
		if isOmitted(v) {
			return boolVal(re.MatchString(""))
		}
		return boolVal(re.MatchString(v.toStr()))
	}
	if rv, ok := c.rangeArg(0); ok && rv.rows*rv.cols > 1 {
		out := make([][]value, rv.rows)
		for r := range rv.cells {
			out[r] = make([]value, rv.cols)
			for k, cell := range rv.cells[r] {
				out[r][k] = test(cell)
			}
		}
		return arrayValue(out)
	}
	return test(c.scalar(0).topLeft())
}
