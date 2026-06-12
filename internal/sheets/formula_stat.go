// Package sheets — Excel-compatible STATISTICAL worksheet functions.
//
// This file registers the statistical function library (MEDIAN, MODE, STDEV,
// VAR, the *IF/*IFS family, ranking and percentile functions, correlation and
// regression helpers, and assorted descriptive-statistics functions) on top of
// the shared formula engine defined in formula.go.
//
// Numeric extraction follows Excel's conventions: text and booleans in a range
// are ignored by the plain aggregates (STDEV, VAR, MEDIAN, …), while the *A
// variants (AVERAGEA, MAXA, MINA, STDEVA) count text as 0 and booleans as 0/1.
// Input errors propagate; an empty data set where a value is required yields
// #DIV/0! or #NUM! to match Excel.
package sheets

import (
	"math"
	"sort"
)

func init() {
	registerFunc("MEDIAN", sttMedian)

	registerFunc("MODE", sttMode)
	registerFunc("MODE.SNGL", sttMode)

	registerFunc("STDEV", func(c *callCtx) value { return sttVarStdev(c, true, true, false) })
	registerFunc("STDEV.S", func(c *callCtx) value { return sttVarStdev(c, true, true, false) })
	registerFunc("STDEV.P", func(c *callCtx) value { return sttVarStdev(c, false, true, false) })
	registerFunc("STDEVP", func(c *callCtx) value { return sttVarStdev(c, false, true, false) })
	registerFunc("STDEVA", func(c *callCtx) value { return sttVarStdev(c, true, true, true) })

	registerFunc("VAR", func(c *callCtx) value { return sttVarStdev(c, true, false, false) })
	registerFunc("VAR.S", func(c *callCtx) value { return sttVarStdev(c, true, false, false) })
	registerFunc("VAR.P", func(c *callCtx) value { return sttVarStdev(c, false, false, false) })
	registerFunc("VARP", func(c *callCtx) value { return sttVarStdev(c, false, false, false) })

	registerFunc("COUNTIF", sttCountif)
	registerFunc("COUNTIFS", sttCountifs)
	registerFunc("AVERAGEIF", sttAverageif)
	registerFunc("AVERAGEIFS", sttAverageifs)
	registerFunc("MAXIFS", func(c *callCtx) value { return sttMinMaxifs(c, true) })
	registerFunc("MINIFS", func(c *callCtx) value { return sttMinMaxifs(c, false) })
	registerFunc("COUNTBLANK", sttCountblank)

	registerFunc("LARGE", func(c *callCtx) value { return sttLargeSmall(c, true) })
	registerFunc("SMALL", func(c *callCtx) value { return sttLargeSmall(c, false) })

	registerFunc("RANK", sttRankEq)
	registerFunc("RANK.EQ", sttRankEq)
	registerFunc("RANK.AVG", sttRankAvg)

	registerFunc("PERCENTILE", func(c *callCtx) value { return sttPercentile(c, true) })
	registerFunc("PERCENTILE.INC", func(c *callCtx) value { return sttPercentile(c, true) })
	registerFunc("PERCENTILE.EXC", func(c *callCtx) value { return sttPercentile(c, false) })

	registerFunc("QUARTILE", func(c *callCtx) value { return sttQuartile(c, true) })
	registerFunc("QUARTILE.INC", func(c *callCtx) value { return sttQuartile(c, true) })

	registerFunc("MINA", func(c *callCtx) value { return sttMinMaxA(c, false) })
	registerFunc("MAXA", func(c *callCtx) value { return sttMinMaxA(c, true) })
	registerFunc("AVERAGEA", sttAverageA)

	registerFunc("GEOMEAN", sttGeomean)
	registerFunc("HARMEAN", sttHarmean)

	registerFunc("CORREL", sttCorrel)
	registerFunc("PEARSON", sttCorrel)
	registerFunc("RSQ", sttRsq)
	registerFunc("COVAR", sttCovar)
	registerFunc("SLOPE", sttSlope)
	registerFunc("INTERCEPT", sttIntercept)
	registerFunc("FORECAST", sttForecast)
	registerFunc("FORECAST.LINEAR", sttForecast)

	registerFunc("TRIMMEAN", sttTrimmean)
	registerFunc("PERCENTRANK", sttPercentrank)

	registerFunc("DEVSQ", sttDevsq)
	registerFunc("AVEDEV", sttAvedev)
	registerFunc("STANDARDIZE", sttStandardize)
}

