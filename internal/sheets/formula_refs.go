package sheets

// Workbook view and reference semantics.
//
// A formula is evaluated against a workbookView: every sheet of the workbook
// with its grid, computed results and spill bookkeeping, plus the defined names.
// A reference (A1, Sheet2!B3:C4, 'My Sheet'!A:A, 1:1, a defined name, the
// result of OFFSET/INDIRECT/INDEX …) evaluates to an ordinary value that also
// carries a *refInfo describing where it came from. Functions that care about
// the reference itself (ROW, COLUMN, ROWS, ISREF, CELL, FORMULATEXT, OFFSET,
// AREAS, SHEET …) read the refInfo; everything else just sees the values.
//
// Recalculation is ordered by a workbook-wide topological sort over
// (sheet, cell) nodes built from statically extracted references. Formula cells
// whose inputs cannot be known statically (INDIRECT, OFFSET) are computed on
// demand: reading an uncomputed formula cell evaluates it first, and a cell
// that is re-entered while it is being computed yields #CIRC!.

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

// Excel grid limits (0-based maxima are these minus one).
const (
	maxSheetRows = 1048576
	maxSheetCols = 16384
)

// area is a rectangular block of cells, 0-based and inclusive.
type area struct{ r1, c1, r2, c2 int }

func (a area) rows() int { return a.r2 - a.r1 + 1 }
func (a area) cols() int { return a.c2 - a.c1 + 1 }

func (a area) contains(r, c int) bool {
	return r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2
}

// normArea returns a with r1<=r2 and c1<=c2.
func normArea(a area) area {
	if a.r2 < a.r1 {
		a.r1, a.r2 = a.r2, a.r1
	}
	if a.c2 < a.c1 {
		a.c1, a.c2 = a.c2, a.c1
	}
	return a
}

// inGrid reports whether the area lies inside the sheet limits.
func (a area) inGrid() bool {
	return a.r1 >= 0 && a.c1 >= 0 && a.r2 < maxSheetRows && a.c2 < maxSheetCols
}

// intersectArea returns the overlap of two areas, ok=false when disjoint.
func intersectArea(a, b area) (area, bool) {
	r := area{r1: max(a.r1, b.r1), c1: max(a.c1, b.c1), r2: min(a.r2, b.r2), c2: min(a.c2, b.c2)}
	if r.r1 > r.r2 || r.c1 > r.c2 {
		return area{}, false
	}
	return r, true
}

// boundingArea returns the smallest area covering both.
func boundingArea(a, b area) area {
	return area{r1: min(a.r1, b.r1), c1: min(a.c1, b.c1), r2: max(a.r2, b.r2), c2: max(a.c2, b.c2)}
}

// refInfo describes the reference a value was read from.
type refInfo struct {
	sheet int    // 0-based index into workbookView.sheets
	areas []area // one area, or several for a union (A1:B2,D4)
	// rangeForm is set when the reference was written as a range (A1:A1, A:A,
	// 1:1, a union) rather than a single cell; such references are passed to
	// functions as rangeVal so reference-aware functions keep their shape.
	rangeForm bool
}

func (r *refInfo) first() area { return r.areas[0] }

func (r *refInfo) isSingleCell() bool {
	return len(r.areas) == 1 && r.areas[0].r1 == r.areas[0].r2 && r.areas[0].c1 == r.areas[0].c2
}

// withRef returns v tagged with the reference it was read from.
func (v value) withRef(r *refInfo) value {
	v.ref = r
	return v
}

// sheetCell identifies one cell of the workbook.
type sheetCell struct {
	sheet int
	addr  cellAddr
}

// sheetState is one worksheet inside the workbook view.
type sheetState struct {
	name    string
	grid    *grid
	results map[cellAddr]value
	// occupied / isFormula describe the original sheet contents; a dynamic array
	// may not spill onto an occupied cell (→ #SPILL!).
	occupied   map[cellAddr]bool
	isFormula  map[cellAddr]bool
	spillCells map[cellAddr]value
	// usedRows/usedCols bound the populated part of the sheet (counts), used to
	// clip whole-column and whole-row references.
	usedRows, usedCols int
}

