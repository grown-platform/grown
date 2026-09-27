package sheets

// Goal seek ports of OnlyOffice's whatIfAnalysisTests.js ("Goal seek"
// module). testdata/goalseek/goal-seek.json holds the facts: the typed sheet
// (cells from A1), then per seek the changing cell, the formula (placed in
// its cell), the target and the checks on the formula result and the found
// value — "fixed": n compares after rounding to n decimals, "falsy" expects no
// numeric result (not found). Seeks run in order on the same sheet, and a
// found value is written into its cell like the dialog's OK does.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"testing"
)

type goalSeekCheck struct {
	Of      string   `json:"of"` // "result" | "changing"
	Value   *float64 `json:"value,omitempty"`
	Fixed   *int     `json:"fixed,omitempty"`
	Falsy   bool     `json:"falsy,omitempty"`
	Pending string   `json:"pending,omitempty"`
}

type goalSeekFixture struct {
	Suite string `json:"suite"`
	Cases []struct {
		ID    string                 `json:"id"`
		Cells map[string]interface{} `json:"cells"`
		Seeks []struct {
			Changing string          `json:"changing"`
			Formula  string          `json:"formula"`
			Cell     string          `json:"cell"`
			Target   float64         `json:"target"`
			Checks   []goalSeekCheck `json:"checks"`
		} `json:"seeks"`
	} `json:"cases"`
}

func sheetFromCells(cells map[string]interface{}) FsSheet {
	keys := make([]string, 0, len(cells))
	for k := range cells {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	sh := FsSheet{Name: "Sheet1", ID: "s1"}
	for _, k := range keys {
		sh.CellData = append(sh.CellData, wbCell(k, cells[k]))
	}
	return sh
}

func setSheetCell(sh *FsSheet, ref string, v interface{}) {
	nc := wbCell(ref, v)
	for i, cd := range sh.CellData {
		if cd.R == nc.R && cd.C == nc.C {
			sh.CellData[i] = nc
			return
		}
	}
	sh.CellData = append(sh.CellData, nc)
}

func roundTo(v float64, digits int) float64 {
	p := math.Pow(10, float64(digits))
	return math.Round(v*p) / p
}

func TestGoalSeekParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/goalseek/goal-seek.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx goalSeekFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	for _, tc := range fx.Cases {
		tc := tc
		t.Run(tc.ID, func(t *testing.T) {
			sh := sheetFromCells(tc.Cells)
			pending, passed := 0, 0
			for i, s := range tc.Seeks {
				setSheetCell(&sh, s.Cell, "="+s.Formula)
				wb := FsWorkbook{sh}
				data, _ := json.Marshal(wb)
				res, err := GoalSeek(GoalSeekRequest{Data: string(data), FormulaCell: s.Cell, ChangingCell: s.Changing, Target: s.Target})
				if err != nil {
					t.Fatalf("seek %d (%s → %s): %v", i, s.Formula, s.Changing, err)
				}
				if res.Found {
					setSheetCell(&sh, s.Changing, res.Value)
				}
				resNum, isNum := res.Result.(float64)
				for _, c := range s.Checks {
					got, num := res.Value, true
					if c.Of == "result" {
						got, num = resNum, isNum
					}
					ok := true
					switch {
					case c.Falsy:
						ok = !res.Found || !isNum || resNum == 0
					case c.Fixed != nil:
						ok = num && roundTo(got, *c.Fixed) == roundTo(*c.Value, *c.Fixed)
					default:
						ok = num && got == *c.Value
					}
					if c.Pending != "" {
						pending++
						continue
					}
					if !ok {
						want := "falsy"
						if c.Value != nil {
							want = fmt.Sprint(*c.Value)
						}
						t.Errorf("seek %d %s=%v by %s (start %v): %s = %v (found=%v, result %v), want %s",
							i, s.Formula, s.Target, s.Changing, tc.Cells[strings.ToUpper(s.Changing)], c.Of, got, res.Found, res.Result, want)
					} else {
						passed++
					}
				}
			}
			t.Logf("%d checks passing, %d pending", passed, pending)
		})
	}
}

// The dialog can pause the search and step through it one attempt at a time;
// stepping reaches the same answer as running it through.
func TestGoalSeekPauseResumeStep(t *testing.T) {
	t.Run("oo:cell/spreadsheet-calculation/whatIfAnalysisTests.js#Test: pause, resume, step methods", func(t *testing.T) {
		sh := sheetFromCells(map[string]interface{}{"B1": 180.0, "C1": 100000.0, "D1": "=PMT(A1/12,B1,C1)"})
		req := GoalSeekRequest{FormulaCell: "D1", ChangingCell: "A1", Target: -900}
		// Pause after the first attempt.
		gs, err := newGoalSeeker(FsWorkbook{sh}, req)
		if err != nil {
			t.Fatal(err)
		}
		if gs.step() {
			t.Fatal("finished after one attempt")
		}
		if gs.attempts != 1 {
			t.Fatalf("attempts after a paused step = %d, want 1", gs.attempts)
		}
		// Resume: runs to the end.
		gs.run()
		r := gs.result()
		if !r.Found || math.Round(r.Result.(float64)) != -900 || roundTo(r.Value, 4) != 0.0702 {
			t.Fatalf("resume: %+v", r)
		}
		// Step by step: each step is one more attempt, the last one finishes.
		gs2, _ := newGoalSeeker(FsWorkbook{sh}, req)
		n := 0
		for !gs2.step() {
			n++
			if gs2.attempts != n {
				t.Fatalf("after %d steps attempts = %d", n, gs2.attempts)
			}
			if n > 100 {
				t.Fatal("no convergence")
			}
		}
		r2 := gs2.result()
		if r2.Value != r.Value || r2.Iterations != r.Iterations {
			t.Fatalf("stepped %+v, ran %+v", r2, r)
		}
	})
}

func TestGoalSeekErrors(t *testing.T) {
	wb := FsWorkbook{sheetFromCells(map[string]interface{}{"A1": 1.0, "B1": "=A1*2", "C1": "=B1"})}
	data, _ := json.Marshal(wb)
	for _, tc := range []struct {
		req  GoalSeekRequest
		want error
	}{
		{GoalSeekRequest{FormulaCell: "A1", ChangingCell: "A1"}, ErrGoalSeekFormula},
		{GoalSeekRequest{FormulaCell: "C1", ChangingCell: "B1"}, ErrGoalSeekChanging},
		{GoalSeekRequest{FormulaCell: "ZZ", ChangingCell: "A1"}, ErrGoalSeekCell},
		{GoalSeekRequest{FormulaCell: "Nope!B1", ChangingCell: "A1"}, ErrGoalSeekCell},
	} {
		tc.req.Data = string(data)
		if _, err := GoalSeek(tc.req); err != tc.want {
			t.Errorf("%+v: err %v, want %v", tc.req, err, tc.want)
		}
	}
	// Cross-sheet: the formula on Sheet2 reads Sheet1.
	wb2 := FsWorkbook{sheetFromCells(map[string]interface{}{"A1": 3.0}), {Name: "Other", ID: "s2", CellData: []FsCellData{wbCell("A1", "=Sheet1!A1^2")}}}
	data2, _ := json.Marshal(wb2)
	r, err := GoalSeek(GoalSeekRequest{Data: string(data2), FormulaCell: "Other!A1", ChangingCell: "Sheet1!A1", Target: 49})
	if err != nil || !r.Found || r.Value != 7 {
		t.Fatalf("cross-sheet: %+v %v", r, err)
	}

}
