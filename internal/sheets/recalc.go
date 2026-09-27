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
	SheetID    string `json:"sheetId"`
	SheetIndex int    `json:"sheetIndex"`
	R          int    `json:"r"`
	C          int    `json:"c"`
	// F is the formula the value was computed from (empty for spill cells);
	// the client skips a cell whose formula changed while the request ran.
	F string      `json:"f,omitempty"`
	V interface{} `json:"v"`
	M string      `json:"m"`
	// Spill is true for a cell filled by a neighbouring dynamic array (it has
	// no formula of its own). The client stores M under the grownSpill key so
	// the next save knows the cell is spill output, not user data.
	Spill bool `json:"spill,omitempty"`
	// SpillRows/SpillCols give the size of the dynamic array a formula cell
	// spills (anchor included); both are 0 for a single value or #SPILL!.
	SpillRows int `json:"spillRows,omitempty"`
	SpillCols int `json:"spillCols,omitempty"`
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
			rc := RecalcCell{
				SheetID: wb[i].ID, SheetIndex: i, R: cd.R, C: cd.C,
				F: cd.V.F, V: cd.V.V, M: cd.V.M, Spill: spilled && !isFormula,
			}
			if ar, ok := st.spillAreas[a]; ok && isFormula {
				rc.SpillRows, rc.SpillCols = ar.rows(), ar.cols()
			}
			out = append(out, rc)
		}
	}
	return out, nil
}
