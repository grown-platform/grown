package sheets

import (
	"math"
	"testing"
)

// TestStatDistPrecision checks the distribution library in the tails, where
// a naive implementation loses most of its digits. The references were
// computed independently: erfc for the normal and χ²(1) tails, −ln(1−p)
// for the exponential case of GAMMA.INV, and a 60-digit evaluation of the
// incomplete beta function for F(10⁶, 10⁶) and Student's t.
func TestStatDistPrecision(t *testing.T) {
	cases := []struct {
		expr string
		want float64
		rel  float64
	}{
		{"F.DIST(0.9842424928973088,1000000,1000000,TRUE)", 9.992007221632437e-16, 1e-9},
		{"F.INV.RT(0.999999999999999,1000000,1000000)", 0.9842424928973088, 1e-12},
		{"CHISQ.DIST.RT(41.8214563647613,1)", 1e-10, 1e-12},
		{"CHIINV(0.0000000001,1)", 41.8214563647613, 1e-12},
		{"GAMMA.INV(0.999999999999999,1,1)", 34.53957599234088, 1e-12},
		{"NORM.S.INV(0.999999999999999)", 7.941444487415978, 1e-12},
		{"T.DIST.2T(1.96,10000000000)", 0.04999579032416974, 1e-12},
		{"T.INV(0.975,10)", 2.2281388519862748, 1e-13},
		{"T.INV.2T(0.000000000000001,10)", 86.86532165324, 1e-9},
		{"CHISQ.INV(0.5,1000000)", 999999.3333334568, 1e-12},
		{"BINOM.DIST(6,10,0.5,FALSE)", 0.205078125, 1e-14},
		{"CRITBINOM(1999999999,0.999999999999999,0.999999999999999)", 1999999999, 0},
		{"BETA.INV(0.5,2,3)", 0.38572756813238945, 1e-12},
		{"GAMMALN(0.5)", 0.5723649429247001, 1e-14},
	}
	for _, tc := range cases {
		v := eval(t, tc.expr)
		if v.kind != kindNum {
			t.Errorf("%s = %s, want %v", tc.expr, describeValue(v), tc.want)
			continue
		}
		if math.Abs(v.num-tc.want) > tc.rel*math.Abs(tc.want) {
			t.Errorf("%s = %.17g, want %.17g", tc.expr, v.num, tc.want)
		}
	}
}
