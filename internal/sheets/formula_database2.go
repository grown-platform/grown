package sheets

import "math"

// formula_database2.go — population variants of the database statistics:
// DVARP and DSTDEVP (divide by n rather than n−1). Record selection is shared
// with the other D* functions via dbSelect.

func init() {
	registerFunc("DVARP", func(c *callCtx) value { return db2PopVar(c, false) })
	registerFunc("DSTDEVP", func(c *callCtx) value { return db2PopVar(c, true) })
}

func db2PopVar(c *callCtx, stdev bool) value {
	_, nums, ok := dbSelect(c)
	if !ok {
		return errValue
	}
	if len(nums) == 0 {
		return errDiv0
	}
	mean := 0.0
	for _, n := range nums {
		mean += n
	}
	mean /= float64(len(nums))
	ss := 0.0
	for _, n := range nums {
		ss += (n - mean) * (n - mean)
	}
	v := ss / float64(len(nums))
	if stdev {
		return numVal(math.Sqrt(v))
	}
	return numVal(v)
}
