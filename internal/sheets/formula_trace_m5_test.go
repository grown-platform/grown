package sheets

// The rest of OnlyOffice's FormulaTrace.js (M5: the cases that drive the
// trace arrows in the UI) and the exhaustive DependencyGraph.js checks.
// Facts are taken from the suites' observed behaviour.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"
)

func TestFormulaTraceBase(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Base dependents test", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{"A1": 1.0, "B101": "=A1", "C101": "=B101"}}}, nil)
		tr := newTraceSession(ev)
		tr.traceDependents(sc(ev, "A1"))
		tr.traceDependents(sc(ev, "A1"))
		checkDep(t, tr, "two clicks", arrowCheck{"A1", "B101", "1"}, arrowCheck{"B101", "C101", "1"})
		tr.clear()
		checkDep(t, tr, "cleared", arrowCheck{"A1", "B101", ""})
	})
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Base precedents test", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{"A1": "=B101", "B101": "=C101", "C101": 1.0}}}, nil)
		tr := newTraceSession(ev)
		tr.tracePrecedents(sc(ev, "A1"))
		checkPrec(t, tr, "one click", arrowCheck{"A1", "B101", "1"}, arrowCheck{"B101", "C101", ""})
		tr.tracePrecedents(sc(ev, "A1"))
		checkPrec(t, tr, "two clicks", arrowCheck{"A1", "B101", "1"}, arrowCheck{"B101", "C101", "1"})
	})
}

func TestFormulaTraceDependents(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Dependents", func(t *testing.T) {
		sum := "=SUM(A1:B2)+I3:J4+B2"
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{
			"A1": 1.0, "C10": "=A1", "A10": "=A1:A2", "A11": "=A1:A2",
			"B101": sum, "B102": sum, "C101": sum, "C102": sum,
			"E200": "=C101:C102", "E201": "=C101:C102",
			"H200": "=E200:E201", "H201": "=E200:E201",
		}}}, nil)
		tr := newTraceSession(ev)
		tr.traceDependents(sc(ev, "A1"))
		for _, d := range []string{"C10", "A10", "A11", "B101", "B102", "C101", "C102"} {
			checkDep(t, tr, "click 1", arrowCheck{"A1", d, "1"})
		}
		checkDep(t, tr, "click 1", arrowCheck{"C101", "E200", ""}, arrowCheck{"C101", "E201", ""}, arrowCheck{"E200", "H200", ""}, arrowCheck{"E200", "H201", ""})
		tr.traceDependents(sc(ev, "A1"))
		checkDep(t, tr, "click 2", arrowCheck{"C101", "E200", "1"}, arrowCheck{"C101", "E201", "1"}, arrowCheck{"E200", "H200", ""}, arrowCheck{"E200", "H201", ""})
		tr.traceDependents(sc(ev, "A1"))
		checkDep(t, tr, "click 3", arrowCheck{"E200", "H200", "1"}, arrowCheck{"E200", "H201", "1"})
	})
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#External dependencies", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{
			{"Sheet1", map[string]interface{}{"A1": 1.0, "B1": "=A1"}},
			{"Sheet2", map[string]interface{}{"A1": "=Sheet1!A1", "B1": "=Sheet1!B1"}},
		}, nil)
		tr := newTraceSession(ev)
		tr.traceDependents(sc(ev, "A1"))
		checkDep(t, tr, "click 1", arrowCheck{"A1", "B1", "1"}, arrowCheck{"A1", "Sheet2!A1", "1"}, arrowCheck{"B1", "Sheet2!B1", ""})
		tr.traceDependents(sc(ev, "A1"))
		checkDep(t, tr, "click 2", arrowCheck{"B1", "Sheet2!B1", "1"})
	})
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Shared tests", func(t *testing.T) {
		// B1:C1 share one formula (=B3 relative), B5:E5 read row 3.
		ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{
			"A1": "=A3", "B1": "=B3", "C1": "=C3", "A3": 1.0, "B3": 2.0, "C3": 3.0,
			"A5": "=A3", "B5": "=B3", "C5": "=C3", "D5": "=D3", "E5": "=E3",
		}}}, nil)
		tr := newTraceSession(ev)
		tr.traceDependents(sc(ev, "B3"))
		checkDep(t, tr, "B3", arrowCheck{"B3", "B1", "1"}, arrowCheck{"B3", "B5", "1"}, arrowCheck{"B3", "C1", ""}, arrowCheck{"B3", "A5", ""})
	})
}

