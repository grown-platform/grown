package sheets

import "strings"

// upperName normalises an identifier for case-insensitive scope lookup.
func upperName(s string) string { return strings.ToUpper(s) }

// LAMBDA / LET and the lambda-helper family (MAP, REDUCE, SCAN, BYROW, BYCOL,
// MAKEARRAY) — Excel 365 / Google Sheets parity.
//
// The base engine evaluates as it parses (no retained AST), so deferred
// evaluation is achieved by capturing the relevant token span and re-running a
// fresh parser over it under a variable environment (see parser.env and
// Evaluator.evalTokens). LAMBDA and LET are handled as special forms in
// parseIdentOrFunc because their arguments must not be eagerly evaluated.

// lambdaVal is a LAMBDA function value: parameter names, the captured (but not
// yet evaluated) body tokens, and the environment closed over at definition.
type lambdaVal struct {
	params []string
	body   []token
	env    map[string]value
}

func init() {
	registerFunc("MAP", lamMap)
	registerFunc("REDUCE", lamReduce)
	registerFunc("SCAN", lamScan)
	registerFunc("BYROW", lamByRow)
	registerFunc("BYCOL", lamByCol)
	registerFunc("MAKEARRAY", lamMakeArray)
}

// cloneEnv copies an environment so a child scope can extend it without
// mutating the parent.
func cloneEnv(e map[string]value) map[string]value {
	n := make(map[string]value, len(e)+4)
	for k, v := range e {
		n[k] = v
	}
	return n
}

// argToValue normalises a parsed argument (value / rangeVal / []value) to a
// single value so it can be bound to a lambda parameter.
func argToValue(a interface{}) value {
	switch v := a.(type) {
	case value:
		return v
	case rangeVal:
		return arrayValue(v.cells)
	case []value:
		return arrayValue([][]value{v})
	}
	return errValue
}

// lambdaArgValues converts a parsed argument list to bound values.
func lambdaArgValues(args []interface{}) []value {
	out := make([]value, len(args))
	for i, a := range args {
		out[i] = argToValue(a)
	}
	return out
}

// collectArgSpans, starting just after a '(', returns the token spans of the
// top-level comma-separated arguments and consumes the matching ')'.
func (p *parser) collectArgSpans() ([][]token, bool) {
	var spans [][]token
	var cur []token
	depth := 0
	for {
		t := p.peek()
		switch {
		case t.kind == tokEOF:
			return nil, false
		case t.kind == tokLParen:
			depth++
			cur = append(cur, t)
			p.consume()
		case t.kind == tokRParen:
			if depth == 0 {
				p.consume() // closing ')'
				spans = append(spans, cur)
				return spans, true
			}
			depth--
			cur = append(cur, t)
			p.consume()
		case t.kind == tokComma && depth == 0:
			spans = append(spans, cur)
			cur = nil
			p.consume()
		default:
			cur = append(cur, t)
			p.consume()
		}
	}
}

// parseLambda handles LAMBDA(param1, ..., paramN, body). The leading arguments
// are bare parameter names; the final argument is the body, captured uneval'd.
func (p *parser) parseLambda() value {
	p.consume() // '('
	spans, ok := p.collectArgSpans()
	if !ok || len(spans) < 1 {
		return errValue
	}
	params := make([]string, 0, len(spans)-1)
	for i := 0; i < len(spans)-1; i++ {
		s := spans[i]
		if len(s) != 1 || s[0].kind != tokIdent {
			return errValue
		}
		params = append(params, upperName(s[0].val))
	}
	body := spans[len(spans)-1]
	return value{kind: kindLambda, lam: &lambdaVal{params: params, body: body, env: p.env}}
}

// parseLet handles LET(name1, value1, ..., nameN, valueN, expression). Each
// value is evaluated once and bound before later values / the final expression.
func (p *parser) parseLet() value {
	p.consume() // '('
	spans, ok := p.collectArgSpans()
	if !ok || len(spans) < 3 || len(spans)%2 == 0 {
		return errValue // need name,val[,name,val...],expr → odd count ≥ 3
	}
	env := cloneEnv(p.env)
	for i := 0; i+1 < len(spans)-1; i += 2 {
		nameSpan := spans[i]
		if len(nameSpan) != 1 || nameSpan[0].kind != tokIdent {
			return errValue
		}
		env[upperName(nameSpan[0].val)] = p.ev.evalTokens(spans[i+1], env)
	}
	return p.ev.evalTokens(spans[len(spans)-1], env)
}

// applyLambda evaluates a lambda's body with its parameters bound to args.
func applyLambda(ev *Evaluator, lam *lambdaVal, args []value) value {
	if lam == nil {
		return errValue
	}
	if len(args) != len(lam.params) {
		return errVal("#VALUE!")
	}
	env := cloneEnv(lam.env)
	for i, name := range lam.params {
		env[name] = args[i]
	}
	return ev.evalTokens(lam.body, env)
}

