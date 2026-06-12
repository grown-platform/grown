package sheets

// formula_datetime.go — Excel-compatible date & time worksheet functions.
//
// Dates are represented as Excel serial numbers (serial 1 == 1900-01-01) using
// the shared helpers serialToTime / timeToSerial and the excelEpoch defined in
// formula.go. Unexported helpers in this file are prefixed with "dt" to avoid
// collisions with the rest of the package.
//
// Note: TODAY and NOW are registered in formula.go and are NOT re-registered
// here.

import (
	"math"
	"strconv"
	"strings"
	"time"
)

func init() {
	registerFunc("DATE", func(c *callCtx) value { return dtDate(c) })
	registerFunc("TIME", func(c *callCtx) value { return dtTime(c) })
	registerFunc("YEAR", func(c *callCtx) value { return dtComponent(c, dtCompYear) })
	registerFunc("MONTH", func(c *callCtx) value { return dtComponent(c, dtCompMonth) })
	registerFunc("DAY", func(c *callCtx) value { return dtComponent(c, dtCompDay) })
	registerFunc("HOUR", func(c *callCtx) value { return dtComponent(c, dtCompHour) })
	registerFunc("MINUTE", func(c *callCtx) value { return dtComponent(c, dtCompMinute) })
	registerFunc("SECOND", func(c *callCtx) value { return dtComponent(c, dtCompSecond) })
	registerFunc("WEEKDAY", func(c *callCtx) value { return dtWeekday(c) })
	registerFunc("WEEKNUM", func(c *callCtx) value { return dtWeeknum(c) })
	registerFunc("ISOWEEKNUM", func(c *callCtx) value { return dtIsoWeeknum(c) })
	registerFunc("EDATE", func(c *callCtx) value { return dtEdate(c) })
	registerFunc("EOMONTH", func(c *callCtx) value { return dtEomonth(c) })
	registerFunc("DATEDIF", func(c *callCtx) value { return dtDatedif(c) })
	registerFunc("DAYS", func(c *callCtx) value { return dtDays(c) })
	registerFunc("DAYS360", func(c *callCtx) value { return dtDays360(c) })
	registerFunc("NETWORKDAYS", func(c *callCtx) value { return dtNetworkdays(c) })
	registerFunc("WORKDAY", func(c *callCtx) value { return dtWorkday(c) })
	registerFunc("DATEVALUE", func(c *callCtx) value { return dtDatevalue(c) })
	registerFunc("TIMEVALUE", func(c *callCtx) value { return dtTimevalue(c) })
	registerFunc("YEARFRAC", func(c *callCtx) value { return dtYearfrac(c) })
}

// dtArgErr returns the first error found among the scalar values of args [0..n).
// ok is true if no error was found.
func dtArgErr(c *callCtx, n int) (value, bool) {
	for i := 0; i < n && i < c.nargs(); i++ {
		v := c.scalar(i)
		if v.isErr() {
			return v, false
		}
	}
	return value{}, true
}

// dtSerialArg coerces argument i to an Excel serial number (numeric). Negative
// serials are an Excel #NUM! error. Returns the serial and an optional error.
func dtSerialArg(c *callCtx, i int) (float64, value, bool) {
	v := c.scalar(i)
	if v.isErr() {
		return 0, v, false
	}
	n, ok := v.toNum()
	if !ok {
		return 0, errValue, false
	}
	if n < 0 {
		return 0, errNum, false
	}
	return n, value{}, true
}

// ---- DATE / TIME ------------------------------------------------------------

