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
	registerFunc("ISNUMBER", func(c *callCtx) value { return boolVal(c.scalar(0).kind == kindNum) })
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

// lgEqual reports whether two values are equal using Excel's comparison rules:
// numerics compare numerically; otherwise a case-insensitive string compare.
func lgEqual(a, b value) bool {
	an, aok := a.toNum()
	bn, bok := b.toNum()
	if aok && bok && a.kind != kindStr && b.kind != kindStr {
		return an == bn
	}
	return lgUpper(a.toStr()) == lgUpper(b.toStr())
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

// lgXor returns TRUE when an odd number of arguments are truthy. An error in any
// argument propagates.
func lgXor(c *callCtx) value {
	vals := c.flat()
	if len(vals) == 0 {
		return errNA
	}
	count := 0
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		if v.isTruthy() {
			count++
		}
	}
	return boolVal(count%2 == 1)
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
	v := c.scalar(0)
	return boolVal(v.kind == kindStr && v.str == "")
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
