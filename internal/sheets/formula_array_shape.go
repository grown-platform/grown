package sheets

import (
	"math"
	"strings"
)

// Modern dynamic-array shaping functions (Excel 365 / Google Sheets parity).
// These all return spilling 2D results via arrayValue(...). None require lambda
// support, so they slot straight into the existing engine.
//
// Added: TEXTSPLIT, VSTACK, HSTACK, TOROW, TOCOL, CHOOSEROWS, CHOOSECOLS,
// TAKE, DROP, WRAPROWS, WRAPCOLS, EXPAND, ARRAYTOTEXT.

func init() {
	registerFunc("TEXTSPLIT", arrTextSplit)
	registerFunc("VSTACK", arrVStack)
	registerFunc("HSTACK", arrHStack)
	registerFunc("TOROW", arrToRow)
	registerFunc("TOCOL", arrToCol)
	registerFunc("CHOOSEROWS", arrChooseRows)
	registerFunc("CHOOSECOLS", arrChooseCols)
	registerFunc("TAKE", arrTake)
	registerFunc("DROP", arrDrop)
	registerFunc("WRAPROWS", arrWrapRows)
	registerFunc("WRAPCOLS", arrWrapCols)
	registerFunc("EXPAND", arrExpand)
	registerFunc("ARRAYTOTEXT", arrArrayToText)
}

// optScalar returns argument i, or def when the argument is absent.
func optScalar(c *callCtx, i int, def value) value {
	if i < c.nargs() {
		return c.scalar(i)
	}
	return def
}

// isBlankVal reports the one detectable form of blankness: an empty string.
func isBlankVal(v value) bool { return v.kind == kindStr && v.str == "" }

// scanCells flattens a range either by row (default) or by column.
func scanCells(rv rangeVal, byCol bool) []value {
	out := make([]value, 0, rv.rows*rv.cols)
	if byCol {
		for cc := 0; cc < rv.cols; cc++ {
			for r := 0; r < rv.rows; r++ {
				out = append(out, rv.cells[r][cc])
			}
		}
		return out
	}
	for r := 0; r < rv.rows; r++ {
		out = append(out, rv.cells[r]...)
	}
	return out
}

// ignoreFilter drops blanks and/or errors per Excel's ignore code:
// 0 keep all, 1 ignore blanks, 2 ignore errors, 3 ignore both.
func ignoreFilter(vals []value, mode int) []value {
	if mode == 0 {
		return vals
	}
	out := make([]value, 0, len(vals))
	for _, v := range vals {
		if (mode == 1 || mode == 3) && isBlankVal(v) {
			continue
		}
		if (mode == 2 || mode == 3) && v.isErr() {
			continue
		}
		out = append(out, v)
	}
	return out
}

// splitDelim splits s on a literal delimiter, optionally case-insensitively.
func splitDelim(s, delim string, ci bool) []string {
	if delim == "" {
		return []string{s}
	}
	if !ci {
		return strings.Split(s, delim)
	}
	// Case-insensitive split: walk lowercased copy, slice the original.
	ls, ld := strings.ToLower(s), strings.ToLower(delim)
	var parts []string
	for {
		i := strings.Index(ls, ld)
		if i < 0 {
			parts = append(parts, s)
			break
		}
		parts = append(parts, s[:i])
		s = s[i+len(delim):]
		ls = ls[i+len(ld):]
	}
	return parts
}

