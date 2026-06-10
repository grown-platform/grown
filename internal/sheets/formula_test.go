package sheets

import (
	"math"
	"strings"
	"testing"
	"time"
)

// ---- helpers ----------------------------------------------------------------

func eval(t *testing.T, expr string, cells ...FsCellData) value {
	t.Helper()
	ev := &Evaluator{
		grid:    newGrid(cells),
		results: make(map[cellAddr]value),
		now:     time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC),
	}
	return ev.evalExpr(expr)
}

func mustNum(t *testing.T, v value, want float64) {
	t.Helper()
	if v.isErr() {
		t.Fatalf("got error %q, want %g", v.str, want)
	}
	if v.kind != kindNum && v.kind != kindBool {
		t.Fatalf("got kind %d, want num/bool", v.kind)
	}
	if math.Abs(v.num-want) > 1e-9 {
		t.Fatalf("got %g, want %g", v.num, want)
	}
}

func mustStr(t *testing.T, v value, want string) {
	t.Helper()
	if v.isErr() {
		t.Fatalf("got error %q, want %q", v.str, want)
	}
	if v.toStr() != want {
		t.Fatalf("got %q, want %q", v.toStr(), want)
	}
}

func mustErr(t *testing.T, v value, want string) {
	t.Helper()
	if !v.isErr() {
		t.Fatalf("got %q (kind %d), want error %q", v.toStr(), v.kind, want)
	}
	if v.str != want {
		t.Fatalf("got error %q, want %q", v.str, want)
	}
}

func mustBool(t *testing.T, v value, want bool) {
	t.Helper()
	if v.isErr() {
		t.Fatalf("got error %q, want bool %v", v.str, want)
	}
	got := v.isTruthy()
	if got != want {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// cell returns a FsCellData with a numeric value at (r,c).
func cell(r, c int, v float64) FsCellData {
	return FsCellData{R: r, C: c, V: &FsCell{V: v}}
}

// scell returns a FsCellData with a string value at (r,c).
func scell(r, c int, s string) FsCellData {
	return FsCellData{R: r, C: c, V: &FsCell{V: s}}
}

// fcell returns a FsCellData with a formula at (r,c) and an initial raw value.
func fcell(r, c int, formula string) FsCellData {
	return FsCellData{R: r, C: c, V: &FsCell{F: "=" + formula}}
}

// ---- numeric literals -------------------------------------------------------

func TestLiterals(t *testing.T) {
	mustNum(t, eval(t, "42"), 42)
	mustNum(t, eval(t, "3.14"), 3.14)
	mustNum(t, eval(t, "1e3"), 1000)
	mustNum(t, eval(t, "1.5e-2"), 0.015)
	mustStr(t, eval(t, `"hello"`), "hello")
	mustStr(t, eval(t, `"it""s"`), `it"s`) // escaped quote
	mustBool(t, eval(t, "TRUE"), true)
	mustBool(t, eval(t, "FALSE"), false)
	mustBool(t, eval(t, "true"), true) // case-insensitive
	mustBool(t, eval(t, "false"), false)
}

// ---- arithmetic operators ---------------------------------------------------

func TestArithmetic(t *testing.T) {
	mustNum(t, eval(t, "2+3"), 5)
	mustNum(t, eval(t, "10-4"), 6)
	mustNum(t, eval(t, "3*4"), 12)
	mustNum(t, eval(t, "10/4"), 2.5)
	mustNum(t, eval(t, "2^10"), 1024)
	mustNum(t, eval(t, "-5"), -5)
	mustNum(t, eval(t, "--5"), 5)
	mustNum(t, eval(t, "+3"), 3)
	mustErr(t, eval(t, "1/0"), "#DIV/0!")
}

func TestOperatorPrecedence(t *testing.T) {
	// 2+3*4 = 14 (not 20)
	mustNum(t, eval(t, "2+3*4"), 14)
	// 2^3^2 = 2^(3^2) = 2^9 = 512? No: ^ is left-assoc in our parser.
	// 2^3 = 8, 8^2 = 64
	mustNum(t, eval(t, "2^3^2"), 64) // left-associative
	// (2+3)*4 = 20
	mustNum(t, eval(t, "(2+3)*4"), 20)
	// -2^2 = (-2)^2 = 4 (unary applied before power in our grammar: unary > power)
	mustNum(t, eval(t, "-2^2"), 4)
	// 6/2*3 = 9 (left-to-right)
	mustNum(t, eval(t, "6/2*3"), 9)
}

func TestPower(t *testing.T) {
	mustNum(t, eval(t, "4^0.5"), 2)
	mustNum(t, eval(t, "27^(1/3)"), 3)
	mustNum(t, eval(t, "0^0"), 1)
	mustErr(t, eval(t, "(-1)^0.5"), "#NUM!") // imaginary
}

// ---- comparisons ------------------------------------------------------------

func TestComparisons(t *testing.T) {
	mustBool(t, eval(t, "1=1"), true)
	mustBool(t, eval(t, "1=2"), false)
	mustBool(t, eval(t, "1<>2"), true)
	mustBool(t, eval(t, "1<>1"), false)
	mustBool(t, eval(t, "1<2"), true)
	mustBool(t, eval(t, "2<1"), false)
	mustBool(t, eval(t, "1<=1"), true)
	mustBool(t, eval(t, "1>=2"), false)
	mustBool(t, eval(t, "2>1"), true)
	mustBool(t, eval(t, `"a"="a"`), true)
	mustBool(t, eval(t, `"a"="A"`), true) // case-insensitive string compare
	mustBool(t, eval(t, `"b">"a"`), true)
}

// ---- string concat ----------------------------------------------------------

func TestConcat(t *testing.T) {
	mustStr(t, eval(t, `"hello"&" "&"world"`), "hello world")
	mustStr(t, eval(t, `"abc"&123`), "abc123")
	mustStr(t, eval(t, `42&" items"`), "42 items")
}

// ---- cell references --------------------------------------------------------

func TestCellRef(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 10), cell(0, 1, 20)} // A1=10, B1=20
	mustNum(t, eval(t, "A1", cells...), 10)
	mustNum(t, eval(t, "B1", cells...), 20)
	mustNum(t, eval(t, "A1+B1", cells...), 30)
}

