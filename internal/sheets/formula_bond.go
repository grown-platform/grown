package sheets

import "math"

// formula_bond.go — Excel's coupon-bond and discounted-security functions
// (OnlyOffice parity milestone M4):
//
//	COUPDAYBS COUPDAYS COUPDAYSNC COUPNCD COUPNUM COUPPCD
//	PRICE YIELD PRICEDISC YIELDDISC PRICEMAT YIELDMAT ACCRINT ACCRINTM
//	ODDFPRICE ODDFYIELD ODDLPRICE ODDLYIELD
//
// Prices are per 100 face value. Each is the present value of the remaining
// cash flows (coupons of 100·rate/frequency and the redemption) discounted at
// yld/frequency per coupon period, less the interest accrued since the last
// coupon; fractions of a period are measured in basis days (formula_daycount.go).
// YIELD, ODDFYIELD solve price(yld) = pr numerically.

func init() {
	registerFunc("COUPDAYBS", func(c *callCtx) value { return bondCoup(c, dcCoupDayBS) })
	registerFunc("COUPDAYS", func(c *callCtx) value { return bondCoup(c, dcCoupDays) })
	registerFunc("COUPDAYSNC", func(c *callCtx) value { return bondCoup(c, dcCoupDaysNC) })
	registerFunc("COUPNCD", func(c *callCtx) value {
		return bondCoup(c, func(s, m float64, f, _ int) float64 { _, ncd, _ := dcCoupons(s, m, f); return ncd })
	})
	registerFunc("COUPPCD", func(c *callCtx) value {
		return bondCoup(c, func(s, m float64, f, _ int) float64 { pcd, _, _ := dcCoupons(s, m, f); return pcd })
	})
	registerFunc("COUPNUM", func(c *callCtx) value {
		return bondCoup(c, func(s, m float64, f, _ int) float64 { _, _, n := dcCoupons(s, m, f); return float64(n) })
	})

	registerFunc("PRICE", bondPriceFn)
	registerFunc("YIELD", bondYieldFn)
	registerFunc("PRICEDISC", bondPriceDisc)
	registerFunc("YIELDDISC", bondYieldDisc)
	registerFunc("PRICEMAT", bondPriceMat)
	registerFunc("YIELDMAT", bondYieldMat)
	registerFunc("ACCRINT", bondAccrint)
	registerFunc("ACCRINTM", bondAccrintm)
	registerFunc("ODDFPRICE", bondOddFPriceFn)
	registerFunc("ODDFYIELD", bondOddFYieldFn)
	registerFunc("ODDLPRICE", bondOddLPriceFn)
	registerFunc("ODDLYIELD", bondOddLYieldFn)
}

// ---- argument handling -------------------------------------------------------

// bondArg describes one positional argument: kind 'd' (date, truncated),
// 'i' (integer, truncated) or 'n' (number). Optional arguments take def when
// absent or left empty; an empty required argument is #N/A. lenient (used by
// VDB) reads an empty argument as 0 and a boolean as 0/1 instead of #VALUE!.
type bondArg struct {
	kind     byte
	optional bool
	def      float64
	lenient  bool
}

var (
	bDate  = bondArg{kind: 'd'}
	bNum   = bondArg{kind: 'n'}
	bFreq  = bondArg{kind: 'i'}
	bBasis = bondArg{kind: 'i', optional: true}
)

// bondRead reads every argument before any range validation, so an error or
// non-numeric argument anywhere wins over a #NUM! from an out-of-range value
// (Excel's order). A multi-cell range is #VALUE!; an array constant
// contributes its first element; dates may be given as date text.
func bondRead(c *callCtx, specs ...bondArg) ([]float64, value, bool) {
	required := 0
	for _, s := range specs {
		if !s.optional {
			required++
		}
	}
	if c.nargs() < required || c.nargs() > len(specs) {
		return nil, errNA, false
	}
	out := make([]float64, len(specs))
	for i, s := range specs {
		if i >= c.nargs() {
			out[i] = s.def
			continue
		}
		if rv, ok := c.raw(i).(rangeVal); ok && rv.rows*rv.cols > 1 {
			return nil, errValue, false
		}
		v := c.scalar(i).topLeft()
		if v.isErr() {
			return nil, v, false
		}
		if isOmitted(v) {
			switch {
			case s.lenient:
				out[i] = 0
				continue
			case s.optional:
				out[i] = s.def
				continue
			}
			return nil, errNA, false
		}
		if v.kind == kindBool && !s.lenient {
			return nil, errValue, false
		}
		n, e, ok := mthNum(v)
		if !ok {
			return nil, e, false
		}
		if s.kind != 'n' {
			n = math.Trunc(n)
		}
		out[i] = n
	}
	for i, s := range specs {
		if s.kind == 'd' && (out[i] < 0 || out[i] > bondMaxDate) {
			return nil, errNum, false
		}
	}
	return out, value{}, true
}

