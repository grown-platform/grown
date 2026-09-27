package sheets

// Structured references (Excel tables): parsing, evaluation, dependencies and
// the OnlyOffice table cases (SheetStructureTests.js table tests,
// FormulaTrace.js "Tables tests"). The OnlyOffice facts are taken from the
// suites' observed behaviour; the edit-text forms ([@Col] ↔ [#This Row]) are
// checked in web/app/src/pages/sheets/__parity__/tables.parity.test.ts.

import (
	"encoding/json"
	"fmt"
	"sort"
	"testing"
	"time"
)

// tableSpec is a grownTables entry for tests.
type tableSpec struct {
	name    string
	ref     string // A1 range of the whole table
	header  int
	totals  int
	columns []string
}

func (ts tableSpec) json() map[string]interface{} {
	a, b := splitRange(ts.ref)
	cols := []map[string]interface{}{}
	for i, c := range ts.columns {
		cols = append(cols, map[string]interface{}{"id": i + 1, "name": c})
	}
	return map[string]interface{}{
		"id": 1, "name": ts.name, "displayName": ts.name,
		"ref":            map[string]int{"r1": a.row, "c1": a.col, "r2": b.row, "c2": b.col},
		"headerRowCount": ts.header, "totalsRowCount": ts.totals, "columns": cols,
	}
}

func splitRange(ref string) (cellAddr, cellAddr) {
	for i := 0; i < len(ref); i++ {
		if ref[i] == ':' {
			a, _ := parseCellRef(ref[:i])
			b, _ := parseCellRef(ref[i+1:])
			return a, b
		}
	}
	a, _ := parseCellRef(ref)
	return a, a
}

// tableBook builds a one-sheet workbook with cells and tables.
func tableBook(cells map[string]interface{}, tables ...tableSpec) FsWorkbook {
	keys := make([]string, 0, len(cells))
	for k := range cells {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var data []FsCellData
	for _, k := range keys {
		data = append(data, wbCell(k, cells[k]))
	}
	sh := FsSheet{Name: "Sheet1", ID: "s1", CellData: data}
	if len(tables) > 0 {
		list := []interface{}{}
		for _, t := range tables {
			list = append(list, t.json())
		}
		raw, _ := json.Marshal(list)
		sh.Extra = map[string]json.RawMessage{"grownTables": raw}
	}
	return FsWorkbook{sh}
}

// evalAt evaluates formula (no "=") as if it were in cell at of sheet 0,
// after a recalculation of the workbook.
func evalAt(ev *Evaluator, at, formula string) value {
	a, _ := parseCellRef(at)
	var v value
	ev.onSheet(0, func() {
		pr, pc := ev.curRow, ev.curCol
		ev.curRow, ev.curCol = a.row, a.col
		v = ev.evalExpr(formula)
		ev.curRow, ev.curCol = pr, pc
	})
	return v
}

func newTableEvaluator(wb FsWorkbook) *Evaluator {
	ev := newWorkbookEvaluator(wb, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC))
	ev.recalcAll()
	return ev
}

// elem reads element (r, c) of a result (a scalar is its own 0,0 element).
func elem(v value, r, c int) interface{} {
	if v.kind == kindArray {
		if r >= v.arr.rows || c >= v.arr.cols {
			return "<out of range>"
		}
		v = v.arr.cells[r][c]
	} else if r != 0 || c != 0 {
		return "<out of range>"
	}
	return scalarOf(v)
}

func scalarOf(v value) interface{} {
	switch v.kind {
	case kindNum:
		if v.blank {
			return nil
		}
		return v.num
	case kindBool:
		return v.num != 0
	case kindStr:
		return v.str
	case kindErr:
		return "err:" + v.str
	}
	return fmt.Sprint(v)
}

type elemCheck struct {
	r, c int
	want interface{}
}

func checkElems(t *testing.T, label string, v value, checks ...elemCheck) {
	t.Helper()
	for _, ch := range checks {
		if got := elem(v, ch.r, ch.c); fmt.Sprint(got) != fmt.Sprint(ch.want) {
			t.Errorf("%s [%d,%d] = %v, want %v", label, ch.r, ch.c, got, ch.want)
		}
	}
}

