package sheets

// formula_stat_dist.go — probability distributions (OnlyOffice parity
// milestone M3a): Student's t, χ², F, beta, gamma, lognormal, Weibull,
// exponential, Poisson, binomial, hypergeometric and negative binomial, in
// both their Excel 2010 names (T.DIST, CHISQ.INV.RT, …) and the legacy ones
// (TDIST, CHIINV, …), plus GAMMA, GAMMALN(.PRECISE), FISHER and FISHERINV.
//
// Arguments follow Excel's scalar rules (sdArgs): an error propagates, a
// multi-cell range or array contributes its first cell, an empty argument or
// empty cell is 0, a boolean is 0/1 and text must be numeric. Inside
// ARRAYFORMULA every function here maps over range arguments element-wise.

import (
	"math"
	"strconv"
	"strings"
)

func init() {
	reg := func(name string, min, max int, f func(a []float64) value) {
		registerFunc(name, func(c *callCtx) value { return sdCall(c, min, max, f) })
		arrayBroadcastFuncs[name] = true
	}

	// ---- Student's t ----
	reg("T.DIST", 3, 3, func(a []float64) value {
		x, df, cum := a[0], a[1], a[2] != 0
		if df < 1 {
			return errNum
		}
		if cum {
			l, _ := tCDF2(x, df)
			return sdNum(l)
		}
		return sdNum(tPDF(x, df))
	})
	reg("T.DIST.RT", 2, 2, func(a []float64) value {
		if a[1] < 1 {
			return errNum
		}
		_, u := tCDF2(a[0], a[1])
		return sdNum(u)
	})
	reg("T.DIST.2T", 2, 2, func(a []float64) value {
		if a[0] < 0 || a[1] < 1 {
			return errNum
		}
		_, u := tCDF2(a[0], a[1])
		return sdNum(2 * u)
	})
	reg("TDIST", 3, 3, func(a []float64) value {
		x, df, tails := a[0], math.Trunc(a[1]), math.Trunc(a[2])
		if x < 0 || df < 1 || (tails != 1 && tails != 2) {
			return errNum
		}
		_, u := tCDF2(x, df)
		return sdNum(tails * u)
	})
	reg("T.INV", 2, 2, func(a []float64) value {
		p, df := a[0], a[1]
		if p <= 0 || p >= 1 || df < 1 {
			return errNum
		}
		return sdTInv(p, df)
	})
	tinv2 := func(a []float64) value {
		p, df := a[0], a[1]
		if p <= 0 || p > 1 || df < 1 {
			return errNum
		}
		if p == 1 {
			return numVal(0)
		}
		x, ok := sdInvertDown(func(x float64) float64 { _, u := tCDF2(x, df); return u }, p/2, 0, math.Inf(1), 1)
		return sdInvResult(x, ok)
	}
	reg("T.INV.2T", 2, 2, tinv2)
	reg("TINV", 2, 2, func(a []float64) value { return tinv2([]float64{a[0], math.Trunc(a[1])}) })

	// ---- χ² ----
	reg("CHISQ.DIST", 3, 3, func(a []float64) value {
		x, df, cum := a[0], math.Trunc(a[1]), a[2] != 0
		if x < 0 || df < 1 || df > 1e10 {
			return errNum
		}
		if cum {
			l, _ := chiCDF2(x, df)
			return sdNum(l)
		}
		return sdNum(chiPDF(x, df))
	})
	chiRT := func(a []float64) value {
		x, df := a[0], math.Trunc(a[1])
		if x < 0 || df < 1 || df > 1e10 {
			return errNum
		}
		_, u := chiCDF2(x, df)
		return sdNum(u)
	}
	reg("CHISQ.DIST.RT", 2, 2, chiRT)
	reg("CHIDIST", 2, 2, chiRT)
	reg("CHISQ.INV", 2, 2, func(a []float64) value {
		p, df := a[0], math.Trunc(a[1])
		if p < 0 || p >= 1 || df < 1 || df > 1e10 {
			return errNum
		}
		return sdInvResult(sdInvert2(func(x float64) (float64, float64) { return chiCDF2(x, df) }, p, false, df))
	})
	chiInvRT := func(a []float64) value {
		p, df := a[0], math.Trunc(a[1])
		if p <= 0 || p > 1 || df < 1 || df > 1e10 {
			return errNum
		}
		return sdInvResult(sdInvert2(func(x float64) (float64, float64) { return chiCDF2(x, df) }, p, true, df))
	}
	reg("CHISQ.INV.RT", 2, 2, chiInvRT)
	reg("CHIINV", 2, 2, chiInvRT)

	// ---- F ----
	reg("F.DIST", 4, 4, func(a []float64) value {
		x, d1, d2, cum := a[0], math.Trunc(a[1]), math.Trunc(a[2]), a[3] != 0
		if x < 0 || d1 < 1 || d2 < 1 || d1 >= 1e10 || d2 >= 1e10 {
			return errNum
		}
		if cum {
			l, _ := fCDF2(x, d1, d2)
			return sdNum(l)
		}
		return sdNum(fPDF(x, d1, d2))
	})
	fRT := func(a []float64) value {
		x, d1, d2 := a[0], math.Trunc(a[1]), math.Trunc(a[2])
		if x < 0 || d1 < 1 || d2 < 1 || d1 >= 1e10 || d2 >= 1e10 {
			return errNum
		}
		_, u := fCDF2(x, d1, d2)
		return sdNum(u)
	}
	reg("F.DIST.RT", 3, 3, fRT)
	reg("FDIST", 3, 3, fRT)
	reg("F.INV", 3, 3, func(a []float64) value {
		p, d1, d2 := a[0], math.Trunc(a[1]), math.Trunc(a[2])
		if p < 0 || p > 1 || d1 < 1 || d2 < 1 || d1 >= 1e10 || d2 >= 1e10 {
			return errNum
		}
		if p == 1 {
			return errNum
		}
		return sdInvResult(sdInvert2(func(x float64) (float64, float64) { return fCDF2(x, d1, d2) }, p, false, 1))
	})
	fInvRT := func(a []float64) value {
		p, d1, d2 := a[0], math.Trunc(a[1]), math.Trunc(a[2])
		if p <= 0 || p > 1 || d1 < 1 || d2 < 1 || d1 >= 1e10 || d2 >= 1e10 {
			return errNum
		}
		return sdInvResult(sdInvert2(func(x float64) (float64, float64) { return fCDF2(x, d1, d2) }, p, true, 1))
	}
	reg("F.INV.RT", 3, 3, fInvRT)
	reg("FINV", 3, 3, fInvRT)

	// ---- beta ----
	reg("BETA.DIST", 4, 6, func(a []float64) value {
		x, al, be, cum := a[0], a[1], a[2], a[3] != 0
		lo, hi := sdOpt(a, 4, 0), sdOpt(a, 5, 1)
		if al <= 0 || be <= 0 || x < lo || x > hi || lo == hi {
			return errNum
		}
		z := (x - lo) / (hi - lo)
		if cum {
			return sdNum(betaInc(z, al, be))
		}
		return sdNum(betaPDF(z, al, be) / (hi - lo))
	})
	reg("BETADIST", 3, 5, func(a []float64) value {
		x, al, be := a[0], a[1], a[2]
		lo, hi := sdOpt(a, 3, 0), sdOpt(a, 4, 1)
		if al <= 0 || be <= 0 || x < lo || x > hi || lo == hi {
			return errNum
		}
		return sdNum(betaInc((x-lo)/(hi-lo), al, be))
	})
	betaInv := func(a []float64) value {
		p, al, be := a[0], a[1], a[2]
		lo, hi := sdOpt(a, 3, 0), sdOpt(a, 4, 1)
		if p <= 0 || p > 1 || al <= 0 || be <= 0 || lo >= hi {
			return errNum
		}
		z, ok := sdSolve(func(x float64) float64 { return betaInc(x, al, be) - p }, 0, 1)
		if !ok {
			return errNum
		}
		return sdNum(lo + z*(hi-lo))
	}
	reg("BETA.INV", 3, 5, betaInv)
	reg("BETAINV", 3, 5, betaInv)

	// ---- gamma ----
	gammaDist := func(a []float64) value {
		x, al, be, cum := a[0], a[1], a[2], a[3] != 0
		if x < 0 || al <= 0 || be <= 0 {
			return errNum
		}
		if cum {
			l, _ := gammaPQ(al, x/be)
			return sdNum(l)
		}
		return sdNum(gammaPDF(x, al, be))
	}
	reg("GAMMA.DIST", 4, 4, gammaDist)
	reg("GAMMADIST", 4, 4, gammaDist)
	gammaInv := func(a []float64) value {
		p, al, be := a[0], a[1], a[2]
		if p < 0 || p >= 1 || al <= 0 || be <= 0 {
			return errNum
		}
		if p == 0 {
			return numVal(0)
		}
		return sdInvResult(sdInvert2(func(x float64) (float64, float64) { return gammaPQ(al, x/be) }, p, false, al*be))
	}
	reg("GAMMA.INV", 3, 3, gammaInv)
	reg("GAMMAINV", 3, 3, gammaInv)
	reg("GAMMA", 1, 1, func(a []float64) value {
		x := a[0]
		if x <= 0 && x == math.Trunc(x) {
			return errNum
		}
		return sdNum(math.Gamma(x))
	})
	gammaLn := func(a []float64) value {
		if a[0] <= 0 {
			return errNum
		}
		return sdNum(lnGamma(a[0]))
	}
	reg("GAMMALN", 1, 1, gammaLn)
	reg("GAMMALN.PRECISE", 1, 1, gammaLn)

	// ---- lognormal ----
	reg("LOGNORM.DIST", 4, 4, func(a []float64) value {
		x, mu, sd, cum := a[0], a[1], a[2], a[3] != 0
		if x <= 0 || sd <= 0 {
			return errNum
		}
		z := (math.Log(x) - mu) / sd
		if cum {
			return sdNum(normCDF(z))
		}
		return sdNum(normPDF(z) / (x * sd))
	})
	reg("LOGNORMDIST", 3, 3, func(a []float64) value {
		x, mu, sd := a[0], a[1], a[2]
		if x <= 0 || sd <= 0 {
			return errNum
		}
		return sdNum(normCDF((math.Log(x) - mu) / sd))
	})
	logInv := func(a []float64) value {
		p, mu, sd := a[0], a[1], a[2]
		if p <= 0 || p >= 1 || sd <= 0 {
			return errNum
		}
		return sdNum(math.Exp(mu + sd*invNormCDF(p)))
	}
	reg("LOGNORM.INV", 3, 3, logInv)
	reg("LOGINV", 3, 3, logInv)

	// ---- Weibull / exponential ----
	weibull := func(a []float64) value {
		x, al, be, cum := a[0], a[1], a[2], a[3] != 0
		if x < 0 || al <= 0 || be <= 0 {
			return errNum
		}
		if cum {
			return sdNum(-math.Expm1(-math.Pow(x/be, al)))
		}
		return sdNum(al / math.Pow(be, al) * math.Pow(x, al-1) * math.Exp(-math.Pow(x/be, al)))
	}
	reg("WEIBULL", 4, 4, weibull)
	reg("WEIBULL.DIST", 4, 4, weibull)
	expon := func(a []float64) value {
		x, l, cum := a[0], a[1], a[2] != 0
		if x < 0 || l <= 0 {
			return errNum
		}
		if cum {
			return sdNum(-math.Expm1(-l * x))
		}
		return sdNum(l * math.Exp(-l*x))
	}
	reg("EXPON.DIST", 3, 3, expon)
	reg("EXPONDIST", 3, 3, expon)

	// ---- Poisson ----
	poisson := func(a []float64) value {
		k, mean, cum := math.Trunc(a[0]), a[1], a[2] != 0
		if k < 0 || mean < 0 {
			return errNum
		}
		if cum {
			if mean == 0 {
				return numVal(1)
			}
			_, q := gammaPQ(k+1, mean)
			return sdNum(q)
		}
		return sdNum(poissonPMF(k, mean))
	}
	reg("POISSON", 3, 3, poisson)
	reg("POISSON.DIST", 3, 3, poisson)

	// ---- binomial ----
	binom := func(a []float64) value {
		s, n, p, cum := math.Trunc(a[0]), math.Trunc(a[1]), a[2], a[3] != 0
		if s < 0 || n < 0 || s > n || p < 0 || p > 1 || n >= 1<<31 {
			return errNum
		}
		if cum {
			return sdNum(binomCDF(s, n, p))
		}
		return sdNum(binomPMF(s, n, p))
	}
	reg("BINOM.DIST", 4, 4, binom)
	reg("BINOMDIST", 4, 4, binom)
	reg("BINOM.DIST.RANGE", 3, 4, func(a []float64) value {
		n, p, s := math.Trunc(a[0]), a[1], math.Trunc(a[2])
		s2 := s
		if len(a) > 3 {
			s2 = math.Trunc(a[3])
		}
		if n < 0 || p < 0 || p > 1 || s < 0 || s > n || s2 < s || s2 > n {
			return errNum
		}
		if s2-s > 1030 {
			lower := 0.0
			if s > 0 {
				lower = binomCDF(s-1, n, p)
			}
			return sdNum(binomCDF(s2, n, p) - lower)
		}
		sum := 0.0
		for k := s; k <= s2; k++ {
			sum += binomPMF(k, n, p)
		}
		return sdNum(sum)
	})
	critBinom := func(a []float64) value {
		n, p, alpha := math.Trunc(a[0]), a[1], a[2]
		if n < 0 || p < 0 || p > 1 || alpha <= 0 || alpha >= 1 {
			return errNum
		}
		if n <= 1030 {
			sum := 0.0
			for k := 0.0; k <= n; k++ {
				sum += binomPMF(k, n, p)
				if sum >= alpha*(1-1e-15) {
					return numVal(k)
				}
			}
			return numVal(n)
		}
		// Smallest k with P(X ≤ k) ≥ alpha, by bisection on k.
		lo, hi := -1.0, n
		for hi-lo > 1 {
			mid := math.Floor((lo + hi) / 2)
			if binomCDF(mid, n, p) >= alpha*(1-1e-15) {
				hi = mid
			} else {
				lo = mid
			}
		}
		return numVal(hi)
	}
	reg("BINOM.INV", 3, 3, critBinom)
	reg("CRITBINOM", 3, 3, critBinom)

	// ---- hypergeometric ----
	hyp := func(a []float64, cum bool) value {
		s, n, m, N := math.Trunc(a[0]), math.Trunc(a[1]), math.Trunc(a[2]), math.Trunc(a[3])
		if s < 0 || n < 0 || m < 0 || N <= 0 || n > N || m > N {
			return errNum
		}
		if s > n || s > m {
			// Beyond the support: P(X = s) = 0 and P(X ≤ s) = 1.
			if cum {
				return numVal(1)
			}
			return numVal(0)
		}
		if pmf := hypPMF(s, n, m, N); !cum || math.IsNaN(pmf) {
			return sdNum(pmf)
		}
		sum := 0.0
		for k := math.Max(0, n-N+m); k <= s; k++ {
			sum += hypPMF(k, n, m, N)
		}
		return sdNum(math.Min(sum, 1))
	}
	reg("HYPGEOM.DIST", 5, 5, func(a []float64) value { return hyp(a, a[4] != 0) })
	reg("HYPGEOMDIST", 4, 4, func(a []float64) value { return hyp(a, false) })

	// ---- negative binomial ----
	negbin := func(a []float64, cum bool) value {
		f, s, p := math.Trunc(a[0]), math.Trunc(a[1]), a[2]
		if f < 0 || s < 1 || p < 0 || p > 1 {
			return errNum
		}
		if cum {
			return sdNum(betaInc(p, s, f+1))
		}
		return sdNum(math.Exp(lnChoose(f+s-1, s-1)) * math.Pow(p, s) * math.Pow(1-p, f))
	}
	reg("NEGBINOM.DIST", 4, 4, func(a []float64) value { return negbin(a, a[3] != 0) })
	reg("NEGBINOMDIST", 3, 3, func(a []float64) value { return negbin(a, false) })

	// ---- Fisher ----
	reg("FISHER", 1, 1, func(a []float64) value {
		if a[0] <= -1 || a[0] >= 1 {
			return errNum
		}
		return sdNum(math.Atanh(a[0]))
	})
	reg("FISHERINV", 1, 1, func(a []float64) value { return sdNum(math.Tanh(a[0])) })
}

