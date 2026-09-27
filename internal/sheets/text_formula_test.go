package sheets

// Values of the formulas typed input turns into (SheetStructureTests "Text to
// formula" / "Unar operator removing"). The input → formula part is checked
// in vitest (__parity__/textFormula.parity.test.ts) from the same fixture;
// this evaluates each formula in its cell. Also "Formulas calc test".

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"testing"
	"time"
)

type textFormulaFixture struct {
	Cases []struct {
		ID      string                 `json:"id"`
		Cells   map[string]interface{} `json:"cells"`
		Names   map[string]string      `json:"names"`
		Entries []struct {
			Input   string      `json:"input"`
			At      string      `json:"at"`
			Formula *string     `json:"formula"`
			Expect  interface{} `json:"expect"`
			Next    interface{} `json:"next"`
			Below   interface{} `json:"below"`
			Pending string      `json:"pending"`
		} `json:"entries"`
	} `json:"cases"`
}

// displayOf finds a cell's computed value in a recomputed sheet: the number
// for numbers, the display text otherwise (booleans are stored as 1/0 with
// "TRUE"/"FALSE" as their text).
func displayOf(sh FsSheet, ref string) interface{} {
	a, _ := parseCellRef(ref)
	for _, cd := range sh.CellData {
		if cd.R == a.row && cd.C == a.col && cd.V != nil {
			if cd.V.M == "TRUE" || cd.V.M == "FALSE" {
				return cd.V.M
			}
			return cd.V.V
		}
	}
	return nil
}

func sameDisplay(got, want interface{}) bool {
	switch w := want.(type) {
	case float64:
		switch g := got.(type) {
		case float64:
			return math.Abs(g-w) <= 1e-9*math.Max(1, math.Abs(w))
		case string:
			n, err := strconv.ParseFloat(g, 64)
			return err == nil && math.Abs(n-w) <= 1e-9*math.Max(1, math.Abs(w))
		}
		return false
	case string:
		switch g := got.(type) {
		case float64:
			n, err := strconv.ParseFloat(w, 64)
			return err == nil && n == g
		}
		return fmt.Sprint(got) == w
	}
	return fmt.Sprint(got) == fmt.Sprint(want)
}

func TestTextToFormulaValues(t *testing.T) {
	raw, err := os.ReadFile("testdata/structure/text-to-formula.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx textFormulaFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	for _, tc := range fx.Cases {
		tc := tc
		t.Run(tc.ID, func(t *testing.T) {
			for _, e := range tc.Entries {
				at := e.At
				if at == "" {
					at = "C1"
				}
				cells := map[string]interface{}{}
				for k, v := range tc.Cells {
					if s, ok := v.(string); ok && s == "#N/A" {
						v = "=NA()"
					}
					cells[k] = v
				}
				if e.Formula != nil {
					cells[at] = *e.Formula
				} else {
					cells[at] = e.Input
				}
				sh := sheetFromCells(cells)
				if len(tc.Names) > 0 {
					var entries []map[string]string
					for n, r := range tc.Names {
						entries = append(entries, map[string]string{"name": n, "range": r})
					}
					b, _ := json.Marshal(entries)
					sh.Extra = map[string]json.RawMessage{"_namedRanges": b}
				}
				wb := FsWorkbook{sh}
				recomputeFsWorkbook(wb, time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC))
				if e.Formula == nil {
					// Stays a value: numbers typed as text are numbers in the grid.
					continue
				}
				if e.Pending != "" {
					continue
				}
				if got := displayOf(wb[0], at); !sameDisplay(got, e.Expect) {
					t.Errorf("%q (%s) at %s = %v, want %v", e.Input, *e.Formula, at, got, e.Expect)
				}
				a, _ := parseCellRef(at)
				if e.Next != nil {
					if got := displayOf(wb[0], addrToName(a.row, a.col+1)); !sameDisplay(got, e.Next) {
						t.Errorf("%q next = %v, want %v", e.Input, got, e.Next)
					}
				}
				if e.Below != nil {
					if got := displayOf(wb[0], addrToName(a.row+1, a.col)); !sameDisplay(got, e.Below) {
						t.Errorf("%q below = %v, want %v", e.Input, got, e.Below)
					}
				}
			}
		})
	}
}

func TestFormulasCalc(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Formulas calc test", func(t *testing.T) {
		for _, c := range []struct {
			f    string
			want interface{}
		}{
			{"=MDETERM({1,2,3,4})", "#VALUE!"},
			{"=MDETERM({1,2;10,11})", -9.0},
		} {
			wb := FsWorkbook{sheetFromCells(map[string]interface{}{"A1": 1.0, "A2": 2.0, "A3": 3.0, "B1": "+5", "B2": "+5+5", "B3": "-5", "B4": "-5-5", "C1": c.f})}
			recomputeFsWorkbook(wb, time.Now())
			if got := displayOf(wb[0], "C1"); !sameDisplay(got, c.want) {
				t.Errorf("%s = %v, want %v", c.f, got, c.want)
			}
		}
	})
}
