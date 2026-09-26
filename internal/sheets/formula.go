// Package sheets — server-side formula evaluator for FortuneSheet workbooks.
//
// The engine parses and evaluates cell formulas (prefixed with "=") using a
// recursive-descent expression parser. Evaluation proceeds in topological order
// over the cell dependency graph so that referenced cells are computed before
// their dependents. Circular references are detected via DFS cycle detection and
// the affected cells receive a #CIRC! error value.
//
// Supported:
//   - Numeric literals, string literals ("…"), boolean literals (TRUE/FALSE)
//   - Cell references: A1, $A$1, $A1, A$1 (absolute column/row ignored for
//     evaluation; the engine works on a single-sheet basis per tab)
//   - Range references: A1:B3
//   - Arithmetic: + - * / ^ with correct precedence; unary minus
//   - Comparisons: = <> < <= > >=
//   - String concatenation: &
//   - Grouping: parentheses
//   - Functions: SUM AVERAGE MIN MAX COUNT COUNTA IF AND OR NOT ROUND ABS
//     CONCATENATE LEN LEFT RIGHT MID TODAY NOW
//
// Error values: #DIV/0! #VALUE! #REF! #NAME? #NUM! #N/A #CIRC!
package sheets

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// ---- FortuneSheet workbook model (minimal) ----------------------------------

// FsWorkbook is an array of sheets (top-level JSON stored in sheets_documents.data).
type FsWorkbook []FsSheet

// FsSheet mirrors one tab in the FortuneSheet model.
type FsSheet struct {
	Name     string       `json:"name"`
	ID       string       `json:"id"`
	Order    int          `json:"order"`
	Row      int          `json:"row"`
	Column   int          `json:"column"`
	CellData []FsCellData `json:"celldata"`
	// Extra preserves any other sheet-level fields (config, frozen, and our
	// custom grownCharts / grownPivots / grownIconSets) across the
	// RecomputeWorkbook round-trip, which would otherwise drop them.
	Extra map[string]json.RawMessage `json:"-"`
}

// sheetKnownKeys are the fields FsSheet models directly; everything else in the
// JSON object is captured into Extra so it survives a marshal round-trip.
var sheetKnownKeys = map[string]bool{
	"name": true, "id": true, "order": true, "row": true, "column": true, "celldata": true,
}

// MarshalJSON serialises FsSheet, merging Extra fields back at the top level.
func (sh FsSheet) MarshalJSON() ([]byte, error) {
	m := make(map[string]interface{}, 6+len(sh.Extra))
	for k, v := range sh.Extra {
		m[k] = v
	}
	m["name"] = sh.Name
	m["id"] = sh.ID
	m["order"] = sh.Order
	m["row"] = sh.Row
	m["column"] = sh.Column
	m["celldata"] = sh.CellData
	return json.Marshal(m)
}

// UnmarshalJSON deserialises FsSheet, capturing unknown fields in Extra.
func (sh *FsSheet) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if v, ok := raw["name"]; ok {
		_ = json.Unmarshal(v, &sh.Name)
	}
	if v, ok := raw["id"]; ok {
		_ = json.Unmarshal(v, &sh.ID)
	}
	if v, ok := raw["order"]; ok {
		_ = json.Unmarshal(v, &sh.Order)
	}
	if v, ok := raw["row"]; ok {
		_ = json.Unmarshal(v, &sh.Row)
	}
	if v, ok := raw["column"]; ok {
		_ = json.Unmarshal(v, &sh.Column)
	}
	if v, ok := raw["celldata"]; ok {
		if err := json.Unmarshal(v, &sh.CellData); err != nil {
			return err
		}
	}
	for k := range raw {
		if sheetKnownKeys[k] {
			delete(raw, k)
		}
	}
	if len(raw) > 0 {
		sh.Extra = raw
	}
	return nil
}

// FsCellData is one element of the celldata array: row, column, value.
type FsCellData struct {
	R int     `json:"r"`
	C int     `json:"c"`
	V *FsCell `json:"v"`
}

// FsCell holds the cell value model.
// f = formula string (e.g. "=SUM(A1:A5)")
// v = computed/raw value (number or string)
// m = display text
// ct = content type (may be nil)
type FsCell struct {
	F  string      `json:"f,omitempty"`  // formula
	V  interface{} `json:"v,omitempty"`  // computed value
	M  string      `json:"m,omitempty"`  // display text
	CT *FsCellType `json:"ct,omitempty"` // content type
	// Preserve all other fields during round-trip.
	Extra map[string]json.RawMessage `json:"-"`
}

// FsCellType carries the FortuneSheet content-type annotation.
type FsCellType struct {
	FA string `json:"fa,omitempty"`
	T  string `json:"t,omitempty"`
}

// MarshalJSON serialises FsCell, merging Extra fields at the top level.
func (c FsCell) MarshalJSON() ([]byte, error) {
	// Build a map of all known fields, then overlay extras.
	m := make(map[string]interface{}, 6+len(c.Extra))
	for k, v := range c.Extra {
		m[k] = v
	}
	if c.F != "" {
		m["f"] = c.F
	}
	if c.V != nil {
		m["v"] = c.V
	}
	if c.M != "" {
		m["m"] = c.M
	}
	if c.CT != nil {
		m["ct"] = c.CT
	}
	return json.Marshal(m)
}

// UnmarshalJSON deserialises FsCell, capturing unknown fields in Extra.
func (c *FsCell) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if v, ok := raw["f"]; ok {
		if err := json.Unmarshal(v, &c.F); err != nil {
			return err
		}
		delete(raw, "f")
	}
	if v, ok := raw["v"]; ok {
		// v can be number or string — unmarshal into interface{}
		if err := json.Unmarshal(v, &c.V); err != nil {
			return err
		}
		delete(raw, "v")
	}
	if v, ok := raw["m"]; ok {
		if err := json.Unmarshal(v, &c.M); err != nil {
			return err
		}
		delete(raw, "m")
	}
	if v, ok := raw["ct"]; ok {
		var ct FsCellType
		if err := json.Unmarshal(v, &ct); err != nil {
			return err
		}
		c.CT = &ct
		delete(raw, "ct")
	}
	if len(raw) > 0 {
		c.Extra = raw
	}
	return nil
}

// ---- Cell value types -------------------------------------------------------

type valKind int

const (
	kindNum valKind = iota
	kindStr
	kindBool
	kindErr
	kindArray  // a 2D result that spills into neighbouring cells
	kindLambda // a LAMBDA function value (params + deferred body)
)

type value struct {
	kind valKind
	num  float64
	str  string
	arr  *spillArray // set only when kind == kindArray
	lam  *lambdaVal  // set only when kind == kindLambda
	// ref is set when the value was read from a reference (A1, Sheet2!A1:B2,
	// a defined name, OFFSET(...)); see formula_refs.go.
	ref *refInfo
	// omitted marks an argument left empty (SUM(1,,2), ADDRESS(2,3,,,"S")).
	// It behaves as 0 (or "" as text); optional-argument helpers treat it as
	// absent so the function's default applies.
	omitted bool
	// blank marks the value of an empty cell. It behaves as 0 / "" but lets
	// ISBLANK and ISNUMBER tell an empty cell from a typed 0.
	blank bool
}

