package sheets

import (
	"math"
	"math/rand"
)

// formula_math.go — Excel-compatible MATH/TRIG worksheet functions.
//
// All helpers/types are prefixed `mth` to avoid collisions with sibling files.

// ---- shared helpers ---------------------------------------------------------

// mthNum coerces a value to a number, propagating errors. The returned value is
// non-nil (an error value) when ok is false.
func mthNum(v value) (float64, value, bool) {
	if v.isErr() {
		return 0, v, false
	}
	n, ok := v.toNum()
	if !ok {
		return 0, errValue, false
	}
	return n, value{}, true
}

// mthArgNum reads argument i as a number, propagating any error value.
func mthArgNum(c *callCtx, i int) (float64, value, bool) {
	return mthNum(c.scalar(i))
}

// mthGCD returns the greatest common divisor of two non-negative integers.
func mthGCD(a, b float64) float64 {
	a = math.Floor(math.Abs(a))
	b = math.Floor(math.Abs(b))
	for b != 0 {
		a, b = b, math.Mod(a, b)
	}
	return a
}

// mthFact returns n! as a float64 (n must be a non-negative integer).
func mthFact(n int) float64 {
	r := 1.0
	for i := 2; i <= n; i++ {
		r *= float64(i)
	}
	return r
}

// mthCheckResult turns NaN/Inf into the appropriate Excel error.
func mthCheckResult(f float64) value {
	if math.IsNaN(f) {
		return errNum
	}
	if math.IsInf(f, 0) {
		return errNum
	}
	return numVal(f)
}

// ---- conditional aggregation ------------------------------------------------

func init() {
	registerFunc("SUMIF", func(c *callCtx) value { return mthSumif(c) })
	registerFunc("SUMIFS", func(c *callCtx) value { return mthSumifs(c) })
	registerFunc("SUMPRODUCT", func(c *callCtx) value { return mthSumproduct(c) })
}

func mthSumif(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	rng, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	crit := parseCriteria(c.text(1))
	sumRange := rng
	if c.nargs() >= 3 {
		sr, ok := c.rangeArg(2)
		if !ok {
			return errValue
		}
		sumRange = sr
	}
	crCells := rng.flat()
	sumCells := sumRange.flat()
	sum := 0.0
	for i, cv := range crCells {
		if !crit.match(cv) {
			continue
		}
		if i >= len(sumCells) {
			continue
		}
		sv := sumCells[i]
		if sv.isErr() {
			return sv
		}
		if n, ok := sv.toNum(); ok {
			sum += n
		}
	}
	return numVal(sum)
}

func mthSumifs(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	sumRange, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	sumCells := sumRange.flat()
	// Build (criteria range, criteria) pairs.
	type pair struct {
		cells []value
		crit  criteria
	}
	var pairs []pair
	for i := 1; i+1 < c.nargs(); i += 2 {
		cr, ok := c.rangeArg(i)
		if !ok {
			return errValue
		}
		pairs = append(pairs, pair{cells: cr.flat(), crit: parseCriteria(c.text(i + 1))})
	}
	sum := 0.0
	for idx, sv := range sumCells {
		matched := true
		for _, p := range pairs {
			if idx >= len(p.cells) || !p.crit.match(p.cells[idx]) {
				matched = false
				break
			}
		}
		if !matched {
			continue
		}
		if sv.isErr() {
			return sv
		}
		if n, ok := sv.toNum(); ok {
			sum += n
		}
	}
	return numVal(sum)
}

func mthSumproduct(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	var arrays [][]value
	length := -1
	for i := 0; i < c.nargs(); i++ {
		rv, ok := c.rangeArg(i)
		if !ok {
			return errValue
		}
		fl := rv.flat()
		if length == -1 {
			length = len(fl)
		} else if len(fl) != length {
			return errValue // arrays must have the same dimensions
		}
		arrays = append(arrays, fl)
	}
	sum := 0.0
	for i := 0; i < length; i++ {
		prod := 1.0
		for _, arr := range arrays {
			v := arr[i]
			if v.isErr() {
				return v
			}
			n, _ := v.toNum() // non-numeric treated as 0
			prod *= n
		}
		sum += prod
	}
	return numVal(sum)
}

// ---- products, powers, roots ------------------------------------------------

