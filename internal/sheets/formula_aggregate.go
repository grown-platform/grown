package sheets

import "sort"

// SUBTOTAL, AGGREGATE and SORTN. SUBTOTAL/AGGREGATE select an underlying
// aggregate by a numeric code and dispatch to the already-registered function,
// so they automatically track its behaviour. We don't model hidden rows, so the
// "ignore hidden" SUBTOTAL codes (101-111) behave like their 1-11 counterparts.

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
	if code > 100 {
		code -= 100 // 101-111: "ignore hidden rows" — we don't track hidden rows
	}
	name := subtotalFuncs[code]
	if name == "" {
		return errValue
	}
	return c.p.dispatch(name, c.args[1:])
}

var aggregateFuncs = map[int]string{
	1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN",
	6: "PRODUCT", 7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR",
	11: "VARP", 12: "MEDIAN", 13: "MODE.SNGL",
	14: "LARGE", 15: "SMALL", 16: "PERCENTILE.INC", 17: "QUARTILE.INC",
	18: "PERCENTILE.EXC", 19: "QUARTILE.INC",
}

// stripErrors flattens args and drops error cells (for AGGREGATE's "ignore
// errors" options).
func stripErrors(args []interface{}) []value {
	flat := flattenArgs(args)
	out := flat[:0]
	for _, v := range flat {
		if !v.isErr() {
			out = append(out, v)
		}
	}
	return out
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