// ---- numeric extraction helpers --------------------------------------------

// sttNums pulls the numeric values out of a flat slice, ignoring text and
// (non-numeric) blanks the way Excel's STDEV/VAR/MEDIAN family does. Numbers
// and booleans count; text that does not parse is skipped. The first error
// encountered is returned via err.
func sttNums(vals []value) (nums []float64, err *value) {
	for i := range vals {
		v := vals[i]
		if v.isErr() {
			e := v
			return nil, &e
		}
		switch v.kind {
		case kindNum:
			nums = append(nums, v.num)
		case kindBool:
			// Plain numeric aggregates ignore booleans living in ranges; but a
			// boolean passed as a direct argument is counted. We cannot tell the
			// two apart here, so follow Excel's range behaviour: ignore.
			// (Direct-arg literals are rare in this engine.)
		case kindStr:
			// Ignored — text in a range is not counted.
		}
	}
	return nums, nil
}

// sttNumsArg gathers numbers from argument i (range or scalar).
func sttNumsArg(c *callCtx, i int) ([]float64, *value) {
	rv, ok := c.rangeArg(i)
	if !ok {
		return nil, nil
	}
	return sttNums(rv.flat())
}

// sttNumsA pulls numbers using the *A semantics: text counts as 0, booleans as
// 0/1, blanks ignored. Errors propagate.
func sttNumsA(vals []value) (nums []float64, err *value) {
	for i := range vals {
		v := vals[i]
		if v.isErr() {
			e := v
			return nil, &e
		}
		switch v.kind {
		case kindNum, kindBool:
			nums = append(nums, v.num)
		case kindStr:
			if v.str == "" {
				continue // blank
			}
			if n, ok := v.toNum(); ok {
				nums = append(nums, n)
			} else {
				nums = append(nums, 0) // text counts as 0
			}
		}
	}
	return nums, nil
}

func sttSum(xs []float64) float64 {
	s := 0.0
	for _, x := range xs {
		s += x
	}
	return s
}

func sttMean(xs []float64) float64 { return sttSum(xs) / float64(len(xs)) }

// ---- MEDIAN / MODE ----------------------------------------------------------

func sttMedian(c *callCtx) value {
	nums, err := sttNums(c.flat())
	if err != nil {
		return *err
	}
	n := len(nums)
	if n == 0 {
		return errNum
	}
	sort.Float64s(nums)
	if n%2 == 1 {
		return numVal(nums[n/2])
	}
	return numVal((nums[n/2-1] + nums[n/2]) / 2)
}

func sttMode(c *callCtx) value {
	nums, err := sttNums(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errNA
	}
	bestVal := 0.0
	bestCount := 0
	counts := make(map[float64]int)
	for _, x := range nums {
		counts[x]++
		// Track first value (by appearance order) that reaches a new max count.
	}
	// Determine the most frequent value, preferring earliest appearance on ties.
	seen := make(map[float64]bool)
	for _, x := range nums {
		if seen[x] {
			continue
		}
		seen[x] = true
		if counts[x] > bestCount {
			bestCount = counts[x]
			bestVal = x
		}
	}
	if bestCount < 2 {
		return errNA // no value appears more than once
	}
	return numVal(bestVal)
}

// ---- STDEV / VAR ------------------------------------------------------------

