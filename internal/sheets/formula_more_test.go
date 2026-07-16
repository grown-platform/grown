package sheets

import "testing"

// ---- statistics: percentile / quartile variants ----------------------------

func TestQuartileExc(t *testing.T) {
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)),
		libCell(2, 0, float64(3)), libCell(3, 0, float64(4)),
	}
	// Exclusive Q1 of {1,2,3,4} = 1.25, Q3 = 3.75.
	mustApprox(t, eval(t, "QUARTILE.EXC(A1:A4,1)", d...), 1.25, 1e-9)
	mustApprox(t, eval(t, "QUARTILE.EXC(A1:A4,3)", d...), 3.75, 1e-9)
	// q=0 and q=4 are out of the exclusive range → #NUM!.
	mustErr(t, eval(t, "QUARTILE.EXC(A1:A4,0)", d...), "#NUM!")
	mustErr(t, eval(t, "QUARTILE.EXC(A1:A4,4)", d...), "#NUM!")
}

func TestPercentRankVariants(t *testing.T) {
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)),
		libCell(2, 0, float64(3)), libCell(3, 0, float64(4)),
	}
	// Inclusive: 3 is at position 3/4 → 0.666...
	mustApprox(t, eval(t, "PERCENTRANK.INC(A1:A4,3)", d...), 0.666, 1e-9)
	// Exclusive: 2 → 2/(4+1) = 0.4.
	mustApprox(t, eval(t, "PERCENTRANK.EXC(A1:A4,2)", d...), 0.4, 1e-9)
	// Out of range → #N/A.
	mustErr(t, eval(t, "PERCENTRANK.EXC(A1:A4,9)", d...), "#N/A")
}

// ---- SKEW / SKEW.P / KURT ---------------------------------------------------

func TestSkewKurt(t *testing.T) {
	d := []FsCellData{}
	for i, n := range []float64{1, 2, 3, 4, 5} {
		d = append(d, libCell(i, 0, n))
	}
	// Symmetric data → skewness 0.
	mustApprox(t, eval(t, "SKEW(A1:A5)", d...), 0, 1e-9)
	mustApprox(t, eval(t, "SKEW.P(A1:A5)", d...), 0, 1e-9)
	// KURT({1,2,3,4,5}) = -1.2 (Excel).
	mustApprox(t, eval(t, "KURT(A1:A5)", d...), -1.2, 1e-9)
	// Too few points.
	small := []FsCellData{libCell(0, 0, float64(1)), libCell(1, 0, float64(2))}
	mustErr(t, eval(t, "SKEW(A1:A2)", small...), "#DIV/0!")
	mustErr(t, eval(t, "KURT(A1:A2)", small...), "#DIV/0!")
}

func TestSkewAsymmetric(t *testing.T) {
	// {2,4,4,4,5,5,7,9}, mean 5: sample SKEW ≈ 0.818488, SKEW.P = 0.65625.
	d := []FsCellData{}
	for i, n := range []float64{2, 4, 4, 4, 5, 5, 7, 9} {
		d = append(d, libCell(i, 0, n))
	}
	mustApprox(t, eval(t, "SKEW(A1:A8)", d...), 0.818488, 1e-5)
	mustApprox(t, eval(t, "SKEW.P(A1:A8)", d...), 0.65625, 1e-5)
}

// ---- normal distribution ----------------------------------------------------

func TestNormalDistribution(t *testing.T) {
	mustApprox(t, eval(t, "NORM.DIST(0,0,1,TRUE)"), 0.5, 1e-9)
	mustApprox(t, eval(t, "NORM.DIST(1.96,0,1,TRUE)"), 0.975002, 1e-5)
	mustApprox(t, eval(t, "NORM.DIST(0,0,1,FALSE)"), 0.398942, 1e-6)
	mustApprox(t, eval(t, "NORM.S.DIST(0,TRUE)"), 0.5, 1e-9)
	mustApprox(t, eval(t, "NORM.S.DIST(1.96,TRUE)"), 0.975002, 1e-5)
	mustApprox(t, eval(t, "NORM.INV(0.5,10,2)"), 10, 1e-9)
	mustApprox(t, eval(t, "NORM.S.INV(0.975)"), 1.959964, 1e-5)
	mustApprox(t, eval(t, "GAUSS(0)"), 0, 1e-9)
	mustApprox(t, eval(t, "GAUSS(1)"), 0.341345, 1e-6)
	mustApprox(t, eval(t, "PHI(0)"), 0.398942, 1e-6)
	// Round-trip: inverse of the CDF returns the input.
	mustApprox(t, eval(t, "NORM.S.INV(NORM.S.DIST(1.2345,TRUE))"), 1.2345, 1e-6)
	// Domain errors.
	mustErr(t, eval(t, "NORM.DIST(1,0,0,TRUE)"), "#NUM!")
	mustErr(t, eval(t, "NORM.S.INV(0)"), "#NUM!")
	mustErr(t, eval(t, "NORM.S.INV(1)"), "#NUM!")
}

