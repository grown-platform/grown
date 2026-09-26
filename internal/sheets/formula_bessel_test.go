package sheets

import (
	"math"
	"testing"
)

func besselNear(t *testing.T, expr string, want, tol float64) {
	t.Helper()
	v := eval(t, expr)
	if v.kind != kindNum || math.Abs(v.num-want) > tol*math.Max(1, math.Abs(want)) {
		t.Fatalf("%s = %s, want %g", expr, describeValue(v), want)
	}
}

func TestBessel(t *testing.T) {
	besselNear(t, "BESSELI(1,2)", 0.135747669767038, 1e-12)
	besselNear(t, "BESSELI(-10,1)", -2670.98830370126, 1e-12)
	besselNear(t, "BESSELI(709,1)", 1.23067888965247e+306, 1e-10)
	besselNear(t, "BESSELJ(1.9,2)", 0.329925728, 5e-10)
	besselNear(t, "BESSELJ(0,0)", 1, 0)
	besselNear(t, "BESSELK(1.5,1)", 0.277387804, 5e-10)
	besselNear(t, "BESSELK(1,3)", 7.10126281, 5e-9)
	besselNear(t, "BESSELY(1,0)", 0.088256971, 5e-10)
	besselNear(t, "BESSELY(2.5,1)", 0.1459181, 5e-8)
	besselNear(t, "BESSELY(1.5,2)", -0.932193761, 5e-9)
	besselNear(t, `BESSELJ("01/01/2023","2")`, -0.000492086, 5e-10) // date text
	mustErr(t, eval(t, "BESSELI(5,-0.1)"), "#NUM!")
	mustErr(t, eval(t, "BESSELK(0,1)"), "#NUM!")
	mustErr(t, eval(t, "BESSELY(-1,2)"), "#NUM!")
	mustErr(t, eval(t, "BESSELI(TRUE,2)"), "#VALUE!")
	mustErr(t, eval(t, "BESSELJ(,1)"), "#N/A")
	mustErr(t, eval(t, "BESSELJ(NA(),1)"), "#N/A")
}