func TestFormulaTracePrecedents(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Precedents", func(t *testing.T) {
		ev := buildEvaluator(t, sheetsSpec{
			{"Sheet1", map[string]interface{}{"A3": "=SUM(Sheet1!A1,Sheet1!A2)"}},
			{"Sheet2", map[string]interface{}{}},
		}, nil)
		tr := newTraceSession(ev)
		tr.tracePrecedents(sc(ev, "A3"))
		checkPrec(t, tr, "sheet-qualified own refs", arrowCheck{"A3", "A1", "1"}, arrowCheck{"A3", "A2", "1"})
		if got := tr.externalPrecedents(sc(ev, "A3")); len(got) != 0 {
			t.Errorf("own-sheet refs counted as external: %v", got)
		}

		ev = buildEvaluator(t, sheetsSpec{
			{"Sheet1", map[string]interface{}{
				"A1": "=Sheet2!A10:A11+I5:J6+C1+A10:A11+Sheet2!C3",
				"C1": "=Sheet2!A10:A11+Sheet2!C3",
			}},
			{"Sheet2", map[string]interface{}{}},
		}, nil)
		tr = newTraceSession(ev)
		ext := func(from string) map[string]bool {
			out := map[string]bool{}
			for _, n := range tr.externalPrecedents(sc(ev, from)) {
				out[tr.cellKey(n)] = true
			}
			return out
		}
		tr.tracePrecedents(sc(ev, "A1"))
		checkPrec(t, tr, "click 1", arrowCheck{"A1", "C1", "1"}, arrowCheck{"A1", "A10", "A10:A11"}, arrowCheck{"A1", "I5", "I5:J6"})
		if e := ext("A1"); !e["Sheet2!A10"] || !e["Sheet2!C3"] {
			t.Errorf("A1 external precedents = %v", e)
		}
		if e := ext("C1"); len(e) != 0 {
			t.Errorf("C1 external precedents before click 2 = %v", e)
		}
		tr.tracePrecedents(sc(ev, "A1"))
		if e := ext("C1"); !e["Sheet2!A10"] || !e["Sheet2!C3"] {
			t.Errorf("C1 external precedents = %v", e)
		}
	})
}

// A whole column in an argument that takes a range (SUM, NPV's values) draws
// one arrow to the column; in a scalar argument (SIN's number, NPV's rate) the
// formula reads the cell in its own row (implicit intersection), so the arrow
// goes to that cell.
//
// oo-diff/dynamic-spill: OnlyOffice draws =SIN(A:A) as an implicit
// intersection (B4 <- A4). In Grown SIN lifts over the column and the formula
// spills (Excel 365 behaviour), so it reads all of A:A and the arrow goes to
// the column; the check below records Grown's answer.
func TestFormulaTraceFormulas(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/FormulaTrace.js#Formulas tests", func(t *testing.T) {
		for _, tc := range []struct {
			at, formula string
			header      string // arrow to A1 labelled A:A, or ""
			own         string // arrow to the same-row cell: "1" or ""
		}{
			{"B3", "=SUM(A:A)", "A:A", ""},
			{"B4", "=SIN(A:A)", "A:A", ""}, // oo-diff/dynamic-spill (OnlyOffice: "", "1")
			{"B8", "=@SIN(A:A)", "", "1"},
			{"B5", "=NPV(1;A:A)", "A:A", ""},
			{"B6", "=NPV(A:A;1)", "", "1"},
			{"B7", "=NPV(A:A;A:A)", "A:A", "1"},
		} {
			ev := buildEvaluator(t, sheetsSpec{{"Sheet1", map[string]interface{}{tc.at: tc.formula}}}, nil)
			tr := newTraceSession(ev)
			tr.tracePrecedents(sc(ev, tc.at))
			row := tc.at[1:]
			checkPrec(t, tr, tc.formula, arrowCheck{tc.at, "A1", tc.header}, arrowCheck{tc.at, "A" + row, tc.own})
		}
	})
}

