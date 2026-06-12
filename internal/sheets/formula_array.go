package sheets

import (
	"math"
	"sort"
	"strings"
)

// Dynamic-array (spilling) worksheet functions. Each returns a 2D result via
// arrayValue(...); Recompute writes the top-left into the formula cell and
// spills the rest into the neighbouring cells (or #SPILL! if blocked).
//
// Supported: SEQUENCE, TRANSPOSE, UNIQUE, SORT, SORTBY, FILTER.
// Known limitation: a formula that reads INTO another formula's spill range may
// see pre-spill values within the same recompute pass (no spill-aware
// dependency ordering yet).

func init() {
	registerFunc("SEQUENCE", arrSequence)
	registerFunc("TRANSPOSE", arrTranspose)
	registerFunc("UNIQUE", arrUnique)
	registerFunc("SORT", arrSort)
	registerFunc("SORTBY", arrSortBy)
	registerFunc("FILTER", arrFilter)
}

// arrCmp orders two values: numbers numerically and before text; text
// case-insensitively. Errors sort last.
func arrCmp(a, b value) int {
	an, aok := a.toNum()
	bn, bok := b.toNum()
	aNum := aok && a.kind != kindStr
	bNum := bok && b.kind != kindStr
	switch {
	case a.isErr() && b.isErr():
		return strings.Compare(a.str, b.str)
	case a.isErr():
		return 1
	case b.isErr():
		return -1
	case aNum && bNum:
		switch {
		case an < bn:
			return -1
		case an > bn:
			return 1
		default:
			return 0
		}
	case aNum:
		return -1
	case bNum:
		return 1
	default:
		return strings.Compare(strings.ToUpper(a.toStr()), strings.ToUpper(b.toStr()))
	}
}

// SEQUENCE(rows, [cols=1], [start=1], [step=1]).
func arrSequence(c *callCtx) value {
	rf, ok := c.num(0)
	if !ok {
		return errValue
	}
	rows := int(math.Trunc(rf))
	cols := 1
	if c.nargs() >= 2 {
		cf, ok := c.num(1)
		if !ok {
			return errValue
		}
		cols = int(math.Trunc(cf))
	}
	start, ok := c.numOr(2, 1)
	if !ok {
		return errValue
	}
	step, ok := c.numOr(3, 1)
	if !ok {
		return errValue
	}
	if rows <= 0 || cols <= 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, rows)
	n := start
	for r := 0; r < rows; r++ {
		out[r] = make([]value, cols)
		for cc := 0; cc < cols; cc++ {
			out[r][cc] = numVal(n)
			n += step
		}
	}
	return arrayValue(out)
}

// TRANSPOSE(array) — swap rows and columns.
func arrTranspose(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	if rv.rows == 0 || rv.cols == 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, rv.cols)
	for cc := 0; cc < rv.cols; cc++ {
		out[cc] = make([]value, rv.rows)
		for r := 0; r < rv.rows; r++ {
			out[cc][r] = rv.cells[r][cc]
		}
	}
	return arrayValue(out)
}

// arrRowKey builds a comparison/equality key for a whole row.
func arrRowKey(row []value) string {
	var b strings.Builder
	for _, v := range row {
		b.WriteByte(byte(v.kind) + 1)
		b.WriteString(v.toStr())
		b.WriteByte(0)
	}
	return b.String()
}

// UNIQUE(array, [by_col=FALSE], [exactly_once=FALSE]).
func arrUnique(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	byCol := c.nargs() >= 2 && c.scalar(1).isTruthy()
	exactlyOnce := c.nargs() >= 3 && c.scalar(2).isTruthy()

	// Work in terms of "lines" (rows, or columns when by_col).
	var lines [][]value
	if byCol {
		for cc := 0; cc < rv.cols; cc++ {
			line := make([]value, rv.rows)
			for r := 0; r < rv.rows; r++ {
				line[r] = rv.cells[r][cc]
			}
			lines = append(lines, line)
		}
	} else {
		for r := 0; r < rv.rows; r++ {
			lines = append(lines, rv.cells[r])
		}
	}

	counts := map[string]int{}
	order := []string{}
	byKey := map[string][]value{}
	for _, ln := range lines {
		k := arrRowKey(ln)
		if _, seen := counts[k]; !seen {
			order = append(order, k)
			byKey[k] = ln
		}
		counts[k]++
	}
	var kept [][]value
	for _, k := range order {
		if exactlyOnce && counts[k] != 1 {
			continue
		}
		kept = append(kept, byKey[k])
	}
	if len(kept) == 0 {
		return errVal("#CALC!")
	}
	if byCol {
		// kept lines are columns → rebuild a column-oriented array.
		rows := len(kept[0])
		out := make([][]value, rows)
		for r := 0; r < rows; r++ {
			out[r] = make([]value, len(kept))
			for ci, ln := range kept {
				out[r][ci] = ln[r]
			}
		}
		return arrayValue(out)
	}
	return arrayValue(kept)
}

