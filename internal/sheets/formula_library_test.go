package sheets

import (
	"math"
	"testing"
)

// libCell builds one cell datum for the range-based tests.
func libCell(r, c int, v interface{}) FsCellData {
	return FsCellData{R: r, C: c, V: &FsCell{V: v}}
}

// mustApprox asserts a numeric result within tol (for financial/float funcs).
func mustApprox(t *testing.T, v value, want, tol float64) {
	t.Helper()
	if v.isErr() {
		t.Fatalf("got error %q, want ≈%g", v.str, want)
	}
	n, ok := v.toNum()
	if !ok {
		t.Fatalf("got non-numeric %q, want ≈%g", v.toStr(), want)
	}
	if math.Abs(n-want) > tol {
		t.Fatalf("got %g, want ≈%g (tol %g)", n, want, tol)
	}
}

// A small ascending lookup table A1:B4 = {1:"a", 2:"b", 3:"c", 4:"d"}.
func lookupTable() []FsCellData {
	return []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, "a"),
		libCell(1, 0, float64(2)), libCell(1, 1, "b"),
		libCell(2, 0, float64(3)), libCell(2, 1, "c"),
		libCell(3, 0, float64(4)), libCell(3, 1, "d"),
	}
}

func TestMathLibrary(t *testing.T) {
	mustNum(t, eval(t, "POWER(2,10)"), 1024)
	mustNum(t, eval(t, "SQRT(144)"), 12)
	mustNum(t, eval(t, "MOD(10,3)"), 1)
	mustNum(t, eval(t, "GCD(12,18)"), 6)
	mustNum(t, eval(t, "LCM(4,6)"), 12)
	mustNum(t, eval(t, "ROUNDUP(2.01,0)"), 3)
	mustNum(t, eval(t, "ROUNDDOWN(2.99,0)"), 2)
	mustNum(t, eval(t, "CEILING(2.1,1)"), 3)
	mustNum(t, eval(t, "FLOOR(2.9,1)"), 2)
	mustNum(t, eval(t, "PRODUCT(2,3,4)"), 24)
	mustNum(t, eval(t, "COMBIN(5,2)"), 10)
	mustNum(t, eval(t, "FACT(5)"), 120)
	mustNum(t, eval(t, "LOG(8,2)"), 3)
	mustNum(t, eval(t, "LOG10(1000)"), 3)
	mustNum(t, eval(t, "INT(-1.5)"), -2) // Excel INT floors toward -inf
	mustNum(t, eval(t, "TRUNC(-1.9)"), -1)
	mustNum(t, eval(t, "SIGN(-7)"), -1)
	mustApprox(t, eval(t, "DEGREES(PI())"), 180, 1e-9)
	mustApprox(t, eval(t, "SIN(RADIANS(90))"), 1, 1e-9)
	mustNum(t, eval(t, "QUOTIENT(17,5)"), 3)
	// SUMIF / SUMPRODUCT over ranges.
	cells := []FsCellData{libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)), libCell(3, 0, float64(4))}
	mustNum(t, eval(t, `SUMIF(A1:A4,">2")`, cells...), 7)
	cells2 := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(4)),
		libCell(1, 0, float64(2)), libCell(1, 1, float64(5)),
		libCell(2, 0, float64(3)), libCell(2, 1, float64(6)),
	}
	mustNum(t, eval(t, "SUMPRODUCT(A1:A3,B1:B3)", cells2...), 32) // 1*4+2*5+3*6
}