func init() {
	registerFunc("PRODUCT", func(c *callCtx) value {
		prod := 1.0
		found := false
		for _, v := range c.flat() {
			if v.isErr() {
				return v
			}
			if v.kind == kindStr {
				continue
			}
			if n, ok := v.toNum(); ok {
				prod *= n
				found = true
			}
		}
		if !found {
			return numVal(0)
		}
		return numVal(prod)
	})

	registerFunc("POWER", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		base, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		exp, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		return mthCheckResult(math.Pow(base, exp))
	})

	registerFunc("SQRT", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n < 0 {
			return errNum
		}
		return numVal(math.Sqrt(n))
	})

	registerFunc("SQRTPI", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n < 0 {
			return errNum
		}
		return numVal(math.Sqrt(n * math.Pi))
	})

	registerFunc("SUMSQ", func(c *callCtx) value {
		sum := 0.0
		for _, v := range c.flat() {
			if v.isErr() {
				return v
			}
			if v.kind == kindStr {
				continue
			}
			if n, ok := v.toNum(); ok {
				sum += n * n
			}
		}
		return numVal(sum)
	})
}

// ---- modulo, integer, rounding ----------------------------------------------

func init() {
	registerFunc("MOD", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		n, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		d, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		if d == 0 {
			return errDiv0
		}
		// Excel MOD result takes the sign of the divisor.
		r := math.Mod(n, d)
		if r != 0 && (r < 0) != (d < 0) {
			r += d
		}
		return numVal(r)
	})

	registerFunc("INT", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		return numVal(math.Floor(n))
	})

	registerFunc("TRUNC", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		digits := 0
		if c.nargs() >= 2 {
			df, e2, ok := mthArgNum(c, 1)
			if !ok {
				return e2
			}
			digits = int(df)
		}
		factor := math.Pow(10, float64(digits))
		return numVal(math.Trunc(n*factor) / factor)
	})

	registerFunc("CEILING", func(c *callCtx) value { return mthCeilingFloor(c, true, false) })
	registerFunc("FLOOR", func(c *callCtx) value { return mthCeilingFloor(c, false, false) })
	registerFunc("CEILING.MATH", func(c *callCtx) value { return mthCeilFloorMath(c, true) })
	registerFunc("FLOOR.MATH", func(c *callCtx) value { return mthCeilFloorMath(c, false) })

	registerFunc("MROUND", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		n, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		m, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		if m == 0 {
			return numVal(0)
		}
		// Arguments must share sign.
		if (n < 0) != (m < 0) && n != 0 {
			return errNum
		}
		q := n / m
		// round half away from zero
		if q >= 0 {
			q = math.Floor(q + 0.5)
		} else {
			q = math.Ceil(q - 0.5)
		}
		return numVal(q * m)
	})

	registerFunc("ROUNDUP", func(c *callCtx) value { return mthRoundDir(c, true) })
	registerFunc("ROUNDDOWN", func(c *callCtx) value { return mthRoundDir(c, false) })

	registerFunc("SIGN", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		switch {
		case n > 0:
			return numVal(1)
		case n < 0:
			return numVal(-1)
		default:
			return numVal(0)
		}
	})
}

// mthCeilingFloor implements legacy CEILING/FLOOR(num, significance).
func mthCeilingFloor(c *callCtx, ceil bool, _ bool) value {
	if c.nargs() < 2 {
		return errNA
	}
	n, e1, ok := mthArgNum(c, 0)
	if !ok {
		return e1
	}
	sig, e2, ok := mthArgNum(c, 1)
	if !ok {
		return e2
	}
	if sig == 0 {
		return numVal(0)
	}
	// In legacy Excel, num and significance must share sign.
	if (n < 0) != (sig < 0) && n != 0 {
		return errNum
	}
	q := n / sig
	if ceil {
		q = math.Ceil(q)
	} else {
		q = math.Floor(q)
	}
	return numVal(q * sig)
}

// mthCeilFloorMath implements CEILING.MATH / FLOOR.MATH(num, [significance], [mode]).
func mthCeilFloorMath(c *callCtx, ceil bool) value {
	if c.nargs() < 1 {
		return errNA
	}
	n, e, ok := mthArgNum(c, 0)
	if !ok {
		return e
	}
	sig := 1.0
	if c.nargs() >= 2 {
		s, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		sig = s
	}
	if sig == 0 {
		return numVal(0)
	}
	sig = math.Abs(sig)
	mode := 0.0
	if c.nargs() >= 3 {
		m, e3, ok := mthArgNum(c, 2)
		if !ok {
			return e3
		}
		mode = m
	}
	q := n / sig
	if ceil {
		// Default rounds toward +inf; mode!=0 rounds away from zero for negatives.
		if n < 0 && mode != 0 {
			q = -math.Ceil(math.Abs(q))
		} else {
			q = math.Ceil(q)
		}
	} else {
		// FLOOR.MATH default rounds toward -inf; mode!=0 rounds toward zero for negatives.
		if n < 0 && mode != 0 {
			q = -math.Floor(math.Abs(q))
		} else {
			q = math.Floor(q)
		}
	}
	return numVal(q * sig)
}

