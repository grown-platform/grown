package sheets

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSheetSingle(t *testing.T) {
	// Bare Recompute → lone sheet: SHEET()=1, SHEETS()=1.
	mustNum(t, eval(t, "SHEET()"), 1)
	mustNum(t, eval(t, "SHEETS()"), 1)
}

func TestSheetWorkbookContext(t *testing.T) {
	// Three sheets; the formula on sheet 2 sees SHEET()=2 and SHEETS()=3.
	wb := `[
	  {"name":"One","id":"s1","celldata":[]},
	  {"name":"Two","id":"s2","celldata":[{"r":0,"c":0,"v":{"f":"=SHEET()"}},{"r":0,"c":1,"v":{"f":"=SHEETS()"}}]},
	  {"name":"Three","id":"s3","celldata":[]}
	]`
	out := RecomputeWorkbook(wb)
	var parsed FsWorkbook
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		t.Fatalf("parse: %v", err)
	}
	find := func(sheet, r, col int) interface{} {
		for _, cd := range parsed[sheet].CellData {
			if cd.R == r && cd.C == col && cd.V != nil {
				return cd.V.V
			}
		}
		return nil
	}
	if got := find(1, 0, 0); got != float64(2) {
		t.Errorf("SHEET() on sheet 2 = %v, want 2", got)
	}
	if got := find(1, 0, 1); got != float64(3) {
		t.Errorf("SHEETS() = %v, want 3", got)
	}
	if !strings.Contains(out, "Three") {
		t.Errorf("sheet names should survive: %s", out)
	}
}
