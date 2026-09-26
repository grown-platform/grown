package sheets

import (
	"math"
	"strconv"
)

// formula_complex.go — Excel's complex-number functions (OnlyOffice parity
// milestone M4): COMPLEX and the IM* family.
//
// Excel stores complex numbers as text such as "3+4i", "-2.5j", "i" or "7".
// cplx is the parsed form: the two parts plus the suffix letter ('i' or 'j';
// 0 when the text had no imaginary part, so it does not constrain the result).
// Results are written back as text with each part rendered like any number
// converted to text (15 significant digits, "1E-16" exponent form).

type cplx struct {
	re, im float64
	suffix byte
}

func init() {
	registerFunc("COMPLEX", cxComplex)

	registerFunc("IMREAL", cxToNum(func(z cplx) value { return numVal(z.re) }))
	registerFunc("IMAGINARY", cxToNum(func(z cplx) value { return numVal(z.im) }))
	registerFunc("IMABS", cxToNum(func(z cplx) value { return numVal(math.Hypot(z.re, z.im)) }))
	registerFunc("IMARGUMENT", cxToNum(func(z cplx) value {
		if z.re == 0 && z.im == 0 {
			return errDiv0
		}
		return numVal(math.Atan2(z.im, z.re))
	}))

	registerFunc("IMCONJUGATE", cxUnary(func(z cplx) (cplx, value) { return cplx{z.re, -z.im, z.suffix}, value{} }))
	registerFunc("IMEXP", cxUnary(func(z cplx) (cplx, value) {
		e := math.Exp(z.re)
		return cplx{e * math.Cos(z.im), e * math.Sin(z.im), z.suffix}, value{}
	}))
	registerFunc("IMLN", cxUnary(func(z cplx) (cplx, value) { return cxLog(z, 1) }))
	registerFunc("IMLOG10", cxUnary(func(z cplx) (cplx, value) { return cxLog(z, math.Ln10) }))
	registerFunc("IMLOG2", cxUnary(func(z cplx) (cplx, value) { return cxLog(z, math.Ln2) }))
	registerFunc("IMSQRT", cxUnary(func(z cplx) (cplx, value) { return cxPow(z, 0.5), value{} }))
	registerFunc("IMSIN", cxUnary(func(z cplx) (cplx, value) { return cxSin(z), value{} }))
	registerFunc("IMCOS", cxUnary(func(z cplx) (cplx, value) { return cxCos(z), value{} }))
	registerFunc("IMSINH", cxUnary(func(z cplx) (cplx, value) {
		return cplx{math.Sinh(z.re) * math.Cos(z.im), math.Cosh(z.re) * math.Sin(z.im), z.suffix}, value{}
	}))
	registerFunc("IMCOSH", cxUnary(func(z cplx) (cplx, value) {
		return cplx{math.Cosh(z.re) * math.Cos(z.im), math.Sinh(z.re) * math.Sin(z.im), z.suffix}, value{}
	}))
	registerFunc("IMTAN", cxUnary(func(z cplx) (cplx, value) { return cxDiv(cxSin(z), cxCos(z)) }))
	registerFunc("IMCOT", cxUnary(func(z cplx) (cplx, value) {
		if z.re == 0 && z.im == 0 {
			return cplx{}, errNum
		}
		return cxDiv(cxCos(z), cxSin(z))
	}))
	registerFunc("IMSEC", cxUnary(func(z cplx) (cplx, value) {
		return cxDiv(cplx{1, 0, z.suffix}, cxCos(z))
	}))
	registerFunc("IMCSC", cxUnary(func(z cplx) (cplx, value) {
		if z.re == 0 && z.im == 0 {
			return cplx{}, errNum
		}
		return cxDiv(cplx{1, 0, z.suffix}, cxSin(z))
	}))
	registerFunc("IMSECH", cxUnary(func(z cplx) (cplx, value) {
		ch := cplx{math.Cosh(z.re) * math.Cos(z.im), math.Sinh(z.re) * math.Sin(z.im), z.suffix}
		return cxDiv(cplx{1, 0, z.suffix}, ch)
	}))
	registerFunc("IMCSCH", cxUnary(func(z cplx) (cplx, value) {
		if z.re == 0 && z.im == 0 {
			return cplx{}, errNum
		}
		sh := cplx{math.Sinh(z.re) * math.Cos(z.im), math.Cosh(z.re) * math.Sin(z.im), z.suffix}
		return cxDiv(cplx{1, 0, z.suffix}, sh)
	}))

	registerFunc("IMPOWER", cxPower)
	registerFunc("IMDIV", func(c *callCtx) value { return cxBinary(c, cxDiv) })
	registerFunc("IMSUB", func(c *callCtx) value {
		return cxBinary(c, func(a, b cplx) (cplx, value) { return cplx{a.re - b.re, a.im - b.im, 0}, value{} })
	})
	registerFunc("IMSUM", func(c *callCtx) value {
		return cxFold(c, cplx{0, 0, 0}, func(a, b cplx) cplx { return cplx{a.re + b.re, a.im + b.im, 0} })
	})
	registerFunc("IMPRODUCT", func(c *callCtx) value {
		return cxFold(c, cplx{1, 0, 0}, cxMul)
	})
}