// ooTableBook is the table the OnlyOffice table tests make from A100:C103:
// with "My table has headers" off a header row is inserted, so the table is
// A100:C105 (header row 100, data 101-104, the totals row added at 105,
// labelled "Summary" by OnlyOffice).
func ooTableBook(headers [3]string, fill bool) FsWorkbook {
	cells := map[string]interface{}{"A100": headers[0], "B100": headers[1], "C100": headers[2], "A105": "Summary", "C105": "=SUBTOTAL(109,Table1[" + escapeColumn(headers[2]) + "])"}
	if fill {
		for r := 101; r <= 104; r++ {
			for _, c := range []string{"A", "B", "C"} {
				cells[fmt.Sprintf("%s%d", c, r)] = 1.0
			}
		}
	}
	return tableBook(cells, tableSpec{name: "Table1", ref: "A100:C105", header: 1, totals: 1, columns: headers[:]})
}

func escapeColumn(s string) string {
	out := []byte{}
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\'', '#', '@', '[', ']':
			out = append(out, '\'')
		}
		out = append(out, s[i])
	}
	return string(out)
}

func TestStructSpecParse(t *testing.T) {
	cases := []struct {
		in   string
		want structSpec
		ok   bool
	}{
		{"", structSpec{data: true}, true},
		{"Col", structSpec{col1: "Col"}, true},
		{"Unit Price", structSpec{col1: "Unit Price"}, true},
		{"@", structSpec{thisRow: true}, true},
		{"@Col", structSpec{thisRow: true, col1: "Col"}, true},
		{"@[Col 1]", structSpec{thisRow: true, col1: "Col 1"}, true},
		{"@[A]:[B]", structSpec{thisRow: true, col1: "A", col2: "B"}, true},
		{"#All", structSpec{all: true}, true},
		{"#this row", structSpec{thisRow: true}, true},
		{"[#Headers],[Col]", structSpec{headers: true, col1: "Col"}, true},
		{"[#Headers], [#Data], [A]:[B]", structSpec{headers: true, data: true, col1: "A", col2: "B"}, true},
		{"[#Data];[#Totals]", structSpec{data: true, totals: true}, true},
		{"[#This Row],[#Data]", structSpec{}, false},
		{"[#This Row],[#All]", structSpec{}, false},
		{"[#All],[#Data]", structSpec{}, false},
		{"#Bogus", structSpec{}, false},
		{"[With a single '' quote]", structSpec{col1: "With a single ' quote"}, true},
		{"[a'[b']]", structSpec{col1: "a[b]"}, true},
		{"[A]:[B]:[C]", structSpec{}, false},
	}
	for _, c := range cases {
		got, ok := parseStructSpec(c.in)
		if ok != c.ok || ok && got != c.want {
			t.Errorf("parseStructSpec(%q) = %+v, %v; want %+v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestStructuredRefTokens(t *testing.T) {
	toks := tokenise(`SUM(Table1[[#Headers],[a']b]])+[@Qty]*Sheet1!T[x]&"[not]"`)
	var tables []string
	for _, tk := range toks {
		if tk.kind == tokTable {
			tables = append(tables, tk.val+"|"+tk.aux)
		}
	}
	want := []string{"Table1|[#Headers],[a']b]", "|@Qty", "T|x"}
	if fmt.Sprint(tables) != fmt.Sprint(want) {
		t.Fatalf("tokens %q, want %q", tables, want)
	}
}

func TestStructuredRefEvaluation(t *testing.T) {
	cells := map[string]interface{}{
		"B2": "Region", "C2": "Qty", "D2": "Price", "E2": "Total",
		"B3": "East", "C3": 2.0, "D3": 10.0, "E3": "=[@Qty]*[@Price]",
		"B4": "West", "C4": 3.0, "D4": 20.0, "E4": "=[@Qty]*[@Price]",
		"B5": "East", "C5": 5.0, "D5": 1.0, "E5": "=[@Qty]*[@Price]",
		"B6": "Total", "C6": "=SUBTOTAL(109,[Qty])", "E6": "=SUBTOTAL(109,Sales[Total])",
		"G1": "=SUM(Sales[Total])", "G2": "=ROWS(Sales)", "G3": "=COLUMNS(Sales[#All])",
		"G4": "=SUMIF(Sales[Region],\"East\",Sales[Total])", "G5": "=Sales[[#Totals],[Qty]]",
		"G6": "=INDEX(Sales[[Qty]:[Total]],2,3)", "G7": "=COUNTA(Sales[#Headers])",
		"G8": "=SUM(sales[QTY])", "G9": "=Sales[#Totals]", "G10": "=SUM(Sheet1!Sales[Price])",
		"G11": "=Nope[Qty]", "G12": "=Sales[Nope]", "G13": "=[Qty]", "G14": "=Sales[[#This Row],[#Data]]",
		"G15": "=Sales[@Qty]", "G16": "=SUM(Sales[@[Qty]:[Price]])",
	}
	wb := tableBook(cells, tableSpec{name: "Sales", ref: "B2:E6", header: 1, totals: 1, columns: []string{"Region", "Qty", "Price", "Total"}})
	get := recalcBook(t, wb)
	for ref, want := range map[string]interface{}{
		"E3": 20.0, "E4": 60.0, "E5": 5.0, "C6": 10.0, "E6": 85.0,
		"G1": 85.0, "G2": 3.0, "G3": 4.0, "G4": 25.0, "G5": 10.0, "G6": 60.0, "G7": 4.0, "G8": 10.0,
		"G10": 31.0, "G11": "#NAME?", "G12": "#NAME?", "G13": "#REF!", "G14": "#NAME?", "G16": "#VALUE!",
	} {
		if got := get("Sheet1", ref); fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("%s = %v, want %v", ref, got, want)
		}
	}
	// A row reference outside the data rows is #VALUE!; inside, the cell.
	ev := newTableEvaluator(tableBook(cells, tableSpec{name: "Sales", ref: "B2:E6", header: 1, totals: 1, columns: []string{"Region", "Qty", "Price", "Total"}}))
	if v := evalAt(ev, "H4", "Sales[@Qty]"); scalarOf(v) != 3.0 {
		t.Errorf("Sales[@Qty] in row 4 = %v", scalarOf(v))
	}
	if v := evalAt(ev, "H4", "SUM(Sales[@[Qty]:[Price]])"); scalarOf(v) != 23.0 {
		t.Errorf("SUM(Sales[@[Qty]:[Price]]) in row 4 = %v", scalarOf(v))
	}
	checkElems(t, "Sales[#Totals]", evalAt(ev, "H10", "Sales[#Totals]"), elemCheck{0, 0, "Total"}, elemCheck{0, 1, 10.0}, elemCheck{0, 3, 85.0})
}

// Calculated columns recompute in dependency order: a column that reads
// another calculated column of the same row, and a total that reads both.
func TestStructuredRefDependencies(t *testing.T) {
	cells := map[string]interface{}{
		"A1": "A", "B1": "B", "C1": "C",
		"A2": 1.0, "B2": "=[@C]*2", "C2": "=[@A]+1",
		"A3": 2.0, "B3": "=[@C]*2", "C3": "=[@A]+1",
		"E1": "=SUM(T[B])",
	}
	get := recalcBook(t, tableBook(cells, tableSpec{name: "T", ref: "A1:C3", header: 1, columns: []string{"A", "B", "C"}}))
	for ref, want := range map[string]interface{}{"B2": 4.0, "B3": 6.0, "E1": 10.0} {
		if got := get("Sheet1", ref); fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("%s = %v, want %v", ref, got, want)
		}
	}
}

func TestOOTableValues(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table values/values for edit tests", func(t *testing.T) {
		ev := newTableEvaluator(ooTableBook([3]string{"Column1", "Column2", "Column3"}, true))
		row3 := []elemCheck{{0, 0, 1.0}, {0, 1, 1.0}, {0, 2, 1.0}}
		for _, f := range []string{"Table1[@]", "Table1[#This Row]", "Table1[[#This Row]]"} {
			checkElems(t, f, evalAt(ev, "F102", f), row3...)
		}
		for _, f := range []string{"Table1[@Column1]", "Table1[[#This Row],[Column1]]", "Table1[@[Column1]]"} {
			checkElems(t, f, evalAt(ev, "U102", f), elemCheck{0, 0, 1.0})
		}
		for _, f := range []string{"Table1[[Column1]:[Column2]]", "Table1[@[Column1]:[Column2]]", "Table1[[#This Row],[Column1]:[Column2]]"} {
			checkElems(t, f, evalAt(ev, "AE102", f), elemCheck{0, 0, 1.0}, elemCheck{0, 1, 1.0})
		}
		if v := evalAt(ev, "AE102", "Table1[[Column1]:[Column345]]"); scalarOf(v) != "err:#NAME?" {
			t.Errorf("[[Column1]:[Column345]] = %v, want #NAME?", scalarOf(v))
		}
		headers := []elemCheck{{0, 0, "Column1"}, {0, 1, "Column2"}, {0, 2, "Column3"}}
		for _, f := range []string{"Table1[#Headers]", "Table1[[#Headers]]"} {
			checkElems(t, f, evalAt(ev, "AY102", f), headers...)
		}
		checkElems(t, "[[#Headers],[Column2]]", evalAt(ev, "BI102", "Table1[[#Headers],[Column2]]"), elemCheck{0, 0, "Column2"})
		checkElems(t, "[[#Headers],[Column2]:[Column3]]", evalAt(ev, "BN102", "Table1[[#Headers],[Column2]:[Column3]]"), elemCheck{0, 0, "Column2"}, elemCheck{0, 1, "Column3"})
		all := []elemCheck{{0, 0, "Column1"}, {0, 1, "Column2"}, {1, 0, 1.0}, {1, 1, 1.0}, {3, 0, 1.0}, {3, 1, 1.0}}
		for _, f := range []string{"Table1[#All]", "Table1[[#All]]"} {
			checkElems(t, f, evalAt(ev, "BS102", f), all...)
		}
		data := []elemCheck{{0, 0, 1.0}, {0, 1, 1.0}, {1, 0, 1.0}, {1, 1, 1.0}, {2, 0, 1.0}, {2, 1, 1.0}}
		for _, f := range []string{"Table1[#Data]", "Table1[[#Data]]"} {
			checkElems(t, f, evalAt(ev, "CC102", f), data...)
		}
		checkElems(t, "[[#Totals]]", evalAt(ev, "CM102", "Table1[[#Totals]]"), elemCheck{0, 0, "Summary"})
		checkElems(t, "[[#Data],[#Totals]]", evalAt(ev, "CR102", "Table1[[#Data],[#Totals]]"), append(data, elemCheck{4, 0, "Summary"})...)
		for _, f := range []string{"Table1[[#This Row],[#Data]]", "Table1[[#This Row],[#All]]"} {
			if v := evalAt(ev, "CW102", f); scalarOf(v) != "err:#NAME?" {
				t.Errorf("%s = %v, want #NAME?", f, scalarOf(v))
			}
		}
		hd := append([]elemCheck{}, headers...)
		hd = append(hd, elemCheck{1, 0, 1.0}, elemCheck{1, 1, 1.0}, elemCheck{2, 0, 1.0}, elemCheck{2, 1, 1.0})
		for _, f := range []string{"Table1[[#Headers],[#Data]]", "Table1[[#Data],[#Headers]]"} {
			checkElems(t, f, evalAt(ev, "CM102", f), hd...)
		}
		// Short notation inside the table (A105 is the totals row), not outside.
		checkElems(t, "[[Column1]] inside", evalAt(ev, "A105", "[[Column1]]"), elemCheck{0, 0, 1.0}, elemCheck{1, 0, 1.0}, elemCheck{2, 0, 1.0}, elemCheck{3, 0, 1.0})
		if v := evalAt(ev, "A106", "[[Column1]]"); v.kind != kindErr {
			t.Errorf("[[Column1]] outside the table = %v, want an error", scalarOf(v))
		}
		checkElems(t, "Table1[[Column1]]", evalAt(ev, "U102", "Table1[[Column1]]"), elemCheck{0, 0, 1.0}, elemCheck{3, 0, 1.0})
		// Short links inside the table parse as table references (C101).
		for _, f := range []string{"[]", "[Column1]", "[[Column1]:[Column2]]", "[@]", "[@Column1]", "[@[Column1]:[Column2]]"} {
			toks := tokenise(f)
			if len(toks) != 1 || toks[0].kind != tokTable {
				t.Errorf("%s does not tokenise as one table reference: %+v", f, toks)
			}
			if v := evalAt(ev, "C101", f); v.kind == kindErr {
				t.Errorf("%s in C101 = %v", f, scalarOf(v))
			}
		}
	})
}