// blankVal is the value read from an empty cell.
var blankVal = value{kind: kindNum, blank: true}

// spillArray is a rectangular result produced by a dynamic-array function
// (SEQUENCE, FILTER, SORT, UNIQUE, TRANSPOSE …). When a formula evaluates to
// one, Recompute writes the top-left into the formula cell and "spills" the
// remaining cells into the cells below/right (or #SPILL! if blocked).
type spillArray struct {
	rows, cols int
	cells      [][]value // row-major, cells[r][c]
}

// arrayValue wraps a 2D result. A 1×1 array collapses to its scalar; an empty
// array becomes #CALC! (matching Excel's empty dynamic-array result).
func arrayValue(cells [][]value) value {
	rows := len(cells)
	cols := 0
	if rows > 0 {
		cols = len(cells[0])
	}
	if rows == 0 || cols == 0 {
		return errVal("#CALC!")
	}
	if rows == 1 && cols == 1 {
		return cells[0][0]
	}
	return value{kind: kindArray, arr: &spillArray{rows: rows, cols: cols, cells: cells}}
}

// topLeft returns the anchor cell of an array value (or the value itself when
// it is not an array). Used when an array is consumed in a scalar context.
func (v value) topLeft() value {
	if v.kind == kindArray && v.arr != nil && v.arr.rows > 0 && v.arr.cols > 0 {
		return v.arr.cells[0][0]
	}
	return v
}

var (
	errDiv0  = value{kind: kindErr, str: "#DIV/0!"}
	errValue = value{kind: kindErr, str: "#VALUE!"}
	errRef   = value{kind: kindErr, str: "#REF!"}
	errName  = value{kind: kindErr, str: "#NAME?"}
	errNum   = value{kind: kindErr, str: "#NUM!"}
	errNA    = value{kind: kindErr, str: "#N/A"}
	errCirc  = value{kind: kindErr, str: "#CIRC!"}
	errSpill = value{kind: kindErr, str: "#SPILL!"}
)

func numVal(n float64) value { return value{kind: kindNum, num: n} }
func strVal(s string) value  { return value{kind: kindStr, str: s} }
func boolVal(b bool) value {
	n := 0.0
	if b {
		n = 1.0
	}
	return value{kind: kindBool, num: n}
}
func errVal(msg string) value { return value{kind: kindErr, str: msg} }

func (v value) isErr() bool { return v.kind == kindErr }
func (v value) isTruthy() bool {
	switch v.kind {
	case kindNum, kindBool:
		return v.num != 0
	case kindStr:
		return v.str != ""
	case kindArray:
		return v.topLeft().isTruthy()
	}
	return false
}

// toNum coerces a value to a number.
func (v value) toNum() (float64, bool) {
	switch v.kind {
	case kindNum, kindBool:
		return v.num, true
	case kindStr:
		if f, err := strconv.ParseFloat(strings.TrimSpace(v.str), 64); err == nil {
			return f, true
		}
		return 0, false
	case kindArray:
		return v.topLeft().toNum()
	}
	return 0, false
}

// toStr returns the display string for a value.
func (v value) toStr() string {
	switch v.kind {
	case kindNum:
		if v.num == math.Trunc(v.num) && !math.IsInf(v.num, 0) {
			return strconv.FormatInt(int64(v.num), 10)
		}
		return strconv.FormatFloat(v.num, 'f', -1, 64)
	case kindBool:
		if v.num != 0 {
			return "TRUE"
		}
		return "FALSE"
	case kindStr:
		return v.str
	case kindErr:
		return v.str
	case kindArray:
		return v.topLeft().toStr()
	}
	return ""
}

// asInterface converts to the JSON-compatible type used in FsCell.V.
func (v value) asInterface() interface{} {
	switch v.kind {
	case kindNum, kindBool:
		return v.num
	case kindStr:
		return v.str
	case kindErr:
		return v.str
	case kindArray:
		return v.topLeft().asInterface()
	}
	return nil
}

// ---- Cell address -----------------------------------------------------------

// cellAddr identifies a cell by 0-based row and column.
type cellAddr struct{ row, col int }

// colIndex converts a column letter(s) (A=0, B=1, …, Z=25, AA=26 …) to 0-based index.
func colIndex(s string) int {
	s = strings.ToUpper(strings.TrimLeft(s, "$"))
	idx := 0
	for _, ch := range s {
		idx = idx*26 + int(ch-'A'+1)
	}
	return idx - 1
}

// rowIndex converts a row string (1-based, may have leading $) to 0-based.
func rowIndex(s string) int {
	s = strings.TrimLeft(s, "$")
	n, _ := strconv.Atoi(s)
	return n - 1
}

var cellRefRe = regexp.MustCompile(`(?i)^\$?([A-Z]{1,3})\$?(\d{1,7})$`)

// parseCellRef parses a reference like "A1", "$A$1", "$A1", "A$1".
// Returns (addr, true) on success.
func parseCellRef(s string) (cellAddr, bool) {
	m := cellRefRe.FindStringSubmatch(s)
	if m == nil {
		return cellAddr{}, false
	}
	a := cellAddr{row: rowIndex(m[2]), col: colIndex(m[1])}
	// Beyond Excel's grid (XFD1048576) the text is a name, not a cell.
	if a.row < 0 || a.row >= maxSheetRows || a.col >= maxSheetCols {
		return cellAddr{}, false
	}
	return a, true
}

// addrToName converts 0-based (row, col) → "A1" notation.
func addrToName(row, col int) string {
	col++ // 1-based
	name := ""
	for col > 0 {
		col--
		name = string(rune('A'+col%26)) + name
		col /= 26
	}
	return fmt.Sprintf("%s%d", name, row+1)
}

// ---- Sheet grid (one worksheet) --------------------------------------------

// grid is a row×col lookup backed by the FsSheet celldata.
type grid struct {
	cells map[cellAddr]*FsCell // mutable during recompute
}

func newGrid(data []FsCellData) *grid {
	g := &grid{cells: make(map[cellAddr]*FsCell, len(data))}
	for i := range data {
		if data[i].V != nil {
			g.cells[cellAddr{row: data[i].R, col: data[i].C}] = data[i].V
		}
	}
	return g
}

// get returns the raw value of a cell (not a formula result).
// Returns nil for empty cells.
func (g *grid) get(a cellAddr) *FsCell { return g.cells[a] }

// set writes computed value back into the grid (for downstream formula refs).
func (g *grid) set(a cellAddr, cell *FsCell) { g.cells[a] = cell }

// ---- Dependency graph + topological sort -----------------------------------