// sttVarStdev computes variance or standard deviation. sample chooses the n-1
// (true) vs n (false) divisor; stdev returns the square root when true; useA
// applies the *A counting rules.
func sttVarStdev(c *callCtx, sample, stdev, useA bool) value {
	var nums []float64
	var err *value
	if useA {
		nums, err = sttNumsA(c.flat())
	} else {
		nums, err = sttNums(c.flat())
	}
	if err != nil {
		return *err
	}
	n := len(nums)
	if sample {
		if n < 2 {
			return errDiv0
		}
	} else {
		if n < 1 {
			return errDiv0
		}
	}
	mean := sttMean(nums)
	ss := 0.0
	for _, x := range nums {
		d := x - mean
		ss += d * d
	}
	var divisor float64
	if sample {
		divisor = float64(n - 1)
	} else {
		divisor = float64(n)
	}
	variance := ss / divisor
	if stdev {
		return numVal(math.Sqrt(variance))
	}
	return numVal(variance)
}

// ---- COUNTIF / COUNTIFS -----------------------------------------------------

func sttCountif(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	rv, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	crit := parseCriteria(c.text(1))
	count := 0
	for _, v := range rv.flat() {
		if crit.match(v) {
			count++
		}
	}
	return numVal(float64(count))
}

func sttCountifs(c *callCtx) value {
	if c.nargs() < 2 || c.nargs()%2 != 0 {
		return errValue
	}
	pairs := c.nargs() / 2
	var ranges []rangeVal
	var crits []criteria
	var n int
	for p := 0; p < pairs; p++ {
		rv, ok := c.rangeArg(p * 2)
		if !ok {
			return errValue
		}
		if p == 0 {
			n = rv.rows * rv.cols
		} else if rv.rows*rv.cols != n {
			return errValue
		}
		ranges = append(ranges, rv)
		crits = append(crits, parseCriteria(c.text(p*2+1)))
	}
	count := 0
	for i := 0; i < n; i++ {
		all := true
		for p := 0; p < pairs; p++ {
			if !crits[p].match(sttCellAt(ranges[p], i)) {
				all = false
				break
			}
		}
		if all {
			count++
		}
	}
	return numVal(float64(count))
}

// sttCellAt returns the i-th cell (row-major) of a range.
func sttCellAt(rv rangeVal, i int) value {
	flat := rv.flat()
	if i < 0 || i >= len(flat) {
		return value{}
	}
	return flat[i]
}

// ---- AVERAGEIF / AVERAGEIFS -------------------------------------------------

func sttAverageif(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	rv, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	crit := parseCriteria(c.text(1))
	avgRange := rv
	if c.nargs() >= 3 {
		ar, ok2 := c.rangeArg(2)
		if !ok2 {
			return errValue
		}
		avgRange = ar
	}
	critCells := rv.flat()
	avgCells := avgRange.flat()
	sum := 0.0
	count := 0
	for i, cv := range critCells {
		if !crit.match(cv) {
			continue
		}
		if i >= len(avgCells) {
			continue
		}
		av := avgCells[i]
		if av.isErr() {
			return av
		}
		if av.kind == kindNum {
			sum += av.num
			count++
		}
	}
	if count == 0 {
		return errDiv0
	}
	return numVal(sum / float64(count))
}

func sttAverageifs(c *callCtx) value {
	if c.nargs() < 3 || c.nargs()%2 != 1 {
		return errValue
	}
	avgRange, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	avgCells := avgRange.flat()
	n := len(avgCells)
	pairs := (c.nargs() - 1) / 2
	var ranges []rangeVal
	var crits []criteria
	for p := 0; p < pairs; p++ {
		rv, ok2 := c.rangeArg(1 + p*2)
		if !ok2 {
			return errValue
		}
		if rv.rows*rv.cols != n {
			return errValue
		}
		ranges = append(ranges, rv)
		crits = append(crits, parseCriteria(c.text(1+p*2+1)))
	}
	sum := 0.0
	count := 0
	for i := 0; i < n; i++ {
		all := true
		for p := 0; p < pairs; p++ {
			if !crits[p].match(sttCellAt(ranges[p], i)) {
				all = false
				break
			}
		}
		if !all {
			continue
		}
		av := avgCells[i]
		if av.isErr() {
			return av
		}
		if av.kind == kindNum {
			sum += av.num
			count++
		}
	}
	if count == 0 {
		return errDiv0
	}
	return numVal(sum / float64(count))
}

