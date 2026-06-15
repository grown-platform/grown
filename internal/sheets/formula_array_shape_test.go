package sheets

import "testing"

// wantCellStr asserts the spilled/computed cell at (r,c) equals s.
func wantCellStr(t *testing.T, out []FsCellData, r, c int, s string) {
	t.Helper()
	cell := findOut(out, r, c)
	if cell == nil {
		t.Fatalf("no cell at (%d,%d)", r, c)
	}
	got, ok := cell.V.(string)
	if !ok {
		t.Fatalf("cell (%d,%d) = %v (%T), want %q", r, c, cell.V, cell.V, s)
	}
	if got != s {
		t.Fatalf("cell (%d,%d) = %q, want %q", r, c, got, s)
	}
}

func TestTextSplitRow(t *testing.T) {
	// =TEXTSPLIT("a,b,c", ",") → a | b | c across row 0.
	out := Recompute([]FsCellData{libFormula(0, 0, `=TEXTSPLIT("a,b,c",",")`)})
	wantCellStr(t, out, 0, 0, "a")
	wantCellStr(t, out, 0, 1, "b")
	wantCellStr(t, out, 0, 2, "c")
}

func TestTextSplitGrid(t *testing.T) {
	// Row delimiter ";" makes a 2×2 grid.
	out := Recompute([]FsCellData{libFormula(0, 0, `=TEXTSPLIT("a,b;c,d",",",";")`)})
	wantCellStr(t, out, 0, 0, "a")
	wantCellStr(t, out, 0, 1, "b")
	wantCellStr(t, out, 1, 0, "c")
	wantCellStr(t, out, 1, 1, "d")
}

func TestVStack(t *testing.T) {
	// A1:A2 = 1,2 ; C1 = VSTACK(A1:A2, A1:A2) → 1,2,1,2 down column C.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)),
		libFormula(0, 2, "=VSTACK(A1:A2,A1:A2)"),
	})
	wantCellNum(t, out, 0, 2, 1)
	wantCellNum(t, out, 1, 2, 2)
	wantCellNum(t, out, 2, 2, 1)
	wantCellNum(t, out, 3, 2, 2)
}

func TestHStack(t *testing.T) {
	// A1:A2 = 1,2 ; C1 = HSTACK(A1:A2, A1:A2) → two columns of 1,2.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)),
		libFormula(0, 2, "=HSTACK(A1:A2,A1:A2)"),
	})
	wantCellNum(t, out, 0, 2, 1)
	wantCellNum(t, out, 0, 3, 1)
	wantCellNum(t, out, 1, 2, 2)
	wantCellNum(t, out, 1, 3, 2)
}

func TestToCol(t *testing.T) {
	// A1:B2 = 1,2 / 3,4 ; D1 = TOCOL(A1:B2) → 1,2,3,4 by row.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
		libFormula(0, 3, "=TOCOL(A1:B2)"),
	})
	wantCellNum(t, out, 0, 3, 1)
	wantCellNum(t, out, 1, 3, 2)
	wantCellNum(t, out, 2, 3, 3)
	wantCellNum(t, out, 3, 3, 4)
}

func TestToRowByCol(t *testing.T) {
	// A1:B2 = 1,2 / 3,4 ; D1 = TOROW(A1:B2,0,TRUE) → column-major 1,3,2,4.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
		libFormula(0, 3, "=TOROW(A1:B2,0,TRUE)"),
	})
	wantCellNum(t, out, 0, 3, 1)
	wantCellNum(t, out, 0, 4, 3)
	wantCellNum(t, out, 0, 5, 2)
	wantCellNum(t, out, 0, 6, 4)
}

func TestChooseRows(t *testing.T) {
	// A1:A3 = 1,2,3 ; C1 = CHOOSEROWS(A1:A3, 3, 1) → 3, 1.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)),
		libFormula(0, 2, "=CHOOSEROWS(A1:A3,3,1)"),
	})
	wantCellNum(t, out, 0, 2, 3)
	wantCellNum(t, out, 1, 2, 1)
}

func TestChooseColsNegative(t *testing.T) {
	// A1:C1 = 1,2,3 ; A3 = CHOOSECOLS(A1:C1, -1) → 3 (last column).
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)), libCell(0, 2, float64(3)),
		libFormula(2, 0, "=CHOOSECOLS(A1:C1,-1)"),
	})
	wantCellNum(t, out, 2, 0, 3)
}

func TestTake(t *testing.T) {
	// A1:A4 = 1,2,3,4 ; C1 = TAKE(A1:A4, 2) → 1,2 ; TAKE(...,-1) → 4.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)), libCell(3, 0, float64(4)),
		libFormula(0, 2, "=TAKE(A1:A4,2)"),
		libFormula(0, 4, "=TAKE(A1:A4,-1)"),
	})
	wantCellNum(t, out, 0, 2, 1)
	wantCellNum(t, out, 1, 2, 2)
	wantCellNum(t, out, 0, 4, 4)
}

func TestDrop(t *testing.T) {
	// A1:A4 = 1,2,3,4 ; C1 = DROP(A1:A4, 1) → 2,3,4 ; DROP(...,-2) → 1,2.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)), libCell(3, 0, float64(4)),
		libFormula(0, 2, "=DROP(A1:A4,1)"),
		libFormula(0, 4, "=DROP(A1:A4,-2)"),
	})
	wantCellNum(t, out, 0, 2, 2)
	wantCellNum(t, out, 1, 2, 3)
	wantCellNum(t, out, 2, 2, 4)
	wantCellNum(t, out, 0, 4, 1)
	wantCellNum(t, out, 1, 4, 2)
}

func TestWrapRows(t *testing.T) {
	// WRAPROWS(SEQUENCE not needed) — A1:A5 = 1..5 ; C1 = WRAPROWS(A1:A5, 2) →
	// 1 2 / 3 4 / 5 #N/A.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)),
		libCell(3, 0, float64(4)), libCell(4, 0, float64(5)),
		libFormula(0, 2, "=WRAPROWS(A1:A5,2)"),
	})
	wantCellNum(t, out, 0, 2, 1)
	wantCellNum(t, out, 0, 3, 2)
	wantCellNum(t, out, 1, 2, 3)
	wantCellNum(t, out, 1, 3, 4)
	wantCellNum(t, out, 2, 2, 5)
}

func TestExpand(t *testing.T) {
	// A1 = 7 ; C1 = EXPAND(A1, 2, 2, 0) → 7 0 / 0 0.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(7)),
		libFormula(0, 2, "=EXPAND(A1,2,2,0)"),
	})
	wantCellNum(t, out, 0, 2, 7)
	wantCellNum(t, out, 0, 3, 0)
	wantCellNum(t, out, 1, 2, 0)
	wantCellNum(t, out, 1, 3, 0)
}

func TestArrayToText(t *testing.T) {
	cells := []FsCellData{
		cell(0, 0, 1), cell(0, 1, 2),
		cell(1, 0, 3), cell(1, 1, 4),
	}
	mustStr(t, eval(t, "ARRAYTOTEXT(A1:B2)", cells...), "1, 2, 3, 4")
	mustStr(t, eval(t, "ARRAYTOTEXT(A1:B2,1)", cells...), "{1,2;3,4}")
}
