package sheets

import "testing"

func TestSubtotal(t *testing.T) {
	cells := []FsCellData{
		libCell(0, 0, float64(10)), libCell(1, 0, float64(20)),
		libCell(2, 0, float64(30)), libCell(3, 0, float64(40)),
	}
	mustNum(t, eval(t, "SUBTOTAL(9,A1:A4)", cells...), 100)  // SUM
	mustNum(t, eval(t, "SUBTOTAL(1,A1:A4)", cells...), 25)   // AVERAGE
	mustNum(t, eval(t, "SUBTOTAL(4,A1:A4)", cells...), 40)   // MAX
	mustNum(t, eval(t, "SUBTOTAL(5,A1:A4)", cells...), 10)   // MIN
	mustNum(t, eval(t, "SUBTOTAL(2,A1:A4)", cells...), 4)    // COUNT
	mustNum(t, eval(t, "SUBTOTAL(109,A1:A4)", cells...), 100) // 100-range alias → SUM
}

func TestAggregate(t *testing.T) {
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(1, 0, float64(7)),
		libCell(2, 0, float64(1)), libCell(3, 0, float64(9)),
	}
	mustNum(t, eval(t, "AGGREGATE(9,0,A1:A4)", cells...), 20) // SUM
	mustNum(t, eval(t, "AGGREGATE(4,0,A1:A4)", cells...), 9)  // MAX
	mustNum(t, eval(t, "AGGREGATE(5,0,A1:A4)", cells...), 1)  // MIN
	mustNum(t, eval(t, "AGGREGATE(12,0,A1:A4)", cells...), 5) // MEDIAN
	// 14 = LARGE with k=2 → second largest = 7.
	mustNum(t, eval(t, "AGGREGATE(14,0,A1:A4,2)", cells...), 7)
	// 15 = SMALL with k=2 → second smallest = 3.
	mustNum(t, eval(t, "AGGREGATE(15,0,A1:A4,2)", cells...), 3)
}

func TestAggregateIgnoreErrors(t *testing.T) {
	// A2 holds a div0 error; option 6 ignores errors so SUM = 3+1 = 4.
	cells := []FsCellData{
		libCell(0, 0, float64(3)),
		libFormula(1, 0, "=1/0"),
		libCell(2, 0, float64(1)),
	}
	mustNum(t, eval(t, "AGGREGATE(9,6,A1:A3)", cells...), 4)
}

func TestSortN(t *testing.T) {
	// Two columns; sort by column 1 descending, take top 2 rows.
	cells := []FsCellData{
		libCell(0, 0, float64(3)), libCell(0, 1, "c"),
		libCell(1, 0, float64(9)), libCell(1, 1, "a"),
		libCell(2, 0, float64(1)), libCell(2, 1, "d"),
		libCell(3, 0, float64(7)), libCell(3, 1, "b"),
	}
	out := Recompute(append([]FsCellData{
		libFormula(0, 3, "=SORTN(A1:B4,2,0,1,FALSE)"),
	}, cells...))
	// Top 2 by col1 desc → 9 then 7.
	wantCellNum(t, out, 0, 3, 9)
	wantCellStr(t, out, 0, 4, "a")
	wantCellNum(t, out, 1, 3, 7)
	wantCellStr(t, out, 1, 4, "b")
}