// ---- MAXIFS / MINIFS --------------------------------------------------------

func sttMinMaxifs(c *callCtx, wantMax bool) value {
	if c.nargs() < 3 || c.nargs()%2 != 1 {
		return errValue
	}
	valRange, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	valCells := valRange.flat()
	n := len(valCells)
	pairs := (c.nargs() - 1) / 2
	var ranges []rangeVal
	var crits []criteria
	for p := 0; p < pairs; p++ {
		rv, ok2 := c.rangeArg(1 + p*2)
		if !ok2 {
			return errValue
		}
		if rv.rows*rv.cols != n {
			return errValue
		}
		ranges = append(ranges, rv)
		crits = append(crits, parseCriteria(c.text(1+p*2+1)))
	}
	best := 0.0
	found := false
	for i := 0; i < n; i++ {
		all := true
		for p := 0; p < pairs; p++ {
			if !crits[p].match(sttCellAt(ranges[p], i)) {
				all = false
				break
			}
		}
		if !all {
			continue
		}
		v := valCells[i]
		if v.isErr() {
			return v
		}
		if v.kind != kindNum {
			continue
		}
		if !found {
			best = v.num
			found = true
		} else if wantMax && v.num > best {
			best = v.num
		} else if !wantMax && v.num < best {
			best = v.num
		}
	}
	if !found {
		return numVal(0)
	}
	return numVal(best)
}

// ---- COUNTBLANK -------------------------------------------------------------

func sttCountblank(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	count := 0
	for _, v := range rv.flat() {
		// Blank = empty cell (modelled as numeric 0 default) or empty string.
		if v.kind == kindStr && v.str == "" {
			count++
		}
	}
	return numVal(float64(count))
}

// ---- LARGE / SMALL ----------------------------------------------------------

func sttLargeSmall(c *callCtx, large bool) value {
	if c.nargs() < 2 {
		return errNA
	}
	nums, err := sttNumsArg(c, 0)
	if err != nil {
		return *err
	}
	kf, ok := c.num(1)
	if !ok {
		return errNum
	}
	k := int(math.Trunc(kf))
	n := len(nums)
	if n == 0 || k < 1 || k > n {
		return errNum
	}
	sort.Float64s(nums)
	if large {
		return numVal(nums[n-k])
	}
	return numVal(nums[k-1])
}

// ---- RANK -------------------------------------------------------------------

// sttRank computes the rank of num within nums. order: 0 (or omitted) descending,
// non-zero ascending. avg returns the average rank for ties.
func sttRankCompute(num float64, nums []float64, ascending, avg bool) (float64, bool) {
	// Count strictly-better and equal entries.
	better := 0
	equal := 0
	found := false
	for _, x := range nums {
		if x == num {
			equal++
			found = true
		} else if ascending {
			if x < num {
				better++
			}
		} else {
			if x > num {
				better++
			}
		}
	}
	if !found {
		return 0, false
	}
	rank := float64(better) + 1
	if avg && equal > 1 {
		// Average of the consecutive ranks the tied group occupies.
		rank += float64(equal-1) / 2.0
	}
	return rank, true
}

func sttRankEq(c *callCtx) value  { return sttRankImpl(c, false) }
func sttRankAvg(c *callCtx) value { return sttRankImpl(c, true) }

func sttRankImpl(c *callCtx, avg bool) value {
	if c.nargs() < 2 {
		return errNA
	}
	num, ok := c.num(0)
	if !ok {
		return errValue
	}
	nums, err := sttNumsArg(c, 1)
	if err != nil {
		return *err
	}
	ascending := false
	if c.nargs() >= 3 {
		o, ok2 := c.num(2)
		if !ok2 {
			return errValue
		}
		ascending = o != 0
	}
	rank, found := sttRankCompute(num, nums, ascending, avg)
	if !found {
		return errNA
	}
	return numVal(rank)
}

