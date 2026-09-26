package sheets

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// wbCell builds one celldata entry from typed input ("=…" is a formula).
func wbCell(ref string, v interface{}) FsCellData {
	a, ok := parseCellRef(ref)
	if !ok {
		panic("bad ref " + ref)
	}
	c := &FsCell{}
	if s, isStr := v.(string); isStr && strings.HasPrefix(s, "=") {
		c.F = s
	} else {
		c.V = v
	}
	return FsCellData{R: a.row, C: a.col, V: c}
}

// recalcBook recomputes a workbook and returns a lookup of computed values.
func recalcBook(t *testing.T, wb FsWorkbook) func(sheet, ref string) interface{} {
	t.Helper()
	recomputeFsWorkbook(wb, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC))
	return func(sheet, ref string) interface{} {
		a, _ := parseCellRef(ref)
		for _, sh := range wb {
			if sh.Name != sheet {
				continue
			}
			for _, cd := range sh.CellData {
				if cd.R == a.row && cd.C == a.col && cd.V != nil {
					return cd.V.V
				}
			}
		}
		return nil
	}
}

func TestCrossSheetRefsAndWorkbookOrder(t *testing.T) {
	// Sheet1 reads Sheet2, which reads Sheet3: the workbook-wide topological
	// order must compute Sheet3, then Sheet2, then Sheet1.
	wb := FsWorkbook{
		{Name: "Sheet1", CellData: []FsCellData{
			wbCell("A1", "=Sheet2!A1*2"),
			wbCell("A2", "=SUM('My Data'!A1:B2)"),
			wbCell("A3", "=SUM(Sheet2!A:A)"),
			wbCell("A4", "=Missing!A1"),
			wbCell("A5", "='My Data'!B2&\"!\""),
		}},
		{Name: "Sheet2", CellData: []FsCellData{
			wbCell("A1", "='My Data'!A1+1"),
			wbCell("A2", 10.0),
		}},
		{Name: "My Data", CellData: []FsCellData{
			wbCell("A1", 1.0), wbCell("B1", 2.0), wbCell("A2", 3.0), wbCell("B2", "=A1+B1+A2"),
		}},
	}
	get := recalcBook(t, wb)
	for _, tc := range []struct {
		sheet, ref string
		want       interface{}
	}{
		{"My Data", "B2", 6.0},
		{"Sheet2", "A1", 2.0},
		{"Sheet1", "A1", 4.0},
		{"Sheet1", "A2", 12.0},
		{"Sheet1", "A3", 12.0},
		{"Sheet1", "A4", "#REF!"},
		{"Sheet1", "A5", "6!"},
	} {
		if got := get(tc.sheet, tc.ref); got != tc.want {
			t.Errorf("%s!%s = %v, want %v", tc.sheet, tc.ref, got, tc.want)
		}
	}
}

func TestCrossSheetCycleIsCirc(t *testing.T) {
	wb := FsWorkbook{
		{Name: "Sheet1", CellData: []FsCellData{wbCell("A1", "=Sheet2!A1+1")}},
		{Name: "Sheet2", CellData: []FsCellData{wbCell("A1", "=Sheet1!A1+1")}},
	}
	get := recalcBook(t, wb)
	if got := get("Sheet1", "A1"); got != "#CIRC!" {
		t.Fatalf("Sheet1!A1 = %v, want #CIRC!", got)
	}
}

func TestDefinedNamesFromNamedRanges(t *testing.T) {
	names, _ := json.Marshal([]namedRangeEntry{
		{Name: "Prices", Range: "Sheet2!A1:A3", SheetName: "Sheet2"},
		{Name: "Rate", Range: "B1", SheetName: "Sheet1"}, // unqualified: its own sheet
	})
	wb := FsWorkbook{
		{Name: "Sheet1", Extra: map[string]json.RawMessage{"_namedRanges": names}, CellData: []FsCellData{
			wbCell("A1", "=SUM(Prices)*Rate"),
			wbCell("A2", "=ROWS(Prices)"),
			wbCell("A3", "=prices"), // case-insensitive, spills
			wbCell("B1", 2.0),
			wbCell("C1", "=NoSuchName"),
		}},
		{Name: "Sheet2", CellData: []FsCellData{wbCell("A1", 1.0), wbCell("A2", 2.0), wbCell("A3", 3.0)}},
	}
	get := recalcBook(t, wb)
	if got := get("Sheet1", "A1"); got != 12.0 {
		t.Errorf("SUM(Prices)*Rate = %v, want 12", got)
	}
	if got := get("Sheet1", "A2"); got != 3.0 {
		t.Errorf("ROWS(Prices) = %v, want 3", got)
	}
	if got := get("Sheet1", "A4"); got != 2.0 {
		t.Errorf("=prices spill A4 = %v, want 2", got)
	}
	if got := get("Sheet1", "C1"); got != "#NAME?" {
		t.Errorf("unknown name = %v, want #NAME?", got)
	}
}

