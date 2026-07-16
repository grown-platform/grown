package sheets

import "testing"

// ---- DOLLARDE / DOLLARFR ----------------------------------------------------

func TestDollarDeFr(t *testing.T) {
	// 1.02 read in 16ths = 1 + 2/16 = 1.125.
	mustApprox(t, eval(t, "DOLLARDE(1.02,16)"), 1.125, 1e-9)
	// 1.1 read in 32nds = 1 + 10/32 = 1.3125 (Excel example).
	mustApprox(t, eval(t, "DOLLARDE(1.1,32)"), 1.3125, 1e-9)
	// DOLLARFR is the inverse of DOLLARDE.
	mustApprox(t, eval(t, "DOLLARFR(1.125,16)"), 1.02, 1e-9)
	mustApprox(t, eval(t, "DOLLARFR(1.3125,32)"), 1.1, 1e-9)
	// Round-trip.
	mustApprox(t, eval(t, "DOLLARDE(DOLLARFR(1.234,8),8)"), 1.234, 1e-9)
	// fraction 0 → #DIV/0!, negative → #NUM!.
	mustErr(t, eval(t, "DOLLARDE(1.02,0)"), "#DIV/0!")
	mustErr(t, eval(t, "DOLLARFR(1.02,-4)"), "#NUM!")
}

// ---- ISPMT ------------------------------------------------------------------

func TestISPmt(t *testing.T) {
	// Excel worked example: interest for period 1 of a 3-year monthly loan.
	mustApprox(t, eval(t, "ISPMT(0.1/12,1,3*12,8000000)"), -64814.8148148, 1e-4)
	// Final period accrues no interest (per == nper → factor 0).
	mustApprox(t, eval(t, "ISPMT(0.1,10,10,1000)"), 0, 1e-9)
	// nper 0 → #DIV/0!.
	mustErr(t, eval(t, "ISPMT(0.1,1,0,1000)"), "#DIV/0!")
}

// ---- DISC / INTRATE / RECEIVED ----------------------------------------------

func TestDisc(t *testing.T) {
	// settlement..maturity = half a year (30/360 basis 0 → yearfrac 0.5).
	// DISC = (100-97.975)/100 / 0.5 = 0.0405.
	mustApprox(t, eval(t, "DISC(DATE(2018,1,1),DATE(2018,7,1),97.975,100,0)"), 0.0405, 1e-9)
	// settlement >= maturity → #NUM!.
	mustErr(t, eval(t, "DISC(DATE(2018,7,1),DATE(2018,1,1),97.975,100,0)"), "#NUM!")
	// invalid basis.
	mustErr(t, eval(t, "DISC(DATE(2018,1,1),DATE(2018,7,1),97.975,100,9)"), "#NUM!")
}

func TestIntrate(t *testing.T) {
	// INTRATE = (1014.5-1000)/1000 / 0.5 = 0.029.
	mustApprox(t, eval(t, "INTRATE(DATE(2018,1,1),DATE(2018,7,1),1000,1014.5,0)"), 0.029, 1e-9)
	mustErr(t, eval(t, "INTRATE(DATE(2018,1,1),DATE(2018,7,1),0,1014.5,0)"), "#NUM!")
}

func TestReceived(t *testing.T) {
	// RECEIVED = 1000 / (1 - 0.05*0.5) = 1025.641...
	mustApprox(t, eval(t, "RECEIVED(DATE(2018,1,1),DATE(2018,7,1),1000,0.05,0)"), 1025.6410256, 1e-6)
	mustErr(t, eval(t, "RECEIVED(DATE(2018,1,1),DATE(2018,7,1),1000,-0.05,0)"), "#NUM!")
}

// ---- Treasury bills ---------------------------------------------------------

func TestTBill(t *testing.T) {
	// 2018-01-01 .. 2018-07-01 is 181 actual days.
	// PRICE = 100*(1 - 0.05*181/360) = 97.48611.
	mustApprox(t, eval(t, "TBILLPRICE(DATE(2018,1,1),DATE(2018,7,1),0.05)"), 97.4861111, 1e-6)
	// YIELD from that price recovers a rate close to the discount.
	mustApprox(t, eval(t, "TBILLYIELD(DATE(2018,1,1),DATE(2018,7,1),97.4861111)"), 0.0512894, 1e-6)
	// Bond-equivalent yield.
	mustApprox(t, eval(t, "TBILLEQ(DATE(2018,1,1),DATE(2018,7,1),0.05)"), 0.0520017, 1e-6)
	// Maturity more than a year out → #NUM!.
	mustErr(t, eval(t, "TBILLPRICE(DATE(2018,1,1),DATE(2019,7,1),0.05)"), "#NUM!")
	mustErr(t, eval(t, "TBILLPRICE(DATE(2018,7,1),DATE(2018,1,1),0.05)"), "#NUM!")
}