// ---- PERCENTILE / QUARTILE --------------------------------------------------

// sttPercentileOf computes the k-th percentile of sorted nums. inc selects the
// inclusive (k∈[0,1]) interpolation vs the exclusive (n+1) method.
func sttPercentileOf(sorted []float64, k float64, inc bool) (float64, bool) {
	n := len(sorted)
	if n == 0 {
		return 0, false
	}
	if inc {
		if k < 0 || k > 1 {
			return 0, false
		}
		if n == 1 {
			return sorted[0], true
		}
		pos := k * float64(n-1) // 0-based fractional index
		lo := int(math.Floor(pos))
		frac := pos - float64(lo)
		if lo >= n-1 {
			return sorted[n-1], true
		}
		return sorted[lo] + frac*(sorted[lo+1]-sorted[lo]), true
	}
	// Exclusive method.
	if k <= 0 || k >= 1 {
		return 0, false
	}
	pos := k*float64(n+1) - 1 // 0-based fractional index
	if pos < 0 || pos > float64(n-1) {
		return 0, false
	}
	lo := int(math.Floor(pos))
	frac := pos - float64(lo)
	if lo >= n-1 {
		return sorted[n-1], true
	}
	return sorted[lo] + frac*(sorted[lo+1]-sorted[lo]), true
}

func sttPercentile(c *callCtx, inc bool) value {
	if c.nargs() < 2 {
		return errNA
	}
	nums, err := sttNumsArg(c, 0)
	if err != nil {
		return *err
	}
	k, ok := c.num(1)
	if !ok {
		return errNum
	}
	if len(nums) == 0 {
		return errNum
	}
	sort.Float64s(nums)
	res, ok := sttPercentileOf(nums, k, inc)
	if !ok {
		return errNum
	}
	return numVal(res)
}

func sttQuartile(c *callCtx, inc bool) value {
	if c.nargs() < 2 {
		return errNA
	}
	nums, err := sttNumsArg(c, 0)
	if err != nil {
		return *err
	}
	qf, ok := c.num(1)
	if !ok {
		return errNum
	}
	q := int(math.Trunc(qf))
	if q < 0 || q > 4 || len(nums) == 0 {
		return errNum
	}
	sort.Float64s(nums)
	res, ok := sttPercentileOf(nums, float64(q)/4.0, inc)
	if !ok {
		return errNum
	}
	return numVal(res)
}

// ---- MINA / MAXA / AVERAGEA -------------------------------------------------

func sttMinMaxA(c *callCtx, wantMax bool) value {
	nums, err := sttNumsA(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return numVal(0)
	}
	best := nums[0]
	for _, x := range nums[1:] {
		if wantMax && x > best {
			best = x
		} else if !wantMax && x < best {
			best = x
		}
	}
	return numVal(best)
}

func sttAverageA(c *callCtx) value {
	nums, err := sttNumsA(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errDiv0
	}
	return numVal(sttMean(nums))
}

// ---- GEOMEAN / HARMEAN ------------------------------------------------------

func sttGeomean(c *callCtx) value {
	nums, err := sttNums(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errNum
	}
	sumLog := 0.0
	for _, x := range nums {
		if x <= 0 {
			return errNum
		}
		sumLog += math.Log(x)
	}
	return numVal(math.Exp(sumLog / float64(len(nums))))
}

func sttHarmean(c *callCtx) value {
	nums, err := sttNums(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errNum
	}
	sumRecip := 0.0
	for _, x := range nums {
		if x <= 0 {
			return errNum
		}
		sumRecip += 1.0 / x
	}
	return numVal(float64(len(nums)) / sumRecip)
}

