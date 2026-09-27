package sheets

// Precedent / dependent tracing over the workbook dependency graph.
//
// A traceSession mirrors the "Trace precedents / Trace dependents" commands of
// a spreadsheet UI: every call adds one more level of arrows, starting from
// the selected cell, and removing arrows takes the outermost level away
// again. Each arrow joins a formula cell to one of its direct references: a
// single cell, or a range (reported by its A1 text, anchored at its top-left
// cell). The session only reads the static graph (formula_deps.go); it is the
// engine side of a future trace UI.

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// traceEdge is one arrow: from depends on to (to is a cell, or the top-left of
// the range rng).
type traceEdge struct {
	from, to sheetCell
	rng      *area // set when the reference is a multi-cell range
}

// traceLevel is one click's worth of arrows and the cells it expanded.
type traceLevel struct {
	edges    []traceEdge
	expanded []sheetCell
}

type traceSession struct {
	ev   *Evaluator
	g    *depGraph
	prec []traceLevel // precedent levels, oldest first
	dep  []traceLevel // dependent levels
}

// newTraceSession builds a trace over the evaluator's workbook.
func newTraceSession(ev *Evaluator) *traceSession {
	return &traceSession{ev: ev, g: ev.buildDepGraph()}
}

// precTargets returns the cells an arrow leads to (a range's formula cells).
func (t *traceSession) precTargets(e traceEdge) []sheetCell {
	if e.rng == nil {
		return []sheetCell{e.to}
	}
	return t.g.formulaCellsIn(e.to.sheet, *e.rng)
}

func expandedSet(levels []traceLevel) map[sheetCell]bool {
	out := map[sheetCell]bool{}
	for _, l := range levels {
		for _, n := range l.expanded {
			out[n] = true
		}
	}
	return out
}

// nextFrontier walks the existing arrows from start and returns the cells one
// step beyond the traced part: start itself when it was never expanded.
func nextFrontier(levels []traceLevel, start sheetCell, next func(e traceEdge, from sheetCell) []sheetCell) []sheetCell {
	done := expandedSet(levels)
	if !done[start] {
		return []sheetCell{start}
	}
	var frontier []sheetCell
	seen := map[sheetCell]bool{start: true}
	queue := []sheetCell{start}
	for len(queue) > 0 {
		n := queue[0]
		queue = queue[1:]
		for _, l := range levels {
			for _, e := range l.edges {
				for _, m := range next(e, n) {
					if seen[m] {
						continue
					}
					seen[m] = true
					if done[m] {
						queue = append(queue, m)
					} else {
						frontier = append(frontier, m)
					}
				}
			}
		}
	}
	return frontier
}

// tracePrecedents adds one level of precedent arrows below start.
func (t *traceSession) tracePrecedents(start sheetCell) {
	frontier := nextFrontier(t.prec, start, func(e traceEdge, from sheetCell) []sheetCell {
		if e.from != from {
			return nil
		}
		return t.precTargets(e)
	})
	var level traceLevel
	for _, n := range frontier {
		level.expanded = append(level.expanded, n)
		for _, r := range t.traceRefs(n) {
			for _, a := range r.areas {
				to := sheetCell{sheet: r.sheet, addr: cellAddr{row: a.r1, col: a.c1}}
				e := traceEdge{from: n, to: to}
				if a.rows()*a.cols() > 1 {
					ac := a
					e.rng = &ac
				} else if to == n {
					continue // a self-reference draws no arrow
				}
				level.edges = append(level.edges, e)
			}
		}
	}
	if len(level.edges) > 0 {
		t.prec = append(t.prec, level)
	}
}

