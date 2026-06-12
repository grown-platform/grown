package sheets

import "testing"

// libFormula builds a formula cell datum.
func libFormula(r, c int, f string) FsCellData {
	return FsCellData{R: r, C: c, V: &FsCell{F: f}}
}

// findOut locates the output cell at (r,c) after Recompute.
func findOut(out []FsCellData, r, c int) *FsCell {
	for i := range out {
		if out[i].R == r && out[i].C == c {
			return out[i].V
		}
	}
	return nil
}

// wantCellNum asserts the spilled/computed cell at (r,c) equals n.
func wantCellNum(t *testing.T, out []FsCellData, r, c int, n float64) {
	t.Helper()
	cell := findOut(out, r, c)
	if cell == nil {
		t.Fatalf("no cell at (%d,%d)", r, c)
	}
	f, ok := cell.V.(float64)
	if !ok {
		t.Fatalf("cell (%d,%d) = %v (%T), want %g", r, c, cell.V, cell.V, n)
	}
	if f != n {
		t.Fatalf("cell (%d,%d) = %g, want %g", r, c, f, n)
	}
}

func TestSpillSequenceColumn(t *testing.T) {
	out := Recompute([]FsCellData{libFormula(0, 0, "=SEQUENCE(3)")})
	wantCellNum(t, out, 0, 0, 1)
	wantCellNum(t, out, 1, 0, 2)
	wantCellNum(t, out, 2, 0, 3)
}

func TestSpillSequenceGrid(t *testing.T) {
	// SEQUENCE(2,3) → 1 2 3 / 4 5 6
	out := Recompute([]FsCellData{libFormula(0, 0, "=SEQUENCE(2,3)")})
	wantCellNum(t, out, 0, 0, 1)
	wantCellNum(t, out, 0, 1, 2)
	wantCellNum(t, out, 0, 2, 3)
	wantCellNum(t, out, 1, 0, 4)
	wantCellNum(t, out, 1, 1, 5)
	wantCellNum(t, out, 1, 2, 6)
}

func TestSpillBlocked(t *testing.T) {
	// SEQUENCE(3) at A1 but A2 already holds 99 → #SPILL!, A2 untouched.
	out := Recompute([]FsCellData{
		libFormula(0, 0, "=SEQUENCE(3)"),
		libCell(1, 0, float64(99)),
	})
	anchor := findOut(out, 0, 0)
	if anchor == nil || anchor.M != "#SPILL!" {
		t.Fatalf("anchor = %+v, want M=#SPILL!", anchor)
	}
	blocker := findOut(out, 1, 0)
	if blocker == nil || blocker.V != float64(99) {
		t.Fatalf("blocker cell overwritten: %+v", blocker)
	}
}

func TestSpillSort(t *testing.T) {
	// A1:A3 = 3,1,2 ; C1 = SORT(A1:A3) → 1,2,3 down column C.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(3)), libCell(1, 0, float64(1)), libCell(2, 0, float64(2)),
		libFormula(0, 2, "=SORT(A1:A3)"),
	})
	wantCellNum(t, out, 0, 2, 1)
	wantCellNum(t, out, 1, 2, 2)
	wantCellNum(t, out, 2, 2, 3)
}

func TestSpillUnique(t *testing.T) {
	// A1:A4 = 1,2,2,3 ; C1 = UNIQUE(A1:A4) → 1,2,3.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)),
		libCell(2, 0, float64(2)), libCell(3, 0, float64(3)),
		libFormula(0, 2, "=UNIQUE(A1:A4)"),
	})
	wantCellNum(t, out, 0, 2, 1)
	wantCellNum(t, out, 1, 2, 2)
	wantCellNum(t, out, 2, 2, 3)
}

func TestSpillFilter(t *testing.T) {
	// A1:A4 = 1,2,3,4 ; B1:B4 = 0,1,0,1 (mask) ; C1 = FILTER(A1:A4,B1:B4) → 2,4.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)), libCell(3, 0, float64(4)),
		libCell(0, 1, float64(0)), libCell(1, 1, float64(1)), libCell(2, 1, float64(0)), libCell(3, 1, float64(1)),
		libFormula(0, 2, "=FILTER(A1:A4,B1:B4)"),
	})
	wantCellNum(t, out, 0, 2, 2)
	wantCellNum(t, out, 1, 2, 4)
}

func TestSpillTranspose(t *testing.T) {
	// A1:C1 = 7,8,9 ; A3 = TRANSPOSE(A1:C1) → 7,8,9 down column A from row 3.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(7)), libCell(0, 1, float64(8)), libCell(0, 2, float64(9)),
		libFormula(2, 0, "=TRANSPOSE(A1:C1)"),
	})
	wantCellNum(t, out, 2, 0, 7)
	wantCellNum(t, out, 3, 0, 8)
	wantCellNum(t, out, 4, 0, 9)
}
