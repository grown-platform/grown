package sheets

import "math"

// formula_logical.go — Excel-compatible LOGICAL and INFORMATION worksheet
// functions. The AND/OR/NOT/IF core logical functions live in formula.go and
// are intentionally NOT redefined here.
//
// Error semantics:
//   - IFERROR / IFNA intercept errors (they do not propagate the input error).
//   - The IS* information predicates never error — they always return TRUE/FALSE.
//   - Every other function propagates an input error normally.
//
// All select-style functions (IFERROR, IFNA, IFS, SWITCH) receive their
// arguments already evaluated by the engine, so no lazy/short-circuit
// evaluation is required — they simply pick the appropriate result.

func init() {
	// Logical.
	registerFunc("IFERROR", lgIfError)
	registerFunc("IFNA", lgIfNA)
	registerFunc("IFS", lgIfs)
	registerFunc("SWITCH", lgSwitch)
	registerFunc("XOR", lgXor)
	registerFunc("TRUE", func(c *callCtx) value { return boolVal(true) })
	registerFunc("FALSE", func(c *callCtx) value { return boolVal(false) })

	// Information.
	registerFunc("ISNUMBER", func(c *callCtx) value { v := c.scalar(0); return boolVal(v.kind == kindNum && !v.blank) })
	registerFunc("ISTEXT", func(c *callCtx) value { return boolVal(c.scalar(0).kind == kindStr) })
	registerFunc("ISNONTEXT", func(c *callCtx) value { return boolVal(c.scalar(0).kind != kindStr) })
	registerFunc("ISLOGICAL", func(c *callCtx) value { return boolVal(c.scalar(0).kind == kindBool) })
	registerFunc("ISERROR", func(c *callCtx) value { return boolVal(c.scalar(0).isErr()) })
	registerFunc("ISERR", func(c *callCtx) value { return boolVal(lgIsErr(c.scalar(0))) })
	registerFunc("ISNA", func(c *callCtx) value { return boolVal(lgIsNA(c.scalar(0))) })
	registerFunc("ISEVEN", lgIsEven)
	registerFunc("ISODD", lgIsOdd)
	registerFunc("ISBLANK", lgIsBlank)
	registerFunc("N", lgN)
	registerFunc("NA", func(c *callCtx) value { return errNA })
	registerFunc("TYPE", lgType)
	registerFunc("ERROR.TYPE", lgErrorType)
}

// ---- Logical ----------------------------------------------------------------

// lgIfError returns arg0 unless it is an error, in which case arg1 is returned.
func lgIfError(c *callCtx) value {
	v := c.scalar(0)
	if v.isErr() {
		return c.scalar(1)
	}
	return v
}

// lgIfNA returns arg0 unless it is the #N/A error, in which case arg1 is
// returned. Other errors propagate unchanged.
func lgIfNA(c *callCtx) value {
	v := c.scalar(0)
	if v.isErr() && v.toStr() == "#N/A" {
		return c.scalar(1)
	}
	return v
}

// lgIfs evaluates IFS(cond1, val1, cond2, val2, ...). The first truthy
// condition yields its paired value; if none match it returns #N/A. A condition
// that is an error propagates that error.
func lgIfs(c *callCtx) value {
	for i := 0; i+1 < c.nargs(); i += 2 {
		cond := c.scalar(i)
		if cond.isErr() {
			return cond
		}
		if cond.isTruthy() {
			return c.scalar(i + 1)
		}
	}
	return errNA
}

// lgSwitch evaluates SWITCH(expr, case1, res1, case2, res2, ..., [default]).
// expr is compared to each case; the first equal case yields its result. With
// an odd number of remaining arguments, the trailing one is the default.
// Otherwise, with no match, #N/A is returned.
func lgSwitch(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	expr := c.scalar(0)
	if expr.isErr() {
		return expr
	}
	n := c.nargs()
	i := 1
	for ; i+1 < n; i += 2 {
		caseVal := c.scalar(i)
		if caseVal.isErr() {
			return caseVal
		}
		if lgEqual(expr, caseVal) {
			return c.scalar(i + 1)
		}
	}
	// Trailing default (an unpaired final argument).
	if i < n {
		return c.scalar(i)
	}
	return errNA
}

