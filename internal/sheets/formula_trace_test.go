package sheets

// Ports of OnlyOffice's FormulaTrace.js (precedent/dependent arrows) and
// DependencyGraph.js (which listeners a change reaches), replayed through
// Grown's dependency graph. The cell layouts and expected arrows come from the
// suites' observed behaviour; UI-only assertions (canvas state) are not ported.

import (
	"sort"
	"strings"
	"testing"
	"time"
)

// sheetsSpec is a workbook as {sheet name: {A1: typed input}}, in sheet order.
type sheetsSpec []struct {
	name  string
	cells map[string]interface{}
}

func buildEvaluator(t *testing.T, spec sheetsSpec, names map[string]string) *Evaluator {
	t.Helper()
	wb := make(FsWorkbook, len(spec))
	for i, s := range spec {
		keys := make([]string, 0, len(s.cells))
		for k := range s.cells {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var data []FsCellData
		for _, k := range keys {
			data = append(data, wbCell(k, s.cells[k]))
		}
		wb[i] = FsSheet{Name: s.name, CellData: data}
	}
	ev := newWorkbookEvaluator(wb, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC))
	for n, def := range names {
		ev.wb.names[strings.ToUpper(n)] = definedName{text: def}
	}
	return ev
}

// sc addresses a cell: "A1" on Sheet1 (index 0) or "Sheet2!A1".
func sc(ev *Evaluator, ref string) sheetCell {
	si := 0
	if i := strings.Index(ref, "!"); i >= 0 {
		si, _ = ev.book().sheetIndexByName(ref[:i])
		ref = ref[i+1:]
	}
	a, _ := parseCellRef(ref)
	return sheetCell{sheet: si, addr: a}
}

type arrowCheck struct {
	from, to, want string // want: "" (no arrow), "1", or "A20:A22"
}

func checkPrec(t *testing.T, tr *traceSession, step string, checks ...arrowCheck) {
	t.Helper()
	for _, c := range checks {
		if got := tr.precedent(sc(tr.ev, c.from), sc(tr.ev, c.to)); got != c.want {
			t.Errorf("%s: %s<-%s = %q, want %q", step, c.from, c.to, got, c.want)
		}
	}
}

func checkDep(t *testing.T, tr *traceSession, step string, checks ...arrowCheck) {
	t.Helper()
	for _, c := range checks {
		if got := tr.dependent(sc(tr.ev, c.from), sc(tr.ev, c.to)); got != c.want {
			t.Errorf("%s: %s->%s = %q, want %q", step, c.from, c.to, got, c.want)
		}
	}
}

func TestFormulaTraceDefNames(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#DefName tests", func(t *testing.T) {
		cells := map[string]interface{}{
			"A1": "=a", "C1": "=C2", "C2": 2.0, "D1": 1.0, "D2": "=F1",
			"A3": "=a", "A4": "=a", "B3": "=a", "B4": "=a", "F7": "=a", "F9": "=a", "G9": "=a",
			"I3": "=IF(1,OneCell,0)", "I4": "=IF(1,OneCell,0)", "I5": "=IF(0,OneCell,0)", "I6": "=IF(0,OneCell,0)",
			"K3": "=IF(1,TwoCellInARow,0)", "K4": "=IF(1,TwoCellInARow,0)", "K5": "=IF(0,TwoCellInARow,0)", "K6": "=IF(0,TwoCellInARow,0)",
		}
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, map[string]string{
			"a": "Sheet1!$C$1:$D$2", "OneCell": "Sheet1!$C$1", "TwoCellInARow": "Sheet1!$C$1:$D$1",
		})
		tr := newTraceSession(ev)
		tr.tracePrecedents(sc(ev, "A1"))
		checkPrec(t, tr, "click 1", arrowCheck{"A1", "C1", "C1:D2"}, arrowCheck{"C1", "C2", ""}, arrowCheck{"D2", "F1", ""})
		tr.tracePrecedents(sc(ev, "A1"))
		checkPrec(t, tr, "click 2", arrowCheck{"A1", "C1", "C1:D2"}, arrowCheck{"C1", "C2", "1"}, arrowCheck{"D2", "F1", "1"})
		tr.clear()
		tr.traceDependents(sc(ev, "C1"))
		for _, d := range []string{"A1", "A3", "A4", "B3", "B4", "F7", "F9", "G9", "I3", "I4", "I5", "I6", "K3", "K4", "K5", "K6"} {
			checkDep(t, tr, "dependents of C1", arrowCheck{"C1", d, "1"})
		}
		tr.clear()
		tr.traceDependents(sc(ev, "D2"))
		checkDep(t, tr, "dependents of D2", arrowCheck{"D2", "A3", "1"}, arrowCheck{"D2", "B4", "1"}, arrowCheck{"D2", "K3", ""}, arrowCheck{"D2", "I3", ""})
	})
}

