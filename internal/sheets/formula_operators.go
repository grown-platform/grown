package sheets

import (
	"math"
	"strconv"
)

// formula_operators.go — small parser-level value helpers: the postfix '%'
// operator and the value an omitted argument (f(1,,3), f(x,)) evaluates to.

// omittedTag marks a number value that stands for an omitted argument. The
// value is otherwise a plain 0, the same as a blank cell, so numeric functions
// need no special case; text-oriented functions can use isOmitted to read it
// as "" instead.
const omittedTag = "\x00omitted"

// omittedArg is what the parser passes for an empty argument slot.
var omittedArg = value{kind: kindNum, num: 0, str: omittedTag}

// isOmitted reports whether v came from an empty argument slot.
func isOmitted(v value) bool { return v.kind == kindNum && v.str == omittedTag }

// scalarPercent implements x% (= x/100), propagating errors.
func scalarPercent(v value) value {
	if v.isErr() {
		return v
	}
	n, ok := v.toNum()
	if !ok {
		return errValue
	}
	return numVal(n / 100)
}

// numToText renders a number the way Excel converts it to text (CONCATENATE,
// LEFT, "&", …): at most 15 significant digits, plain notation for ordinary
// magnitudes and E-notation ("1E+307", "1.5E-10") for very large or very
// small values.
func numToText(n float64) string {
	if math.IsInf(n, 0) || math.IsNaN(n) {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	if n == 0 {
		return "0"
	}
	// Round to 15 significant digits first (0.1+0.2 → 0.3).
	r, _ := strconv.ParseFloat(strconv.FormatFloat(n, 'g', 15, 64), 64)
	a := math.Abs(r)
	if a >= 1e15 || a < 1e-9 {
		// Go writes at least a two-digit exponent ("1E+20", "1E-10"), as
		// Excel does.
		return strconv.FormatFloat(r, 'E', -1, 64)
	}
	if r == math.Trunc(r) {
		return strconv.FormatInt(int64(r), 10)
	}
	return strconv.FormatFloat(r, 'f', -1, 64)
}
