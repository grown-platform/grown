package sheets

// Workbook dependency graph.
//
// References are extracted statically from each formula's tokens: cells,
// ranges, whole columns/rows, sheet-qualified references and defined names
// (expanded to what they refer to). The graph gives the recalculation order
// (a workbook-wide topological sort, so a formula on Sheet1 that reads Sheet2
// is computed after the Sheet2 cells it needs) and answers precedents /
// dependents queries. References only known at run time (INDIRECT, OFFSET)
// are not in the graph; the evaluator computes those cells on demand.

import (
	"sort"
	"strings"
)

// depGraph is the static reference graph of a workbook.
type depGraph struct {
	refs     map[sheetCell][]refInfo // formula cell → direct references
	formulas []sheetCell             // every formula cell, sorted
	bySheet  map[int][]sheetCell
}

// buildDepGraph scans every formula cell of the workbook.
func (ev *Evaluator) buildDepGraph() *depGraph {
	wb := ev.book()
	g := &depGraph{refs: map[sheetCell][]refInfo{}, bySheet: map[int][]sheetCell{}}
	for si, st := range wb.sheets {
		for a, cell := range st.grid.cells {
			if cell == nil || !strings.HasPrefix(cell.F, "=") {
				continue
			}
			n := sheetCell{sheet: si, addr: a}
			g.formulas = append(g.formulas, n)
			g.refs[n] = ev.formulaRefs(si, cell.F[1:], map[string]bool{})
		}
	}
	sort.Slice(g.formulas, func(i, j int) bool { return lessCell(g.formulas[i], g.formulas[j]) })
	for _, n := range g.formulas {
		g.bySheet[n.sheet] = append(g.bySheet[n.sheet], n)
	}
	return g
}

func lessCell(a, b sheetCell) bool {
	if a.sheet != b.sheet {
		return a.sheet < b.sheet
	}
	if a.addr.row != b.addr.row {
		return a.addr.row < b.addr.row
	}
	return a.addr.col < b.addr.col
}

// formulaRefs lists the references mentioned by a formula evaluated on sheet
// si. Defined names are expanded (seen guards against name cycles).
func (ev *Evaluator) formulaRefs(si int, expr string, seen map[string]bool) []refInfo {
	wb := ev.book()
	toks := tokenise(expr)
	var out []refInfo
	for i := 0; i < len(toks); i++ {
		t := toks[i]
		sheet := si
		if t.kind == tokSheet {
			idx, ok := wb.sheetIndexByName(t.val)
			i++
			if i >= len(toks) {
				break
			}
			if !ok {
				continue
			}
			sheet = idx
			t = toks[i]
		}
		if t.kind != tokIdent && t.kind != tokNum {
			continue
		}
		if t.kind == tokIdent && i+1 < len(toks) && toks[i+1].kind == tokLParen {
			continue // function name
		}
		if a, next, ok := scanRefAtom(toks, i); ok {
			out = append(out, refInfo{sheet: sheet, areas: []area{a}})
			i = next - 1
			continue
		}
		if t.kind == tokIdent {
			up := strings.ToUpper(t.val)
			if def, ok := wb.names[up]; ok && !seen[up] {
				seen[up] = true
				out = append(out, ev.formulaRefs(def.sheet, def.text, seen)...)
				delete(seen, up)
			}
		}
	}
	return out
}

// scanRefAtom recognises a reference at toks[i]: a cell (optionally followed
// by ":cell"), a column range (A:C) or a row range (1:3). It returns the area
// and the index just past it.
func scanRefAtom(toks []token, i int) (area, int, bool) {
	t := toks[i]
	colon := i+2 < len(toks) && toks[i+1].kind == tokColon
	if t.kind == tokIdent {
		if a, ok := parseCellRef(t.val); ok {
			if colon && toks[i+2].kind == tokIdent {
				if b, ok := parseCellRef(toks[i+2].val); ok {
					return normArea(area{r1: a.row, c1: a.col, r2: b.row, c2: b.col}), i + 3, true
				}
			}
			return area{r1: a.row, c1: a.col, r2: a.row, c2: a.col}, i + 1, true
		}
		if colon && toks[i+2].kind == tokIdent {
			if c1, ok := parseColRef(t.val); ok {
				if c2, ok := parseColRef(toks[i+2].val); ok {
					return normArea(area{r1: 0, c1: c1, r2: maxSheetRows - 1, c2: c2}), i + 3, true
				}
			}
		}
	}
	if colon && (t.kind == tokNum || t.kind == tokIdent) && (toks[i+2].kind == tokNum || toks[i+2].kind == tokIdent) {
		if r1, ok := parseRowRef(t.val); ok {
			if r2, ok := parseRowRef(toks[i+2].val); ok {
				return normArea(area{r1: r1, c1: 0, r2: r2, c2: maxSheetCols - 1}), i + 3, true
			}
		}
	}
	return area{}, i, false
}

// formulaCellsIn returns the formula cells of sheet si inside a.
func (g *depGraph) formulaCellsIn(si int, a area) []sheetCell {
	var out []sheetCell
	for _, n := range g.bySheet[si] {
		if a.contains(n.addr.row, n.addr.col) {
			out = append(out, n)
		}
	}
	return out
}

// precedents returns the direct references of formula cell n.
func (g *depGraph) precedents(n sheetCell) []refInfo { return g.refs[n] }

// dependents returns the formula cells whose references overlap area a of
// sheet si, i.e. the cells to recalculate when a changes.
func (g *depGraph) dependents(si int, a area) []sheetCell {
	var out []sheetCell
	for _, n := range g.formulas {
		for _, r := range g.refs[n] {
			if r.sheet != si {
				continue
			}
			hit := false
			for _, ra := range r.areas {
				if _, ok := intersectArea(ra, a); ok {
					hit = true
					break
				}
			}
			if hit {
				out = append(out, n)
				break
			}
		}
	}
	return out
}

// workbookOrder returns every formula cell in evaluation order (precedents
// first) and the cells that sit on, or depend on, a reference cycle.
func (ev *Evaluator) workbookOrder() ([]sheetCell, map[sheetCell]bool) {
	g := ev.buildDepGraph()
	isFormula := make(map[sheetCell]bool, len(g.formulas))
	for _, n := range g.formulas {
		isFormula[n] = true
	}
	deps := func(n sheetCell) []sheetCell {
		var out []sheetCell
		for _, r := range g.refs[n] {
			for _, a := range r.areas {
				if a.rows()*a.cols() <= len(g.bySheet[r.sheet]) {
					for rr := a.r1; rr <= a.r2; rr++ {
						for cc := a.c1; cc <= a.c2; cc++ {
							m := sheetCell{sheet: r.sheet, addr: cellAddr{row: rr, col: cc}}
							if isFormula[m] {
								out = append(out, m)
							}
						}
					}
				} else {
					out = append(out, g.formulaCellsIn(r.sheet, a)...)
				}
			}
		}
		return out
	}

	const (
		white = 0
		grey  = 1
		black = 2
	)
	color := make(map[sheetCell]int, len(g.formulas))
	circular := make(map[sheetCell]bool)
	var order []sheetCell
	var visit func(n sheetCell)
	visit = func(n sheetCell) {
		switch color[n] {
		case black:
			return
		case grey:
			circular[n] = true
			return
		}
		color[n] = grey
		for _, d := range deps(n) {
			visit(d)
			if circular[d] {
				circular[n] = true
			}
		}
		color[n] = black
		if !circular[n] {
			order = append(order, n)
		}
	}
	for _, n := range g.formulas {
		visit(n)
	}
	return order, circular
}