// traceDependents adds one level of dependent arrows beyond start.
func (t *traceSession) traceDependents(start sheetCell) {
	frontier := nextFrontier(t.dep, start, func(e traceEdge, from sheetCell) []sheetCell {
		if e.to != from {
			return nil
		}
		return []sheetCell{e.from}
	})
	var level traceLevel
	for _, n := range frontier {
		level.expanded = append(level.expanded, n)
		for _, d := range t.g.dependents(n.sheet, area{r1: n.addr.row, c1: n.addr.col, r2: n.addr.row, c2: n.addr.col}) {
			if d == n {
				continue // a self-reference draws no arrow
			}
			level.edges = append(level.edges, traceEdge{from: d, to: n})
		}
	}
	if len(level.edges) > 0 {
		t.dep = append(t.dep, level)
	}
}

// rebind points the session at an edited workbook: the graph is rebuilt and
// arrows whose formula no longer holds the reference disappear.
func (t *traceSession) rebind(ev *Evaluator) {
	t.ev, t.g = ev, ev.buildDepGraph()
	keep := func(e traceEdge) bool {
		for _, r := range t.g.precedents(e.from) {
			if r.sheet != e.to.sheet {
				continue
			}
			for _, a := range r.areas {
				if a.contains(e.to.addr.row, e.to.addr.col) {
					return true
				}
			}
		}
		return false
	}
	filter := func(levels []traceLevel) []traceLevel {
		out := make([]traceLevel, 0, len(levels))
		for _, lvl := range levels {
			kept := traceLevel{expanded: lvl.expanded}
			for _, e := range lvl.edges {
				if keep(e) {
					kept.edges = append(kept.edges, e)
				}
			}
			out = append(out, kept)
		}
		return out
	}
	t.prec, t.dep = filter(t.prec), filter(t.dep)
}

// removePrecedentLevel / removeDependentLevel take the outermost level away.
func (t *traceSession) removePrecedentLevel() {
	if len(t.prec) > 0 {
		t.prec = t.prec[:len(t.prec)-1]
	}
}

func (t *traceSession) removeDependentLevel() {
	if len(t.dep) > 0 {
		t.dep = t.dep[:len(t.dep)-1]
	}
}

// clear removes every arrow.
func (t *traceSession) clear() { t.prec, t.dep = nil, nil }

// precedent reports the arrow from → to among the precedent arrows: "" when
// there is none, "1" for a single cell, or the range's A1 text.
func (t *traceSession) precedent(from, to sheetCell) string {
	return edgeLabel(t.prec, from, to)
}

// dependent reports the arrow from → to among the dependent arrows, where to
// depends on from.
func (t *traceSession) dependent(from, to sheetCell) string {
	for _, lvl := range t.dep {
		for _, e := range lvl.edges {
			if e.to == from && e.from == to {
				return "1"
			}
		}
	}
	return ""
}

func edgeLabel(levels []traceLevel, from, to sheetCell) string {
	for _, lvl := range levels {
		for _, e := range lvl.edges {
			if e.from != from || e.to != to {
				continue
			}
			if e.rng == nil {
				return "1"
			}
			return areaLabel(*e.rng)
		}
	}
	return ""
}

// externalPrecedents lists the precedent arrows from `from` that point at
// another sheet.
func (t *traceSession) externalPrecedents(from sheetCell) []sheetCell {
	var out []sheetCell
	for _, lvl := range t.prec {
		for _, e := range lvl.edges {
			if e.from == from && e.to.sheet != from.sheet {
				out = append(out, e.to)
			}
		}
	}
	return out
}

// cellKey renders a sheetCell as Sheet!A1 (for test messages).
func (t *traceSession) cellKey(n sheetCell) string {
	return quoteSheetName(t.ev.book().sheets[n.sheet].name) + "!" + strings.ToUpper(addrToName(n.addr.row, n.addr.col))
}

// areaLabel is a range's A1 text: A:C for whole columns, 1:3 for whole rows.
func areaLabel(a area) string {
	if a.r1 == 0 && a.r2 == maxSheetRows-1 {
		return colName(a.c1) + ":" + colName(a.c2)
	}
	if a.c1 == 0 && a.c2 == maxSheetCols-1 {
		return fmt.Sprintf("%d:%d", a.r1+1, a.r2+1)
	}
	return addrToName(a.r1, a.c1) + ":" + addrToName(a.r2, a.c2)
}

