package sheets

// formula_lookup.go — Excel-compatible LOOKUP / REFERENCE worksheet functions.
//
// All functions here return a single scalar value (no array spill). They build
// on the shared engine API declared in formula.go: value/rangeVal/callCtx and
// the registerFunc mechanism. Unexported helpers in this file are prefixed with
// "lkp" to avoid colliding with the rest of the package.
//
// Error semantics (per spec):
//   - Input errors propagate (a #REF!/#VALUE!/etc. in lookup/needle short-circuits).
//   - No match → #N/A.
//   - Out-of-range index → #REF!.
//   - Bad arguments → #VALUE!.

import (
	"math"
	"strings"
)

func init() {
	registerFunc("VLOOKUP", fnVLookup)
	registerFunc("HLOOKUP", fnHLookup)
	registerFunc("LOOKUP", fnLookup)
	registerFunc("INDEX", fnIndex)
	registerFunc("MATCH", fnMatch)
	registerFunc("XMATCH", fnXMatch)
	registerFunc("XLOOKUP", fnXLookup)
	registerFunc("CHOOSE", fnChoose)
	registerFunc("ROW", fnRow)
	registerFunc("COLUMN", fnColumn)
	registerFunc("ROWS", fnRows)
	registerFunc("COLUMNS", fnColumns)
	registerFunc("ADDRESS", fnAddress)
	registerFunc("INDIRECT", fnIndirect)
}

// ---- comparison helpers -----------------------------------------------------

// lkpCompare orders two values for sorted/approximate matching. It returns
// -1 if a<b, 0 if a==b, +1 if a>b. Numbers compare numerically; everything
// else compares as case-insensitive text. Numbers sort before text (as Excel
// does within a single column of mixed types).
func lkpCompare(a, b value) int {
	an, aok := lkpNumeric(a)
	bn, bok := lkpNumeric(b)
	switch {
	case aok && bok:
		switch {
		case an < bn:
			return -1
		case an > bn:
			return 1
		default:
			return 0
		}
	case aok && !bok:
		return -1 // numbers sort before text
	case !aok && bok:
		return 1
	default:
		as := strings.ToUpper(a.toStr())
		bs := strings.ToUpper(b.toStr())
		return strings.Compare(as, bs)
	}
}

// lkpNumeric reports the numeric value of v, but only treats genuine numbers and
// booleans as numeric. A string is treated as text even if it parses as a number,
// so "10" and 10 are kept in distinct ordering domains (matching Excel's typed
// comparison in lookup columns).
func lkpNumeric(v value) (float64, bool) {
	switch v.kind {
	case kindNum, kindBool:
		return v.num, true
	}
	return 0, false
}

// lkpEqual reports whether needle exactly equals cell. When the needle is text
// containing wildcards (* ?), wildcard matching is used. Numbers/booleans
// compare numerically; text compares case-insensitively.
func lkpEqual(needle, cell value) bool {
	if needle.kind == kindStr && strings.ContainsAny(needle.str, "*?") {
		if re := wildcardToRegexp(needle.str); re != nil {
			return re.MatchString(cell.toStr())
		}
	}
	nn, nok := lkpNumeric(needle)
	cn, cok := lkpNumeric(cell)
	if nok && cok {
		return nn == cn
	}
	if nok != cok {
		return false // number never equals text
	}
	return strings.EqualFold(needle.toStr(), cell.toStr())
}

// lkpFirstErr returns the first error among the supplied values (or a zero
// value, false) — used to propagate input errors.
func lkpFirstErr(vals ...value) (value, bool) {
	for _, v := range vals {
		if v.isErr() {
			return v, true
		}
	}
	return value{}, false
}

// lkpApproxIndex finds the position (0-based) of the largest entry ≤ needle in
// an assumed-ascending slice. Returns -1 when needle is smaller than the first
// entry (→ caller returns #N/A). Errors in scanned cells propagate via the
// returned error value.
func lkpApproxIndex(needle value, cells []value) (int, value, bool) {
	best := -1
	for i, c := range cells {
		if c.isErr() {
			return -1, c, true
		}
		// Skip cells of a different type domain than the needle: an approximate
		// scan walks while cell ≤ needle.
		if lkpCompare(c, needle) <= 0 {
			best = i
		} else {
			break // ascending: once we pass needle, stop.
		}
	}
	return best, value{}, false
}

// ---- VLOOKUP / HLOOKUP ------------------------------------------------------