// dtDate implements DATE(year, month, day). time.Date already normalises
// overflow/underflow in month and day, matching Excel's behaviour. Years 0..1899
// are interpreted as 1900..3799 per Excel.
func dtDate(c *callCtx) value {
	if c.nargs() < 3 {
		return errValue
	}
	if e, ok := dtArgErr(c, 3); !ok {
		return e
	}
	yf, ok1 := c.num(0)
	mf, ok2 := c.num(1)
	df, ok3 := c.num(2)
	if !ok1 || !ok2 || !ok3 {
		return errValue
	}
	year := int(math.Trunc(yf))
	month := int(math.Trunc(mf))
	day := int(math.Trunc(df))
	if year < 0 || year > 9999 {
		return errNum
	}
	if year < 1900 {
		year += 1900
	}
	// time.Date normalises month/day overflow. Month is 1-based in Excel.
	t := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
	serial := timeToSerial(t)
	if serial < 0 {
		return errNum
	}
	return numVal(serial)
}

// dtTime implements TIME(hour, minute, second) → day fraction in [0,1).
func dtTime(c *callCtx) value {
	if c.nargs() < 3 {
		return errValue
	}
	if e, ok := dtArgErr(c, 3); !ok {
		return e
	}
	hf, ok1 := c.num(0)
	mf, ok2 := c.num(1)
	sf, ok3 := c.num(2)
	if !ok1 || !ok2 || !ok3 {
		return errValue
	}
	totalSecs := math.Trunc(hf)*3600 + math.Trunc(mf)*60 + math.Trunc(sf)
	if totalSecs < 0 {
		return errNum
	}
	frac := totalSecs / 86400.0
	// Excel keeps only the fractional day part.
	frac = frac - math.Floor(frac)
	return numVal(frac)
}

// ---- Component extraction ---------------------------------------------------

type dtComp int

const (
	dtCompYear dtComp = iota
	dtCompMonth
	dtCompDay
	dtCompHour
	dtCompMinute
	dtCompSecond
)

func dtComponent(c *callCtx, comp dtComp) value {
	if c.nargs() < 1 {
		return errValue
	}
	serial, e, ok := dtSerialArg(c, 0)
	if !ok {
		return e
	}
	t := serialToTime(serial)
	switch comp {
	case dtCompYear:
		return numVal(float64(t.Year()))
	case dtCompMonth:
		return numVal(float64(int(t.Month())))
	case dtCompDay:
		return numVal(float64(t.Day()))
	case dtCompHour:
		return numVal(float64(t.Hour()))
	case dtCompMinute:
		return numVal(float64(t.Minute()))
	case dtCompSecond:
		return numVal(float64(t.Second()))
	}
	return errValue
}

// ---- WEEKDAY / WEEKNUM / ISOWEEKNUM ----------------------------------------

func dtWeekday(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	serial, e, ok := dtSerialArg(c, 0)
	if !ok {
		return e
	}
	typeNum := 1
	if c.nargs() >= 2 {
		tv := c.scalar(1)
		if tv.isErr() {
			return tv
		}
		tf, tok := tv.toNum()
		if !tok {
			return errValue
		}
		typeNum = int(math.Trunc(tf))
	}
	t := serialToTime(serial)
	// Go: Sunday=0 .. Saturday=6.
	wd := int(t.Weekday())
	switch typeNum {
	case 1, 17: // Sun=1 .. Sat=7
		return numVal(float64(wd + 1))
	case 2, 11: // Mon=1 .. Sun=7
		return numVal(float64((wd+6)%7 + 1))
	case 3: // Mon=0 .. Sun=6
		return numVal(float64((wd + 6) % 7))
	case 12: // Tue=1 .. Mon=7
		return numVal(float64((wd+5)%7 + 1))
	case 13: // Wed=1 .. Tue=7
		return numVal(float64((wd+4)%7 + 1))
	case 14: // Thu=1 .. Wed=7
		return numVal(float64((wd+3)%7 + 1))
	case 15: // Fri=1 .. Thu=7
		return numVal(float64((wd+2)%7 + 1))
	case 16: // Sat=1 .. Fri=7
		return numVal(float64((wd+1)%7 + 1))
	default:
		return errNum
	}
}