func TestFormulaTraceAreas(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Areas tests", func(t *testing.T) {
		cells := map[string]interface{}{
			"A1": 1.0, "A2": 2.0, "A3": 3.0, "A4": "=A12", "A5": 5.0, "A6": 6.0, "A12": "=B12",
			"A20": 2.0, "A21": "=A22", "A22": "=B22", "B1": "=A4", "B10": "=E6",
			"B12": "=B13", "B13": "=B14", "B14": "=B15", "B15": "=B16", "B16": 0.0,
			"B22": "=C23", "C4": 24.0, "D22": "=A20:A22", "E1": 25.0,
		}
		// B3:B9, C3, C5:C6, C14 hold =A1:A6 and E2:E6 / E9:E11 / E13:E14 read
		// B3:B7 / B3:B5 / B8:B10 (array formulas in the suite; one formula per
		// cell here).
		for _, c := range []string{"B3", "B4", "B5", "B6", "B7", "B8", "B9", "C3", "C5", "C6", "C14"} {
			cells[c] = "=SUM(A1:A6)"
		}
		for _, c := range []string{"E2", "E3", "E4", "E5", "E6"} {
			cells[c] = "=SUM(B3:B7)"
		}
		for _, c := range []string{"E9", "E10", "E11"} {
			cells[c] = "=SUM(B3:B5)"
		}
		for _, c := range []string{"E13", "E14"} {
			cells[c] = "=SUM(B8:B10)"
		}
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil)
		tr := newTraceSession(ev)
		tr.tracePrecedents(sc(ev, "D22"))
		checkPrec(t, tr, "click 1", arrowCheck{"D22", "A20", "A20:A22"}, arrowCheck{"A21", "A22", ""}, arrowCheck{"A22", "B22", ""}, arrowCheck{"B22", "C23", ""})
		tr.tracePrecedents(sc(ev, "D22"))
		checkPrec(t, tr, "click 2", arrowCheck{"D22", "A20", "A20:A22"}, arrowCheck{"A21", "A22", "1"}, arrowCheck{"A22", "B22", "1"}, arrowCheck{"B22", "C23", ""})
		tr.tracePrecedents(sc(ev, "D22"))
		checkPrec(t, tr, "click 3", arrowCheck{"B22", "C23", "1"})
		tr.clear()
		tr.tracePrecedents(sc(ev, "E13"))
		checkPrec(t, tr, "E13 click 1", arrowCheck{"E13", "B8", "B8:B10"}, arrowCheck{"B8", "A1", ""}, arrowCheck{"B10", "E6", ""})
		tr.tracePrecedents(sc(ev, "E13"))
		checkPrec(t, tr, "E13 click 2", arrowCheck{"B8", "A1", "A1:A6"}, arrowCheck{"B9", "A1", "A1:A6"}, arrowCheck{"B10", "E6", "1"}, arrowCheck{"E6", "B3", ""})
		tr.tracePrecedents(sc(ev, "E13"))
		checkPrec(t, tr, "E13 click 3", arrowCheck{"E6", "B3", "B3:B7"}, arrowCheck{"A4", "A12", "1"})
	})
}

func TestFormulaTraceDeletes(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Deletes tests", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{
			"I1": "=G1", "G1": "=E1+G4", "G4": "=I4", "I4": "=I3", "I3": "=H3", "H3": 1.0,
			"E1": "=C1+C4", "C1": 1.0, "C4": 2.0,
		}}}, nil)
		tr := newTraceSession(ev)
		for i := 0; i < 6; i++ {
			tr.tracePrecedents(sc(ev, "I1"))
		}
		all := []arrowCheck{{"I1", "G1", "1"}, {"G1", "G4", "1"}, {"G4", "I4", "1"}, {"I4", "I3", "1"}, {"I3", "H3", "1"}, {"G1", "E1", "1"}, {"E1", "C1", "1"}, {"E1", "C4", "1"}}
		checkPrec(t, tr, "traced", all...)
		// Each removal takes the outermost level away.
		tr.removePrecedentLevel()
		all[4].want = ""
		checkPrec(t, tr, "first removal", all...)
		tr.removePrecedentLevel()
		all[3].want = ""
		checkPrec(t, tr, "second removal", all...)
		tr.removePrecedentLevel()
		all[2].want, all[6].want, all[7].want = "", "", ""
		checkPrec(t, tr, "third removal", all...)
		tr.removePrecedentLevel()
		all[1].want, all[5].want = "", ""
		checkPrec(t, tr, "fourth removal", all...)
		tr.removePrecedentLevel()
		all[0].want = ""
		checkPrec(t, tr, "fifth removal", all...)
	})
}