// dropEmpty removes empty strings (for TEXTSPLIT ignore_empty).
func dropEmpty(in []string) []string {
	out := in[:0:0]
	for _, s := range in {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// TEXTSPLIT(text, col_delim, [row_delim], [ignore_empty=FALSE], [match_mode=0], [pad_with=#N/A]).
func arrTextSplit(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	text := c.text(0)
	colDelim := c.text(1)
	rowDelim := ""
	if c.nargs() >= 3 {
		rowDelim = c.text(2)
	}
	ignoreEmpty := c.nargs() >= 4 && c.scalar(3).isTruthy()
	ci := c.nargs() >= 5 && c.scalar(4).isTruthy()
	pad := optScalar(c, 5, errNA)

	var rowsTxt []string
	if rowDelim != "" {
		rowsTxt = splitDelim(text, rowDelim, ci)
	} else {
		rowsTxt = []string{text}
	}
	cols := make([][]string, 0, len(rowsTxt))
	width := 0
	for _, rt := range rowsTxt {
		parts := splitDelim(rt, colDelim, ci)
		if ignoreEmpty {
			parts = dropEmpty(parts)
		}
		if rowDelim != "" && ignoreEmpty && len(parts) == 0 {
			continue // skip wholly empty rows
		}
		cols = append(cols, parts)
		if len(parts) > width {
			width = len(parts)
		}
	}
	if width == 0 || len(cols) == 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, len(cols))
	for r, parts := range cols {
		out[r] = make([]value, width)
		for cc := 0; cc < width; cc++ {
			if cc < len(parts) {
				out[r][cc] = strVal(parts[cc])
			} else {
				out[r][cc] = pad
			}
		}
	}
	return arrayValue(out)
}

// VSTACK(array1, [array2], ...) — stack vertically; width is the widest input,
// short rows padded with #N/A.
func arrVStack(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	width := 0
	parts := make([]rangeVal, 0, c.nargs())
	for i := 0; i < c.nargs(); i++ {
		rv, ok := c.rangeArg(i)
		if !ok {
			return errValue
		}
		parts = append(parts, rv)
		if rv.cols > width {
			width = rv.cols
		}
	}
	var out [][]value
	for _, rv := range parts {
		for r := 0; r < rv.rows; r++ {
			row := make([]value, width)
			for cc := 0; cc < width; cc++ {
				if cc < rv.cols {
					row[cc] = rv.cells[r][cc]
				} else {
					row[cc] = errNA
				}
			}
			out = append(out, row)
		}
	}
	if len(out) == 0 {
		return errVal("#CALC!")
	}
	return arrayValue(out)
}

// HSTACK(array1, [array2], ...) — stack horizontally; height is the tallest
// input, short columns padded with #N/A.
func arrHStack(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	height := 0
	parts := make([]rangeVal, 0, c.nargs())
	for i := 0; i < c.nargs(); i++ {
		rv, ok := c.rangeArg(i)
		if !ok {
			return errValue
		}
		parts = append(parts, rv)
		if rv.rows > height {
			height = rv.rows
		}
	}
	if height == 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, height)
	for r := 0; r < height; r++ {
		var row []value
		for _, rv := range parts {
			for cc := 0; cc < rv.cols; cc++ {
				if r < rv.rows {
					row = append(row, rv.cells[r][cc])
				} else {
					row = append(row, errNA)
				}
			}
		}
		out[r] = row
	}
	return arrayValue(out)
}

// TOROW(array, [ignore=0], [scan_by_col=FALSE]) — flatten to a single row.
func arrToRow(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	mode, _ := c.numOr(1, 0)
	byCol := c.nargs() >= 3 && c.scalar(2).isTruthy()
	vals := ignoreFilter(scanCells(rv, byCol), int(mode))
	if len(vals) == 0 {
		return errVal("#CALC!")
	}
	return arrayValue([][]value{vals})
}

// TOCOL(array, [ignore=0], [scan_by_col=FALSE]) — flatten to a single column.
func arrToCol(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	mode, _ := c.numOr(1, 0)
	byCol := c.nargs() >= 3 && c.scalar(2).isTruthy()
	vals := ignoreFilter(scanCells(rv, byCol), int(mode))
	if len(vals) == 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, len(vals))
	for i, v := range vals {
		out[i] = []value{v}
	}
	return arrayValue(out)
}

// resolveIndex maps a 1-based index (negative = from end) to 0-based, ok=false
// when out of range.
func resolveIndex(n, total int) (int, bool) {
	if n > 0 {
		n--
	} else if n < 0 {
		n += total
	} else {
		return 0, false // 0 is invalid in Excel
	}
	if n < 0 || n >= total {
		return 0, false
	}
	return n, true
}