// dtWeeknum implements WEEKNUM(serial,[return_type]). Counts weeks where the
// week containing Jan 1 is week 1. return_type selects the first day of the
// week. Types 1 (default) and 17 start Sunday; 2/11..16/21 follow Excel's
// system-1 conventions. Type 21 is ISO week number.
func dtWeeknum(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	serial, e, ok := dtSerialArg(c, 0)
	if !ok {
		return e
	}
	returnType := 1
	if c.nargs() >= 2 {
		tv := c.scalar(1)
		if tv.isErr() {
			return tv
		}
		tf, tok := tv.toNum()
		if !tok {
			return errValue
		}
		returnType = int(math.Trunc(tf))
	}
	if returnType == 21 {
		return dtIsoWeeknumFromSerial(serial)
	}
	// Map return_type → the weekday (Go: Sun=0..Sat=6) that starts the week.
	var startDay int
	switch returnType {
	case 1, 17:
		startDay = 0 // Sunday
	case 2, 11:
		startDay = 1 // Monday
	case 12:
		startDay = 2 // Tuesday
	case 13:
		startDay = 3 // Wednesday
	case 14:
		startDay = 4 // Thursday
	case 15:
		startDay = 5 // Friday
	case 16:
		startDay = 6 // Saturday
	default:
		return errNum
	}
	t := serialToTime(serial)
	jan1 := time.Date(t.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	// Day-of-year (1-based).
	doy := t.YearDay()
	// Weekday of Jan 1, re-based so that startDay == 0.
	jan1Offset := (int(jan1.Weekday()) - startDay + 7) % 7
	week := (doy+jan1Offset-1)/7 + 1
	return numVal(float64(week))
}

func dtIsoWeeknum(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	serial, e, ok := dtSerialArg(c, 0)
	if !ok {
		return e
	}
	return dtIsoWeeknumFromSerial(serial)
}

func dtIsoWeeknumFromSerial(serial float64) value {
	t := serialToTime(serial)
	_, week := t.ISOWeek()
	return numVal(float64(week))
}

// ---- EDATE / EOMONTH --------------------------------------------------------

// dtAddMonths returns the date `months` months after t, clamping the day to the
// last valid day of the resulting month (Excel semantics — no day overflow).
func dtAddMonths(t time.Time, months int) time.Time {
	y := t.Year()
	m := int(t.Month()) - 1 + months // 0-based month arithmetic
	y += m / 12
	m = m % 12
	if m < 0 {
		m += 12
		y--
	}
	day := t.Day()
	last := dtDaysInMonth(y, m+1)
	if day > last {
		day = last
	}
	return time.Date(y, time.Month(m+1), day, 0, 0, 0, 0, time.UTC)
}

func dtDaysInMonth(year, month int) int {
	// Day 0 of the next month == last day of this month.
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func dtEdate(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	serial, e, ok := dtSerialArg(c, 0)
	if !ok {
		return e
	}
	mv := c.scalar(1)
	if mv.isErr() {
		return mv
	}
	mf, mok := mv.toNum()
	if !mok {
		return errValue
	}
	t := serialToTime(serial)
	res := dtAddMonths(t, int(math.Trunc(mf)))
	out := timeToSerial(res)
	if out < 0 {
		return errNum
	}
	return numVal(out)
}

func dtEomonth(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	serial, e, ok := dtSerialArg(c, 0)
	if !ok {
		return e
	}
	mv := c.scalar(1)
	if mv.isErr() {
		return mv
	}
	mf, mok := mv.toNum()
	if !mok {
		return errValue
	}
	t := serialToTime(serial)
	res := dtAddMonths(t, int(math.Trunc(mf)))
	last := dtDaysInMonth(res.Year(), int(res.Month()))
	eom := time.Date(res.Year(), res.Month(), last, 0, 0, 0, 0, time.UTC)
	out := timeToSerial(eom)
	if out < 0 {
		return errNum
	}
	return numVal(out)
}

// ---- DATEDIF ----------------------------------------------------------------

func dtDatedif(c *callCtx) value {
	if c.nargs() < 3 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	endSerial, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return e2
	}
	unitV := c.scalar(2)
	if unitV.isErr() {
		return unitV
	}
	unit := strings.ToUpper(strings.TrimSpace(unitV.toStr()))
	start := serialToTime(startSerial)
	end := serialToTime(endSerial)
	if end.Before(start) {
		return errNum
	}

	switch unit {
	case "Y":
		return numVal(float64(dtCompleteYears(start, end)))
	case "M":
		return numVal(float64(dtCompleteMonths(start, end)))
	case "D":
		return numVal(math.Floor(endSerial) - math.Floor(startSerial))
	case "MD":
		// Difference of days, ignoring months and years.
		d := end.Day() - start.Day()
		if d < 0 {
			// Borrow days from the month before `end`.
			pm := end.AddDate(0, -1, 0)
			d += dtDaysInMonth(pm.Year(), int(pm.Month()))
		}
		return numVal(float64(d))
	case "YM":
		// Months difference, ignoring years and days.
		m := (int(end.Month()) - int(start.Month()) + 12) % 12
		if end.Day() < start.Day() {
			m = (m - 1 + 12) % 12
		}
		return numVal(float64(m))
	case "YD":
		// Days difference, ignoring years.
		anchor := time.Date(end.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
		if anchor.After(end) {
			anchor = time.Date(end.Year()-1, start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
		}
		days := int(math.Round(end.Sub(anchor).Hours() / 24))
		return numVal(float64(days))
	default:
		return errNum
	}
}

// dtCompleteYears returns whole years between start and end (end >= start).
func dtCompleteYears(start, end time.Time) int {
	years := end.Year() - start.Year()
	anniv := time.Date(start.Year()+years, start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	if anniv.After(end) {
		years--
	}
	return years
}

// dtCompleteMonths returns whole months between start and end (end >= start).
func dtCompleteMonths(start, end time.Time) int {
	months := (end.Year()-start.Year())*12 + (int(end.Month()) - int(start.Month()))
	if end.Day() < start.Day() {
		months--
	}
	if months < 0 {
		months = 0
	}
	return months
}

// ---- DAYS / DAYS360 ---------------------------------------------------------

func dtDays(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	endSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	startSerial, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return e2
	}
	return numVal(math.Floor(endSerial) - math.Floor(startSerial))
}

func dtDays360(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	endSerial, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return e2
	}
	european := false
	if c.nargs() >= 3 {
		mv := c.scalar(2)
		if mv.isErr() {
			return mv
		}
		european = mv.isTruthy()
	}
	start := serialToTime(startSerial)
	end := serialToTime(endSerial)

	d1 := start.Day()
	d2 := end.Day()
	m1 := int(start.Month())
	m2 := int(end.Month())
	y1 := start.Year()
	y2 := end.Year()

	if european {
		if d1 == 31 {
			d1 = 30
		}
		if d2 == 31 {
			d2 = 30
		}
	} else {
		// US (NASD) method.
		if d1 == dtDaysInMonth(y1, m1) {
			d1 = 30
		}
		if d2 == 31 && d1 == 30 {
			d2 = 30
		}
	}
	days := (y2-y1)*360 + (m2-m1)*30 + (d2 - d1)
	return numVal(float64(days))
}

// ---- NETWORKDAYS / WORKDAY --------------------------------------------------

// dtHolidaySet collects holiday serials (as whole-day floor values) from an
// optional range/scalar argument starting at index i. Returns a set and an
// optional propagated error.
func dtHolidaySet(c *callCtx, i int) (map[int64]struct{}, value, bool) {
	set := make(map[int64]struct{})
	if c.nargs() <= i {
		return set, value{}, true
	}
	rv, ok := c.rangeArg(i)
	if !ok {
		return set, value{}, true
	}
	for _, v := range rv.flat() {
		if v.isErr() {
			return nil, v, false
		}
		if v.kind == kindStr && v.str == "" {
			continue
		}
		n, nok := v.toNum()
		if !nok {
			continue
		}
		set[int64(math.Floor(n))] = struct{}{}
	}
	return set, value{}, true
}

func dtIsWeekend(t time.Time) bool {
	wd := t.Weekday()
	return wd == time.Saturday || wd == time.Sunday
}

func dtNetworkdays(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	endSerial, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return e2
	}
	holidays, he, hok := dtHolidaySet(c, 2)
	if !hok {
		return he
	}

	s := int64(math.Floor(startSerial))
	e := int64(math.Floor(endSerial))
	sign := 1
	if s > e {
		s, e = e, s
		sign = -1
	}
	count := 0
	for d := s; d <= e; d++ {
		t := serialToTime(float64(d))
		if dtIsWeekend(t) {
			continue
		}
		if _, isHol := holidays[d]; isHol {
			continue
		}
		count++
	}
	return numVal(float64(sign * count))
}

func dtWorkday(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	dv := c.scalar(1)
	if dv.isErr() {
		return dv
	}
	df, dok := dv.toNum()
	if !dok {
		return errValue
	}
	holidays, he, hok := dtHolidaySet(c, 2)
	if !hok {
		return he
	}

	days := int(math.Trunc(df))
	cur := int64(math.Floor(startSerial))
	if days == 0 {
		return numVal(float64(cur))
	}
	step := int64(1)
	remaining := days
	if days < 0 {
		step = -1
		remaining = -days
	}
	for remaining > 0 {
		cur += step
		t := serialToTime(float64(cur))
		if dtIsWeekend(t) {
			continue
		}
		if _, isHol := holidays[cur]; isHol {
			continue
		}
		remaining--
	}
	if cur < 0 {
		return errNum
	}
	return numVal(float64(cur))
}

// ---- DATEVALUE / TIMEVALUE --------------------------------------------------

// dtDateLayouts are the date formats accepted by DATEVALUE (no time part).
var dtDateLayouts = []string{
	"2006-01-02",
	"2006/01/02",
	"01/02/2006",
	"1/2/2006",
	"01-02-2006",
	"1-2-2006",
	"2 Jan 2006",
	"2-Jan-2006",
	"2 January 2006",
	"January 2, 2006",
	"Jan 2, 2006",
	"Jan 2 2006",
	"02 Jan 2006",
}

func dtParseDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range dtDateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), true
		}
	}
	return time.Time{}, false
}

