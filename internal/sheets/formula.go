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
}

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

var cellRefRe = regexp.MustCompile(`(?i)^\$?([A-Z]+)\$?(\d+)$`)

// parseCellRef parses a reference like "A1", "$A$1", "$A1", "A$1".
// Returns (addr, true) on success.
func parseCellRef(s string) (cellAddr, bool) {
	m := cellRefRe.FindStringSubmatch(s)
	if m == nil {
		return cellAddr{}, false
	}
	return cellAddr{row: rowIndex(m[2]), col: colIndex(m[1])}, true
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

// buildDeps returns a map from each formula-cell address to the set of cell
// addresses its formula references.
func buildDeps(g *grid) map[cellAddr][]cellAddr {
	deps := make(map[cellAddr][]cellAddr)
	for addr, cell := range g.cells {
		if cell == nil || !strings.HasPrefix(cell.F, "=") {
			continue
		}
		refs := extractRefs(cell.F[1:])
		if len(refs) > 0 {
			deps[addr] = refs
		} else {
			deps[addr] = nil // no deps, but still a formula cell
		}
	}
	return deps
}

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

// topoSort returns formula cells in evaluation order (dependencies first) and
// the set of cells involved in circular references.
func topoSort(formulaCells map[cellAddr][]cellAddr) (order []cellAddr, circular map[cellAddr]bool) {
	const (
		white = 0
		grey  = 1
		black = 2
	)
	color := make(map[cellAddr]int, len(formulaCells))
	circular = make(map[cellAddr]bool)

	var visit func(a cellAddr)
	visit = func(a cellAddr) {
		if color[a] == black {
			return
		}
		if color[a] == grey {
			circular[a] = true
			return
		}
		color[a] = grey
		for _, dep := range formulaCells[a] {
			if _, isFormula := formulaCells[dep]; isFormula {
				visit(dep)
				if circular[dep] {
					circular[a] = true
				}
			}
		}
		color[a] = black
		if !circular[a] {
			order = append(order, a)
		}
	}

	for a := range formulaCells {
		visit(a)
	}
	return order, circular
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
}

// NewEvaluator constructs an Evaluator for the given FsSheet celldata.
func NewEvaluator(data []FsCellData) *Evaluator {
	return &Evaluator{
		grid:    newGrid(data),
		results: make(map[cellAddr]value),
		now:     time.Now(),
	}
}

// Recompute evaluates all formula cells in the sheet (in dependency order) and
// returns the updated celldata slice with computed values written into each
// cell's V and M fields. Non-formula cells are returned unchanged.
func Recompute(data []FsCellData) []FsCellData {
	ev := NewEvaluator(data)

	// Build dependency graph.
	formulaDeps := buildDeps(ev.grid)
	order, circular := topoSort(formulaDeps)

	// Mark circular cells immediately.
	for addr := range circular {
		ev.results[addr] = errCirc
	}

	// Occupancy of the original sheet: cells already holding a value or formula.
	// A dynamic array may not spill onto an occupied cell (→ #SPILL!).
	occupied := make(map[cellAddr]bool)
	isFormula := make(map[cellAddr]bool)
	for _, cd := range data {
		if cd.V == nil {
			continue
		}
		a := cellAddr{row: cd.R, col: cd.C}
		if strings.HasPrefix(cd.V.F, "=") {
			isFormula[a] = true
			occupied[a] = true
		} else if cd.V.V != nil && cd.V.V != "" {
			occupied[a] = true
		}
	}

	// spillCells accumulates values written into non-anchor cells by dynamic
	// arrays, keyed by address.
	spillCells := make(map[cellAddr]value)

	// Evaluate in topological order.
	for _, addr := range order {
		cell := ev.grid.get(addr)
		if cell == nil || !strings.HasPrefix(cell.F, "=") {
			continue
		}
		ev.curRow, ev.curCol = addr.row, addr.col
		v := ev.evalExpr(cell.F[1:])
		if v.kind == kindArray {
			v = ev.spill(addr, v.arr, occupied, isFormula, spillCells)
		}
		ev.results[addr] = v
	}

	// Write results back. Update existing cells; append spilled cells that had
	// no original celldata entry.
	out := make([]FsCellData, 0, len(data)+len(spillCells))
	seen := make(map[cellAddr]bool, len(data))
	for _, cd := range data {
		addr := cellAddr{row: cd.R, col: cd.C}
		seen[addr] = true
		nc := cd
		if res, ok := ev.results[addr]; ok && cd.V != nil {
			newCell := *cd.V
			newCell.V = res.asInterface()
			newCell.M = res.toStr()
			nc.V = &newCell
			ev.grid.set(addr, nc.V)
		} else if sv, ok := spillCells[addr]; ok {
			// Originally-empty cell that received a spilled value; keep its
			// style/Extra fields but drop any (absent) formula.
			var base FsCell
			if cd.V != nil {
				base = *cd.V
			}
			base.F = ""
			base.V = sv.asInterface()
			base.M = sv.toStr()
			nc.V = &base
		}
		out = append(out, nc)
	}
	for addr, sv := range spillCells {
		if seen[addr] {
			continue
		}
		out = append(out, FsCellData{
			R: addr.row, C: addr.col,
			V: &FsCell{V: sv.asInterface(), M: sv.toStr()},
		})
	}
	return out
}

// spill writes a dynamic array anchored at addr: the top-left lands in the
// anchor (returned to the caller), the rest go into spillCells and the live
// grid (so later formulas can read them). Returns #SPILL! when any non-anchor
// target cell is already occupied by a value or another formula.
func (ev *Evaluator) spill(addr cellAddr, arr *spillArray, occupied, isFormula map[cellAddr]bool, spillCells map[cellAddr]value) value {
	if arr == nil || arr.rows == 0 || arr.cols == 0 {
		return errVal("#CALC!")
	}
	for r := 0; r < arr.rows; r++ {
		for c := 0; c < arr.cols; c++ {
			if r == 0 && c == 0 {
				continue
			}
			t := cellAddr{row: addr.row + r, col: addr.col + c}
			if occupied[t] || isFormula[t] {
				return errSpill
			}
		}
	}
	for r := 0; r < arr.rows; r++ {
		for c := 0; c < arr.cols; c++ {
			if r == 0 && c == 0 {
				continue
			}
			t := cellAddr{row: addr.row + r, col: addr.col + c}
			cv := arr.cells[r][c]
			spillCells[t] = cv
			ev.grid.set(t, &FsCell{V: cv.asInterface(), M: cv.toStr()})
		}
	}
	return arr.cells[0][0]
}

// cellValue returns the evaluated value for a cell (reading from results cache
// or, for non-formula cells, from the raw grid value).
func (ev *Evaluator) cellValue(addr cellAddr) value {
	if v, ok := ev.results[addr]; ok {
		return v
	}
	cell := ev.grid.get(addr)
	if cell == nil {
		return numVal(0) // empty cell = 0 for arithmetic
	}
	if cell.V == nil {
		return numVal(0)
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
	tokEOF
)

type token struct {
	kind tokKind
	val  string
}

func tokenise(s string) []token {
	var tokens []token
	i := 0
	for i < len(s) {
		ch := s[i]
		// Skip whitespace.
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
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
			tokens = append(tokens, token{kind: tokStr, val: sb.String()})
			if j < len(s) {
				j++ // closing quote
			}
			i = j
			continue
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
			tokens = append(tokens, token{kind: tokNum, val: s[i:j]})
			i = j
			continue
		}
		// Identifier / cell ref / function name. A '.' is allowed mid-identifier
		// so modern dotted function names (STDEV.S, NORM.DIST, RANK.EQ) tokenise
		// as one identifier; a trailing '.' is left out (not part of the name).
		if ch == '$' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') {
			j := i
			for j < len(s) && (s[j] == '$' || s[j] == '.' || (s[j] >= 'A' && s[j] <= 'Z') || (s[j] >= 'a' && s[j] <= 'z') || (s[j] >= '0' && s[j] <= '9')) {
				j++
			}
			name := s[i:j]
			for len(name) > 0 && name[len(name)-1] == '.' {
				name = name[:len(name)-1]
				j--
			}
			tokens = append(tokens, token{kind: tokIdent, val: name})
			i = j
			continue
		}
		// Two-character operators.
		if i+1 < len(s) {
			two := s[i : i+2]
			if two == "<>" || two == "<=" || two == ">=" {
				tokens = append(tokens, token{kind: tokOp, val: two})
				i += 2
				continue
			}
		}
		// Single-character operators / punctuation.
		switch ch {
		case '+', '-', '*', '/', '^', '=', '<', '>', '&':
			tokens = append(tokens, token{kind: tokOp, val: string(ch)})
		case '(':
			tokens = append(tokens, token{kind: tokLParen, val: "("})
		case ')':
			tokens = append(tokens, token{kind: tokRParen, val: ")"})
		case ',':
			tokens = append(tokens, token{kind: tokComma, val: ","})
		case ':':
			tokens = append(tokens, token{kind: tokColon, val: ":"})
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
	// arrayMode is set while evaluating inside ARRAYFORMULA(...): operators and
	// scalar functions then broadcast element-wise over array/range operands.
	arrayMode bool
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
			if p.arrayMode {
				left = broadcast2(left, right, func(a, b value) value { return compareValues(op, a, b) })
			} else {
				left = compareValues(op, left, right)
			}
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
		if p.arrayMode {
			left = broadcast2(left, right, scalarConcat)
		} else {
			left = scalarConcat(left, right)
		}
	}
	return left
}

func (p *parser) parseAdditive() value {
	left := p.parseMultiplicative()
	for p.peek().kind == tokOp && (p.peek().val == "+" || p.peek().val == "-") {
		op := p.consume().val
		right := p.parseMultiplicative()
		if p.arrayMode {
			left = broadcast2(left, right, func(a, b value) value { return scalarArith(op, a, b) })
		} else {
			left = scalarArith(op, left, right)
		}
	}
	return left
}

func (p *parser) parseMultiplicative() value {
	left := p.parsePower()
	for p.peek().kind == tokOp && (p.peek().val == "*" || p.peek().val == "/") {
		op := p.consume().val
		right := p.parsePower()
		if p.arrayMode {
			left = broadcast2(left, right, func(a, b value) value { return scalarArith(op, a, b) })
		} else {
			left = scalarArith(op, left, right)
		}
	}
	return left
}

func (p *parser) parsePower() value {
	base := p.parseUnary()
	for p.peek().kind == tokOp && p.peek().val == "^" {
		p.consume()
		exp := p.parseUnary()
		if p.arrayMode {
			base = broadcast2(base, exp, func(a, b value) value { return scalarArith("^", a, b) })
		} else {
			base = scalarArith("^", base, exp)
		}
	}
	return base
}

func (p *parser) parseUnary() value {
	if p.peek().kind == tokOp && p.peek().val == "-" {
		p.consume()
		v := p.parseUnary()
		if p.arrayMode {
			return broadcast1(v, scalarNeg)
		}
		return scalarNeg(v)
	}
	if p.peek().kind == tokOp && p.peek().val == "+" {
		p.consume()
		return p.parseUnary()
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() value {
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
	return v
}

func (p *parser) parsePrimaryBase() value {
	t := p.peek()
	switch t.kind {
	case tokNum:
		p.consume()
		f, err := strconv.ParseFloat(t.val, 64)
		if err != nil {
			return errValue
		}
		return numVal(f)
	case tokStr:
		p.consume()
		return strVal(t.val)
	case tokLParen:
		p.consume()
		v := p.parseExpr()
		if p.peek().kind == tokRParen {
			p.consume()
		}
		return v
	case tokIdent:
		return p.parseIdentOrFunc()
	}
	return errValue
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
		}
		return p.callFunc(upper, args)
	}

	// Variable bound by LET / LAMBDA in the current scope.
	if p.env != nil {
		if bv, ok := p.env[upper]; ok {
			return bv
		}
	}

	// Range: IDENT ':' IDENT — return aggregate only if top-level; callers
	// handle ranges inside function args. When encountered outside a function
	// call context, return #VALUE! (ranges are only meaningful as func args).
	if p.peek().kind == tokColon {
		p.consume()
		t2 := p.peek()
		if t2.kind == tokIdent {
			p.consume()
			// Inside ARRAYFORMULA a bare range materialises as an array so it can
			// be broadcast; elsewhere a range is only meaningful as a func arg.
			if p.arrayMode {
				if a1, ok1 := parseCellRef(t.val); ok1 {
					if a2, ok2 := parseCellRef(t2.val); ok2 {
						return arrayValue(p.ev.makeRange(a1, a2).cells)
					}
				}
			}
			return errValue
		}
		return errValue
	}

	// Cell reference.
	if addr, ok := parseCellRef(t.val); ok {
		return p.ev.cellValue(addr)
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
		arg := p.parseArg()
		args = append(args, arg)
		if p.peek().kind != tokComma {
			break
		}
		p.consume() // ','
	}
	return args
}

// parseArg parses one argument, which may be a range yielding []value or a
// single expression yielding value.
func (p *parser) parseArg() interface{} {
	// Peek ahead: is this IDENT ':' IDENT (range)? In ARRAYFORMULA mode we skip
	// this greedy capture so a range inside a larger expression (e.g. A1:A3>0)
	// parses as an operand that materialises into a broadcastable array.
	if !p.arrayMode && p.peek().kind == tokIdent && p.pos+1 < len(p.tokens) && p.tokens[p.pos+1].kind == tokColon {
		t1 := p.tokens[p.pos]
		a1, ok1 := parseCellRef(t1.val)
		if ok1 && p.pos+2 < len(p.tokens) && p.tokens[p.pos+2].kind == tokIdent {
			t2 := p.tokens[p.pos+2]
			a2, ok2 := parseCellRef(t2.val)
			if ok2 {
				p.pos += 3 // consume IDENT ':' IDENT
				return p.ev.makeRange(a1, a2)
			}
		}
	}
	return p.parseExpr()
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
}

// makeRange materialises the cells of an A1:B3 range from the grid.
func (ev *Evaluator) makeRange(a1, a2 cellAddr) rangeVal {
	if a2.row < a1.row {
		a1.row, a2.row = a2.row, a1.row
	}
	if a2.col < a1.col {
		a1.col, a2.col = a2.col, a1.col
	}
	rows := a2.row - a1.row + 1
	cols := a2.col - a1.col + 1
	cells := make([][]value, rows)
	for r := 0; r < rows; r++ {
		rowVals := make([]value, cols)
		for c := 0; c < cols; c++ {
			rowVals[c] = ev.cellValue(cellAddr{row: a1.row + r, col: a1.col + c})
		}
		cells[r] = rowVals
	}
	return rangeVal{rows: rows, cols: cols, cells: cells}
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
	switch v := c.raw(i).(type) {
	case rangeVal:
		return v, true
	case value:
		// An array value (spill result or lambda param) keeps its shape so
		// lookup/array functions can operate on it like a real range.
		if v.kind == kindArray && v.arr != nil {
			return rangeVal{rows: v.arr.rows, cols: v.arr.cols, cells: v.arr.cells}, true
		}
		return rangeVal{rows: 1, cols: 1, cells: [][]value{{v}}}, true
	}
	return rangeVal{}, false
}

// num returns argument i coerced to a number (ok=false if not numeric).
func (c *callCtx) num(i int) (float64, bool) { return c.scalar(i).toNum() }

// numOr returns argument i as a number, or def when the argument is absent.
// ok is false only when the argument is present but non-numeric.
func (c *callCtx) numOr(i int, def float64) (float64, bool) {
	if i >= len(c.args) {
		return def, true
	}
	return c.scalar(i).toNum()
}

// text returns argument i coerced to a string ("" if absent).
func (c *callCtx) text(i int) string {
	if i >= len(c.args) {
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
	days := math.Round(day.Sub(excelEpoch).Hours() / 24)
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
	vals := flattenArgs(args)
	if len(vals) < 2 {
		return errNA
	}
	cond := vals[0]
	if cond.isErr() {
		return cond
	}
	if cond.isTruthy() {
		return vals[1]
	}
	if len(vals) >= 3 {
		return vals[2]
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

// ---- RecomputeWorkbook -------------------------------------------------------

// RecomputeWorkbook takes the JSON workbook string, evaluates all formula cells
// in each sheet, and returns the updated JSON. If parsing fails or the data is
// empty, the original string is returned unchanged.
func RecomputeWorkbook(data string) string {
	if data == "" {
		return data
	}
	var wb FsWorkbook
	if err := json.Unmarshal([]byte(data), &wb); err != nil {
		return data // not a workbook array; return as-is
	}
	for i := range wb {
		wb[i].CellData = Recompute(wb[i].CellData)
	}
	out, err := json.Marshal(wb)
	if err != nil {
		return data
	}
	return string(out)
}

// ---- Utility (exported for tests) -------------------------------------------

// isLetter reports whether r is an ASCII letter (used internally).
func isLetter(r rune) bool { return unicode.IsLetter(r) && r < 128 }
