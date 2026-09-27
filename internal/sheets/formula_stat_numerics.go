package sheets

// formula_stat_numerics.go — special functions behind the statistical
// distribution library (OnlyOffice parity milestone M3).
//
//   - the regularized incomplete gamma functions P(a,x) and Q(a,x), from the
//     power series (x < a+1) and the Legendre continued fraction (x ≥ a+1);
//   - the regularized incomplete beta function I_x(a,b), from its continued
//     fraction evaluated with the modified Lentz method, using the symmetry
//     I_x(a,b) = 1 − I_{1−x}(b,a) so the fraction always converges quickly
//     and the smaller tail is computed directly (no cancellation);
//   - a bracketing root finder (bisection-safeguarded secant/inverse
//     quadratic interpolation, in the manner of Brent) used for every
//     inverse distribution.
//
// These are standard textbook algorithms written for Grown; the structure
// follows the public descriptions in Abramowitz & Stegun 6.5 and 26.5 and
// in the Cephes / jStat documentation (BSD / MIT).

import "math"

const (
	sdEps     = 4e-16
	sdTiny    = 1e-300
	sdMaxIter = 10000000
)

// lnGamma is ln|Γ(x)|.
func lnGamma(x float64) float64 {
	v, _ := math.Lgamma(x)
	return v
}

// stirCorr is the remainder of Stirling's formula,
// ln Γ(a) − ((a − ½) ln a − a + ½ ln 2π), for a > 0.
func stirCorr(a float64) float64 {
	if a < 10 {
		return lnGamma(a) - ((a-0.5)*math.Log(a) - a + 0.5*math.Log(2*math.Pi))
	}
	// Stirling series to the a⁻¹³ term: the first omitted term is below
	// 1e-16 for a ≥ 10.
	a2 := a * a
	s := 1.0 / 156
	s = -691.0/360360 + s/a2
	s = 1.0/1188 + s/a2
	s = -1.0/1680 + s/a2
	s = 1.0/1260 + s/a2
	s = -1.0/360 + s/a2
	s = 1.0/12 + s/a2
	return s / a
}

// lnBeta is ln B(a,b) for a, b > 0. When one argument is large the
// difference ln Γ(big) − ln Γ(big+small) is taken from Stirling's series,
// avoiding the cancellation of two huge logarithms.
func lnBeta(a, b float64) float64 {
	big, small := a, b
	if small > big {
		big, small = small, big
	}
	if big < 10 {
		return lnGamma(a) + lnGamma(b) - lnGamma(a+b)
	}
	diff := -(big-0.5)*math.Log1p(small/big) - small*math.Log(big+small) + small + stirCorr(big) - stirCorr(big+small)
	return lnGamma(small) + diff
}

// lnGammaFront is ln(x^a e^{−x} / Γ(a)), the prefactor of the incomplete
// gamma function, computed without cancellation for large a.
func lnGammaFront(a, x float64) float64 {
	if a < 10 {
		return -x + a*math.Log(x) - lnGamma(a)
	}
	t := (x - a) / a
	return a*(math.Log1p(t)-t) + 0.5*math.Log(a) - 0.5*math.Log(2*math.Pi) - stirCorr(a)
}

// lnBetaFront is ln(x^a y^b / B(a,b)) with y = 1 − x, the prefactor of the
// incomplete beta function, computed without cancellation for large a, b.
func lnBetaFront(x, y, a, b float64) float64 {
	lnx, lny := math.Log(x), math.Log(y)
	if x > 0.5 {
		lnx = math.Log1p(-y)
	}
	if y > 0.5 {
		lny = math.Log1p(-x)
	}
	if a < 10 || b < 10 {
		return a*lnx + b*lny - lnBeta(a, b)
	}
	// x^a y^b / B(a,b) via Stirling, with d = x·b − y·a measuring the
	// distance from the mode.
	d := x*b - y*a
	return a*math.Log1p(d/a) + b*math.Log1p(-d/b) + 0.5*math.Log(a*b/(a+b)) - 0.5*math.Log(2*math.Pi) -
		stirCorr(a) - stirCorr(b) + stirCorr(a+b)
}