// CHOOSEROWS(array, row_num1, [row_num2], ...).
func arrChooseRows(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok || c.nargs() < 2 {
		return errNA
	}
	var out [][]value
	for i := 1; i < c.nargs(); i++ {
		f, ok := c.num(i)
		if !ok {
			return errValue
		}
		ri, ok := resolveIndex(int(f), rv.rows)
		if !ok {
			return errVal("#VALUE!")
		}
		row := make([]value, rv.cols)
		copy(row, rv.cells[ri])
		out = append(out, row)
	}
	return arrayValue(out)
}

// CHOOSECOLS(array, col_num1, [col_num2], ...).
func arrChooseCols(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok || c.nargs() < 2 {
		return errNA
	}
	var picks []int
	for i := 1; i < c.nargs(); i++ {
		f, ok := c.num(i)
		if !ok {
			return errValue
		}
		ci, ok := resolveIndex(int(f), rv.cols)
		if !ok {
			return errVal("#VALUE!")
		}
		picks = append(picks, ci)
	}
	out := make([][]value, rv.rows)
	for r := 0; r < rv.rows; r++ {
		row := make([]value, len(picks))
		for i, ci := range picks {
			row[i] = rv.cells[r][ci]
		}
		out[r] = row
	}
	return arrayValue(out)
}

// takeSpan returns the [start,end) slice kept by TAKE for one dimension: a
// positive n keeps the first n, negative the last |n|; absent keeps all.
func takeSpan(total, n int, present bool) (int, int) {
	if !present {
		return 0, total
	}
	if n >= 0 {
		if n > total {
			n = total
		}
		return 0, n
	}
	n = -n
	if n > total {
		n = total
	}
	return total - n, total
}

// dropSpan returns the [start,end) slice kept by DROP for one dimension.
func dropSpan(total, n int, present bool) (int, int) {
	if !present {
		return 0, total
	}
	if n >= 0 {
		if n > total {
			n = total
		}
		return n, total
	}
	n = -n
	if n > total {
		n = total
	}
	return 0, total - n
}

// sliceRect materialises rows [r0,r1) × cols [c0,c1) of rv.
func sliceRect(rv rangeVal, r0, r1, c0, c1 int) value {
	if r1 <= r0 || c1 <= c0 {
		return errVal("#CALC!")
	}
	out := make([][]value, r1-r0)
	for r := r0; r < r1; r++ {
		row := make([]value, c1-c0)
		copy(row, rv.cells[r][c0:c1])
		out[r-r0] = row
	}
	return arrayValue(out)
}

// TAKE(array, rows, [columns]) — keep first/last rows and/or columns.
func arrTake(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	rowsPresent := c.nargs() >= 2
	colsPresent := c.nargs() >= 3
	rn, cn := 0, 0
	if rowsPresent {
		f, ok := c.num(1)
		if !ok {
			return errValue
		}
		rn = int(f)
	}
	if colsPresent {
		f, ok := c.num(2)
		if !ok {
			return errValue
		}
		cn = int(f)
	}
	r0, r1 := takeSpan(rv.rows, rn, rowsPresent)
	c0, c1 := takeSpan(rv.cols, cn, colsPresent)
	return sliceRect(rv, r0, r1, c0, c1)
}

// DROP(array, rows, [columns]) — remove first/last rows and/or columns.
func arrDrop(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	rowsPresent := c.nargs() >= 2
	colsPresent := c.nargs() >= 3
	rn, cn := 0, 0
	if rowsPresent {
		f, ok := c.num(1)
		if !ok {
			return errValue
		}
		rn = int(f)
	}
	if colsPresent {
		f, ok := c.num(2)
		if !ok {
			return errValue
		}
		cn = int(f)
	}
	r0, r1 := dropSpan(rv.rows, rn, rowsPresent)
	c0, c1 := dropSpan(rv.cols, cn, colsPresent)
	return sliceRect(rv, r0, r1, c0, c1)
}

