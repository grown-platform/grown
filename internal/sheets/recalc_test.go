package sheets

import "testing"

func TestRecalcWorkbookReturnsFormulaAndSpillCells(t *testing.T) {
	data := `[{"name":"Sheet1","id":"s1","celldata":[
		{"r":0,"c":0,"v":{"f":"=Data!A1*2","v":"#NAME?"}},
		{"r":1,"c":0,"v":{"f":"=SEQUENCE(2)"}},
		{"r":5,"c":5,"v":{"v":7}}]},
		{"name":"Data","id":"s2","celldata":[{"r":0,"c":0,"v":{"v":21}}]}]`
	cells, err := RecalcWorkbook(data)
	if err != nil {
		t.Fatal(err)
	}
	type key struct{ sheet, r, c int }
	got := map[key]RecalcCell{}
	for _, c := range cells {
		got[key{c.SheetIndex, c.R, c.C}] = c
	}
	if len(cells) != 3 {
		t.Fatalf("cells = %+v, want the two formulas and one spill cell", cells)
	}
	if c := got[key{0, 0, 0}]; c.V != 42.0 || c.M != "42" || c.SheetID != "s1" || c.Spill {
		t.Errorf("A1 = %+v", c)
	}
	if c := got[key{0, 2, 0}]; c.V != 2.0 || !c.Spill {
		t.Errorf("A3 (spill) = %+v", c)
	}
}

func TestRecalcWorkbookRejectsNonWorkbook(t *testing.T) {
	if _, err := RecalcWorkbook(`{"not":"a workbook"}`); err != ErrNotWorkbook {
		t.Fatalf("err = %v", err)
	}
}