// bondMaxDate is the serial of 9999-12-31, the last date Excel represents.
const bondMaxDate = 2958465

func bondValidFreq(f float64) bool { return f == 1 || f == 2 || f == 4 }

func bondValidBasis(b float64) bool { return b >= 0 && b <= 4 }

// bondCoup implements the six COUP* functions (settlement, maturity,
// frequency, [basis]).
func bondCoup(c *callCtx, f func(settle, mat float64, freq, basis int) float64) value {
	a, e, ok := bondRead(c, bDate, bDate, bFreq, bBasis)
	if !ok {
		return e
	}
	if a[0] >= a[1] || !bondValidFreq(a[2]) || !bondValidBasis(a[3]) {
		return errNum
	}
	return numVal(f(a[0], a[1], int(a[2]), int(a[3])))
}

// ---- PRICE / YIELD -----------------------------------------------------------

// bondPrice prices a regular coupon bond (Excel's PRICE formula).
func bondPrice(settle, mat, rate, yld, redemption float64, freq, basis int) float64 {
	f := float64(freq)
	e := dcCoupDays(settle, mat, freq, basis)
	a := dcCoupDayBS(settle, mat, freq, basis)
	// The fraction of the current period left is measured as E − A, so the
	// three pieces always add up to one period whatever the basis.
	dsc := e - a
	_, _, n := dcCoupons(settle, mat, freq)
	coupon := 100 * rate / f
	if n == 1 {
		// One coupon left: simple-interest discounting over the final period.
		return (redemption+coupon)/(1+dsc/e*yld/f) - coupon*a/e
	}
	base := 1 + yld/f
	t := dsc / e
	p := redemption / math.Pow(base, float64(n-1)+t)
	for k := 1; k <= n; k++ {
		p += coupon / math.Pow(base, float64(k-1)+t)
	}
	return p - coupon*a/e
}

func bondPriceFn(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bNum, bNum, bNum, bFreq, bBasis)
	if !ok {
		return e
	}
	settle, mat, rate, yld, red := a[0], a[1], a[2], a[3], a[4]
	if settle >= mat || rate < 0 || yld < 0 || red <= 0 || !bondValidFreq(a[5]) || !bondValidBasis(a[6]) {
		return errNum
	}
	return mthCheckResult(bondPrice(settle, mat, rate, yld, red, int(a[5]), int(a[6])))
}

func bondYieldFn(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bNum, bNum, bNum, bFreq, bBasis)
	if !ok {
		return e
	}
	settle, mat, rate, pr, red := a[0], a[1], a[2], a[3], a[4]
	if settle >= mat || rate < 0 || pr <= 0 || red <= 0 || !bondValidFreq(a[5]) || !bondValidBasis(a[6]) {
		return errNum
	}
	freq, basis := int(a[5]), int(a[6])
	f := float64(freq)
	if _, _, n := dcCoupons(settle, mat, freq); n <= 1 {
		// Closed form for the final coupon period.
		e := dcCoupDays(settle, mat, freq, basis)
		acc := dcCoupDayBS(settle, mat, freq, basis)
		dsr := dcCoupDaysNC(settle, mat, freq, basis)
		base := pr/100 + acc/e*rate/f
		return mthCheckResult((red/100 + rate/f - base) / base * f * e / dsr)
	}
	y, ok := bondSolve(func(y float64) float64 { return bondPrice(settle, mat, rate, y, red, freq, basis) - pr })
	if !ok {
		return errNum
	}
	return numVal(y)
}