func fnVLookup(c *callCtx) value { return lkpVH(c, true) }
func fnHLookup(c *callCtx) value { return lkpVH(c, false) }

// lkpVH implements VLOOKUP (vertical=true) and HLOOKUP (vertical=false).
func lkpVH(c *callCtx, vertical bool) value {
	if c.nargs() < 3 {
		return errValue
	}
	needle := c.scalar(0)
	if needle.isErr() {
		return needle
	}
	table, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	idxF, iok := c.num(2)
	if !iok {
		return errValue
	}
	index := int(math.Trunc(idxF)) // 1-based result row/col
	if index < 1 {
		return errValue
	}
	// range_lookup defaults to TRUE (approximate).
	approx := true
	if c.nargs() >= 4 {
		rl := c.scalar(3)
		if rl.isErr() {
			return rl
		}
		approx = rl.isTruthy()
	}

	// Build the search line (first column for V, first row for H) and bound-check
	// the result index.
	var line []value
	if vertical {
		if index > table.cols {
			return errRef
		}
		line = make([]value, table.rows)
		for r := 0; r < table.rows; r++ {
			line[r] = table.cells[r][0]
		}
	} else {
		if index > table.rows {
			return errRef
		}
		line = make([]value, table.cols)
		for cc := 0; cc < table.cols; cc++ {
			line[cc] = table.cells[0][cc]
		}
	}

	pos := -1
	if approx {
		p, errv, has := lkpApproxIndex(needle, line)
		if has {
			return errv
		}
		pos = p
	} else {
		for i, cell := range line {
			if cell.isErr() {
				return cell
			}
			if lkpEqual(needle, cell) {
				pos = i
				break
			}
		}
	}
	if pos < 0 {
		return errNA
	}
	if vertical {
		return table.cells[pos][index-1]
	}
	return table.cells[index-1][pos]
}

// ---- LOOKUP (vector form) ---------------------------------------------------

// LOOKUP(lookup, lookup_range, [result_range]) — approximate match against an
// assumed-ascending lookup vector. When result_range is omitted the matched
// value from lookup_range itself is returned. result_range may be a row or a
// column; the matched position indexes into its flattened cells.
func fnLookup(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	needle := c.scalar(0)
	if needle.isErr() {
		return needle
	}
	lookupRange, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	lookupCells := lookupRange.flat()
	pos, errv, has := lkpApproxIndex(needle, lookupCells)
	if has {
		return errv
	}
	if pos < 0 {
		return errNA
	}
	resultCells := lookupCells
	if c.nargs() >= 3 {
		resultRange, rok := c.rangeArg(2)
		if !rok {
			return errValue
		}
		resultCells = resultRange.flat()
	}
	if pos >= len(resultCells) {
		return errRef
	}
	return resultCells[pos]
}

// ---- INDEX ------------------------------------------------------------------

// INDEX(rangeVal, row_num, [col_num]) — 1-based. A row_num/col_num of 0 means
// "entire column/row". Because this engine returns a single scalar (no array
// spill), the result must resolve to exactly one cell; otherwise #REF!.
//
//   - INDEX(r, i, j)            → cell (i,j)
//   - INDEX(r, i)   single col  → cell (i,1)
//   - INDEX(r, i)   single row  → cell (1,i)  (i indexes the columns)
//   - INDEX(r, 0, j)            → only valid when r has a single row
//   - INDEX(r, i, 0)            → only valid when r has a single column
func fnIndex(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	rng, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	rowF, rok := c.num(1)
	if !rok {
		return errValue
	}
	rowNum := int(math.Trunc(rowF)) // 1-based, 0 = whole column
	if rowNum < 0 {
		return errValue
	}

	hasCol := c.nargs() >= 3
	colNum := 0
	if hasCol {
		colF, cok := c.num(2)
		if !cok {
			return errValue
		}
		colNum = int(math.Trunc(colF)) // 1-based, 0 = whole row
		if colNum < 0 {
			return errValue
		}
	}

	// Two-argument form: the single index addresses the vector dimension.
	if !hasCol {
		if rng.rows == 1 {
			// Single row: index selects a column.
			if rowNum == 0 {
				if rng.cols != 1 {
					return errRef // whole row isn't a single cell
				}
				return rng.cells[0][0]
			}
			if rowNum > rng.cols {
				return errRef
			}
			return rng.cells[0][rowNum-1]
		}
		if rng.cols == 1 {
			// Single column: index selects a row.
			if rowNum == 0 {
				if rng.rows != 1 {
					return errRef
				}
				return rng.cells[0][0]
			}
			if rowNum > rng.rows {
				return errRef
			}
			return rng.cells[rowNum-1][0]
		}
		// 2-D range with a single index is ambiguous for a scalar result.
		if rowNum == 0 {
			return errRef
		}
		if rowNum > rng.rows {
			return errRef
		}
		// Excel treats INDEX(2Darea, n) as the n-th column of the first row only
		// when rows==1; otherwise it needs col_num. Without it, no single cell.
		return errRef
	}

	// Three-argument form.
	switch {
	case rowNum == 0 && colNum == 0:
		if rng.rows == 1 && rng.cols == 1 {
			return rng.cells[0][0]
		}
		return errRef
	case rowNum == 0:
		// Whole column colNum → single cell only if one row.
		if colNum > rng.cols {
			return errRef
		}
		if rng.rows != 1 {
			return errRef
		}
		return rng.cells[0][colNum-1]
	case colNum == 0:
		// Whole row rowNum → single cell only if one column.
		if rowNum > rng.rows {
			return errRef
		}
		if rng.cols != 1 {
			return errRef
		}
		return rng.cells[rowNum-1][0]
	default:
		if rowNum > rng.rows || colNum > rng.cols {
			return errRef
		}
		return rng.cells[rowNum-1][colNum-1]
	}
}

