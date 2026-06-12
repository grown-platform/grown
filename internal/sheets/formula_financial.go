package sheets

import "math"

// ---------------------------------------------------------------------------
// Shared financial helpers
// ---------------------------------------------------------------------------

// finPow computes (1+rate)^nper. math.Pow handles rate==0 -> 1.
func finPow(rate, nper float64) float64 {
	return math.Pow(1+rate, nper)
}

// finPmt computes the periodic payment using standard TVM conventions.
// type t: 0 = end of period, 1 = beginning of period.
func finPmt(rate, nper, pv, fv float64, t int) float64 {
	if rate == 0 {
		if nper == 0 {
			return 0
		}
		return -(pv + fv) / nper
	}
	pow := finPow(rate, nper)
	tf := 1.0
	if t != 0 {
		tf = 1 + rate
	}
	return -(pv*pow + fv) * rate / (tf * (pow - 1))
}

// finFv computes future value.
func finFv(rate, nper, pmt, pv float64, t int) float64 {
	if rate == 0 {
		return -(pv + pmt*nper)
	}
	pow := finPow(rate, nper)
	tf := 1.0
	if t != 0 {
		tf = 1 + rate
	}
	return -(pv*pow + pmt*tf*(pow-1)/rate)
}

// finPv computes present value.
func finPv(rate, nper, pmt, fv float64, t int) float64 {
	if rate == 0 {
		return -(fv + pmt*nper)
	}
	pow := finPow(rate, nper)
	tf := 1.0
	if t != 0 {
		tf = 1 + rate
	}
	return -(fv + pmt*tf*(pow-1)/rate) / pow
}

// finIpmt returns the interest portion of a payment for period per.
func finIpmt(rate, per, nper, pv, fv float64, t int) float64 {
	pmt := finPmt(rate, nper, pv, fv, t)
	// Balance at beginning of the period (period per, 1-based).
	var ip float64
	if t != 0 {
		// beginning-of-period: no interest accrues in the first period.
		if per == 1 {
			return 0
		}
		ip = finFvBalance(rate, per-2, pmt, pv) * rate
		ip = ip / (1 + rate)
	} else {
		ip = finFvBalance(rate, per-1, pmt, pv) * rate
	}
	return ip
}

// finFvBalance returns the remaining principal balance (as an FV) after n
// completed periods, using end-of-period accumulation of pmt.
func finFvBalance(rate, n, pmt, pv float64) float64 {
	// Future value of the loan after n periods (end-of-period payments).
	return finFv(rate, n, pmt, pv, 0)
}

// finNewton runs Newton's method on f with derivative numerically estimated;
// callers pass f and its analytic derivative df. Returns (root, ok).
func finNewton(f func(float64) float64, df func(float64) float64, guess float64) (float64, bool) {
	x := guess
	const maxIter = 100
	const eps = 1e-10
	for i := 0; i < maxIter; i++ {
		fx := f(x)
		if math.IsNaN(fx) || math.IsInf(fx, 0) {
			return 0, false
		}
		if math.Abs(fx) < eps {
			return x, true
		}
		d := df(x)
		if d == 0 || math.IsNaN(d) || math.IsInf(d, 0) {
			return 0, false
		}
		nx := x - fx/d
		if math.Abs(nx-x) < eps {
			return nx, true
		}
		x = nx
	}
	return 0, false
}

// finBisect attempts to bracket and solve f over a wide rate range.
func finBisect(f func(float64) float64) (float64, bool) {
	lo, hi := -0.9999999, 10.0
	flo := f(lo)
	fhi := f(hi)
	if math.IsNaN(flo) || math.IsNaN(fhi) {
		return 0, false
	}
	if flo*fhi > 0 {
		// Scan for a sign change.
		prev := lo
		fprev := flo
		found := false
		step := 0.05
		for x := lo + step; x <= hi; x += step {
			fx := f(x)
			if math.IsNaN(fx) || math.IsInf(fx, 0) {
				prev = x
				fprev = fx
				continue
			}
			if fprev*fx <= 0 {
				lo, hi = prev, x
				flo = fprev
				found = true
				break
			}
			prev = x
			fprev = fx
		}
		if !found {
			return 0, false
		}
	}
	const maxIter = 200
	const eps = 1e-10
	for i := 0; i < maxIter; i++ {
		mid := (lo + hi) / 2
		fmid := f(mid)
		if math.Abs(fmid) < eps || (hi-lo)/2 < eps {
			return mid, true
		}
		if flo*fmid <= 0 {
			hi = mid
		} else {
			lo = mid
			flo = fmid
		}
	}
	return (lo + hi) / 2, true
}