// extractRefs parses an expression string and returns all cell addresses it
// contains (possibly with duplicates).
func extractRefs(expr string) []cellAddr {
	// Tokenise and collect identifiers that look like cell refs or ranges.
	toks := tokenise(expr)
	var refs []cellAddr
	skip := make(map[int]bool) // indices already consumed as part of a range
	for i, tok := range toks {
		if skip[i] {
			continue
		}
		if tok.kind == tokIdent || tok.kind == tokCellRef {
			// Check if next token is ':' (range)
			if i+2 < len(toks) && toks[i+1].kind == tokColon {
				// Range: toks[i]:toks[i+2]
				a1, ok1 := parseCellRef(tok.val)
				a2, ok2 := parseCellRef(toks[i+2].val)
				if ok1 && ok2 {
					for r := a1.row; r <= a2.row; r++ {
						for c := a1.col; c <= a2.col; c++ {
							refs = append(refs, cellAddr{row: r, col: c})
						}
					}
					// Mark the colon and second cell ref as consumed.
					skip[i+1] = true
					skip[i+2] = true
					continue
				}
			}
			if a, ok := parseCellRef(tok.val); ok {
				refs = append(refs, a)
			}
		}
	}
	return refs
}

// ---- Evaluator --------------------------------------------------------------

// Evaluator holds the grid state for one worksheet evaluation pass.
type Evaluator struct {
	grid    *grid
	results map[cellAddr]value // cached evaluated values
	now     time.Time
	// curRow/curCol are the 0-based address of the formula cell currently being
	// evaluated, so functions like ROW()/COLUMN() with no argument can resolve
	// "this cell". Set by Recompute before each evalExpr.
	curRow, curCol int
	// wb is the whole workbook (every sheet, defined names); cur is the index
	// of the sheet grid/results belong to. See formula_refs.go.
	wb  *workbookView
	cur int
}

// cellValue returns the evaluated value for a cell (reading from results cache
// or, for non-formula cells, from the raw grid value).
func (ev *Evaluator) cellValue(addr cellAddr) value {
	if v, ok := ev.results[addr]; ok {
		v.ref = nil
		return v
	}
	cell := ev.grid.get(addr)
	if cell == nil {
		return blankVal // empty cell = 0 for arithmetic
	}
	if strings.HasPrefix(cell.F, "=") {
		// A formula cell not computed yet (reached through a reference the
		// static graph could not see, e.g. INDIRECT): compute it now.
		ev.book()
		v := ev.ensureFormula(ev.cur, addr)
		v.ref = nil
		return v
	}
	if cell.V == nil {
		return blankVal
	}
	switch val := cell.V.(type) {
	case float64:
		return numVal(val)
	case string:
		// Try numeric parse first.
		if f, err := strconv.ParseFloat(strings.TrimSpace(val), 64); err == nil {
			return numVal(f)
		}
		return strVal(val)
	case bool:
		return boolVal(val)
	}
	return numVal(0)
}

// evalExpr parses and evaluates the expression string (no leading "=").
func (ev *Evaluator) evalExpr(expr string) value {
	p := &parser{tokens: tokenise(expr), ev: ev}
	v := p.parseExpr()
	if p.syntaxErr {
		return errName // malformed call: Excel would not accept the formula
	}
	if p.pos < len(p.tokens) {
		return errValue // unconsumed tokens
	}
	// A bare LAMBDA value that reaches a cell has no meaning in Excel → #CALC!.
	if v.kind == kindLambda {
		return errVal("#CALC!")
	}
	return v
}

// evalTokens evaluates a captured token span (a LAMBDA body or a LET binding /
// final expression) under the given variable environment.
func (ev *Evaluator) evalTokens(tokens []token, env map[string]value) value {
	p := &parser{tokens: tokens, ev: ev, env: env}
	v := p.parseExpr()
	if p.pos < len(p.tokens) {
		return errValue
	}
	return v
}

// ---- Tokeniser --------------------------------------------------------------

type tokKind int

const (
	tokNum     tokKind = iota // numeric literal
	tokStr                    // string literal
	tokIdent                  // identifier (function name, cell ref, TRUE/FALSE)
	tokCellRef                // explicit cell reference (after parsing ident)
	tokOp                     // operator character(s)
	tokLParen                 // (
	tokRParen                 // )
	tokComma                  // ,
	tokColon                  // :
	tokLBrace                 // { (array constant start)
	tokRBrace                 // } (array constant end)
	tokSemi                   // ; (array constant row separator)
	tokEOF
	tokErr   // error literal (#N/A, #DIV/0!, …)
	tokSheet // sheet prefix: Sheet2! or 'My Sheet'! (val is the bare name)
)

// errorLiterals are the error values a formula may spell out directly
// (e.g. =IFERROR(#N/A,1) or {1,#DIV/0!}); longest spellings first.
var errorLiterals = []string{"#GETTING_DATA", "#DIV/0!", "#VALUE!", "#SPILL!", "#CALC!", "#NAME?", "#NULL!", "#REF!", "#NUM!", "#N/A"}

type token struct {
	kind tokKind
	val  string
	// space is set when whitespace precedes the token; between two references
	// it is the intersection operator (A1:B5 B2:C3).
	space bool
}

// isIdentStart / isIdentPart classify identifier runes. Besides ASCII letters,
// digits, '$', '_' and '.', any Unicode letter, mark or digit is accepted so
// sheet names like हरियाणवी can be written unquoted.
func isIdentStart(r rune) bool {
	return r == '$' || r == '_' || r == '\\' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' ||
		r >= 0x80 && (unicode.IsLetter(r) || unicode.IsMark(r))
}

func isIdentPart(r rune) bool {
	return isIdentStart(r) || r == '.' || r >= '0' && r <= '9' || r >= 0x80 && unicode.IsDigit(r)
}

