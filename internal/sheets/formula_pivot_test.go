package sheets

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"strconv"
	"testing"
	"time"
)

// Ports of OnlyOffice's GETPIVOTDATA tests (behaviour only, clean-room):
// cell/spreadsheet-calculation/PivotTests2.js. The suite opens workbooks with
// pivot tables and GETPIVOTDATA formulas and checks each formula against the
// value Excel saved. testdata/pivot/getpivotdata.json holds those workbooks'
// cells, formulas and pivot reports in Grown's stored form.

type gpdFixture struct {
	Workbooks map[string][]struct {
		Name     string                     `json:"name"`
		Cells    map[string]json.RawMessage `json:"cells"`
		Formulas []struct {
			Cell   string          `json:"cell"`
			F      string          `json:"f"`
			Expect json.RawMessage `json:"expect"`
		} `json:"formulas"`
		Pivots []json.RawMessage `json:"pivots"`
	} `json:"workbooks"`
}

var a1Re = regexp.MustCompile(`^([A-Z]+)(\d+)$`)

func a1(ref string) (int, int) {
	m := a1Re.FindStringSubmatch(ref)
	c := 0
	for _, ch := range m[1] {
		c = c*26 + int(ch-'A'+1)
	}
	r, _ := strconv.Atoi(m[2])
	return r - 1, c - 1
}

func TestGetPivotDataParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/pivot/getpivotdata.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx gpdFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	for _, tag := range []string{
		"oo:cell/spreadsheet-calculation/PivotTests2.js#Test: GETPIVOTDATA",
		"oo:cell/spreadsheet-calculation/PivotTests2.js#Test: GETPIVOTDATA TWO ARGS",
	} {
		key := tag[len("oo:cell/spreadsheet-calculation/PivotTests2.js#"):]
		sheets := fx.Workbooks[key]
		t.Run(tag, func(t *testing.T) {
			if len(sheets) == 0 {
				t.Fatalf("no fixture for %s", key)
			}
			var wb FsWorkbook
			var stores []map[string]interface{}
			for i, sh := range sheets {
				id := fmt.Sprintf("s%d", i)
				fs := FsSheet{Name: sh.Name, ID: id, Order: i}
				for ref, v := range sh.Cells {
					r, c := a1(ref)
					var x interface{}
					_ = json.Unmarshal(v, &x)
					cell := &FsCell{}
					switch val := x.(type) {
					case map[string]interface{}:
						cell.V = val["error"]
					default:
						cell.V = val
					}
					fs.CellData = append(fs.CellData, FsCellData{R: r, C: c, V: cell})
				}
				for _, f := range sh.Formulas {
					r, c := a1(f.Cell)
					fs.CellData = append(fs.CellData, FsCellData{R: r, C: c, V: &FsCell{F: f.F}})
				}
				for _, p := range sh.Pivots {
					var out map[string]interface{}
					_ = json.Unmarshal(p, &out)
					out["sheetId"] = id
					stores = append(stores, map[string]interface{}{"id": fmt.Sprintf("p%d", len(stores)), "output": out})
				}
				wb = append(wb, fs)
			}
			pj, _ := json.Marshal(stores)
			wb[0].Extra = map[string]json.RawMessage{"grownPivots": pj}
			ev := recomputeFsWorkbook(wb, time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC))
			_ = ev
			for i, sh := range sheets {
				got := map[string]*FsCell{}
				for _, cd := range wb[i].CellData {
					if cd.V != nil && cd.V.F != "" {
						got[fmt.Sprintf("%d,%d", cd.R, cd.C)] = cd.V
					}
				}
				for _, f := range sh.Formulas {
					r, c := a1(f.Cell)
					cell := got[fmt.Sprintf("%d,%d", r, c)]
					var want interface{}
					_ = json.Unmarshal(f.Expect, &want)
					label := fmt.Sprintf("%s!%s %s", sh.Name, f.Cell, f.F)
					if cell == nil {
						t.Errorf("%s: no result", label)
						continue
					}
					switch w := want.(type) {
					case float64:
						n, ok := cell.V.(float64)
						if !ok || math.Abs(n-w) > 1e-9 {
							t.Errorf("%s = %v, want %v", label, cell.V, w)
						}
					case map[string]interface{}:
						if fmt.Sprint(cell.V) != fmt.Sprint(w["error"]) {
							t.Errorf("%s = %v, want %v", label, cell.V, w["error"])
						}
					default:
						if fmt.Sprint(cell.V) != fmt.Sprint(w) {
							t.Errorf("%s = %v, want %v", label, cell.V, w)
						}
					}
				}
			}
		})
	}
}