// lgEqual reports whether two values are equal the way SWITCH (and "=")
// compares them: the types must match (TRUE is not 1, 1 is not "1"), text
// compares case-insensitively, and an empty cell equals 0, "" and FALSE. An
// array compares by its top-left element.
func lgEqual(a, b value) bool {
	a, b = a.topLeft(), b.topLeft()
	if a.blank && b.blank {
		return true
	}
	if a.blank {
		a, b = b, a
	}
	if b.blank {
		switch a.kind {
		case kindNum, kindBool:
			return a.num == 0
		case kindStr:
			return a.str == ""
		}
		return false
	}
	if a.kind != b.kind {
		return false
	}
	switch a.kind {
	case kindNum, kindBool:
		return a.num == b.num
	case kindStr:
		return lgUpper(a.str) == lgUpper(b.str)
	}
	return false
}

// lgUpper is an ASCII-friendly upper-caser used for case-insensitive matching.
func lgUpper(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 'a' - 'A'
		}
	}
	return string(b)
}

// lgLogicals collects the logical values of AND/OR/XOR's arguments the way
// Excel reads them:
//
//   - from a reference or an array: booleans and numbers count (non-zero is
//     TRUE); text and empty cells are skipped;
//   - typed directly (or a function's result): booleans and numbers count,
//     the text "TRUE"/"FALSE" counts as that logical, other text is #VALUE!;
//     an empty argument counts as FALSE.
//
// An error anywhere is returned as is. No logical value at all is #VALUE!.
func lgLogicals(c *callCtx) ([]bool, *value) {
	var out []bool
	fromData := func(x value) *value {
		switch {
		case x.isErr():
			return &x
		case x.blank:
		case x.kind == kindNum, x.kind == kindBool:
			out = append(out, x.num != 0)
		}
		return nil
	}
	for i := 0; i < c.nargs(); i++ {
		switch a := c.raw(i).(type) {
		case rangeVal:
			for _, row := range a.cells {
				for _, x := range row {
					if e := fromData(x); e != nil {
						return nil, e
					}
				}
			}
		case value:
			switch {
			case a.kind == kindArray && a.arr != nil:
				for _, row := range a.arr.cells {
					for _, x := range row {
						if e := fromData(x); e != nil {
							return nil, e
						}
					}
				}
			case a.ref != nil:
				if e := fromData(a); e != nil {
					return nil, e
				}
			case a.isErr():
				return nil, &a
			case isEmptyArg(a):
				out = append(out, false)
			case a.kind == kindStr:
				b, ok := lgTextLogical(a.str)
				if !ok {
					return nil, &errValue
				}
				out = append(out, b)
			case a.blank:
			case a.kind == kindNum, a.kind == kindBool:
				out = append(out, a.num != 0)
			}
		}
	}
	if len(out) == 0 {
		return nil, &errValue
	}
	return out, nil
}

// lgTextLogical reads the text "TRUE" or "FALSE" (any case) as a logical.
func lgTextLogical(s string) (bool, bool) {
	switch lgUpper(s) {
	case "TRUE":
		return true, true
	case "FALSE":
		return false, true
	}
	return false, false
}

func lgAnd(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	vals, e := lgLogicals(c)
	if e != nil {
		return *e
	}
	for _, b := range vals {
		if !b {
			return boolVal(false)
		}
	}
	return boolVal(true)
}

func lgOr(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	vals, e := lgLogicals(c)
	if e != nil {
		return *e
	}
	for _, b := range vals {
		if b {
			return boolVal(true)
		}
	}
	return boolVal(false)
}

// lgXor returns TRUE when an odd number of the logical values are TRUE.
func lgXor(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	vals, e := lgLogicals(c)
	if e != nil {
		return *e
	}
	count := 0
	for _, b := range vals {
		if b {
			count++
		}
	}
	return boolVal(count%2 == 1)
}

