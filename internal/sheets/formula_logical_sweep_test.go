package sheets

import "testing"

// Excel's argument rules fixed in the Sheets parity sweep: AND/OR/XOR/NOT
// text handling, SWITCH's typed matching, SUM/PRODUCT data arguments and
// error arguments passed on by scalar-argument functions.
func TestLogicalArgumentRules(t *testing.T) {
	text := []FsCellData{cell(0, 0, 1), scell(1, 0, "abc")}
	mustBool(t, eval(t, "AND(A1:A2)", text...), true)  // text in a range is skipped
	mustErr(t, eval(t, "AND(A2)", text...), "#VALUE!") // no logical value at all
	mustErr(t, eval(t, `AND("abc")`), "#VALUE!")
	mustBool(t, eval(t, `OR("true",0)`), true)
	mustErr(t, eval(t, `OR("1","0")`), "#VALUE!")
	mustBool(t, eval(t, "XOR(5,6)"), false)
	mustBool(t, eval(t, `XOR({TRUE,"abc"})`), true)
	mustBool(t, eval(t, `NOT("FALSE")`), true)
	mustErr(t, eval(t, `NOT("abc")`), "#VALUE!")
	mustBool(t, eval(t, "NOT(B9)"), true) // an empty cell is FALSE
}

func TestSwitchTypedMatch(t *testing.T) {
	mustNum(t, eval(t, "SWITCH(TRUE,1,100,2,200,300)"), 300)
	mustStr(t, eval(t, `SWITCH(1,"1","One","Default")`), "Default")
	mustStr(t, eval(t, `SWITCH("a","A","yes","no")`), "yes")
	mustStr(t, eval(t, `SWITCH(B9,0,"zero","other")`), "zero")
}

func TestSumDataArguments(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 2), {R: 1, C: 0, V: &FsCell{V: true}}, scell(2, 0, "x")}
	mustNum(t, eval(t, "SUM(A1:A3)", cells...), 2) // booleans and text in a range are skipped
	mustNum(t, eval(t, `SUM("10",TRUE)`), 11)      // typed directly they count
	mustNum(t, eval(t, "SUM({TRUE,FALSE,3})"), 3)
	mustErr(t, eval(t, `SUM("abc")`), "#VALUE!")
	mustNum(t, eval(t, `PRODUCT("2",3,,TRUE)`), 6) // an empty argument is skipped
	mustNum(t, eval(t, "SUMSQ({TRUE,2})"), 4)
}

func TestErrorArgumentsPropagate(t *testing.T) {
	mustErr(t, eval(t, "CHOOSE(NA(),1,2)"), "#N/A")
	mustErr(t, eval(t, "BASE(10,NA())"), "#N/A")
	mustErr(t, eval(t, "SEQUENCE(SQRT(-1))"), "#NUM!")
	mustErr(t, eval(t, "NPV(NA(),100)"), "#N/A")
	mustErr(t, eval(t, "TAKE({1,2,3},1/0)"), "#DIV/0!")
	mustNum(t, eval(t, "CHOOSE(2,NA(),7)"), 7) // an unchosen error is not the result
}

func TestXLookupAndXMatchRules(t *testing.T) {
	col := []FsCellData{cell(0, 0, 1), cell(1, 0, 2), cell(2, 0, 3), cell(0, 1, 10), cell(1, 1, 20), cell(2, 1, 30)}
	mustErr(t, eval(t, "XLOOKUP(9,A1:A3,B1:B3,,0)", col...), "#N/A") // an empty if_not_found is not a value
	mustNum(t, eval(t, "XLOOKUP(2.5,A1:A3,B1:B3,,1)", col...), 30)
	mustErr(t, eval(t, "XLOOKUP(2,A1:A3,B1:B2)", col...), "#VALUE!") // return array too short
	mustErr(t, eval(t, "XMATCH(2,A1:A3,5)", col...), "#VALUE!")
	mustErr(t, eval(t, "XMATCH(2,A1:A3,2,2)", col...), "#VALUE!")
	mustNum(t, eval(t, "XMATCH(12,{13,\"b\",92,#NUM!,13},1)"), 1) // errors are skipped
	mustNum(t, eval(t, "XMATCH(TRUE,{1,2,TRUE})"), 3)             // TRUE is not 1
	mustStr(t, eval(t, `ADDRESS(1,7,,,)`), "$G$1")
	mustNum(t, eval(t, "SUM(TAKE({1,2;3,4},,-1))"), 6)
	mustNum(t, eval(t, "SUM(INDEX({1,2;3,4},,2))"), 6)
}