func TestFormulaTraceMergedCells(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Merged cells tests", func(t *testing.T) {
		cells := map[string]interface{}{
			"A1": "=E1", "A2": "=E2", "B1": "=F1", "B2": "=F2",
			"E1": "=H1", "E2": "=H2", "F1": "=I1", "F2": "=I2",
		}
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil)
		tr := newTraceSession(ev)
		// The suite traces precedents and dependents from each cell of A1:B2
		// and its sources; trace every cell twice to cover both levels.
		for _, start := range []string{"A1", "A2", "B1", "B2"} {
			tr.tracePrecedents(sc(ev, start))
			tr.tracePrecedents(sc(ev, start))
		}
		for _, start := range []string{"E1", "E2", "F1", "F2"} {
			tr.traceDependents(sc(ev, start))
		}
		before := []arrowCheck{{"A1", "E1", "1"}, {"E1", "H1", "1"}, {"A2", "E2", "1"}, {"E2", "H2", "1"}, {"B1", "F1", "1"}, {"F1", "I1", "1"}, {"B2", "F2", "1"}, {"F2", "I2", "1"}}
		checkPrec(t, tr, "before merge", before...)
		checkDep(t, tr, "before merge", arrowCheck{"E1", "A1", "1"})
		// Merging A1:B2 keeps only the top-left cell's content.
		delete(cells, "A2")
		delete(cells, "B1")
		delete(cells, "B2")
		tr.rebind(buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil))
		checkPrec(t, tr, "after merge",
			arrowCheck{"A1", "E1", "1"}, arrowCheck{"E1", "H1", "1"},
			arrowCheck{"A2", "E2", ""}, arrowCheck{"E2", "H2", "1"},
			arrowCheck{"B1", "F1", ""}, arrowCheck{"F1", "I1", "1"},
			arrowCheck{"B2", "F2", ""}, arrowCheck{"F2", "I2", "1"})
		checkDep(t, tr, "after merge", arrowCheck{"E2", "A2", ""}, arrowCheck{"F1", "B1", ""}, arrowCheck{"F2", "B2", ""})
	})
}

func TestFormulaTraceMixed(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Mixed tests", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{
			{"Sheet1", map[string]interface{}{"A1": "=Sheet2!A10+12", "B1": "=Sheet2!A10+A1", "C1": "=Sheet2!A10+B1"}},
			{"Sheet2", map[string]interface{}{"A1": "=Sheet1!C1"}},
		}, nil)
		tr := newTraceSession(ev)
		ext := func(from string) []string {
			var out []string
			for _, n := range tr.externalPrecedents(sc(ev, from)) {
				out = append(out, tr.cellKey(n))
			}
			return out
		}
		tr.tracePrecedents(sc(ev, "B1"))
		checkPrec(t, tr, "click 1", arrowCheck{"B1", "A1", "1"}, arrowCheck{"C1", "B1", ""})
		if got := ext("B1"); len(got) != 1 || got[0] != "Sheet2!A10" {
			t.Errorf("B1 external precedents = %v", got)
		}
		if got := ext("A1"); len(got) != 0 {
			t.Errorf("A1 external precedents after one click = %v", got)
		}
		tr.tracePrecedents(sc(ev, "B1"))
		if got := ext("A1"); len(got) != 1 || got[0] != "Sheet2!A10" {
			t.Errorf("A1 external precedents = %v", got)
		}
		for i := 0; i < 4; i++ {
			tr.traceDependents(sc(ev, "B1"))
		}
		checkDep(t, tr, "dependents", arrowCheck{"B1", "C1", "1"}, arrowCheck{"C1", "Sheet2!A1", "1"})
		checkPrec(t, tr, "dependents keep precedents", arrowCheck{"C1", "B1", ""})
	})
}

func TestFormulaTraceRecursive(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Recursive formulas", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{"A100": "=A100+1"}}}, nil)
		tr := newTraceSession(ev)
		tr.tracePrecedents(sc(ev, "A100"))
		checkPrec(t, tr, "self precedent", arrowCheck{"A100", "A100", ""})
		tr.clear()
		tr.traceDependents(sc(ev, "A100"))
		checkDep(t, tr, "self dependent", arrowCheck{"A100", "A100", ""})
		ev = buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{"A100": "=A100+B100", "B100": "=B100+C100"}}}, nil)
		tr = newTraceSession(ev)
		tr.tracePrecedents(sc(ev, "A100"))
		checkPrec(t, tr, "chain", arrowCheck{"A100", "B100", "1"}, arrowCheck{"A100", "A100", ""})
		tr.clear()
		tr.traceDependents(sc(ev, "A100"))
		checkDep(t, tr, "chain dependents", arrowCheck{"A100", "A100", ""})
	})
}