func tokenise(s string) []token {
	var tokens []token
	space := false
	emit := func(t token) {
		t.space = space
		space = false
		tokens = append(tokens, t)
	}
	i := 0
	for i < len(s) {
		ch := s[i]
		// Skip whitespace.
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			space = true
			i++
			continue
		}
		// String literal.
		if ch == '"' {
			j := i + 1
			var sb strings.Builder
			for j < len(s) {
				if s[j] == '"' {
					if j+1 < len(s) && s[j+1] == '"' {
						sb.WriteByte('"')
						j += 2
						continue
					}
					break
				}
				sb.WriteByte(s[j])
				j++
			}
			emit(token{kind: tokStr, val: sb.String()})
			if j < len(s) {
				j++ // closing quote
			}
			i = j
			continue
		}
		// Quoted sheet name: 'My Sheet'!A1 ('' escapes a quote).
		if ch == '\'' {
			j := i + 1
			var sb strings.Builder
			for j < len(s) {
				if s[j] == '\'' {
					if j+1 < len(s) && s[j+1] == '\'' {
						sb.WriteByte('\'')
						j += 2
						continue
					}
					break
				}
				sb.WriteByte(s[j])
				j++
			}
			if j < len(s) {
				j++ // closing quote
			}
			if j < len(s) && s[j] == '!' {
				emit(token{kind: tokSheet, val: sb.String()})
				j++
			} else {
				emit(token{kind: tokIdent, val: "'" + sb.String() + "'"})
			}
			i = j
			continue
		}
		// Error literal.
		if ch == '#' {
			matched := false
			for _, e := range errorLiterals {
				if len(s)-i >= len(e) && strings.EqualFold(s[i:i+len(e)], e) {
					emit(token{kind: tokErr, val: e})
					i += len(e)
					matched = true
					break
				}
			}
			if matched {
				continue
			}
		}
		// Numeric literal.
		if ch >= '0' && ch <= '9' || (ch == '.' && i+1 < len(s) && s[i+1] >= '0' && s[i+1] <= '9') {
			j := i
			for j < len(s) && (s[j] >= '0' && s[j] <= '9' || s[j] == '.') {
				j++
			}
			// Scientific notation.
			if j < len(s) && (s[j] == 'e' || s[j] == 'E') {
				j++
				if j < len(s) && (s[j] == '+' || s[j] == '-') {
					j++
				}
				for j < len(s) && s[j] >= '0' && s[j] <= '9' {
					j++
				}
			}
			emit(token{kind: tokNum, val: s[i:j]})
			i = j
			continue
		}
		// Identifier / cell ref / function name / sheet prefix. A '.' is allowed
		// mid-identifier so dotted function names (STDEV.S, NORM.DIST) tokenise
		// as one identifier; a trailing '.' is left out. An identifier directly
		// followed by '!' is a sheet name (Sheet2!A1).
		if r, _ := utf8.DecodeRuneInString(s[i:]); isIdentStart(r) {
			j := i
			for j < len(s) {
				r, n := utf8.DecodeRuneInString(s[j:])
				if !isIdentPart(r) {
					break
				}
				j += n
			}
			name := s[i:j]
			if j < len(s) && s[j] == '!' {
				emit(token{kind: tokSheet, val: name})
				i = j + 1
				continue
			}
			for len(name) > 0 && name[len(name)-1] == '.' {
				name = name[:len(name)-1]
				j--
			}
			emit(token{kind: tokIdent, val: name})
			i = j
			continue
		}
		// Two-character operators.
		if i+1 < len(s) {
			two := s[i : i+2]
			if two == "<>" || two == "<=" || two == ">=" {
				emit(token{kind: tokOp, val: two})
				i += 2
				continue
			}
		}
		// Single-character operators / punctuation.
		switch ch {
		case '+', '-', '*', '/', '^', '=', '<', '>', '&', '@':
			emit(token{kind: tokOp, val: string(ch)})
		case '(':
			emit(token{kind: tokLParen, val: "("})
		case ')':
			emit(token{kind: tokRParen, val: ")"})
		case ',':
			emit(token{kind: tokComma, val: ","})
		case ':':
			emit(token{kind: tokColon, val: ":"})
		case '{':
			emit(token{kind: tokLBrace, val: "{"})
		case '}':
			emit(token{kind: tokRBrace, val: "}"})
		case ';':
			emit(token{kind: tokSemi, val: ";"})
		}
		if ch >= 0x80 {
			_, n := utf8.DecodeRuneInString(s[i:])
			i += n
			continue
		}
		i++
	}
	return tokens
}

// ---- Recursive descent parser -----------------------------------------------
// Grammar (precedence, low → high):
//   expr    = comparison
//   comparison = concat {('='|'<>'|'<'|'<='|'>'|'>=') concat}
//   concat  = additive {& additive}
//   additive = multiplicative {('+'|'-') multiplicative}
//   multiplicative = power {('*'|'/') power}
//   power   = unary {'^' unary}
//   unary   = '-' unary | primary
//   primary = number | string | '(' expr ')' | ident ['(' args ')'] | range

type parser struct {
	tokens []token
	pos    int
	ev     *Evaluator
	// env holds names bound by LET / LAMBDA in the current scope (keys uppercased).
	// nil at the top level; populated for sub-expressions evaluated via evalTokens.
	env map[string]value
	// arrayMode is set while evaluating inside ARRAYFORMULA(...): scalar
	// functions then broadcast element-wise over array/range operands.
	// (Operators broadcast over arrays in every mode, as in Excel 365.)
	arrayMode bool
	// defSheet (when hasDefSheet) is the sheet unqualified references resolve
	// to; otherwise they resolve to the evaluator's current sheet. Set while a
	// defined name's definition or the right side of Sheet2!A1:B2 is parsed.
	defSheet    int
	hasDefSheet bool
	// syntaxErr is set when a function call is not closed where expected
	// (SUM(My Sheet!A1) with an unquoted space); the formula is then #NAME?.
	syntaxErr bool
}

// refSheet returns the sheet an unqualified reference points at.
func (p *parser) refSheet() int {
	if p.hasDefSheet {
		return p.defSheet
	}
	p.ev.book()
	return p.ev.cur
}

func (p *parser) peek() token {
	if p.pos >= len(p.tokens) {
		return token{kind: tokEOF}
	}
	return p.tokens[p.pos]
}

func (p *parser) consume() token {
	t := p.peek()
	p.pos++
	return t
}

func (p *parser) parseExpr() value { return p.parseComparison() }

func (p *parser) parseComparison() value {
	left := p.parseConcat()
	for {
		t := p.peek()
		if t.kind != tokOp {
			break
		}
		switch t.val {
		case "=", "<>", "<", "<=", ">", ">=":
			op := t.val
			p.consume()
			right := p.parseConcat()
			left = broadcast2(left, right, func(a, b value) value { return compareValues(op, a, b) })
		default:
			return left
		}
	}
	return left
}

func compareValues(op string, left, right value) value {
	if left.isErr() {
		return left
	}
	if right.isErr() {
		return right
	}
	// Both numeric?
	ln, lok := left.toNum()
	rn, rok := right.toNum()
	if lok && rok {
		var b bool
		switch op {
		case "=":
			b = ln == rn
		case "<>":
			b = ln != rn
		case "<":
			b = ln < rn
		case "<=":
			b = ln <= rn
		case ">":
			b = ln > rn
		case ">=":
			b = ln >= rn
		}
		return boolVal(b)
	}
	// String comparison.
	ls, rs := strings.ToUpper(left.toStr()), strings.ToUpper(right.toStr())
	var b bool
	switch op {
	case "=":
		b = ls == rs
	case "<>":
		b = ls != rs
	case "<":
		b = ls < rs
	case "<=":
		b = ls <= rs
	case ">":
		b = ls > rs
	case ">=":
		b = ls >= rs
	}
	return boolVal(b)
}

func (p *parser) parseConcat() value {
	left := p.parseAdditive()
	for p.peek().kind == tokOp && p.peek().val == "&" {
		p.consume()
		right := p.parseAdditive()
		left = broadcast2(left, right, scalarConcat)
	}
	return left
}

func (p *parser) parseAdditive() value {
	left := p.parseMultiplicative()
	for p.peek().kind == tokOp && (p.peek().val == "+" || p.peek().val == "-") {
		op := p.consume().val
		right := p.parseMultiplicative()
		left = broadcast2(left, right, func(a, b value) value { return scalarArith(op, a, b) })
	}
	return left
}