func dtDatevalue(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	s := strings.TrimSpace(v.toStr())
	// A bare numeric string is already a serial.
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return numVal(math.Floor(f))
	}
	t, ok := dtParseDate(s)
	if !ok {
		return errValue
	}
	serial := timeToSerial(t)
	if serial < 0 {
		return errValue
	}
	return numVal(math.Floor(serial))
}

// dtTimeLayouts are the time-of-day formats accepted by TIMEVALUE.
var dtTimeLayouts = []string{
	"15:04:05",
	"15:04",
	"3:04:05 PM",
	"3:04 PM",
	"3:04:05PM",
	"3:04PM",
	"3 PM",
	"3PM",
}

func dtParseTime(s string) (time.Duration, bool) {
	s = strings.TrimSpace(s)
	// Normalise lowercase am/pm to upper for Go's reference parser.
	up := strings.ToUpper(s)
	for _, layout := range dtTimeLayouts {
		if t, err := time.Parse(layout, up); err == nil {
			d := time.Duration(t.Hour())*time.Hour +
				time.Duration(t.Minute())*time.Minute +
				time.Duration(t.Second())*time.Second
			return d, true
		}
	}
	return 0, false
}

func dtTimevalue(c *callCtx) value {
	if c.nargs() < 1 {
		return errValue
	}
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	s := strings.TrimSpace(v.toStr())
	if s == "" {
		return errValue
	}
	// If the text also contains a date, strip the date and keep the time.
	if t, ok := dtParseDateTime(s); ok {
		secs := float64(t.Hour())*3600 + float64(t.Minute())*60 + float64(t.Second())
		return numVal(secs / 86400.0)
	}
	d, ok := dtParseTime(s)
	if !ok {
		return errValue
	}
	return numVal(d.Seconds() / 86400.0)
}

