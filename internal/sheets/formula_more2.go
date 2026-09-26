// Package sheets — second batch of additional Excel/Google-Sheets functions.
//
// This file (a sibling of formula_more.go) fills further gaps in the standard
// library, keeping the established conventions: functions register via
// registerFunc in init(), receive a *callCtx and return a value, and reuse the
// numVal/strVal/errNum/errValue/errNA/errDiv0 primitives plus the shared date
// helpers (dtSerialArg, serialToTime, dt30360Frac, dtActualActualFrac).
//
// Added here:
//   - financial (fractions):     DOLLARDE, DOLLARFR
//   - financial (loans):         ISPMT
//   - financial (discount/T-bill): DISC, INTRATE, RECEIVED, TBILLPRICE,
//     TBILLYIELD, TBILLEQ
//   - financial (bonds):         DURATION, MDURATION
//   - engineering (error fn):    ERF, ERFC, ERF.PRECISE, ERFC.PRECISE
//   - math:                      MUNIT, SERIESSUM
//
// Unexported helpers added here keep the existing "fin" prefix (they live in
// the same package as formula_financial.go and use names not defined there).
package sheets

import "math"

func init() {
	// Financial: fractional-dollar conversion.
	registerFunc("DOLLARDE", finDollarDe)
	registerFunc("DOLLARFR", finDollarFr)

	// Financial: straight-line loan interest.
	registerFunc("ISPMT", finISPmt)

	// Financial: discounted securities & Treasury bills.
	registerFunc("DISC", finDisc)
	registerFunc("INTRATE", finIntrate)
	registerFunc("RECEIVED", finReceived)
	registerFunc("TBILLPRICE", finTBillPrice)
	registerFunc("TBILLYIELD", finTBillYield)
	registerFunc("TBILLEQ", finTBillEq)
	// ACCRINT lives with the other coupon-bond functions in formula_bond.go.

	// Financial: bond duration.
	registerFunc("DURATION", func(c *callCtx) value { return finDurationFn(c, false) })
	registerFunc("MDURATION", func(c *callCtx) value { return finDurationFn(c, true) })

	// Engineering: error function.
	registerFunc("ERF", engErf)
	registerFunc("ERF.PRECISE", engErfPrecise)
	registerFunc("ERFC", engErfc)
	registerFunc("ERFC.PRECISE", engErfcPrecise)

	// Math.
	registerFunc("MUNIT", mthMUnit)
	registerFunc("SERIESSUM", mthSeriesSum)
}

// ---- shared helpers for the day-count financial functions -------------------

// finBasisArg reads an optional day-count basis argument at index i (default 0).
// ok is false (with a meaningful error value) when present but invalid.
func finBasisArg(c *callCtx, i int) (int, value, bool) {
	if i >= c.nargs() {
		return 0, value{}, true
	}
	v := c.scalar(i)
	if v.isErr() {
		return 0, v, false
	}
	n, ok := v.toNum()
	if !ok {
		return 0, errValue, false
	}
	b := int(math.Trunc(n))
	if b < 0 || b > 4 {
		return 0, errNum, false
	}
	return b, value{}, true
}

// finYearFrac returns the year fraction between two Excel serial dates under the
// given day-count basis (0=30/360 US, 1=actual/actual, 2=actual/360,
// 3=actual/365, 4=30/360 European), mirroring the worksheet YEARFRAC.
func finYearFrac(startSerial, endSerial float64, basis int) float64 {
	if startSerial > endSerial {
		startSerial, endSerial = endSerial, startSerial
	}
	start := serialToTime(startSerial)
	end := serialToTime(endSerial)
	switch basis {
	case 0:
		return dt30360Frac(start, end, false)
	case 1:
		return dtActualActualFrac(start, end, startSerial, endSerial)
	case 2:
		return (math.Floor(endSerial) - math.Floor(startSerial)) / 360.0
	case 3:
		return (math.Floor(endSerial) - math.Floor(startSerial)) / 365.0
	case 4:
		return dt30360Frac(start, end, true)
	}
	return 0
}

// ---- DOLLARDE / DOLLARFR ----------------------------------------------------

// finDollarDe converts a price expressed as integer.fraction (read in units of
// 1/fraction) into a decimal number. e.g. DOLLARDE(1.02,16) = 1.125.
func finDollarDe(c *callCtx) value {
	price, ok1 := c.num(0)
	fracF, ok2 := c.num(1)
	if !ok1 || !ok2 {
		return errValue
	}
	frac := math.Trunc(fracF)
	if frac < 0 {
		return errNum
	}
	if frac == 0 {
		return errDiv0
	}
	ip := math.Trunc(price)
	fp := price - ip
	digits := math.Ceil(math.Log10(frac))
	return numVal(ip + fp*math.Pow(10, digits)/frac)
}