// SORT(array, [sort_index=1], [sort_order=1], [by_col=FALSE]).
func arrSort(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	idxF, _ := c.numOr(1, 1)
	idx := int(math.Trunc(idxF)) - 1 // 0-based
	orderF, _ := c.numOr(2, 1)
	asc := orderF >= 0
	byCol := c.nargs() >= 4 && c.scalar(3).isTruthy()
	return arrSortLines(rv, idx, asc, byCol)
}

func arrSortLines(rv rangeVal, idx int, asc, byCol bool) value {
	if rv.rows == 0 || rv.cols == 0 {
		return errVal("#CALC!")
	}
	if byCol {
		cols := make([][]value, rv.cols)
		for cc := 0; cc < rv.cols; cc++ {
			col := make([]value, rv.rows)
			for r := 0; r < rv.rows; r++ {
				col[r] = rv.cells[r][cc]
			}
			cols[cc] = col
		}
		if idx < 0 || idx >= rv.rows {
			return errValue
		}
		sort.SliceStable(cols, func(i, j int) bool {
			cmp := arrCmp(cols[i][idx], cols[j][idx])
			if asc {
				return cmp < 0
			}
			return cmp > 0
		})
		out := make([][]value, rv.rows)
		for r := 0; r < rv.rows; r++ {
			out[r] = make([]value, rv.cols)
			for cc := 0; cc < rv.cols; cc++ {
				out[r][cc] = cols[cc][r]
			}
		}
		return arrayValue(out)
	}
	if idx < 0 || idx >= rv.cols {
		return errValue
	}
	rows := make([][]value, rv.rows)
	copy(rows, rv.cells)
	sort.SliceStable(rows, func(i, j int) bool {
		cmp := arrCmp(rows[i][idx], rows[j][idx])
		if asc {
			return cmp < 0
		}
		return cmp > 0
	})
	return arrayValue(rows)
}

// SORTBY(array, by_array1, [order1], by_array2, [order2], ...).
func arrSortBy(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	if rv.rows == 0 {
		return errVal("#CALC!")
	}
	// Collect (key column, order) pairs.
	type keyer struct {
		vals []value
		asc  bool
	}
	var keys []keyer
	for i := 1; i < c.nargs(); i += 2 {
		kr, ok := c.rangeArg(i)
		if !ok {
			return errValue
		}
		vals := kr.flat()
		if len(vals) != rv.rows {
			return errValue
		}
		asc := true
		if i+1 < c.nargs() {
			o, _ := c.num(i + 1)
			asc = o >= 0
		}
		keys = append(keys, keyer{vals: vals, asc: asc})
	}
	if len(keys) == 0 {
		return errValue
	}
	idx := make([]int, rv.rows)
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		for _, k := range keys {
			cmp := arrCmp(k.vals[idx[a]], k.vals[idx[b]])
			if cmp != 0 {
				if k.asc {
					return cmp < 0
				}
				return cmp > 0
			}
		}
		return false
	})
	out := make([][]value, rv.rows)
	for i, ri := range idx {
		out[i] = rv.cells[ri]
	}
	return arrayValue(out)
}

// FILTER(array, include, [if_empty]) — keep rows (or columns) where the include
// vector is truthy. include must be a single column matching the array height
// or a single row matching its width.
func arrFilter(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	inc, ok := c.rangeArg(1)
	if !ok {
		return errNA
	}
	var kept [][]value
	switch {
	case inc.rows == rv.rows && inc.cols == 1:
		for r := 0; r < rv.rows; r++ {
			if inc.cells[r][0].isTruthy() {
				kept = append(kept, rv.cells[r])
			}
		}
	case inc.cols == rv.cols && inc.rows == 1:
		// Column filter: build kept columns then re-orient.
		var keepCols []int
		for cc := 0; cc < rv.cols; cc++ {
			if inc.cells[0][cc].isTruthy() {
				keepCols = append(keepCols, cc)
			}
		}
		if len(keepCols) == 0 {
			return arrFilterEmpty(c)
		}
		for r := 0; r < rv.rows; r++ {
			row := make([]value, len(keepCols))
			for i, cc := range keepCols {
				row[i] = rv.cells[r][cc]
			}
			kept = append(kept, row)
		}
		return arrayValue(kept)
	default:
		return errValue
	}
	if len(kept) == 0 {
		return arrFilterEmpty(c)
	}
	return arrayValue(kept)
}

// arrFilterEmpty returns the FILTER if_empty argument, or #CALC! when omitted.
func arrFilterEmpty(c *callCtx) value {
	if c.nargs() >= 3 {
		return c.scalar(2)
	}
	return errVal("#CALC!")
}
