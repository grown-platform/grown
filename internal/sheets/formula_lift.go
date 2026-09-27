package sheets

// Element-wise lifting of scalar functions (Excel 365 dynamic arrays).
//
// A function parameter is either a *value* parameter (one number, text or
// logical: the x of SIN(x), the text of LEFT(text, n)) or a *reference/array*
// parameter (the range of SUM, the table of VLOOKUP). When an array or a
// multi-cell range reaches a value parameter, the function is evaluated once
// per element and the results spill: =SIN(A1:A3) is a 3×1 array,
// =ROUND(A1:A3, {0,1}) pairs the two arrays element by element (a length-1
// dimension repeats; positions outside a shorter array are #N/A).
//
// The same parameter table decides how an implicit intersection is written in
// file formats (formula_storage.go): @A1:A3 in a value parameter is the legacy
// meaning of a bare range there, so it is stored without SINGLE().

import "strings"

// paramSpec lists the value parameters of a function.
type paramSpec struct {
	all  bool  // every parameter
	pos  []int // these (0-based) positions
	from int   // and every position >= from (when from > 0)
	// noLift keeps the function from being evaluated per element even though
	// its parameters count as value parameters for storage (TYPE describes
	// the array itself).
	noLift bool
	// arraysOnly (the Analysis ToolPak functions: FACTDOUBLE, ERF, DEC2BIN …)
	// lifts over array values but not over ranges, which stay #VALUE!; their
	// parameters are not value parameters for storage.
	arraysOnly bool
	// rangeError: a multi-cell range is #VALUE! outright (the ERF family),
	// where other arraysOnly functions intersect it with the formula's cell.
	rangeError bool
	// trigger, when set, lists the parameters that must hold an array for the
	// call to be lifted (IF lifts only on an array condition; its branches
	// may be ranges that it returns as they are).
	trigger []int
	// liftAll lifts over every parameter once triggered (IF pairs its
	// branches with the condition's elements), although only pos are value
	// parameters for storage.
	liftAll bool
}

func (s paramSpec) isValue(i int) bool {
	if s.all {
		return true
	}
	if s.from > 0 && i >= s.from {
		return true
	}
	for _, p := range s.pos {
		if p == i {
			return true
		}
	}
	return false
}

// lifts reports whether a lifted call runs parameter i per element.
func (s paramSpec) lifts(i int) bool { return s.liftAll || s.isValue(i) }

var valueParams = map[string]paramSpec{}

func setParams(spec paramSpec, names ...string) {
	for _, n := range names {
		valueParams[n] = spec
	}
}

func init() {
	all := paramSpec{all: true}
	// Math and trigonometry.
	setParams(all, "ABS", "ACOS", "ACOSH", "ACOT", "ACOTH", "ASIN", "ASINH", "ATAN", "ATAN2", "ATANH",
		"COS", "COSH", "COT", "COTH", "CSC", "CSCH", "SEC", "SECH", "SIN", "SINH", "TAN", "TANH",
		"DEGREES", "RADIANS", "EXP", "LN", "LOG", "LOG10", "SQRT", "POWER", "SIGN",
		"INT", "TRUNC", "ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING", "FLOOR", "CEILING.MATH", "FLOOR.MATH",
		"CEILING.PRECISE", "FLOOR.PRECISE", "ISO.CEILING", "EVEN", "ODD", "FACT", "MOD",
		"COMBIN", "COMBINA", "PERMUT", "PERMUTATIONA", "ARABIC", "BASE", "DECIMAL", "ROMAN")
	// Text.
	setParams(all, "LEFT", "LEFTB", "RIGHT", "RIGHTB", "MID", "MIDB", "LEN", "LENB", "UPPER", "LOWER",
		"PROPER", "TRIM", "CLEAN", "TEXT", "VALUE", "NUMBERVALUE", "FIND", "FINDB", "SEARCH", "SEARCHB",
		"REPLACE", "REPLACEB", "SUBSTITUTE", "REPT", "CONCATENATE", "EXACT", "CODE", "CHAR", "UNICHAR",
		"UNICODE", "DOLLAR", "FIXED", "ENCODEURL", "ASC")
	// Date and time.
	setParams(all, "DATE", "TIME", "YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND", "WEEKDAY",
		"DATEVALUE", "TIMEVALUE", "ISOWEEKNUM", "DAYS", "DAYS360", "DATEDIF")
	// Information and logical.
	setParams(all, "NOT", "ISBLANK", "ISERROR", "ISERR", "ISNA", "ISNUMBER", "ISTEXT", "ISNONTEXT",
		"ISLOGICAL", "ERROR.TYPE")
	setParams(paramSpec{pos: []int{0}, trigger: []int{0}, liftAll: true}, "IF", "IFERROR", "IFNA")
	// Criteria of the conditional aggregates.
	setParams(paramSpec{pos: []int{1}}, "SUMIF", "COUNTIF", "AVERAGEIF")
	setParams(paramSpec{pos: []int{2, 4, 6, 8, 10, 12, 14, 16, 18, 20}}, "SUMIFS", "AVERAGEIFS", "MAXIFS", "MINIFS")
	setParams(paramSpec{pos: []int{1, 3, 5, 7, 9, 11, 13, 15, 17, 19}}, "COUNTIFS")
	setParams(paramSpec{all: true, noLift: true}, "TYPE")
	// Statistical distributions and transforms of one value.
	setParams(all, "FISHER", "FISHERINV", "GAUSS", "PHI", "GAMMALN", "GAMMALN.PRECISE", "GAMMA",
		"NORMSDIST", "NORMSINV", "NORM.S.INV", "NORM.S.DIST", "NORMDIST", "NORM.DIST", "NORMINV", "NORM.INV",
		"STANDARDIZE")
	// Analysis ToolPak functions: arrays lift, ranges do not.
	atp := paramSpec{all: true, arraysOnly: true}
	setParams(paramSpec{all: true, arraysOnly: true, rangeError: true}, "ERF", "ERFC", "ERF.PRECISE", "ERFC.PRECISE")
	setParams(atp, "FACTDOUBLE", "SQRTPI", "DELTA", "GESTEP",
		"ISEVEN", "ISODD", "QUOTIENT", "MROUND", "EDATE", "EOMONTH", "WEEKNUM",
		"BIN2DEC", "BIN2HEX", "BIN2OCT", "DEC2BIN", "DEC2HEX", "DEC2OCT", "HEX2BIN", "HEX2DEC",
		"HEX2OCT", "OCT2BIN", "OCT2DEC", "OCT2HEX")
	setParams(all, "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT")
}