func newSheetState(name string, data []FsCellData) *sheetState {
	st := &sheetState{
		name:       name,
		grid:       newGrid(data),
		results:    make(map[cellAddr]value),
		occupied:   make(map[cellAddr]bool),
		isFormula:  make(map[cellAddr]bool),
		spillCells: make(map[cellAddr]value),
	}
	st.index(data)
	return st
}

// index records occupancy and the used extent from the original celldata.
func (st *sheetState) index(data []FsCellData) {
	for _, cd := range data {
		if cd.V == nil {
			continue
		}
		a := cellAddr{row: cd.R, col: cd.C}
		if strings.HasPrefix(cd.V.F, "=") {
			st.isFormula[a] = true
			st.occupied[a] = true
		} else if cd.V.V != nil && cd.V.V != "" {
			st.occupied[a] = true
		}
		st.grow(a)
	}
}

func (st *sheetState) grow(a cellAddr) {
	if a.row+1 > st.usedRows {
		st.usedRows = a.row + 1
	}
	if a.col+1 > st.usedCols {
		st.usedCols = a.col + 1
	}
}

// definedName is a workbook-level name from `_namedRanges` (or a fixture).
type definedName struct {
	text  string // definition without a leading "=" (e.g. "Sheet1!$A$1:$B$2")
	sheet int    // sheet that unqualified references in text resolve to
}

// workbookView is the evaluator's picture of the whole workbook.
type workbookView struct {
	sheets     []*sheetState
	names      map[string]definedName // upper-cased name → definition
	inProgress map[sheetCell]bool     // formula cells being evaluated (cycle guard)
	nameStack  map[string]bool        // defined names being resolved (cycle guard)
}

// sheetIndexByName resolves a sheet name case-insensitively.
func (wb *workbookView) sheetIndexByName(name string) (int, bool) {
	for i, s := range wb.sheets {
		if strings.EqualFold(s.name, name) {
			return i, true
		}
	}
	return -1, false
}

// book returns the evaluator's workbook view, creating a single-sheet view over
// ev.grid/ev.results for evaluators built directly (tests, legacy callers).
func (ev *Evaluator) book() *workbookView {
	if ev.wb == nil {
		if ev.grid == nil {
			ev.grid = newGrid(nil)
		}
		if ev.results == nil {
			ev.results = make(map[cellAddr]value)
		}
		st := &sheetState{
			name:       "Sheet1",
			grid:       ev.grid,
			results:    ev.results,
			occupied:   make(map[cellAddr]bool),
			isFormula:  make(map[cellAddr]bool),
			spillCells: make(map[cellAddr]value),
		}
		for a, c := range ev.grid.cells {
			if c != nil && strings.HasPrefix(c.F, "=") {
				st.isFormula[a] = true
				st.occupied[a] = true
			} else if c != nil && c.V != nil && c.V != "" {
				st.occupied[a] = true
			}
			st.grow(a)
		}
		ev.wb = &workbookView{
			sheets:     []*sheetState{st},
			names:      map[string]definedName{},
			inProgress: map[sheetCell]bool{},
			nameStack:  map[string]bool{},
		}
		ev.cur = 0
	}
	return ev.wb
}

// sheet returns the state of sheet i (the current sheet when i < 0).
func (ev *Evaluator) sheet(i int) *sheetState {
	wb := ev.book()
	if i < 0 || i >= len(wb.sheets) {
		i = ev.cur
	}
	return wb.sheets[i]
}

// onSheet runs fn with sheet i as the evaluator's current sheet (and the
// formula position unchanged), restoring the previous context afterwards.
func (ev *Evaluator) onSheet(i int, fn func()) {
	ev.book()
	if i == ev.cur {
		fn()
		return
	}
	prevCur, prevGrid, prevRes := ev.cur, ev.grid, ev.results
	st := ev.wb.sheets[i]
	ev.cur, ev.grid, ev.results = i, st.grid, st.results
	defer func() { ev.cur, ev.grid, ev.results = prevCur, prevGrid, prevRes }()
	fn()
}

// cellOn returns the value of one cell on sheet i.
func (ev *Evaluator) cellOn(i int, a cellAddr) value {
	var v value
	ev.onSheet(i, func() { v = ev.cellValue(a) })
	return v
}