// finCollectNums extracts numeric values from a callCtx flattened args,
// propagating the first error encountered.
func finCollectNums(vals []value) ([]float64, value, bool) {
	out := make([]float64, 0, len(vals))
	for _, v := range vals {
		if v.isErr() {
			return nil, v, true
		}
		n, ok := v.toNum()
		if !ok {
			continue
		}
		out = append(out, n)
	}
	return out, value{}, false
}

// finRangeNums returns the numeric values of a range in row-major order,
// propagating any error cell.
func finRangeNums(rv rangeVal) ([]float64, value, bool) {
	out := make([]float64, 0, rv.rows*rv.cols)
	for _, v := range rv.flat() {
		if v.isErr() {
			return nil, v, true
		}
		n, ok := v.toNum()
		if !ok {
			continue
		}
		out = append(out, n)
	}
	return out, value{}, false
}

// ---------------------------------------------------------------------------
// PMT / FV / PV / NPER / RATE
// ---------------------------------------------------------------------------

func init() {
	registerFunc("PMT", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		nper, ok2 := c.num(1)
		pv, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		fv, _ := c.numOr(3, 0)
		tf, _ := c.numOr(4, 0)
		return numVal(finPmt(rate, nper, pv, fv, int(tf)))
	})

	registerFunc("FV", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		nper, ok2 := c.num(1)
		pmt, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		pv, _ := c.numOr(3, 0)
		tf, _ := c.numOr(4, 0)
		return numVal(finFv(rate, nper, pmt, pv, int(tf)))
	})

	registerFunc("PV", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		nper, ok2 := c.num(1)
		pmt, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		fv, _ := c.numOr(3, 0)
		tf, _ := c.numOr(4, 0)
		return numVal(finPv(rate, nper, pmt, fv, int(tf)))
	})

	registerFunc("NPER", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		pmt, ok2 := c.num(1)
		pv, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		fv, _ := c.numOr(3, 0)
		tf, _ := c.numOr(4, 0)
		if rate == 0 {
			if pmt == 0 {
				return errNum
			}
			return numVal(-(pv + fv) / pmt)
		}
		t := 0.0
		if int(tf) != 0 {
			t = 1
		}
		// nper = ln((pmt*(1+rate*t)-fv*rate)/(pmt*(1+rate*t)+pv*rate)) / ln(1+rate)
		num := pmt*(1+rate*t) - fv*rate
		den := pmt*(1+rate*t) + pv*rate
		if den == 0 || num/den <= 0 {
			return errNum
		}
		res := math.Log(num/den) / math.Log(1+rate)
		if math.IsNaN(res) || math.IsInf(res, 0) {
			return errNum
		}
		return numVal(res)
	})

	registerFunc("RATE", func(c *callCtx) value {
		nper, ok1 := c.num(0)
		pmt, ok2 := c.num(1)
		pv, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		fv, _ := c.numOr(3, 0)
		tf, _ := c.numOr(4, 0)
		guess, _ := c.numOr(5, 0.1)
		t := 0
		if int(tf) != 0 {
			t = 1
		}
		f := func(r float64) float64 {
			return finFv(r, nper, pmt, pv, t) - fv
		}
		df := func(r float64) float64 {
			const h = 1e-7
			return (f(r+h) - f(r-h)) / (2 * h)
		}
		if root, ok := finNewton(f, df, guess); ok {
			return numVal(root)
		}
		if root, ok := finBisect(f); ok {
			return numVal(root)
		}
		return errNum
	})
}

// ---------------------------------------------------------------------------
// NPV / IRR / XNPV / XIRR / MIRR
// ---------------------------------------------------------------------------

