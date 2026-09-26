package sheets

import (
	"math"
	"testing"
)

func TestReciprocalHyperbolicAndInverseCot(t *testing.T) {
	mustNum(t, eval(t, "ACOT(1)"), math.Pi/4)
	mustNum(t, eval(t, "ACOT(0)"), math.Pi/2)
	mustNum(t, eval(t, "ACOT(-1)"), 3*math.Pi/4)
	mustNum(t, eval(t, "ACOTH(2)"), 0.5493061443340548)
	mustErr(t, eval(t, "ACOTH(1)"), "#NUM!")
	mustNum(t, eval(t, "COTH(2)"), 1.0373147207275481)
	mustErr(t, eval(t, "COTH(0)"), "#DIV/0!")
	mustNum(t, eval(t, "COTH(1000000000)"), 1)
	mustNum(t, eval(t, "CSCH(1.5)"), 0.46964244059522464)
	mustErr(t, eval(t, "CSCH(0)"), "#DIV/0!")
	mustNum(t, eval(t, "SECH(0)"), 1)
	mustNum(t, eval(t, "SECH(1000000000)"), 0)
	mustErr(t, eval(t, `ACOT("abc")`), "#VALUE!")
	mustErr(t, eval(t, "ACOT(NA())"), "#N/A")
}

func TestPreciseCeilingFloor(t *testing.T) {
	mustNum(t, eval(t, "CEILING.PRECISE(4.3)"), 5)
	mustNum(t, eval(t, "CEILING.PRECISE(-4.3)"), -4)
	mustNum(t, eval(t, "CEILING.PRECISE(4.3,-2)"), 6)
	mustNum(t, eval(t, "CEILING.PRECISE(4.5,0.1)"), 4.5)
	mustNum(t, eval(t, "CEILING.PRECISE(4.3,0)"), 0)
	mustNum(t, eval(t, "ISO.CEILING(-4.3,2)"), -4)
	mustNum(t, eval(t, "ISO.CEILING(1E-307)"), 1)
	mustNum(t, eval(t, "FLOOR.PRECISE(-3.2,-1)"), -4)
	mustNum(t, eval(t, "FLOOR.PRECISE(123.456,0.1)"), 123.4)
	mustNum(t, eval(t, "ECMA.CEILING(-2.5,2)"), -2)
	mustNum(t, eval(t, "ECMA.CEILING(-2.5,-2)"), -4)
	mustErr(t, eval(t, "ECMA.CEILING(2.5,-1)"), "#NUM!")
	mustNum(t, eval(t, "ECMA.CEILING(0.5,0.333)"), 0.666)
}

// Wave 0 backlog: error arguments propagate and edge cases give Excel's error.
func TestMathErrorSemantics(t *testing.T) {
	mustErr(t, eval(t, "ROUND(NA(),2)"), "#N/A")
	mustErr(t, eval(t, "ROUND(2.5,#NUM!)"), "#NUM!")
	mustNum(t, eval(t, "ROUND(1.005,2)"), 1.01)
	mustNum(t, eval(t, "ROUND(-1.005,2)"), -1.01)
	mustNum(t, eval(t, "ROUND(-50.55,-2.1)"), -100)
	mustNum(t, eval(t, "ROUND(-50.55,0.9)"), -51)
	mustNum(t, eval(t, "ROUND(2.5,0)"), 3)
	mustErr(t, eval(t, "POWER(0,-1)"), "#DIV/0!")
	mustErr(t, eval(t, "LOG(8,1)"), "#DIV/0!")
	mustErr(t, eval(t, "COT(0)"), "#DIV/0!")
	mustErr(t, eval(t, "CSC(0)"), "#DIV/0!")
	mustErr(t, eval(t, "COT(2^27)"), "#NUM!")
	mustErr(t, eval(t, "SIN(1,2)"), "#N/A") // wrong argument count
	mustErr(t, eval(t, "GCD(-6,12)"), "#NUM!")
	mustErr(t, eval(t, "GCD(TRUE,12)"), "#VALUE!")
	mustErr(t, eval(t, "GCD(2^53,12)"), "#NUM!")
	mustErr(t, eval(t, "LCM(-12,18)"), "#NUM!")
	mustErr(t, eval(t, "LCM(1E+307,1E+307)"), "#NUM!")
	mustNum(t, eval(t, `ABS("12/12/2000")`), 36872) // date text coerces
	mustNum(t, eval(t, `ABS("12:00:00")`), 0.5)
}

func TestRoundingAndLegacyFixes(t *testing.T) {
	mustNum(t, eval(t, "ROUNDUP(8.175,3)"), 8.175)
	mustNum(t, eval(t, "ROUNDUP(-3.14159,1)"), -3.2)
	mustNum(t, eval(t, "ROUNDDOWN(1.005,2)"), 1)
	mustNum(t, eval(t, "CEILING(-2.5,2)"), -2)
	mustErr(t, eval(t, "CEILING(2.5,-2)"), "#NUM!")
	mustErr(t, eval(t, "FACT(-0.5)"), "#NUM!")
	mustNum(t, eval(t, "SUMPRODUCT({1,2,TRUE,3})"), 6) // booleans in arrays count as 0
}