// liftable reports whether the function is evaluated per element when an
// array reaches one of its value parameters.
func liftable(name string) (paramSpec, bool) {
	s, ok := valueParams[name]
	if !ok || s.noLift {
		return s, false
	}
	return s, true
}

// argShape returns the dims of a function argument that is array-like (an
// array value or a multi-cell range); ok is false for scalars.
func argShape(a interface{}) (rows, cols int, ok bool) {
	switch v := a.(type) {
	case value:
		if isArrayLike(v) {
			return v.arr.rows, v.arr.cols, true
		}
	case rangeVal:
		if v.rows*v.cols > 1 {
			return v.rows, v.cols, true
		}
	}
	return 0, 0, false
}

// liftElem returns element (r, c) of an array-like argument with Excel's
// pairing rules: a length-1 dimension repeats, past the end is #N/A.
func liftElem(a interface{}, r, c int) interface{} {
	switch v := a.(type) {
	case value:
		if isArrayLike(v) {
			return bcAt(v.arr.cells, v.arr.rows, v.arr.cols, r, c)
		}
	case rangeVal:
		if v.rows*v.cols > 1 {
			return bcAt(v.cells, v.rows, v.cols, r, c)
		}
	}
	return a
}

// liftCall evaluates name per element when an array reaches a value
// parameter. handled is false when nothing needs lifting.
func (p *parser) liftCall(name string, args []interface{}) (value, bool) {
	spec, ok := liftable(name)
	if !ok {
		return value{}, false
	}
	if spec.trigger != nil {
		fire := false
		for _, i := range spec.trigger {
			if i < len(args) {
				if _, _, isArr := argShape(args[i]); isArr {
					fire = true
				}
			}
		}
		if !fire {
			return value{}, false
		}
	}
	rows, cols, any, intersected := 0, 0, false, false
	for i, a := range args {
		if !spec.lifts(i) {
			continue
		}
		if rv, isRange := a.(rangeVal); isRange && spec.arraysOnly && rv.rows*rv.cols > 1 {
			// Ranges are not lifted: they meet the formula's row or column
			// (implicit intersection), #VALUE! when they do not.
			if rv.ref == nil || spec.rangeError {
				return errValue, true
			}
			args = append([]interface{}(nil), args...)
			args[i] = p.ev.implicitIntersect(asValue(rv))
			a = args[i]
			intersected = true
		}
		r, c, isArr := argShape(a)
		if !isArr {
			continue
		}
		any = true
		if r > rows {
			rows = r
		}
		if c > cols {
			cols = c
		}
	}
	if !any {
		if intersected {
			return p.dispatch(name, args), true
		}
		return value{}, false
	}
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		row := make([]value, cols)
		for c := 0; c < cols; c++ {
			elemArgs := make([]interface{}, len(args))
			for i, a := range args {
				if spec.lifts(i) {
					e := liftElem(a, r, c)
					if ev, isVal := e.(value); isVal {
						ev.ref = nil
						e = ev
					}
					elemArgs[i] = e
				} else {
					elemArgs[i] = a
				}
			}
			v := p.dispatch(name, elemArgs)
			if v.kind == kindArray {
				v = v.topLeft()
			}
			v.ref = nil
			row[c] = v
		}
		out[r] = row
	}
	var ops []value
	for i, a := range args {
		if spec.lifts(i) {
			ops = append(ops, argArray(a))
		}
	}
	return withEdges(arrayValue(out), ops...), true
}

// argArray returns an argument as an array value, with the edge of a
// whole-row/column reference (see spillEdge).
func argArray(a interface{}) value {
	switch v := a.(type) {
	case value:
		return v
	case rangeVal:
		if v.rows*v.cols <= 1 {
			return value{}
		}
		arr := &spillArray{rows: v.rows, cols: v.cols, cells: v.cells}
		if v.ref != nil && len(v.ref.areas) == 1 {
			full := v.ref.areas[0]
			er := full.r2 == maxSheetRows-1 && full.rows() > 1
			ec := full.c2 == maxSheetCols-1 && full.cols() > 1
			if er || ec {
				arr.edge = &spillEdge{rows: er, cols: ec, fromRow: full.r1, fromCol: full.c1}
			}
		}
		return value{kind: kindArray, arr: arr}
	}
	return value{}
}

// isValueParam reports whether parameter i of the named function takes a
// single value (see formula_storage.go).
func isValueParam(name string, i int) bool {
	name = strings.ToUpper(strings.TrimPrefix(strings.TrimPrefix(strings.ToUpper(name), "_XLFN."), "_XLWS."))
	s, ok := valueParams[name]
	return ok && !s.arraysOnly && s.isValue(i)
}
