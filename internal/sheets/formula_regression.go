package sheets

import (
	"math"
	"math/rand"
)

// Linear/exponential regression spill functions plus RANDARRAY. LINEST/TREND fit
// y = m·x + b by least squares (reusing sttSlopeIntercept); LOGEST/GROWTH fit the
// exponential y = b·m^x via a regression on ln(y). The optional `const` argument
// (force intercept through the origin) is not yet supported — intercept is always
// fitted.

func init() {
	registerFunc("LINEST", sttLinest)
	registerFunc("LOGEST", sttLogest)
	registerFunc("TREND", sttTrend)
	registerFunc("GROWTH", sttGrowth)
	registerFunc("RANDARRAY", arrRandArray)
}

// numCol flattens range/array argument i into numeric values, skipping blanks.
// ok is false when the argument is absent; an error cell propagates as ok=false.
func numCol(c *callCtx, i int) ([]float64, bool) {
	if c.raw(i) == nil {
		return nil, false
	}
	rv, ok := c.rangeArg(i)
	if !ok {
		return nil, false
	}
	var out []float64
	for _, v := range rv.flat() {
		if v.isErr() {
			return nil, false
		}
		if v.kind == kindNum {
			out = append(out, v.num)
		}
	}
	return out, true
}

func seqFloats(n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = float64(i + 1)
	}
	return out
}

// knownXsOrSeq returns known_xs from arg 1, defaulting to 1..n when absent.
func knownXsOrSeq(c *callCtx, n int) ([]float64, bool) {
	if c.raw(1) == nil {
		return seqFloats(n), true
	}
	xs, ok := numCol(c, 1)
	if !ok {
		return nil, false
	}
	if len(xs) == 0 {
		return seqFloats(n), true
	}
	return xs, true
}

// orientedSpill returns predictions shaped to match the source argument's
// orientation (a single-row source spills horizontally, otherwise vertically).
func orientedSpill(c *callCtx, srcIdx int, preds []float64) value {
	horizontal := false
	if rv, ok := c.rangeArg(srcIdx); ok && rv.rows == 1 && rv.cols > 1 {
		horizontal = true
	}
	if horizontal {
		row := make([]value, len(preds))
		for i, p := range preds {
			row[i] = numVal(p)
		}
		return arrayValue([][]value{row})
	}
	cells := make([][]value, len(preds))
	for i, p := range preds {
		cells[i] = []value{numVal(p)}
	}
	return arrayValue(cells)
}

func sttLinest(c *callCtx) value {
	ys, ok := numCol(c, 0)
	if !ok || len(ys) == 0 {
		return errNA
	}
	xs, ok := knownXsOrSeq(c, len(ys))
	if !ok {
		return errValue
	}
	if len(xs) != len(ys) {
		return errNA
	}
	slope, intercept, ok2 := sttSlopeIntercept(ys, xs)
	if !ok2 {
		return errDiv0
	}
	// {slope, intercept} as a horizontal array (Excel's order).
	return arrayValue([][]value{{numVal(slope), numVal(intercept)}})
}

func sttLogest(c *callCtx) value {
	ys, ok := numCol(c, 0)
	if !ok || len(ys) == 0 {
		return errNA
	}
	xs, ok := knownXsOrSeq(c, len(ys))
	if !ok {
		return errValue
	}
	if len(xs) != len(ys) {
		return errNA
	}
	lnys := make([]float64, 0, len(ys))
	xs2 := make([]float64, 0, len(xs))
	for i, y := range ys {
		if y <= 0 {
			return errNum
		}
		lnys = append(lnys, math.Log(y))
		xs2 = append(xs2, xs[i])
	}
	slope, intercept, ok2 := sttSlopeIntercept(lnys, xs2)
	if !ok2 {
		return errDiv0
	}
	// y = b·m^x → m = e^slope, b = e^intercept. Excel returns {m, b}.
	return arrayValue([][]value{{numVal(math.Exp(slope)), numVal(math.Exp(intercept))}})
}

func sttTrend(c *callCtx) value {
	ys, ok := numCol(c, 0)
	if !ok || len(ys) == 0 {
		return errNA
	}
	xs, ok := knownXsOrSeq(c, len(ys))
	if !ok {
		return errValue
	}
	if len(xs) != len(ys) {
		return errNA
	}
	slope, intercept, ok2 := sttSlopeIntercept(ys, xs)
	if !ok2 {
		return errDiv0
	}
	newxs := xs
	srcIdx := 0
	if c.raw(2) != nil {
		nx, ok := numCol(c, 2)
		if !ok {
			return errValue
		}
		newxs = nx
		srcIdx = 2
	}
	preds := make([]float64, len(newxs))
	for i, x := range newxs {
		preds[i] = intercept + slope*x
	}
	return orientedSpill(c, srcIdx, preds)
}

func sttGrowth(c *callCtx) value {
	ys, ok := numCol(c, 0)
	if !ok || len(ys) == 0 {
		return errNA
	}
	xs, ok := knownXsOrSeq(c, len(ys))
	if !ok {
		return errValue
	}
	if len(xs) != len(ys) {
		return errNA
	}
	lnys := make([]float64, len(ys))
	for i, y := range ys {
		if y <= 0 {
			return errNum
		}
		lnys[i] = math.Log(y)
	}
	slope, intercept, ok2 := sttSlopeIntercept(lnys, xs)
	if !ok2 {
		return errDiv0
	}
	newxs := xs
	srcIdx := 0
	if c.raw(2) != nil {
		nx, ok := numCol(c, 2)
		if !ok {
			return errValue
		}
		newxs = nx
		srcIdx = 2
	}
	preds := make([]float64, len(newxs))
	for i, x := range newxs {
		preds[i] = math.Exp(intercept + slope*x)
	}
	return orientedSpill(c, srcIdx, preds)
}

// RANDARRAY([rows],[cols],[min],[max],[whole_number]) spills random numbers.
func arrRandArray(c *callCtx) value {
	rows, cols := 1, 1
	if n, ok := c.num(0); ok && c.raw(0) != nil {
		rows = int(n)
	}
	if n, ok := c.num(1); ok && c.raw(1) != nil {
		cols = int(n)
	}
	if rows < 1 || cols < 1 {
		return errValue
	}
	lo, hi := 0.0, 1.0
	if n, ok := c.num(2); ok && c.raw(2) != nil {
		lo = n
	}
	if n, ok := c.num(3); ok && c.raw(3) != nil {
		hi = n
	}
	if hi < lo {
		return errValue
	}
	whole := false
	if c.raw(4) != nil {
		whole = c.scalar(4).isTruthy()
	}
	cells := make([][]value, rows)
	for r := 0; r < rows; r++ {
		row := make([]value, cols)
		for col := 0; col < cols; col++ {
			v := lo + rand.Float64()*(hi-lo)
			if whole {
				v = math.Floor(lo + rand.Float64()*(hi-lo+1))
			}
			row[col] = numVal(v)
		}
		cells[r] = row
	}
	return arrayValue(cells)
}
