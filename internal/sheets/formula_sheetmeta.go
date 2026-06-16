package sheets

// Workbook metadata functions. SHEET([value]) returns the 1-based index of the
// current sheet; SHEETS() returns the number of sheets in the workbook. Cross-
// sheet references aren't supported by the engine, so SHEET ignores any argument
// and always reports the sheet being evaluated. (CELL/INFO need per-reference
// metadata the eager evaluator doesn't retain, so they're not implemented.)

func init() {
	registerFunc("SHEET", fnSheet)
	registerFunc("SHEETS", fnSheets)
}

func fnSheet(c *callCtx) value {
	idx := c.ev.sheetIndex
	if idx < 1 {
		idx = 1
	}
	return numVal(float64(idx))
}

func fnSheets(c *callCtx) value {
	n := len(c.ev.sheetNames)
	if n < 1 {
		n = 1
	}
	return numVal(float64(n))
}
