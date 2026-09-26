package sheets

import (
	"math"
	"strconv"
)

// formula_math2.go — the remaining Excel MATH/TRIG functions (OnlyOffice parity
// milestone M2): inverse/hyperbolic reciprocals (ACOT, ACOTH, COTH, CSCH,
// SECH) and the sign-insensitive rounding family (CEILING.PRECISE,
// ISO.CEILING, FLOOR.PRECISE, ECMA.CEILING).

func init() {
	registerFunc("ACOT", mth2Unary(func(x float64) value {
		// Principal value in (0, π): ACOT(0) = π/2, negative inputs land above π/2.
		return numVal(math.Pi/2 - math.Atan(x))
	}))
	registerFunc("ACOTH", mth2Unary(func(x float64) value {
		if math.Abs(x) <= 1 {
			return errNum
		}
		// 0.5*ln((x+1)/(x-1)) written via atanh(1/x) to stay accurate for large |x|.
		return numVal(math.Atanh(1 / x))
	}))
	registerFunc("COTH", mth2Unary(func(x float64) value {
		if x == 0 {
			return errDiv0
		}
		return mthCheckResult(1 / math.Tanh(x))
	}))
	registerFunc("CSCH", mth2Unary(func(x float64) value {
		if x == 0 {
			return errDiv0
		}
		return numVal(1 / math.Sinh(x))
	}))
	registerFunc("SECH", mth2Unary(func(x float64) value {
		return numVal(1 / math.Cosh(x))
	}))

	registerFunc("CEILING.PRECISE", func(c *callCtx) value { return mth2Precise(c, true) })
	registerFunc("ISO.CEILING", func(c *callCtx) value { return mth2Precise(c, true) })
	registerFunc("FLOOR.PRECISE", func(c *callCtx) value { return mth2Precise(c, false) })
	registerFunc("ECMA.CEILING", mth2EcmaCeiling)

	for _, n := range []string{"ACOT", "ACOTH", "COTH", "CSCH", "SECH",
		"CEILING.PRECISE", "ISO.CEILING", "FLOOR.PRECISE", "ECMA.CEILING"} {
		arrayBroadcastFuncs[n] = true
	}
}

// mth2Unary wraps a one-argument numeric function with the usual argument
// count check and error/text coercion.
func mth2Unary(f func(float64) value) fnImpl {
	return func(c *callCtx) value {
		if c.nargs() != 1 {
			return errNA
		}
		x, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		return f(x)
	}
}

// mth2Quot divides n by sig and snaps a quotient that is an integer up to
// floating-point noise (4.5/0.1 = 45.000000000000007) to that integer, so the
// following ceil/floor does not jump a whole step.
func mth2Quot(n, sig float64) float64 {
	q := n / sig
	if r := math.Round(q); r != 0 && math.Abs(q-r) <= 1e-12*math.Abs(q) {
		return r
	}
	return q
}

// mth2Precise implements CEILING.PRECISE / ISO.CEILING (ceil=true) and
// FLOOR.PRECISE: the sign of significance is ignored and the result always
// rounds toward +∞ (ceiling) or −∞ (floor). significance defaults to 1; 0
// yields 0.
func mth2Precise(c *callCtx, ceil bool) value {
	if c.nargs() < 1 || c.nargs() > 2 {
		return errNA
	}
	n, e, ok := mthArgNum(c, 0)
	if !ok {
		return e
	}
	sig := 1.0
	if c.nargs() == 2 {
		s, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		sig = math.Abs(s)
	}
	if sig == 0 || n == 0 {
		return numVal(0)
	}
	q := mth2Quot(n, sig)
	if math.IsInf(q, 0) {
		return errNum
	}
	if ceil {
		q = math.Ceil(q)
	} else {
		q = math.Floor(q)
	}
	return mthCheckResult(q * sig)
}

// mth2EcmaCeiling implements ECMA.CEILING(number, significance) (ECMA-376 /
// Excel 2010 CEILING): a negative number with negative significance rounds
// away from zero, with positive significance toward +∞; a positive number
// with negative significance is #NUM!.
func mth2EcmaCeiling(c *callCtx) value {
	if c.nargs() != 2 {
		return errNA
	}
	n, e, ok := mthArgNum(c, 0)
	if !ok {
		return e
	}
	sig, e2, ok := mthArgNum(c, 1)
	if !ok {
		return e2
	}
	if n == 0 || sig == 0 {
		return numVal(0)
	}
	if n > 0 && sig < 0 {
		return errNum
	}
	q := mth2Quot(n, sig)
	if math.IsInf(q, 0) {
		return errNum
	}
	// When both are negative q is positive, so ceil moves the result away
	// from zero; otherwise it moves toward +∞.
	return mthCheckResult(math.Ceil(q) * sig)
}

// mth2Round implements ROUND(number, digits): digits is truncated to an
// integer and halves round away from zero on the decimal value Excel shows
// (15 significant digits), so ROUND(1.005, 2) is 1.01 even though 1.005 is
// stored as 1.00499999999999989….
func mth2Round(c *callCtx) value {
	if c.nargs() != 2 && c.nargs() != 1 {
		return errNA
	}
	n, e, ok := mthArgNum(c, 0)
	if !ok {
		return e
	}
	d := 0.0
	if c.nargs() == 2 {
		if d, e, ok = mthArgNum(c, 1); !ok {
			return e
		}
	}
	return mthCheckResult(mth2RoundDecimal(n, int(math.Max(-400, math.Min(400, math.Trunc(d))))))
}

// mth2RoundDecimal rounds n to digits decimal places (negative digits round
// to tens, hundreds, …), half away from zero, working on the 15-significant-
// digit decimal form of n. Scaling is done by shifting the decimal exponent
// of that text, which is exact, instead of multiplying by a power of ten.
func mth2RoundDecimal(n float64, digits int) float64 {
	return mth2RoundDecimalWith(n, digits, math.Round) // half away from zero
}

// mth2RoundDecimalWith is mth2RoundDecimal with the integer rounding step
// supplied (ROUNDUP/ROUNDDOWN pass their own).
func mth2RoundDecimalWith(n float64, digits int, round func(float64) float64) float64 {
	if n == 0 || math.IsInf(n, 0) || math.IsNaN(n) {
		return n
	}
	scaled, ok := mth2ShiftExp(strconv.FormatFloat(n, 'e', 14, 64), digits)
	if !ok {
		return n
	}
	r := round(scaled)
	if r == 0 {
		return 0
	}
	out, ok := mth2ShiftExp(strconv.FormatFloat(r, 'e', -1, 64), -digits)
	if !ok {
		return n
	}
	return out
}

// mth2ShiftExp parses "d.ddde±XX" after adding shift to its exponent.
func mth2ShiftExp(s string, shift int) (float64, bool) {
	k := len(s) - 1
	for k >= 0 && s[k] != 'e' {
		k--
	}
	if k < 0 {
		return 0, false
	}
	exp, err := strconv.Atoi(s[k+1:])
	if err != nil {
		return 0, false
	}
	f, err := strconv.ParseFloat(s[:k]+"e"+strconv.Itoa(exp+shift), 64)
	return f, err == nil
}
