package sheets

import "testing"

func TestLet(t *testing.T) {
	mustNum(t, eval(t, "LET(x,5,x+1)"), 6)
	mustNum(t, eval(t, "LET(x,2,y,3,x*y)"), 6)
	// Later bindings can reference earlier ones.
	mustNum(t, eval(t, "LET(a,10,b,a*2,a+b)"), 30)
}

func TestLambdaImmediate(t *testing.T) {
	mustNum(t, eval(t, "LAMBDA(x,x+1)(5)"), 6)
	mustNum(t, eval(t, "LAMBDA(a,b,a*b)(3,4)"), 12)
	// Bare lambda in a cell → #CALC!.
	mustErr(t, eval(t, "LAMBDA(x,x+1)"), "#CALC!")
	// Wrong arity → #VALUE!.
	mustErr(t, eval(t, "LAMBDA(x,x+1)(1,2)"), "#VALUE!")
}

func TestArrayExpandInAgg(t *testing.T) {
	// SUM over a spilled array now expands its cells (was previously only the anchor).
	mustNum(t, eval(t, "SUM(SEQUENCE(3))"), 6)
	mustNum(t, eval(t, "SUM(SEQUENCE(2,2))"), 10)
}

func TestMap(t *testing.T) {
	// A1:A3 = 1,2,3 ; MAP squares → 1,4,9 down a column.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)),
		libFormula(0, 3, "=MAP(A1:A3,LAMBDA(x,x*x))"),
	})
	wantCellNum(t, out, 0, 3, 1)
	wantCellNum(t, out, 1, 3, 4)
	wantCellNum(t, out, 2, 3, 9)
}

func TestReduce(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 1), cell(1, 0, 2), cell(2, 0, 3), cell(3, 0, 4)}
	mustNum(t, eval(t, "REDUCE(0,A1:A4,LAMBDA(acc,x,acc+x))", cells...), 10)
	mustNum(t, eval(t, "REDUCE(1,A1:A4,LAMBDA(acc,x,acc*x))", cells...), 24)
}

func TestScan(t *testing.T) {
	// Running sum of 1,2,3 → 1,3,6.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)),
		libFormula(0, 3, "=SCAN(0,A1:A3,LAMBDA(acc,x,acc+x))"),
	})
	wantCellNum(t, out, 0, 3, 1)
	wantCellNum(t, out, 1, 3, 3)
	wantCellNum(t, out, 2, 3, 6)
}

func TestByRow(t *testing.T) {
	// A1:B2 = 1,2 / 3,4 ; BYROW sum → 3, 7 down a column.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
		libFormula(0, 3, "=BYROW(A1:B2,LAMBDA(r,SUM(r)))"),
	})
	wantCellNum(t, out, 0, 3, 3)
	wantCellNum(t, out, 1, 3, 7)
}

func TestByCol(t *testing.T) {
	// A1:B2 = 1,2 / 3,4 ; BYCOL sum → 4, 6 across a row.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
		libFormula(0, 3, "=BYCOL(A1:B2,LAMBDA(c,SUM(c)))"),
	})
	wantCellNum(t, out, 0, 3, 4)
	wantCellNum(t, out, 0, 4, 6)
}

func TestMakeArray(t *testing.T) {
	// MAKEARRAY(2,2, r*10+c) → 11 12 / 21 22.
	out := Recompute([]FsCellData{
		libFormula(0, 0, "=MAKEARRAY(2,2,LAMBDA(r,c,r*10+c))"),
	})
	wantCellNum(t, out, 0, 0, 11)
	wantCellNum(t, out, 0, 1, 12)
	wantCellNum(t, out, 1, 0, 21)
	wantCellNum(t, out, 1, 1, 22)
}

func TestLetWithLambdaClosure(t *testing.T) {
	// A named lambda bound by LET, then applied via MAP (closure capture).
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(2)), libCell(1, 0, float64(3)), libCell(2, 0, float64(4)),
		libFormula(0, 3, "=LET(sq,LAMBDA(x,x*x),MAP(A1:A3,sq))"),
	})
	wantCellNum(t, out, 0, 3, 4)
	wantCellNum(t, out, 1, 3, 9)
	wantCellNum(t, out, 2, 3, 16)
}