// bondSolve finds the yield y ≥ −frequency-safe range where g(y) = 0 for a
// price function decreasing in y: Newton's method from 10 %, falling back to
// bisection on a bracket.
func bondSolve(g func(float64) float64) (float64, bool) {
	y := 0.1
	for i := 0; i < 100; i++ {
		fy := g(y)
		if math.Abs(fy) < 1e-12 {
			return y, true
		}
		h := 1e-7 * math.Max(1, math.Abs(y))
		d := (g(y+h) - g(y-h)) / (2 * h)
		if d == 0 || math.IsNaN(d) || math.IsInf(d, 0) {
			break
		}
		ny := y - fy/d
		if math.IsNaN(ny) || math.IsInf(ny, 0) {
			break
		}
		if math.Abs(ny-y) < 1e-14*math.Max(1, math.Abs(y)) {
			return ny, true
		}
		y = ny
	}
	// Bisection: price falls as the yield rises.
	lo, hi := -0.99, 1.0
	for g(hi) > 0 && hi < 1e6 {
		hi *= 2
	}
	glo, ghi := g(lo), g(hi)
	if math.IsNaN(glo) || math.IsNaN(ghi) || glo*ghi > 0 {
		return 0, false
	}
	for i := 0; i < 200; i++ {
		mid := (lo + hi) / 2
		gm := g(mid)
		if gm == 0 || (hi-lo)/2 < 1e-15 {
			return mid, true
		}
		if (gm > 0) == (glo > 0) {
			lo, glo = mid, gm
		} else {
			hi = mid
		}
	}
	return (lo + hi) / 2, true
}

// ---- discounted and interest-at-maturity securities --------------------------

func bondPriceDisc(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bNum, bNum, bBasis)
	if !ok {
		return e
	}
	if a[0] >= a[1] || a[2] <= 0 || a[3] <= 0 || !bondValidBasis(a[4]) {
		return errNum
	}
	return numVal(a[3] - a[2]*a[3]*dcYearFrac(a[0], a[1], int(a[4])))
}

func bondYieldDisc(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bNum, bNum, bBasis)
	if !ok {
		return e
	}
	if a[0] >= a[1] || a[2] <= 0 || a[3] <= 0 || !bondValidBasis(a[4]) {
		return errNum
	}
	yf := dcYearFrac(a[0], a[1], int(a[4]))
	return mthCheckResult((a[3] - a[2]) / a[2] / yf)
}

func bondPriceMat(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bDate, bNum, bNum, bBasis)
	if !ok {
		return e
	}
	settle, mat, issue, rate, yld := a[0], a[1], a[2], a[3], a[4]
	if settle >= mat || rate < 0 || yld < 0 || !bondValidBasis(a[5]) {
		return errNum
	}
	b := int(a[5])
	dim := dcYearFrac(issue, mat, b)
	acc := dcYearFrac(issue, settle, b)
	dsm := dcYearFrac(settle, mat, b)
	return mthCheckResult((100+dim*rate*100)/(1+dsm*yld) - acc*rate*100)
}

func bondYieldMat(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bDate, bNum, bNum, bBasis)
	if !ok {
		return e
	}
	settle, mat, issue, rate, pr := a[0], a[1], a[2], a[3], a[4]
	if settle >= mat || rate < 0 || pr <= 0 || !bondValidBasis(a[5]) {
		return errNum
	}
	b := int(a[5])
	dim := dcYearFrac(issue, mat, b)
	acc := dcYearFrac(issue, settle, b)
	dsm := dcYearFrac(settle, mat, b)
	base := pr/100 + acc*rate
	return mthCheckResult(((1 + dim*rate) - base) / base / dsm)
}