// finDollarFr is the inverse of DOLLARDE: it converts a decimal price into
// integer.fraction form expressed in units of 1/fraction.
func finDollarFr(c *callCtx) value {
	price, ok1 := c.num(0)
	fracF, ok2 := c.num(1)
	if !ok1 || !ok2 {
		return errValue
	}
	frac := math.Trunc(fracF)
	if frac < 0 {
		return errNum
	}
	if frac == 0 {
		return errDiv0
	}
	ip := math.Trunc(price)
	fp := price - ip
	digits := math.Ceil(math.Log10(frac))
	return numVal(ip + fp*frac/math.Pow(10, digits))
}

// ---- ISPMT ------------------------------------------------------------------

// finISPmt computes the interest paid during period per of a loan whose
// principal is repaid in equal instalments: pv*rate*(per/nper - 1).
func finISPmt(c *callCtx) value {
	rate, ok1 := c.num(0)
	per, ok2 := c.num(1)
	nper, ok3 := c.num(2)
	pv, ok4 := c.num(3)
	if !ok1 || !ok2 || !ok3 || !ok4 {
		return errValue
	}
	if nper == 0 {
		return errDiv0
	}
	return numVal(pv * rate * (per/nper - 1))
}

// ---- DISC / INTRATE / RECEIVED ----------------------------------------------

// finDiscDates reads settlement (0) and maturity (1) serials plus an optional
// basis at index basisIdx, validating settlement < maturity. On error it
// returns the propagated/derived error value with ok=false.
func finDiscDates(c *callCtx, basisIdx int) (setS, matS float64, basis int, errv value, ok bool) {
	setS, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return 0, 0, 0, e1, false
	}
	matS, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return 0, 0, 0, e2, false
	}
	if setS >= matS {
		return 0, 0, 0, errNum, false
	}
	basis, be, bok := finBasisArg(c, basisIdx)
	if !bok {
		return 0, 0, 0, be, false
	}
	return setS, matS, basis, value{}, true
}

func finDisc(c *callCtx) value {
	setS, matS, basis, errv, ok := finDiscDates(c, 4)
	if !ok {
		return errv
	}
	pr, ok1 := c.num(2)
	redemption, ok2 := c.num(3)
	if !ok1 || !ok2 {
		return errValue
	}
	if pr <= 0 || redemption <= 0 {
		return errNum
	}
	yf := finYearFrac(setS, matS, basis)
	if yf == 0 {
		return errDiv0
	}
	return numVal((redemption - pr) / redemption / yf)
}

func finIntrate(c *callCtx) value {
	setS, matS, basis, errv, ok := finDiscDates(c, 4)
	if !ok {
		return errv
	}
	investment, ok1 := c.num(2)
	redemption, ok2 := c.num(3)
	if !ok1 || !ok2 {
		return errValue
	}
	if investment <= 0 || redemption <= 0 {
		return errNum
	}
	yf := finYearFrac(setS, matS, basis)
	if yf == 0 {
		return errDiv0
	}
	return numVal((redemption - investment) / investment / yf)
}

func finReceived(c *callCtx) value {
	setS, matS, basis, errv, ok := finDiscDates(c, 4)
	if !ok {
		return errv
	}
	investment, ok1 := c.num(2)
	discount, ok2 := c.num(3)
	if !ok1 || !ok2 {
		return errValue
	}
	if investment <= 0 || discount <= 0 {
		return errNum
	}
	yf := finYearFrac(setS, matS, basis)
	denom := 1 - discount*yf
	if denom == 0 {
		return errDiv0
	}
	return numVal(investment / denom)
}

// ---- Treasury-bill functions ------------------------------------------------

// finTBillDSM validates the settlement/maturity pair for a Treasury bill and
// returns the number of days from settlement to maturity (actual day count).
// Excel rejects a maturity more than one calendar year past settlement.
func finTBillDSM(c *callCtx) (dsm float64, errv value, ok bool) {
	setS, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return 0, e1, false
	}
	matS, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return 0, e2, false
	}
	if setS >= matS {
		return 0, errNum, false
	}
	dsm = math.Floor(matS) - math.Floor(setS)
	if dsm > 365 {
		return 0, errNum, false
	}
	return dsm, value{}, true
}

func finTBillPrice(c *callCtx) value {
	dsm, errv, ok := finTBillDSM(c)
	if !ok {
		return errv
	}
	discount, dok := c.num(2)
	if !dok {
		return errValue
	}
	if discount <= 0 {
		return errNum
	}
	return numVal(100 * (1 - discount*dsm/360))
}

func finTBillYield(c *callCtx) value {
	dsm, errv, ok := finTBillDSM(c)
	if !ok {
		return errv
	}
	pr, pok := c.num(2)
	if !pok {
		return errValue
	}
	if pr <= 0 {
		return errNum
	}
	return numVal((100 - pr) / pr * 360 / dsm)
}