func TestAbsoluteCellRef(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 7)} // A1=7
	mustNum(t, eval(t, "$A$1", cells...), 7)
	mustNum(t, eval(t, "$A1", cells...), 7)
	mustNum(t, eval(t, "A$1", cells...), 7)
}

func TestEmptyCellIsZero(t *testing.T) {
	// No cells defined; refs resolve to 0.
	mustNum(t, eval(t, "A1+B1"), 0)
}

func TestCellRefLetterVariants(t *testing.T) {
	// Z column (index 25), row 1
	cells := []FsCellData{cell(0, 25, 99)}
	mustNum(t, eval(t, "Z1", cells...), 99)
	// AA column (index 26), row 2
	cells2 := []FsCellData{cell(1, 26, 88)}
	mustNum(t, eval(t, "AA2", cells2...), 88)
}

// ---- SUM --------------------------------------------------------------------

func TestSUM(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 1), cell(1, 0, 2), cell(2, 0, 3)} // A1:A3 = 1,2,3
	mustNum(t, eval(t, "SUM(A1:A3)", cells...), 6)
	mustNum(t, eval(t, "SUM(A1,A2,A3)", cells...), 6)
	mustNum(t, eval(t, "SUM(1,2,3)"), 6)
	mustNum(t, eval(t, "SUM()"), 0) // empty
}

func TestSUMSkipsStrings(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 1), scell(1, 0, "text"), cell(2, 0, 3)}
	mustNum(t, eval(t, "SUM(A1:A3)", cells...), 4)
}

func TestSUMRange2D(t *testing.T) {
	// A1:B2 = 1,2,3,4
	cells := []FsCellData{cell(0, 0, 1), cell(0, 1, 2), cell(1, 0, 3), cell(1, 1, 4)}
	mustNum(t, eval(t, "SUM(A1:B2)", cells...), 10)
}

// ---- AVERAGE ----------------------------------------------------------------

func TestAVERAGE(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 10), cell(1, 0, 20), cell(2, 0, 30)}
	mustNum(t, eval(t, "AVERAGE(A1:A3)", cells...), 20)
	mustErr(t, eval(t, "AVERAGE()"), "#DIV/0!") // no numeric args
}

// ---- MIN / MAX --------------------------------------------------------------