func (p *parser) parseMultiplicative() value {
	left := p.parsePower()
	for p.peek().kind == tokOp && (p.peek().val == "*" || p.peek().val == "/") {
		op := p.consume().val
		right := p.parsePower()
		left = broadcast2(left, right, func(a, b value) value { return scalarArith(op, a, b) })
	}
	return left
}

func (p *parser) parsePower() value {
	base := p.parseUnary()
	for p.peek().kind == tokOp && p.peek().val == "^" {
		p.consume()
		exp := p.parseUnary()
		base = broadcast2(base, exp, func(a, b value) value { return scalarArith("^", a, b) })
	}
	return base
}

func (p *parser) parseUnary() value {
	if p.peek().kind == tokOp && p.peek().val == "-" {
		p.consume()
		v := p.parseUnary()
		return broadcast1(v, scalarNeg)
	}
	if p.peek().kind == tokOp && p.peek().val == "@" {
		p.consume()
		return p.ev.implicitIntersect(p.parseUnary())
	}
	if p.peek().kind == tokOp && p.peek().val == "+" {
		p.consume()
		return p.parseUnary()
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() value {
	v := p.parseRangeOperand()
	// Intersection: whitespace between two references (A1:C5 B2:B9).
	for v.ref != nil && p.peek().space && (p.peek().kind == tokIdent || p.peek().kind == tokSheet) {
		w := p.parseRangeOperand()
		v = p.ev.intersectRefs(v, w)
	}
	return v
}

// parseRangeOperand parses a primary followed by any number of ':' range
// operators (A1:B2, C2:C3:C2, (A1:A3):F1, A1:INDEX(...)).
func (p *parser) parseRangeOperand() value {
	v := p.parsePrimaryBase()
	// Postfix application: a LAMBDA value (or expression yielding one) can be
	// called immediately, e.g. =LAMBDA(x,x+1)(5).
	for v.kind == kindLambda && p.peek().kind == tokLParen {
		p.consume() // '('
		args := p.parseArgList()
		if p.peek().kind == tokRParen {
			p.consume()
		}
		v = applyLambda(p.ev, v.lam, lambdaArgValues(args))
	}
	for p.peek().kind == tokColon {
		if v.ref == nil {
			if v.isErr() {
				p.consume()
				p.parsePrimaryBase()
				continue
			}
			return v
		}
		p.consume()
		// The right side of Sheet2!A1:B2 lives on the left side's sheet.
		prevSheet, prevHas := p.defSheet, p.hasDefSheet
		p.defSheet, p.hasDefSheet = v.ref.sheet, true
		w := p.parsePrimaryBase()
		p.defSheet, p.hasDefSheet = prevSheet, prevHas
		v = p.ev.rangeRefs(v, w)
	}
	return v
}

func (p *parser) parsePrimaryBase() value {
	t := p.peek()
	switch t.kind {
	case tokNum:
		// Whole-row reference: 1:3.
		if v, ok := p.tryLineRef(p.refSheet()); ok {
			return v
		}
		p.consume()
		f, err := strconv.ParseFloat(t.val, 64)
		if err != nil {
			return errValue
		}
		return numVal(f)
	case tokStr:
		p.consume()
		return strVal(t.val)
	case tokErr:
		p.consume()
		return errVal(t.val)
	case tokSheet:
		p.consume()
		si, found := p.ev.book().sheetIndexByName(t.val)
		nt := p.peek()
		if nt.kind == tokErr {
			p.consume()
			return errVal(nt.val)
		}
		if !found {
			// Skip the reference that follows; a missing sheet is #REF!.
			if nt.kind == tokIdent || nt.kind == tokNum {
				if _, next, ok := scanRefAtom(p.tokens, p.pos); ok {
					p.pos = next
				} else {
					p.consume()
				}
			}
			return errRef
		}
		prevSheet, prevHas := p.defSheet, p.hasDefSheet
		p.defSheet, p.hasDefSheet = si, true
		defer func() { p.defSheet, p.hasDefSheet = prevSheet, prevHas }()
		if v, ok := p.tryLineRef(si); ok {
			return v
		}
		if nt.kind == tokIdent {
			if _, ok := parseCellRef(nt.val); ok {
				p.consume()
				a, _ := parseCellRef(nt.val)
				return p.ev.refValue(si, false, area{r1: a.row, c1: a.col, r2: a.row, c2: a.col})
			}
			// Sheet-qualified name, or garbage after the '!'.
			p.consume()
			if v, ok := p.resolveName(strings.ToUpper(nt.val)); ok {
				return v
			}
			return errName
		}
		return errRef
	case tokLParen:
		p.consume()
		v := p.parseExpr()
		// Union operator inside parentheses: (A1:B2,D4).
		if p.peek().kind == tokComma {
			parts := []value{v}
			for p.peek().kind == tokComma {
				p.consume()
				parts = append(parts, p.parseExpr())
			}
			v = p.ev.unionRefs(parts)
		}
		if p.peek().kind == tokRParen {
			p.consume()
		}
		return v
	case tokLBrace:
		return p.parseArrayConstant()
	case tokIdent:
		return p.parseIdentOrFunc()
	}
	return errValue
}

// tryLineRef parses a whole-column (A:C, $A:$A) or whole-row (1:3, $2:$2)
// reference at the current position on sheet si.
func (p *parser) tryLineRef(si int) (value, bool) {
	if p.pos+2 >= len(p.tokens) || p.tokens[p.pos+1].kind != tokColon {
		return value{}, false
	}
	t1, t2 := p.tokens[p.pos], p.tokens[p.pos+2]
	if t1.kind == tokIdent && t2.kind == tokIdent {
		if _, isCell := parseCellRef(t1.val); !isCell {
			if c1, ok := parseColRef(t1.val); ok {
				if c2, ok := parseColRef(t2.val); ok {
					p.pos += 3
					return p.ev.refValue(si, true, normArea(area{r1: 0, c1: c1, r2: maxSheetRows - 1, c2: c2})), true
				}
			}
		}
	}
	if (t1.kind == tokNum || t1.kind == tokIdent) && (t2.kind == tokNum || t2.kind == tokIdent) {
		if r1, ok := parseRowRef(t1.val); ok {
			if r2, ok := parseRowRef(t2.val); ok {
				p.pos += 3
				return p.ev.refValue(si, true, normArea(area{r1: r1, c1: 0, r2: r2, c2: maxSheetCols - 1})), true
			}
		}
	}
	return value{}, false
}

// parseArrayConstant parses an inline array literal {1,2,3} (single row) or
// {1,2;3,4} (rows separated by ';', columns by ','). Elements may be any
// expression. Rows are padded with empty strings to a common width.
func (p *parser) parseArrayConstant() value {
	p.consume() // '{'
	var rows [][]value
	cur := []value{}
	for {
		t := p.peek()
		if t.kind == tokRBrace || t.kind == tokEOF {
			break
		}
		cur = append(cur, p.parseExpr())
		switch p.peek().kind {
		case tokComma:
			p.consume()
		case tokSemi:
			p.consume()
			rows = append(rows, cur)
			cur = []value{}
		}
	}
	if p.peek().kind == tokRBrace {
		p.consume()
	}
	rows = append(rows, cur)
	width := 0
	for _, r := range rows {
		if len(r) > width {
			width = len(r)
		}
	}
	if width == 0 {
		return errVal("#CALC!")
	}
	for i := range rows {
		for len(rows[i]) < width {
			rows[i] = append(rows[i], strVal(""))
		}
	}
	return arrayValue(rows)
}

func (p *parser) parseIdentOrFunc() value {
	t := p.consume() // tokIdent
	upper := strings.ToUpper(t.val)

	// Boolean literals.
	if upper == "TRUE" {
		return boolVal(true)
	}
	if upper == "FALSE" {
		return boolVal(false)
	}

	// Function call.
	if p.peek().kind == tokLParen {
		// Special forms whose arguments must NOT be eagerly evaluated.
		switch upper {
		case "LAMBDA":
			return p.parseLambda()
		case "LET":
			return p.parseLet()
		case "ARRAYFORMULA":
			return p.parseArrayFormula()
		}
		p.consume() // '('
		// A name bound to a lambda in scope can be invoked: name(args).
		if p.env != nil {
			if bv, ok := p.env[upper]; ok && bv.kind == kindLambda {
				args := p.parseArgList()
				if p.peek().kind == tokRParen {
					p.consume()
				}
				return applyLambda(p.ev, bv.lam, lambdaArgValues(args))
			}
		}
		args := p.parseArgList()
		if p.peek().kind == tokRParen {
			p.consume()
		} else {
			p.syntaxErr = true
		}
		return p.callFunc(upper, args)
	}

	// Variable bound by LET / LAMBDA in the current scope.
	if p.env != nil {
		if bv, ok := p.env[upper]; ok {
			return bv
		}
	}

	// Whole-column reference (A:C).
	p.pos--
	if v, ok := p.tryLineRef(p.refSheet()); ok {
		return v
	}
	p.pos++

	// Cell reference.
	if addr, ok := parseCellRef(t.val); ok {
		return p.ev.refValue(p.refSheet(), false, area{r1: addr.row, c1: addr.col, r2: addr.row, c2: addr.col})
	}

	// Defined name.
	if v, ok := p.resolveName(upper); ok {
		return v
	}

	// Unknown name.
	return errName
}

// parseArgList parses comma-separated arguments until ')'. Each argument may be
// a range (A1:B3) producing a []value, or a single expression.
func (p *parser) parseArgList() []interface{} {
	var args []interface{}
	if p.peek().kind == tokRParen || p.peek().kind == tokEOF {
		return args
	}
	for {
		if k := p.peek().kind; k == tokComma || k == tokRParen || k == tokEOF {
			args = append(args, omittedArg)
		} else {
			args = append(args, p.parseArg())
		}
		if p.peek().kind != tokComma {
			break
		}
		p.consume() // ','
	}
	return args
}

// parseArg parses one argument. A reference written as a range (A1:B3,
// Sheet2!A:A, a union, OFFSET(...) spanning several cells) is passed as a
// rangeVal so lookup/array functions keep its shape; anything else is a value
// (a single-cell reference still carries its refInfo).
func (p *parser) parseArg() interface{} {
	v := p.parseExpr()
	if v.ref != nil && (v.ref.rangeForm || v.kind == kindArray) {
		return v.toRangeVal()
	}
	return v
}

// flattenArgs flattens function arguments (value, []value, or rangeVal) into a
// flat row-major slice of values.
func flattenArgs(args []interface{}) []value {
	var out []value
	for _, a := range args {
		switch v := a.(type) {
		case value:
			// An array value (from a spill function or a lambda param) expands
			// into its cells, so e.g. SUM(SEQUENCE(3)) and SUM(row) work.
			if v.kind == kindArray && v.arr != nil {
				for _, row := range v.arr.cells {
					out = append(out, row...)
				}
			} else {
				out = append(out, v)
			}
		case []value:
			out = append(out, v...)
		case rangeVal:
			for _, row := range v.cells {
				out = append(out, row...)
			}
		}
	}
	return out
}

// ---- Range values + function registry --------------------------------------
//
// A function argument is one of:
//   - value     — a scalar (literal, single cell ref, or sub-expression result)
//   - rangeVal  — a rectangular A1:B3 reference, preserving its rows×cols shape
//                 (needed by lookup/array functions like VLOOKUP, INDEX, MATCH)
//
// New functions are added by writing a file in this package (e.g.
// formula_text.go) with an init() that calls registerFunc(name, impl). Each
// impl receives a *callCtx and returns a value. This keeps the function library
// spread across many files instead of one giant switch.

// rangeVal is a rectangular block of cell values, row-major in cells[r][c].
type rangeVal struct {
	rows, cols int
	cells      [][]value
	ref        *refInfo // where the range was read from (nil for arrays)
}

// flat returns the range's cells row-major.
func (rv rangeVal) flat() []value {
	out := make([]value, 0, rv.rows*rv.cols)
	for _, row := range rv.cells {
		out = append(out, row...)
	}
	return out
}

// callCtx is passed to every registered function. args holds the raw arguments
// (each a value or rangeVal); helpers below cover the common access patterns.
type callCtx struct {
	p    *parser
	ev   *Evaluator
	args []interface{}
}

// nargs returns the number of arguments supplied.
func (c *callCtx) nargs() int { return len(c.args) }

// raw returns argument i as-is (value or rangeVal), or nil if out of range.
func (c *callCtx) raw(i int) interface{} {
	if i < 0 || i >= len(c.args) {
		return nil
	}
	return c.args[i]
}

// flat flattens every argument into one row-major []value (ranges expanded).
func (c *callCtx) flat() []value { return flattenArgs(c.args) }

// scalar coerces argument i to a single value. A range yields its top-left
// cell. Out-of-range arguments yield #N/A.
func (c *callCtx) scalar(i int) value {
	switch v := c.raw(i).(type) {
	case value:
		return v
	case rangeVal:
		if v.rows > 0 && v.cols > 0 {
			return v.cells[0][0]
		}
		return errRef
	}
	return errNA
}

// rangeArg returns argument i as a rangeVal. A scalar becomes a 1×1 range.
// ok is false only when the argument index is absent.
func (c *callCtx) rangeArg(i int) (rangeVal, bool) {
	if i < len(c.args) && c.omitted(i) {
		// An empty slot is not an array: it reads as a lone #VALUE!.
		return rangeVal{rows: 1, cols: 1, cells: [][]value{{errValue}}}, true
	}
	switch v := c.raw(i).(type) {
	case rangeVal:
		return v, true
	case value:
		// An array value (spill result or lambda param) keeps its shape so
		// lookup/array functions can operate on it like a real range.
		if v.kind == kindArray && v.arr != nil {
			return rangeVal{rows: v.arr.rows, cols: v.arr.cols, cells: v.arr.cells, ref: v.ref}, true
		}
		return rangeVal{rows: 1, cols: 1, cells: [][]value{{v}}, ref: v.ref}, true
	}
	return rangeVal{}, false
}

// num returns argument i coerced to a number (ok=false if not numeric).
func (c *callCtx) num(i int) (float64, bool) { return c.scalar(i).toNum() }

// omittedArg is the value of an empty argument slot.
var omittedArg = value{kind: kindNum, omitted: true}

// omitted reports whether argument i is absent or left empty.
func (c *callCtx) omitted(i int) bool {
	if i >= len(c.args) {
		return true
	}
	v, ok := c.args[i].(value)
	return ok && v.omitted
}

// numOr returns argument i as a number, or def when the argument is absent
// or left empty. ok is false only when the argument is present but non-numeric.
func (c *callCtx) numOr(i int, def float64) (float64, bool) {
	if c.omitted(i) {
		return def, true
	}
	return c.scalar(i).toNum()
}

// text returns argument i coerced to a string ("" if absent).
func (c *callCtx) text(i int) string {
	if c.omitted(i) {
		return ""
	}
	return c.scalar(i).toStr()
}

// fnImpl is the signature every registered worksheet function implements.
type fnImpl func(c *callCtx) value

// funcTable maps an upper-case function name to its implementation. Populated
// by init() functions across the formula_*.go files via registerFunc.
var funcTable = map[string]fnImpl{}

// registerFunc adds (or overrides) a worksheet function. Call from an init().
func registerFunc(name string, f fnImpl) { funcTable[strings.ToUpper(name)] = f }

// ---- Shared helpers for the function library --------------------------------

// excelEpoch is Excel's day-0 (1899-12-30), chosen so serial 1 == 1900-01-01
// while absorbing Excel's fictitious 1900 leap day for dates from 1900-03-01 on.
var excelEpoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

// serialToTime converts an Excel serial date number to a UTC time. The integer
// part is whole days since the epoch; the fractional part is the time of day.
func serialToTime(serial float64) time.Time {
	days := math.Floor(serial)
	frac := serial - days
	secs := math.Round(frac * 86400)
	return excelEpoch.AddDate(0, 0, int(days)).Add(time.Duration(secs) * time.Second)
}

// timeToSerial converts a time to an Excel serial date number (days + day frac).
func timeToSerial(t time.Time) float64 {
	t = t.UTC()
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	// Unix seconds, not time.Sub: a Duration saturates after ~292 years, which
	// would clamp every date past 2192 (Excel allows up to 9999-12-31).
	days := float64((day.Unix() - excelEpoch.Unix()) / 86400)
	frac := (float64(t.Hour())*3600 + float64(t.Minute())*60 + float64(t.Second())) / 86400.0
	return days + frac
}

// criteria represents a parsed COUNTIF/SUMIF-style condition such as ">5",
// "<>0", "apple", or "a*c" (with * and ? wildcards on equality matches).
type criteria struct {
	op    string // one of "=", "<>", ">", ">=", "<", "<="
	num   float64
	isNum bool
	str   string         // upper-cased comparison text (for string/wildcard matches)
	re    *regexp.Regexp // compiled wildcard pattern when the criterion has * or ?
}

// parseCriteria interprets a COUNTIF/SUMIF criterion string.
func parseCriteria(s string) criteria {
	c := criteria{op: "="}
	for _, op := range []string{"<=", ">=", "<>", "=", "<", ">"} {
		if strings.HasPrefix(s, op) {
			c.op = op
			s = s[len(op):]
			break
		}
	}
	if f, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil {
		c.isNum = true
		c.num = f
	}
	c.str = strings.ToUpper(s)
	if (c.op == "=" || c.op == "<>") && (strings.ContainsAny(s, "*?")) {
		c.re = wildcardToRegexp(s)
	}
	return c
}

// wildcardToRegexp turns an Excel wildcard pattern (* ? with ~ escapes) into an
// anchored, case-insensitive regexp.
func wildcardToRegexp(pat string) *regexp.Regexp {
	var b strings.Builder
	b.WriteString("(?i)^")
	for i := 0; i < len(pat); i++ {
		ch := pat[i]
		switch ch {
		case '~':
			if i+1 < len(pat) {
				b.WriteString(regexp.QuoteMeta(string(pat[i+1])))
				i++
			}
		case '*':
			b.WriteString(".*")
		case '?':
			b.WriteString(".")
		default:
			b.WriteString(regexp.QuoteMeta(string(ch)))
		}
	}
	b.WriteString("$")
	re, err := regexp.Compile(b.String())
	if err != nil {
		return nil
	}
	return re
}

// match reports whether a cell value satisfies the criterion.
func (c criteria) match(v value) bool {
	// Numeric comparison when both sides are numeric.
	if c.isNum {
		if n, ok := v.toNum(); ok {
			switch c.op {
			case "=":
				return n == c.num
			case "<>":
				return n != c.num
			case ">":
				return n > c.num
			case ">=":
				return n >= c.num
			case "<":
				return n < c.num
			case "<=":
				return n <= c.num
			}
		}
		if c.op == "<>" {
			return true // non-numeric cell vs numeric "<>" criterion
		}
		return false
	}
	// Text comparison.
	vs := strings.ToUpper(v.toStr())
	switch c.op {
	case "=":
		if c.re != nil {
			return c.re.MatchString(v.toStr())
		}
		return vs == c.str
	case "<>":
		if c.re != nil {
			return !c.re.MatchString(v.toStr())
		}
		return vs != c.str
	case ">":
		return vs > c.str
	case ">=":
		return vs >= c.str
	case "<":
		return vs < c.str
	case "<=":
		return vs <= c.str
	}
	return false
}

// ---- Built-in function implementations -------------------------------------

func (p *parser) callFunc(name string, args []interface{}) value {
	// Inside ARRAYFORMULA, scalar functions map element-wise over array args.
	if p.arrayMode && arrayBroadcastFuncs[name] {
		return p.broadcastCall(name, args)
	}
	return p.dispatch(name, args)
}

// dispatch invokes a registered function directly, without the ARRAYFORMULA
// broadcast check (so broadcastCall can re-enter per element without looping).
func (p *parser) dispatch(name string, args []interface{}) value {
	if f, ok := funcTable[name]; ok {
		return f(&callCtx{p: p, ev: p.ev, args: args})
	}
	return errName
}

// Register the core built-ins. Additional categories live in formula_*.go.
func init() {
	registerFunc("SUM", func(c *callCtx) value { return fnSum(c.flat()) })
	registerFunc("AVERAGE", func(c *callCtx) value { return fnAverage(c.flat()) })
	registerFunc("MIN", func(c *callCtx) value { return fnMin(c.flat()) })
	registerFunc("MAX", func(c *callCtx) value { return fnMax(c.flat()) })
	registerFunc("COUNT", func(c *callCtx) value { return fnCount(c.flat()) })
	registerFunc("COUNTA", func(c *callCtx) value { return fnCountA(c.flat()) })
	registerFunc("IF", func(c *callCtx) value { return fnIf(c.p, c.args) })
	registerFunc("AND", func(c *callCtx) value { return fnAnd(c.flat()) })
	registerFunc("OR", func(c *callCtx) value { return fnOr(c.flat()) })
	registerFunc("NOT", func(c *callCtx) value { return fnNot(c.flat()) })
	registerFunc("ROUND", func(c *callCtx) value { return fnRound(c.flat()) })
	registerFunc("ABS", func(c *callCtx) value { return fnAbs(c.flat()) })
	registerFunc("CONCATENATE", func(c *callCtx) value { return fnConcatenate(c.flat()) })
	registerFunc("LEN", func(c *callCtx) value { return fnLen(c.flat()) })
	registerFunc("LEFT", func(c *callCtx) value { return fnLeft(c.flat()) })
	registerFunc("RIGHT", func(c *callCtx) value { return fnRight(c.flat()) })
	registerFunc("MID", func(c *callCtx) value { return fnMid(c.flat()) })
	registerFunc("TODAY", func(c *callCtx) value { return fnToday(c.ev.now) })
	registerFunc("NOW", func(c *callCtx) value { return fnNow(c.ev.now) })
}

func fnSum(vals []value) value {
	sum := 0.0
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		if v.kind == kindStr {
			continue // SUM skips strings (like Excel)
		}
		n, ok := v.toNum()
		if !ok {
			continue
		}
		sum += n
	}
	return numVal(sum)
}

func fnAverage(vals []value) value {
	sum := 0.0
	count := 0
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		if v.kind == kindStr {
			continue
		}
		n, ok := v.toNum()
		if !ok {
			continue
		}
		sum += n
		count++
	}
	if count == 0 {
		return errDiv0
	}
	return numVal(sum / float64(count))
}