// ---- MATCH ------------------------------------------------------------------

// MATCH(lookup, rangeVal, [match_type=1]) → 1-based position within the range
// (flattened row-major; the range is expected to be a single row or column).
//
//	match_type  1 → largest value ≤ lookup, assumes ascending
//	match_type  0 → first exact match (wildcards supported)
//	match_type -1 → smallest value ≥ lookup, assumes descending
func fnMatch(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	needle := c.scalar(0)
	if needle.isErr() {
		return needle
	}
	rng, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	matchType := 1
	if c.nargs() >= 3 {
		mt, mok := c.num(2)
		if !mok {
			return errValue
		}
		matchType = int(math.Trunc(mt))
	}
	cells := rng.flat()

	switch {
	case matchType == 0:
		for i, cell := range cells {
			if cell.isErr() {
				return cell
			}
			if lkpEqual(needle, cell) {
				return numVal(float64(i + 1))
			}
		}
		return errNA
	case matchType > 0:
		// Ascending: largest cell ≤ needle.
		best := -1
		for i, cell := range cells {
			if cell.isErr() {
				return cell
			}
			if lkpCompare(cell, needle) <= 0 {
				best = i
			} else {
				break
			}
		}
		if best < 0 {
			return errNA
		}
		return numVal(float64(best + 1))
	default:
		// Descending: smallest cell ≥ needle.
		best := -1
		for i, cell := range cells {
			if cell.isErr() {
				return cell
			}
			if lkpCompare(cell, needle) >= 0 {
				best = i
			} else {
				break
			}
		}
		if best < 0 {
			return errNA
		}
		return numVal(float64(best + 1))
	}
}

// ---- XMATCH -----------------------------------------------------------------