// listeners places one formula per listening box and returns which boxes a
// set of changed boxes reaches.
func listenersHit(t *testing.T, listening, changed []string) []string {
	t.Helper()
	cells := map[string]interface{}{}
	for i, box := range listening {
		cells[addrToName(100+i, 25)] = "=SUM(" + box + ")"
	}
	ev := buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil)
	g := ev.buildDepGraph()
	hit := map[string]bool{}
	for _, ch := range changed {
		parts := strings.Split(ch, ":")
		a, _ := parseCellRef(parts[0])
		b := a
		if len(parts) == 2 {
			b, _ = parseCellRef(parts[1])
		}
		for _, n := range g.dependents(0, normArea(area{r1: a.row, c1: a.col, r2: b.row, c2: b.col})) {
			hit[listening[n.addr.row-100]] = true
		}
	}
	var out []string
	for _, box := range listening {
		if hit[box] {
			out = append(out, box)
		}
	}
	return out
}

func TestDependencyGraphBroadcast(t *testing.T) {
	cellsL := []string{"B1", "C1", "A2", "D2", "E2"}
	rangesL := []string{"B2:C2", "B2:D2", "C2:D2", "E2:E3", "G2:G3"}
	for _, tc := range []struct {
		tag                        string
		listening, changed, expect []string
	}{
		{"oo:cell/spreadsheet-calculation/DependencyGraph.js#DependencyGraph _broadcastCellsByCells",
			cellsL, []string{"A1", "B1", "C1", "D1", "D2", "A3"}, []string{"B1", "C1", "D2"}},
		{"oo:cell/spreadsheet-calculation/DependencyGraph.js#DependencyGraph _broadcastRangesByCells",
			rangesL, []string{"A1", "B1", "A2", "C2", "H2", "E3", "F3"}, []string{"B2:C2", "B2:D2", "C2:D2", "E2:E3"}},
		{"oo:cell/spreadsheet-calculation/DependencyGraph.js#DependencyGraph _broadcastCellsByRanges",
			cellsL, []string{"C1:D2", "A2:B3", "E2:F3"}, []string{"C1", "A2", "D2", "E2"}},
		{"oo:cell/spreadsheet-calculation/DependencyGraph.js#DependencyGraph _broadcastRangesByRanges",
			rangesL, []string{"A1:B3", "D3:H4"}, []string{"B2:C2", "B2:D2", "E2:E3", "G2:G3"}},
	} {
		t.Run(tc.tag, func(t *testing.T) {
			if got := listenersHit(t, tc.listening, tc.changed); strings.Join(got, ",") != strings.Join(tc.expect, ",") {
				t.Fatalf("listeners reached = %v, want %v", got, tc.expect)
			}
		})
	}
}

func TestGetAllFormulasRecalc(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/formula-tests/FormulaTests.js#GetAllFormulas test", func(t *testing.T) {
		// Formula cells survive a workbook recalculation, and volatile
		// functions (RAND) produce fresh values that dependents follow.
		cells := map[string]interface{}{"A9": "=SIN(10)", "A10": "=SUM(A2)", "B1": "=1/NOT(ISBLANK(A1))",
			"C1": "=RAND()", "C2": "=SIN(B1)", "C10": "=SUM(B:B)", "D1": "=C1"}
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil)
		if n := len(ev.buildDepGraph().formulas); n != 7 {
			t.Fatalf("formula cells = %d, want 7", n)
		}
		ev.recalcAll()
		c1, d1 := ev.cellOn(0, sc(ev, "C1").addr), ev.cellOn(0, sc(ev, "D1").addr)
		ev2 := buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil)
		ev2.recalcAll()
		c1b, d1b := ev2.cellOn(0, sc(ev2, "C1").addr), ev2.cellOn(0, sc(ev2, "D1").addr)
		if c1.num == c1b.num || d1.num == d1b.num {
			t.Fatalf("RAND did not change across recalculations: %v/%v, %v/%v", c1.num, c1b.num, d1.num, d1b.num)
		}
		if c1.num != d1.num || c1b.num != d1b.num {
			t.Fatalf("D1 (=C1) does not follow C1")
		}
	})
}