// dtParseDateTime attempts to parse a combined date+time string, returning the
// parsed time. Used so TIMEVALUE can ignore the date component.
func dtParseDateTime(s string) (time.Time, bool) {
	layouts := []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"01/02/2006 15:04:05",
		"01/02/2006 15:04",
		"1/2/2006 15:04",
		"2006-01-02 3:04 PM",
		"01/02/2006 3:04 PM",
	}
	up := strings.ToUpper(strings.TrimSpace(s))
	for _, layout := range layouts {
		if t, err := time.Parse(strings.ToUpper(layout), up); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// ---- YEARFRAC ---------------------------------------------------------------

func dtYearfrac(c *callCtx) value {
	if c.nargs() < 2 {
		return errValue
	}
	startSerial, e1, ok1 := dtSerialArg(c, 0)
	if !ok1 {
		return e1
	}
	endSerial, e2, ok2 := dtSerialArg(c, 1)
	if !ok2 {
		return e2
	}
	basis := 0
	if c.nargs() >= 3 {
		bv := c.scalar(2)
		if bv.isErr() {
			return bv
		}
		bf, bok := bv.toNum()
		if !bok {
			return errValue
		}
		basis = int(math.Trunc(bf))
	}
	if basis < 0 || basis > 4 {
		return errNum
	}

	// Order start <= end (YEARFRAC is symmetric / non-negative).
	if startSerial > endSerial {
		startSerial, endSerial = endSerial, startSerial
	}
	start := serialToTime(startSerial)
	end := serialToTime(endSerial)

	switch basis {
	case 0: // 30/360 US (NASD)
		return numVal(dt30360Frac(start, end, false))
	case 1: // actual/actual
		return numVal(dtActualActualFrac(start, end, startSerial, endSerial))
	case 2: // actual/360
		return numVal((math.Floor(endSerial) - math.Floor(startSerial)) / 360.0)
	case 3: // actual/365
		return numVal((math.Floor(endSerial) - math.Floor(startSerial)) / 365.0)
	case 4: // 30/360 European
		return numVal(dt30360Frac(start, end, true))
	}
	return errNum
}

// dt30360Frac computes the year fraction under a 30/360 day-count convention.
func dt30360Frac(start, end time.Time, european bool) float64 {
	d1 := start.Day()
	d2 := end.Day()
	m1 := int(start.Month())
	m2 := int(end.Month())
	y1 := start.Year()
	y2 := end.Year()

	if european {
		if d1 == 31 {
			d1 = 30
		}
		if d2 == 31 {
			d2 = 30
		}
	} else {
		// US method (matches Excel YEARFRAC basis 0).
		if d1 == dtDaysInMonth(y1, m1) {
			d1 = 30
		}
		if d2 == 31 && d1 == 30 {
			d2 = 30
		}
	}
	days := float64((y2-y1)*360 + (m2-m1)*30 + (d2 - d1))
	return days / 360.0
}

// dtActualActualFrac computes the actual/actual year fraction (Excel basis 1).
func dtActualActualFrac(start, end time.Time, startSerial, endSerial float64) float64 {
	actualDays := math.Floor(endSerial) - math.Floor(startSerial)
	if actualDays == 0 {
		return 0
	}
	y1 := start.Year()
	y2 := end.Year()
	var denom float64
	if y1 == y2 {
		denom = float64(dtDaysInYear(y1))
	} else {
		// Average length of the years spanned (inclusive).
		total := 0
		for y := y1; y <= y2; y++ {
			total += dtDaysInYear(y)
		}
		denom = float64(total) / float64(y2-y1+1)
	}
	return actualDays / denom
}

func dtDaysInYear(year int) int {
	if dtIsLeapYear(year) {
		return 366
	}
	return 365
}

func dtIsLeapYear(year int) bool {
	return (year%4 == 0 && year%100 != 0) || year%400 == 0
}
