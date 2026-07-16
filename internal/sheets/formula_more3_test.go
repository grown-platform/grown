package sheets

import (
	"math"
	"testing"
)

// arrCells asserts v is a spilled array and returns its 2D cells.
func arrCells(t *testing.T, v value) [][]value {
	t.Helper()
	if v.isErr() {
		t.Fatalf("got error %q, want array", v.str)
	}
	if v.kind != kindArray || v.arr == nil {
		t.Fatalf("got kind %d, want array", v.kind)
	}
	return v.arr.cells
}

// wantGrid compares a spilled array against an expected grid of float64/string.
func wantGrid(t *testing.T, v value, want [][]interface{}) {
	t.Helper()
	cells := arrCells(t, v)
	if len(cells) != len(want) {
		t.Fatalf("rows: got %d want %d", len(cells), len(want))
	}
	for r := range want {
		if len(cells[r]) != len(want[r]) {
			t.Fatalf("row %d cols: got %d want %d", r, len(cells[r]), len(want[r]))
		}
		for cc := range want[r] {
			got := cells[r][cc]
			switch exp := want[r][cc].(type) {
			case float64:
				n, ok := got.toNum()
				if !ok || math.Abs(n-exp) > 1e-9 {
					t.Fatalf("cell[%d][%d] = %q, want %g", r, cc, got.toStr(), exp)
				}
			case string:
				if got.toStr() != exp {
					t.Fatalf("cell[%d][%d] = %q, want %q", r, cc, got.toStr(), exp)
				}
			default:
				t.Fatalf("unsupported expectation type %T", exp)
			}
		}
	}
}

func TestGroupBy(t *testing.T) {
	// A1:A4 = x,y,x,y ; B1:B4 = 1,2,3,4 ; sum per key.
	cells := []FsCellData{
		scell(0, 0, "x"), scell(1, 0, "y"), scell(2, 0, "x"), scell(3, 0, "y"),
		cell(0, 1, 1), cell(1, 1, 2), cell(2, 1, 3), cell(3, 1, 4),
	}
	wantGrid(t, eval(t, "GROUPBY(A1:A4,B1:B4,LAMBDA(v,SUM(v)))", cells...),
		[][]interface{}{{"x", 4.0}, {"y", 6.0}})
	// A different reducer (COUNT) over the same grouping.
	wantGrid(t, eval(t, "GROUPBY(A1:A4,B1:B4,LAMBDA(v,COUNT(v)))", cells...),
		[][]interface{}{{"x", 2.0}, {"y", 2.0}})
}

func TestGroupByMultiCol(t *testing.T) {
	// values span two columns B:C → one aggregate per column.
	cells := []FsCellData{
		scell(0, 0, "x"), scell(1, 0, "y"), scell(2, 0, "x"),
		cell(0, 1, 1), cell(1, 1, 2), cell(2, 1, 3),
		cell(0, 2, 10), cell(1, 2, 20), cell(2, 2, 30),
	}
	wantGrid(t, eval(t, "GROUPBY(A1:A3,B1:C3,LAMBDA(v,SUM(v)))", cells...),
		[][]interface{}{{"x", 4.0, 40.0}, {"y", 2.0, 20.0}})
}

func TestGroupByNumericKeysSorted(t *testing.T) {
	// Numeric keys emerge in ascending order regardless of input order.
	cells := []FsCellData{
		cell(0, 0, 3), cell(1, 0, 1), cell(2, 0, 3), cell(3, 0, 1),
		cell(0, 1, 5), cell(1, 1, 6), cell(2, 1, 7), cell(3, 1, 8),
	}
	wantGrid(t, eval(t, "GROUPBY(A1:A4,B1:B4,LAMBDA(v,SUM(v)))", cells...),
		[][]interface{}{{1.0, 14.0}, {3.0, 12.0}})
}

func TestGroupBySpillEndToEnd(t *testing.T) {
	// End-to-end through Recompute: the result spills into D1:E2.
	out := Recompute([]FsCellData{
		libCell(0, 0, "x"), libCell(1, 0, "y"), libCell(2, 0, "x"),
		libCell(0, 1, float64(1)), libCell(1, 1, float64(2)), libCell(2, 1, float64(3)),
		libFormula(0, 3, "=GROUPBY(A1:A3,B1:B3,LAMBDA(v,SUM(v)))"),
	})
	wantCellStr(t, out, 0, 3, "x")
	wantCellNum(t, out, 0, 4, 4)
	wantCellStr(t, out, 1, 3, "y")
	wantCellNum(t, out, 1, 4, 2)
}

func TestGroupByErrors(t *testing.T) {
	cells := []FsCellData{
		scell(0, 0, "x"), scell(1, 0, "y"),
		cell(0, 1, 1), cell(1, 1, 2),
	}
	// Too few args → #N/A.
	mustErr(t, eval(t, "GROUPBY(A1:A2,B1:B2)", cells...), "#N/A")
	// Non-lambda third arg → #VALUE!.
	mustErr(t, eval(t, "GROUPBY(A1:A2,B1:B2,5)", cells...), "#VALUE!")
	// Multi-column key range → #VALUE!.
	mustErr(t, eval(t, "GROUPBY(A1:B2,B1:B2,LAMBDA(v,SUM(v)))", cells...), "#VALUE!")
}

func TestPivotBy(t *testing.T) {
	// region × quarter, summing amounts.
	cells := []FsCellData{
		scell(0, 0, "east"), scell(1, 0, "west"), scell(2, 0, "east"), scell(3, 0, "west"),
		scell(0, 1, "q1"), scell(1, 1, "q1"), scell(2, 1, "q2"), scell(3, 1, "q2"),
		cell(0, 2, 1), cell(1, 2, 2), cell(2, 2, 3), cell(3, 2, 4),
	}
	wantGrid(t, eval(t, "PIVOTBY(A1:A4,B1:B4,C1:C4,LAMBDA(v,SUM(v)))", cells...),
		[][]interface{}{
			{"", "q1", "q2"},
			{"east", 1.0, 3.0},
			{"west", 2.0, 4.0},
		})
}

func TestPivotByEmptyCell(t *testing.T) {
	// (b,y) has no data → blank interior cell.
	cells := []FsCellData{
		scell(0, 0, "a"), scell(1, 0, "a"), scell(2, 0, "b"),
		scell(0, 1, "x"), scell(1, 1, "y"), scell(2, 1, "x"),
		cell(0, 2, 5), cell(1, 2, 6), cell(2, 2, 7),
	}
	wantGrid(t, eval(t, "PIVOTBY(A1:A3,B1:B3,C1:C3,LAMBDA(v,SUM(v)))", cells...),
		[][]interface{}{
			{"", "x", "y"},
			{"a", 5.0, 6.0},
			{"b", 7.0, ""},
		})
}

func TestPivotByErrors(t *testing.T) {
	cells := []FsCellData{
		scell(0, 0, "a"), scell(0, 1, "x"), cell(0, 2, 5),
	}
	// Too few args → #N/A.
	mustErr(t, eval(t, "PIVOTBY(A1:A1,B1:B1,C1:C1)", cells...), "#N/A")
	// Non-lambda final arg → #VALUE!.
	mustErr(t, eval(t, "PIVOTBY(A1:A1,B1:B1,C1:C1,7)", cells...), "#VALUE!")
}
