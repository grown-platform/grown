// Package sheets — additional Excel/Google-Sheets worksheet functions.
//
// This file fills gaps in the standard library that the other formula_*.go
// files do not yet cover, following the same conventions: functions are
// registered via registerFunc in an init(), receive a *callCtx, and return a
// value (scalar or, for the array-producing functions, an arrayValue that
// spills). Error semantics match Excel (#VALUE!/#NUM!/#N/A/#DIV/0!).
//
// Added here:
//   - statistics: QUARTILE.EXC, PERCENTRANK.INC/.EXC, SKEW, SKEW.P, KURT,
//     NORM.DIST, NORM.S.DIST, NORM.INV, NORM.S.INV, GAUSS, PHI,
//     CONFIDENCE.NORM, MODE.MULT, FREQUENCY
//   - math/matrix: SUMXMY2, SUMX2MY2, SUMX2PY2, MMULT, MDETERM, MINVERSE
//   - date: WORKDAY.INTL, NETWORKDAYS.INTL
//   - text/info: VALUETOTEXT
package sheets

import (
	"math"
	"sort"
	"time"
)

func init() {
	// Statistics.
	registerFunc("QUARTILE.EXC", func(c *callCtx) value { return sttQuartile(c, false) })
	registerFunc("PERCENTRANK.INC", sttPercentrank)
	registerFunc("PERCENTRANK.EXC", sttPercentrankExc)
	registerFunc("SKEW", func(c *callCtx) value { return sttSkew(c, false) })
	registerFunc("SKEW.P", func(c *callCtx) value { return sttSkew(c, true) })
	registerFunc("KURT", sttKurt)
	registerFunc("NORM.DIST", sttNormDist)
	registerFunc("NORMDIST", sttNormDist)
	registerFunc("NORM.S.DIST", sttNormSDist)
	registerFunc("NORMSDIST", sttNormSDist)
	registerFunc("NORM.INV", sttNormInv)
	registerFunc("NORMINV", sttNormInv)
	registerFunc("NORM.S.INV", sttNormSInv)
	registerFunc("NORMSINV", sttNormSInv)
	registerFunc("GAUSS", sttGauss)
	registerFunc("PHI", sttPhi)
	registerFunc("CONFIDENCE.NORM", sttConfidenceNorm)
	registerFunc("CONFIDENCE", sttConfidenceNorm)
	registerFunc("MODE.MULT", sttModeMult)
	registerFunc("FREQUENCY", sttFrequency)

	// Math / matrix.
	registerFunc("SUMXMY2", func(c *callCtx) value { return mthSumPairs(c, 0) })
	registerFunc("SUMX2MY2", func(c *callCtx) value { return mthSumPairs(c, 1) })
	registerFunc("SUMX2PY2", func(c *callCtx) value { return mthSumPairs(c, 2) })
	registerFunc("MMULT", mthMMult)
	registerFunc("MDETERM", mthMDeterm)
	registerFunc("MINVERSE", mthMInverse)

	// Date.
	registerFunc("WORKDAY.INTL", dtWorkdayIntl)
	registerFunc("NETWORKDAYS.INTL", dtNetworkdaysIntl)

	// Text / info.
	registerFunc("VALUETOTEXT", txtValueToText)
}

// ---- normal-distribution helpers -------------------------------------------

// normPDF is the standard normal probability density φ(z).
func normPDF(z float64) float64 { return math.Exp(-z*z/2) / math.Sqrt(2*math.Pi) }

// normCDF is the standard normal cumulative distribution Φ(z).
func normCDF(z float64) float64 { return 0.5 * math.Erfc(-z/math.Sqrt2) }

