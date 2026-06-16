package sheets

import "testing"

func TestArrayConstantInAggregate(t *testing.T) {
	// {1,2,3,4} flattens into SUM.
	mustNum(t, eval(t, "SUM({1,2,3,4})"), 10)
	mustNum(t, eval(t, "AVERAGE({2,4,6})"), 4)
	// Two-row constant {1,2;3,4} → 1+2+3+4 = 10.
	mustNum(t, eval(t, "SUM({1,2;3,4})"), 10)
}

func TestArrayConstantStrings(t *testing.T) {
	// JOIN over a string array constant.
	mustStr(t, eval(t, `TEXTJOIN("-",TRUE,{"a","b","c"})`), "a-b-c")
}

func TestArrayConstantSpill(t *testing.T) {
	// A bare array constant spills across cells.
	out := Recompute([]FsCellData{libFormula(0, 0, "={10,20;30,40}")})
	wantCellNum(t, out, 0, 0, 10)
	wantCellNum(t, out, 0, 1, 20)
	wantCellNum(t, out, 1, 0, 30)
	wantCellNum(t, out, 1, 1, 40)
}

func TestArrayConstantSparklineOption(t *testing.T) {
	// Now that {} literals parse, SPARKLINE inline options work like Sheets.
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(0, 1, float64(-2)),
	}
	mustStr(t, eval(t, `SPARKLINE(A1:B1,{"charttype","winloss"})`, cells...), "▀▄")
}
