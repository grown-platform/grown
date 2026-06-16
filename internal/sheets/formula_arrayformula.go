package sheets

import "math"

// ARRAYFORMULA broadcasting.
//
// Google Sheets' ARRAYFORMULA makes operators and a set of scalar functions
// apply element-wise over ranges/arrays instead of collapsing them to a single
// cell, producing a spilled result. We implement this with an `arrayMode` flag
// on the parser: while it is set (only inside an ARRAYFORMULA call) —
//   - binary/unary operators broadcast over array operands,
//   - a bare range (A2:A10) materialises as an array instead of erroring,
//   - the scalar functions in arrayBroadcastFuncs map over their array args.
// Aggregates (SUM, AVERAGE, COUNT, …) are deliberately NOT in that set, matching
// Sheets where =ARRAYFORMULA(SUM(A:A)) stays a single total.

// cellsOf returns v as a 2-D grid plus its dims, treating a scalar as 1×1.
func cellsOf(v value) (cells [][]value, rows, cols int) {
	if v.kind == kindArray && v.arr != nil && v.arr.rows > 0 && v.arr.cols > 0 {
		return v.arr.cells, v.arr.rows, v.arr.cols
	}
	return [][]value{{v}}, 1, 1
}

func isArrayLike(v value) bool {
	return v.kind == kindArray && v.arr != nil && v.arr.rows > 0 && v.arr.cols > 0
}

// bcAt indexes into a grid with broadcasting: a dimension of length 1 repeats,
// and out-of-range indices clamp to the last element.
func bcAt(cells [][]value, rows, cols, r, c int) value {
	rr, cc := r, c
	if rows == 1 {
		rr = 0
	}
	if cols == 1 {
		cc = 0
	}
	if rr >= rows {
		rr = rows - 1
	}
	if cc >= cols {
		cc = cols - 1
	}
	return cells[rr][cc]
}

// broadcast2 applies f element-wise over two operands, broadcasting scalars and
// length-1 dimensions. When neither operand is an array it just calls f.
func broadcast2(left, right value, f func(a, b value) value) value {
	if !isArrayLike(left) && !isArrayLike(right) {
		return f(left, right)
	}
	lc, lr, lco := cellsOf(left)
	rc, rr, rco := cellsOf(right)
	rows := lr
	if rr > rows {
		rows = rr
	}
	cols := lco
	if rco > cols {
		cols = rco
	}
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		row := make([]value, cols)
		for c := 0; c < cols; c++ {
			row[c] = f(bcAt(lc, lr, lco, r, c), bcAt(rc, rr, rco, r, c))
		}
		out[r] = row
	}
	return arrayValue(out)
}

// broadcast1 maps f over a single operand element-wise.
func broadcast1(v value, f func(a value) value) value {
	if !isArrayLike(v) {
		return f(v)
	}
	cells, rows, cols := cellsOf(v)
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		row := make([]value, cols)
		for c := 0; c < cols; c++ {
			row[c] = f(cells[r][c])
		}
		out[r] = row
	}
	return arrayValue(out)
}

// scalarArith applies one arithmetic operator to two scalar values. It carries
// the same error/coercion semantics the inline operator code used before, so
// scalar (non-array-mode) evaluation is unchanged.
func scalarArith(op string, left, right value) value {
	if left.isErr() {
		return left
	}
	if right.isErr() {
		return right
	}
	ln, lok := left.toNum()
	rn, rok := right.toNum()
	if !lok || !rok {
		return errValue
	}
	switch op {
	case "+":
		return numVal(ln + rn)
	case "-":
		return numVal(ln - rn)
	case "*":
		return numVal(ln * rn)
	case "/":
		if rn == 0 {
			return errDiv0
		}
		return numVal(ln / rn)
	case "^":
		res := math.Pow(ln, rn)
		if math.IsNaN(res) || math.IsInf(res, 0) {
			return errNum
		}
		return numVal(res)
	}
	return errValue
}