func TestOOTableSpecialCharacters(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table special characters tests", func(t *testing.T) {
		h := [3]string{"With a single ' quote", "With a double '' quote", "With a special ' @ & ? * / |  # '' [ ] characters"}
		ev := newTableEvaluator(ooTableBook(h, true))
		checkElems(t, "Table1[#All]", evalAt(ev, "BS102", "Table1[#All]"),
			elemCheck{0, 0, h[0]}, elemCheck{0, 1, h[1]}, elemCheck{0, 2, h[2]},
			elemCheck{1, 0, 1.0}, elemCheck{1, 1, 1.0}, elemCheck{3, 0, 1.0}, elemCheck{3, 1, 1.0})
		// The escaped header and column forms the selection strings produce resolve.
		for i, col := range h {
			f := "Table1[[#Headers],[" + escapeColumn(col) + "]]"
			checkElems(t, f, evalAt(ev, "BS102", f), elemCheck{0, 0, col})
			f = "SUM(Table1[" + escapeColumn(col) + "])"
			if v := evalAt(ev, "BS102", f); scalarOf(v) != 4.0 {
				t.Errorf("column %d: %s = %v", i, f, scalarOf(v))
			}
		}
		f := "SUM(Table1[[" + escapeColumn(h[1]) + "]:[" + escapeColumn(h[2]) + "]])"
		if v := evalAt(ev, "BS102", f); scalarOf(v) != 8.0 {
			t.Errorf("%s = %v", f, scalarOf(v))
		}
	})
}

