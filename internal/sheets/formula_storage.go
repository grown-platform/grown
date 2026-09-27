package sheets

// Formula text in file-format ("storage") form and back.
//
// Grown keeps a formula as the user typed it (=SIN(@B1), =SEQUENCE(3)). Files
// (OOXML) store the pre-dynamic-array spelling instead:
//
//   - The implicit-intersection operator @ becomes _xlfn.SINGLE(x), except
//     where it restates the legacy meaning: a multi-cell reference passed
//     straight to a value parameter (SIN(@A1:B1) is stored SIN(A1:B1), as a
//     range in that position always intersected before dynamic arrays).
//   - Functions added after Excel 2007 carry the _xlfn. prefix
//     (_xlfn.UNICODE, _xlfn.SINGLE) and a few dynamic-array ones _xlfn._xlws.
//
// FormulaFromStorage reverses both. A stored formula that was a dynamic array
// (the cell metadata says so) keeps SIN(A1:B1) as it is; otherwise such a
// range in a value parameter is the legacy implicit intersection and reads
// back as SIN(@A1:B1).
//
// The value-parameter table is the one lifting uses (formula_lift.go).

import (
	"strings"
	"unicode"
)

// xlfnFuncs are functions stored with the _xlfn. prefix.
var xlfnFuncs = map[string]bool{}

// xlwsFuncs are stored as _xlfn._xlws.NAME.
var xlwsFuncs = map[string]bool{"FILTER": true, "SORT": true}

func init() {
	for _, n := range strings.Fields(`ACOT ACOTH AGGREGATE ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV
		BINOM.DIST BINOM.DIST.RANGE BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW
		CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST
		CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P
		COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST
		F.DIST.RT F.INV F.INV.RT F.TEST FLOOR.MATH FLOOR.PRECISE FORECAST.LINEAR FORMULATEXT GAMMA
		GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS HSTACK HYPGEOM.DIST IFNA IFS IMCOSH IMCOT IMCSC
		IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOMITTED ISOWEEKNUM LAMBDA LET LOGNORM.DIST
		LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST
		NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION
		PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA PHI POISSON.DIST
		QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ REDUCE RRI SCAN SEC SECH SEQUENCE SHEET
		SHEETS SINGLE SKEW.P SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T
		T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE UNIQUE VALUETOTEXT
		VAR.P VAR.S VSTACK WEIBULL.DIST WORKDAY.INTL WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR Z.TEST`) {
		xlfnFuncs[n] = true
	}
}

// ---- A small lexer that keeps the source text -------------------------------

type stLex struct {
	kind string // num str err ident op lp rp comma semi lb rb space
	text string
}