// ---- parsing and formatting --------------------------------------------------

// cxParse reads Excel complex-number text: "a", "bi", "a+bi", "a-bj", "i",
// "-j", with optional exponents ("1E+307+2i"). ok is false for anything
// else (Excel's #NUM!).
func cxParse(s string) (cplx, bool) {
	if s == "" {
		return cplx{}, false
	}
	// A bare real number.
	if f, err := strconv.ParseFloat(s, 64); err == nil && cxPlainNumber(s) {
		return cplx{re: f}, true
	}
	last := s[len(s)-1]
	if last != 'i' && last != 'j' {
		return cplx{}, false
	}
	body := s[:len(s)-1]
	// Split at the sign that starts the imaginary part: the last '+'/'-' that
	// is not the leading sign and not part of an exponent.
	split := -1
	for k := len(body) - 1; k > 0; k-- {
		if (body[k] == '+' || body[k] == '-') && body[k-1] != 'e' && body[k-1] != 'E' {
			split = k
			break
		}
	}
	reText, imText := "", body
	if split > 0 {
		reText, imText = body[:split], body[split:]
	}
	z := cplx{suffix: last}
	if reText != "" {
		if !cxPlainNumber(reText) {
			return cplx{}, false
		}
		f, err := strconv.ParseFloat(reText, 64)
		if err != nil {
			return cplx{}, false
		}
		z.re = f
	}
	switch imText {
	case "", "+":
		z.im = 1
	case "-":
		z.im = -1
	default:
		if !cxPlainNumber(imText) {
			return cplx{}, false
		}
		f, err := strconv.ParseFloat(imText, 64)
		if err != nil {
			return cplx{}, false
		}
		z.im = f
	}
	return z, true
}

// cxPlainNumber reports whether s is a decimal number in the form Excel
// accepts inside complex text (digits, one '.', optional exponent, optional
// leading sign) — rejecting Go-only spellings such as "Inf", "0x1p3", "1_0".
func cxPlainNumber(s string) bool {
	if s == "" {
		return false
	}
	i := 0
	if s[0] == '+' || s[0] == '-' {
		i++
	}
	digits, dot := 0, false
	for ; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch >= '0' && ch <= '9':
			digits++
		case ch == '.' && !dot:
			dot = true
		case (ch == 'e' || ch == 'E') && digits > 0:
			rest := s[i+1:]
			if rest != "" && (rest[0] == '+' || rest[0] == '-') {
				rest = rest[1:]
			}
			if rest == "" {
				return false
			}
			for k := 0; k < len(rest); k++ {
				if rest[k] < '0' || rest[k] > '9' {
					return false
				}
			}
			return true
		default:
			return false
		}
	}
	return digits > 0
}