// scalarArgs lists functions whose arguments (all, or the listed positions)
// take one value. A multi-cell reference passed there alone is read by
// implicit intersection: the cell in the formula's own row (column refs) or
// column (row refs), so the trace arrow goes to that cell.
var scalarArgs = map[string][]int{
	"NPV": {0}, "IRR": {1}, "ROUND": nil, "ROUNDUP": nil, "ROUNDDOWN": nil,
}

func init() {
	for _, f := range strings.Fields(`ABS ACOS ACOSH ASIN ASINH ATAN ATAN2 ATANH COS COSH COT COTH CSC CSCH DEGREES
		RADIANS EVEN ODD EXP FACT FACTDOUBLE INT LN LOG LOG10 SIGN SIN SINH SQRT SQRTPI TAN TANH SEC SECH
		CEILING FLOOR MOD POWER TRUNC MROUND QUOTIENT GAMMALN GAMMA FISHER FISHERINV GAUSS PHI NORMSDIST
		NORMSINV ERF ERFC LEN LOWER UPPER PROPER TRIM CLEAN VALUE CODE CHAR UNICHAR UNICODE LEFT RIGHT MID
		REPT DATE YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY TIME DATEVALUE TIMEVALUE PMT PV FV NPER RATE
		IPMT PPMT DB DDB SLN SYD EFFECT NOMINAL`) {
		scalarArgs[f] = nil
	}
}

func isScalarSlot(fn string, idx int) bool {
	pos, ok := scalarArgs[fn]
	if !ok {
		return false
	}
	if pos == nil {
		return true
	}
	for _, p := range pos {
		if p == idx {
			return true
		}
	}
	return false
}

// traceRefs returns the references formula cell n draws arrows to: its static
// references, where a multi-cell reference that is a whole scalar argument
// becomes the cell implicit intersection reads (unless the formula spills,
// in which case it reads the whole range). A reference used both ways gets
// both arrows.
func (t *traceSession) traceRefs(n sheetCell) []refInfo {
	refs := t.g.precedents(n)
	st := t.ev.book().sheets[n.sheet]
	cell := st.grid.get(n.addr)
	if cell == nil || !strings.HasPrefix(cell.F, "=") {
		return refs
	}
	scalar, whole := t.scalarSlotAreas(n.sheet, &n.addr, cell.F[1:])
	if len(scalar) == 0 || t.spills(n) {
		return refs
	}
	var out []refInfo
	for _, r := range refs {
		keep := refInfo{sheet: r.sheet}
		for _, a := range r.areas {
			k := refKey{r.sheet, a}
			if scalar[k] > 0 && a.rows()*a.cols() > 1 {
				if ia, ok := intersectFor(a, n); ok && r.sheet == n.sheet {
					out = append(out, refInfo{sheet: r.sheet, areas: []area{ia}})
				}
				if whole[k] > 0 {
					whole[k]--
					keep.areas = append(keep.areas, a)
				}
				scalar[k]--
				continue
			}
			keep.areas = append(keep.areas, a)
		}
		if len(keep.areas) > 0 {
			out = append(out, keep)
		}
	}
	return out
}

type refKey struct {
	sheet int
	a     area
}

// intersectFor is the cell of a (a column or row range) in n's row or column.
func intersectFor(a area, n sheetCell) (area, bool) {
	r, c := n.addr.row, n.addr.col
	switch {
	case a.cols() == 1 && r >= a.r1 && r <= a.r2:
		return area{r1: r, c1: a.c1, r2: r, c2: a.c1}, true
	case a.rows() == 1 && c >= a.c1 && c <= a.c2:
		return area{r1: a.r1, c1: c, r2: a.r1, c2: c}, true
	}
	return area{}, false
}