// invNormCDF returns the inverse standard normal CDF for p in (0,1) using
// Acklam's rational approximation refined by one Halley step (~1e-15 accuracy).
func invNormCDF(p float64) float64 {
	if p > 0.5 {
		// Work in the lower tail, where Φ is computed without cancellation
		// (1−p is exact here), so p close to 1 keeps full precision.
		return -invNormCDF(1 - p)
	}
	a := [6]float64{-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00}
	b := [5]float64{-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01}
	cc := [6]float64{-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00}
	d := [4]float64{7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00}
	const plow = 0.02425
	const phigh = 1 - plow
	var x float64
	switch {
	case p < plow:
		q := math.Sqrt(-2 * math.Log(p))
		x = (((((cc[0]*q+cc[1])*q+cc[2])*q+cc[3])*q+cc[4])*q + cc[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1)
	case p <= phigh:
		q := p - 0.5
		r := q * q
		x = (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r + a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r + 1)
	default:
		q := math.Sqrt(-2 * math.Log(1-p))
		x = -(((((cc[0]*q+cc[1])*q+cc[2])*q+cc[3])*q+cc[4])*q + cc[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1)
	}
	// One Halley refinement.
	e := normCDF(x) - p
	u := e * math.Sqrt(2*math.Pi) * math.Exp(x*x/2)
	x = x - u/(1+x*u/2)
	return x
}

func sttNormDist(c *callCtx) value {
	if c.nargs() < 4 {
		return errNA
	}
	x, ok1 := c.num(0)
	mean, ok2 := c.num(1)
	sd, ok3 := c.num(2)
	if !ok1 || !ok2 || !ok3 {
		return errValue
	}
	if sd <= 0 {
		return errNum
	}
	cum := c.scalar(3).isTruthy()
	z := (x - mean) / sd
	if cum {
		return numVal(normCDF(z))
	}
	return numVal(normPDF(z) / sd)
}

func sttNormSDist(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	z, ok := c.num(0)
	if !ok {
		return errValue
	}
	cum := true
	if c.nargs() >= 2 {
		cum = c.scalar(1).isTruthy()
	}
	if cum {
		return numVal(normCDF(z))
	}
	return numVal(normPDF(z))
}

func sttNormInv(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	p, ok1 := c.num(0)
	mean, ok2 := c.num(1)
	sd, ok3 := c.num(2)
	if !ok1 || !ok2 || !ok3 {
		return errValue
	}
	if p <= 0 || p >= 1 {
		return errNum
	}
	if sd <= 0 {
		return errNum
	}
	return numVal(mean + sd*invNormCDF(p))
}

func sttNormSInv(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	p, ok := c.num(0)
	if !ok {
		return errValue
	}
	if p <= 0 || p >= 1 {
		return errNum
	}
	return numVal(invNormCDF(p))
}

func sttGauss(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	z, ok := c.num(0)
	if !ok {
		return errValue
	}
	return numVal(normCDF(z) - 0.5)
}

func sttPhi(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	x, ok := c.num(0)
	if !ok {
		return errValue
	}
	return numVal(normPDF(x))
}

func sttConfidenceNorm(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	alpha, ok1 := c.num(0)
	sd, ok2 := c.num(1)
	nf, ok3 := c.num(2)
	if !ok1 || !ok2 || !ok3 {
		return errValue
	}
	if alpha <= 0 || alpha >= 1 {
		return errNum
	}
	if sd <= 0 {
		return errNum
	}
	n := math.Trunc(nf)
	if n < 1 {
		return errNum
	}
	return numVal(invNormCDF(1-alpha/2) * sd / math.Sqrt(n))
}

// ---- SKEW / SKEW.P / KURT ---------------------------------------------------

// sttSkew computes sample skewness (pop=false) or population skewness (pop=true).
func sttSkew(c *callCtx, pop bool) value {
	nums, err := sttNums(sttFlat(c, false))
	if err != nil {
		return *err
	}
	n := len(nums)
	if pop {
		if n < 1 {
			return errDiv0
		}
	} else if n < 3 {
		return errDiv0
	}
	mean := sttMean(nums)
	var ss float64
	for _, x := range nums {
		d := x - mean
		ss += d * d
	}
	if pop {
		sigma := math.Sqrt(ss / float64(n))
		if sigma == 0 {
			return errDiv0
		}
		var s3 float64
		for _, x := range nums {
			z := (x - mean) / sigma
			s3 += z * z * z
		}
		return numVal(s3 / float64(n))
	}
	sd := math.Sqrt(ss / float64(n-1))
	if sd == 0 {
		return errDiv0
	}
	var s3 float64
	for _, x := range nums {
		z := (x - mean) / sd
		s3 += z * z * z
	}
	nn := float64(n)
	return numVal(nn / ((nn - 1) * (nn - 2)) * s3)
}

// sttKurt computes the sample excess kurtosis (Excel KURT).
func sttKurt(c *callCtx) value {
	nums, err := sttNums(sttFlat(c, false))
	if err != nil {
		return *err
	}
	n := len(nums)
	if n < 4 {
		return errDiv0
	}
	mean := sttMean(nums)
	var ss float64
	for _, x := range nums {
		d := x - mean
		ss += d * d
	}
	sd := math.Sqrt(ss / float64(n-1))
	if sd == 0 {
		return errDiv0
	}
	var s4 float64
	for _, x := range nums {
		z := (x - mean) / sd
		s4 += z * z * z * z
	}
	nn := float64(n)
	term1 := nn * (nn + 1) / ((nn - 1) * (nn - 2) * (nn - 3)) * s4
	term2 := 3 * (nn - 1) * (nn - 1) / ((nn - 2) * (nn - 3))
	return numVal(term1 - term2)
}

// ---- PERCENTRANK.EXC --------------------------------------------------------

func sttPercentrankExc(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	nums, err := sttNumsArg(c, 0)
	if err != nil {
		return *err
	}
	x, ev, ok := sdArg(c, 1)
	if !ok {
		return ev
	}
	n := len(nums)
	if n == 0 {
		return errNA
	}
	sort.Float64s(nums)
	if x < nums[0] || x > nums[n-1] {
		return errNA
	}
	sig := 3
	if c.nargs() >= 3 {
		s, ev, ok2 := sdArg(c, 2)
		if !ok2 {
			return ev
		}
		sig = int(math.Trunc(s))
		if sig < 1 {
			return errNum
		}
	}
	rank, ok3 := sttPercentRankExcOf(nums, x)
	if !ok3 {
		return errNA
	}
	factor := math.Pow(10, float64(sig))
	rank = math.Trunc(rank*factor) / factor
	return numVal(rank)
}

// sttPercentRankExcOf returns the exclusive relative rank of x within sorted
// nums: a value at 1-based position i has rank i/(n+1), interpolating between
// bracketing values. ok is false when x lies outside the data range.
func sttPercentRankExcOf(sorted []float64, x float64) (float64, bool) {
	n := len(sorted)
	if x < sorted[0] || x > sorted[n-1] {
		return 0, false
	}
	for i := 0; i < n; i++ {
		if sorted[i] == x {
			return float64(i+1) / float64(n+1), true
		}
		if sorted[i] > x {
			lo := sorted[i-1]
			hi := sorted[i]
			base := float64(i) / float64(n+1)
			step := (1.0 / float64(n+1)) * (x - lo) / (hi - lo)
			return base + step, true
		}
	}
	return float64(n) / float64(n+1), true
}

// ---- MODE.MULT / FREQUENCY --------------------------------------------------

// sttModeMult returns every value tied for the highest frequency (>1) as a
// vertical spilling array, ordered by first appearance.
func sttModeMult(c *callCtx) value {
	nums, err := sttNums(sttFlat(c, false))
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errNA
	}
	counts := make(map[float64]int)
	for _, x := range nums {
		counts[x]++
	}
	best := 0
	for _, ct := range counts {
		if ct > best {
			best = ct
		}
	}
	if best < 2 {
		return errNA
	}
	var cells [][]value
	seen := make(map[float64]bool)
	for _, x := range nums {
		if seen[x] {
			continue
		}
		seen[x] = true
		if counts[x] == best {
			cells = append(cells, []value{numVal(x)})
		}
	}
	return arrayValue(cells)
}

// sttFrequency counts how many data values fall into each bin, returning a
// vertical array of len(bins)+1 counts (the last is the overflow above the
// top bin). Bins are sorted ascending; each value lands in the first bin it
// does not exceed.
func sttFrequency(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	var data []float64
	if v, ok := c.raw(0).(value); ok && v.kind == kindStr && v.ref == nil {
		// Typed text: a number if it reads as one, otherwise no data.
		if x, _, ok := mthNum(v); ok {
			data = []float64{x}
		}
	} else {
		var err *value
		if data, err = sttNumsArg(c, 0); err != nil {
			return *err
		}
	}
	var bins []float64
	if v, ok := c.raw(1).(value); ok && v.kind != kindArray && v.ref == nil {
		// A single typed bin: non-numeric text or a boolean acts as 0.
		if v.isErr() {
			return v
		}
		x, _, ok := mthNum(v)
		if !ok || v.kind == kindBool {
			x = 0
		}
		bins = []float64{x}
	} else {
		binsRV, ok := c.rangeArg(1)
		if !ok {
			return errNA
		}
		for _, v := range binsRV.flat() {
			if v.isErr() {
				return v
			}
			if v.kind == kindNum && !v.blank {
				bins = append(bins, v.num)
			}
		}
	}
	sort.Float64s(bins)
	counts := make([]int, len(bins)+1)
	for _, x := range data {
		placed := false
		for i, b := range bins {
			if x <= b {
				counts[i]++
				placed = true
				break
			}
		}
		if !placed {
			counts[len(bins)]++
		}
	}
	cells := make([][]value, len(counts))
	for i, ct := range counts {
		cells[i] = []value{numVal(float64(ct))}
	}
	return arrayValue(cells)
}

// ---- SUMXMY2 / SUMX2MY2 / SUMX2PY2 ------------------------------------------

// mthSumPairs walks aligned numeric pairs from two ranges. mode selects the
// accumulation: 0 → Σ(x−y)², 1 → Σ(x²−y²), 2 → Σ(x²+y²).
func mthSumPairs(c *callCtx, mode int) value {
	a, oka := c.rangeArg(0)
	b, okb := c.rangeArg(1)
	if !oka || !okb {
		return errNA
	}
	fa := a.flat()
	fb := b.flat()
	if len(fa) != len(fb) {
		return errNA
	}
	sum := 0.0
	for i := range fa {
		if fa[i].isErr() {
			return fa[i]
		}
		if fb[i].isErr() {
			return fb[i]
		}
		if fa[i].kind != kindNum || fb[i].kind != kindNum {
			continue
		}
		x, y := fa[i].num, fb[i].num
		switch mode {
		case 0:
			d := x - y
			sum += d * d
		case 1:
			sum += x*x - y*y
		case 2:
			sum += x*x + y*y
		}
	}
	return numVal(sum)
}

// ---- matrix helpers + MMULT / MDETERM / MINVERSE ----------------------------

// matFromRange extracts a numeric matrix from a range, failing if any cell is
// an error or non-numeric.
func matFromRange(rv rangeVal) ([][]float64, bool) {
	m := make([][]float64, rv.rows)
	for r := 0; r < rv.rows; r++ {
		m[r] = make([]float64, rv.cols)
		for cc := 0; cc < rv.cols; cc++ {
			v := rv.cells[r][cc]
			if v.isErr() {
				return nil, false
			}
			n, ok := v.toNum()
			if !ok {
				return nil, false
			}
			m[r][cc] = n
		}
	}
	return m, true
}

// floatMatToArray wraps a float matrix as a spilling array value.
func floatMatToArray(m [][]float64) value {
	cells := make([][]value, len(m))
	for r := range m {
		cells[r] = make([]value, len(m[r]))
		for cc := range m[r] {
			cells[r][cc] = numVal(m[r][cc])
		}
	}
	return arrayValue(cells)
}

// matDeterminant computes a square matrix determinant via Gaussian elimination
// with partial pivoting.
func matDeterminant(src [][]float64) float64 {
	n := len(src)
	a := make([][]float64, n)
	for i := range src {
		a[i] = append([]float64(nil), src[i]...)
	}
	det := 1.0
	for col := 0; col < n; col++ {
		piv := col
		for r := col + 1; r < n; r++ {
			if math.Abs(a[r][col]) > math.Abs(a[piv][col]) {
				piv = r
			}
		}
		if a[piv][col] == 0 {
			return 0
		}
		if piv != col {
			a[col], a[piv] = a[piv], a[col]
			det = -det
		}
		det *= a[col][col]
		for r := col + 1; r < n; r++ {
			f := a[r][col] / a[col][col]
			for cc := col; cc < n; cc++ {
				a[r][cc] -= f * a[col][cc]
			}
		}
	}
	return det
}

// matInverse computes a square matrix inverse via Gauss-Jordan elimination.
// ok is false when the matrix is singular.
func matInverse(src [][]float64) ([][]float64, bool) {
	n := len(src)
	a := make([][]float64, n)
	inv := make([][]float64, n)
	for i := 0; i < n; i++ {
		a[i] = append([]float64(nil), src[i]...)
		inv[i] = make([]float64, n)
		inv[i][i] = 1
	}
	for col := 0; col < n; col++ {
		piv := col
		for r := col + 1; r < n; r++ {
			if math.Abs(a[r][col]) > math.Abs(a[piv][col]) {
				piv = r
			}
		}
		if a[piv][col] == 0 {
			return nil, false
		}
		a[col], a[piv] = a[piv], a[col]
		inv[col], inv[piv] = inv[piv], inv[col]
		pv := a[col][col]
		for cc := 0; cc < n; cc++ {
			a[col][cc] /= pv
			inv[col][cc] /= pv
		}
		for r := 0; r < n; r++ {
			if r == col {
				continue
			}
			f := a[r][col]
			for cc := 0; cc < n; cc++ {
				a[r][cc] -= f * a[col][cc]
				inv[r][cc] -= f * inv[col][cc]
			}
		}
	}
	return inv, true
}

func mthMMult(c *callCtx) value {
	a, oka := c.rangeArg(0)
	b, okb := c.rangeArg(1)
	if !oka || !okb {
		return errNA
	}
	if a.cols != b.rows {
		return errValue
	}
	am, ok1 := matFromRange(a)
	bm, ok2 := matFromRange(b)
	if !ok1 || !ok2 {
		return errValue
	}
	res := make([][]float64, a.rows)
	for i := 0; i < a.rows; i++ {
		res[i] = make([]float64, b.cols)
		for j := 0; j < b.cols; j++ {
			s := 0.0
			for k := 0; k < a.cols; k++ {
				s += am[i][k] * bm[k][j]
			}
			res[i][j] = s
		}
	}
	return floatMatToArray(res)
}

func mthMDeterm(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	if rv.rows != rv.cols || rv.rows == 0 {
		return errValue
	}
	m, ok2 := matFromRange(rv)
	if !ok2 {
		return errValue
	}
	return numVal(matDeterminant(m))
}

func mthMInverse(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	if rv.rows != rv.cols || rv.rows == 0 {
		return errValue
	}
	m, ok2 := matFromRange(rv)
	if !ok2 {
		return errValue
	}
	inv, ok3 := matInverse(m)
	if !ok3 {
		return errNum // singular matrix
	}
	return floatMatToArray(inv)
}

// ---- WORKDAY.INTL / NETWORKDAYS.INTL ----------------------------------------

// weekendMask decodes the WORKDAY.INTL/NETWORKDAYS.INTL weekend argument into a
// [7]bool indexed by Go's time.Weekday (Sunday=0 … Saturday=6); true marks a
// non-working day. The argument is either a numeric code (1–7, 11–17) or a
// 7-character "0000011" string (positions Monday…Sunday).
func weekendMask(v value) ([7]bool, bool) {
	var m [7]bool
	if v.kind == kindStr {
		s := v.str
		if len(s) != 7 {
			return m, false
		}
		order := [7]time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday, time.Saturday, time.Sunday}
		for i := 0; i < 7; i++ {
			switch s[i] {
			case '1':
				m[int(order[i])] = true
			case '0':
				// working day
			default:
				return [7]bool{}, false
			}
		}
		return m, true
	}
	code, ok := v.toNum()
	if !ok {
		return m, false
	}
	switch int(code) {
	case 1:
		m[int(time.Saturday)], m[int(time.Sunday)] = true, true
	case 2:
		m[int(time.Sunday)], m[int(time.Monday)] = true, true
	case 3:
		m[int(time.Monday)], m[int(time.Tuesday)] = true, true
	case 4:
		m[int(time.Tuesday)], m[int(time.Wednesday)] = true, true
	case 5:
		m[int(time.Wednesday)], m[int(time.Thursday)] = true, true
	case 6:
		m[int(time.Thursday)], m[int(time.Friday)] = true, true
	case 7:
		m[int(time.Friday)], m[int(time.Saturday)] = true, true
	case 11:
		m[int(time.Sunday)] = true
	case 12:
		m[int(time.Monday)] = true
	case 13:
		m[int(time.Tuesday)] = true
	case 14:
		m[int(time.Wednesday)] = true
	case 15:
		m[int(time.Thursday)] = true
	case 16:
		m[int(time.Friday)] = true
	case 17:
		m[int(time.Saturday)] = true
	default:
		return m, false
	}
	return m, true
}