func fnMin(vals []value) value {
	min := math.Inf(1)
	found := false
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		n, ok := v.toNum()
		if !ok {
			continue
		}
		if n < min {
			min = n
			found = true
		}
	}
	if !found {
		return numVal(0)
	}
	return numVal(min)
}

func fnMax(vals []value) value {
	max := math.Inf(-1)
	found := false
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		n, ok := v.toNum()
		if !ok {
			continue
		}
		if n > max {
			max = n
			found = true
		}
	}
	if !found {
		return numVal(0)
	}
	return numVal(max)
}

func fnCount(vals []value) value {
	count := 0
	for _, v := range vals {
		if v.isErr() {
			continue
		}
		if _, ok := v.toNum(); ok {
			count++
		}
	}
	return numVal(float64(count))
}

func fnCountA(vals []value) value {
	count := 0
	for _, v := range vals {
		if v.isErr() {
			continue
		}
		if v.kind == kindStr && v.str == "" {
			continue
		}
		count++
	}
	return numVal(float64(count))
}

// fnIf handles IF(condition, true_val, [false_val]).
// We pass raw args to avoid evaluating branches eagerly (short-circuit).
func fnIf(p *parser, args []interface{}) value {
	_ = p // short-circuit is best-effort; all args already evaluated in parseArgList
	if len(args) < 2 || len(args) > 3 {
		return errNA
	}
	cond := asValue(args[0]).topLeft()
	if cond.isErr() {
		return cond
	}
	// The chosen branch is returned whole (a range stays a reference/array).
	if cond.isTruthy() {
		return asValue(args[1])
	}
	if len(args) == 3 {
		return asValue(args[2])
	}
	return boolVal(false) // Excel returns FALSE when no else branch
}