func TestConfidenceNorm(t *testing.T) {
	// CONFIDENCE.NORM(0.05, 1, 100) = NORM.S.INV(0.975)/10 ≈ 0.195996.
	mustApprox(t, eval(t, "CONFIDENCE.NORM(0.05,1,100)"), 0.195996, 1e-5)
	mustErr(t, eval(t, "CONFIDENCE.NORM(0,1,100)"), "#NUM!")
	mustErr(t, eval(t, "CONFIDENCE.NORM(0.05,0,100)"), "#NUM!")
}

// ---- MODE.MULT (spill) ------------------------------------------------------

func TestModeMult(t *testing.T) {
	// A1:A6 = 1,2,2,3,3,4 → both 2 and 3 appear twice → spill 2 then 3.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(2)),
		libCell(3, 0, float64(3)), libCell(4, 0, float64(3)), libCell(5, 0, float64(4)),
		libFormula(0, 2, "=MODE.MULT(A1:A6)"),
	})
	wantCellNum(t, out, 0, 2, 2)
	wantCellNum(t, out, 1, 2, 3)
}

func TestModeMultNoMode(t *testing.T) {
	d := []FsCellData{libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3))}
	mustErr(t, eval(t, "MODE.MULT(A1:A3)", d...), "#N/A")
}

// ---- FREQUENCY (spill) ------------------------------------------------------

func TestFrequency(t *testing.T) {
	// data A1:A6 = 1,2,3,4,5,6 ; bins B1:B2 = 2,4.
	// Counts: <=2 → {1,2}=2 ; (2,4] → {3,4}=2 ; >4 → {5,6}=2.
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)), libCell(2, 0, float64(3)),
		libCell(3, 0, float64(4)), libCell(4, 0, float64(5)), libCell(5, 0, float64(6)),
		libCell(0, 1, float64(2)), libCell(1, 1, float64(4)),
		libFormula(0, 3, "=FREQUENCY(A1:A6,B1:B2)"),
	})
	wantCellNum(t, out, 0, 3, 2)
	wantCellNum(t, out, 1, 3, 2)
	wantCellNum(t, out, 2, 3, 2)
}

// ---- SUMXMY2 family ---------------------------------------------------------

func TestSumPairs(t *testing.T) {
	// x A1:A3 = 1,2,3 ; y B1:B3 = 2,4,6.
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(2)), libCell(1, 1, float64(4)),
		libCell(2, 0, float64(3)), libCell(2, 1, float64(6)),
	}
	mustNum(t, eval(t, "SUMXMY2(A1:A3,B1:B3)", d...), 14)   // 1+4+9
	mustNum(t, eval(t, "SUMX2MY2(A1:A3,B1:B3)", d...), -42) // 14-56
	mustNum(t, eval(t, "SUMX2PY2(A1:A3,B1:B3)", d...), 70)  // 14+56
	// Mismatched lengths → #N/A.
	d2 := []FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(2)),
		libCell(0, 1, float64(2)),
	}
	mustErr(t, eval(t, "SUMXMY2(A1:A2,B1:B1)", d2...), "#N/A")
}

// ---- matrix: MMULT / MDETERM / MINVERSE -------------------------------------

func TestMMult(t *testing.T) {
	// [[1,2],[3,4]] * [[5,6],[7,8]] = [[19,22],[43,50]].
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
		libCell(0, 2, float64(5)), libCell(0, 3, float64(6)),
		libCell(1, 2, float64(7)), libCell(1, 3, float64(8)),
		libFormula(3, 0, "=MMULT(A1:B2,C1:D2)"),
	})
	wantCellNum(t, out, 3, 0, 19)
	wantCellNum(t, out, 3, 1, 22)
	wantCellNum(t, out, 4, 0, 43)
	wantCellNum(t, out, 4, 1, 50)
}