func TestMINMAX(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 5), cell(1, 0, 2), cell(2, 0, 8)}
	mustNum(t, eval(t, "MIN(A1:A3)", cells...), 2)
	mustNum(t, eval(t, "MAX(A1:A3)", cells...), 8)
	mustNum(t, eval(t, "MIN(10,20,5)"), 5)
	mustNum(t, eval(t, "MAX(10,20,5)"), 20)
}

func TestMINMAXEmpty(t *testing.T) {
	mustNum(t, eval(t, "MIN()"), 0)
	mustNum(t, eval(t, "MAX()"), 0)
}

// ---- COUNT / COUNTA ---------------------------------------------------------

func TestCOUNT(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 1), scell(1, 0, "text"), cell(2, 0, 3)}
	mustNum(t, eval(t, "COUNT(A1:A3)", cells...), 2) // only numerics
	mustNum(t, eval(t, "COUNTA(A1:A3)", cells...), 3)
}

func TestCOUNTNumbers(t *testing.T) {
	mustNum(t, eval(t, "COUNT(1,2,3)"), 3)
	mustNum(t, eval(t, `COUNT(1,"a",3)`), 2)
}

func TestCOUNTA(t *testing.T) {
	mustNum(t, eval(t, `COUNTA("a","b","c")`), 3)
	mustNum(t, eval(t, "COUNTA()"), 0)
}

// ---- IF ---------------------------------------------------------------------

func TestIF(t *testing.T) {
	mustNum(t, eval(t, "IF(TRUE,1,2)"), 1)
	mustNum(t, eval(t, "IF(FALSE,1,2)"), 2)
	mustNum(t, eval(t, "IF(1>0,42,0)"), 42)
	mustNum(t, eval(t, "IF(1<0,42,0)"), 0)
	mustBool(t, eval(t, "IF(FALSE,1)"), false) // no else → FALSE
}

func TestIFNestedCellRef(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 10)}
	mustStr(t, eval(t, `IF(A1>5,"big","small")`, cells...), "big")
}

// ---- AND / OR / NOT ---------------------------------------------------------

func TestAND(t *testing.T) {
	mustBool(t, eval(t, "AND(TRUE,TRUE)"), true)
	mustBool(t, eval(t, "AND(TRUE,FALSE)"), false)
	mustBool(t, eval(t, "AND(1,1,1)"), true)
	mustBool(t, eval(t, "AND(1,0)"), false)
	mustErr(t, eval(t, "AND()"), "#N/A")
}

func TestOR(t *testing.T) {
	mustBool(t, eval(t, "OR(FALSE,TRUE)"), true)
	mustBool(t, eval(t, "OR(FALSE,FALSE)"), false)
	mustBool(t, eval(t, "OR(0,0)"), false)
	mustErr(t, eval(t, "OR()"), "#N/A")
}

func TestNOT(t *testing.T) {
	mustBool(t, eval(t, "NOT(TRUE)"), false)
	mustBool(t, eval(t, "NOT(FALSE)"), true)
	mustBool(t, eval(t, "NOT(0)"), true)
	mustBool(t, eval(t, "NOT(1)"), false)
}

// ---- ROUND ------------------------------------------------------------------

func TestROUND(t *testing.T) {
	mustNum(t, eval(t, "ROUND(3.14159,2)"), 3.14)
	mustNum(t, eval(t, "ROUND(3.145,2)"), 3.15) // round half up
	mustNum(t, eval(t, "ROUND(1234,-2)"), 1200)
	mustNum(t, eval(t, "ROUND(1.5,0)"), 2)
	mustNum(t, eval(t, "ROUND(-1.5,0)"), -2)
}

// ---- ABS --------------------------------------------------------------------

func TestABS(t *testing.T) {
	mustNum(t, eval(t, "ABS(-5)"), 5)
	mustNum(t, eval(t, "ABS(5)"), 5)
	mustNum(t, eval(t, "ABS(0)"), 0)
}

// ---- String functions -------------------------------------------------------

func TestCONCATENATE(t *testing.T) {
	mustStr(t, eval(t, `CONCATENATE("foo","bar")`), "foobar")
	mustStr(t, eval(t, `CONCATENATE("a","b","c","d")`), "abcd")
	cells := []FsCellData{scell(0, 0, "hello")}
	mustStr(t, eval(t, `CONCATENATE(A1," world")`, cells...), "hello world")
}