// mthRoundDir implements ROUNDUP (away from zero) / ROUNDDOWN (toward zero).
func mthRoundDir(c *callCtx, up bool) value {
	if c.nargs() < 1 {
		return errNA
	}
	n, e, ok := mthArgNum(c, 0)
	if !ok {
		return e
	}
	digits := 0
	if c.nargs() >= 2 {
		df, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		digits = int(df)
	}
	factor := math.Pow(10, float64(digits))
	scaled := n * factor
	if up {
		if scaled >= 0 {
			scaled = math.Ceil(scaled)
		} else {
			scaled = math.Floor(scaled)
		}
	} else {
		if scaled >= 0 {
			scaled = math.Floor(scaled)
		} else {
			scaled = math.Ceil(scaled)
		}
	}
	return numVal(scaled / factor)
}

// ---- GCD / LCM / number theory ----------------------------------------------

func init() {
	registerFunc("GCD", func(c *callCtx) value {
		vals := c.flat()
		if len(vals) == 0 {
			return errNA
		}
		g := 0.0
		for _, v := range vals {
			if v.isErr() {
				return v
			}
			n, ok := v.toNum()
			if !ok {
				return errValue
			}
			n = math.Floor(math.Abs(n))
			if n < 0 {
				return errNum
			}
			g = mthGCD(g, n)
		}
		return numVal(g)
	})

	registerFunc("LCM", func(c *callCtx) value {
		vals := c.flat()
		if len(vals) == 0 {
			return errNA
		}
		l := 1.0
		for _, v := range vals {
			if v.isErr() {
				return v
			}
			n, ok := v.toNum()
			if !ok {
				return errValue
			}
			n = math.Floor(math.Abs(n))
			if n == 0 {
				return numVal(0)
			}
			g := mthGCD(l, n)
			if g == 0 {
				continue
			}
			l = l / g * n
		}
		return numVal(l)
	})

	registerFunc("QUOTIENT", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		n, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		d, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		if d == 0 {
			return errDiv0
		}
		return numVal(math.Trunc(n / d))
	})

	registerFunc("EVEN", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n >= 0 {
			return numVal(math.Ceil(n/2) * 2)
		}
		return numVal(math.Floor(n/2) * 2)
	})

	registerFunc("ODD", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n == 0 {
			return numVal(1)
		}
		if n > 0 {
			r := math.Ceil(n)
			if math.Mod(r, 2) == 0 {
				r++
			}
			return numVal(r)
		}
		r := math.Floor(n)
		if math.Mod(r, 2) == 0 {
			r--
		}
		return numVal(r)
	})
}

// ---- exponential / logarithm ------------------------------------------------

func init() {
	registerFunc("EXP", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		return mthCheckResult(math.Exp(n))
	})

	registerFunc("LN", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n <= 0 {
			return errNum
		}
		return numVal(math.Log(n))
	})

	registerFunc("LOG", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n <= 0 {
			return errNum
		}
		base := 10.0
		if c.nargs() >= 2 {
			b, e2, ok := mthArgNum(c, 1)
			if !ok {
				return e2
			}
			if b <= 0 || b == 1 {
				return errNum
			}
			base = b
		}
		return numVal(math.Log(n) / math.Log(base))
	})

	registerFunc("LOG10", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		if n <= 0 {
			return errNum
		}
		return numVal(math.Log10(n))
	})
}

// ---- constants and random ---------------------------------------------------

func init() {
	registerFunc("PI", func(c *callCtx) value { return numVal(math.Pi) })

	registerFunc("RAND", func(c *callCtx) value { return numVal(rand.Float64()) })

	registerFunc("RANDBETWEEN", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		lo, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		hi, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		l := int64(math.Ceil(lo))
		h := int64(math.Floor(hi))
		if l > h {
			return errNum
		}
		return numVal(float64(l + rand.Int63n(h-l+1)))
	})
}

// ---- combinatorics ----------------------------------------------------------