// weekendMaskArg reads the optional weekend argument at index i, defaulting to
// Saturday/Sunday. On error it returns the propagated error value with ok=false.
func weekendMaskArg(c *callCtx, i int) (mask [7]bool, errv value, ok bool) {
	mask[int(time.Saturday)] = true
	mask[int(time.Sunday)] = true
	if c.nargs() <= i {
		return mask, value{}, true
	}
	v := c.scalar(i)
	if v.isErr() {
		return mask, v, false
	}
	m, good := weekendMask(v)
	if !good {
		return mask, errValue, false
	}
	return m, value{}, true
}

// maskAllTrue reports whether every day is a weekend (an invalid pattern that
// would leave WORKDAY.INTL with no working day to advance to).
func maskAllTrue(m [7]bool) bool {
	for _, b := range m {
		if !b {
			return false
		}
	}
	return true
}

func dtNetworkdaysIntl(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	endSerial, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return e2
	}
	mask, me, mok := weekendMaskArg(c, 2)
	if !mok {
		return me
	}
	holidays, he, hok := dtHolidaySet(c, 3)
	if !hok {
		return he
	}
	s := int64(math.Floor(startSerial))
	e := int64(math.Floor(endSerial))
	sign := 1
	if s > e {
		s, e = e, s
		sign = -1
	}
	count := 0
	for d := s; d <= e; d++ {
		t := serialToTime(float64(d))
		if mask[int(t.Weekday())] {
			continue
		}
		if _, isHol := holidays[d]; isHol {
			continue
		}
		count++
	}
	return numVal(float64(sign * count))
}