// spills reports whether formula cell n evaluates to an array.
func (t *traceSession) spills(n sheetCell) bool {
	ev := t.ev
	cell := ev.book().sheets[n.sheet].grid.get(n.addr)
	var v value
	ev.onSheet(n.sheet, func() {
		pr, pc := ev.curRow, ev.curCol
		ev.curRow, ev.curCol = n.addr.row, n.addr.col
		v = ev.evalExpr(cell.F[1:])
		ev.curRow, ev.curCol = pr, pc
	})
	return v.kind == kindArray
}

// scalarSlotAreas counts, per (sheet, area), the reference occurrences that
// are a whole scalar argument and those used anywhere else.
func (t *traceSession) scalarSlotAreas(si int, at *cellAddr, expr string) (scalar, other map[refKey]int) {
	wb := t.ev.book()
	toks := tokenise(expr)
	scalar, other = map[refKey]int{}, map[refKey]int{}
	type frame struct {
		fn  string
		arg int
	}
	var stack []frame
	braces := 0
	for i := 0; i < len(toks); i++ {
		tk := toks[i]
		switch tk.kind {
		case tokLBrace:
			braces++
			continue
		case tokRBrace:
			braces--
			continue
		case tokLParen:
			fn := ""
			if i > 0 && toks[i-1].kind == tokIdent {
				fn = strings.ToUpper(toks[i-1].val)
			}
			stack = append(stack, frame{fn: fn})
			continue
		case tokRParen:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
			continue
		case tokComma, tokSemi:
			if braces == 0 && len(stack) > 0 {
				stack[len(stack)-1].arg++
			}
			continue
		}
		start := i
		sheet := si
		if tk.kind == tokSheet {
			idx, ok := wb.sheetIndexByName(tk.val)
			i++
			if i >= len(toks) || !ok {
				continue
			}
			sheet = idx
		}
		var a area
		next := i + 1
		switch {
		case toks[i].kind == tokTable || toks[i].kind == tokIdent && wb.tableByName(toks[i].val) != nil && !(i+1 < len(toks) && toks[i+1].kind == tokLParen):
			name, inner := toks[i].val, toks[i].aux
			refs := wb.tableRefs(name, inner, si, at)
			if len(refs) != 1 {
				continue
			}
			sheet, a = refs[0].sheet, refs[0].areas[0]
		case toks[i].kind == tokIdent || toks[i].kind == tokNum:
			if toks[i].kind == tokIdent && i+1 < len(toks) && toks[i+1].kind == tokLParen {
				continue
			}
			var ok bool
			a, next, ok = scanRefAtom(toks, i)
			if !ok {
				continue
			}
		default:
			continue
		}
		i = next - 1
		k := refKey{sheet, a}
		// '@' before a reference reads it by implicit intersection.
		atOp := start > 0 && toks[start-1].kind == tokOp && toks[start-1].val == "@"
		wholeArg := len(stack) > 0 && start > 0 &&
			(toks[start-1].kind == tokLParen || toks[start-1].kind == tokComma || toks[start-1].kind == tokSemi) &&
			(next >= len(toks) || toks[next].kind == tokRParen || toks[next].kind == tokComma || toks[next].kind == tokSemi)
		if atOp || wholeArg && isScalarSlot(stack[len(stack)-1].fn, stack[len(stack)-1].arg) {
			scalar[k]++
		} else {
			other[k]++
		}
	}
	return scalar, other
}

// ---- Trace API (GET/POST …/deps) -------------------------------------------

// TraceCellRef names a cell or range on a sheet.
type TraceCellRef struct {
	SheetID    string `json:"sheetId"`
	SheetIndex int    `json:"sheetIndex"`
	Sheet      string `json:"sheet"`
	R1         int    `json:"r1"`
	C1         int    `json:"c1"`
	R2         int    `json:"r2"`
	C2         int    `json:"c2"`
	// Ref is the A1 text (A1, B2:C4, A:A, 3:3).
	Ref string `json:"ref"`
}