// ---- ACCRINT ----------------------------------------------------------------

func TestAccrint(t *testing.T) {
	// Microsoft example (30/360 basis): issue 3/1/2008, settlement 5/1/2008,
	// rate 10%, par 1000, freq 2 → accrued = 1000*0.1*(60/360) = 16.6667.
	mustApprox(t, eval(t, "ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"), 16.6666667, 1e-6)
	// issue >= settlement → #NUM!.
	mustErr(t, eval(t, "ACCRINT(DATE(2008,6,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)"), "#NUM!")
	// Invalid frequency.
	mustErr(t, eval(t, "ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,3,0)"), "#NUM!")
}

// ---- DURATION / MDURATION ---------------------------------------------------

func TestDuration(t *testing.T) {
	// 8-year semiannual bond, 8% coupon, 9% yield, coupon-aligned dates so the
	// partial-period offset is exactly zero. Reference (matches Excel's published
	// example value): Macaulay duration = 5.9937750, modified = 5.7356698.
	mustApprox(t, eval(t, "DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)"), 5.9937750, 1e-5)
	mustApprox(t, eval(t, "MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)"), 5.7356698, 1e-5)
	// MDURATION = DURATION / (1 + yield/freq).
	mustApprox(t, eval(t, "MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)*(1+0.09/2)"), 5.9937750, 1e-5)
	// Bad frequency and bad basis.
	mustErr(t, eval(t, "DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,3,0)"), "#NUM!")
	mustErr(t, eval(t, "DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,7)"), "#NUM!")
	// settlement >= maturity.
	mustErr(t, eval(t, "DURATION(DATE(2016,1,1),DATE(2008,1,1),0.08,0.09,2,0)"), "#NUM!")
}

// ---- ERF / ERFC -------------------------------------------------------------

func TestErf(t *testing.T) {
	mustApprox(t, eval(t, "ERF(1)"), 0.8427008, 1e-6)
	mustApprox(t, eval(t, "ERF.PRECISE(1)"), 0.8427008, 1e-6)
	mustApprox(t, eval(t, "ERFC(1)"), 0.1572992, 1e-6)
	mustApprox(t, eval(t, "ERFC.PRECISE(1)"), 0.1572992, 1e-6)
	// ERF + ERFC = 1.
	mustApprox(t, eval(t, "ERF(0.7)+ERFC(0.7)"), 1, 1e-9)
	// Two-argument ERF(lower, upper) = erf(upper) - erf(lower).
	mustApprox(t, eval(t, "ERF(1,2)"), 0.1526215, 1e-6)
	// ERF(0) = 0.
	mustApprox(t, eval(t, "ERF(0)"), 0, 1e-9)
}

// ---- MUNIT ------------------------------------------------------------------

func TestMUnit(t *testing.T) {
	// 3x3 identity spills across a 3x3 block.
	out := Recompute([]FsCellData{libFormula(0, 0, "=MUNIT(3)")})
	wantCellNum(t, out, 0, 0, 1)
	wantCellNum(t, out, 0, 1, 0)
	wantCellNum(t, out, 1, 1, 1)
	wantCellNum(t, out, 2, 2, 1)
	wantCellNum(t, out, 2, 0, 0)
	// n < 1 → #VALUE!.
	mustErr(t, eval(t, "MUNIT(0)"), "#VALUE!")
}

// ---- SERIESSUM --------------------------------------------------------------

func TestSeriesSum(t *testing.T) {
	d := []FsCellData{
		libCell(0, 0, float64(1)), libCell(1, 0, float64(1)), libCell(2, 0, float64(1)),
	}
	// x=2, n=0, m=1, coeffs {1,1,1} → 2^0+2^1+2^2 = 7.
	mustApprox(t, eval(t, "SERIESSUM(2,0,1,A1:A3)", d...), 7, 1e-9)
	// x=2, n=1, m=0, coeffs {1,1,1} → 3*2^1 = 6.
	mustApprox(t, eval(t, "SERIESSUM(2,1,0,A1:A3)", d...), 6, 1e-9)
	// Inline array constant.
	mustApprox(t, eval(t, "SERIESSUM(2,0,1,{1,1,1})"), 7, 1e-9)
}