func TestLEN(t *testing.T) {
	mustNum(t, eval(t, `LEN("hello")`), 5)
	mustNum(t, eval(t, `LEN("")`), 0)
	mustNum(t, eval(t, `LEN(123)`), 3)
}

func TestLEFT(t *testing.T) {
	mustStr(t, eval(t, `LEFT("hello",3)`), "hel")
	mustStr(t, eval(t, `LEFT("hi",10)`), "hi") // longer than string → whole string
	mustStr(t, eval(t, `LEFT("hello")`), "h")  // default 1
}

func TestRIGHT(t *testing.T) {
	mustStr(t, eval(t, `RIGHT("hello",3)`), "llo")
	mustStr(t, eval(t, `RIGHT("hi",10)`), "hi")
	mustStr(t, eval(t, `RIGHT("hello")`), "o")
}

func TestMID(t *testing.T) {
	mustStr(t, eval(t, `MID("hello",2,3)`), "ell")
	mustStr(t, eval(t, `MID("hello",4,10)`), "lo")
	mustStr(t, eval(t, `MID("hello",10,3)`), "") // start beyond end
	mustErr(t, eval(t, `MID("hello",-1,3)`), "#VALUE!")
}

func TestStringFunctionsWithCellRefs(t *testing.T) {
	cells := []FsCellData{scell(0, 0, "HELLO")}
	mustNum(t, eval(t, "LEN(A1)", cells...), 5)
	mustStr(t, eval(t, "LEFT(A1,3)", cells...), "HEL")
}

// ---- TODAY / NOW ------------------------------------------------------------

func TestTODAY(t *testing.T) {
	// 2026-03-15 → days since 1899-12-30 (Excel epoch)
	// Known Excel serial for 2026-03-15: 46105
	v := eval(t, "TODAY()")
	n, ok := v.toNum()
	if !ok {
		t.Fatalf("TODAY() returned non-numeric: %v", v)
	}
	if n < 45000 || n > 50000 {
		t.Fatalf("TODAY() = %g, looks wrong for 2026", n)
	}
}

func TestNOW(t *testing.T) {
	v := eval(t, "NOW()")
	n, ok := v.toNum()
	if !ok {
		t.Fatalf("NOW() returned non-numeric: %v", v)
	}
	// NOW has a fractional part (time of day).
	if n == math.Trunc(n) {
		t.Fatalf("NOW() = %g has no fractional day part", n)
	}
}

// ---- Error propagation ------------------------------------------------------

func TestErrorPropagation(t *testing.T) {
	// Test formula-to-formula error propagation via Recompute:
	// A1 = =1/0 → #DIV/0!, A2 = =A1+1 should also become #DIV/0!.
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{F: "=1/0"}},  // A1: #DIV/0!
		{R: 1, C: 0, V: &FsCell{F: "=A1+1"}}, // A2: references A1
	}
	result := Recompute(data)
	a2 := result[1].V
	if a2 == nil {
		t.Fatal("A2 result is nil")
	}
	if a2.M != "#DIV/0!" {
		t.Fatalf("A2 should propagate #DIV/0!, got %q", a2.M)
	}
}

func TestDivisionByZero(t *testing.T) {
	mustErr(t, eval(t, "5/0"), "#DIV/0!")
	mustErr(t, eval(t, "0/0"), "#DIV/0!")
}

func TestUnknownFunction(t *testing.T) {
	mustErr(t, eval(t, "NOSUCHFUNC(1,2)"), "#NAME?")
}

func TestTypeCoercionErrors(t *testing.T) {
	mustErr(t, eval(t, `"a"+1`), "#VALUE!")
	mustErr(t, eval(t, `"a"*2`), "#VALUE!")
}

// ---- Nested formulas --------------------------------------------------------

func TestNestedFormulas(t *testing.T) {
	mustNum(t, eval(t, "SUM(1,MAX(2,3),MIN(4,5))"), 8)      // 1+3+4=8
	mustNum(t, eval(t, "IF(AND(1<2,2<3),SUM(1,2,3),0)"), 6) // true branch
	mustNum(t, eval(t, "ROUND(AVERAGE(1,2,3),1)"), 2)       // AVERAGE=2, ROUND=2.0
	mustStr(t, eval(t, `CONCATENATE(LEFT("hello",3),RIGHT("world",3))`), "helrld")
}