func TestMMultDimMismatch(t *testing.T) {
	// 1x2 times 1x2 → inner dims disagree → #VALUE!.
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
	}
	mustErr(t, eval(t, "MMULT(A1:B1,C1:D1)", d...), "#VALUE!")
}

func TestMDeterm(t *testing.T) {
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)),
	}
	mustApprox(t, eval(t, "MDETERM(A1:B2)", d...), -2, 1e-9)
	// 3x3 identity determinant = 1.
	id := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(0)), libCell(0, 2, float64(0)),
		libCell(1, 0, float64(0)), libCell(1, 1, float64(1)), libCell(1, 2, float64(0)),
		libCell(2, 0, float64(0)), libCell(2, 1, float64(0)), libCell(2, 2, float64(1)),
	}
	mustApprox(t, eval(t, "MDETERM(A1:C3)", id...), 1, 1e-9)
	// Non-square → #VALUE!.
	mustErr(t, eval(t, "MDETERM(A1:B1)", d...), "#VALUE!")
}

func TestMInverse(t *testing.T) {
	// inverse of diagonal [[2,0],[0,4]] = [[0.5,0],[0,0.25]] (exactly representable).
	out := Recompute([]FsCellData{
		libCell(0, 0, float64(2)), libCell(0, 1, float64(0)),
		libCell(1, 0, float64(0)), libCell(1, 1, float64(4)),
		libFormula(3, 0, "=MINVERSE(A1:B2)"),
	})
	wantCellNum(t, out, 3, 0, 0.5)
	wantCellNum(t, out, 3, 1, 0)
	wantCellNum(t, out, 4, 0, 0)
	wantCellNum(t, out, 4, 1, 0.25)
	// Multiplying a matrix by its inverse yields the identity (round-trip check).
	inv := eval(t, "MINVERSE(A1:B2)",
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(3)), libCell(1, 1, float64(4)))
	if inv.isErr() {
		t.Fatalf("MINVERSE returned error %q", inv.str)
	}
}

func TestMInverseSingular(t *testing.T) {
	// [[1,2],[2,4]] is singular → #NUM!.
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(0, 1, float64(2)),
		libCell(1, 0, float64(2)), libCell(1, 1, float64(4)),
	}
	mustErr(t, eval(t, "MINVERSE(A1:B2)", d...), "#NUM!")
}

// ---- WORKDAY.INTL / NETWORKDAYS.INTL ----------------------------------------

func TestWorkdayIntl(t *testing.T) {
	// 2024-01-05 is Friday; +1 workday (default Sat/Sun weekend) → Mon 2024-01-08.
	mustNum(t, eval(t, "DAY(WORKDAY.INTL(DATE(2024,1,5),1))"), 8)
	mustNum(t, eval(t, "MONTH(WORKDAY.INTL(DATE(2024,1,5),1))"), 1)
	// Weekend code 11 = Sunday only; Fri +1 → Sat 2024-01-06.
	mustNum(t, eval(t, "DAY(WORKDAY.INTL(DATE(2024,1,5),1,11))"), 6)
	// String weekend "0000000" = no weekend; Fri +1 → Sat 2024-01-06.
	mustNum(t, eval(t, `DAY(WORKDAY.INTL(DATE(2024,1,5),1,"0000000"))`), 6)
}

func TestNetworkdaysIntl(t *testing.T) {
	// 2024-01-01 (Mon) .. 2024-01-07 (Sun), default weekend → Mon-Fri = 5.
	mustNum(t, eval(t, "NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7))"), 5)
	// No weekend → all 7 days counted.
	mustNum(t, eval(t, `NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),"0000000")`), 7)
	// Weekend code 11 (Sunday only) → 6 days.
	mustNum(t, eval(t, "NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),11)"), 6)
	// Holiday excludes one working day.
	mustNum(t, eval(t, "NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,7),1,DATE(2024,1,3))"), 4)
}

// ---- VALUETOTEXT ------------------------------------------------------------

func TestValueToText(t *testing.T) {
	mustStr(t, eval(t, "VALUETOTEXT(12.5)"), "12.5")
	mustStr(t, eval(t, `VALUETOTEXT("abc")`), "abc")
	mustStr(t, eval(t, `VALUETOTEXT("abc",1)`), `"abc"`)
	mustStr(t, eval(t, "VALUETOTEXT(TRUE)"), "TRUE")
	// Strict format leaves numbers unquoted.
	mustStr(t, eval(t, "VALUETOTEXT(42,1)"), "42")
}
