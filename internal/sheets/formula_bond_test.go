package sheets

import (
	"math"
	"testing"
	"time"
)

func dateUTC(y, m, d int) time.Time { return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC) }

func finNear(t *testing.T, expr string, want, tol float64) {
	t.Helper()
	v := eval(t, expr)
	if v.kind != kindNum || math.Abs(v.num-want) > tol*math.Max(1, math.Abs(want)) {
		t.Fatalf("%s = %s, want %.12g", expr, describeValue(v), want)
	}
}

func TestDayCount30360(t *testing.T) {
	d := func(y1, m1, dd1, y2, m2, dd2 int, eu bool) float64 {
		return dcDays30360(dcDate(dcSerial(dateUTC(y1, m1, dd1))), dcDate(dcSerial(dateUTC(y2, m2, dd2))), eu)
	}
	if got := d(2011, 1, 31, 2011, 3, 31, false); got != 60 {
		t.Fatalf("US 31st→31st = %v, want 60", got)
	}
	if got := d(2011, 2, 28, 2011, 3, 31, false); got != 30 {
		t.Fatalf("US end of February = %v, want 30", got)
	}
	if got := d(2011, 1, 15, 2011, 3, 31, false); got != 76 {
		t.Fatalf("US start before 30th = %v, want 76", got)
	}
	if got := d(2011, 1, 15, 2011, 3, 31, true); got != 75 {
		t.Fatalf("European = %v, want 75", got)
	}
}

func TestCouponFunctions(t *testing.T) {
	finNear(t, "COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,1)", 71, 0)
	finNear(t, "COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,1)", 181, 0)
	finNear(t, "COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,1)", 110, 0)
	finNear(t, "COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,1)", 39217, 0) // 2007-05-15
	finNear(t, "COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2,1)", 39036, 0) // 2006-11-15
	finNear(t, "COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,1)", 4, 0)
	finNear(t, "COUPDAYS(DATE(2006,3,1),DATE(2006,11,1),2,3)", 182.5, 0)
	finNear(t, `COUPDAYBS("03/01/2006","09/01/2006",1,4)`, 180, 0)
	// End-of-month maturities keep month-end coupon dates.
	finNear(t, "COUPPCD(DATE(2011,3,15),DATE(2011,8,31),2,0)", 40602, 0) // 2011-02-28
	mustErr(t, eval(t, "COUPDAYS(40862,40568,1,0)"), "#NUM!")
	mustErr(t, eval(t, "COUPDAYS(40568,40862,3,1)"), "#NUM!")
	mustErr(t, eval(t, "COUPDAYS(40568,40862,1,5)"), "#NUM!")
	mustErr(t, eval(t, `COUPDAYS("abc",40862,1,0)`), "#VALUE!")
	mustErr(t, eval(t, "COUPDAYS(40568,NA(),1,0)"), "#N/A")
	mustErr(t, eval(t, "COUPNCD(40568,40862,,)"), "#N/A") // empty required argument
	finNear(t, "COUPDAYS(40568,40862,1,)", 360, 0)          // empty basis = 0
}

func TestBondPricesAndYields(t *testing.T) {
	finNear(t, "PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)", 94.6343616213221, 1e-10)
	finNear(t, "PRICE(DATE(2025,1,1),DATE(2030,1,1),0.05,0.06,100,2,0)", 95.7348985816121, 1e-10)
	finNear(t, "YIELD(DATE(2008,2,15),DATE(2016,11,15),0.0575,95.04287,100,2,0)", 0.065, 1e-6)
	finNear(t, "YIELD(38777,38838,0.1,100,100,2,0)", 0.0967741935483875, 1e-12)
	finNear(t, "PRICEDISC(DATE(2008,2,16),DATE(2008,3,1),0.0525,100,2)", 99.79583333, 1e-9)
	finNear(t, "YIELDDISC(DATE(2008,2,16),DATE(2008,3,1),99.795,100,2)", 0.052823, 1e-5)
	finNear(t, "PRICEMAT(DATE(2008,2,15),DATE(2008,4,13),DATE(2007,11,11),0.061,0.061,0)", 99.98449888, 1e-9)
	finNear(t, "YIELDMAT(DATE(2008,3,15),DATE(2008,11,3),DATE(2007,11,8),0.0625,100.0123,0)", 0.060954, 1e-5)
	finNear(t, "ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)", 20.54794521, 1e-9)
	finNear(t, "ACCRINT(DATE(2008,3,1),DATE(2008,8,31),DATE(2008,5,1),0.1,1000,2,0)", 16.6666666667, 1e-9)
	finNear(t, "ACCRINT(39508,39691,39769,1,1000,2,0)", 713.888888889, 1e-9)
	finNear(t, "ACCRINT(39508,39691,39769,1,1000,2,0,FALSE)", 711.111111111, 1e-9)
	finNear(t, "ODDLPRICE(DATE(2006,3,1),DATE(2006,5,1),DATE(2006,1,1),0.05,0.06,100,2,0)", 99.8267326732673, 1e-12)
	finNear(t, "ODDLYIELD(DATE(2008,4,20),DATE(2008,6,15),DATE(2007,12,24),0.0375,99.875,100,2,0)", 0.0451922, 1e-6)
	finNear(t, "DURATION(DATE(2018,7,1),DATE(2048,1,1),0.08,0.09,2,1)", 10.9191453, 1e-7)
	finNear(t, "MDURATION(39448,46752,0.05,0.06,2,0)", 12.0087621333493, 1e-10)
	mustErr(t, eval(t, "PRICE(DATE(2025,7,1),DATE(2030,7,1),0.05,0.06,100,3,0)"), "#NUM!")
	mustErr(t, eval(t, "YIELD(38777,38838,0.1,0,100,2,0)"), "#NUM!")
}