// gammaPQ returns the regularized incomplete gamma functions
// P(a,x) = γ(a,x)/Γ(a) and Q(a,x) = 1 − P(a,x) for a > 0, x ≥ 0. The one
// that is computed directly is accurate even when it is tiny.
func gammaPQ(a, x float64) (p, q float64) {
	if x <= 0 {
		return 0, 1
	}
	if math.IsInf(x, 1) {
		return 1, 0
	}
	lnFront := lnGammaFront(a, x)
	if x < a+1 {
		// Series: γ(a,x) = e^{-x} x^a Σ x^n / (a(a+1)…(a+n)).
		term := 1 / a
		sum := term
		for n := 1; n < sdMaxIter; n++ {
			term *= x / (a + float64(n))
			sum += term
			if math.Abs(term) < math.Abs(sum)*sdEps {
				break
			}
		}
		p = sum * math.Exp(lnFront)
		if p > 1 {
			p = 1
		}
		return p, 1 - p
	}
	// Continued fraction for Γ(a,x) (modified Lentz).
	b := x + 1 - a
	c := 1 / sdTiny
	d := 1 / b
	h := d
	for i := 1; i < sdMaxIter; i++ {
		an := -float64(i) * (float64(i) - a)
		b += 2
		d = an*d + b
		if math.Abs(d) < sdTiny {
			d = sdTiny
		}
		c = b + an/c
		if math.Abs(c) < sdTiny {
			c = sdTiny
		}
		d = 1 / d
		del := d * c
		h *= del
		if math.Abs(del-1) < sdEps {
			break
		}
	}
	q = math.Exp(lnFront) * h
	if q > 1 {
		q = 1
	}
	return 1 - q, q
}

// betaCF evaluates the continued fraction of the incomplete beta function
// (Abramowitz & Stegun 26.5.8) by the modified Lentz method.
func betaCF(a, b, x float64) float64 {
	qab := a + b
	qap := a + 1
	qam := a - 1
	c := 1.0
	d := 1 - qab*x/qap
	if math.Abs(d) < sdTiny {
		d = sdTiny
	}
	d = 1 / d
	h := d
	for m := 1; m <= sdMaxIter; m++ {
		fm := float64(m)
		m2 := 2 * fm
		aa := fm * (b - fm) * x / ((qam + m2) * (a + m2))
		d = 1 + aa*d
		if math.Abs(d) < sdTiny {
			d = sdTiny
		}
		c = 1 + aa/c
		if math.Abs(c) < sdTiny {
			c = sdTiny
		}
		d = 1 / d
		h *= d * c
		aa = -(a + fm) * (qab + fm) * x / ((a + m2) * (qap + m2))
		d = 1 + aa*d
		if math.Abs(d) < sdTiny {
			d = sdTiny
		}
		c = 1 + aa/c
		if math.Abs(c) < sdTiny {
			c = sdTiny
		}
		d = 1 / d
		del := d * c
		h *= del
		if math.Abs(del-1) < sdEps {
			break
		}
	}
	return h
}

// betaInc2 returns I_x(a,b) and 1 − I_x(a,b), where y = 1 − x is passed
// separately so callers that know it exactly (t and F distributions) keep
// full precision near x = 1.
func betaInc2(x, y, a, b float64) (lower, upper float64) {
	if x <= 0 {
		return 0, 1
	}
	if y <= 0 {
		return 1, 0
	}
	lnFront := lnBetaFront(x, y, a, b)
	useLower := x < (a+1)/(a+b+2)
	if useLower && x > 0.5 && y < 3*(b+1)/(a+b+2) {
		// Near x = 1 the fraction in x depends on 1 − x, which x itself
		// carries only to about 1e-16/y relative precision. The fraction in
		// y still converges this close to its ideal range, and y is exact.
		useLower = false
	}
	if useLower {
		lower = math.Exp(lnFront) * betaCF(a, b, x) / a
		if lower > 1 {
			lower = 1
		}
		return lower, 1 - lower
	}
	upper = math.Exp(lnFront) * betaCF(b, a, y) / b
	if upper > 1 {
		upper = 1
	}
	return 1 - upper, upper
}

// betaInc is the regularized incomplete beta function I_x(a,b).
func betaInc(x, a, b float64) float64 {
	l, _ := betaInc2(x, 1-x, a, b)
	return l
}

// ---- distributions used by several functions --------------------------------

// tCDF2 returns P(T ≤ t) and P(T > t) for Student's t with df degrees of
// freedom (df > 0).
func tCDF2(t, df float64) (lower, upper float64) {
	if math.IsInf(t, 0) {
		if t > 0 {
			return 1, 0
		}
		return 0, 1
	}
	t2 := t * t
	// P(|T| > |t|) = I_{df/(df+t²)}(df/2, 1/2).
	x := df / (df + t2)
	y := t2 / (df + t2)
	tail, _ := betaInc2(x, y, df/2, 0.5)
	half := tail / 2
	if t > 0 {
		return 1 - half, half
	}
	return half, 1 - half
}

// tPDF is Student's t density.
func tPDF(t, df float64) float64 {
	return math.Exp(-lnBeta(df/2, 0.5) - 0.5*math.Log(df) - (df+1)/2*math.Log1p(t*t/df))
}

// chiCDF2 returns P(X ≤ x) and P(X > x) for the χ² distribution.
func chiCDF2(x, df float64) (lower, upper float64) {
	return gammaPQ(df/2, x/2)
}

// chiPDF is the χ² density.
func chiPDF(x, df float64) float64 {
	return gammaPDF(x, df/2, 2)
}

// gammaPDF is the gamma density with shape a and scale b.
func gammaPDF(x, a, b float64) float64 {
	if x < 0 {
		return 0
	}
	if x == 0 {
		switch {
		case a < 1:
			return math.Inf(1)
		case a == 1:
			return 1 / b
		default:
			return 0
		}
	}
	return math.Exp(lnGammaFront(a, x/b)) / x
}

