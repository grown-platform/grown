package sheets

import (
	"math"
	"strings"
)

// formula_depreciation.go — VDB, AMORLINC and AMORDEGRC (OnlyOffice parity
// milestone M4).

func init() {
	registerFunc("VDB", finVDB)
	registerFunc("AMORLINC", finAmorLinc)
	registerFunc("AMORDEGRC", finAmorDegrc)
}

// finVDB implements VDB(cost, salvage, life, start_period, end_period,
// [factor=2], [no_switch=FALSE]): declining-balance depreciation between two
// (possibly fractional) periods. Each whole period's depreciation is the
// declining-balance amount (never taking the book value below salvage),
// switching to straight-line over the remaining life once that is larger
// unless no_switch is set; a fractional period contributes its share of that
// period's depreciation.
func finVDB(c *callCtx) value {
	if c.nargs() > 7 {
		return errNA
	}
	n := c.nargs()
	if n > 6 {
		n = 6
	}
	num := bondArg{kind: 'n', lenient: true}
	a, e, ok := bondRead(&callCtx{p: c.p, ev: c.ev, args: c.args[:n]},
		num, num, num, num, num, bondArg{kind: 'n', optional: true, def: 2, lenient: true})
	if !ok {
		return e
	}
	noSwitch := false
	if c.nargs() == 7 {
		v := c.scalar(6).topLeft()
		switch {
		case v.isErr():
			return v
		case isOmitted(v):
		case v.kind == kindBool:
			noSwitch = v.num != 0
		case v.kind == kindStr && (strings.EqualFold(v.str, "TRUE") || strings.EqualFold(v.str, "FALSE")):
			noSwitch = strings.EqualFold(v.str, "TRUE")
		default:
			f, e, ok := mthNum(v)
			if !ok {
				return e
			}
			noSwitch = f != 0
		}
	}
	cost, salvage, life, start, end, factor := a[0], a[1], a[2], a[3], a[4], a[5]
	if cost < 0 || salvage < 0 || life < 0 || start < 0 || end < start || end > life || factor < 0 {
		return errNum
	}
	if life == 0 {
		return errDiv0
	}
	// Depreciation from start_period onward is that of an asset whose cost
	// is the book value at start_period, with periods counted from there.
	bv := cost - vdbSpan(cost, salvage, life, life, start, factor, noSwitch)
	total := vdbSpan(bv, salvage, life, life-start, end-start, factor, noSwitch)
	return mthCheckResult(total)
}

// vdbSpan depreciates book value bv over length periods (the last one
// possibly partial). The declining-balance rate is factor/life; the
// straight-line alternative spreads what is left over the remaining life
// remLife. A partial period contributes its share of that period's amount.
func vdbSpan(bv, salvage, life, remLife, length, factor float64, noSwitch bool) float64 {
	rate := factor / life
	total := 0.0
	straight := false
	for k := 1; float64(k-1) < length; k++ {
		var dep float64
		if noSwitch {
			dep = math.Min(bv*rate, math.Max(0, bv-salvage))
		} else {
			// Declining balance, never below salvage (a salvage above the
			// book value gives the negative difference, as in Excel).
			dep = math.Min(bv*rate, bv-salvage)
			if rem := remLife - float64(k-1); rem > 0 && bv > salvage {
				if sl := (bv - salvage) / math.Max(rem, 1); straight || sl > dep {
					straight = true
					dep = sl
				}
			}
		}
		total += dep * math.Min(1, length-float64(k-1))
		bv -= dep
	}
	return total
}

// finAmorLinc implements AMORLINC(cost, date_purchased, first_period, salvage,
// period, rate, [basis]): French linear depreciation. Period 0 is the pro-rata
// first period (purchase → end of first period); later periods take
// cost·rate each until the depreciable amount (cost − salvage) runs out.
func finAmorLinc(c *callCtx) value {
	a, e, ok := bondRead(c, bNum, bDate, bDate, bNum, bNum, bNum, bBasis)
	if !ok {
		return e
	}
	cost, bought, first, salvage, rate := a[0], a[1], a[2], a[3], a[5]
	period := math.Floor(a[4] + 0.5)
	if cost < 0 || salvage < 0 || salvage > cost || period < 0 || rate <= 0 || bought > first || !bondValidBasis(a[6]) {
		return errNum
	}
	one := cost * rate
	first0 := dcYearFrac(bought, first, int(a[6])) * rate * cost
	if period == 0 {
		return numVal(math.Min(first0, cost-salvage))
	}
	full := math.Floor((cost - salvage - first0) / one)
	switch {
	case period <= full:
		return numVal(one)
	case period == full+1:
		return numVal(math.Max(0, cost-salvage-one*full-first0))
	}
	return numVal(0)
}

// finAmorDegrc implements AMORDEGRC: French declining-balance depreciation.
// The rate is scaled by a coefficient from the asset life (1/rate): 1.5 for
// 3–4 years, 2 for 5–6 years, 2.5 beyond 6; each period's amount is rounded
// to a whole number. The first period is pro rata; when the remaining value
// would fall below salvage, the period before last takes half the remaining
// value and the last period the rest.
func finAmorDegrc(c *callCtx) value {
	a, e, ok := bondRead(c, bNum, bDate, bDate, bNum, bNum, bNum, bBasis)
	if !ok {
		return e
	}
	cost, bought, first, salvage, rate := a[0], a[1], a[2], a[3], a[5]
	period := math.Trunc(a[4])
	if cost < 0 || salvage < 0 || salvage > cost || period < 0 || rate <= 0 || bought > first || !bondValidBasis(a[6]) {
		return errNum
	}
	life := 1 / rate
	var coeff float64
	switch {
	case life < 3 || (life > 4 && life < 5):
		return errNum
	case life <= 4:
		coeff = 1.5
	case life <= 6:
		coeff = 2
	default:
		coeff = 2.5
	}
	rate *= coeff
	round := func(x float64) float64 { return math.Floor(x + 0.5) }
	dep := round(dcYearFrac(bought, first, int(a[6])) * rate * cost)
	if period == 0 {
		return numVal(dep)
	}
	cost -= dep
	rest := cost - salvage
	for n := 0.0; n < period; n++ {
		dep = round(rate * cost)
		rest -= dep
		if rest < 0 {
			if period-n <= 1 {
				return numVal(round(cost * 0.5))
			}
			return numVal(0)
		}
		cost -= dep
	}
	return numVal(dep)
}