// bondAccrint implements ACCRINT(issue, first_interest, settlement, rate,
// [par=1000], frequency, [basis], [calc_method=TRUE]). With calc_method TRUE
// the interest accrues over the quasi-coupon periods of the schedule anchored
// at first_interest, each contributing (days accrued)/(period length) of a
// coupon; with FALSE it is simple interest over YEARFRAC(issue, settlement).
func bondAccrint(c *callCtx) value {
	if c.nargs() > 8 {
		return errNA
	}
	n := c.nargs()
	if n > 7 {
		n = 7
	}
	a, e, ok := bondRead(&callCtx{p: c.p, ev: c.ev, args: c.args[:n]},
		bDate, bDate, bDate, bNum, bondArg{kind: 'n', optional: true, def: 1000}, bFreq, bBasis)
	if !ok {
		return e
	}
	quasi := true
	if c.nargs() == 8 {
		v := c.scalar(7).topLeft()
		switch {
		case v.isErr():
			return v
		case isOmitted(v):
		case v.kind == kindBool || v.kind == kindNum:
			quasi = v.num != 0
		default:
			return errValue
		}
	}
	issue, first, settle, rate, par := a[0], a[1], a[2], a[3], a[4]
	if issue < 1 || first < 1 || issue >= settle || rate <= 0 || par <= 0 || !bondValidFreq(a[5]) || !bondValidBasis(a[6]) {
		return errNum
	}
	freq, basis := int(a[5]), int(a[6])
	if !quasi {
		return mthCheckResult(par * rate * dcYearFrac(issue, settle, basis))
	}
	step := 12 / freq
	fd := dcDate(first)
	eom := dcIsEOM(fd)
	q := func(k int) float64 { return dcSerial(dcAddMonths(fd, k*step, eom)) }
	// Start from the quasi period containing issue.
	k := 0
	for q(k) > issue {
		k--
	}
	for q(k+1) <= issue {
		k++
	}
	sum := 0.0
	for ; q(k) < settle; k++ {
		start, end := q(k), q(k+1)
		from, to := math.Max(start, issue), math.Min(end, settle)
		sum += dcDays(from, to, basis) / dcPeriodLen(start, end, freq, basis)
	}
	return mthCheckResult(par * rate / float64(freq) * sum)
}

// bondAccrintm implements ACCRINTM(issue, settlement, rate, [par], [basis]):
// simple interest accrued up to maturity. par defaults to 1,000.
func bondAccrintm(c *callCtx) value {
	a, e, ok := bondRead(c, bDate, bDate, bNum, bondArg{kind: 'n', optional: true, def: 1000}, bBasis)
	if !ok {
		return e
	}
	if a[0] >= a[1] || a[2] <= 0 || a[3] <= 0 || !bondValidBasis(a[4]) {
		return errNum
	}
	return mthCheckResult(a[3] * a[2] * dcYearFrac(a[0], a[1], int(a[4])))
}

// ---- odd first / last periods ------------------------------------------------

// bondOddFirst holds the cash-flow timing of a bond with an odd first period
// (issue → first coupon), measured in coupon periods from settlement.
type bondOddFirst struct {
	firstFrac float64 // first coupon as a fraction of a regular coupon (Σ DC/NL)
	accrued   float64 // accrued fraction at settlement (Σ A/NL)
	tFirst    float64 // periods from settlement to the first coupon
	regular   int     // regular coupons after the first one (the last is at maturity)
}

// bondOddFirstSchedule splits [issue, first] into quasi-coupon periods that
// run back from the first coupon date every 12/freq months.
func bondOddFirstSchedule(settle, mat, issue, first float64, freq, basis int) bondOddFirst {
	step := 12 / freq
	fd := dcDate(first)
	eom := dcIsEOM(fd)
	var r bondOddFirst
	// Quasi-coupon dates q(0)=first, q(1), … going back until q(k) <= issue.
	q := func(k int) float64 { return dcSerial(dcAddMonths(fd, -k*step, eom)) }
	k := 1
	for q(k) > issue {
		k++
	}
	for i := k; i >= 1; i-- {
		start, end := q(i), q(i-1)
		nl := dcPeriodLen(start, end, freq, basis)
		from := math.Max(start, issue)
		r.firstFrac += dcDays(from, end, basis) / nl
		if settle > from {
			r.accrued += dcDays(from, math.Min(settle, end), basis) / nl
		}
		if settle >= start && settle < end {
			// Settlement lies in this quasi period: time to its end, then
			// whole quasi periods up to the first coupon.
			r.tFirst = dcDays(settle, end, basis)/nl + float64(i-1)
		}
	}
	// Regular coupons after the first coupon, up to maturity.
	md := dcDate(mat)
	months := (md.Year()-fd.Year())*12 + int(md.Month()) - int(fd.Month())
	r.regular = int(math.Round(float64(months) / float64(step)))
	return r
}

func bondOddFirstPrice(s bondOddFirst, rate, yld, redemption float64, freq int) float64 {
	f := float64(freq)
	coupon := 100 * rate / f
	base := 1 + yld/f
	p := coupon * s.firstFrac / math.Pow(base, s.tFirst)
	for k := 1; k <= s.regular; k++ {
		p += coupon / math.Pow(base, s.tFirst+float64(k))
	}
	p += redemption / math.Pow(base, s.tFirst+float64(s.regular))
	return p - coupon*s.accrued
}

