package sheets

import "testing"

func TestCountUnique(t *testing.T) {
	mustNum(t, eval(t, "COUNTUNIQUE(1,2,2,3)"), 3)
	mustNum(t, eval(t, `COUNTUNIQUE("a","b","a","c","c")`), 3)
	// Range form, blanks skipped.
	cells := []FsCellData{cell(0, 0, 5), cell(1, 0, 5), cell(2, 0, 7)}
	mustNum(t, eval(t, "COUNTUNIQUE(A1:A3)", cells...), 2)
}

func TestIsEmail(t *testing.T) {
	mustBool(t, eval(t, `ISEMAIL("a@b.com")`), true)
	mustBool(t, eval(t, `ISEMAIL("first.last@sub.example.org")`), true)
	mustBool(t, eval(t, `ISEMAIL("nope")`), false)
	mustBool(t, eval(t, `ISEMAIL("a@b")`), false)
}

func TestIsURL(t *testing.T) {
	mustBool(t, eval(t, `ISURL("https://example.com/path")`), true)
	mustBool(t, eval(t, `ISURL("example.com")`), true)
	mustBool(t, eval(t, `ISURL("www.google.com/q?x=1")`), true)
	mustBool(t, eval(t, `ISURL("not a url")`), false)
	mustBool(t, eval(t, `ISURL("hello")`), false)
}

func TestIsBetween(t *testing.T) {
	mustBool(t, eval(t, "ISBETWEEN(5,1,10)"), true)
	mustBool(t, eval(t, "ISBETWEEN(5,6,10)"), false)
	mustBool(t, eval(t, "ISBETWEEN(1,1,10)"), true) // inclusive low default
	mustBool(t, eval(t, "ISBETWEEN(1,1,10,FALSE)"), false)
	mustBool(t, eval(t, "ISBETWEEN(10,1,10,TRUE,FALSE)"), false)
}

func TestArabicRoman(t *testing.T) {
	mustNum(t, eval(t, `ARABIC("XIV")`), 14)
	mustNum(t, eval(t, `ARABIC("MCMXCIV")`), 1994)
	mustStr(t, eval(t, "ROMAN(14)"), "XIV")
	mustStr(t, eval(t, "ROMAN(1994)"), "MCMXCIV")
	mustErr(t, eval(t, "ROMAN(0)"), "#NUM!")
	// Round-trip.
	mustNum(t, eval(t, `ARABIC(ROMAN(2024))`), 2024)
}

func TestBaseDecimal(t *testing.T) {
	mustStr(t, eval(t, "BASE(255,16)"), "FF")
	mustStr(t, eval(t, "BASE(5,2,8)"), "00000101")
	mustStr(t, eval(t, "BASE(8,8)"), "10")
	mustNum(t, eval(t, `DECIMAL("FF",16)`), 255)
	mustNum(t, eval(t, `DECIMAL("101",2)`), 5)
}

func TestEncodeURL(t *testing.T) {
	mustStr(t, eval(t, `ENCODEURL("a b&c")`), "a+b%26c")
	mustStr(t, eval(t, `ENCODEURL("x=1/y")`), "x%3D1%2Fy")
}