func TestOOTableColumnNames(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Table column names changes tests", func(t *testing.T) {
		// Before the rename (the table's data rows hold 1 in A101:C103).
		book := func(first string) *Evaluator {
			return newTableEvaluator(ooTableBook([3]string{first, "Column2", "Column3"}, true))
		}
		ev := book("Column1")
		for _, f := range []string{"Table1[@Column1]", "Table1[[#This Row],[Column1]]", "Table1[@[Column1]]"} {
			checkElems(t, f, evalAt(ev, "U102", f), elemCheck{0, 0, 1.0})
		}
		for _, f := range []string{"Table1[[Column1]:[Column2]]", "Table1[[Column1]:[Column3]]"} {
			if v := evalAt(ev, "AE102", f); v.kind != kindArray || v.ref == nil {
				t.Errorf("%s is not a range", f)
			}
		}
		if v := evalAt(ev, "AE102", "Table1[[Column1]:[Column345]]"); scalarOf(v) != "err:#NAME?" {
			t.Errorf("[[Column1]:[Column345]] = %v", scalarOf(v))
		}
		checkElems(t, "[[#Headers],[Column1]]", evalAt(ev, "BI102", "Table1[[#Headers],[Column1]]"), elemCheck{0, 0, "Column1"})
		checkElems(t, "[[#Headers],[Column1]:[Column2]]", evalAt(ev, "BN102", "Table1[[#Headers],[Column1]:[Column2]]"), elemCheck{0, 0, "Column1"}, elemCheck{0, 1, "Column2"})
		// After the first header becomes CLCLCL the rewritten formulas read the
		// same cells (the rewrite itself is tables.parity.test.ts).
		ev = book("CLCLCL")
		checkElems(t, "[@CLCLCL]", evalAt(ev, "U102", "Table1[@CLCLCL]"), elemCheck{0, 0, 1.0})
		checkElems(t, "[@[CLCLCL]:[Column2]]", evalAt(ev, "AE102", "Table1[[#This Row],[CLCLCL]:[Column2]]"), elemCheck{0, 0, 1.0}, elemCheck{0, 1, 1.0})
		checkElems(t, "[[#Headers],[CLCLCL]:[Column2]]", evalAt(ev, "BN102", "Table1[[#Headers],[CLCLCL]:[Column2]]"), elemCheck{0, 0, "CLCLCL"}, elemCheck{0, 1, "Column2"})
		if v := evalAt(ev, "U102", "Table1[@Column1]"); scalarOf(v) != "err:#NAME?" {
			t.Errorf("the old name still resolves: %v", scalarOf(v))
		}
	})
}

