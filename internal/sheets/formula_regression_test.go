package sheets

import "testing"

func TestLinest(t *testing.T) {
	// y = 2x + 1 exactly: ys at x=1..4 → 3,5,7,9. LINEST → {slope=2, intercept=1}.
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(1, 0, float64(5)),
		libCell(2, 0, float64(7)), libCell(3, 0, float64(9)),
		libCell(0, 1, float64(1)), libCell(1, 1, float64(2)),
		libCell(2, 1, float64(3)), libCell(3, 1, float64(4)),
	}
	out := Recompute(append([]FsCellData{
		libFormula(0, 3, "=LINEST(A1:A4,B1:B4)"),
	}, cells...))
	wantCellNum(t, out, 0, 3, 2) // slope
	wantCellNum(t, out, 0, 4, 1) // intercept
}

func TestTrend(t *testing.T) {
	// Same line; TREND for new_xs {5,6} → 11,13.
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(1, 0, float64(5)),
		libCell(2, 0, float64(7)), libCell(3, 0, float64(9)),
		libCell(0, 1, float64(1)), libCell(1, 1, float64(2)),
		libCell(2, 1, float64(3)), libCell(3, 1, float64(4)),
		libCell(0, 2, float64(5)), libCell(1, 2, float64(6)),
	}
	out := Recompute(append([]FsCellData{
		libFormula(0, 4, "=TREND(A1:A4,B1:B4,C1:C2)"),
	}, cells...))
	wantCellNum(t, out, 0, 4, 11)
	wantCellNum(t, out, 1, 4, 13)
}

func TestLogest(t *testing.T) {
	// y = 2^x: x=1..3 → 2,4,8. LOGEST → {m=2, b=1}.
	cells := []FsCellData{
		libCell(0, 0, float64(2)), libCell(1, 0, float64(4)), libCell(2, 0, float64(8)),
		libCell(0, 1, float64(1)), libCell(1, 1, float64(2)), libCell(2, 1, float64(3)),
	}
	// Tolerant compare (regression introduces ~1e-15 float error): m via the
	// array's top-left, b via INDEX.
	mustNum(t, eval(t, "INDEX(LOGEST(A1:A3,B1:B3),1,1)", cells...), 2) // m
	mustNum(t, eval(t, "INDEX(LOGEST(A1:A3,B1:B3),1,2)", cells...), 1) // b
}

func TestRandArrayShape(t *testing.T) {
	// RANDARRAY(2,3) spills a 2×3 block of values in [0,1).
	out := Recompute([]FsCellData{libFormula(0, 0, "=RANDARRAY(2,3)")})
	for r := 0; r < 2; r++ {
		for cc := 0; cc < 3; cc++ {
			cell := findOut(out, r, cc)
			if cell == nil {
				t.Fatalf("missing RANDARRAY cell (%d,%d)", r, cc)
			}
			f, ok := cell.V.(float64)
			if !ok || f < 0 || f >= 1 {
				t.Fatalf("RANDARRAY cell (%d,%d)=%v not in [0,1)", r, cc, cell.V)
			}
		}
	}
}

func TestRandArrayWhole(t *testing.T) {
	// Whole numbers in [10,12].
	out := Recompute([]FsCellData{libFormula(0, 0, "=RANDARRAY(1,5,10,12,TRUE)")})
	for cc := 0; cc < 5; cc++ {
		cell := findOut(out, 0, cc)
		f, _ := cell.V.(float64)
		if f != float64(int(f)) || f < 10 || f > 12 {
			t.Fatalf("RANDARRAY whole cell %d = %v, want integer in [10,12]", cc, cell.V)
		}
	}
}