// ensureFormula evaluates the formula cell a on sheet i if it has not been
// computed yet and returns its value. Re-entering a cell that is still being
// evaluated is a circular reference.
func (ev *Evaluator) ensureFormula(i int, a cellAddr) value {
	wb := ev.book()
	st := wb.sheets[i]
	if v, ok := st.results[a]; ok {
		return v
	}
	key := sheetCell{sheet: i, addr: a}
	if wb.inProgress[key] {
		return errCirc
	}
	cell := st.grid.get(a)
	if cell == nil || !strings.HasPrefix(cell.F, "=") {
		return ev.cellOn(i, a)
	}
	wb.inProgress[key] = true
	defer delete(wb.inProgress, key)
	var v value
	ev.onSheet(i, func() {
		prevRow, prevCol := ev.curRow, ev.curCol
		ev.curRow, ev.curCol = a.row, a.col
		v = ev.evalExpr(cell.F[1:])
		if v.kind == kindArray {
			v = ev.spill(a, v.arr)
		}
		ev.curRow, ev.curCol = prevRow, prevCol
	})
	v.ref = nil
	st.results[a] = v
	return v
}

// materialize reads the cells a reference points at. A single cell yields that
// cell's value; a range yields an array (clipped to the used part of the sheet
// for whole-column/row references); a union yields its cells in one row.
func (ev *Evaluator) materialize(r *refInfo) value {
	wb := ev.book()
	if r == nil || r.sheet < 0 || r.sheet >= len(wb.sheets) || len(r.areas) == 0 {
		return errRef
	}
	for _, a := range r.areas {
		if !a.inGrid() {
			return errRef
		}
	}
	st := wb.sheets[r.sheet]
	if len(r.areas) == 1 {
		a := ev.clipArea(st, r.areas[0])
		if a.r1 == a.r2 && a.c1 == a.c2 {
			return ev.cellOn(r.sheet, cellAddr{row: a.r1, col: a.c1}).withRef(r)
		}
		cells := make([][]value, a.rows())
		ev.onSheet(r.sheet, func() {
			for rr := 0; rr < a.rows(); rr++ {
				row := make([]value, a.cols())
				for cc := 0; cc < a.cols(); cc++ {
					row[cc] = ev.cellValue(cellAddr{row: a.r1 + rr, col: a.c1 + cc})
				}
				cells[rr] = row
			}
		})
		return value{kind: kindArray, arr: &spillArray{rows: a.rows(), cols: a.cols(), cells: cells}, ref: r}
	}
	var flat []value
	ev.onSheet(r.sheet, func() {
		for _, a0 := range r.areas {
			a := ev.clipArea(st, a0)
			for rr := a.r1; rr <= a.r2; rr++ {
				for cc := a.c1; cc <= a.c2; cc++ {
					flat = append(flat, ev.cellValue(cellAddr{row: rr, col: cc}))
				}
			}
		}
	})
	if len(flat) == 1 {
		return flat[0].withRef(r)
	}
	return value{kind: kindArray, arr: &spillArray{rows: 1, cols: len(flat), cells: [][]value{flat}}, ref: r}
}

// clipArea bounds a very large area (whole columns/rows, A1:A1048576) to the
// populated part of the sheet so it can be materialised; smaller areas keep
// their exact shape. It never shrinks below one cell. Reference-aware
// functions (ROWS, COLUMNS, ROW, OFFSET …) read the unclipped refInfo.
func (ev *Evaluator) clipArea(st *sheetState, a area) area {
	if a.rows()*a.cols() <= clipThreshold {
		return a
	}
	if last := st.usedRows - 1; a.r2 > last {
		a.r2 = max(last, a.r1)
	}
	if last := st.usedCols - 1; a.c2 > last {
		a.c2 = max(last, a.c1)
	}
	return a
}

// clipThreshold is the cell count above which a reference is clipped to the
// used range when materialised.
const clipThreshold = 1 << 16

// refValue materialises a new reference on sheet si.
func (ev *Evaluator) refValue(si int, rangeForm bool, areas ...area) value {
	return ev.materialize(&refInfo{sheet: si, areas: areas, rangeForm: rangeForm})
}

// refOf returns the reference behind a function argument (value or rangeVal).
func refOf(a interface{}) *refInfo {
	switch v := a.(type) {
	case value:
		return v.ref
	case rangeVal:
		return v.ref
	}
	return nil
}

// refArg returns the reference behind argument i, or nil.
func (c *callCtx) refArg(i int) *refInfo { return refOf(c.raw(i)) }