// fCDF2 returns P(X ≤ x) and P(X > x) for the F distribution.
func fCDF2(x, d1, d2 float64) (lower, upper float64) {
	if x <= 0 {
		return 0, 1
	}
	u := d1 * x
	return betaInc2(u/(u+d2), d2/(u+d2), d1/2, d2/2)
}

// fPDF is the F density.
func fPDF(x, d1, d2 float64) float64 {
	if x < 0 {
		return 0
	}
	if x == 0 {
		switch {
		case d1 < 2:
			return math.Inf(1)
		case d1 == 2:
			return 1
		default:
			return 0
		}
	}
	u := d1 * x
	return math.Exp(lnBetaFront(u/(u+d2), d2/(u+d2), d1/2, d2/2)) / x
}

// betaPDF is the standard beta density on [0,1].
func betaPDF(x, a, b float64) float64 {
	if x < 0 || x > 1 {
		return 0
	}
	if x == 0 {
		switch {
		case a < 1:
			return math.Inf(1)
		case a == 1:
			return b
		default:
			return 0
		}
	}
	if x == 1 {
		switch {
		case b < 1:
			return math.Inf(1)
		case b == 1:
			return a
		default:
			return 0
		}
	}
	return math.Exp(lnBetaFront(x, 1-x, a, b)) / (x * (1 - x))
}

// ---- root finding -------------------------------------------------------------

// sdSolve finds x in [lo, hi] with f(x) = 0, given that f(lo) and f(hi)
// have opposite signs (or one of them is 0). It combines inverse quadratic
// interpolation and secant steps with bisection (Brent's method) and stops
// at full double precision. ok is false when the bracket is invalid.
func sdSolve(f func(float64) float64, lo, hi float64) (float64, bool) {
	a, b := lo, hi
	fa, fb := f(a), f(b)
	if fa == 0 {
		return a, true
	}
	if fb == 0 {
		return b, true
	}
	if math.IsNaN(fa) || math.IsNaN(fb) || (fa > 0) == (fb > 0) {
		return 0, false
	}
	if math.Abs(fa) < math.Abs(fb) {
		a, b, fa, fb = b, a, fb, fa
	}
	c, fc := a, fa
	mflag := true
	var d float64
	for i := 0; i < 500; i++ {
		if fb == 0 || math.Abs(b-a) <= 4e-16*math.Max(math.Abs(b), 1e-300) {
			return b, true
		}
		var s float64
		if fa != fc && fb != fc {
			s = a*fb*fc/((fa-fb)*(fa-fc)) + b*fa*fc/((fb-fa)*(fb-fc)) + c*fa*fb/((fc-fa)*(fc-fb))
		} else {
			s = b - fb*(b-a)/(fb-fa)
		}
		m := (3*a + b) / 4
		cond := (s-m)*(s-b) > 0 ||
			(mflag && math.Abs(s-b) >= math.Abs(b-c)/2) ||
			(!mflag && math.Abs(s-b) >= math.Abs(c-d)/2) ||
			(mflag && math.Abs(b-c) < 1e-300) ||
			(!mflag && math.Abs(c-d) < 1e-300)
		if cond {
			s = (a + b) / 2
			mflag = true
		} else {
			mflag = false
		}
		fs := f(s)
		d, c, fc = c, b, fb
		if (fa > 0) != (fs > 0) {
			b, fb = s, fs
		} else {
			a, fa = s, fs
		}
		if math.Abs(fa) < math.Abs(fb) {
			a, b, fa, fb = b, a, fb, fa
		}
	}
	return b, true
}

// sdInvert solves cdf(x) = p for an increasing cdf on [lo, ∞) (or on
// [lo, hi] when hi is finite), expanding the upper bracket as needed.
func sdInvert(cdf func(float64) float64, p, lo, hi, start float64) (float64, bool) {
	f := func(x float64) float64 { return cdf(x) - p }
	if math.IsInf(hi, 1) {
		h := math.Max(start, 1)
		for i := 0; i < 2000 && f(h) < 0; i++ {
			lo = h
			h *= 2
			if math.IsInf(h, 1) {
				return 0, false
			}
		}
		hi = h
	}
	return sdSolve(f, lo, hi)
}

// sdInvertDown solves sf(x) = p for a decreasing survival function on
// [lo, ∞) (or [lo, hi]).
func sdInvertDown(sf func(float64) float64, p, lo, hi, start float64) (float64, bool) {
	f := func(x float64) float64 { return p - sf(x) }
	if math.IsInf(hi, 1) {
		h := math.Max(start, 1)
		for i := 0; i < 2000 && f(h) < 0; i++ {
			lo = h
			h *= 2
			if math.IsInf(h, 1) {
				return 0, false
			}
		}
		hi = h
	}
	return sdSolve(f, lo, hi)
}