// TraceArrow is one arrow: To depends on nothing; From reads To (for
// precedents) or To reads From (for dependents). Level counts the clicks
// (1 = direct).
type TraceArrow struct {
	Level int          `json:"level"`
	From  TraceCellRef `json:"from"`
	To    TraceCellRef `json:"to"`
	// External is set when the two ends are on different sheets.
	External bool `json:"external,omitempty"`
}

// TraceResult answers a deps query.
type TraceResult struct {
	Cell       TraceCellRef `json:"cell"`
	Formula    string       `json:"formula,omitempty"`
	Precedents []TraceArrow `json:"precedents"`
	Dependents []TraceArrow `json:"dependents"`
}

// TraceDeps traces precedents and dependents of one cell of a workbook JSON
// document, precLevels / depLevels clicks deep (each at least 1, at most 32).
// sheet is a sheet id, name or index ("" = the first sheet); cell may carry a
// Sheet! prefix.
func TraceDeps(data, sheet, cell string, precLevels, depLevels int) (TraceResult, error) {
	var wb FsWorkbook
	if err := json.Unmarshal([]byte(data), &wb); err != nil || len(wb) == 0 {
		return TraceResult{}, ErrNotWorkbook
	}
	base := 0
	if sheet != "" {
		base = -1
		for i, s := range wb {
			if s.ID == sheet || s.Name == sheet {
				base = i
				break
			}
		}
		if base < 0 {
			if n, err := strconv.Atoi(sheet); err == nil && n >= 0 && n < len(wb) {
				base = n
			} else {
				return TraceResult{}, ErrGoalSeekCell
			}
		}
	}
	si, addr, ok := resolveSheetAddr(wb, base, cell)
	if !ok {
		return TraceResult{}, ErrGoalSeekCell
	}
	clamp := func(n int) int {
		if n < 1 {
			return 1
		}
		if n > 32 {
			return 32
		}
		return n
	}
	ev := newWorkbookEvaluator(wb, time.Now())
	tr := newTraceSession(ev)
	start := sheetCell{sheet: si, addr: addr}
	for i := 0; i < clamp(precLevels); i++ {
		tr.tracePrecedents(start)
	}
	for i := 0; i < clamp(depLevels); i++ {
		tr.traceDependents(start)
	}
	ref := func(n sheetCell, rng *area) TraceCellRef {
		a := area{r1: n.addr.row, c1: n.addr.col, r2: n.addr.row, c2: n.addr.col}
		text := addrToName(a.r1, a.c1)
		if rng != nil {
			a = *rng
			text = areaLabel(a)
		}
		out := TraceCellRef{SheetIndex: n.sheet, R1: a.r1, C1: a.c1, R2: a.r2, C2: a.c2, Ref: text}
		if n.sheet < len(wb) {
			out.SheetID, out.Sheet = wb[n.sheet].ID, wb[n.sheet].Name
		}
		return out
	}
	res := TraceResult{Cell: ref(start, nil), Precedents: []TraceArrow{}, Dependents: []TraceArrow{}}
	if c := findCell(wb[si].CellData, addr); c != nil && strings.HasPrefix(c.F, "=") {
		res.Formula = c.F
	}
	for li, lvl := range tr.prec {
		for _, e := range lvl.edges {
			res.Precedents = append(res.Precedents, TraceArrow{Level: li + 1, From: ref(e.from, nil), To: ref(e.to, e.rng), External: e.from.sheet != e.to.sheet})
		}
	}
	for li, lvl := range tr.dep {
		for _, e := range lvl.edges {
			// e.from reads e.to: the arrow runs from the source (to) to the reader.
			res.Dependents = append(res.Dependents, TraceArrow{Level: li + 1, From: ref(e.to, nil), To: ref(e.from, nil), External: e.from.sheet != e.to.sheet})
		}
	}
	return res, nil
}
