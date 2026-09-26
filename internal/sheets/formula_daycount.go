package sheets

import (
	"math"
	"time"
)

// formula_daycount.go — the day-count conventions (Excel's "basis" argument)
// and coupon-schedule arithmetic shared by the bond functions.
//
//	basis 0  US (NASD) 30/360
//	basis 1  actual/actual
//	basis 2  actual/360
//	basis 3  actual/365
//	basis 4  European 30/360
//
// Dates are whole serial numbers (Excel truncates date arguments).

// dcDate converts a serial to a calendar date.
func dcDate(serial float64) time.Time { return serialToTime(math.Floor(serial)) }

// dcSerial converts a calendar date to a serial.
func dcSerial(t time.Time) float64 { return timeToSerial(t) }

func dcIsLastOfFeb(t time.Time) bool {
	return t.Month() == time.February && t.Day() == dtDaysInMonth(t.Year(), 2)
}

// dcDays30360 counts days from d1 to d2 on a 30-day-month calendar.
// european selects the 30E/360 rule (both 31sts become 30ths); otherwise the
// US/NASD rule applies, including its end-of-February adjustments.
func dcDays30360(d1, d2 time.Time, european bool) float64 {
	y1, m1, dd1 := d1.Year(), int(d1.Month()), d1.Day()
	y2, m2, dd2 := d2.Year(), int(d2.Month()), d2.Day()
	if european {
		if dd1 == 31 {
			dd1 = 30
		}
		if dd2 == 31 {
			dd2 = 30
		}
	} else {
		if dcIsLastOfFeb(d1) && dcIsLastOfFeb(d2) {
			dd2 = 30
		}
		if dcIsLastOfFeb(d1) || dd1 == 31 {
			dd1 = 30
		}
		if dd2 == 31 && dd1 >= 30 {
			dd2 = 30
		}
	}
	return float64((y2-y1)*360 + (m2-m1)*30 + (dd2 - dd1))
}

// dcDays counts the days from serial s1 to s2 under basis.
func dcDays(s1, s2 float64, basis int) float64 {
	switch basis {
	case 0:
		return dcDays30360(dcDate(s1), dcDate(s2), false)
	case 4:
		return dcDays30360(dcDate(s1), dcDate(s2), true)
	}
	return math.Floor(s2) - math.Floor(s1)
}

// dcYearFrac is YEARFRAC(s1, s2, basis) as used by the discount and
// maturity-interest functions.
func dcYearFrac(s1, s2 float64, basis int) float64 { return finYearFrac(s1, s2, basis) }

// ---- coupon schedule ---------------------------------------------------------

// dcAddMonths moves t by months. When eom is set (the anchor date is the last
// day of its month) the result is the last day of the target month;
// otherwise the day is clamped to the target month's length.
func dcAddMonths(t time.Time, months int, eom bool) time.Time {
	y, m := t.Year(), int(t.Month())-1+months
	y += m / 12
	m %= 12
	if m < 0 {
		m += 12
		y--
	}
	dim := dtDaysInMonth(y, m+1)
	d := t.Day()
	if eom || d > dim {
		d = dim
	}
	return time.Date(y, time.Month(m+1), d, 0, 0, 0, 0, time.UTC)
}

func dcIsEOM(t time.Time) bool { return t.Day() == dtDaysInMonth(t.Year(), int(t.Month())) }

// dcCoupons locates settlement within the coupon schedule that runs back from
// maturity every 12/freq months: pcd is the last coupon date on or before
// settlement, ncd the next one after it, and num the number of coupons still
// payable (ncd … maturity).
func dcCoupons(settle, mat float64, freq int) (pcd, ncd float64, num int) {
	s, m := dcDate(settle), dcDate(mat)
	step := 12 / freq
	eom := dcIsEOM(m)
	months := (m.Year()-s.Year())*12 + int(m.Month()) - int(s.Month())
	coupon := func(k int) float64 { return dcSerial(dcAddMonths(m, -k*step, eom)) }
	// Find the smallest k ≥ 1 with coupon(k) <= settlement, starting from the
	// month-count estimate.
	k := months/step - 1
	if k < 1 {
		k = 1
	}
	for coupon(k) > settle {
		k++
	}
	for k > 1 && coupon(k-1) <= settle {
		k--
	}
	return coupon(k), coupon(k - 1), k
}

// dcCoupDays is COUPDAYS: the length of the coupon period containing
// settlement, in basis days.
func dcCoupDays(settle, mat float64, freq, basis int) float64 {
	switch basis {
	case 1:
		pcd, ncd, _ := dcCoupons(settle, mat, freq)
		return ncd - pcd
	case 3:
		return 365 / float64(freq)
	}
	return 360 / float64(freq)
}

// dcCoupDayBS is COUPDAYBS: days from the previous coupon to settlement.
func dcCoupDayBS(settle, mat float64, freq, basis int) float64 {
	pcd, _, _ := dcCoupons(settle, mat, freq)
	return dcDays(pcd, settle, basis)
}

// dcCoupDaysNC is COUPDAYSNC: days from settlement to the next coupon.
func dcCoupDaysNC(settle, mat float64, freq, basis int) float64 {
	if basis == 0 || basis == 4 {
		return dcCoupDays(settle, mat, freq, basis) - dcCoupDayBS(settle, mat, freq, basis)
	}
	_, ncd, _ := dcCoupons(settle, mat, freq)
	return dcDays(settle, ncd, basis)
}

// dcPeriodLen is the normal length of the quasi-coupon period [start, end]
// under basis (actual days for basis 1).
func dcPeriodLen(start, end float64, freq, basis int) float64 {
	switch basis {
	case 1:
		return end - start
	case 3:
		return 365 / float64(freq)
	}
	return 360 / float64(freq)
}