func init() {
	registerFunc("NPV", func(c *callCtx) value {
		rate, ok := c.num(0)
		if !ok {
			return errValue
		}
		// Collect cashflow values from args 1..n (flatten ranges).
		vals := make([]value, 0)
		for i := 1; i < c.nargs(); i++ {
			if rv, ok := c.rangeArg(i); ok {
				vals = append(vals, rv.flat()...)
			} else {
				vals = append(vals, c.scalar(i))
			}
		}
		nums, errv, iserr := finCollectNums(vals)
		if iserr {
			return errv
		}
		npv := 0.0
		for i, cf := range nums {
			npv += cf / finPow(rate, float64(i+1))
		}
		return numVal(npv)
	})

	registerFunc("IRR", func(c *callCtx) value {
		rv, ok := c.rangeArg(0)
		if !ok {
			return errValue
		}
		nums, errv, iserr := finRangeNums(rv)
		if iserr {
			return errv
		}
		if len(nums) < 2 {
			return errNum
		}
		guess, _ := c.numOr(1, 0.1)
		f := func(r float64) float64 {
			s := 0.0
			for i, cf := range nums {
				s += cf / finPow(r, float64(i))
			}
			return s
		}
		df := func(r float64) float64 {
			s := 0.0
			for i, cf := range nums {
				if i == 0 {
					continue
				}
				s += -float64(i) * cf / finPow(r, float64(i+1))
			}
			return s
		}
		if root, ok := finNewton(f, df, guess); ok && root > -1 {
			return numVal(root)
		}
		if root, ok := finBisect(f); ok {
			return numVal(root)
		}
		return errNum
	})

	registerFunc("XNPV", func(c *callCtx) value {
		rate, ok := c.num(0)
		if !ok {
			return errValue
		}
		vrv, ok1 := c.rangeArg(1)
		drv, ok2 := c.rangeArg(2)
		if !ok1 || !ok2 {
			return errValue
		}
		vals, errv, iserr := finRangeNums(vrv)
		if iserr {
			return errv
		}
		dates, errv2, iserr2 := finRangeNums(drv)
		if iserr2 {
			return errv2
		}
		if len(vals) != len(dates) || len(vals) == 0 {
			return errNum
		}
		d0 := serialToTime(dates[0])
		npv := 0.0
		for i, cf := range vals {
			di := serialToTime(dates[i])
			days := di.Sub(d0).Hours() / 24.0
			npv += cf / finPow(rate, days/365.0)
		}
		return numVal(npv)
	})

	registerFunc("XIRR", func(c *callCtx) value {
		vrv, ok1 := c.rangeArg(0)
		drv, ok2 := c.rangeArg(1)
		if !ok1 || !ok2 {
			return errValue
		}
		vals, errv, iserr := finRangeNums(vrv)
		if iserr {
			return errv
		}
		dates, errv2, iserr2 := finRangeNums(drv)
		if iserr2 {
			return errv2
		}
		if len(vals) != len(dates) || len(vals) < 2 {
			return errNum
		}
		guess, _ := c.numOr(2, 0.1)
		d0 := serialToTime(dates[0])
		offs := make([]float64, len(dates))
		for i := range dates {
			offs[i] = serialToTime(dates[i]).Sub(d0).Hours() / 24.0 / 365.0
		}
		f := func(r float64) float64 {
			s := 0.0
			for i, cf := range vals {
				s += cf / math.Pow(1+r, offs[i])
			}
			return s
		}
		df := func(r float64) float64 {
			s := 0.0
			for i, cf := range vals {
				s += -offs[i] * cf / math.Pow(1+r, offs[i]+1)
			}
			return s
		}
		if root, ok := finNewton(f, df, guess); ok && root > -1 {
			return numVal(root)
		}
		if root, ok := finBisect(f); ok {
			return numVal(root)
		}
		return errNum
	})

	registerFunc("MIRR", func(c *callCtx) value {
		rv, ok := c.rangeArg(0)
		if !ok {
			return errValue
		}
		nums, errv, iserr := finRangeNums(rv)
		if iserr {
			return errv
		}
		fr, ok1 := c.num(1)
		rr, ok2 := c.num(2)
		if !ok1 || !ok2 {
			return errValue
		}
		n := len(nums)
		if n < 2 {
			return errNum
		}
		posFV := 0.0
		negPV := 0.0
		for i, cf := range nums {
			if cf > 0 {
				posFV += cf * finPow(rr, float64(n-1-i))
			} else if cf < 0 {
				negPV += cf / finPow(fr, float64(i))
			}
		}
		if negPV == 0 || posFV == 0 {
			return errDiv0
		}
		ratio := -posFV / negPV
		if ratio <= 0 {
			return errNum
		}
		res := math.Pow(ratio, 1.0/float64(n-1)) - 1
		return numVal(res)
	})
}