func fnAnd(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		if !v.isTruthy() {
			return boolVal(false)
		}
	}
	return boolVal(true)
}

func fnOr(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		if v.isTruthy() {
			return boolVal(true)
		}
	}
	return boolVal(false)
}

func fnNot(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	v := vals[0]
	if v.isErr() {
		return v
	}
	return boolVal(!v.isTruthy())
}

func fnRound(vals []value) value {
	if len(vals) < 1 {
		return errNA
	}
	n, ok := vals[0].toNum()
	if !ok {
		return errValue
	}
	digits := 0.0
	if len(vals) >= 2 {
		d, dok := vals[1].toNum()
		if !dok {
			return errValue
		}
		digits = d
	}
	factor := math.Pow(10, digits)
	return numVal(math.Round(n*factor) / factor)
}

func fnAbs(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	n, ok := vals[0].toNum()
	if !ok {
		return errValue
	}
	return numVal(math.Abs(n))
}

func fnConcatenate(vals []value) value {
	var sb strings.Builder
	for _, v := range vals {
		if v.isErr() {
			return v
		}
		sb.WriteString(v.toStr())
	}
	return strVal(sb.String())
}

func fnLen(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	v := vals[0]
	if v.isErr() {
		return v
	}
	runes := []rune(v.toStr())
	return numVal(float64(len(runes)))
}