// ---- paired-series helpers (CORREL, COVAR, regression) ----------------------

// sttPairs extracts aligned numeric pairs from two range arguments, skipping any
// position where either side is non-numeric. Returns the first error found.
func sttPairs(c *callCtx, ai, bi int) (xs, ys []float64, err *value, badShape bool) {
	ra, oka := c.rangeArg(ai)
	rb, okb := c.rangeArg(bi)
	if !oka || !okb {
		return nil, nil, nil, true
	}
	fa := ra.flat()
	fb := rb.flat()
	if len(fa) != len(fb) {
		return nil, nil, nil, true
	}
	for i := range fa {
		if fa[i].isErr() {
			e := fa[i]
			return nil, nil, &e, false
		}
		if fb[i].isErr() {
			e := fb[i]
			return nil, nil, &e, false
		}
		if fa[i].kind != kindNum || fb[i].kind != kindNum {
			continue
		}
		xs = append(xs, fa[i].num)
		ys = append(ys, fb[i].num)
	}
	return xs, ys, nil, false
}

// sttSums returns n, Σx, Σy, Σxy, Σx², Σy² for paired series.
func sttSums(xs, ys []float64) (n float64, sx, sy, sxy, sxx, syy float64) {
	n = float64(len(xs))
	for i := range xs {
		x, y := xs[i], ys[i]
		sx += x
		sy += y
		sxy += x * y
		sxx += x * x
		syy += y * y
	}
	return
}

func sttCorrelOf(xs, ys []float64) (float64, bool) {
	n, sx, sy, sxy, sxx, syy := sttSums(xs, ys)
	if n == 0 {
		return 0, false
	}
	covN := n*sxy - sx*sy
	denom := math.Sqrt((n*sxx - sx*sx) * (n*syy - sy*sy))
	if denom == 0 {
		return 0, false
	}
	return covN / denom, true
}

func sttCorrel(c *callCtx) value {
	xs, ys, err, bad := sttPairs(c, 0, 1)
	if bad {
		return errNA
	}
	if err != nil {
		return *err
	}
	r, ok := sttCorrelOf(xs, ys)
	if !ok {
		return errDiv0
	}
	return numVal(r)
}

func sttRsq(c *callCtx) value {
	xs, ys, err, bad := sttPairs(c, 0, 1)
	if bad {
		return errNA
	}
	if err != nil {
		return *err
	}
	r, ok := sttCorrelOf(xs, ys)
	if !ok {
		return errDiv0
	}
	return numVal(r * r)
}

func sttCovar(c *callCtx) value {
	xs, ys, err, bad := sttPairs(c, 0, 1)
	if bad {
		return errNA
	}
	if err != nil {
		return *err
	}
	n, sx, sy, sxy, _, _ := sttSums(xs, ys)
	if n == 0 {
		return errDiv0
	}
	// Population covariance (COVAR / COVARIANCE.P): divide by n.
	return numVal((sxy - sx*sy/n) / n)
}

// sttSlopeIntercept returns the least-squares slope and intercept of y on x.
func sttSlopeIntercept(ys, xs []float64) (slope, intercept float64, ok bool) {
	n, sx, sy, sxy, sxx, _ := sttSums(xs, ys)
	if n == 0 {
		return 0, 0, false
	}
	denom := n*sxx - sx*sx
	if denom == 0 {
		return 0, 0, false
	}
	slope = (n*sxy - sx*sy) / denom
	intercept = (sy - slope*sx) / n
	return slope, intercept, true
}

func sttSlope(c *callCtx) value {
	// SLOPE(known_ys, known_xs)
	ys, xs, err, bad := sttPairs(c, 0, 1)
	if bad {
		return errNA
	}
	if err != nil {
		return *err
	}
	slope, _, ok := sttSlopeIntercept(ys, xs)
	if !ok {
		return errDiv0
	}
	return numVal(slope)
}