// FormulaTrace "Tables tests": a one-column table made from A2:A4 without a
// header (so A2 becomes the header, data A3:A5). OnlyOffice's plain =Table1
// in E3 is a pre-dynamic-array formula, read by implicit intersection; in
// Grown (Excel 365 semantics) that is =@Table1, while =Table1 spills.
func TestOOFormulaTraceTables(t *testing.T) {
	t.Run(`oo:cell/spreadsheet-calculation/FormulaTrace.js#Tables tests`, func(t *testing.T) {
		wb := tableBook(map[string]interface{}{
			"A2": "Column1", "A3": 1.0, "A4": "=C1", "A5": 3.0, "A8": "=A2",
			"B3": "a", "B4": "b", "B5": "c", "D2": "=A2", "D3": "=Table1",
			"E2": "=Table1", "E3": "=@Table1", "E4": "=@Table1", "E5": "=@Table1", "E7": "=@Table1", "E8": "=Table1",
		}, tableSpec{name: "Table1", ref: "A2:A5", header: 1, columns: []string{"Column1"}})
		ev := newWorkbookEvaluator(wb, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC))
		ev.recalcAll()
		tr := newTraceSession(ev)
		tr.traceDependents(sc(ev, "A3"))
		checkDep(t, tr, "dependents of A3", arrowCheck{"A3", "D2", ""}, arrowCheck{"A3", "D3", "1"}, arrowCheck{"A3", "A8", ""})
		tr.removeDependentLevel()
		checkDep(t, tr, "removed", arrowCheck{"A3", "D3", ""}, arrowCheck{"A3", "D4", ""}, arrowCheck{"A3", "D5", ""})
		tr.clear()
		tr.traceDependents(sc(ev, "A2"))
		checkDep(t, tr, "dependents of A2", arrowCheck{"A2", "D2", "1"}, arrowCheck{"A2", "D3", ""}, arrowCheck{"A2", "D4", ""}, arrowCheck{"A2", "D5", ""}, arrowCheck{"A2", "A8", "1"})
		tr.clear()
		tr.tracePrecedents(sc(ev, "D2"))
		checkPrec(t, tr, "D2", arrowCheck{"D2", "A2", "1"})
		tr.removePrecedentLevel()
		checkPrec(t, tr, "D2 removed", arrowCheck{"D2", "A2", ""})
		tr.clear()
		tr.tracePrecedents(sc(ev, "D3"))
		checkPrec(t, tr, "D3", arrowCheck{"D3", "A3", "A3:A5"}, arrowCheck{"A4", "C1", ""})
		tr.tracePrecedents(sc(ev, "D3"))
		checkPrec(t, tr, "D3 twice", arrowCheck{"D3", "A3", "A3:A5"}, arrowCheck{"A4", "C1", "1"})
		tr.removePrecedentLevel()
		checkPrec(t, tr, "D3 one removed", arrowCheck{"D3", "A3", "A3:A5"}, arrowCheck{"A4", "C1", ""})
		tr.removePrecedentLevel()
		checkPrec(t, tr, "D3 all removed", arrowCheck{"D3", "A3", ""}, arrowCheck{"A4", "C1", ""})
		tr.clear()
		tr.tracePrecedents(sc(ev, "E2"))
		checkPrec(t, tr, "E2", arrowCheck{"E2", "A3", "A3:A5"}, arrowCheck{"A4", "C1", ""})
		tr.clear()
		tr.tracePrecedents(sc(ev, "E3"))
		checkPrec(t, tr, "E3", arrowCheck{"E2", "A3", ""}, arrowCheck{"E3", "A3", "1"}, arrowCheck{"A4", "C1", ""})
		tr.clear()
		tr.tracePrecedents(sc(ev, "E8"))
		checkPrec(t, tr, "E8", arrowCheck{"E8", "A3", "A3:A5"}, arrowCheck{"A4", "C1", ""})
	})
}