// lambdaArg returns argument i as a lambda value.
func (c *callCtx) lambdaArg(i int) (*lambdaVal, bool) {
	v := c.scalar(i)
	if v.kind == kindLambda && v.lam != nil {
		return v.lam, true
	}
	return nil, false
}

// MAP(array1, [array2, ...], lambda) — apply lambda element-wise across one or
// more equally-shaped arrays.
func lamMap(c *callCtx) value {
	n := c.nargs()
	if n < 2 {
		return errNA
	}
	lam, ok := c.lambdaArg(n - 1)
	if !ok {
		return errValue
	}
	arrs := make([]rangeVal, 0, n-1)
	for i := 0; i < n-1; i++ {
		rv, ok := c.rangeArg(i)
		if !ok {
			return errValue
		}
		arrs = append(arrs, rv)
	}
	rows, cols := arrs[0].rows, arrs[0].cols
	for _, a := range arrs {
		if a.rows != rows || a.cols != cols {
			return errValue
		}
	}
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		out[r] = make([]value, cols)
		for cc := 0; cc < cols; cc++ {
			args := make([]value, len(arrs))
			for k, a := range arrs {
				args[k] = a.cells[r][cc]
			}
			out[r][cc] = applyLambda(c.ev, lam, args)
		}
	}
	return arrayValue(out)
}

// REDUCE(init, array, lambda) — fold the array left-to-right into a scalar:
// acc = lambda(acc, value).
func lamReduce(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	acc := c.scalar(0)
	rv, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	lam, ok := c.lambdaArg(2)
	if !ok {
		return errValue
	}
	for _, v := range scanCells(rv, false) {
		acc = applyLambda(c.ev, lam, []value{acc, v})
		if acc.isErr() {
			return acc
		}
	}
	return acc
}

// SCAN(init, array, lambda) — like REDUCE but emits each intermediate accumulator,
// producing an array the same shape as the input.
func lamScan(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	acc := c.scalar(0)
	rv, ok := c.rangeArg(1)
	if !ok {
		return errValue
	}
	lam, ok := c.lambdaArg(2)
	if !ok {
		return errValue
	}
	out := make([][]value, rv.rows)
	for r := 0; r < rv.rows; r++ {
		out[r] = make([]value, rv.cols)
		for cc := 0; cc < rv.cols; cc++ {
			acc = applyLambda(c.ev, lam, []value{acc, rv.cells[r][cc]})
			out[r][cc] = acc
		}
	}
	return arrayValue(out)
}

// BYROW(array, lambda) — apply lambda to each row (as an array), collecting the
// scalar results into a single column.
func lamByRow(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	rv, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	lam, ok := c.lambdaArg(1)
	if !ok {
		return errValue
	}
	out := make([][]value, rv.rows)
	for r := 0; r < rv.rows; r++ {
		row := append([]value(nil), rv.cells[r]...)
		out[r] = []value{applyLambda(c.ev, lam, []value{arrayValue([][]value{row})})}
	}
	return arrayValue(out)
}

// BYCOL(array, lambda) — apply lambda to each column (as an array), collecting
// the scalar results into a single row.
func lamByCol(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	rv, ok := c.rangeArg(0)
	if !ok {
		return errValue
	}
	lam, ok := c.lambdaArg(1)
	if !ok {
		return errValue
	}
	out := make([]value, rv.cols)
	for cc := 0; cc < rv.cols; cc++ {
		col := make([][]value, rv.rows)
		for r := 0; r < rv.rows; r++ {
			col[r] = []value{rv.cells[r][cc]}
		}
		out[cc] = applyLambda(c.ev, lam, []value{arrayValue(col)})
	}
	return arrayValue([][]value{out})
}

// MAKEARRAY(rows, cols, lambda) — build a rows×cols array; lambda(r, c) receives
// 1-based indices.
func lamMakeArray(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	rf, ok := c.num(0)
	if !ok {
		return errValue
	}
	cf, ok := c.num(1)
	if !ok {
		return errValue
	}
	rows, cols := int(rf), int(cf)
	lam, ok := c.lambdaArg(2)
	if !ok {
		return errValue
	}
	if rows <= 0 || cols <= 0 {
		return errVal("#CALC!")
	}
	out := make([][]value, rows)
	for r := 0; r < rows; r++ {
		out[r] = make([]value, cols)
		for cc := 0; cc < cols; cc++ {
			out[r][cc] = applyLambda(c.ev, lam, []value{numVal(float64(r + 1)), numVal(float64(cc + 1))})
		}
	}
	return arrayValue(out)
}