// WRAPROWS(vector, wrap_count, [pad=#N/A]) — wrap a 1D vector into rows.
func arrWrapRows(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok || c.nargs() < 2 {
		return errNA
	}
	wf, ok := c.num(1)
	if !ok {
		return errValue
	}
	w := int(wf)
	if w < 1 {
		return errValue
	}
	pad := optScalar(c, 2, errNA)
	vals := rv.flat()
	rows := int(math.Ceil(float64(len(vals)) / float64(w)))
	if rows == 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		row := make([]value, w)
		for cc := 0; cc < w; cc++ {
			idx := r*w + cc
			if idx < len(vals) {
				row[cc] = vals[idx]
			} else {
				row[cc] = pad
			}
		}
		out[r] = row
	}
	return arrayValue(out)
}

// WRAPCOLS(vector, wrap_count, [pad=#N/A]) — wrap a 1D vector into columns.
func arrWrapCols(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok || c.nargs() < 2 {
		return errNA
	}
	wf, ok := c.num(1)
	if !ok {
		return errValue
	}
	h := int(wf)
	if h < 1 {
		return errValue
	}
	pad := optScalar(c, 2, errNA)
	vals := rv.flat()
	cols := int(math.Ceil(float64(len(vals)) / float64(h)))
	if cols == 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, h)
	for r := 0; r < h; r++ {
		out[r] = make([]value, cols)
		for cc := 0; cc < cols; cc++ {
			idx := cc*h + r
			if idx < len(vals) {
				out[r][cc] = vals[idx]
			} else {
				out[r][cc] = pad
			}
		}
	}
	return arrayValue(out)
}

// EXPAND(array, rows, [columns], [pad=#N/A]) — pad an array out to rows×columns.
func arrExpand(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	targetRows := rv.rows
	if c.nargs() >= 2 {
		f, ok := c.num(1)
		if !ok {
			return errValue
		}
		targetRows = int(f)
	}
	targetCols := rv.cols
	if c.nargs() >= 3 {
		// columns may be omitted (blank) → keep current width.
		if v := c.scalar(2); !isBlankVal(v) {
			f, ok := v.toNum()
			if !ok {
				return errValue
			}
			targetCols = int(f)
		}
	}
	pad := optScalar(c, 3, errNA)
	if targetRows < rv.rows || targetCols < rv.cols {
		return errValue // EXPAND cannot shrink
	}
	out := make([][]value, targetRows)
	for r := 0; r < targetRows; r++ {
		out[r] = make([]value, targetCols)
		for cc := 0; cc < targetCols; cc++ {
			if r < rv.rows && cc < rv.cols {
				out[r][cc] = rv.cells[r][cc]
			} else {
				out[r][cc] = pad
			}
		}
	}
	return arrayValue(out)
}

// ARRAYTOTEXT(array, [format=0]) — render an array as text. Format 0 is a
// concise comma+space join; format 1 is the strict {a,b;c,d} form with quoted
// text, matching Excel.
func arrArrayToText(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok {
		return errNA
	}
	format := 0
	if c.nargs() >= 2 {
		f, _ := c.num(1)
		format = int(f)
	}
	if format == 1 {
		var rows []string
		for r := 0; r < rv.rows; r++ {
			var cells []string
			for cc := 0; cc < rv.cols; cc++ {
				v := rv.cells[r][cc]
				if v.kind == kindStr {
					cells = append(cells, "\""+v.str+"\"")
				} else {
					cells = append(cells, v.toStr())
				}
			}
			rows = append(rows, strings.Join(cells, ","))
		}
		return strVal("{" + strings.Join(rows, ";") + "}")
	}
	var parts []string
	for _, v := range scanCells(rv, false) {
		parts = append(parts, v.toStr())
	}
	return strVal(strings.Join(parts, ", "))
}