func fnLeft(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	s := []rune(vals[0].toStr())
	n := 1
	if len(vals) >= 2 {
		nf, ok := vals[1].toNum()
		if !ok {
			return errValue
		}
		n = int(math.Trunc(nf))
	}
	if n < 0 {
		return errValue
	}
	if n > len(s) {
		n = len(s)
	}
	return strVal(string(s[:n]))
}

func fnRight(vals []value) value {
	if len(vals) == 0 {
		return errNA
	}
	s := []rune(vals[0].toStr())
	n := 1
	if len(vals) >= 2 {
		nf, ok := vals[1].toNum()
		if !ok {
			return errValue
		}
		n = int(math.Trunc(nf))
	}
	if n < 0 {
		return errValue
	}
	if n > len(s) {
		n = len(s)
	}
	return strVal(string(s[len(s)-n:]))
}

func fnMid(vals []value) value {
	if len(vals) < 3 {
		return errNA
	}
	s := []rune(vals[0].toStr())
	startF, ok1 := vals[1].toNum()
	lenF, ok2 := vals[2].toNum()
	if !ok1 || !ok2 {
		return errValue
	}
	start := int(math.Trunc(startF)) - 1 // 1-based to 0-based
	length := int(math.Trunc(lenF))
	if start < 0 || length < 0 {
		return errValue
	}
	if start >= len(s) {
		return strVal("")
	}
	end := start + length
	if end > len(s) {
		end = len(s)
	}
	return strVal(string(s[start:end]))
}

func fnToday(now time.Time) value {
	// Return Excel serial date number (days since 1900-01-01, with Excel's
	// leap-year bug: 1900 is treated as a leap year, adding 1 to dates >= 3-Mar-1900).
	y, m, d := now.Date()
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	epoch := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	days := int(t.Sub(epoch).Hours() / 24)
	return numVal(float64(days))
}

func fnNow(now time.Time) value {
	y, m, d := now.Date()
	date := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	epoch := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	days := int(date.Sub(epoch).Hours() / 24)
	fracDay := (float64(now.Hour())*3600 + float64(now.Minute())*60 + float64(now.Second())) / 86400.0
	return numVal(float64(days) + fracDay)
}

// ---- Utility (exported for tests) -------------------------------------------

// isLetter reports whether r is an ASCII letter (used internally).
func isLetter(r rune) bool { return unicode.IsLetter(r) && r < 128 }
