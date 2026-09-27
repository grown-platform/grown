package sheets

import (
	"encoding/json"
	"testing"
)

// Charts on sheet 0's grownCharts move with row/column structure ops on
// their sheet (formulaShift.ts shiftCharts is the client twin).
func TestStructureShiftsCharts(t *testing.T) {
	data := `[{"name":"Data","id":"s1","celldata":[],"grownCharts":[
		{"id":"c1","range":{"r0":0,"r1":4,"c0":0,"c1":2},"anchor":{"r":2,"c":5,"dx":3,"dy":4,"w":400,"h":300}},
		{"id":"c2","sheetId":"s2","range":{"r0":0,"r1":4,"c0":0,"c1":2}}
	]},{"name":"Other","id":"s2","celldata":[]}]`
	out, err := ApplyStructureOpJSON(data, StructureOp{Kind: "insert", Axis: "row", Sheet: "Data", Index: 0, Count: 2})
	if err != nil {
		t.Fatal(err)
	}
	var wb []map[string]interface{}
	if err := json.Unmarshal([]byte(out), &wb); err != nil {
		t.Fatal(err)
	}
	charts := wb[0]["grownCharts"].([]interface{})
	c1 := charts[0].(map[string]interface{})
	rg := c1["range"].(map[string]interface{})
	if rg["r0"].(float64) != 2 || rg["r1"].(float64) != 6 {
		t.Fatalf("range not shifted: %v", rg)
	}
	an := c1["anchor"].(map[string]interface{})
	if an["r"].(float64) != 4 || an["c"].(float64) != 5 || an["dy"].(float64) != 4 {
		t.Fatalf("anchor not moved: %v", an)
	}
	c2 := charts[1].(map[string]interface{})
	if c2["range"].(map[string]interface{})["r0"].(float64) != 0 {
		t.Fatalf("chart on another sheet moved: %v", c2)
	}

	// Deleting the anchor's row parks the chart at the deletion point.
	out, err = ApplyStructureOpJSON(out, StructureOp{Kind: "delete", Axis: "row", Sheet: "Data", Index: 3, Count: 3})
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal([]byte(out), &wb)
	an = wb[0]["grownCharts"].([]interface{})[0].(map[string]interface{})["anchor"].(map[string]interface{})
	if an["r"].(float64) != 3 || an["dy"].(float64) != 0 {
		t.Fatalf("anchor after delete: %v", an)
	}
}