// ---------------------------------------------------------------------------
// IPMT / PPMT / CUMIPMT / CUMPRINC
// ---------------------------------------------------------------------------

func init() {
	registerFunc("IPMT", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		per, ok2 := c.num(1)
		nper, ok3 := c.num(2)
		pv, ok4 := c.num(3)
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return errValue
		}
		fv, _ := c.numOr(4, 0)
		tf, _ := c.numOr(5, 0)
		if per < 1 || per > nper {
			return errNum
		}
		return numVal(finIpmt(rate, per, nper, pv, fv, int(tf)))
	})

	registerFunc("PPMT", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		per, ok2 := c.num(1)
		nper, ok3 := c.num(2)
		pv, ok4 := c.num(3)
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return errValue
		}
		fv, _ := c.numOr(4, 0)
		tf, _ := c.numOr(5, 0)
		if per < 1 || per > nper {
			return errNum
		}
		t := int(tf)
		pmt := finPmt(rate, nper, pv, fv, t)
		ipmt := finIpmt(rate, per, nper, pv, fv, t)
		return numVal(pmt - ipmt)
	})

	registerFunc("CUMIPMT", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		nper, ok2 := c.num(1)
		pv, ok3 := c.num(2)
		start, ok4 := c.num(3)
		end, ok5 := c.num(4)
		tf, ok6 := c.num(5)
		if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 {
			return errValue
		}
		if rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start || end > nper {
			return errNum
		}
		t := int(tf)
		sum := 0.0
		for p := int(start); p <= int(end); p++ {
			sum += finIpmt(rate, float64(p), nper, pv, 0, t)
		}
		return numVal(sum)
	})

	registerFunc("CUMPRINC", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		nper, ok2 := c.num(1)
		pv, ok3 := c.num(2)
		start, ok4 := c.num(3)
		end, ok5 := c.num(4)
		tf, ok6 := c.num(5)
		if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 {
			return errValue
		}
		if rate <= 0 || nper <= 0 || pv <= 0 || start < 1 || end < start || end > nper {
			return errNum
		}
		t := int(tf)
		pmt := finPmt(rate, nper, pv, 0, t)
		sum := 0.0
		for p := int(start); p <= int(end); p++ {
			ipmt := finIpmt(rate, float64(p), nper, pv, 0, t)
			sum += pmt - ipmt
		}
		return numVal(sum)
	})
}

// ---------------------------------------------------------------------------
// Depreciation: SLN / SYD / DB / DDB
// ---------------------------------------------------------------------------