// sdCall reads between min and max scalar arguments and applies f.
func sdCall(c *callCtx, min, max int, f func(a []float64) value) value {
	n := c.nargs()
	if n < min || n > max {
		return errNA
	}
	a := make([]float64, n)
	for i := 0; i < n; i++ {
		x, e, ok := sdArg(c, i)
		if !ok {
			return e
		}
		a[i] = x
	}
	return f(a)
}

// sdArg reads argument i as a number under Excel's scalar-argument rules.
func sdArg(c *callCtx, i int) (float64, value, bool) {
	var v value
	switch r := c.raw(i).(type) {
	case rangeVal:
		if r.rows == 0 || r.cols == 0 {
			return 0, errValue, false
		}
		v = r.cells[0][0]
	case value:
		v = r.topLeft()
	default:
		return 0, errNA, false
	}
	switch {
	case v.isErr():
		return 0, v, false
	case v.kind == kindNum, v.kind == kindBool:
		return v.num, value{}, true
	case v.kind == kindStr:
		t := strings.TrimSpace(v.str)
		switch strings.ToUpper(t) {
		case "TRUE":
			return 1, value{}, true
		case "FALSE":
			return 0, value{}, true
		}
		if strings.HasSuffix(t, "%") {
			if x, err := strconv.ParseFloat(strings.TrimSpace(t[:len(t)-1]), 64); err == nil {
				return x / 100, value{}, true
			}
		}
		return mthNum(v)
	}
	return 0, errValue, false
}