// SUBTOTAL (a table's totals row) skips rows a filter hid (codes 1-11 and
// 101-111), rows hidden by hand (101-111 only) and nested SUBTOTALs.
func TestSubtotalHiddenRows(t *testing.T) {
	wb := tableBook(map[string]interface{}{
		"A1": "N", "A2": 1.0, "A3": 2.0, "A4": 4.0, "A5": 8.0, "A6": "=SUBTOTAL(9,A2:A5)",
		"B1": "=SUBTOTAL(9,A2:A6)", "B2": "=SUBTOTAL(109,A2:A6)", "B3": "=SUBTOTAL(3,A2:A6)", "B4": "=SUBTOTAL(109,A3)",
	})
	cfg, _ := json.Marshal(map[string]interface{}{"rowhidden": map[string]int{"2": 0, "4": 0}})
	flt, _ := json.Marshal(map[string]interface{}{"range": map[string]int{"r1": 0, "c1": 0, "r2": 2, "c2": 0}})
	wb[0].Extra = map[string]json.RawMessage{"config": cfg, "grownFilter": flt}
	get := recalcBook(t, wb)
	// Row 3 (index 2) is filtered out, row 5 (index 4) hidden by hand.
	for ref, want := range map[string]interface{}{"A6": 13.0, "B1": 13.0, "B2": 5.0, "B3": 3.0, "B4": 0.0} {
		if got := get("Sheet1", ref); fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("%s = %v, want %v", ref, got, want)
		}
	}
}
