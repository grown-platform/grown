package sheets

import (
	"sort"
	"strings"
)

// SUBTOTAL, AGGREGATE and SORTN. SUBTOTAL/AGGREGATE select an underlying
// aggregate by a numeric code and dispatch to the already-registered function,
// so they automatically track its behaviour. SUBTOTAL leaves out other
// SUBTOTAL/AGGREGATE cells and rows a filter hides (codes 1-11), or every
// hidden row (101-111), as Excel does; hidden rows come from the sheet's
// config.rowhidden and the filter from grownFilter (see sheetState).

func init() {
	registerFunc("SUBTOTAL", fnSubtotal)
	registerFunc("AGGREGATE", fnAggregate)
	registerFunc("SORTN", fnSortN)
}

var subtotalFuncs = map[int]string{
	1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN",
	6: "PRODUCT", 7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR", 11: "VARP",
}

func fnSubtotal(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	fn, ok := c.num(0)
	if !ok {
		return errValue
	}
	code := int(fn)
	allHidden := code > 100
	if allHidden {
		code -= 100 // 101-111: also ignore rows hidden by hand
	}
	name := subtotalFuncs[code]
	if name == "" {
		return errValue
	}
	args := make([]interface{}, 0, len(c.args)-1)
	for _, a := range c.args[1:] {
		args = append(args, c.ev.subtotalVisible(a, allHidden))
	}
	return c.p.dispatch(name, args)
}

// subtotalVisible blanks the cells of a reference argument that SUBTOTAL
// skips: other SUBTOTAL/AGGREGATE formulas, rows hidden by a filter and,
// with allHidden, every hidden row.
func (ev *Evaluator) subtotalVisible(a interface{}, allHidden bool) interface{} {
	r := refOf(a)
	if r == nil || len(r.areas) != 1 {
		return a
	}
	wb := ev.book()
	if r.sheet < 0 || r.sheet >= len(wb.sheets) {
		return a
	}
	st := wb.sheets[r.sheet]
	ar := r.areas[0]
	skip := func(row, col int) bool {
		if h, ok := st.hiddenRows[row]; ok && (allHidden || h) {
			return true
		}
		if cell := st.grid.get(cellAddr{row: row, col: col}); cell != nil && isSubtotalFormula(cell.F) {
			return true
		}
		return false
	}
	switch v := a.(type) {
	case rangeVal:
		var out [][]value
		changed := false
		for i := 0; i < v.rows; i++ {
			row := make([]value, v.cols)
			for j := 0; j < v.cols; j++ {
				row[j] = v.cells[i][j]
				if skip(ar.r1+i, ar.c1+j) {
					row[j] = blankVal
					changed = true
				}
			}
			out = append(out, row)
		}
		if !changed {
			return a
		}
		return rangeVal{rows: v.rows, cols: v.cols, cells: out, ref: v.ref}
	case value:
		if v.kind != kindArray && skip(ar.r1, ar.c1) {
			return blankVal.withRef(v.ref)
		}
	}
	return a
}

// isSubtotalFormula reports whether a formula is itself a SUBTOTAL or
// AGGREGATE (whose results SUBTOTAL does not count twice).
func isSubtotalFormula(f string) bool {
	if !strings.HasPrefix(f, "=") {
		return false
	}
	u := strings.ToUpper(strings.TrimLeft(f[1:], " +@"))
	return strings.HasPrefix(u, "SUBTOTAL(") || strings.HasPrefix(u, "AGGREGATE(")
}

var aggregateFuncs = map[int]string{
	1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN",
	6: "PRODUCT", 7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR",
	11: "VARP", 12: "MEDIAN", 13: "MODE.SNGL",
	14: "LARGE", 15: "SMALL", 16: "PERCENTILE.INC", 17: "QUARTILE.INC",
	18: "PERCENTILE.EXC", 19: "QUARTILE.EXC",
}

// stripErrors flattens args and drops error cells (for AGGREGATE's "ignore
// errors" options). The result is a one-column range so functions that read
// their data with rangeArg (LARGE, SMALL, PERCENTILE…) accept it.
func stripErrors(args []interface{}) rangeVal {
	flat := flattenArgs(args)
	var cells [][]value
	for _, v := range flat {
		if !v.isErr() {
			cells = append(cells, []value{v})
		}
	}
	return rangeVal{rows: len(cells), cols: 1, cells: cells}
}

func fnAggregate(c *callCtx) value {
	if c.nargs() < 3 {
		return errValue
	}
	fn, ok := c.num(0)
	if !ok {
		return errValue
	}
	code := int(fn)
	name := aggregateFuncs[code]
	if name == "" {
		return errValue
	}
	opt, _ := c.num(1)
	// Options 2,3,6,7 ignore error values; the rest keep them.
	ignoreErr := opt == 2 || opt == 3 || opt == 6 || opt == 7

	if code >= 14 { // LARGE/SMALL/PERCENTILE/QUARTILE take (range, k)
		dataArgs := c.args[2:]
		if len(dataArgs) < 2 {
			return errValue
		}
		k := dataArgs[len(dataArgs)-1]
		data := dataArgs[:len(dataArgs)-1]
		if ignoreErr {
			data = []interface{}{stripErrors(data)}
		}
		return c.p.dispatch(name, append(append([]interface{}{}, data...), k))
	}
	dataArgs := c.args[2:]
	if ignoreErr {
		dataArgs = []interface{}{stripErrors(dataArgs)}
	}
	return c.p.dispatch(name, dataArgs)
}

// SORTN(range, [n], [display_ties_mode], [sort_column], [is_ascending]) returns
// the first n rows of range after sorting by the given 1-based column.
func fnSortN(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok || rv.rows == 0 {
		return errNA
	}
	n := 1
	if c.nargs() >= 2 {
		if f, ok := c.num(1); ok {
			n = int(f)
		}
	}
	if n < 0 {
		return errValue
	}
	sortCol := 0
	if c.nargs() >= 4 {
		if f, ok := c.num(3); ok {
			sortCol = int(f) - 1
		}
	}
	asc := true
	if c.nargs() >= 5 {
		if f, ok := c.num(4); ok {
			asc = f != 0
		}
	}
	if sortCol < 0 || sortCol >= rv.cols {
		return errValue
	}
	rows := make([][]value, rv.rows)
	copy(rows, rv.cells)
	sort.SliceStable(rows, func(i, j int) bool {
		cmp := arrCmp(rows[i][sortCol], rows[j][sortCol])
		if asc {
			return cmp < 0
		}
		return cmp > 0
	})
	if n > len(rows) {
		n = len(rows)
	}
	return arrayValue(rows[:n])
}