// finTBillEq returns the bond-equivalent yield of a Treasury bill using the
// documented formula 365*discount/(360 - discount*DSM). (Excel applies a
// distinct quadratic formula for bills longer than 182 days; that refinement is
// not modelled here.)
func finTBillEq(c *callCtx) value {
	dsm, errv, ok := finTBillDSM(c)
	if !ok {
		return errv
	}
	discount, dok := c.num(2)
	if !dok {
		return errValue
	}
	if discount <= 0 {
		return errNum
	}
	denom := 360 - discount*dsm
	if denom == 0 {
		return errDiv0
	}
	return numVal(365 * discount / denom)
}

// ---- DURATION / MDURATION ---------------------------------------------------

// finDurationFn implements DURATION (modified=false) and MDURATION
// (modified=true): the Macaulay duration of the remaining coupons and
// redemption, timed in coupon periods from settlement (the first one
// (E−A)/E away, see bondPrice), divided by (1+yield/freq) for the modified
// variant. Argument handling is shared with the other coupon-bond functions.
func finDurationFn(c *callCtx, modified bool) value {
	a, e, ok := bondRead(c, bDate, bDate, bNum, bNum, bFreq, bBasis)
	if !ok {
		return e
	}
	setS, matS, coupon, yield := a[0], a[1], a[2], a[3]
	if setS >= matS || coupon < 0 || yield < 0 || !bondValidFreq(a[4]) || !bondValidBasis(a[5]) {
		return errNum
	}
	freq, basis := int(a[4]), int(a[5])
	f := float64(freq)
	ec := dcCoupDays(setS, matS, freq, basis)
	t0 := (ec - dcCoupDayBS(setS, matS, freq, basis)) / ec
	_, _, n := dcCoupons(setS, matS, freq)
	cf := coupon * 100 / f
	y := 1 + yield/f
	var d, p float64
	for k := 1; k <= n; k++ {
		t := float64(k-1) + t0
		amt := cf
		if k == n {
			amt += 100
		}
		disc := math.Pow(y, t)
		d += t * amt / disc
		p += amt / disc
	}
	if p == 0 {
		return errNum
	}
	dur := d / p / f
	if modified {
		dur /= y
	}
	return mthCheckResult(dur)
}

// ---- ERF / ERFC -------------------------------------------------------------

// engErf implements ERF(lower, [upper]). With one argument it integrates the
// error function from 0 to lower; with two, from lower to upper.
func engErf(c *callCtx) value {
	lower, ok := c.num(0)
	if !ok {
		return errValue
	}
	if c.nargs() >= 2 {
		upper, ok2 := c.num(1)
		if !ok2 {
			return errValue
		}
		return numVal(math.Erf(upper) - math.Erf(lower))
	}
	return numVal(math.Erf(lower))
}

// engErfPrecise implements ERF.PRECISE(x): the error function from 0 to x.
func engErfPrecise(c *callCtx) value {
	x, ok := c.num(0)
	if !ok {
		return errValue
	}
	return numVal(math.Erf(x))
}

// engErfc implements ERFC(x) = 1 - ERF(x).
func engErfc(c *callCtx) value {
	x, ok := c.num(0)
	if !ok {
		return errValue
	}
	return numVal(math.Erfc(x))
}

// engErfcPrecise implements ERFC.PRECISE(x) (identical to ERFC).
func engErfcPrecise(c *callCtx) value {
	x, ok := c.num(0)
	if !ok {
		return errValue
	}
	return numVal(math.Erfc(x))
}

// ---- MUNIT / SERIESSUM ------------------------------------------------------

// mthMUnit returns the n×n identity matrix as a spilling array.
func mthMUnit(c *callCtx) value {
	nf, ok := c.num(0)
	if !ok {
		return errValue
	}
	n := int(math.Trunc(nf))
	if n < 1 {
		return errValue
	}
	cells := make([][]value, n)
	for r := 0; r < n; r++ {
		cells[r] = make([]value, n)
		for cc := 0; cc < n; cc++ {
			if r == cc {
				cells[r][cc] = numVal(1)
			} else {
				cells[r][cc] = numVal(0)
			}
		}
	}
	return arrayValue(cells)
}

// mthSeriesSum implements SERIESSUM(x, n, m, coefficients) =
// Σ aᵢ·x^(n + i·m) for the coefficients aᵢ taken in row-major order.
func mthSeriesSum(c *callCtx) value {
	if c.nargs() < 4 {
		return errValue
	}
	x, ok1 := c.num(0)
	n, ok2 := c.num(1)
	m, ok3 := c.num(2)
	if !ok1 || !ok2 || !ok3 {
		return errValue
	}
	coefRV, ok := c.rangeArg(3)
	if !ok {
		return errValue
	}
	sum := 0.0
	i := 0
	for _, v := range coefRV.flat() {
		if v.isErr() {
			return v
		}
		a, aok := v.toNum()
		if !aok {
			return errValue
		}
		sum += a * math.Pow(x, n+float64(i)*m)
		i++
	}
	return numVal(sum)
}