// XMATCH(lookup, rangeVal, [match_mode=0], [search_mode=1]).
//
//	match_mode  0 → exact
//	match_mode -1 → exact or next smaller
//	match_mode  1 → exact or next larger
//	match_mode  2 → wildcard
//	search_mode  1 → first-to-last (default)
//	search_mode -1 → last-to-first
//
// (Binary-search modes 2/-2 are treated as their linear equivalents since the
// engine cannot assume sorted order beyond what the caller provides.)
func fnXMatch(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	needle := c.scalar(0)
	if needle.isErr() {
		return needle
	}
	rng, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	matchMode := 0
	if c.nargs() >= 3 {
		mm, mok := c.num(2)
		if !mok {
			return errValue
		}
		matchMode = int(math.Trunc(mm))
	}
	searchMode := 1
	if c.nargs() >= 4 {
		sm, sok := c.num(3)
		if !sok {
			return errValue
		}
		searchMode = int(math.Trunc(sm))
	}

	cells := rng.flat()
	// Establish iteration order.
	order := make([]int, len(cells))
	if searchMode < 0 {
		for i := range order {
			order[i] = len(cells) - 1 - i
		}
	} else {
		for i := range order {
			order[i] = i
		}
	}

	wildcard := matchMode == 2

	// First pass: exact match (modes 0, -1, 1, 2 all accept an exact hit).
	for _, i := range order {
		cell := cells[i]
		if cell.isErr() {
			return cell
		}
		if wildcard {
			if re := wildcardToRegexp(needle.toStr()); re != nil && re.MatchString(cell.toStr()) {
				return numVal(float64(i + 1))
			}
			continue
		}
		if lkpEqual(needle, cell) {
			return numVal(float64(i + 1))
		}
	}

	if matchMode == -1 || matchMode == 1 {
		// Find nearest smaller (-1) or larger (1) by value, breaking ties toward
		// the search direction's first occurrence.
		best := -1
		var bestVal value
		bestSet := false
		for _, i := range order {
			cell := cells[i]
			cmp := lkpCompare(cell, needle)
			if matchMode == -1 && cmp <= 0 {
				// candidate ≤ needle; want the largest such.
				if !bestSet || lkpCompare(cell, bestVal) > 0 {
					best, bestVal, bestSet = i, cell, true
				}
			}
			if matchMode == 1 && cmp >= 0 {
				// candidate ≥ needle; want the smallest such.
				if !bestSet || lkpCompare(cell, bestVal) < 0 {
					best, bestVal, bestSet = i, cell, true
				}
			}
		}
		if bestSet {
			return numVal(float64(best + 1))
		}
	}
	return errNA
}

// ---- XLOOKUP ----------------------------------------------------------------

// XLOOKUP(lookup, lookup_rangeVal, return_rangeVal, [if_not_found],
//
//	[match_mode=0], [search_mode=1])
//
// Finds lookup in lookup_range and returns the corresponding cell from
// return_range. On no match: if_not_found if provided, else #N/A.
func fnXLookup(c *callCtx) value {
	if c.nargs() < 3 {
		return errValue
	}
	needle := c.scalar(0)
	if needle.isErr() {
		return needle
	}
	lookupRange, ok1 := c.rangeArg(1)
	if !ok1 {
		return errValue
	}
	returnRange, ok2 := c.rangeArg(2)
	if !ok2 {
		return errValue
	}
	matchMode := 0
	if c.nargs() >= 5 {
		mm, mok := c.num(4)
		if !mok {
			return errValue
		}
		matchMode = int(math.Trunc(mm))
	}
	searchMode := 1
	if c.nargs() >= 6 {
		sm, sok := c.num(5)
		if !sok {
			return errValue
		}
		searchMode = int(math.Trunc(sm))
	}

	lookupCells := lookupRange.flat()
	returnCells := returnRange.flat()

	order := make([]int, len(lookupCells))
	if searchMode < 0 {
		for i := range order {
			order[i] = len(lookupCells) - 1 - i
		}
	} else {
		for i := range order {
			order[i] = i
		}
	}

	wildcard := matchMode == 2
	pos := -1

	// Exact pass (all modes accept exact).
	for _, i := range order {
		cell := lookupCells[i]
		if cell.isErr() {
			return cell
		}
		if wildcard {
			if re := wildcardToRegexp(needle.toStr()); re != nil && re.MatchString(cell.toStr()) {
				pos = i
				break
			}
			continue
		}
		if lkpEqual(needle, cell) {
			pos = i
			break
		}
	}

	if pos < 0 && (matchMode == -1 || matchMode == 1) {
		best := -1
		var bestVal value
		bestSet := false
		for _, i := range order {
			cell := lookupCells[i]
			cmp := lkpCompare(cell, needle)
			if matchMode == -1 && cmp <= 0 {
				if !bestSet || lkpCompare(cell, bestVal) > 0 {
					best, bestVal, bestSet = i, cell, true
				}
			}
			if matchMode == 1 && cmp >= 0 {
				if !bestSet || lkpCompare(cell, bestVal) < 0 {
					best, bestVal, bestSet = i, cell, true
				}
			}
		}
		if bestSet {
			pos = best
		}
	}

	if pos < 0 {
		// Not found.
		if c.nargs() >= 4 {
			return c.scalar(3)
		}
		return errNA
	}
	if pos >= len(returnCells) {
		return errRef
	}
	return returnCells[pos]
}

// ---- CHOOSE -----------------------------------------------------------------