// sdOpt returns optional argument i, or def when it was not supplied.
func sdOpt(a []float64, i int, def float64) float64 {
	if i < len(a) {
		return a[i]
	}
	return def
}

// sdNum wraps a numeric result, turning NaN and infinities into #NUM!.
func sdNum(x float64) value {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return errNum
	}
	return numVal(x)
}

func sdInvResult(x float64, ok bool) value {
	if !ok {
		return errNum
	}
	return sdNum(x)
}

// sdTInv is the inverse of Student's t CDF for p in (0,1).
func sdTInv(p, df float64) value {
	if p == 0.5 {
		return numVal(0)
	}
	q := p
	if p > 0.5 {
		q = 1 - p
	}
	// Solve P(T > x) = q for x > 0; the lower half follows by symmetry.
	x, ok := sdInvertDown(func(x float64) float64 { _, u := tCDF2(x, df); return u }, q, 0, math.Inf(1), 1)
	if !ok {
		return errNum
	}
	if p < 0.5 {
		x = -x
	}
	return sdNum(x)
}

// sdInvert2 solves for x on [0, ∞) where the lower tail P(X ≤ x) equals p
// (or, with upper set, where the upper tail P(X > x) equals p); cdf2
// returns both tails. It always solves the smaller tail, so probabilities
// near 1 keep full precision.
func sdInvert2(cdf2 func(float64) (float64, float64), p float64, upper bool, start float64) (float64, bool) {
	if p > 0.5 {
		p, upper = 1-p, !upper
	}
	if upper {
		return sdInvertDown(func(x float64) float64 { _, u := cdf2(x); return u }, p, 0, math.Inf(1), start)
	}
	return sdInvert(func(x float64) float64 { l, _ := cdf2(x); return l }, p, 0, math.Inf(1), start)
}

