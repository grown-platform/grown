package sheets

// Workbook metadata functions.
//
//	SHEET([value])  — 1-based index of the sheet a reference (or the current
//	                  formula) is on; a text argument names a sheet.
//	SHEETS([ref])   — number of sheets in the workbook, or in a reference (1).

func init() {
	registerFunc("SHEET", fnSheet)
	registerFunc("SHEETS", fnSheets)
}

func fnSheet(c *callCtx) value {
	wb := c.ev.book()
	if c.nargs() == 0 {
		return numVal(float64(c.ev.cur + 1))
	}
	if r := c.refArg(0); r != nil {
		return numVal(float64(r.sheet + 1))
	}
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	if v.kind == kindStr {
		if i, ok := wb.sheetIndexByName(v.str); ok {
			return numVal(float64(i + 1))
		}
	}
	return errNA
}

func fnSheets(c *callCtx) value {
	if c.nargs() == 0 {
		return numVal(float64(len(c.ev.book().sheets)))
	}
	if c.refArg(0) != nil {
		return numVal(1)
	}
	if v := c.scalar(0); v.isErr() {
		return v
	}
	return errNA
}
