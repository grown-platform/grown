package sheets

import (
	"math"
	"math/rand"
)

// RANDARRAY. The regression functions (LINEST, LOGEST, TREND, GROWTH) live in
// formula_stat_regression.go.

func init() {
	registerFunc("RANDARRAY", arrRandArray)
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