func TestDeepNesting(t *testing.T) {
	// IF(IF(TRUE,1,0)=1, ABS(-42), 0)
	mustNum(t, eval(t, "IF(IF(TRUE,1,0)=1,ABS(-42),0)"), 42)
}

// ---- Dependency graph and topological ordering ------------------------------

func TestDependencyOrder(t *testing.T) {
	// C1 depends on B1, B1 depends on A1.
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{V: 5.0}},     // A1 = 5
		{R: 0, C: 1, V: &FsCell{F: "=A1*2"}}, // B1 = A1*2 = 10
		{R: 0, C: 2, V: &FsCell{F: "=B1+3"}}, // C1 = B1+3 = 13
	}
	result := Recompute(data)
	// Find C1
	var c1 *FsCell
	for _, cd := range result {
		if cd.R == 0 && cd.C == 2 {
			c1 = cd.V
		}
	}
	if c1 == nil {
		t.Fatal("C1 not found")
	}
	if c1.M != "13" {
		t.Fatalf("C1 = %q, want 13", c1.M)
	}
}

func TestSUMAfterFormulaCell(t *testing.T) {
	// A1=5, A2=formula A1*2 (=10), A3=formula SUM(A1:A2) (=15)
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{V: 5.0}},
		{R: 1, C: 0, V: &FsCell{F: "=A1*2"}},
		{R: 2, C: 0, V: &FsCell{F: "=SUM(A1:A2)"}},
	}
	result := Recompute(data)
	for _, cd := range result {
		if cd.R == 2 && cd.C == 0 {
			if cd.V.M != "15" {
				t.Fatalf("A3 = %q, want 15", cd.V.M)
			}
			return
		}
	}
	t.Fatal("A3 not found in result")
}

func TestMultiSheetRecompute(t *testing.T) {
	// Two sheets: verify each is evaluated independently.
	data := `[
		{"name":"Sheet1","id":"s1","celldata":[{"r":0,"c":0,"v":{"f":"=1+1"}},{"r":0,"c":1,"v":{"v":5.0}}]},
		{"name":"Sheet2","id":"s2","celldata":[{"r":0,"c":0,"v":{"f":"=3*3"}}]}
	]`
	out := RecomputeWorkbook(data)
	if !strings.Contains(out, `"m":"2"`) {
		t.Errorf("Sheet1 A1 should have m=2, got: %s", out)
	}
	if !strings.Contains(out, `"m":"9"`) {
		t.Errorf("Sheet2 A1 should have m=9, got: %s", out)
	}
}

// ---- Circular reference detection ------------------------------------------

func TestCircularReference_Direct(t *testing.T) {
	// A1 = =A1 (self-reference)
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{F: "=A1"}},
	}
	result := Recompute(data)
	if result[0].V.M != "#CIRC!" {
		t.Fatalf("A1 self-ref should be #CIRC!, got %q", result[0].V.M)
	}
}

func TestCircularReference_TwoCell(t *testing.T) {
	// A1 = =B1, B1 = =A1
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{F: "=B1"}},
		{R: 0, C: 1, V: &FsCell{F: "=A1"}},
	}
	result := Recompute(data)
	for _, cd := range result {
		if cd.V.M != "#CIRC!" {
			t.Fatalf("cell (%d,%d) should be #CIRC!, got %q", cd.R, cd.C, cd.V.M)
		}
	}
}

func TestCircularReference_ThreeCell(t *testing.T) {
	// A1→B1→C1→A1 cycle
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{F: "=C1"}},
		{R: 0, C: 1, V: &FsCell{F: "=A1"}},
		{R: 0, C: 2, V: &FsCell{F: "=B1"}},
	}
	result := Recompute(data)
	for _, cd := range result {
		if cd.V.M != "#CIRC!" {
			t.Fatalf("cell (%d,%d) in 3-cycle should be #CIRC!, got %q", cd.R, cd.C, cd.V.M)
		}
	}
}