// CHOOSE(index, v1, v2, ...) — returns the index-th (1-based) subsequent
// argument. Arguments are already evaluated; we just pick via c.scalar.
func fnChoose(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	idxF, ok := c.num(0)
	if !ok {
		return errValue
	}
	idx := int(math.Trunc(idxF))
	if idx < 1 || idx > c.nargs()-1 {
		return errValue
	}
	return c.scalar(idx) // arg 0 is the index; choice idx → args[idx]
}

// ---- ROW / COLUMN -----------------------------------------------------------

// ROW([ref]) — with no argument returns the current formula cell's 1-based row.
//
// LIMITATION: rangeVal does not carry its sheet origin, so when a reference is
// supplied we cannot recover its absolute top row (e.g. ROW(A5) cannot return
// 5). We therefore only support the no-argument form precisely; with a range
// argument we return the current cell's row as a best effort. Use ROWS() for a
// reliable row count.
func fnRow(c *callCtx) value {
	if c.nargs() == 0 {
		return numVal(float64(c.ev.curRow + 1))
	}
	if v, ok := lkpFirstErr(c.scalar(0)); ok {
		return v
	}
	return numVal(float64(c.ev.curRow + 1))
}

// COLUMN([ref]) — mirrors ROW for columns. Same origin limitation applies; the
// reference form falls back to the current cell's column.
func fnColumn(c *callCtx) value {
	if c.nargs() == 0 {
		return numVal(float64(c.ev.curCol + 1))
	}
	if v, ok := lkpFirstErr(c.scalar(0)); ok {
		return v
	}
	return numVal(float64(c.ev.curCol + 1))
}

// ROWS(rangeVal) — number of rows in the reference/array.
func fnRows(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	rng, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	return numVal(float64(rng.rows))
}

// COLUMNS(rangeVal) — number of columns in the reference/array.
func fnColumns(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	rng, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	return numVal(float64(rng.cols))
}

// ---- ADDRESS ----------------------------------------------------------------

// ADDRESS(row, col, [abs=1], [a1=TRUE]) — builds an A1-style address string.
//
//	abs 1 → $A$1   2 → A$1   3 → $A1   4 → A1
//
// a1=FALSE (R1C1) is not supported by addrToName; we document that and fall back
// to A1 notation.
func fnAddress(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	rowF, rok := c.num(0)
	colF, cok := c.num(1)
	if !rok || !cok {
		return errValue
	}
	row := int(math.Trunc(rowF))
	col := int(math.Trunc(colF))
	if row < 1 || col < 1 {
		return errValue
	}
	absType := 1
	if c.nargs() >= 3 {
		af, aok := c.num(2)
		if !aok {
			return errValue
		}
		absType = int(math.Trunc(af))
	}
	if absType < 1 || absType > 4 {
		return errValue
	}

	name := addrToName(row-1, col-1) // e.g. "A1"
	// Split letters/digits to insert the $ markers.
	letters, digits := lkpSplitA1(name)
	absCol := absType == 1 || absType == 3
	absRow := absType == 1 || absType == 2
	var b strings.Builder
	if absCol {
		b.WriteByte('$')
	}
	b.WriteString(letters)
	if absRow {
		b.WriteByte('$')
	}
	b.WriteString(digits)
	return strVal(b.String())
}

// lkpSplitA1 splits an "A1" style name into its column letters and row digits.
func lkpSplitA1(name string) (letters, digits string) {
	i := 0
	for i < len(name) && name[i] >= 'A' && name[i] <= 'Z' {
		i++
	}
	return name[:i], name[i:]
}

// ---- INDIRECT ---------------------------------------------------------------

// INDIRECT(ref_text, [a1=TRUE]) — resolves ref_text as a single A1 cell
// reference and returns that cell's value. Ranges and unparseable text yield
// #REF!. The a1 flag is accepted for compatibility; R1C1 (a1=FALSE) is not
// supported and yields #REF!.
func fnIndirect(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	refv := c.scalar(0)
	if refv.isErr() {
		return refv
	}
	if c.nargs() >= 2 {
		a1 := c.scalar(1)
		if a1.isErr() {
			return a1
		}
		if !a1.isTruthy() {
			return errRef // R1C1 unsupported
		}
	}
	ref := strings.TrimSpace(refv.toStr())
	// Reject ranges (contain a colon) — single cell only for a scalar result.
	if strings.Contains(ref, ":") {
		return errRef
	}
	addr, ok := parseCellRef(ref)
	if !ok {
		return errRef
	}
	return c.ev.cellValue(addr)
}
