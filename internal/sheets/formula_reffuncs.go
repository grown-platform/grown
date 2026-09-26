package sheets

// Reference functions: ISREF, ISFORMULA, FORMULATEXT, CELL, OFFSET, AREAS,
// HYPERLINK and SINGLE. They read the refInfo a reference argument carries
// (see formula_refs.go), so they work across sheets and with defined names.

import (
	"math"
	"strings"
)

func init() {
	registerFunc("ISREF", fnIsRef)
	registerFunc("ISFORMULA", fnIsFormula)
	registerFunc("FORMULATEXT", fnFormulaText)
	registerFunc("CELL", fnCell)
	registerFunc("OFFSET", fnOffset)
	registerFunc("AREAS", fnAreas)
	registerFunc("HYPERLINK", fnHyperlink)
	registerFunc("SINGLE", fnSingle)
}

// refCell returns the formula-cell model at the top-left of r.
func (ev *Evaluator) refCell(r *refInfo) *FsCell {
	wb := ev.book()
	if r == nil || r.sheet < 0 || r.sheet >= len(wb.sheets) || len(r.areas) == 0 {
		return nil
	}
	a := r.areas[0]
	return wb.sheets[r.sheet].grid.get(cellAddr{row: a.r1, col: a.c1})
}

// isFormulaCell reports whether the top-left cell of r holds a formula.
func (ev *Evaluator) isFormulaCell(r *refInfo) bool {
	cell := ev.refCell(r)
	return cell != nil && strings.HasPrefix(cell.F, "=") && ev.book().sheets[r.sheet].isFormula[cellAddr{row: r.areas[0].r1, col: r.areas[0].c1}]
}

// ISREF(value) — TRUE when the argument is a reference.
func fnIsRef(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	return boolVal(c.refArg(0) != nil)
}

// ISFORMULA(reference) — TRUE when the (top-left) referenced cell holds a
// formula. A value that is not a reference is FALSE; an error propagates.
func fnIsFormula(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	r := c.refArg(0)
	if r == nil {
		if v := c.scalar(0); v.isErr() {
			return v
		}
		return boolVal(false)
	}
	return boolVal(c.ev.isFormulaCell(r))
}

// FORMULATEXT(reference) — the formula of the (top-left) referenced cell as
// text; #N/A when that cell has no formula or the argument is not a reference.
func fnFormulaText(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	r := c.refArg(0)
	if r == nil {
		if v := c.scalar(0); v.isErr() {
			return v
		}
		return errNA
	}
	if !c.ev.isFormulaCell(r) {
		return errNA
	}
	return strVal(c.ev.refCell(r).F)
}

// CELL(info_type, [reference]) — information about the top-left cell of a
// reference (the formula cell itself when omitted).
func fnCell(c *callCtx) value {
	if c.nargs() < 1 || c.nargs() > 2 {
		return errNA
	}
	info := c.scalar(0)
	if info.isErr() {
		return info
	}
	var r *refInfo
	if c.nargs() == 2 {
		r = c.refArg(1)
		if r == nil {
			return errName
		}
	} else {
		r = &refInfo{sheet: c.ev.cur, areas: []area{{r1: c.ev.curRow, c1: c.ev.curCol, r2: c.ev.curRow, c2: c.ev.curCol}}}
	}
	a := r.areas[0]
	top := cellAddr{row: a.r1, col: a.c1}
	switch strings.ToLower(info.toStr()) {
	case "address":
		s := "$" + colName(a.c1) + "$" + itoa(a.r1+1)
		if r.sheet != c.ev.cur {
			s = quoteSheetName(c.ev.book().sheets[r.sheet].name) + "!" + s
		}
		return strVal(s)
	case "col":
		return numVal(float64(a.c1 + 1))
	case "row":
		return numVal(float64(a.r1 + 1))
	case "color", "parentheses":
		return numVal(0)
	case "protect":
		return numVal(1)
	case "contents":
		v := c.ev.cellOn(r.sheet, top)
		if c.ev.refCell(r) == nil {
			return strVal("")
		}
		return v
	case "type":
		cell := c.ev.refCell(r)
		v := c.ev.cellOn(r.sheet, top)
		switch {
		case cell == nil || (cell.V == nil && cell.F == ""):
			return strVal("b")
		case v.kind == kindStr:
			return strVal("l")
		}
		return strVal("v")
	case "prefix":
		if c.ev.refCell(r) != nil && c.ev.cellOn(r.sheet, top).kind == kindStr {
			return strVal("'")
		}
		return strVal("")
	case "filename":
		return strVal("")
	case "width":
		// Column width in characters plus "is default width". Grown does not
		// feed column widths to the engine, so every column reports the
		// default width.
		return arrayValue([][]value{{numVal(8), boolVal(true)}})
	case "format":
		fa := ""
		if cell := c.ev.refCell(r); cell != nil && cell.CT != nil {
			fa = cell.CT.FA
		}
		return strVal(cellFormatCode(fa))
	}
	return errValue
}