// cxFormat writes z as Excel complex text.
func cxFormat(z cplx) value {
	if math.IsNaN(z.re) || math.IsNaN(z.im) || math.IsInf(z.re, 0) || math.IsInf(z.im, 0) {
		return errNum
	}
	suf := "i"
	if z.suffix == 'j' {
		suf = "j"
	}
	if z.im == 0 {
		return strVal(numToText(z.re))
	}
	var im string
	switch z.im {
	case 1:
		im = suf
	case -1:
		im = "-" + suf
	default:
		im = numToText(z.im) + suf
	}
	if z.re == 0 {
		return strVal(im)
	}
	if z.im > 0 {
		im = "+" + im
	}
	return strVal(numToText(z.re) + im)
}

// cxFromValue converts one scalar to a complex number. Numbers are real;
// text is parsed; booleans are #VALUE!; unparsable text is #NUM!.
func cxFromValue(v value) (cplx, value, bool) {
	v = v.topLeft()
	switch v.kind {
	case kindErr:
		return cplx{}, v, false
	case kindNum:
		if isOmitted(v) {
			return cplx{}, value{}, true
		}
		return cplx{re: v.num}, value{}, true
	case kindBool:
		return cplx{}, errValue, false
	case kindStr:
		z, ok := cxParse(v.str)
		if !ok {
			return cplx{}, errNum, false
		}
		return z, value{}, true
	}
	return cplx{}, errValue, false
}

// cxArg reads argument i as a complex number. A multi-cell range is #VALUE!;
// an array constant contributes its first element.
func cxArg(c *callCtx, i int) (cplx, value, bool) {
	if rv, ok := c.raw(i).(rangeVal); ok && rv.rows*rv.cols > 1 {
		return cplx{}, errValue, false
	}
	return cxFromValue(c.scalar(i))
}

// cxSuffix combines the suffixes of two operands: mixing 'i' and 'j' is an
// error; a real operand (suffix 0) adopts the other one.
func cxSuffix(a, b byte) (byte, bool) {
	if a == 0 {
		return b, true
	}
	if b == 0 || a == b {
		return a, true
	}
	return 0, false
}

// ---- arithmetic -------------------------------------------------------------

func cxMul(a, b cplx) cplx {
	return cplx{a.re*b.re - a.im*b.im, a.re*b.im + a.im*b.re, 0}
}

func cxDiv(a, b cplx) (cplx, value) {
	if (math.IsInf(b.re, 0) || math.IsInf(b.im, 0)) && !math.IsInf(a.re, 0) && !math.IsInf(a.im, 0) {
		return cplx{0, 0, a.suffix}, value{} // finite / overflowed → 0 (IMCSCH(45658))
	}
	d := b.re*b.re + b.im*b.im
	if d == 0 {
		return cplx{}, errNum
	}
	return cplx{(a.re*b.re + a.im*b.im) / d, (a.im*b.re - a.re*b.im) / d, a.suffix}, value{}
}

func cxSin(z cplx) cplx {
	return cplx{math.Sin(z.re) * math.Cosh(z.im), math.Cos(z.re) * math.Sinh(z.im), z.suffix}
}

func cxCos(z cplx) cplx {
	return cplx{math.Cos(z.re) * math.Cosh(z.im), -math.Sin(z.re) * math.Sinh(z.im), z.suffix}
}

// cxLog returns ln(z)/base (base = 1 for the natural log).
func cxLog(z cplx, base float64) (cplx, value) {
	if z.re == 0 && z.im == 0 {
		return cplx{}, errNum
	}
	// The modulus is formed directly, as Excel does, so parts beyond ~1E154
	// (or below ~1E-154) overflow/underflow to #NUM!.
	r := math.Log(math.Sqrt(z.re*z.re + z.im*z.im))
	t := math.Atan2(z.im, z.re)
	if base != 1 {
		r /= base
		t /= base
	}
	return cplx{r, t, z.suffix}, value{}
}

