package sheets

import "strings"

// SPARKLINE(data, [options]) renders an in-cell mini-chart. FortuneSheet has no
// graphical sparkline support, so we approximate it with Unicode block glyphs
// returned as the cell's string value — a "text sparkline" that renders in the
// existing grid with no overlay plumbing. charttype "line"/"column"/"bar"
// (default) map values onto eight block heights ▁▂▃▄▅▆▇█; "winloss" maps
// positive/negative/zero to ▀/▄/─. (A pixel-accurate graphical sparkline is a
// later enhancement.)

func init() { registerFunc("SPARKLINE", fnSparkline) }

var sparkBlocks = []rune("▁▂▃▄▅▆▇█")

func fnSparkline(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	var nums []float64
	for _, row := range rv.cells {
		for _, cell := range row {
			if n, ok := cell.toNum(); ok && cell.kind != kindStr {
				nums = append(nums, n)
			}
		}
	}
	if len(nums) == 0 {
		return strVal("")
	}

	charttype := "column"
	if c.nargs() >= 2 {
		if v := sparklineOption(c.raw(1), "charttype"); v != "" {
			charttype = strings.ToLower(v)
		}
	}

	if charttype == "winloss" {
		var b strings.Builder
		for _, n := range nums {
			switch {
			case n > 0:
				b.WriteRune('▀')
			case n < 0:
				b.WriteRune('▄')
			default:
				b.WriteRune('─')
			}
		}
		return strVal(b.String())
	}

	// Bar/line/column: scale each value across [min,max] onto the eight blocks.
	lo, hi := nums[0], nums[0]
	for _, n := range nums {
		if n < lo {
			lo = n
		}
		if n > hi {
			hi = n
		}
	}
	var b strings.Builder
	for _, n := range nums {
		idx := 0
		if hi > lo {
			idx = int((n - lo) / (hi - lo) * float64(len(sparkBlocks)-1))
			if idx < 0 {
				idx = 0
			}
			if idx >= len(sparkBlocks) {
				idx = len(sparkBlocks) - 1
			}
		} else {
			idx = (len(sparkBlocks) - 1) / 2 // flat series → mid height
		}
		b.WriteRune(sparkBlocks[idx])
	}
	return strVal(b.String())
}

// sparklineOption extracts a named option from SPARKLINE's second argument,
// which may be a 2-column {key,value} range or array, or a bare scalar (treated
// as the charttype). Returns "" when not found.
func sparklineOption(arg interface{}, key string) string {
	switch v := arg.(type) {
	case rangeVal:
		return optionFromCells(v.cells, key)
	case value:
		if v.kind == kindArray && v.arr != nil {
			return optionFromCells(v.arr.cells, key)
		}
		// a bare scalar option is the charttype
		if key == "charttype" {
			return v.toStr()
		}
	}
	return ""
}

func optionFromCells(cells [][]value, key string) string {
	for _, row := range cells {
		if len(row) >= 2 && strings.EqualFold(strings.TrimSpace(row[0].toStr()), key) {
			return row[1].toStr()
		}
	}
	return ""
}