// asValue converts an argument back to a value, keeping its reference.
func asValue(a interface{}) value {
	switch v := a.(type) {
	case value:
		return v
	case rangeVal:
		if v.rows == 1 && v.cols == 1 {
			return v.cells[0][0].withRef(v.ref)
		}
		return value{kind: kindArray, arr: &spillArray{rows: v.rows, cols: v.cols, cells: v.cells}, ref: v.ref}
	case []value:
		return arrayValue([][]value{v})
	}
	return errValue
}

// toRangeVal converts a reference value to the rangeVal argument form.
func (v value) toRangeVal() rangeVal {
	if v.kind == kindArray && v.arr != nil {
		return rangeVal{rows: v.arr.rows, cols: v.arr.cols, cells: v.arr.cells, ref: v.ref}
	}
	w := v
	w.ref = nil
	return rangeVal{rows: 1, cols: 1, cells: [][]value{{w}}, ref: v.ref}
}

// ---- Parsing reference text ------------------------------------------------

// parseColRef parses "A" / "$XFD" into a 0-based column (ok=false otherwise).
func parseColRef(s string) (int, bool) {
	s = strings.TrimPrefix(s, "$")
	if s == "" || len(s) > 3 {
		return 0, false
	}
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z') {
			return 0, false
		}
	}
	c := colIndex(s)
	if c < 0 || c >= maxSheetCols {
		return 0, false
	}
	return c, true
}

// parseRowRef parses "1" / "$1048576" into a 0-based row.
func parseRowRef(s string) (int, bool) {
	s = strings.TrimPrefix(s, "$")
	if s == "" || len(s) > 7 {
		return 0, false
	}
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		n = n*10 + int(s[i]-'0')
	}
	if n < 1 || n > maxSheetRows {
		return 0, false
	}
	return n - 1, true
}

// quoteSheetName renders a sheet name for use in a formula, quoting it when
// it is not a plain identifier.
func quoteSheetName(name string) string {
	if name == "" {
		return ""
	}
	plain := true
	for i, r := range name {
		ok := r == '_' || r == '.' || r >= 0x80 || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || (i > 0 && r >= '0' && r <= '9')
		if !ok {
			plain = false
			break
		}
	}
	if plain {
		if _, isCell := parseCellRef(name); isCell {
			plain = false
		}
	}
	if plain {
		return name
	}
	return "'" + strings.ReplaceAll(name, "'", "''") + "'"
}

// ---- Defined names ---------------------------------------------------------

// namedRangeEntry is one element of the `_namedRanges` array Grown's UI keeps
// on the first sheet.
type namedRangeEntry struct {
	Name      string `json:"name"`
	Range     string `json:"range"`
	SheetID   string `json:"sheetId"`
	SheetName string `json:"sheetName"`
}

// loadNamedRanges reads `_namedRanges` from the first sheet of a workbook.
func loadNamedRanges(wb FsWorkbook, view *workbookView) {
	if len(wb) == 0 || wb[0].Extra == nil {
		return
	}
	raw, ok := wb[0].Extra["_namedRanges"]
	if !ok {
		return
	}
	var entries []namedRangeEntry
	if json.Unmarshal(raw, &entries) != nil {
		return
	}
	for _, e := range entries {
		name := strings.TrimSpace(e.Name)
		if name == "" || strings.TrimSpace(e.Range) == "" {
			continue
		}
		si := 0
		if e.SheetID != "" {
			for i := range wb {
				if wb[i].ID == e.SheetID {
					si = i
				}
			}
		} else if e.SheetName != "" {
			if i, ok := view.sheetIndexByName(e.SheetName); ok {
				si = i
			}
		}
		view.names[strings.ToUpper(name)] = definedName{text: strings.TrimPrefix(strings.TrimSpace(e.Range), "="), sheet: si}
	}
}

// resolveName evaluates a defined name; ok=false when no such name exists.
func (p *parser) resolveName(upper string) (value, bool) {
	wb := p.ev.book()
	def, ok := wb.names[upper]
	if !ok {
		return value{}, false
	}
	if wb.nameStack[upper] {
		return errCirc, true
	}
	wb.nameStack[upper] = true
	defer delete(wb.nameStack, upper)
	sub := &parser{tokens: tokenise(def.text), ev: p.ev, defSheet: def.sheet, hasDefSheet: true}
	v := sub.parseExpr()
	if sub.pos < len(sub.tokens) {
		return errValue, true
	}
	return v, true
}