func scalarConcat(left, right value) value {
	if left.isErr() {
		return left
	}
	if right.isErr() {
		return right
	}
	return strVal(left.toStr() + right.toStr())
}

func scalarNeg(v value) value {
	if v.isErr() {
		return v
	}
	n, ok := v.toNum()
	if !ok {
		return errValue
	}
	return numVal(-n)
}

// arrayBroadcastFuncs are the scalar functions ARRAYFORMULA maps element-wise.
// Aggregates and reshaping functions are intentionally excluded.
var arrayBroadcastFuncs = map[string]bool{
	"IF": true, "IFERROR": true, "IFNA": true,
	"LEN": true, "UPPER": true, "LOWER": true, "TRIM": true, "PROPER": true,
	"LEFT": true, "RIGHT": true, "MID": true, "SUBSTITUTE": true, "REPLACE": true,
	"TEXT": true, "VALUE": true, "CONCATENATE": true,
	"ABS": true, "ROUND": true, "ROUNDUP": true, "ROUNDDOWN": true, "INT": true,
	"TRUNC": true, "MROUND": true, "SQRT": true, "SIGN": true, "MOD": true,
	"POWER": true, "EXP": true, "LN": true, "LOG": true, "LOG10": true,
	"ISBLANK": true, "ISNUMBER": true, "ISTEXT": true, "ISERROR": true,
	"N": true, "T": true, "EXACT": true,
}

// elemAt returns the (r,c) element of a function argument, broadcasting a
// length-1 dimension and leaving a scalar untouched.
func elemAt(a interface{}, r, c int) interface{} {
	switch v := a.(type) {
	case value:
		if isArrayLike(v) {
			cells, rows, cols := cellsOf(v)
			return bcAt(cells, rows, cols, r, c)
		}
		return v
	case rangeVal:
		if v.rows*v.cols >= 1 {
			rr, cc := r, c
			if v.rows == 1 {
				rr = 0
			}
			if v.cols == 1 {
				cc = 0
			}
			if rr >= v.rows {
				rr = v.rows - 1
			}
			if cc >= v.cols {
				cc = v.cols - 1
			}
			return v.cells[rr][cc]
		}
		return errRef
	}
	return a
}

// parseArrayFormula handles =ARRAYFORMULA(expr): it parses the single inner
// expression with arrayMode set, so operators/functions inside broadcast over
// ranges and the result spills. The opening '(' has not yet been consumed.
func (p *parser) parseArrayFormula() value {
	if p.peek().kind == tokLParen {
		p.consume()
	}
	prev := p.arrayMode
	p.arrayMode = true
	v := p.parseExpr()
	p.arrayMode = prev
	if p.peek().kind == tokRParen {
		p.consume()
	}
	return v
}

// broadcastCall maps a scalar function over its array/range arguments. Scalar
// args are held constant; array args are indexed in parallel with broadcasting.
func (p *parser) broadcastCall(name string, args []interface{}) value {
	rows, cols := 1, 1
	for _, a := range args {
		switch v := a.(type) {
		case value:
			if isArrayLike(v) {
				_, r, c := cellsOf(v)
				if r > rows {
					rows = r
				}
				if c > cols {
					cols = c
				}
			}
		case rangeVal:
			if v.rows*v.cols > 1 {
				if v.rows > rows {
					rows = v.rows
				}
				if v.cols > cols {
					cols = v.cols
				}
			}
		}
	}
	if rows == 1 && cols == 1 {
		return p.dispatch(name, args) // nothing to broadcast
	}
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		row := make([]value, cols)
		for c := 0; c < cols; c++ {
			elemArgs := make([]interface{}, len(args))
			for i, a := range args {
				elemArgs[i] = elemAt(a, r, c)
			}
			row[c] = p.dispatch(name, elemArgs)
		}
		out[r] = row
	}
	return arrayValue(out)
}
