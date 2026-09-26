package sheets

import "testing"

func TestByteTextFunctions(t *testing.T) {
	mustNum(t, eval(t, `LENB("abc")`), 3)
	mustNum(t, eval(t, `LENB(TRUE)`), 4)
	mustStr(t, eval(t, `LEFTB("abcdef",3)`), "abc")
	mustStr(t, eval(t, `LEFTB("abcdef")`), "a")
	mustStr(t, eval(t, `RIGHTB("abcdef",3)`), "def")
	mustStr(t, eval(t, `RIGHTB({"abc","def"},2)`), "bc")
	mustStr(t, eval(t, `LEFTB("abc",2.99999999999999E+307)`), "abc")
	mustErr(t, eval(t, `LEFTB("abc",-1)`), "#VALUE!")
	mustErr(t, eval(t, `LEFTB(NA(),2)`), "#N/A")
	mustStr(t, eval(t, `MIDB("Fluid Flow",7,20)`), "Flow")
	mustStr(t, eval(t, `MIDB("Text",999,1)`), "")
	mustErr(t, eval(t, `MIDB("Text",0,1)`), "#VALUE!")
	mustStr(t, eval(t, `REPLACEB("Hello World",2,5,"Test")`), "HTestWorld")
	mustStr(t, eval(t, `REPLACEB("Test",32767,1,"X")`), "TestX")
	mustNum(t, eval(t, `FINDB("M","Miriam McGovern",3)`), 8)
	mustNum(t, eval(t, `SEARCHB("b","abc")`), 2)
	mustNum(t, eval(t, `SEARCHB(,"abc")`), 1)
	// The plain functions share the implementation: errors propagate and an
	// array argument contributes its first element.
	mustErr(t, eval(t, `LEFT(#N/A,1)`), "#N/A")
	mustStr(t, eval(t, `RIGHT({"example","abc"},2)`), "le")
}

func TestAsc(t *testing.T) {
	mustStr(t, eval(t, `ASC("ＡＢＣＤ")`), "ABCD")
	mustStr(t, eval(t, `ASC("ｔｅＳｔ１２")`), "teSt12")
	mustStr(t, eval(t, `ASC("！＠＃")`), "!@#")
	mustStr(t, eval(t, `ASC("テスト")`), "テスト") // katakana untouched
	mustStr(t, eval(t, `ASC(123)`), "123")
	mustBool(t, eval(t, `ASC(TRUE)`), true)
	mustErr(t, eval(t, `ASC(NA())`), "#N/A")
}

func TestRegexTest(t *testing.T) {
	mustBool(t, eval(t, `REGEXTEST("Hello World","World")`), true)
	mustBool(t, eval(t, `REGEXTEST("Hello World","world")`), false)
	mustBool(t, eval(t, `REGEXTEST("Hello World","world",1)`), true)
	mustBool(t, eval(t, `REGEXTEST("abc123","[0-9]+")`), true)
	mustErr(t, eval(t, `REGEXTEST("abc","[")`), "#VALUE!")
	mustErr(t, eval(t, `REGEXTEST("abc","def",99)`), "#VALUE!")
	mustErr(t, eval(t, `REGEXTEST(NA(),"abc")`), "#N/A")
	v := eval(t, `REGEXTEST({"Hello","Bye"},"^H")`)
	if v.kind != kindArray || v.arr.cols != 2 || v.arr.cells[0][1].num != 0 || v.arr.cells[0][0].num != 1 {
		t.Fatalf("REGEXTEST over an array: got %s", describeValue(v))
	}
}

func TestDatabasePopulationStats(t *testing.T) {
	cells := []FsCellData{
		scell(0, 0, "Tree"), scell(0, 1, "Yield"),
		scell(1, 0, "Apple"), cell(1, 1, 14),
		scell(2, 0, "Pear"), cell(2, 1, 10),
		scell(3, 0, "Apple"), cell(3, 1, 6),
		scell(5, 0, "Tree"), scell(6, 0, "Apple"),
	}
	// Apple yields 14 and 6: population variance 16, stdev 4.
	mustNum(t, eval(t, `DVARP(A1:B4,"Yield",A6:A7)`, cells...), 16)
	mustNum(t, eval(t, `DSTDEVP(A1:B4,2,A6:A7)`, cells...), 4)
	mustErr(t, eval(t, `DVARP(A1:B4,"Nope",A6:A7)`, cells...), "#VALUE!")
}

func TestValueReadsDatesAndRejectsBooleans(t *testing.T) {
	mustNum(t, eval(t, `VALUE("01/01/2025")`), 45658)
	mustNum(t, eval(t, `VALUE("12:00:00")`), 0.5)
	mustNum(t, eval(t, `VALUE("$1,000")`), 1000)
	mustErr(t, eval(t, `VALUE(TRUE)`), "#VALUE!")
	mustErr(t, eval(t, `VALUE("")`), "#VALUE!")
}