func stTokens(f string) []stLex {
	var out []stLex
	rs := []rune(f)
	for i := 0; i < len(rs); {
		r := rs[i]
		switch {
		case r == '"':
			j := i + 1
			for j < len(rs) {
				if rs[j] == '"' {
					if j+1 < len(rs) && rs[j+1] == '"' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j < len(rs) {
				j++
			}
			out = append(out, stLex{"str", string(rs[i:j])})
			i = j
		case r == '\'':
			// Quoted sheet name: 'My sheet'!A1 — part of an identifier.
			j := i + 1
			for j < len(rs) {
				if rs[j] == '\'' {
					if j+1 < len(rs) && rs[j+1] == '\'' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j < len(rs) {
				j++
			}
			k := j
			for k < len(rs) && stIdentRune(rs[k]) {
				k++
			}
			out = append(out, stLex{"ident", string(rs[i:k])})
			i = k
		case r == '#':
			j := i + 1
			for j < len(rs) && (unicode.IsLetter(rs[j]) || unicode.IsDigit(rs[j]) || rs[j] == '/' || rs[j] == '!' || rs[j] == '?' || rs[j] == '_') {
				j++
				if rs[j-1] == '!' || rs[j-1] == '?' {
					break
				}
			}
			out = append(out, stLex{"err", string(rs[i:j])})
			i = j
		case unicode.IsDigit(r) || (r == '.' && i+1 < len(rs) && unicode.IsDigit(rs[i+1])):
			j := i
			for j < len(rs) && (unicode.IsDigit(rs[j]) || rs[j] == '.') {
				j++
			}
			if j < len(rs) && (rs[j] == 'E' || rs[j] == 'e') && j+1 < len(rs) && (unicode.IsDigit(rs[j+1]) || rs[j+1] == '+' || rs[j+1] == '-') {
				j += 2
				for j < len(rs) && unicode.IsDigit(rs[j]) {
					j++
				}
			}
			// A row reference such as 3:3 is lexed as numbers around ':'.
			out = append(out, stLex{"num", string(rs[i:j])})
			i = j
		case stIdentRune(r) || r == '$':
			j := i
			for j < len(rs) && (stIdentRune(rs[j]) || rs[j] == '$' || rs[j] == '!') {
				j++
			}
			out = append(out, stLex{"ident", string(rs[i:j])})
			i = j
		case r == '(':
			out = append(out, stLex{"lp", "("})
			i++
		case r == ')':
			out = append(out, stLex{"rp", ")"})
			i++
		case r == ',':
			out = append(out, stLex{"comma", ","})
			i++
		case r == ';':
			out = append(out, stLex{"semi", ";"})
			i++
		case r == '{':
			out = append(out, stLex{"lb", "{"})
			i++
		case r == '}':
			out = append(out, stLex{"rb", "}"})
			i++
		case unicode.IsSpace(r):
			j := i
			for j < len(rs) && unicode.IsSpace(rs[j]) {
				j++
			}
			out = append(out, stLex{"space", string(rs[i:j])})
			i = j
		default:
			// Operators, two-character comparisons first.
			if i+1 < len(rs) {
				two := string(rs[i : i+2])
				if two == "<=" || two == ">=" || two == "<>" {
					out = append(out, stLex{"op", two})
					i += 2
					continue
				}
			}
			out = append(out, stLex{"op", string(r)})
			i++
		}
	}
	return out
}

func stIdentRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.' || r == '\\'
}

// ---- Rewriter ----------------------------------------------------------------

// stNode is a parsed piece of formula text: its text in the target form and
// what it is (a plain multi-cell reference; an @ applied to one).
type stNode struct {
	text     string
	multiRef bool   // a reference covering more than one cell (A1:B2, A:A, 3:3, Sheet1!A1:A9)
	at       bool   // the whole node is @x (to storage) / SINGLE(x) (from storage)
	inner    string // x, when at
	innerRef bool   // x is a multi-cell reference
}

type stRewriter struct {
	toks      []stLex
	pos       int
	toStorage bool
	dynamic   bool // from storage: the formula is a dynamic array
}

func (w *stRewriter) peek() stLex {
	for w.pos < len(w.toks) && w.toks[w.pos].kind == "space" {
		w.pos++
	}
	if w.pos >= len(w.toks) {
		return stLex{kind: "eof"}
	}
	return w.toks[w.pos]
}

func (w *stRewriter) next() stLex { t := w.peek(); w.pos++; return t }

// expr parses operands joined by binary operators.
func (w *stRewriter) expr() stNode {
	first := w.unary()
	parts := []string{first.text}
	single := true
	for {
		t := w.peek()
		if t.kind != "op" || t.text == "@" || t.text == "%" {
			break
		}
		w.next()
		parts = append(parts, t.text, w.unary().text)
		single = false
	}
	if single {
		return first
	}
	return stNode{text: strings.Join(parts, "")}
}

func (w *stRewriter) unary() stNode {
	t := w.peek()
	if t.kind == "op" && (t.text == "-" || t.text == "+") {
		w.next()
		n := w.unary()
		return stNode{text: t.text + n.text}
	}
	if t.kind == "op" && t.text == "@" {
		w.next()
		n := w.unary()
		if w.toStorage {
			return stNode{text: "_xlfn.SINGLE(" + n.text + ")", at: true, inner: n.text, innerRef: n.multiRef}
		}
		return stNode{text: "@" + n.text, at: true, inner: n.text, innerRef: n.multiRef}
	}
	n := w.postfix()
	return n
}

func (w *stRewriter) postfix() stNode {
	n := w.primary()
	for {
		t := w.peek()
		if t.kind == "op" && t.text == "%" {
			w.next()
			n = stNode{text: n.text + "%"}
			continue
		}
		break
	}
	return n
}

func (w *stRewriter) primary() stNode {
	t := w.next()
	if t.kind == "num" && w.toStorage {
		t.text = stCanonNumber(t.text)
	}
	switch t.kind {
	case "num", "ident":
		// A function call?
		if t.kind == "ident" && w.peek().kind == "lp" {
			return w.call(t.text)
		}
		text := t.text
		multi := false
		// Range operator chains: A1:B2, A:A, 3:3, Sheet1!A1:A10.
		for {
			save := w.pos
			if nt := w.peek(); nt.kind == "op" && nt.text == ":" {
				w.next()
				rt := w.peek()
				if rt.kind == "num" || rt.kind == "ident" {
					w.next()
					text += ":" + rt.text
					multi = true
					continue
				}
			}
			w.pos = save
			break
		}
		if !multi && t.kind == "ident" {
			multi = stIsNamedRange(t.text)
		}
		if multi {
			multi = stMultiCell(text)
		}
		return stNode{text: text, multiRef: multi}
	case "str", "err":
		return stNode{text: t.text}
	case "lp":
		inner := w.expr()
		var parts []string
		parts = append(parts, inner.text)
		for w.peek().kind == "comma" {
			w.next()
			parts = append(parts, w.expr().text)
		}
		if w.peek().kind == "rp" {
			w.next()
		}
		return stNode{text: "(" + strings.Join(parts, ",") + ")"}
	case "lb":
		var sb strings.Builder
		sb.WriteString("{")
		depth := 1
		for w.pos < len(w.toks) && depth > 0 {
			x := w.toks[w.pos]
			w.pos++
			if x.kind == "lb" {
				depth++
			}
			if x.kind == "rb" {
				depth--
			}
			if x.kind == "num" && w.toStorage {
				x.text = stCanonNumber(x.text)
			}
			sb.WriteString(x.text)
		}
		return stNode{text: sb.String()}
	}
	return stNode{text: t.text}
}

// stCanonNumber drops trailing zeros of a decimal fraction (7.3890 → 7.389),
// as numbers are written back from their value.
func stCanonNumber(s string) string {
	if strings.ContainsAny(s, "eE") || !strings.Contains(s, ".") {
		return s
	}
	s = strings.TrimRight(s, "0")
	return strings.TrimSuffix(s, ".")
}

// stIsNamedRange is a hook for defined names (unknown here: treated as not
// multi-cell).
func stIsNamedRange(string) bool { return false }

// stMultiCell reports whether reference text spans more than one cell.
func stMultiCell(ref string) bool {
	if i := strings.LastIndex(ref, "!"); i >= 0 {
		ref = ref[i+1:]
	}
	parts := strings.Split(strings.ReplaceAll(ref, "$", ""), ":")
	if len(parts) != 2 {
		return false
	}
	return !strings.EqualFold(parts[0], parts[1])
}

func (w *stRewriter) call(name string) stNode {
	w.next() // (
	upper := strings.ToUpper(name)
	bare := strings.TrimPrefix(strings.TrimPrefix(upper, "_XLFN."), "_XLWS.")
	var args []string
	i := 0
	for w.peek().kind != "rp" && w.peek().kind != "eof" {
		if k := w.peek().kind; k == "comma" || k == "semi" {
			args = append(args, "")
			w.next()
			i++
			continue
		}
		n := w.expr()
		args = append(args, w.argText(bare, i, n))
		i++
		if k := w.peek().kind; k == "comma" || k == "semi" {
			w.next()
			if w.peek().kind == "rp" {
				args = append(args, "")
			}
			continue
		}
		break
	}
	if w.peek().kind == "rp" {
		w.next()
	}
	if w.toStorage && bare == "SINGLE" && len(args) == 1 {
		return stNode{text: "_xlfn.SINGLE(" + args[0] + ")", at: true, inner: args[0]}
	}
	if !w.toStorage && bare == "SINGLE" && len(args) == 1 {
		return stNode{text: "@" + stAtOperand(args[0]), at: true, inner: args[0]}
	}
	return stNode{text: w.funcName(name, bare) + "(" + strings.Join(args, ",") + ")"}
}

// argText renders argument i of function fn.
func (w *stRewriter) argText(fn string, i int, n stNode) string {
	if w.toStorage {
		if n.at && n.innerRef && isValueParam(fn, i) {
			return n.inner // @range in a value parameter: the legacy meaning
		}
		return n.text
	}
	if !w.dynamic && n.multiRef && isValueParam(fn, i) {
		return "@" + n.text
	}
	return n.text
}

func (w *stRewriter) funcName(orig, bare string) string {
	if !w.toStorage {
		return bare
	}
	switch {
	case xlwsFuncs[bare]:
		return "_xlfn._xlws." + bare
	case xlfnFuncs[bare]:
		return "_xlfn." + bare
	}
	return strings.ToUpper(orig)
}

// stAtOperand parenthesises an @ operand that is not a single term.
func stAtOperand(x string) string {
	w := &stRewriter{toks: stTokens(x)}
	w.expr()
	if w.peek().kind == "eof" {
		// One term? Check that no binary operator was consumed.
		w2 := &stRewriter{toks: stTokens(x)}
		w2.unary()
		if w2.peek().kind == "eof" {
			return x
		}
	}
	return "(" + x + ")"
}

// FormulaToStorage returns the file-format text of a formula typed as f
// (with or without the leading '='; the result has none).
func FormulaToStorage(f string) string {
	f = strings.TrimPrefix(f, "=")
	w := &stRewriter{toks: stTokens(f), toStorage: true}
	var parts []string
	for w.peek().kind != "eof" {
		parts = append(parts, w.expr().text)
		if w.peek().kind != "eof" {
			parts = append(parts, w.next().text) // stray token: keep it
		}
	}
	return strings.Join(parts, "")
}

// FormulaFromStorage returns the text to show and edit (with '=') for a
// stored formula; dynamic reports whether the cell holds a dynamic array.
func FormulaFromStorage(stored string, dynamic bool) string {
	w := &stRewriter{toks: stTokens(strings.TrimPrefix(stored, "=")), dynamic: dynamic}
	var parts []string
	for w.peek().kind != "eof" {
		parts = append(parts, w.expr().text)
		if w.peek().kind != "eof" {
			parts = append(parts, w.next().text)
		}
	}
	return "=" + strings.Join(parts, "")
}

// formulaLifts reports whether a typed formula relies on dynamic arrays: a
// multi-cell reference reaches a value parameter directly (the storage form
// would otherwise read back as an implicit intersection).
func formulaLifts(f string) bool {
	return FormulaFromStorage(f, false) != FormulaFromStorage(f, true)
}