// lgNot negates one logical: a number (non-zero is TRUE), a boolean, the text
// "TRUE"/"FALSE", or an empty cell (FALSE). Other text is #VALUE!.
func lgNot(c *callCtx) value {
	if c.nargs() == 0 {
		return errNA
	}
	v := c.scalar(0).topLeft()
	switch {
	case v.isErr():
		return v
	case v.blank, isEmptyArg(v):
		return boolVal(true)
	case v.kind == kindStr:
		b, ok := lgTextLogical(v.str)
		if !ok {
			return errValue
		}
		return boolVal(!b)
	case v.kind == kindNum, v.kind == kindBool:
		return boolVal(v.num == 0)
	}
	return errValue
}

// ---- Information ------------------------------------------------------------

// lgIsErr reports whether v is an error other than #N/A.
func lgIsErr(v value) bool { return v.isErr() && v.toStr() != "#N/A" }

// lgIsNA reports whether v is the #N/A error.
func lgIsNA(v value) bool { return v.isErr() && v.toStr() == "#N/A" }

// lgIsEven implements ISEVEN(num): #VALUE! for non-numeric input, otherwise
// TRUE when the truncated integer part is even.
func lgIsEven(c *callCtx) value {
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	n, ok := v.toNum()
	if !ok {
		return errValue
	}
	return boolVal(int64(math.Trunc(n))%2 == 0)
}

// lgIsOdd implements ISODD(num): #VALUE! for non-numeric input, otherwise TRUE
// when the truncated integer part is odd.
func lgIsOdd(c *callCtx) value {
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	n, ok := v.toNum()
	if !ok {
		return errValue
	}
	return boolVal(int64(math.Trunc(n))%2 != 0)
}

// lgIsBlank implements ISBLANK on a best-effort basis.
//
// LIMITATION: the engine evaluates empty cells to the number 0 (see
// Evaluator.cellValue), so a genuinely empty cell is indistinguishable from a
// cell containing 0 at this layer. We therefore only report TRUE when the
// scalar is an empty string (""), which is the one form of "blank" that
// survives evaluation. True cell blankness cannot always be detected here.
func lgIsBlank(c *callCtx) value {
	return boolVal(c.scalar(0).blank)
}

// lgN implements N(value): a number returns itself (dates are already serial
// numbers and pass through), TRUE→1/FALSE→0, an error propagates, and any other
// value (text) yields 0.
func lgN(c *callCtx) value {
	v := c.scalar(0)
	switch v.kind {
	case kindNum, kindBool:
		return numVal(v.num)
	case kindErr:
		return v
	default:
		return numVal(0)
	}
}

// lgType implements TYPE(value): 1 number, 2 text, 4 logical, 16 error.
func lgType(c *callCtx) value {
	// An array is type 64. A multi-cell range is not a value OnlyOffice can
	// type: 16, as for an error.
	switch a := c.raw(0).(type) {
	case value:
		if isArrayLike(a) {
			return numVal(64)
		}
	case rangeVal:
		if a.rows*a.cols > 1 {
			return numVal(16)
		}
	}
	switch c.scalar(0).kind {
	case kindNum:
		return numVal(1)
	case kindStr:
		return numVal(2)
	case kindBool:
		return numVal(4)
	case kindErr:
		return numVal(16)
	}
	return numVal(2)
}

// lgErrorType implements ERROR.TYPE(value): maps an error value to its numeric
// code (1=#NULL!, 2=#DIV/0!, 3=#VALUE!, 4=#REF!, 5=#NAME?, 6=#NUM!, 7=#N/A).
// A non-error argument yields #N/A.
func lgErrorType(c *callCtx) value {
	v := c.scalar(0)
	if !v.isErr() {
		return errNA
	}
	switch v.toStr() {
	case "#NULL!":
		return numVal(1)
	case "#DIV/0!":
		return numVal(2)
	case "#VALUE!":
		return numVal(3)
	case "#REF!":
		return numVal(4)
	case "#NAME?":
		return numVal(5)
	case "#NUM!":
		return numVal(6)
	case "#N/A":
		return numVal(7)
	}
	// Unknown error kinds (e.g. #CIRC!) have no documented code → #N/A.
	return errNA
}