func TestNonCircularNotAffected(t *testing.T) {
	// A1=1 (literal), B1=A1+1 (not circular), C1=B1*2
	data := []FsCellData{
		{R: 0, C: 0, V: &FsCell{V: 1.0}},
		{R: 0, C: 1, V: &FsCell{F: "=A1+1"}},
		{R: 0, C: 2, V: &FsCell{F: "=B1*2"}},
	}
	result := Recompute(data)
	for _, cd := range result {
		if cd.R == 0 && cd.C == 1 && cd.V.M != "2" {
			t.Fatalf("B1 = %q, want 2", cd.V.M)
		}
		if cd.R == 0 && cd.C == 2 && cd.V.M != "4" {
			t.Fatalf("C1 = %q, want 4", cd.V.M)
		}
	}
}

// ---- Recompute preserves extra cell fields ----------------------------------

func TestRecomputePreservesExtraFields(t *testing.T) {
	import_json := `[{"name":"Sheet1","id":"s1","celldata":[
		{"r":0,"c":0,"v":{"f":"=2+2","fc":"#FF0000","bl":1}}
	]}]`
	out := RecomputeWorkbook(import_json)
	if !strings.Contains(out, `"fc":"#FF0000"`) {
		t.Errorf("extra field fc lost: %s", out)
	}
	if !strings.Contains(out, `"bl":1`) {
		t.Errorf("extra field bl lost: %s", out)
	}
	if !strings.Contains(out, `"m":"4"`) {
		t.Errorf("computed m not written: %s", out)
	}
}

// ---- colIndex / rowIndex / addrToName helpers --------------------------------

func TestColIndex(t *testing.T) {
	tests := []struct {
		col  string
		want int
	}{
		{"A", 0}, {"B", 1}, {"Z", 25},
		{"AA", 26}, {"AB", 27}, {"AZ", 51},
		{"BA", 52}, {"ZZ", 701},
	}
	for _, tc := range tests {
		if got := colIndex(tc.col); got != tc.want {
			t.Errorf("colIndex(%q) = %d, want %d", tc.col, got, tc.want)
		}
	}
}

func TestAddrToName(t *testing.T) {
	if got := addrToName(0, 0); got != "A1" {
		t.Errorf("addrToName(0,0) = %q, want A1", got)
	}
	if got := addrToName(0, 25); got != "Z1" {
		t.Errorf("addrToName(0,25) = %q, want Z1", got)
	}
	if got := addrToName(1, 26); got != "AA2" {
		t.Errorf("addrToName(1,26) = %q, want AA2", got)
	}
}

// ---- parseCellRef ------------------------------------------------------------

func TestParseCellRef(t *testing.T) {
	tests := []struct {
		s    string
		r, c int
		ok   bool
	}{
		{"A1", 0, 0, true},
		{"B2", 1, 1, true},
		{"$A$1", 0, 0, true},
		{"$Z$10", 9, 25, true},
		{"AA1", 0, 26, true},
		{"notref", 0, 0, false},
		{"123", 0, 0, false},
	}
	for _, tc := range tests {
		addr, ok := parseCellRef(tc.s)
		if ok != tc.ok {
			t.Errorf("parseCellRef(%q) ok=%v, want %v", tc.s, ok, tc.ok)
			continue
		}
		if ok && (addr.row != tc.r || addr.col != tc.c) {
			t.Errorf("parseCellRef(%q) = (%d,%d), want (%d,%d)", tc.s, addr.row, addr.col, tc.r, tc.c)
		}
	}
}

// ---- RecomputeWorkbook edge cases -------------------------------------------

func TestRecomputeWorkbook_EmptyString(t *testing.T) {
	if got := RecomputeWorkbook(""); got != "" {
		t.Fatalf("empty string should return empty, got %q", got)
	}
}

func TestRecomputeWorkbook_InvalidJSON(t *testing.T) {
	bad := `{"not":"an array"}`
	if got := RecomputeWorkbook(bad); got != bad {
		t.Fatalf("invalid workbook JSON should return unchanged")
	}
}

func TestRecomputeWorkbook_NoFormulas(t *testing.T) {
	// Sheet with only literal values; should round-trip cleanly.
	data := `[{"name":"Sheet1","id":"s1","celldata":[{"r":0,"c":0,"v":{"v":42}}]}]`
	out := RecomputeWorkbook(data)
	if !strings.Contains(out, `"v":42`) {
		t.Errorf("literal value 42 should survive round-trip: %s", out)
	}
}