func TestOddFirstPeriod(t *testing.T) {
	// A long first period priced and then solved back for its yield.
	price := eval(t, "ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)")
	if price.kind != kindNum || math.Abs(price.num-113.597717) > 1e-4 {
		t.Fatalf("ODDFPRICE = %s, want ≈113.5977", describeValue(price))
	}
	finNear(t, "ODDFYIELD(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0575,84.5,100,2,0)", 0.0772455, 1e-6)
	mustErr(t, eval(t, "ODDFPRICE(DATE(2027,1,1),DATE(2025,7,1),DATE(2024,7,1),DATE(2025,7,1),0.05,0.06,100,2,0)"), "#NUM!")
}

func TestDepreciation(t *testing.T) {
	finNear(t, "VDB(2400,300,10*365,0,1)", 1.31506849315065, 1e-12)
	finNear(t, "VDB(2400,300,10*12,6,18)", 396.306053264752, 1e-12)
	finNear(t, "VDB(100,0,5,3,4,2,TRUE)", 8.64, 1e-12)
	finNear(t, "VDB(100,0,5,3,4,2,FALSE)", 10.8, 1e-12)
	finNear(t, "VDB(1000,500,10,0.000001,1,2,FALSE)", 199.99976000004, 1e-12)
	finNear(t, "VDB(100000,11000,8,0,1,)", 11125, 1e-12) // empty factor = 0: straight line
	finNear(t, "VDB(100,300,8,0,1)", -200, 1e-12)
	mustErr(t, eval(t, "VDB(0,0,0,0,0)"), "#DIV/0!")
	mustErr(t, eval(t, "VDB(100,200,8,1,0.75)"), "#NUM!")
	finNear(t, "AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)", 360, 1e-12)
	finNear(t, "AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.70,1)", 1484.918033, 1e-9)
	finNear(t, "AMORLINC(150000,DATE(2008,8,1),DATE(2008,12,31),15000,0,0.2)", 12500, 1e-12)
	finNear(t, "AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)", 776, 0)
	finNear(t, "AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,0)", 330, 0)
	mustErr(t, eval(t, "AMORDEGRC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.50,0)"), "#NUM!")
}

// The argument guards make error arguments propagate and reject multi-cell
// ranges in the older scalar financial/engineering functions.
func TestArgumentGuards(t *testing.T) {
	mustErr(t, eval(t, "FV(0.01,12,-100,NA(),0)"), "#N/A")
	mustErr(t, eval(t, `FV(0.01,12,-100,0,"abc")`), "#VALUE!")
	mustErr(t, eval(t, "DB(#N/A,100000,6,1,7)"), "#N/A")
	mustErr(t, eval(t, "CUMIPMT(#DIV/0!,360,125000,13,24,0)"), "#DIV/0!")
	mustErr(t, eval(t, "ERF(FALSE)"), "#VALUE!")
	mustErr(t, eval(t, "ERF(1,)"), "#N/A")
	mustErr(t, eval(t, "ERFC(NA())"), "#N/A")
	mustErr(t, eval(t, "HEX2DEC(TRUE)"), "#VALUE!")
	mustErr(t, eval(t, "DELTA(5,1/0)"), "#DIV/0!")
	mustNum(t, eval(t, "FV(0.01,12,-100,0,0)"), 1268.2503013196976)
	mustErr(t, eval(t, "SLN(A1:A2,1,1)", cell(0, 0, 1), cell(1, 0, 2)), "#VALUE!")
	// DEC2BIN's [places] is capped at 10 (a huge value used to panic).
	mustErr(t, eval(t, "DEC2BIN(1,1E+10)"), "#NUM!")
	mustErr(t, eval(t, "HEX2BIN(1,1E+300)"), "#NUM!")
}

func TestAggregateKFunctions(t *testing.T) {
	cells := []FsCellData{cell(0, 0, 5), cell(1, 0, 9), cell(2, 0, 1), cell(3, 0, 7)}
	mustNum(t, eval(t, "AGGREGATE(14,6,A1:A4,2)", cells...), 7)
	mustNum(t, eval(t, "AGGREGATE(15,6,A1:A4,1)", cells...), 1)
	mustNum(t, eval(t, "AGGREGATE(19,6,A1:A4,2)", cells...), 6) // QUARTILE.EXC
}

func TestBaseConversionEdgeCases(t *testing.T) {
	mustNum(t, eval(t, `HEX2DEC("")`), 0)
	mustStr(t, eval(t, `OCT2HEX("")`), "0")
	mustErr(t, eval(t, `BIN2DEC(" 101")`), "#NUM!")
	mustNum(t, eval(t, "BITLSHIFT(10,4.9)"), 160)
	mustNum(t, eval(t, "BITRSHIFT(100,2.7)"), 25)
}

func TestLegacyFinancialFixes(t *testing.T) {
	finNear(t, "CUMIPMT(0.12/12,10*12,50000,25,75,1)", -18158.8803239073, 1e-10) // beginning-of-period interest
	mustErr(t, eval(t, "CUMIPMT(0.09/12,360,125000,13,24,2)"), "#NUM!")
	finNear(t, "DB(1000000,100000,6,1,7.5)", 186083.333333333, 1e-10) // month is truncated
	finNear(t, "DDB(1000000,100000,6,1.99,2)", 223125.085, 1e-8)     // fractional period
	finNear(t, "DDB(2400,300,10,1,2)", 480, 1e-12)
	finNear(t, "DDB(2400,300,10,10,2)", 22.1225472, 1e-7)
}