func sttIntercept(c *callCtx) value {
	// INTERCEPT(known_ys, known_xs)
	ys, xs, err, bad := sttPairs(c, 0, 1)
	if bad {
		return errNA
	}
	if err != nil {
		return *err
	}
	_, intercept, ok := sttSlopeIntercept(ys, xs)
	if !ok {
		return errDiv0
	}
	return numVal(intercept)
}

func sttForecast(c *callCtx) value {
	// FORECAST(x, known_ys, known_xs)
	if c.nargs() < 3 {
		return errNA
	}
	x, ok := c.num(0)
	if !ok {
		return errValue
	}
	ys, xs, err, bad := sttPairs(c, 1, 2)
	if bad {
		return errNA
	}
	if err != nil {
		return *err
	}
	slope, intercept, ok2 := sttSlopeIntercept(ys, xs)
	if !ok2 {
		return errDiv0
	}
	return numVal(intercept + slope*x)
}

// ---- TRIMMEAN / PERCENTRANK -------------------------------------------------

func sttTrimmean(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	nums, err := sttNumsArg(c, 0)
	if err != nil {
		return *err
	}
	pct, ok := c.num(1)
	if !ok {
		return errNum
	}
	if pct < 0 || pct >= 1 {
		return errNum
	}
	n := len(nums)
	if n == 0 {
		return errNum
	}
	sort.Float64s(nums)
	// Number to trim total, rounded down to an even number, split each end.
	trim := int(math.Floor(float64(n) * pct))
	if trim%2 != 0 {
		trim--
	}
	half := trim / 2
	kept := nums[half : n-half]
	if len(kept) == 0 {
		return errNum
	}
	return numVal(sttMean(kept))
}

func sttPercentrank(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	nums, err := sttNumsArg(c, 0)
	if err != nil {
		return *err
	}
	x, ok := c.num(1)
	if !ok {
		return errNum
	}
	n := len(nums)
	if n == 0 {
		return errNum
	}
	sort.Float64s(nums)
	if x < nums[0] || x > nums[n-1] {
		return errNA
	}
	sig := 3
	if c.nargs() >= 3 {
		s, ok2 := c.num(2)
		if !ok2 {
			return errNum
		}
		sig = int(math.Trunc(s))
		if sig < 1 {
			return errNum
		}
	}
	rank := sttPercentRankOf(nums, x)
	// Truncate to `sig` significant digits (Excel truncates, does not round).
	factor := math.Pow(10, float64(sig))
	rank = math.Trunc(rank*factor) / factor
	return numVal(rank)
}

// sttPercentRankOf returns the relative rank (0..1) of x within sorted nums,
// interpolating between bracketing values as Excel's PERCENTRANK.INC does.
func sttPercentRankOf(sorted []float64, x float64) float64 {
	n := len(sorted)
	// Exact match → use its (possibly first) index.
	for i := 0; i < n; i++ {
		if sorted[i] == x {
			return float64(i) / float64(n-1)
		}
		if sorted[i] > x {
			// x lies between i-1 and i.
			lo := sorted[i-1]
			hi := sorted[i]
			base := float64(i-1) / float64(n-1)
			step := (1.0 / float64(n-1)) * (x - lo) / (hi - lo)
			return base + step
		}
	}
	return 1
}

// ---- DEVSQ / AVEDEV / STANDARDIZE -------------------------------------------

func sttDevsq(c *callCtx) value {
	nums, err := sttNums(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errNum
	}
	mean := sttMean(nums)
	ss := 0.0
	for _, x := range nums {
		d := x - mean
		ss += d * d
	}
	return numVal(ss)
}

func sttAvedev(c *callCtx) value {
	nums, err := sttNums(c.flat())
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errNum
	}
	mean := sttMean(nums)
	sum := 0.0
	for _, x := range nums {
		sum += math.Abs(x - mean)
	}
	return numVal(sum / float64(len(nums)))
}

func sttStandardize(c *callCtx) value {
	if c.nargs() < 3 {
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
	return numVal((x - mean) / sd)
}