func TestRecomputeWorkbook_EmptyCelldata(t *testing.T) {
	data := `[{"name":"Sheet1","id":"s1","celldata":[]}]`
	out := RecomputeWorkbook(data)
	if !strings.Contains(out, "Sheet1") {
		t.Errorf("sheet name should survive: %s", out)
	}
}

// ---- Type coercion in functions ---------------------------------------------

func TestSUMWithStringNumber(t *testing.T) {
	// Cell with non-numeric string should be skipped by SUM (like Excel).
	cells := []FsCellData{scell(0, 0, "text"), cell(1, 0, 3)}
	// SUM skips strings.
	mustNum(t, eval(t, "SUM(A1:A2)", cells...), 3)
}

func TestAVERAGEWithBooleans(t *testing.T) {
	// TRUE=1, FALSE=0 coerce to numbers in AVERAGE.
	mustNum(t, eval(t, "AVERAGE(TRUE,TRUE,FALSE)"), 2.0/3.0)
}

// ---- Tokeniser edge cases ---------------------------------------------------

func TestTokenise_whitespace(t *testing.T) {
	// Expression with mixed whitespace.
	mustNum(t, eval(t, "  1  +  2  "), 3)
}

func TestTokenise_negativeInExpr(t *testing.T) {
	mustNum(t, eval(t, "10+-3"), 7)
	mustNum(t, eval(t, "10--3"), 13)
}

// ---- ROUND edge cases -------------------------------------------------------

func TestROUND_NegativeDigits(t *testing.T) {
	mustNum(t, eval(t, "ROUND(12345,-3)"), 12000)
}

func TestROUND_ZeroDigits(t *testing.T) {
	mustNum(t, eval(t, "ROUND(2.5,0)"), 3)
	mustNum(t, eval(t, "ROUND(3.5,0)"), 4)
}

// ---- Range extraction -------------------------------------------------------

func TestExtractRefs_Range(t *testing.T) {
	refs := extractRefs("SUM(A1:C3)")
	// A1:C3 is 3 rows × 3 cols = 9 refs.
	if len(refs) != 9 {
		t.Fatalf("expected 9 refs for A1:C3, got %d", len(refs))
	}
}

func TestExtractRefs_SingleCell(t *testing.T) {
	refs := extractRefs("A1+B2")
	if len(refs) != 2 {
		t.Fatalf("expected 2 refs, got %d: %v", len(refs), refs)
	}
}

// ---- Recompute integration path ---------------------------------------------

// TestSaveRecompute_Integration tests the full recompute path that would be
// called from service.go's SaveSheet. Skipped if GROWN_TEST_DSN is not set.
func TestSaveRecompute_Integration(t *testing.T) {
	// This test exercises RecomputeWorkbook end-to-end with a realistic workbook
	// JSON that looks like what FortuneSheet sends.
	workbook := `[{
		"name": "Sheet1",
		"id": "sheet1",
		"order": 0,
		"row": 100,
		"column": 26,
		"celldata": [
			{"r":0,"c":0,"v":{"v":10}},
			{"r":1,"c":0,"v":{"v":20}},
			{"r":2,"c":0,"v":{"v":30}},
			{"r":3,"c":0,"v":{"f":"=SUM(A1:A3)","v":0}},
			{"r":4,"c":0,"v":{"f":"=AVERAGE(A1:A3)","v":0}},
			{"r":5,"c":0,"v":{"f":"=A4&\" total\"","v":""}},
			{"r":6,"c":0,"v":{"f":"=IF(A4>50,\"big\",\"small\")","v":""}}
		]
	}]`
	out := RecomputeWorkbook(workbook)
	if !strings.Contains(out, `"m":"60"`) {
		t.Errorf("SUM(A1:A3) should be 60: %s", out)
	}
	if !strings.Contains(out, `"m":"20"`) {
		t.Errorf("AVERAGE(A1:A3) should be 20: %s", out)
	}
	if !strings.Contains(out, `"m":"60 total"`) {
		t.Errorf("concat formula should produce '60 total': %s", out)
	}
	if !strings.Contains(out, `"m":"big"`) {
		t.Errorf("IF formula should produce 'big': %s", out)
	}
}