func init() {
	registerFunc("FACT", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		n = math.Trunc(n)
		if n < 0 {
			return errNum
		}
		return mthCheckResult(mthFact(int(n)))
	})

	registerFunc("FACTDOUBLE", func(c *callCtx) value {
		if c.nargs() < 1 {
			return errNA
		}
		n, e, ok := mthArgNum(c, 0)
		if !ok {
			return e
		}
		n = math.Trunc(n)
		if n < -1 {
			return errNum
		}
		r := 1.0
		for i := n; i > 1; i -= 2 {
			r *= i
		}
		return mthCheckResult(r)
	})

	registerFunc("COMBIN", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		nf, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		kf, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		n := math.Trunc(nf)
		k := math.Trunc(kf)
		if n < 0 || k < 0 || k > n {
			return errNum
		}
		return mthCheckResult(mthCombin(n, k))
	})

	registerFunc("COMBINA", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		nf, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		kf, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		n := math.Trunc(nf)
		k := math.Trunc(kf)
		if n < 0 || k < 0 {
			return errNum
		}
		if n == 0 && k == 0 {
			return numVal(1)
		}
		// COMBINA(n,k) = COMBIN(n+k-1, k)
		return mthCheckResult(mthCombin(n+k-1, k))
	})

	registerFunc("PERMUT", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		nf, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		kf, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		n := math.Trunc(nf)
		k := math.Trunc(kf)
		if n < 0 || k < 0 || k > n {
			return errNum
		}
		// P(n,k) = n! / (n-k)!
		r := 1.0
		for i := 0.0; i < k; i++ {
			r *= (n - i)
		}
		return mthCheckResult(r)
	})

	registerFunc("MULTINOMIAL", func(c *callCtx) value {
		vals := c.flat()
		if len(vals) == 0 {
			return errNA
		}
		sum := 0.0
		var nums []float64
		for _, v := range vals {
			if v.isErr() {
				return v
			}
			n, ok := v.toNum()
			if !ok {
				return errValue
			}
			n = math.Trunc(n)
			if n < 0 {
				return errNum
			}
			nums = append(nums, n)
			sum += n
		}
		// (sum)! / prod(ni!)
		result := mthFact(int(sum))
		for _, n := range nums {
			result /= mthFact(int(n))
		}
		return mthCheckResult(result)
	})
}

// mthCombin computes n choose k multiplicatively to limit overflow/precision loss.
func mthCombin(n, k float64) float64 {
	if k > n-k {
		k = n - k
	}
	r := 1.0
	for i := 0.0; i < k; i++ {
		r = r * (n - i) / (i + 1)
	}
	return math.Round(r)
}

// ---- trigonometry -----------------------------------------------------------

func init() {
	registerFunc("SIN", mthTrig1(math.Sin))
	registerFunc("COS", mthTrig1(math.Cos))
	registerFunc("TAN", mthTrig1(math.Tan))
	registerFunc("SINH", mthTrig1(math.Sinh))
	registerFunc("COSH", mthTrig1(math.Cosh))
	registerFunc("TANH", mthTrig1(math.Tanh))
	registerFunc("ASINH", mthTrig1(math.Asinh))
	registerFunc("ATAN", mthTrig1(math.Atan))

	registerFunc("SEC", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		return mthCheckResult(1 / math.Cos(n))
	})
	registerFunc("CSC", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		return mthCheckResult(1 / math.Sin(n))
	})
	registerFunc("COT", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		return mthCheckResult(1 / math.Tan(n))
	})

	registerFunc("ASIN", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		if n < -1 || n > 1 {
			return errNum
		}
		return numVal(math.Asin(n))
	})
	registerFunc("ACOS", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		if n < -1 || n > 1 {
			return errNum
		}
		return numVal(math.Acos(n))
	})

	registerFunc("ACOSH", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		if n < 1 {
			return errNum
		}
		return numVal(math.Acosh(n))
	})
	registerFunc("ATANH", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		if n <= -1 || n >= 1 {
			return errNum
		}
		return numVal(math.Atanh(n))
	})

	registerFunc("ATAN2", func(c *callCtx) value {
		if c.nargs() < 2 {
			return errNA
		}
		x, e1, ok := mthArgNum(c, 0)
		if !ok {
			return e1
		}
		y, e2, ok := mthArgNum(c, 1)
		if !ok {
			return e2
		}
		if x == 0 && y == 0 {
			return errDiv0
		}
		// Excel ATAN2(x, y) = angle of point (x, y) = math.Atan2(y, x).
		return numVal(math.Atan2(y, x))
	})

	registerFunc("DEGREES", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		return numVal(n * 180 / math.Pi)
	})
	registerFunc("RADIANS", func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		return numVal(n * math.Pi / 180)
	})
}

// mthTrigArg reads the single numeric argument shared by most trig functions.
func mthTrigArg(c *callCtx) (float64, value, bool) {
	if c.nargs() < 1 {
		return 0, errNA, false
	}
	return mthArgNum(c, 0)
}

// mthTrig1 builds a one-argument trig function from a math.* func.
func mthTrig1(f func(float64) float64) fnImpl {
	return func(c *callCtx) value {
		n, e, ok := mthTrigArg(c)
		if !ok {
			return e
		}
		return mthCheckResult(f(n))
	}
}