func dtWorkdayIntl(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	dv := c.scalar(1)
	if dv.isErr() {
		return dv
	}
	df, dok := dv.toNum()
	if !dok {
		return errValue
	}
	mask, me, mok := weekendMaskArg(c, 2)
	if !mok {
		return me
	}
	if maskAllTrue(mask) {
		return errValue
	}
	holidays, he, hok := dtHolidaySet(c, 3)
	if !hok {
		return he
	}
	days := int(math.Trunc(df))
	cur := int64(math.Floor(startSerial))
	if days == 0 {
		return numVal(float64(cur))
	}
	step := int64(1)
	remaining := days
	if days < 0 {
		step = -1
		remaining = -days
	}
	for remaining > 0 {
		cur += step
		t := serialToTime(float64(cur))
		if mask[int(t.Weekday())] {
			continue
		}
		if _, isHol := holidays[cur]; isHol {
			continue
		}
		remaining--
	}
	if cur < 0 {
		return errNum
	}
	return numVal(float64(cur))
}

// ---- VALUETOTEXT ------------------------------------------------------------

// txtValueToText renders a value as text. Format 0 (concise, default) returns
// the plain display text; format 1 (strict) wraps text values in double quotes.
func txtValueToText(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	v := c.scalar(0)
	strict := false
	if c.nargs() >= 2 {
		f, _ := c.num(1)
		strict = int(f) == 1
	}
	if v.isErr() {
		return strVal(v.str)
	}
	if strict && v.kind == kindStr {
		return strVal("\"" + v.str + "\"")
	}
	return strVal(v.toStr())
}