// lnChoose is ln C(n,k).
func lnChoose(n, k float64) float64 {
	return lnGamma(n+1) - lnGamma(k+1) - lnGamma(n-k+1)
}

// binomPMF is P(X = k) for X ~ Binomial(n, p).
func binomPMF(k, n, p float64) float64 {
	switch {
	case p == 0:
		if k == 0 {
			return 1
		}
		return 0
	case p == 1:
		if k == n {
			return 1
		}
		return 0
	}
	if n <= 1030 {
		// Exact binomial coefficient while it stays finite.
		c := 1.0
		kk := math.Min(k, n-k)
		for i := 1.0; i <= kk; i++ {
			c = c * (n - kk + i) / i
		}
		return c * math.Pow(p, k) * math.Pow(1-p, n-k)
	}
	return math.Exp(lnChoose(n, k) + k*math.Log(p) + (n-k)*math.Log1p(-p))
}

// binomCDF is P(X ≤ k) for X ~ Binomial(n, p).
func binomCDF(k, n, p float64) float64 {
	if k >= n {
		return 1
	}
	if n <= 1030 {
		sum := 0.0
		for i := 0.0; i <= k; i++ {
			sum += binomPMF(i, n, p)
		}
		return math.Min(sum, 1)
	}
	// P(X ≤ k) = I_{1−p}(n−k, k+1).
	l, _ := betaInc2(1-p, p, n-k, k+1)
	return l
}

