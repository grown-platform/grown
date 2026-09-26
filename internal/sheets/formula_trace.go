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

import "strings"

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
		for _, r := range t.g.precedents(n) {
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
			return addrToName(e.rng.r1, e.rng.c1) + ":" + addrToName(e.rng.r2, e.rng.c2)
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
