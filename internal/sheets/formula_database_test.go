package sheets

import "testing"

// Database for D* tests (header row + 3 records):
//   Name   Age  Dept
//   Alice  30   Eng
//   Bob    25   Sales
//   Carol  35   Eng
// Criteria at E1:E2 = {Dept; Eng}.
func dbCells() []FsCellData {
	grid := [][]interface{}{
		{"Name", "Age", "Dept"},
		{"Alice", 30.0, "Eng"},
		{"Bob", 25.0, "Sales"},
		{"Carol", 35.0, "Eng"},
	}
	var cells []FsCellData
	for r, row := range grid {
		for c, v := range row {
			cells = append(cells, libCell(r, c, v))
		}
	}
	// criteria range E1:E2
	cells = append(cells, libCell(0, 4, "Dept"), libCell(1, 4, "Eng"))
	return cells
}

func TestDSum(t *testing.T) {
	// DSUM(A1:C4, "Age", E1:E2) → Eng ages 30+35 = 65.
	out := Recompute(append([]FsCellData{
		libFormula(0, 6, `=DSUM(A1:C4,"Age",E1:E2)`),
	}, dbCells()...))
	wantCellNum(t, out, 0, 6, 65)
}

func TestDAverageDCountDMaxDMin(t *testing.T) {
	cells := dbCells()
	mustNum(t, eval(t, `DAVERAGE(A1:C4,"Age",E1:E2)`, cells...), 32.5)
	mustNum(t, eval(t, `DCOUNT(A1:C4,"Age",E1:E2)`, cells...), 2)
	mustNum(t, eval(t, `DMAX(A1:C4,"Age",E1:E2)`, cells...), 35)
	mustNum(t, eval(t, `DMIN(A1:C4,"Age",E1:E2)`, cells...), 30)
}

func TestDGet(t *testing.T) {
	// Single Sales record → DGET returns its Name = "Bob".
	cells := dbCells()
	cells = append(cells, libCell(0, 7, "Dept"), libCell(1, 7, "Sales"))
	mustStr(t, eval(t, `DGET(A1:C4,"Name",H1:H2)`, cells...), "Bob")
}

func TestDGetMultipleError(t *testing.T) {
	// Two Eng records → DGET is #NUM!.
	cells := dbCells()
	v := eval(t, `DGET(A1:C4,"Name",E1:E2)`, cells...)
	if !v.isErr() {
		t.Fatalf("DGET with multiple matches should error, got %v", v)
	}
}

func TestDFieldByIndex(t *testing.T) {
	// field given as 1-based column index 2 (=Age) instead of header name.
	cells := dbCells()
	mustNum(t, eval(t, `DSUM(A1:C4,2,E1:E2)`, cells...), 65)
}
