package sheets

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

type structureFixture struct {
	Shift []struct {
		ID      string      `json:"id"`
		Formula string      `json:"formula"`
		Host    string      `json:"host"`
		Op      StructureOp `json:"op"`
		Expect  string      `json:"expect"`
	} `json:"shift"`
	Translate []struct {
		ID      string `json:"id"`
		Formula string `json:"formula"`
		DR      int    `json:"dr"`
		DC      int    `json:"dc"`
		Expect  string `json:"expect"`
	} `json:"translate"`
	Apply []struct {
		ID     string                                `json:"id"`
		Sheets json.RawMessage                       `json:"sheets"`
		Op     StructureOp                           `json:"op"`
		Expect map[string]map[string]json.RawMessage `json:"expect"`
	} `json:"apply"`
}

func loadStructureFixture(t *testing.T) structureFixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/structure/shift.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx structureFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Shift) < 30 || len(fx.Translate) < 10 || len(fx.Apply) < 4 {
		t.Fatalf("fixture looks truncated: %d shift, %d translate, %d apply", len(fx.Shift), len(fx.Translate), len(fx.Apply))
	}
	return fx
}

func TestStructureShiftFixture(t *testing.T) {
	fx := loadStructureFixture(t)
	for _, tc := range fx.Shift {
		if got := ShiftFormula(tc.Formula, tc.Host, tc.Op); got != tc.Expect {
			t.Errorf("%s: ShiftFormula(%q) = %q, want %q", tc.ID, tc.Formula, got, tc.Expect)
		}
	}
	for _, tc := range fx.Translate {
		if got := TranslateFormula(tc.Formula, tc.DR, tc.DC); got != tc.Expect {
			t.Errorf("%s: TranslateFormula(%q) = %q, want %q", tc.ID, tc.Formula, got, tc.Expect)
		}
	}
}

func normJSON(t *testing.T, v interface{}) interface{} {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out interface{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestStructureApplyFixture(t *testing.T) {
	fx := loadStructureFixture(t)
	for _, tc := range fx.Apply {
		out, err := ApplyStructureOpJSON(string(tc.Sheets), tc.Op)
		if err != nil {
			t.Fatalf("%s: %v", tc.ID, err)
		}
		var sheets []map[string]interface{}
		if err := json.Unmarshal([]byte(out), &sheets); err != nil {
			t.Fatal(err)
		}
		for idx, fields := range tc.Expect {
			i := 0
			for _, ch := range idx {
				i = i*10 + int(ch-'0')
			}
			for key, wantRaw := range fields {
				var want interface{}
				_ = json.Unmarshal(wantRaw, &want)
				got := normJSON(t, sheets[i][key])
				if key == "celldata" {
					list, _ := got.([]interface{})
					sort.SliceStable(list, func(a, b int) bool {
						ma, mb := list[a].(map[string]interface{}), list[b].(map[string]interface{})
						if ma["r"].(float64) != mb["r"].(float64) {
							return ma["r"].(float64) < mb["r"].(float64)
						}
						return ma["c"].(float64) < mb["c"].(float64)
					})
				}
				if !reflect.DeepEqual(got, want) {
					g, _ := json.Marshal(got)
					t.Errorf("%s: sheet %s.%s = %s, want %s", tc.ID, idx, key, g, wantRaw)
				}
			}
		}
	}
}

func TestStructureOpValidate(t *testing.T) {
	bad := []StructureOp{
		{Kind: "insert", Axis: "row", Sheet: "", Index: 0, Count: 1},
		{Kind: "insert", Axis: "diag", Sheet: "S", Index: 0, Count: 1},
		{Kind: "delete", Axis: "row", Sheet: "S", Index: 0, Count: 0},
		{Kind: "move", Axis: "col", Sheet: "S", Index: 0, Count: 1, To: -1},
		{Kind: "insertCells", Sheet: "S", Shift: "down"},
		{Kind: "deleteCells", Sheet: "S", Rect: &StructureRect{}, Shift: "down"},
		{Kind: "explode", Sheet: "S"},
	}
	for _, op := range bad {
		if op.Validate() == nil {
			t.Errorf("Validate(%+v) = nil, want error", op)
		}
	}
	good := StructureOp{Kind: "insertCells", Sheet: "S", Rect: &StructureRect{C1: 1, R1: 1, C2: 0, R2: 0}, Shift: "right"}
	if err := good.Validate(); err != nil {
		t.Errorf("Validate(good) = %v", err)
	}
}

func TestApplyStructureOpUnknownSheetAndRecompute(t *testing.T) {
	data := `[{"name":"S","id":"1","celldata":[{"r":0,"c":0,"v":{"v":2}},{"r":0,"c":1,"v":{"f":"=A1*3"}}],"frozen":{"type":"row"}}]`
	if _, err := ApplyStructureOpJSON(data, StructureOp{Kind: "insert", Axis: "row", Sheet: "nope", Index: 0, Count: 1}); err != ErrSheetNotFound {
		t.Fatalf("err = %v, want ErrSheetNotFound", err)
	}
	out, err := ApplyStructureOpJSON(data, StructureOp{Kind: "insert", Axis: "col", Sheet: "S", Index: 0, Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	out = RecomputeWorkbook(out)
	if !strings.Contains(out, `"f":"=B1*3"`) || !strings.Contains(out, `"frozen":{"type":"row"}`) {
		t.Fatalf("unexpected workbook: %s", out)
	}
	var wb FsWorkbook
	_ = json.Unmarshal([]byte(out), &wb)
	for _, cd := range wb[0].CellData {
		if cd.R == 0 && cd.C == 2 && cd.V.V != float64(6) {
			t.Errorf("C1 = %v, want 6", cd.V.V)
		}
	}
}

// Cell comment threads move with their cells; a deleted cell drops its thread.
func TestStructureShiftsCommentThreads(t *testing.T) {
	data := `[{"name":"S","id":"1","celldata":[],"grownComments":[{"id":"a","r":2,"c":1,"comments":[{"id":"x","body":"hi"}]},{"id":"b","r":4,"c":0,"comments":[]}]}]`
	out, err := ApplyStructureOpJSON(data, StructureOp{Kind: "insert", Axis: "row", Sheet: "S", Index: 0, Count: 2})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id":"a","r":4`) && !strings.Contains(out, `"r":4`) {
		t.Fatalf("thread a not moved: %s", out)
	}
	out, err = ApplyStructureOpJSON(out, StructureOp{Kind: "delete", Axis: "row", Sheet: "S", Index: 6, Count: 1})
	if err != nil {
		t.Fatal(err)
	}
	var wb []map[string]interface{}
	_ = json.Unmarshal([]byte(out), &wb)
	threads, _ := wb[0]["grownComments"].([]interface{})
	if len(threads) != 1 || threads[0].(map[string]interface{})["id"] != "a" || threads[0].(map[string]interface{})["r"] != float64(4) {
		t.Fatalf("threads after delete = %v", threads)
	}
}