// ---- Workbook recalculation -------------------------------------------------

// newWorkbookEvaluator builds an evaluator over every sheet of wb.
func newWorkbookEvaluator(wb FsWorkbook, now time.Time) *Evaluator {
	view := &workbookView{
		names:      map[string]definedName{},
		inProgress: map[sheetCell]bool{},
		nameStack:  map[string]bool{},
	}
	for i := range wb {
		view.sheets = append(view.sheets, newSheetState(wb[i].Name, wb[i].CellData))
	}
	if len(view.sheets) == 0 {
		view.sheets = append(view.sheets, newSheetState("Sheet1", nil))
	}
	loadNamedRanges(wb, view)
	ev := &Evaluator{wb: view, now: now}
	ev.cur = 0
	ev.grid, ev.results = view.sheets[0].grid, view.sheets[0].results
	return ev
}

// NewEvaluator constructs an Evaluator for a single sheet's celldata.
func NewEvaluator(data []FsCellData) *Evaluator {
	return newWorkbookEvaluator(FsWorkbook{{Name: "Sheet1", CellData: data}}, time.Now())
}

// Recompute evaluates all formula cells of a lone sheet (in dependency order)
// and returns the updated celldata with computed values in V and M.
func Recompute(data []FsCellData) []FsCellData {
	ev := NewEvaluator(data)
	ev.recalcAll()
	return ev.writeBack(0, data)
}

// recalcAll evaluates every formula cell of the workbook in a workbook-wide
// topological order.
func (ev *Evaluator) recalcAll() {
	wb := ev.book()
	order, circular := ev.workbookOrder()
	for n := range circular {
		wb.sheets[n.sheet].results[n.addr] = errCirc
	}
	for _, n := range order {
		ev.ensureFormula(n.sheet, n.addr)
	}
}

// recomputeAll keeps the single-sheet entry point used by older callers: it
// recalculates the workbook and returns the celldata of the current sheet.
func (ev *Evaluator) recomputeAll(data []FsCellData) []FsCellData {
	ev.recalcAll()
	return ev.writeBack(ev.cur, data)
}