// poissonPMF is P(X = k) for X ~ Poisson(mean).
func poissonPMF(k, mean float64) float64 {
	if mean == 0 {
		if k == 0 {
			return 1
		}
		return 0
	}
	return math.Exp(k*math.Log(mean) - mean - lnGamma(k+1))
}

// hypPMF is P(X = s) for a hypergeometric draw of n from N with m successes.
func hypPMF(s, n, m, N float64) float64 {
	if s < 0 || s > n || s > m || n-s > N-m {
		return 0
	}
	return math.Exp(lnChoose(m, s) + lnChoose(N-m, n-s) - lnChoose(N, n))
}

// Argument rules for the older scalar statistical functions (NORM family,
// GAUSS, PHI, STANDARDIZE, CONFIDENCE): errors propagate, a range or array
// contributes its first cell, numeric and date text is read as a number,
// and a cumulative flag accepts only a number, a boolean or the text
// TRUE/FALSE.
func init() {
	for name, flag := range map[string]int{
		"NORM.DIST": 3, "NORMDIST": 3, "NORM.S.DIST": 1, "NORMSDIST": -1,
		"NORM.INV": -1, "NORMINV": -1, "NORM.S.INV": -1, "NORMSINV": -1,
		"GAUSS": -1, "PHI": -1, "STANDARDIZE": -1,
		"CONFIDENCE": -1, "CONFIDENCE.NORM": -1,
	} {
		sdGuard(name, flag)
	}
}

func sdGuard(name string, flag int) {
	f, ok := funcTable[name]
	if !ok {
		panic("formula_stat_dist.go: " + name + " is not registered yet")
	}
	funcTable[name] = func(c *callCtx) value {
		args := make([]interface{}, len(c.args))
		for i := range c.args {
			var v value
			switch r := c.args[i].(type) {
			case rangeVal:
				if r.rows == 0 || r.cols == 0 {
					return errValue
				}
				v = r.cells[0][0]
			case value:
				v = r.topLeft()
			}
			switch {
			case v.isErr():
				return v
			case isOmitted(v):
			case i == flag && v.kind == kindStr:
				switch strings.ToUpper(strings.TrimSpace(v.str)) {
				case "TRUE":
					v = boolVal(true)
				case "FALSE":
					v = boolVal(false)
				default:
					return errValue
				}
			case v.kind == kindStr:
				x, e, ok := sdArg(&callCtx{args: []interface{}{v}}, 0)
				if !ok {
					return e
				}
				v = numVal(x)
			}
			args[i] = v
		}
		return f(&callCtx{p: c.p, ev: c.ev, args: args})
	}
}