func TestReferenceOperators(t *testing.T) {
	cells := []FsCellData{
		wbCell("A1", 1.0), wbCell("A2", 2.0), wbCell("A3", 3.0),
		wbCell("B1", 10.0), wbCell("B2", 20.0), wbCell("B3", 30.0),
	}
	for _, tc := range []struct {
		expr string
		want interface{}
	}{
		{"SUM(A:A)", 6.0},
		{"SUM(1:2)", 33.0},
		{"ROWS(A:A)", 1048576.0},
		{"COLUMNS(1:1)", 16384.0},
		{"SUM((A1:A3,B1))", 16.0},
		{"AREAS((A1:A3,B1,B2:B3))", 3.0},
		{"SUM(A1:B3 B2:B3)", 50.0},
		{"A1:A3 B1:B3", "#NULL!"},
		{"SUM(A1:INDEX(A1:A3,2))", 3.0},
		{"SUM(A2:A3:A1)", 6.0},
		{"ROW(INDEX(A1:B3,3,2))", 3.0},
		{"SUM(OFFSET(A1,1,0,2,2))", 55.0},
		{"OFFSET(A1,-1,0)", "#REF!"},
		{"SUM(INDIRECT(\"A1:A2\"))", 3.0},
		{"INDIRECT(\"R3C2\",FALSE)", 30.0},
		{"INDIRECT(\"R[1]C[1]\",FALSE)", 20.0},
		{"INDIRECT(\"nonsense\")", "#REF!"},
		{"ISREF(A1)", true},
		{"ISREF(A1+0)", false},
		{"ROW(B3)", 3.0},
		{"COLUMN(B3)", 2.0},
		{"@A1:A3", 1.0},
		{"ADDRESS(2,3,4,FALSE)", "R[2]C[3]"},
		{"ADDRESS(1,1,1,TRUE,\"My Sheet\")", "'My Sheet'!$A$1"},
		{"CELL(\"address\",B2)", "$B$2"},
		{"HYPERLINK(\"http://x\",\"go\")", "go"},
	} {
		v := eval(t, tc.expr, cells...).topLeft()
		var got interface{}
		switch v.kind {
		case kindBool:
			got = v.num != 0
		default:
			got = v.asInterface()
		}
		if got != tc.want {
			t.Errorf("%s = %v, want %v", tc.expr, got, tc.want)
		}
	}
}

func TestFormulaTextAndIsFormula(t *testing.T) {
	cells := []FsCellData{wbCell("A1", 1.0), wbCell("A2", "=A1*2")}
	if v := eval(t, "FORMULATEXT(A2)", cells...); v.str != "=A1*2" {
		t.Errorf("FORMULATEXT = %v", describeValue(v))
	}
	if v := eval(t, "FORMULATEXT(A1)", cells...); v.str != "#N/A" {
		t.Errorf("FORMULATEXT(value cell) = %v", describeValue(v))
	}
	if v := eval(t, "ISFORMULA(A2)", cells...); v.num != 1 {
		t.Errorf("ISFORMULA(A2) = %v", describeValue(v))
	}
}

func TestOmittedArgumentsUseDefaults(t *testing.T) {
	mustStr(t, eval(t, "ADDRESS(2,3,,)"), "$C$2")
	mustNum(t, eval(t, "SUM(1,,2)"), 3)
}

func TestBlankCells(t *testing.T) {
	cells := []FsCellData{wbCell("A1", 0.0)}
	if v := eval(t, "ISBLANK(B1)", cells...); v.num != 1 {
		t.Error("ISBLANK(empty) should be TRUE")
	}
	if v := eval(t, "ISBLANK(A1)", cells...); v.num != 0 {
		t.Error("ISBLANK(0) should be FALSE")
	}
	if v := eval(t, "ISNUMBER(B1)", cells...); v.num != 0 {
		t.Error("ISNUMBER(empty) should be FALSE")
	}
	mustNum(t, eval(t, "B1+1", cells...), 1)
}

func TestTokeniseSheetPrefixes(t *testing.T) {
	toks := tokenise(`'It''s here'!A1+Sheet2!B2+हरियाणवी!C3`)
	var sheets []string
	for _, tk := range toks {
		if tk.kind == tokSheet {
			sheets = append(sheets, tk.val)
		}
	}
	if strings.Join(sheets, "|") != "It's here|Sheet2|हरियाणवी" {
		t.Fatalf("sheet tokens = %q", sheets)
	}
}

func TestQuoteSheetName(t *testing.T) {
	for in, want := range map[string]string{
		"Sheet1": "Sheet1", "My Sheet": "'My Sheet'", "It's": "'It''s'", "1": "'1'", "A1": "'A1'", "": "",
	} {
		if got := quoteSheetName(in); got != want {
			t.Errorf("quoteSheetName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSemicolonArgumentSeparator(t *testing.T) {
	mustNum(t, eval(t, "SUM(1;2;3)"), 6)
	mustNum(t, eval(t, "SUM({1;2};3)"), 6) // ';' inside {…} still separates rows
	mustNum(t, eval(t, "ROWS({1;2;3})"), 3)
}