func TestDependencyGraphGenerated(t *testing.T) {
	const rows, cols = 3, 3
	var boxes []area
	for r1 := 0; r1 < rows; r1++ {
		for r2 := r1; r2 < rows; r2++ {
			for c1 := 0; c1 < cols; c1++ {
				for c2 := c1; c2 < cols; c2++ {
					boxes = append(boxes, area{r1: r1, c1: c1, r2: r2, c2: c2})
				}
			}
		}
	}
	name := func(a area) string {
		return addrToName(a.r1, a.c1) + ":" + addrToName(a.r2, a.c2)
	}
	// graph places one SUM per listening box (in column Z, far from the grid).
	graph := func(listen []area) *depGraph {
		cells := map[string]interface{}{}
		for i, b := range listen {
			cells[addrToName(100+i, 25)] = "=SUM(" + name(b) + ")"
		}
		return buildEvaluator(t, sheetsSpec{{"Sheet1", cells}}, nil).buildDepGraph()
	}
	hits := func(g *depGraph, changed area) map[int]bool {
		out := map[int]bool{}
		for _, n := range g.dependents(0, changed) {
			out[n.addr.row-100] = true
		}
		return out
	}
	t.Run("oo:cell/spreadsheet-calculation/DependencyGraph.js#DependencyGraph generated", func(t *testing.T) {
		// Every pair of listening boxes against every pair of changed boxes:
		// the listeners reached are exactly the boxes that intersect a change.
		checked := 0
		for i, a := range boxes {
			for _, b := range boxes[i+1:] {
				listen := []area{a, b}
				g := graph(listen)
				for j, c := range boxes {
					for _, d := range boxes[j+1:] {
						got := hits(g, c)
						for k, v := range hits(g, d) {
							got[k] = v
						}
						for k, l := range listen {
							_, ic := intersectArea(l, c)
							_, id := intersectArea(l, d)
							if got[k] != (ic || id) {
								t.Fatalf("listen %s,%s changed %s,%s: listener %s reached=%v", name(a), name(b), name(c), name(d), name(l), got[k])
							}
						}
						checked++
					}
				}
			}
		}
		t.Logf("%d combinations", checked)
	})
	t.Run("oo:cell/spreadsheet-calculation/DependencyGraph.js#BroadcastHelper generated", func(t *testing.T) {
		// Two listeners with ids 1 and 2: a change of each single cell reaches
		// the listeners covering it, so the ids reached sum to the coverage.
		for _, a := range boxes {
			for _, b := range boxes {
				g := graph([]area{a, b})
				for r := 0; r < rows; r++ {
					for c := 0; c < cols; c++ {
						got := 0
						for k := range hits(g, area{r1: r, c1: c, r2: r, c2: c}) {
							got += k + 1
						}
						want := 0
						if a.contains(r, c) {
							want++
						}
						if b.contains(r, c) {
							want += 2
						}
						if got != want {
							t.Fatalf("%s + %s at %s: %d, want %d", name(a), name(b), fmt.Sprint(addrToName(r, c)), got, want)
						}
					}
				}
			}
		}
	})
}

func TestTraceDepsAPI(t *testing.T) {
	wb := FsWorkbook{
		{Name: "Sheet1", ID: "a", CellData: []FsCellData{wbCell("A1", 1.0), wbCell("B1", "=A1*2"), wbCell("C1", "=SUM(A1:B1)"), wbCell("D1", "=C1")}},
		{Name: "Other", ID: "b", CellData: []FsCellData{wbCell("A1", "=Sheet1!C1")}},
	}
	data, _ := json.Marshal(wb)
	res, err := TraceDeps(string(data), "a", "C1", 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if res.Formula != "=SUM(A1:B1)" || len(res.Precedents) != 1 || res.Precedents[0].To.Ref != "A1:B1" || res.Precedents[0].Level != 1 {
		t.Fatalf("precedents %+v", res)
	}
	var deps []string
	for _, d := range res.Dependents {
		deps = append(deps, fmt.Sprintf("%d:%s!%s->%s!%s:%v", d.Level, d.From.Sheet, d.From.Ref, d.To.Sheet, d.To.Ref, d.External))
	}
	sort.Strings(deps)
	if strings.Join(deps, " ") != "1:Sheet1!C1->Other!A1:true 1:Sheet1!C1->Sheet1!D1:false" {
		t.Fatalf("dependents %v", deps)
	}
	res, _ = TraceDeps(string(data), "", "Sheet1!A1", 3, 3)
	if len(res.Precedents) != 0 || len(res.Dependents) < 3 {
		t.Fatalf("A1: %+v", res)
	}
	if _, err := TraceDeps(string(data), "zz", "A1", 1, 1); err == nil {
		t.Fatal("unknown sheet accepted")
	}
}
