package sheets

import "testing"

func TestRegexMatch(t *testing.T) {
	mustBool(t, eval(t, `REGEXMATCH("a1b2","[0-9]")`), true)
	mustBool(t, eval(t, `REGEXMATCH("abc","[0-9]")`), false)
	mustBool(t, eval(t, `REGEXMATCH("Hello","^H.*o$")`), true)
	mustErr(t, eval(t, `REGEXMATCH("x","[")`), "#VALUE!") // bad regex
}

func TestRegexExtract(t *testing.T) {
	mustStr(t, eval(t, `REGEXEXTRACT("order id-42 done","\d+")`), "42")
	// First capture group when present.
	mustStr(t, eval(t, `REGEXEXTRACT("user@host.com","(\w+)@")`), "user")
	mustErr(t, eval(t, `REGEXEXTRACT("no digits","\d+")`), "#N/A")
}

func TestRegexReplace(t *testing.T) {
	mustStr(t, eval(t, `REGEXREPLACE("a1b2c3","[0-9]","X")`), "aXbXcX")
	mustStr(t, eval(t, `REGEXREPLACE("2026-06-16","(\d+)-(\d+)-(\d+)","$3/$2/$1")`), "16/06/2026")
}

func TestJoin(t *testing.T) {
	mustStr(t, eval(t, `JOIN("-",1,2,3)`), "1-2-3")
	mustStr(t, eval(t, `JOIN(", ","x","y","z")`), "x, y, z")
	// Range argument flattens.
	cells := []FsCellData{cell(0, 0, 1), cell(1, 0, 2), cell(2, 0, 3)}
	mustStr(t, eval(t, `JOIN("|",A1:A3)`, cells...), "1|2|3")
}

func TestSplit(t *testing.T) {
	// Default: split by each delimiter char, drop empties → a | b | c.
	out := Recompute([]FsCellData{libFormula(0, 0, `=SPLIT("a,b,c",",")`)})
	wantCellStr(t, out, 0, 0, "a")
	wantCellStr(t, out, 0, 1, "b")
	wantCellStr(t, out, 0, 2, "c")
}

func TestSplitRemoveEmpty(t *testing.T) {
	// "a,,b" with remove-empty default → a, b (the empty middle dropped).
	out := Recompute([]FsCellData{libFormula(0, 0, `=SPLIT("a,,b",",")`)})
	wantCellStr(t, out, 0, 0, "a")
	wantCellStr(t, out, 0, 1, "b")
	// With remove_empty=FALSE → a, "", b.
	out2 := Recompute([]FsCellData{libFormula(0, 0, `=SPLIT("a,,b",",",TRUE,FALSE)`)})
	wantCellStr(t, out2, 0, 0, "a")
	wantCellStr(t, out2, 0, 1, "")
	wantCellStr(t, out2, 0, 2, "b")
}

func TestFlatten(t *testing.T) {
	// A1:B2 = 1,2 / 3,4 ; FLATTEN → 1,2,3,4 down a column (row-major).
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
		libFormula(0, 3, "=FLATTEN(A1:B2)"),
	})
	wantCellNum(t, out, 0, 3, 1)
	wantCellNum(t, out, 1, 3, 2)
	wantCellNum(t, out, 2, 3, 3)
	wantCellNum(t, out, 3, 3, 4)
}