func TestStatLibrary(t *testing.T) {
	// A1:A8 = 2,4,4,4,5,5,7,9 → mean 5, STDEV.P 2, VAR.P 4.
	d := []FsCellData{}
	for i, n := range []float64{2, 4, 4, 4, 5, 5, 7, 9} {
		d = append(d, libCell(i, 0, n))
	}
	mustNum(t, eval(t, "MEDIAN(A1:A8)", d...), 4.5)
	mustApprox(t, eval(t, "STDEV.P(A1:A8)", d...), 2, 1e-9)
	mustApprox(t, eval(t, "VAR.P(A1:A8)", d...), 4, 1e-9)
	mustNum(t, eval(t, `COUNTIF(A1:A8,4)`, d...), 3)
	mustNum(t, eval(t, `COUNTIF(A1:A8,">4")`, d...), 4) // >4 → 5,5,7,9
	mustNum(t, eval(t, "LARGE(A1:A8,1)", d...), 9)
	mustNum(t, eval(t, "SMALL(A1:A8,2)", d...), 4)
	mustNum(t, eval(t, "MODE(A1:A8)", d...), 4)
	// PERCENTILE.INC of {1,2,3,4} at 0.5 = 2.5
	q := []FsCellData{libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)), libCell(3, 0, float64(4))}
	mustApprox(t, eval(t, "PERCENTILE.INC(A1:A4,0.5)", q...), 2.5, 1e-9)
	mustNum(t, eval(t, "RANK(3,A1:A4)", q...), 2) // descending default: 4=1,3=2
}

func TestTextLibrary(t *testing.T) {
	mustStr(t, eval(t, `UPPER("abc")`), "ABC")
	mustStr(t, eval(t, `LOWER("ABC")`), "abc")
	mustStr(t, eval(t, `PROPER("hello world")`), "Hello World")
	mustStr(t, eval(t, `TRIM("  a   b  ")`), "a b")
	mustStr(t, eval(t, `SUBSTITUTE("a-b-c","-","+")`), "a+b+c")
	mustStr(t, eval(t, `REPLACE("abcdef",2,3,"XY")`), "aXYef")
	mustNum(t, eval(t, `FIND("c","abc")`), 3)
	mustNum(t, eval(t, `SEARCH("B","aBc")`), 2)
	mustStr(t, eval(t, `REPT("ab",3)`), "ababab")
	mustStr(t, eval(t, `TEXTJOIN("-",TRUE,"a","b","c")`), "a-b-c")
	mustStr(t, eval(t, `CONCAT("a","b","c")`), "abc")
	mustBool(t, eval(t, `EXACT("a","a")`), true)
	mustBool(t, eval(t, `EXACT("a","A")`), false)
	mustNum(t, eval(t, `VALUE("123")`), 123)
	mustStr(t, eval(t, `TEXT(1234.5,"0.00")`), "1234.50")
	mustStr(t, eval(t, `TEXT(0.5,"0%")`), "50%")
	mustStr(t, eval(t, `CHAR(65)`), "A")
	mustNum(t, eval(t, `CODE("A")`), 65)
}

func TestDateLibrary(t *testing.T) {
	mustNum(t, eval(t, "YEAR(DATE(2024,5,20))"), 2024)
	mustNum(t, eval(t, "MONTH(DATE(2024,5,20))"), 5)
	mustNum(t, eval(t, "DAY(DATE(2024,5,20))"), 20)
	mustNum(t, eval(t, "DAY(EOMONTH(DATE(2024,2,10),0))"), 29) // 2024 leap
	mustNum(t, eval(t, "DAY(EDATE(DATE(2024,1,31),1))"), 29)
	mustNum(t, eval(t, "WEEKDAY(DATE(2024,1,7))"), 1) // Sunday, type 1
	mustNum(t, eval(t, `DATEDIF(DATE(2024,1,1),DATE(2024,3,1),"M")`), 2)
	mustNum(t, eval(t, "DAYS(DATE(2024,1,11),DATE(2024,1,1))"), 10)
	mustNum(t, eval(t, "HOUR(TIME(13,30,0))"), 13)
}