// cxPow raises z to a real power through the polar form r^n·(cos nθ + i sin nθ).
func cxPow(z cplx, n float64) cplx {
	if z.re == 0 && z.im == 0 {
		return cplx{0, 0, z.suffix}
	}
	r := math.Pow(math.Hypot(z.re, z.im), n)
	t := math.Atan2(z.im, z.re) * n
	return cplx{r * math.Cos(t), r * math.Sin(t), z.suffix}
}

// ---- worksheet function shapes ---------------------------------------------

// cxToNum builds a one-argument IM* function that returns a number.
func cxToNum(f func(cplx) value) fnImpl {
	return func(c *callCtx) value {
		if c.nargs() != 1 {
			return errNA
		}
		z, e, ok := cxArg(c, 0)
		if !ok {
			return e
		}
		return f(z)
	}
}

// cxUnary builds a one-argument IM* function that returns complex text.
func cxUnary(f func(cplx) (cplx, value)) fnImpl {
	return func(c *callCtx) value {
		if c.nargs() != 1 {
			return errNA
		}
		z, e, ok := cxArg(c, 0)
		if !ok {
			return e
		}
		r, e := f(z)
		if e.isErr() {
			return e
		}
		r.suffix = z.suffix
		return cxFormat(r)
	}
}

// cxBinary builds IMDIV / IMSUB.
func cxBinary(c *callCtx, f func(a, b cplx) (cplx, value)) value {
	if c.nargs() != 2 {
		return errNA
	}
	a, e, ok := cxArg(c, 0)
	if !ok {
		return e
	}
	b, e, ok := cxArg(c, 1)
	if !ok {
		return e
	}
	suf, ok := cxSuffix(a.suffix, b.suffix)
	if !ok {
		return errValue
	}
	r, e := f(a, b)
	if e.isErr() {
		return e
	}
	r.suffix = suf
	return cxFormat(r)
}

// cxFold builds IMSUM / IMPRODUCT: every argument (ranges and arrays
// included) is folded into the accumulator.
func cxFold(c *callCtx, acc cplx, f func(a, b cplx) cplx) value {
	if c.nargs() < 1 {
		return errNA
	}
	var suf byte
	for i := 0; i < c.nargs(); i++ {
		rv, _ := c.rangeArg(i)
		for _, row := range rv.cells {
			for _, cell := range row {
				z, e, ok := cxFromValue(cell)
				if !ok {
					return e
				}
				s, ok := cxSuffix(suf, z.suffix)
				if !ok {
					return errValue
				}
				suf = s
				acc = f(acc, z)
			}
		}
	}
	acc.suffix = suf
	return cxFormat(acc)
}

// cxPower implements IMPOWER(inumber, number); the power must be real.
func cxPower(c *callCtx) value {
	if c.nargs() != 2 {
		return errNA
	}
	z, e, ok := cxArg(c, 0)
	if !ok {
		return e
	}
	nv := c.scalar(1).topLeft()
	if nv.isErr() {
		return nv
	}
	n, nok := nv.toNum()
	if !nok || nv.kind == kindBool {
		return errValue
	}
	if z.re == 0 && z.im == 0 && n <= 0 {
		return errNum
	}
	return cxFormat(cxPow(z, n))
}

// cxComplex implements COMPLEX(real, imaginary, [suffix]).
func cxComplex(c *callCtx) value {
	if c.nargs() < 2 || c.nargs() > 3 {
		return errNA
	}
	var parts [2]float64
	for i := 0; i < 2; i++ {
		if rv, ok := c.raw(i).(rangeVal); ok && rv.rows*rv.cols > 1 {
			return errValue
		}
		n, e, ok := mthArgNum(c, i)
		if !ok {
			return e
		}
		parts[i] = n
	}
	suffix := byte('i')
	if c.nargs() == 3 {
		sv := c.scalar(2).topLeft()
		if sv.isErr() {
			return sv
		}
		switch {
		case isOmitted(sv):
		case sv.kind == kindStr && (sv.str == "i" || sv.str == "j" || sv.str == ""):
			if sv.str == "j" {
				suffix = 'j'
			}
		default:
			return errValue
		}
	}
	return cxFormat(cplx{parts[0], parts[1], suffix})
}