// cellFormatCode maps a number-format string to CELL("format") codes.
func cellFormatCode(fa string) string {
	switch strings.TrimSpace(fa) {
	case "", "General", "@":
		return "G"
	case "0":
		return "F0"
	case "0.00":
		return "F2"
	case "#,##0":
		return ",0"
	case "#,##0.00":
		return ",2"
	case "0%":
		return "P0"
	case "0.00%":
		return "P2"
	case "0.00E+00":
		return "S2"
	case "m/d/yy", "m/d/yyyy", "yyyy-mm-dd", "yyyy/m/d":
		return "D4"
	case "d-mmm-yy", "dd-mmm-yy":
		return "D1"
	case "d-mmm", "dd-mmm":
		return "D2"
	case "mmm-yy":
		return "D3"
	case "h:mm AM/PM", "h:mm am/pm":
		return "D7"
	case "h:mm:ss AM/PM", "h:mm:ss am/pm":
		return "D6"
	case "h:mm":
		return "D9"
	case "h:mm:ss", "hh:mm:ss":
		return "D8"
	}
	return "G"
}

// wholeNum truncates a numeric argument, snapping values within 1e-9 of an
// integer (so TIME(1,0,0)*24 counts as 1).
func wholeNum(x float64) int {
	if r := math.Round(x); math.Abs(x-r) < 1e-9 {
		return int(r)
	}
	return int(math.Trunc(x))
}

// OFFSET(reference, rows, cols, [height], [width]) — a reference shifted by
// rows/cols and resized to height×width (negative sizes extend up/left).
func fnOffset(c *callCtx) value {
	if c.nargs() < 3 || c.nargs() > 5 {
		return errNA
	}
	base := c.refArg(0)
	if base == nil {
		if v := c.scalar(0); v.isErr() {
			return v
		}
		return errValue
	}
	if len(base.areas) != 1 {
		return errValue
	}
	a := base.areas[0]
	nums := []float64{0, 0, float64(a.rows()), float64(a.cols())}
	for i := 1; i < c.nargs(); i++ {
		if i >= 3 && c.omitted(i) {
			continue // omitted height/width keep the reference's size
		}
		v := c.scalar(i)
		if v.isErr() {
			return v
		}
		n, ok := v.toNum()
		if !ok {
			return errValue
		}
		nums[i-1] = n
	}
	dr, dc := wholeNum(nums[0]), wholeNum(nums[1])
	h, w := wholeNum(nums[2]), wholeNum(nums[3])
	if h == 0 || w == 0 {
		return errRef
	}
	r1, c1 := a.r1+dr, a.c1+dc
	out := area{r1: r1, c1: c1, r2: r1 + h - 1, c2: c1 + w - 1}
	if h < 0 {
		out.r1, out.r2 = r1+h+1, r1
	}
	if w < 0 {
		out.c1, out.c2 = c1+w+1, c1
	}
	if !out.inGrid() {
		return errRef
	}
	multi := out.rows()*out.cols() > 1
	return c.ev.refValue(base.sheet, multi, out)
}

// AREAS(reference) — the number of areas in a reference.
func fnAreas(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	r := c.refArg(0)
	if r == nil {
		if v := c.scalar(0); v.isErr() {
			return v
		}
		return errValue
	}
	return numVal(float64(len(r.areas)))
}

// HYPERLINK(link_location, [friendly_name]) — the displayed value: the
// friendly name when given, else the link text. (The link itself is a UI
// concern; the grid shows it as a hyperlink cell.)
func fnHyperlink(c *callCtx) value {
	if c.nargs() < 1 || c.nargs() > 2 {
		return errNA
	}
	link := asValue(c.raw(0)).topLeft()
	if link.isErr() {
		return link
	}
	if c.nargs() == 2 {
		v := asValue(c.raw(1)).topLeft()
		v.ref = nil
		return v
	}
	return strVal(link.toStr())
}

// SINGLE(value) — implicit intersection (the '@' operator).
func fnSingle(c *callCtx) value {
	if c.nargs() != 1 {
		return errNA
	}
	return c.ev.implicitIntersect(asValue(c.raw(0)))
}

// colName renders a 0-based column index as letters (0 → A).
func colName(c int) string {
	name := ""
	c++
	for c > 0 {
		c--
		name = string(rune('A'+c%26)) + name
		c /= 26
	}
	return name
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}
