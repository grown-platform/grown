package sheets

import "sort"

// Batch 3: lambda-consuming aggregators GROUPBY / PIVOTBY (Excel 365 parity).
//
// The LAMBDA-helper family (MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY) and the
// dynamic-array/lookup functions (FILTER, SORT, SORTBY, UNIQUE, WRAPROWS,
// WRAPCOLS, TRANSPOSE, TAKE, DROP, EXPAND, HSTACK, VSTACK, TOROW, TOCOL, ...)
// already exist (formula_lambda.go, formula_array.go, formula_array_shape.go),
// so this batch adds the remaining high-value members of the family: GROUPBY and
// PIVOTBY. Both group data by key column(s) and reduce each group with a LAMBDA
// value, reusing the exact apply mechanism (applyLambda) used by MAP/REDUCE.
//
// ISOMITTED is intentionally not implemented: it requires optional LAMBDA
// parameters (Excel's [param] syntax), which the engine's lambda model cannot
// express — parseLambda accepts only bare single-ident params, applyLambda
// enforces exact arity (#VALUE! otherwise), the lexer has no '['/']' tokens, and
// there is no "omitted" value kind. See REPORT for details.

func init() {
	registerFunc("GROUPBY", arrGroupBy)
	registerFunc("PIVOTBY", arrPivotBy)
}

// valKey builds an exact (kind-sensitive) equality key for a single value so
// grouping distinguishes e.g. the number 1 from the string "1".
func valKey(v value) string { return arrRowKey([]value{v}) }

// uniqueSortedKeys returns the distinct values from vals, ascending (numbers
// before text, per arrCmp), preserving deterministic output order.
func uniqueSortedKeys(vals []value) []value {
	seen := make(map[string]bool, len(vals))
	var uniq []value
	for _, v := range vals {
		k := valKey(v)
		if !seen[k] {
			seen[k] = true
			uniq = append(uniq, v)
		}
	}
	sort.SliceStable(uniq, func(i, j int) bool { return arrCmp(uniq[i], uniq[j]) < 0 })
	return uniq
}

// GROUPBY(row_keys, values, lambda) — group the rows of values by the single
// key column row_keys and reduce each group with lambda(group_values). Output is
// one row per distinct key (ascending): the key followed by one aggregate per
// value column, e.g.
//
//	=GROUPBY(A1:A4, B1:B4, LAMBDA(v, SUM(v)))
//
// with A = {x;y;x;y}, B = {1;2;3;4} → {x,4 ; y,6}.
func arrGroupBy(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	kr, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	vr, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	lam, ok := c.lambdaArg(2)
	if !ok {
		return errValue
	}
	if kr.cols != 1 || kr.rows == 0 || vr.rows != kr.rows {
		return errValue
	}
	keys := make([]value, kr.rows)
	for r := 0; r < kr.rows; r++ {
		keys[r] = kr.cells[r][0]
	}
	uniq := uniqueSortedKeys(keys)
	out := make([][]value, len(uniq))
	for i, uk := range uniq {
		ukKey := valKey(uk)
		var idxs []int
		for r := 0; r < kr.rows; r++ {
			if valKey(keys[r]) == ukKey {
				idxs = append(idxs, r)
			}
		}
		row := make([]value, 1+vr.cols)
		row[0] = uk
		for col := 0; col < vr.cols; col++ {
			colVals := make([][]value, len(idxs))
			for j, ri := range idxs {
				colVals[j] = []value{vr.cells[ri][col]}
			}
			row[1+col] = applyLambda(c.ev, lam, []value{arrayValue(colVals)})
		}
		out[i] = row
	}
	return arrayValue(out)
}

// PIVOTBY(row_keys, col_keys, values, lambda) — cross-tabulate values by a
// single row-key column and a single col-key column, reducing each cell's values
// with lambda(cell_values). Output is a labelled grid: a header row of the
// distinct col keys (ascending) and a leading column of the distinct row keys
// (ascending); the top-left corner is blank. Empty intersections are blank, e.g.
//
//	=PIVOTBY(A1:A4, B1:B4, C1:C4, LAMBDA(v, SUM(v)))
func arrPivotBy(c *callCtx) value {
	if c.nargs() < 4 {
		return errNA
	}
	kr, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	cr, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	vr, ok := c.rangeArg(2)
	if !ok {
		return errValue
	}
	lam, ok := c.lambdaArg(3)
	if !ok {
		return errValue
	}
	n := kr.rows
	if kr.cols != 1 || cr.cols != 1 || vr.cols != 1 || n == 0 || cr.rows != n || vr.rows != n {
		return errValue
	}
	rk := make([]value, n)
	ck := make([]value, n)
	vv := make([]value, n)
	for r := 0; r < n; r++ {
		rk[r] = kr.cells[r][0]
		ck[r] = cr.cells[r][0]
		vv[r] = vr.cells[r][0]
	}
	rowU := uniqueSortedKeys(rk)
	colU := uniqueSortedKeys(ck)

	out := make([][]value, 1+len(rowU))
	hdr := make([]value, 1+len(colU))
	hdr[0] = strVal("")
	for j, cu := range colU {
		hdr[1+j] = cu
	}
	out[0] = hdr
	for i, ru := range rowU {
		ruKey := valKey(ru)
		row := make([]value, 1+len(colU))
		row[0] = ru
		for j, cu := range colU {
			cuKey := valKey(cu)
			var cells [][]value
			for r := 0; r < n; r++ {
				if valKey(rk[r]) == ruKey && valKey(ck[r]) == cuKey {
					cells = append(cells, []value{vv[r]})
				}
			}
			if len(cells) == 0 {
				row[1+j] = strVal("")
			} else {
				row[1+j] = applyLambda(c.ev, lam, []value{arrayValue(cells)})
			}
		}
		out[1+i] = row
	}
	return arrayValue(out)
}
