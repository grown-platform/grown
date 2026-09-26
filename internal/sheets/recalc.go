package sheets

// Recalc round-trip: the editor posts its current workbook and gets back the
// server engine's values for every formula cell and every cell a dynamic
// array spills into, without persisting anything. The client applies the
// values that differ from what its own (fortune-sheet) engine shows, so
// functions only the server knows (cross-sheet references, defined names,
// QUERY, LAMBDA, …) display correctly without reopening the sheet.

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// RecalcCell is one computed cell.
type RecalcCell struct {
	SheetID    string      `json:"sheetId"`
	SheetIndex int         `json:"sheetIndex"`
	R          int         `json:"r"`
	C          int         `json:"c"`
	V          interface{} `json:"v"`
	M          string      `json:"m"`
	// Spill is true for a cell filled by a neighbouring dynamic array (it has
	// no formula of its own).
	Spill bool `json:"spill,omitempty"`
}

// ErrNotWorkbook is returned when the posted data is not a workbook array.
var ErrNotWorkbook = errors.New("data is not a workbook")

// RecalcWorkbook evaluates a workbook JSON document and returns the computed
// formula and spill cells, sheet by sheet in row-major order.
func RecalcWorkbook(data string) ([]RecalcCell, error) {
	var wb FsWorkbook
	if err := json.Unmarshal([]byte(data), &wb); err != nil {
		return nil, ErrNotWorkbook
	}
	ev := newWorkbookEvaluator(wb, time.Now())
	ev.recalcAll()
	var out []RecalcCell
	for i := range wb {
		st := ev.wb.sheets[i]
		for _, cd := range ev.writeBack(i, wb[i].CellData) {
			a := cellAddr{row: cd.R, col: cd.C}
			if cd.V == nil {
				continue
			}
			isFormula := strings.HasPrefix(cd.V.F, "=")
			_, spilled := st.spillCells[a]
			if !isFormula && !spilled {
				continue
			}
			out = append(out, RecalcCell{
				SheetID: wb[i].ID, SheetIndex: i, R: cd.R, C: cd.C,
				V: cd.V.V, M: cd.V.M, Spill: spilled && !isFormula,
			})
		}
	}
	return out, nil
}
