package sheets

import "testing"

func TestComplexParseAndFormat(t *testing.T) {
	mustStr(t, eval(t, "COMPLEX(3,4)"), "3+4i")
	mustStr(t, eval(t, `COMPLEX(3.5,-19.6,"j")`), "3.5-19.6j")
	mustStr(t, eval(t, "COMPLEX(0,1)"), "i")
	mustStr(t, eval(t, "COMPLEX(0,-1)"), "-i")
	mustStr(t, eval(t, "COMPLEX(0,0)"), "0")
	mustStr(t, eval(t, "COMPLEX(1E-307,-1E-307)"), "1E-307-1E-307i")
	mustErr(t, eval(t, `COMPLEX(1,2,"k")`), "#VALUE!")
	mustErr(t, eval(t, `COMPLEX(1,2,"I")`), "#VALUE!")
	mustNum(t, eval(t, `IMREAL("6-9i")`), 6)
	mustNum(t, eval(t, `IMAGINARY("0-j")`), -1)
	mustNum(t, eval(t, `IMREAL("1E+307+1E+307i")`), 1e307)
	mustNum(t, eval(t, `IMREAL(45658)`), 45658)
	mustErr(t, eval(t, `IMREAL("3+i4")`), "#NUM!")
	mustErr(t, eval(t, `IMREAL("3+4")`), "#NUM!")
	mustErr(t, eval(t, `IMREAL("")`), "#NUM!")
	mustErr(t, eval(t, `IMREAL(TRUE)`), "#VALUE!")
	mustErr(t, eval(t, `IMREAL(NA())`), "#N/A")
}

func TestComplexArithmetic(t *testing.T) {
	mustNum(t, eval(t, `IMABS("5+12i")`), 13)
	mustNum(t, eval(t, `IMARGUMENT("3+4i")`), 0.9272952180016122)
	mustErr(t, eval(t, `IMARGUMENT("0")`), "#DIV/0!")
	mustStr(t, eval(t, `IMCONJUGATE("3+4i")`), "3-4i")
	mustStr(t, eval(t, `IMSUM("3+4i","1+1i","2+2i")`), "6+7i")
	mustStr(t, eval(t, `IMSUM(5,"5","5i","5+i")`), "15+6i")
	mustStr(t, eval(t, `IMSUB("13+4j","5+3j")`), "8+j")
	mustErr(t, eval(t, `IMSUB("1+i","1+j")`), "#VALUE!") // mixed suffixes
	mustStr(t, eval(t, `IMPRODUCT("3+4i","1+1i")`), "-1+7i")
	mustStr(t, eval(t, `IMDIV("-238+240i","10+24i")`), "5+12i")
	mustErr(t, eval(t, `IMDIV("3+4i","0")`), "#NUM!")
	mustStr(t, eval(t, `IMPOWER("2+3i",3)`), "-46+9.00000000000001i") // as in Excel's own example
	mustStr(t, eval(t, `IMSQRT("-4")`), "1.22464679914735E-16+2i")
	mustStr(t, eval(t, `IMEXP("0")`), "1")
	mustStr(t, eval(t, `IMLN("3+4i")`), "1.6094379124341+0.927295218001612i")
	mustStr(t, eval(t, `IMLOG10("100")`), "2")
	mustStr(t, eval(t, `IMLOG2("8")`), "3")
	mustErr(t, eval(t, `IMLN("0")`), "#NUM!")
	mustErr(t, eval(t, `IMLN("1E+307+1E+307i")`), "#NUM!")
	mustStr(t, eval(t, `IMSIN("0")`), "0")
	mustStr(t, eval(t, `IMCOS("0")`), "1")
	mustStr(t, eval(t, `IMCOS("3+4j")`), "-27.0349456030742-3.85115333481178j")
	mustStr(t, eval(t, `IMTAN("0")`), "0")
	mustErr(t, eval(t, `IMCOT("0")`), "#NUM!")
	mustStr(t, eval(t, `IMSECH("0")`), "1")
	mustStr(t, eval(t, `IMCSCH(45658)`), "0")
}