func TestLookupLibrary(t *testing.T) {
	tbl := lookupTable()
	mustStr(t, eval(t, "VLOOKUP(2,A1:B4,2,FALSE)", tbl...), "b")
	mustStr(t, eval(t, "VLOOKUP(3,A1:B4,2,TRUE)", tbl...), "c")
	mustStr(t, eval(t, "INDEX(A1:B4,4,2)", tbl...), "d")
	mustNum(t, eval(t, "MATCH(3,A1:A4,0)", tbl...), 3)
	mustStr(t, eval(t, `CHOOSE(2,"x","y","z")`), "y")
	mustStr(t, eval(t, "XLOOKUP(2,A1:A4,B1:B4)", tbl...), "b")
	mustNum(t, eval(t, "ROWS(A1:B4)", tbl...), 4)
	mustNum(t, eval(t, "COLUMNS(A1:B4)", tbl...), 2)
	mustErr(t, eval(t, "VLOOKUP(99,A1:B4,2,FALSE)", tbl...), "#N/A")
}

func TestFinancialLibrary(t *testing.T) {
	// SLN is exact: (10000-1000)/5 = 1800
	mustApprox(t, eval(t, "SLN(10000,1000,5)"), 1800, 1e-9)
	// PMT(5%/12, 60, -10000) ≈ 188.71
	mustApprox(t, eval(t, "PMT(0.05/12,60,-10000)"), 188.71, 0.02)
	// FV(0, 10, -100) = 1000 (no interest)
	mustApprox(t, eval(t, "FV(0,10,-100)"), 1000, 1e-9)
	// NPV(10%, 100,100,100) ≈ 248.69
	mustApprox(t, eval(t, "NPV(0.1,100,100,100)"), 248.685, 0.01)
}

func TestLogicalInfoLibrary(t *testing.T) {
	mustStr(t, eval(t, `IFERROR(1/0,"err")`), "err")
	mustNum(t, eval(t, `IFERROR(5,"err")`), 5)
	mustStr(t, eval(t, `IFNA(NA(),"x")`), "x")
	mustNum(t, eval(t, `IFS(FALSE,1,TRUE,2)`), 2)
	mustStr(t, eval(t, `SWITCH(2,1,"a",2,"b","def")`), "b")
	mustStr(t, eval(t, `SWITCH(9,1,"a",2,"b","def")`), "def")
	mustBool(t, eval(t, `XOR(TRUE,FALSE,TRUE)`), false) // 2 trues → even → false
	mustBool(t, eval(t, `XOR(TRUE,FALSE,FALSE)`), true)
	mustBool(t, eval(t, `ISNUMBER(5)`), true)
	mustBool(t, eval(t, `ISTEXT("a")`), true)
	mustBool(t, eval(t, `ISNUMBER("a")`), false)
	mustBool(t, eval(t, `ISEVEN(4)`), true)
	mustBool(t, eval(t, `ISODD(3)`), true)
	mustNum(t, eval(t, `TYPE(5)`), 1)
	mustNum(t, eval(t, `TYPE("a")`), 2)
}

func TestEngineeringLibrary(t *testing.T) {
	mustStr(t, eval(t, "DEC2BIN(10)"), "1010")
	mustNum(t, eval(t, `BIN2DEC("1010")`), 10)
	mustNum(t, eval(t, `HEX2DEC("FF")`), 255)
	mustStr(t, eval(t, "DEC2HEX(255)"), "FF")
	mustNum(t, eval(t, "BITAND(5,3)"), 1)
	mustNum(t, eval(t, "BITOR(5,2)"), 7)
	mustNum(t, eval(t, "BITXOR(5,3)"), 6)
	mustNum(t, eval(t, "DELTA(2,2)"), 1)
	mustNum(t, eval(t, "DELTA(2,3)"), 0)
	mustNum(t, eval(t, "GESTEP(5,4)"), 1)
	mustApprox(t, eval(t, `CONVERT(1,"km","m")`), 1000, 1e-9)
	mustApprox(t, eval(t, `CONVERT(100,"C","F")`), 212, 1e-9)
	mustApprox(t, eval(t, `CONVERT(0,"C","K")`), 273.15, 1e-9)
}
