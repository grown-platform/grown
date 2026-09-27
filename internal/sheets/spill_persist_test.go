package sheets

import (
	"encoding/json"
	"testing"
)

// A spill saved through RecomputeWorkbook (the SaveSheet path) and saved
// again after the source changes: it grows, shrinks without leaving stale
// cells, turns into #SPILL! when a typed value blocks it, and spills again
// once the blocker is removed.
func TestSpillPersistsThroughSaves(t *testing.T) {
	type cell = map[string]interface{}
	save := func(cells []map[string]interface{}) []FsCellData {
		t.Helper()
		raw, _ := json.Marshal([]map[string]interface{}{{"name": "Sheet1", "row": 100, "column": 26, "celldata": cells}})
		var wb FsWorkbook
		if err := json.Unmarshal([]byte(RecomputeWorkbook(string(raw))), &wb); err != nil {
			t.Fatal(err)
		}
		return wb[0].CellData
	}
	// back turns saved celldata into the next save's input.
	back := func(data []FsCellData) []map[string]interface{} {
		var out []map[string]interface{}
		raw, _ := json.Marshal(data)
		_ = json.Unmarshal(raw, &out)
		return out
	}
	at := func(data []FsCellData, r, c int) *FsCell {
		for _, cd := range data {
			if cd.R == r && cd.C == c {
				return cd.V
			}
		}
		return nil
	}
	set := func(cells []map[string]interface{}, r, c int, v cell) []map[string]interface{} {
		var out []map[string]interface{}
		for _, cd := range cells {
			if int(cd["r"].(float64)) == r && int(cd["c"].(float64)) == c {
				continue
			}
			out = append(out, cd)
		}
		if v != nil {
			out = append(out, cell{"r": float64(r), "c": float64(c), "v": v})
		}
		return out
	}
	// A1 = SEQUENCE(B1): grows 3 → 5, shrinks to 2.
	cells := []map[string]interface{}{
		{"r": 0.0, "c": 0.0, "v": cell{"f": "=SEQUENCE(B1)"}},
		{"r": 0.0, "c": 1.0, "v": cell{"v": 3.0}},
	}
	data := save(cells)
	if c := at(data, 2, 0); c == nil || c.V != 3.0 {
		t.Fatalf("A3 = %+v, want 3", c)
	}
	cells = set(back(data), 0, 1, cell{"v": 5.0})
	data = save(cells)
	if c := at(data, 4, 0); c == nil || c.V != 5.0 {
		t.Fatalf("after grow A5 = %+v, want 5", c)
	}
	cells = set(back(data), 0, 1, cell{"v": 2.0})
	data = save(cells)
	for r := 2; r <= 4; r++ {
		if c := at(data, r, 0); c != nil && c.V != nil {
			t.Fatalf("after shrink row %d still holds %+v", r+1, c)
		}
	}
	// A typed value in the spill range blocks it; removing it unblocks.
	cells = set(back(data), 1, 0, cell{"v": "x", "m": "x"})
	data = save(cells)
	if c := at(data, 0, 0); c == nil || c.M != "#SPILL!" {
		t.Fatalf("blocked anchor = %+v, want #SPILL!", c)
	}
	if c := at(data, 1, 0); c == nil || c.V != "x" {
		t.Fatalf("blocker overwritten: %+v", c)
	}
	cells = set(back(data), 1, 0, nil)
	data = save(cells)
	if c := at(data, 1, 0); c == nil || c.V != 2.0 {
		t.Fatalf("unblocked A2 = %+v, want 2", c)
	}
	// The recalc round-trip reports the spill's size on the anchor.
	raw, _ := json.Marshal([]map[string]interface{}{{"name": "Sheet1", "id": "s1", "celldata": back(data)}})
	got, err := RecalcWorkbook(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	for _, rc := range got {
		if rc.R == 0 && rc.C == 0 && (rc.SpillRows != 2 || rc.SpillCols != 1) {
			t.Fatalf("anchor spill size = %dx%d, want 2x1", rc.SpillRows, rc.SpillCols)
		}
	}
}

// =SIN(A:A) covers the grid's rows; a whole-column array anchored below
// row 1 would run off the sheet (#SPILL!).
func TestWholeColumnLifting(t *testing.T) {
	wb := FsWorkbook{{Name: "Sheet1", Row: 100, Column: 26, CellData: []FsCellData{
		wbCell("A1", 0.0), wbCell("A3", 1.5708),
		wbCell("D1", "=SIN(A:A)"), wbCell("E3", "=A:A+2"),
	}}}
	get := recalcBook(t, wb)
	if v, ok := get("Sheet1", "D100").(float64); !ok || v != 0 {
		t.Fatalf("D100 = %v, want 0", get("Sheet1", "D100"))
	}
	if v, _ := get("Sheet1", "D3").(float64); v < 0.99 {
		t.Fatalf("D3 = %v, want ~1", v)
	}
	if v := get("Sheet1", "E3"); v != "#SPILL!" {
		t.Fatalf("E3 = %v, want #SPILL!", v)
	}
}
