package sheets

import "testing"

// The postfix % operator divides by 100 and binds tighter than ^.
func TestPercentOperator(t *testing.T) {
	mustNum(t, eval(t, "50%"), 0.5)
	mustNum(t, eval(t, "200*10%"), 20)
	mustNum(t, eval(t, "-5%"), -0.05)
	mustNum(t, eval(t, "10%%"), 0.001)
	mustNum(t, eval(t, "2^200%"), 4) // 2^(200%)
	mustNum(t, eval(t, "A1%", cell(0, 0, 25)), 0.25)
	mustNum(t, eval(t, "SUM(50%,1)"), 1.5)
	mustErr(t, eval(t, `"x"%`), "#VALUE!")
	mustErr(t, eval(t, "NA()%"), "#N/A")
}

// An omitted argument is 0 for numbers and "" for text.
func TestOmittedArguments(t *testing.T) {
	mustNum(t, eval(t, "SUM(1,,2)"), 3)
	mustNum(t, eval(t, "ROUND(2.5,)"), 3)
	mustStr(t, eval(t, `CONCATENATE("a",,"b")`), "ab")
	mustStr(t, eval(t, `MID(,1,1)`), "")
	mustNum(t, eval(t, `CEILING.PRECISE(,2)`), 0)
}

// Numbers convert to text with at most 15 significant digits and switch to
// E-notation for very large or very small magnitudes (no int64 overflow).
func TestNumberToText(t *testing.T) {
	mustStr(t, eval(t, `""&(0.1+0.2)`), "0.3")
	mustStr(t, eval(t, `""&1E+307`), "1E+307")
	mustStr(t, eval(t, `UPPER(9.99999999999999E+307)`), "9.99999999999999E+307")
	mustStr(t, eval(t, `""&1E-10`), "1E-10")
	mustStr(t, eval(t, `""&123456789012345`), "123456789012345")
	mustStr(t, eval(t, `""&-2.5`), "-2.5")
}