// bondOddFirstArgs reads and validates (settlement, maturity, issue,
// first_coupon, rate, yld|pr, redemption, frequency, [basis]).
func bondOddFirstArgs(c *callCtx) ([]float64, value, bool) {
	a, e, ok := bondRead(c, bDate, bDate, bDate, bDate, bNum, bNum, bNum, bFreq, bBasis)
	if !ok {
		return nil, e, false
	}
	settle, mat, issue, first := a[0], a[1], a[2], a[3]
	if !(issue < settle && settle < first && first < mat) || a[4] < 0 || a[5] < 0 || a[6] <= 0 ||
		!bondValidFreq(a[7]) || !bondValidBasis(a[8]) {
		return nil, errNum, false
	}
	return a, value{}, true
}

func bondOddFPriceFn(c *callCtx) value {
	a, e, ok := bondOddFirstArgs(c)
	if !ok {
		return e
	}
	s := bondOddFirstSchedule(a[0], a[1], a[2], a[3], int(a[7]), int(a[8]))
	return mthCheckResult(bondOddFirstPrice(s, a[4], a[5], a[6], int(a[7])))
}

func bondOddFYieldFn(c *callCtx) value {
	a, e, ok := bondOddFirstArgs(c)
	if !ok {
		return e
	}
	if a[5] <= 0 {
		return errNum
	}
	s := bondOddFirstSchedule(a[0], a[1], a[2], a[3], int(a[7]), int(a[8]))
	y, ok := bondSolve(func(y float64) float64 { return bondOddFirstPrice(s, a[4], y, a[6], int(a[7])) - a[5] })
	if !ok {
		return errNum
	}
	return numVal(y)
}

// bondOddLastSchedule splits [last_interest, maturity] into quasi-coupon
// periods running forward from the last interest date and returns
// Σ DC/NL (odd coupon fraction), Σ A/NL (accrued) and Σ DSC/NL (time from
// settlement to maturity), all in coupon periods.
func bondOddLastSchedule(settle, mat, last float64, freq, basis int) (dc, acc, dsc float64) {
	step := 12 / freq
	ld := dcDate(last)
	eom := dcIsEOM(ld)
	for k := 1; ; k++ {
		start := dcSerial(dcAddMonths(ld, (k-1)*step, eom))
		end := dcSerial(dcAddMonths(ld, k*step, eom))
		if start >= mat {
			break
		}
		nl := dcPeriodLen(start, end, freq, basis)
		stop := math.Min(end, mat)
		dc += dcDays(start, stop, basis) / nl
		if settle > start {
			acc += dcDays(start, math.Min(settle, stop), basis) / nl
		}
		if settle < stop {
			dsc += dcDays(math.Max(settle, start), stop, basis) / nl
		}
	}
	return dc, acc, dsc
}

// bondOddLastArgs reads (settlement, maturity, last_interest, rate, yld|pr,
// redemption, frequency, [basis]).
func bondOddLastArgs(c *callCtx) ([]float64, value, bool) {
	a, e, ok := bondRead(c, bDate, bDate, bDate, bNum, bNum, bNum, bFreq, bBasis)
	if !ok {
		return nil, e, false
	}
	settle, mat, last := a[0], a[1], a[2]
	if !(last < settle && settle < mat) || a[3] < 0 || a[4] < 0 || a[5] <= 0 ||
		!bondValidFreq(a[6]) || !bondValidBasis(a[7]) {
		return nil, errNum, false
	}
	return a, value{}, true
}

func bondOddLPriceFn(c *callCtx) value {
	a, e, ok := bondOddLastArgs(c)
	if !ok {
		return e
	}
	f := float64(a[6])
	dc, acc, dsc := bondOddLastSchedule(a[0], a[1], a[2], int(a[6]), int(a[7]))
	coupon := 100 * a[3] / f
	return mthCheckResult((a[5]+coupon*dc)/(1+dsc*a[4]/f) - coupon*acc)
}

func bondOddLYieldFn(c *callCtx) value {
	a, e, ok := bondOddLastArgs(c)
	if !ok {
		return e
	}
	if a[4] <= 0 {
		return errNum
	}
	f := float64(a[6])
	dc, acc, dsc := bondOddLastSchedule(a[0], a[1], a[2], int(a[6]), int(a[7]))
	coupon := 100 * a[3] / f
	base := a[4] + coupon*acc
	return mthCheckResult((a[5] + coupon*dc - base) / base * f / dsc)
}
