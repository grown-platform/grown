package sheets

import "testing"

// data grid for QUERY tests (no header row):
//   A     B      C
//   apple 5      red
//   banana 3     yellow
//   cherry 8     red
//   date  2      brown
func queryData() []FsCellData {
	rows := [][]interface{}{
		{"apple", 5.0, "red"},
		{"banana", 3.0, "yellow"},
		{"cherry", 8.0, "red"},
		{"date", 2.0, "brown"},
	}
	var cells []FsCellData
	for r, row := range rows {
		for c, v := range row {
			cells = append(cells, libCell(r, c, v))
		}
	}
	return cells
}

func TestQuerySelectWhere(t *testing.T) {
	// select A, B where B > 3  → apple/5, cherry/8
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select A, B where B > 3")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "apple")
	wantCellNum(t, out, 0, 6, 5)
	wantCellStr(t, out, 1, 5, "cherry")
	wantCellNum(t, out, 1, 6, 8)
}

func TestQueryWhereContains(t *testing.T) {
	// select A where C contains 'red'  → apple, cherry (red); 'red' substring only
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select A where C contains 'red'")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "apple")
	wantCellStr(t, out, 1, 5, "cherry")
}

func TestQueryOrderLimit(t *testing.T) {
	// select A, B order by B desc limit 2 → cherry/8, apple/5
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select A, B order by B desc limit 2")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "cherry")
	wantCellNum(t, out, 0, 6, 8)
	wantCellStr(t, out, 1, 5, "apple")
	wantCellNum(t, out, 1, 6, 5)
}

func TestQueryGroupBySum(t *testing.T) {
	// select C, sum(B) group by C → brown/2, red/13, yellow/3 (group order by first
	// appearance: red, yellow, brown).
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select C, sum(B) group by C")`),
	}, queryData()...))
	// red appears first (row0), then yellow (row1), then brown (row3)
	wantCellStr(t, out, 0, 5, "red")
	wantCellNum(t, out, 0, 6, 13)
	wantCellStr(t, out, 1, 5, "yellow")
	wantCellNum(t, out, 1, 6, 3)
	wantCellStr(t, out, 2, 5, "brown")
	wantCellNum(t, out, 2, 6, 2)
}

func TestQuerySelectStar(t *testing.T) {
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select * where A = 'date'")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "date")
	wantCellNum(t, out, 0, 6, 2)
	wantCellStr(t, out, 0, 7, "brown")
}

func TestQueryAndOr(t *testing.T) {
	// where B > 2 and C = 'red' → apple(5,red), cherry(8,red)
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select A where B > 2 and C = 'red'")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "apple")
	wantCellStr(t, out, 1, 5, "cherry")
}

func TestQueryOrderByUnselectedColumn(t *testing.T) {
	// select A where B > 3 order by B desc → cherry(8) before apple(5), even
	// though B is not in the SELECT list.
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select A where B > 3 order by B desc")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "cherry")
	wantCellStr(t, out, 1, 5, "apple")
}

func TestQueryGroupOrderBy(t *testing.T) {
	// select C, sum(B) group by C order by C → brown, red, yellow (alphabetical).
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select C, sum(B) group by C order by C")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "brown")
	wantCellNum(t, out, 0, 6, 2)
	wantCellStr(t, out, 1, 5, "red")
	wantCellNum(t, out, 1, 6, 13)
	wantCellStr(t, out, 2, 5, "yellow")
	wantCellNum(t, out, 2, 6, 3)
}

func TestQueryCountGroup(t *testing.T) {
	// select C, count(A) group by C → red:2, yellow:1, brown:1
	out := Recompute(append([]FsCellData{
		libFormula(0, 5, `=QUERY(A1:C4,"select C, count(A) group by C")`),
	}, queryData()...))
	wantCellStr(t, out, 0, 5, "red")
	wantCellNum(t, out, 0, 6, 2)
}