// writeBack returns sheet si's celldata with computed values applied: formula
// cells get V/M, spilled cells are written (appended when they had no entry).
func (ev *Evaluator) writeBack(si int, data []FsCellData) []FsCellData {
	st := ev.book().sheets[si]
	out := make([]FsCellData, 0, len(data)+len(st.spillCells))
	seen := make(map[cellAddr]bool, len(data))
	for _, cd := range data {
		addr := cellAddr{row: cd.R, col: cd.C}
		seen[addr] = true
		nc := cd
		if res, ok := st.results[addr]; ok && cd.V != nil && strings.HasPrefix(cd.V.F, "=") {
			newCell := *cd.V
			newCell.V = res.asInterface()
			newCell.M = res.toStr()
			nc.V = &newCell
		} else if sv, ok := st.spillCells[addr]; ok {
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
	var extra []FsCellData
	for addr, sv := range st.spillCells {
		if seen[addr] {
			continue
		}
		extra = append(extra, FsCellData{R: addr.row, C: addr.col, V: &FsCell{V: sv.asInterface(), M: sv.toStr()}})
	}
	sort.Slice(extra, func(i, j int) bool {
		if extra[i].R != extra[j].R {
			return extra[i].R < extra[j].R
		}
		return extra[i].C < extra[j].C
	})
	return append(out, extra...)
}

// spill writes a dynamic array anchored at addr on the current sheet: the
// top-left lands in the anchor (returned), the rest go into the sheet's spill
// cells and live grid. #SPILL! when a non-anchor target is already occupied.
func (ev *Evaluator) spill(addr cellAddr, arr *spillArray) value {
	if arr == nil || arr.rows == 0 || arr.cols == 0 {
		return errVal("#CALC!")
	}
	st := ev.sheet(ev.cur)
	for r := 0; r < arr.rows; r++ {
		for c := 0; c < arr.cols; c++ {
			if r == 0 && c == 0 {
				continue
			}
			t := cellAddr{row: addr.row + r, col: addr.col + c}
			if st.occupied[t] || st.isFormula[t] {
				return errSpill
			}
			if _, taken := st.spillCells[t]; taken {
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
			cv.ref = nil
			st.spillCells[t] = cv
			st.grid.set(t, &FsCell{V: cv.asInterface(), M: cv.toStr()})
			st.grow(t)
		}
	}
	return arr.cells[0][0]
}

// RecomputeWorkbook takes the JSON workbook string, evaluates all formula cells
// of every sheet (cross-sheet references and defined names included) and
// returns the updated JSON. If parsing fails or the data is empty, the original
// string is returned unchanged.
func RecomputeWorkbook(data string) string {
	if data == "" {
		return data
	}
	var wb FsWorkbook
	if err := json.Unmarshal([]byte(data), &wb); err != nil {
		return data // not a workbook array; return as-is
	}
	recomputeFsWorkbook(wb, time.Now())
	out, err := json.Marshal(wb)
	if err != nil {
		return data
	}
	return string(out)
}

// recomputeFsWorkbook recalculates wb in place.
func recomputeFsWorkbook(wb FsWorkbook, now time.Time) *Evaluator {
	ev := newWorkbookEvaluator(wb, now)
	ev.recalcAll()
	for i := range wb {
		wb[i].CellData = ev.writeBack(i, wb[i].CellData)
	}
	return ev
}

// ---- Reference operators ------------------------------------------------------

var errNull = value{kind: kindErr, str: "#NULL!"}

// rangeRefs applies the ':' operator: the bounding box of two references on
// the same sheet.
func (ev *Evaluator) rangeRefs(v, w value) value {
	if w.isErr() && w.ref == nil {
		return w
	}
	if v.ref == nil || w.ref == nil || v.ref.sheet != w.ref.sheet || len(v.ref.areas) != 1 || len(w.ref.areas) != 1 {
		return errValue
	}
	return ev.refValue(v.ref.sheet, true, boundingArea(v.ref.areas[0], w.ref.areas[0]))
}

// intersectRefs applies the intersection operator (a space between two
// references). No common cell is #NULL!.
func (ev *Evaluator) intersectRefs(v, w value) value {
	if w.isErr() && w.ref == nil {
		return w
	}
	if v.ref == nil || w.ref == nil {
		return errValue
	}
	if v.ref.sheet != w.ref.sheet {
		return errNull
	}
	var out []area
	for _, a := range v.ref.areas {
		for _, b := range w.ref.areas {
			if x, ok := intersectArea(a, b); ok {
				out = append(out, x)
			}
		}
	}
	if len(out) == 0 {
		return errNull
	}
	return ev.refValue(v.ref.sheet, len(out) > 1 || v.ref.rangeForm || w.ref.rangeForm, out...)
}

// unionRefs applies the union operator inside parentheses: (A1:B2,D4).
func (ev *Evaluator) unionRefs(parts []value) value {
	var areas []area
	sheet := -1
	for _, v := range parts {
		if v.ref == nil {
			if v.isErr() {
				return v
			}
			return errValue
		}
		if sheet >= 0 && v.ref.sheet != sheet {
			return errValue
		}
		sheet = v.ref.sheet
		areas = append(areas, v.ref.areas...)
	}
	return ev.refValue(sheet, true, areas...)
}

// implicitIntersect applies '@': a range collapses to the cell in the formula's
// row (for a column) or column (for a row); an array collapses to its top-left.
func (ev *Evaluator) implicitIntersect(v value) value {
	if v.ref == nil || len(v.ref.areas) != 1 {
		if v.ref != nil {
			return errValue
		}
		return v.topLeft()
	}
	a := v.ref.areas[0]
	switch {
	case a.r1 == a.r2 && a.c1 == a.c2:
		return ev.refValue(v.ref.sheet, false, a)
	case a.c1 == a.c2 && ev.curRow >= a.r1 && ev.curRow <= a.r2:
		return ev.refValue(v.ref.sheet, false, area{r1: ev.curRow, c1: a.c1, r2: ev.curRow, c2: a.c1})
	case a.r1 == a.r2 && ev.curCol >= a.c1 && ev.curCol <= a.c2:
		return ev.refValue(v.ref.sheet, false, area{r1: a.r1, c1: ev.curCol, r2: a.r1, c2: ev.curCol})
	}
	return errValue
}