func init() {
	registerFunc("SLN", func(c *callCtx) value {
		cost, ok1 := c.num(0)
		salvage, ok2 := c.num(1)
		life, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		if life == 0 {
			return errDiv0
		}
		return numVal((cost - salvage) / life)
	})

	registerFunc("SYD", func(c *callCtx) value {
		cost, ok1 := c.num(0)
		salvage, ok2 := c.num(1)
		life, ok3 := c.num(2)
		per, ok4 := c.num(3)
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return errValue
		}
		if life <= 0 || per < 1 || per > life {
			return errNum
		}
		return numVal((cost - salvage) * (life - per + 1) * 2 / (life * (life + 1)))
	})

	registerFunc("DB", func(c *callCtx) value {
		cost, ok1 := c.num(0)
		salvage, ok2 := c.num(1)
		life, ok3 := c.num(2)
		period, ok4 := c.num(3)
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return errValue
		}
		month, _ := c.numOr(4, 12)
		if cost < 0 || salvage < 0 || life <= 0 || period < 1 || month < 1 || month > 12 {
			return errNum
		}
		if cost == 0 {
			return numVal(0)
		}
		// Rate rounded to 3 decimal places per Excel.
		rate := 1 - math.Pow(salvage/cost, 1/life)
		rate = math.Round(rate*1000) / 1000
		// First period (partial year).
		first := cost * rate * month / 12
		if int(period) == 1 {
			return numVal(first)
		}
		// Accumulate depreciation through period-1, then compute period.
		total := first
		var dep float64
		maxP := int(period)
		if float64(maxP) > life {
			// final partial period handled separately below
		}
		for p := 2; p <= maxP; p++ {
			dep = (cost - total) * rate
			if p == int(life)+1 {
				dep = (cost - total) * rate * (12 - month) / 12
			}
			if p < maxP {
				total += dep
			}
		}
		return numVal(dep)
	})

	registerFunc("DDB", func(c *callCtx) value {
		cost, ok1 := c.num(0)
		salvage, ok2 := c.num(1)
		life, ok3 := c.num(2)
		period, ok4 := c.num(3)
		if !ok1 || !ok2 || !ok3 || !ok4 {
			return errValue
		}
		factor, _ := c.numOr(4, 2)
		if cost < 0 || salvage < 0 || life <= 0 || period < 1 || period > life || factor <= 0 {
			return errNum
		}
		rate := factor / life
		total := 0.0
		var dep float64
		for p := 1; p <= int(period); p++ {
			dep = (cost - total) * rate
			// Never depreciate below salvage.
			if cost-total-dep < salvage {
				dep = cost - total - salvage
			}
			if dep < 0 {
				dep = 0
			}
			total += dep
		}
		return numVal(dep)
	})
}

// ---------------------------------------------------------------------------
// Rate conversion & misc: EFFECT / NOMINAL / PDURATION / RRI / FVSCHEDULE
// ---------------------------------------------------------------------------

func init() {
	registerFunc("EFFECT", func(c *callCtx) value {
		nominal, ok1 := c.num(0)
		npery, ok2 := c.num(1)
		if !ok1 || !ok2 {
			return errValue
		}
		np := math.Floor(npery)
		if nominal <= 0 || np < 1 {
			return errNum
		}
		return numVal(math.Pow(1+nominal/np, np) - 1)
	})

	registerFunc("NOMINAL", func(c *callCtx) value {
		effect, ok1 := c.num(0)
		npery, ok2 := c.num(1)
		if !ok1 || !ok2 {
			return errValue
		}
		np := math.Floor(npery)
		if effect <= 0 || np < 1 {
			return errNum
		}
		return numVal((math.Pow(effect+1, 1/np) - 1) * np)
	})

	registerFunc("PDURATION", func(c *callCtx) value {
		rate, ok1 := c.num(0)
		pv, ok2 := c.num(1)
		fv, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		if rate <= 0 || pv <= 0 || fv <= 0 {
			return errNum
		}
		return numVal((math.Log(fv) - math.Log(pv)) / math.Log(1+rate))
	})

	registerFunc("RRI", func(c *callCtx) value {
		nper, ok1 := c.num(0)
		pv, ok2 := c.num(1)
		fv, ok3 := c.num(2)
		if !ok1 || !ok2 || !ok3 {
			return errValue
		}
		if nper <= 0 || pv == 0 {
			return errNum
		}
		ratio := fv / pv
		if ratio < 0 {
			return errNum
		}
		return numVal(math.Pow(ratio, 1/nper) - 1)
	})

	registerFunc("FVSCHEDULE", func(c *callCtx) value {
		principal, ok := c.num(0)
		if !ok {
			return errValue
		}
		rv, ok2 := c.rangeArg(1)
		var rates []float64
		if ok2 {
			r, errv, iserr := finRangeNums(rv)
			if iserr {
				return errv
			}
			rates = r
		} else {
			v := c.scalar(1)
			if v.isErr() {
				return v
			}
			if n, ok := v.toNum(); ok {
				rates = []float64{n}
			}
		}
		result := principal
		for _, r := range rates {
			result *= 1 + r
		}
		return numVal(result)
	})
}
