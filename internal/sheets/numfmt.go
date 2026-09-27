package sheets

// Number formats: rendering spreadsheet format codes ("#,##0.00", "0%",
// "m/d/yyyy", "[h]:mm", "_($* #,##0_)" …) and parsing typed input ("1,234",
// "12%", "$5", "(3)", "1 1/2", "Jan 15, 2023", "14:30").
//
// This is a port of web/app/src/pages/sheets/numberFormat.ts; both are tested
// from the fixtures in testdata/numfmt/ (numfmt_test.go and the vitest parity
// suite), so keep the two in step. TEXT() and the display text `m` of computed
// cells use it.
//
// Serial numbers use the 1900 date system, including its fictitious
// 1900-02-29 (serial 60); the 1904 system is an option.

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

// ---------------------------------------------------------------------------
// Calendar and serial numbers

const nfMaxSerial = 2958465.99999999

var (
	nfEpoch1900 = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	nfEpoch1904 = time.Date(1904, 1, 1, 0, 0, 0, 0, time.UTC)
)

func nfIsLeapYear(y int) bool { return (y%4 == 0 && y%100 != 0) || y%400 == 0 }

var nfMonthDays = [12]int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}

func nfDaysInMonth(y, m0 int) int {
	if m0 == 1 && nfIsLeapYear(y) {
		return 29
	}
	return nfMonthDays[m0]
}

func nfIsValidDay(y, m0, d int) bool {
	if m0 < 0 || m0 > 11 {
		return false
	}
	return d >= 1 && d <= nfDaysInMonth(y, m0)
}

// nfIsValidDate reports whether a date can be a serial: 1900-01-01 to
// 9999-12-31, plus 1899-12-31 (serial 0) and the fictitious 1900-02-29.
func nfIsValidDate(y, m0, d int) bool {
	if y == 1899 && m0 == 11 && d == 31 {
		return true
	}
	if y == 1900 && m0 == 1 && d == 29 {
		return true
	}
	if y < 1900 || y > 9999 {
		return false
	}
	return nfIsValidDay(y, m0, d)
}

func nfIsValidDatePDF(y, m0, d int) bool {
	if y < 1 || y > 9999 {
		return false
	}
	return nfIsValidDay(y, m0, d)
}

func nfDays(from, to time.Time) float64 {
	// time.Sub saturates after ~292 years; count days from the dates instead.
	return float64(nfDayNumber(to) - nfDayNumber(from))
}

// nfDayNumber is a day count (days since 0001-01-01) for a UTC date.
func nfDayNumber(t time.Time) int64 {
	y := int64(t.Year()) - 1
	return y*365 + y/4 - y/100 + y/400 + int64(t.YearDay()) - 1
}

// nfDateToSerial returns the serial number of a calendar date (no time).
func nfDateToSerial(y, m0, d int, date1904 bool) float64 {
	t := time.Date(y, time.Month(m0+1), d, 0, 0, 0, 0, time.UTC)
	if date1904 {
		return nfDays(nfEpoch1904, t)
	}
	if y == 1900 && m0 == 1 && d == 29 {
		return 60
	}
	s := nfDays(nfEpoch1900, t)
	if s <= 60 {
		return s - 1
	}
	return s
}

type nfDate struct{ y, m, d, wd int }

// nfSerialToDate is the calendar date of the whole-day part of a serial.
func nfSerialToDate(serial float64, date1904 bool) nfDate {
	n := int(math.Floor(serial))
	if date1904 {
		t := nfEpoch1904.AddDate(0, 0, n)
		return nfDate{t.Year(), int(t.Month()), t.Day(), int(t.Weekday())}
	}
	wd := ((n+6)%7 + 7) % 7
	if n == 0 {
		return nfDate{1900, 1, 0, wd}
	}
	if n == 60 {
		return nfDate{1900, 2, 29, wd}
	}
	off := n
	if n < 60 {
		off = n + 1
	}
	t := nfEpoch1900.AddDate(0, 0, off)
	return nfDate{t.Year(), int(t.Month()), t.Day(), wd}
}

var nfMonthNames = []string{"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December"}
var nfDayNames = []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

// ---------------------------------------------------------------------------
// Decimal helpers (15 significant digits, like Excel)

type nfDec struct {
	ds string // significant digits, no leading/trailing zeros ("" for 0)
	pt int    // value = 0.ds × 10^pt
}

func nfToDec(a float64) nfDec {
	if a == 0 || math.IsInf(a, 0) || math.IsNaN(a) {
		return nfDec{}
	}
	s := strconv.FormatFloat(math.Abs(a), 'e', 14, 64)
	e := strings.IndexByte(s, 'e')
	ds := s[:1] + s[2:e]
	exp, _ := strconv.Atoi(s[e+1:])
	ds = strings.TrimRight(ds, "0")
	return nfDec{ds, exp + 1}
}

// nfRoundDec rounds to `decimals` places (half away from zero) and splits
// into integer digits (no leading zeros, "" for zero) and exactly `decimals`
// fraction digits.
func nfRoundDec(x nfDec, decimals int) (string, string) {
	keep := x.pt + decimals
	pt := x.pt
	var digits string
	if x.ds == "" || keep < 0 {
		digits = ""
		pt = 0
	} else {
		if keep <= len(x.ds) {
			digits = x.ds[:keep]
		} else {
			digits = x.ds + strings.Repeat("0", keep-len(x.ds))
		}
		if len(x.ds) > keep && x.ds[keep] >= '5' {
			b := []byte(digits)
			i := len(b) - 1
			for ; i >= 0; i-- {
				if b[i] == '9' {
					b[i] = '0'
				} else {
					b[i]++
					break
				}
			}
			digits = string(b)
			if i < 0 {
				digits = "1" + digits
				pt++
			}
		}
	}
	var intPart, frac string
	if pt <= 0 {
		intPart = ""
		n := -pt
		if n > decimals {
			n = decimals
		}
		frac = strings.Repeat("0", n) + digits
	} else {
		if len(digits) >= pt {
			intPart = digits[:pt]
			frac = digits[pt:]
		} else {
			intPart = digits + strings.Repeat("0", pt-len(digits))
		}
	}
	if len(frac) < decimals {
		frac += strings.Repeat("0", decimals-len(frac))
	}
	frac = frac[:decimals]
	intPart = strings.TrimLeft(intPart, "0")
	return intPart, frac
}

func nfClean15(a float64) float64 {
	if a == 0 || math.IsInf(a, 0) || math.IsNaN(a) {
		return a
	}
	f, _ := strconv.ParseFloat(strconv.FormatFloat(a, 'g', 15, 64), 64)
	return f
}

// jsRound is JavaScript's Math.round (half toward +∞).
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

// ---------------------------------------------------------------------------
// General format

// nfGeneral is Excel's General number format: up to 11 characters (sign not
// counted), scientific (1.23457E+11) for numbers that do not fit.
func nfGeneral(v float64) string {
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return "#NUM!"
	}
	if v == 0 {
		return "0"
	}
	sign := ""
	if v < 0 {
		sign = "-"
	}
	a := math.Abs(v)
	x := nfToDec(a)
	e10 := x.pt - 1
	if e10 >= -4 && e10 <= 10 {
		decimals := 9
		if a >= 1 {
			decimals = 10 - x.pt
			if decimals < 0 {
				decimals = 0
			}
		}
		ip, fp := nfRoundDec(x, decimals)
		if ip == "" {
			ip = "0"
		}
		if len(ip) <= 11 {
			fp = strings.TrimRight(fp, "0")
			if fp != "" {
				return sign + ip + "." + fp
			}
			return sign + ip
		}
	}
	return sign + nfSci(x, 5)
}

func nfSci(x nfDec, decimals int) string {
	exp := x.pt - 1
	ip, fp := nfRoundDec(nfDec{x.ds, 1}, decimals)
	if ip == "" {
		ip = "0"
	}
	if len(ip) > 1 {
		ip = ip[:1]
		exp++
	}
	fp = strings.TrimRight(fp, "0")
	e := strconv.Itoa(absInt(exp))
	if len(e) < 2 {
		e = "0" + e
	}
	s := ip
	if fp != "" {
		s += "." + fp
	}
	if exp < 0 {
		return s + "E-" + e
	}
	return s + "E+" + e
}

func absInt(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// ---------------------------------------------------------------------------
// Format code parsing

type nfTokKind int

const (
	tkLit nfTokKind = iota
	tkSkip
	tkFill
	tkDig
	tkDot
	tkComma
	tkPct
	tkExp
	tkExpSign
	tkEscE
	tkPM
	tkSlash
	tkAt
	tkGen
	tkDate
	tkElapsed
	tkAmPm
	tkSub
)

type nfTok struct {
	t    nfTokKind
	s    string // lit/skip/fill/exp/escE/pm/ampm text
	c    byte   // dig: '0' '#' '?'; date/elapsed: 'y' 'm' 'd' 'h' 's' 'M' 'a'
	n    int    // date/elapsed/sub length
	plus bool   // expsign
}

type nfCond struct {
	op string
	v  float64
}

type nfSecKind int

const (
	secNum nfSecKind = iota
	secDate
	secText
	secEmpty
)

type nfSection struct {
	toks  []nfTok
	color string
	cond  *nfCond
	kind  nfSecKind
}

var nfCache sync.Map // code -> []nfSection

func nfParseFormat(code string) []nfSection {
	if v, ok := nfCache.Load(code); ok {
		return v.([]nfSection)
	}
	parts := nfSplitSections(code)
	secs := make([]nfSection, len(parts))
	for i, p := range parts {
		secs[i] = nfParseSection(p)
	}
	nfCache.Store(code, secs)
	return secs
}

func nfSplitSections(code string) []string {
	r := []rune(code)
	var out []string
	var cur strings.Builder
	for i := 0; i < len(r); i++ {
		c := r[i]
		switch {
		case c == '"':
			end := len(r) - 1
			for j := i + 1; j < len(r); j++ {
				if r[j] == '"' {
					end = j
					break
				}
			}
			cur.WriteString(string(r[i : end+1]))
			i = end
		case c == '\\' || c == '_' || c == '*':
			end := i + 2
			if end > len(r) {
				end = len(r)
			}
			cur.WriteString(string(r[i:end]))
			i = end - 1
		case c == '[':
			end := len(r) - 1
			for j := i; j < len(r); j++ {
				if r[j] == ']' {
					end = j
					break
				}
			}
			cur.WriteString(string(r[i : end+1]))
			i = end
		case c == ';':
			out = append(out, cur.String())
			cur.Reset()
		default:
			cur.WriteRune(c)
		}
	}
	return append(out, cur.String())
}

var (
	nfCondRE   = regexp.MustCompile(`^(<=|>=|<>|<|>|=)\s*(-?\d*\.?\d+(?:[eE][+-]?\d+)?)$`)
	nfColorRE  = regexp.MustCompile(`^color\s*\d+$`)
	nfElapseRE = regexp.MustCompile(`^(h+|m+|s+)$`)
	nfColors   = map[string]bool{"black": true, "blue": true, "cyan": true, "green": true, "magenta": true, "red": true, "white": true, "yellow": true}
)

func nfHasPrefixFold(r []rune, i int, p string) bool {
	pr := []rune(p)
	if i+len(pr) > len(r) {
		return false
	}
	return strings.EqualFold(string(r[i:i+len(pr)]), p)
}

// nfGeneralNames is "General" as spelled by other spreadsheet locales.
var nfGeneralNames = map[string]bool{
	"general":       true,
	"standard":      true,
	"standaard":     true,
	"estándar":      true,
	"основной":      true,
	"yleinen":       true,
	"genel":         true,
	"standardowy":   true,
	"normál":        true,
	"γενικός τύπος": true,
	"g/通用格式":        true,
	"g/標準":          true,
	"g/표준":          true,
	"geral":         true,
	"allmänt":       true,
	"obecný":        true,
	"všeobecný":     true,
	"vęeobecný":     true,
}

func nfParseSection(src string) nfSection {
	r := []rune(src)
	sec := nfSection{kind: secNum}
	if nfGeneralNames[strings.ToLower(strings.TrimSpace(src))] {
		sec.toks = []nfTok{{t: tkGen}}
		return sec
	}
	var toks []nfTok
	lit := func(s string) {
		if n := len(toks); n > 0 && toks[n-1].t == tkLit {
			toks[n-1].s += s
			return
		}
		toks = append(toks, nfTok{t: tkLit, s: s})
	}
	for i := 0; i < len(r); {
		c := r[i]
		lc := unicode.ToLower(c)
		switch {
		case c == '"':
			end := len(r)
			for j := i + 1; j < len(r); j++ {
				if r[j] == '"' {
					end = j
					break
				}
			}
			if end > i+1 {
				lit(string(r[i+1 : end]))
			}
			i = end + 1
		case c == '\\':
			if i+1 < len(r) {
				if r[i+1] == 'E' || r[i+1] == 'e' {
					toks = append(toks, nfTok{t: tkEscE, s: string(r[i+1])})
				} else {
					lit(string(r[i+1]))
				}
			}
			i += 2
		case c == '_':
			if i+1 < len(r) {
				toks = append(toks, nfTok{t: tkSkip, s: string(r[i+1])})
			}
			i += 2
		case c == '*':
			if i+1 < len(r) {
				toks = append(toks, nfTok{t: tkFill, s: string(r[i+1])})
			}
			i += 2
		case c == '[':
			end := len(r)
			for j := i; j < len(r); j++ {
				if r[j] == ']' {
					end = j
					break
				}
			}
			body := ""
			if end > i+1 {
				body = string(r[i+1 : end])
			}
			i = end + 1
			lb := strings.ToLower(body)
			if m := nfCondRE.FindStringSubmatch(strings.TrimSpace(body)); m != nil {
				v, _ := strconv.ParseFloat(m[2], 64)
				sec.cond = &nfCond{op: m[1], v: v}
			} else if nfColors[lb] || nfColorRE.MatchString(lb) {
				sec.color = body
			} else if nfElapseRE.MatchString(lb) {
				toks = append(toks, nfTok{t: tkElapsed, c: lb[0], n: len(lb)})
			} else if strings.HasPrefix(body, "$") {
				sym := strings.SplitN(body[1:], "-", 2)[0]
				if sym != "" {
					lit(sym)
				}
			}
		case nfHasPrefixFold(r, i, "general"):
			toks = append(toks, nfTok{t: tkGen})
			i += 7
		case c == '0' || c == '#' || c == '?':
			toks = append(toks, nfTok{t: tkDig, c: byte(c)})
			i++
		case c == '.':
			toks = append(toks, nfTok{t: tkDot})
			i++
		case c == ',':
			toks = append(toks, nfTok{t: tkComma})
			i++
		case c == '%':
			toks = append(toks, nfTok{t: tkPct})
			i++
		case (c == 'E' || c == 'e') && i+1 < len(r) && (r[i+1] == '+' || r[i+1] == '-'):
			toks = append(toks, nfTok{t: tkExp, s: string(c)}, nfTok{t: tkExpSign, plus: r[i+1] == '+'})
			i += 2
		case c == 'E' || c == 'e':
			toks = append(toks, nfTok{t: tkEscE, s: string(c)})
			i++
		case c == '+' || c == '-':
			toks = append(toks, nfTok{t: tkPM, s: string(c)})
			i++
		case c == '/':
			toks = append(toks, nfTok{t: tkSlash})
			i++
		case c == '@':
			toks = append(toks, nfTok{t: tkAt})
			i++
		case nfHasPrefixFold(r, i, "am/pm"):
			toks = append(toks, nfTok{t: tkAmPm, s: string(r[i : i+5])})
			i += 5
		case nfHasPrefixFold(r, i, "a/p"):
			toks = append(toks, nfTok{t: tkAmPm, s: string(r[i : i+3])})
			i += 3
		case strings.ContainsRune("ymdhs", lc) || (lc == 'a' && nfHasPrefixFold(r, i, "aaa")):
			j := i
			for j < len(r) && unicode.ToLower(r[j]) == lc {
				j++
			}
			toks = append(toks, nfTok{t: tkDate, c: byte(lc), n: j - i})
			i = j
		default:
			lit(string(c))
			i++
		}
	}
	sec.toks = toks
	nfClassify(&sec)
	return sec
}

func nfClassify(sec *nfSection) {
	toks := sec.toks
	isDate := false
	for _, t := range toks {
		if t.t == tkDate || t.t == tkElapsed || t.t == tkAmPm {
			isDate = true
			break
		}
	}
	if isDate {
		sec.kind = secDate
		var out []nfTok
		for i := 0; i < len(toks); i++ {
			t := toks[i]
			switch t.t {
			case tkDot:
				n := 0
				for i+1+n < len(toks) && toks[i+1+n].t == tkDig && toks[i+1+n].c == '0' {
					n++
				}
				if n > 0 {
					out = append(out, nfTok{t: tkSub, n: n})
					i += n
					continue
				}
				out = append(out, nfTok{t: tkLit, s: "."})
			case tkDig:
				out = append(out, nfTok{t: tkLit, s: string(t.c)})
			case tkComma:
				out = append(out, nfTok{t: tkLit, s: ","})
			case tkPct:
				out = append(out, nfTok{t: tkLit, s: "%"})
			case tkSlash:
				out = append(out, nfTok{t: tkLit, s: "/"})
			case tkExp, tkEscE, tkPM:
				out = append(out, nfTok{t: tkLit, s: t.s})
			case tkExpSign:
				if t.plus {
					out = append(out, nfTok{t: tkLit, s: "+"})
				} else {
					out = append(out, nfTok{t: tkLit, s: "-"})
				}
			default:
				out = append(out, t)
			}
		}
		sec.toks = out
		nfResolveMinutes(out)
		return
	}
	sec.toks = nfMarkExponent(toks)
	hasDigits, hasAt := false, false
	for _, t := range toks {
		if t.t == tkDig || t.t == tkGen {
			hasDigits = true
		}
		if t.t == tkAt {
			hasAt = true
		}
	}
	switch {
	case !hasDigits && hasAt:
		sec.kind = secText
	case !hasDigits && len(toks) == 0:
		sec.kind = secEmpty
	default:
		sec.kind = secNum
	}
}

// nfMarkExponent: an "E" followed by a sign before the next digit placeholder
// starts an exponent ("0\E!-0"); other "E"s and signs are literal text.
func nfMarkExponent(toks []nfTok) []nfTok {
	lit := func(t nfTok) nfTok {
		if t.t == tkEscE || t.t == tkPM {
			return nfTok{t: tkLit, s: t.s}
		}
		return t
	}
	mapLit := func(ts []nfTok) []nfTok {
		out := make([]nfTok, len(ts))
		for i, t := range ts {
			out[i] = lit(t)
		}
		return out
	}
	for _, t := range toks {
		if t.t == tkExp {
			return nfMergeLits(mapLit(toks))
		}
	}
	i := -1
	for k, t := range toks {
		if t.t == tkEscE {
			i = k
			break
		}
	}
	if i < 0 {
		return nfMergeLits(mapLit(toks))
	}
	for j := i + 1; j < len(toks); j++ {
		t := toks[j]
		if t.t == tkDig {
			break
		}
		if t.t != tkPM {
			continue
		}
		var out []nfTok
		out = append(out, mapLit(toks[:i])...)
		out = append(out, nfTok{t: tkExp, s: toks[i].s})
		out = append(out, mapLit(toks[i+1:j])...)
		out = append(out, nfTok{t: tkExpSign, plus: t.s == "+"})
		out = append(out, mapLit(toks[j+1:])...)
		return nfMergeLits(out)
	}
	return nfMergeLits(mapLit(toks))
}

func nfMergeLits(toks []nfTok) []nfTok {
	var out []nfTok
	for _, t := range toks {
		if n := len(out); t.t == tkLit && n > 0 && out[n-1].t == tkLit {
			out[n-1].s += t.s
			continue
		}
		out = append(out, t)
	}
	return out
}

// nfResolveMinutes decides which "m"/"mm" tokens are minutes: one right after
// an hour (or an unpaired seconds) token, or one followed by seconds.
func nfResolveMinutes(toks []nfTok) {
	var idx []int
	for i, t := range toks {
		if t.t == tkDate || t.t == tkElapsed {
			idx = append(idx, i)
		}
	}
	pending, prevMinute := false, false
	for j, ti := range idx {
		t := &toks[ti]
		if t.t == tkElapsed {
			if t.c == 'h' {
				pending = true
			}
			prevMinute = false
			continue
		}
		switch {
		case t.c == 'h':
			pending = true
			prevMinute = false
		case t.c == 's':
			if !prevMinute {
				pending = true
			}
			prevMinute = false
		case t.c == 'm' && t.n <= 2:
			nextIsSec := j+1 < len(idx) && toks[idx[j+1]].t == tkDate && toks[idx[j+1]].c == 's'
			if pending || nextIsSec {
				t.c = 'M'
				prevMinute = true
			} else {
				prevMinute = false
			}
			pending = false
		default:
			prevMinute = false
			if t.c == 'm' {
				pending = false
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Rendering

type nfRunKind int

const (
	runText nfRunKind = iota
	runSkip
	runFill
)

type nfRun struct {
	text string
	kind nfRunKind
}

func nfNumberSections(secs []nfSection) []nfSection {
	n := len(secs)
	if n > 3 {
		n = 3
	}
	out := secs[:n]
	for len(out) > 1 && out[len(out)-1].kind == secText {
		out = out[:len(out)-1]
	}
	return out
}

func nfTestCond(c nfCond, v float64) bool {
	switch c.op {
	case "<":
		return v < c.v
	case ">":
		return v > c.v
	case "=":
		return v == c.v
	case "<=":
		return v <= c.v
	case ">=":
		return v >= c.v
	case "<>":
		return v != c.v
	}
	return false
}

func nfCondIsNegative(c nfCond) bool {
	return ((c.op == "<" || c.op == "<=") && c.v <= 0) || (c.op == "=" && c.v < 0)
}

func nfPickSection(secs []nfSection, v float64) (*nfSection, bool) {
	nums := nfNumberSections(secs)
	anyCond := false
	for _, s := range nums {
		if s.cond != nil {
			anyCond = true
		}
	}
	if !anyCond {
		if len(nums) == 1 || v > 0 || (v == 0 && len(nums) == 2) {
			return &nums[0], v < 0
		}
		if v < 0 {
			return &nums[1], false
		}
		if len(nums) > 2 {
			return &nums[2], false
		}
		return &nums[0], false
	}
	n := len(nums)
	for i := 0; i < n; i++ {
		s := &nums[i]
		var cond nfCond
		implicitNeg := false
		switch {
		case s.cond != nil:
			cond = *s.cond
		case i == 0 && n >= 3:
			cond = nfCond{">", 0}
		case i == 0:
			cond = nfCond{">=", 0}
		case i == 1 && (n >= 3 || nums[0].cond == nil):
			cond = nfCond{"<", 0}
			implicitNeg = true
		default:
			return s, v < 0
		}
		if nfTestCond(cond, v) {
			if implicitNeg {
				return s, false
			}
			return s, v < 0 && !(s.cond != nil && nfCondIsNegative(*s.cond))
		}
	}
	return nil, false
}

// nfFormatRuns renders a value (float64, string or bool) with a format code.
func nfFormatRuns(value interface{}, code string, date1904 bool) ([]nfRun, string) {
	if code == "" {
		code = "General"
	}
	secs := nfParseFormat(code)
	switch v := value.(type) {
	case bool:
		if v {
			return []nfRun{{text: "TRUE"}}, ""
		}
		return []nfRun{{text: "FALSE"}}, ""
	case string:
		var textSec *nfSection
		if len(secs) >= 4 {
			textSec = &secs[3]
		} else {
			for i := range secs {
				if secs[i].kind == secText {
					textSec = &secs[i]
					break
				}
			}
		}
		if textSec == nil {
			return []nfRun{{text: v}}, ""
		}
		return nfRenderText(textSec, v), textSec.color
	case float64:
		if math.IsInf(v, 0) || math.IsNaN(v) {
			return []nfRun{{text: "#NUM!"}}, ""
		}
		sec, minus := nfPickSection(secs, v)
		if sec == nil {
			return []nfRun{{text: "#"}}, ""
		}
		a := math.Abs(v)
		switch sec.kind {
		case secDate:
			return nfRenderDate(sec, v, date1904), sec.color
		case secText:
			return nfRenderText(sec, nfGeneral(v)), sec.color
		default:
			return nfRenderNumber(sec, a, minus && v < 0), sec.color
		}
	}
	return nil, ""
}

// FormatNumberText is the display text of a value under a format code: `_x`
// becomes a space and `*x` fill characters are dropped.
func FormatNumberText(value interface{}, code string, date1904 bool) string {
	runs, _ := nfFormatRuns(value, code, date1904)
	var b strings.Builder
	for _, r := range runs {
		switch r.kind {
		case runSkip:
			b.WriteByte(' ')
		case runFill:
		default:
			b.WriteString(r.text)
		}
	}
	return b.String()
}

// nfRunsText joins runs as written (skip and fill characters once each).
func nfRunsText(runs []nfRun) string {
	var b strings.Builder
	for _, r := range runs {
		b.WriteString(r.text)
	}
	return b.String()
}

func nfRenderText(sec *nfSection, s string) []nfRun {
	var out []nfRun
	for _, t := range sec.toks {
		switch t.t {
		case tkAt, tkGen:
			out = append(out, nfRun{text: s})
		case tkLit:
			out = append(out, nfRun{text: t.s})
		case tkSkip:
			out = append(out, nfRun{text: t.s, kind: runSkip})
		case tkFill:
			out = append(out, nfRun{text: t.s, kind: runFill})
		}
	}
	return out
}

func nfPushLiteral(out []nfRun, t nfTok) []nfRun {
	switch t.t {
	case tkLit:
		return append(out, nfRun{text: t.s})
	case tkSkip:
		return append(out, nfRun{text: t.s, kind: runSkip})
	case tkFill:
		return append(out, nfRun{text: t.s, kind: runFill})
	case tkPct:
		return append(out, nfRun{text: "%"})
	case tkAt:
		return append(out, nfRun{text: ""})
	}
	return out
}

func nfRenderNumber(sec *nfSection, a float64, neg bool) []nfRun {
	toks := sec.toks
	for _, t := range toks {
		if t.t == tkGen {
			var out []nfRun
			if neg {
				out = append(out, nfRun{text: "-"})
			}
			for _, t := range toks {
				if t.t == tkGen {
					out = append(out, nfRun{text: nfGeneral(a)})
				} else {
					out = nfPushLiteral(out, t)
				}
			}
			return out
		}
	}
	expAt := -1
	pct := 0
	for i, t := range toks {
		if t.t == tkExp && expAt < 0 {
			expAt = i
		}
		if t.t == tkPct {
			pct++
		}
	}
	if expAt >= 0 {
		return nfRenderScientific(toks, expAt, a, neg)
	}
	v := a
	for i := 0; i < pct; i++ {
		v *= 100
	}
	if pct > 0 {
		v = nfClean15(v)
	}
	if slash := nfFindFraction(toks); slash >= 0 {
		return nfRenderFraction(toks, slash, v, neg)
	}
	return nfRenderFixed(toks, v, neg)
}

// nfFillInt fills digit slots right to left; extra digits go to the leftmost.
func nfFillInt(slots []byte, digits string, group bool) []string {
	out := make([]string, len(slots))
	if len(slots) == 0 {
		return out
	}
	n := len(digits)
	chars := make([]string, len(slots))
	for k := range slots {
		slot := slots[len(slots)-1-k]
		switch {
		case k < n:
			chars[k] = string(digits[n-1-k])
		case slot == '0':
			chars[k] = "0"
		case slot == '?':
			chars[k] = " "
		default:
			chars[k] = ""
		}
	}
	sepAfter := func(p int) bool { return group && p > 0 && p%3 == 0 }
	pos := 0
	for k := range slots {
		idx := len(slots) - 1 - k
		ch := chars[k]
		text := ch
		if ch != "" && ch != " " {
			if sepAfter(pos) {
				text = ch + ","
			}
			pos++
		} else if ch == " " {
			pos++
		}
		out[idx] = text
	}
	if n > len(slots) {
		extra := ""
		for k := len(slots); k < n; k++ {
			ch := string(digits[n-1-k])
			if sepAfter(pos) {
				ch += ","
			}
			extra = ch + extra
			pos++
		}
		out[0] = extra + out[0]
	}
	return out
}

// nfFillFrac: trailing zeros vanish for "#", become spaces for "?".
func nfFillFrac(slots []byte, digits string) []string {
	out := make([]string, len(slots))
	trailing := true
	for i := len(slots) - 1; i >= 0; i-- {
		d := byte('0')
		if i < len(digits) {
			d = digits[i]
		}
		slot := slots[i]
		if trailing && d == '0' && slot != '0' {
			if slot == '?' {
				out[i] = " "
			} else {
				out[i] = ""
			}
		} else {
			out[i] = string(d)
			trailing = false
		}
	}
	return out
}

func nfGroupDigits(d string, group bool) string {
	if !group || len(d) <= 3 {
		return d
	}
	var b strings.Builder
	first := len(d) % 3
	if first == 0 {
		first = 3
	}
	b.WriteString(d[:first])
	for i := first; i < len(d); i += 3 {
		b.WriteByte(',')
		b.WriteString(d[i : i+3])
	}
	return b.String()
}

func nfHasNonZero(s string) bool { return strings.ContainsAny(s, "123456789") }

func nfRenderFixed(toks []nfTok, v float64, neg bool) []nfRun {
	dotAt := -1
	for i, t := range toks {
		if t.t == tkDot {
			dotAt = i
			break
		}
	}
	intEnd := len(toks)
	if dotAt >= 0 {
		intEnd = dotAt
	}
	var intSlots, fracSlots []byte
	for i, t := range toks {
		if t.t != tkDig {
			continue
		}
		if i < intEnd {
			intSlots = append(intSlots, t.c)
		} else {
			fracSlots = append(fracSlots, t.c)
		}
	}
	// Comma runs: between two integer digits → grouping; after the digits
	// (or the point) with no digit later → ÷1000 each; after a digit with
	// digits later → nothing; elsewhere → one literal ",".
	group := false
	scale := 0
	commaLit := map[int]bool{}
	for a := 0; a < len(toks); a++ {
		if toks[a].t != tkComma {
			continue
		}
		b := a
		for b+1 < len(toks) && toks[b+1].t == tkComma {
			b++
		}
		prevDig := a > 0 && toks[a-1].t == tkDig
		afterDigit := prevDig || (a > 0 && toks[a-1].t == tkDot)
		nextDig := b+1 < len(toks) && toks[b+1].t == tkDig
		digitsLater := false
		for j := b + 1; j < len(toks); j++ {
			if toks[j].t == tkDig {
				digitsLater = true
			}
		}
		switch {
		case afterDigit && nextDig:
			if b < intEnd && prevDig {
				group = true
			}
		case afterDigit && !digitsLater:
			scale += b - a + 1
		case !afterDigit:
			commaLit[a] = true
		}
		a = b
	}
	x := v
	for i := 0; i < scale; i++ {
		x /= 1000
	}
	if scale > 0 {
		x = nfClean15(x)
	}
	ip, fp := nfRoundDec(nfToDec(x), len(fracSlots))
	isZero := ip == "" && !nfHasNonZero(fp)
	intCells := nfFillInt(intSlots, ip, group)
	fracCells := nfFillFrac(fracSlots, fp)
	var out []nfRun
	if neg && !isZero {
		out = append(out, nfRun{text: "-"})
	}
	ii, fi := 0, 0
	for i, t := range toks {
		switch t.t {
		case tkDig:
			if i < intEnd {
				out = append(out, nfRun{text: intCells[ii]})
				ii++
			} else {
				out = append(out, nfRun{text: fracCells[fi]})
				fi++
			}
		case tkDot:
			if i == dotAt && len(intSlots) == 0 && ip != "" {
				out = append(out, nfRun{text: nfGroupDigits(ip, group)})
			}
			out = append(out, nfRun{text: "."})
		case tkComma:
			if commaLit[i] {
				out = append(out, nfRun{text: ","})
			}
		case tkExp:
			out = append(out, nfRun{text: t.s})
		case tkSlash:
			out = append(out, nfRun{text: "/"})
		default:
			out = nfPushLiteral(out, t)
		}
	}
	return out
}

func nfRenderScientific(toks []nfTok, expAt int, v float64, neg bool) []nfRun {
	dotAt := -1
	for i, t := range toks {
		if t.t == tkDot && i < expAt {
			dotAt = i
			break
		}
	}
	mEnd := expAt
	if dotAt >= 0 {
		mEnd = dotAt
	}
	signAt := -1
	for i, t := range toks {
		if t.t == tkExpSign && i > expAt {
			signAt = i
			break
		}
	}
	after := expAt
	if signAt > after {
		after = signAt
	}
	expDot := -1
	for i, t := range toks {
		if t.t == tkDot && i > after {
			expDot = i
			break
		}
	}
	expEnd := len(toks)
	if expDot >= 0 {
		expEnd = expDot
	}
	var intSlots, fracSlots, expSlots []byte
	firstDig := -1
	for i, t := range toks {
		if t.t != tkDig {
			continue
		}
		if firstDig < 0 {
			firstDig = i
		}
		switch {
		case i < mEnd:
			intSlots = append(intSlots, t.c)
		case i < expAt:
			fracSlots = append(fracSlots, t.c)
		case i < expEnd:
			expSlots = append(expSlots, t.c)
		}
	}
	group := false
	for i, t := range toks {
		if t.t != tkComma || i >= mEnd || i < firstDig {
			continue
		}
		for j := i + 1; j < mEnd; j++ {
			if toks[j].t == tkDig {
				group = true
			}
		}
	}
	N := len(intSlots)
	x := nfToDec(v)
	exp := 0
	mi, mf := "", strings.Repeat("0", len(fracSlots))
	if x.ds != "" {
		e10 := x.pt - 1
		if N >= 1 {
			exp = int(math.Floor(float64(e10)/float64(N))) * N
		} else {
			exp = e10 + 1
		}
		mi, mf = nfRoundDec(nfDec{x.ds, x.pt - exp}, len(fracSlots))
		if len(mi) > N {
			if N >= 1 {
				exp += N
			} else {
				exp++
			}
			mi, mf = nfRoundDec(nfDec{x.ds, x.pt - exp}, len(fracSlots))
		}
	}
	isZero := mi == "" && !nfHasNonZero(mf)
	intDigits := mi
	if mi == "" && N >= 1 {
		intDigits = "0"
	}
	slotsForInt := intSlots
	if x.ds == "" {
		slotsForInt = make([]byte, len(intSlots))
		for i := range slotsForInt {
			slotsForInt[i] = '0'
		}
	}
	intCells := nfFillInt(slotsForInt, intDigits, group)
	fracCells := nfFillFrac(fracSlots, mf)
	expPad := 0
	for _, c := range expSlots {
		if c == '0' {
			expPad++
		}
	}
	if expPad < 1 {
		expPad = 1
	}
	expStr := strconv.Itoa(absInt(exp))
	for len(expStr) < expPad {
		expStr = "0" + expStr
	}
	expCells := nfFillInt(expSlots, expStr, false)
	minus := ""
	if exp < 0 {
		minus = "-"
	}
	var out []nfRun
	if neg && !isZero {
		out = append(out, nfRun{text: "-"})
	}
	ii, fi, ei := 0, 0, 0
	expDone := false
	emitExp := func() {
		if !expDone {
			out = append(out, nfRun{text: minus + expStr})
		}
		expDone = true
	}
	for i, t := range toks {
		if i < expAt {
			switch t.t {
			case tkDig:
				if i < mEnd {
					out = append(out, nfRun{text: intCells[ii]})
					ii++
				} else {
					out = append(out, nfRun{text: fracCells[fi]})
					fi++
				}
			case tkDot:
				if i == dotAt && N == 0 && intDigits != "" {
					out = append(out, nfRun{text: intDigits})
				}
				out = append(out, nfRun{text: "."})
			case tkComma:
				if i < firstDig {
					out = append(out, nfRun{text: ","})
				}
			case tkPct:
				out = append(out, nfRun{text: "%"})
			case tkSlash:
				out = append(out, nfRun{text: "/"})
			default:
				out = nfPushLiteral(out, t)
			}
			continue
		}
		switch t.t {
		case tkExp:
			out = append(out, nfRun{text: t.s})
		case tkExpSign:
			if t.plus && exp >= 0 {
				out = append(out, nfRun{text: "+"})
			}
			if len(expSlots) == 0 && expDot < 0 {
				emitExp()
			}
		case tkDig:
			if i < expEnd {
				if !expDone {
					out = append(out, nfRun{text: minus + expCells[ei]})
					expDone = true
				} else {
					out = append(out, nfRun{text: expCells[ei]})
				}
				ei++
			} else {
				switch t.c {
				case '0':
					out = append(out, nfRun{text: "0"})
				case '?':
					out = append(out, nfRun{text: " "})
				default:
					out = append(out, nfRun{text: ""})
				}
			}
		case tkDot:
			if i == expDot {
				emitExp()
			}
			out = append(out, nfRun{text: "."})
		case tkComma:
			out = append(out, nfRun{text: ","})
		case tkPct:
			out = append(out, nfRun{text: "%"})
		case tkSlash:
			out = append(out, nfRun{text: "/"})
		default:
			out = nfPushLiteral(out, t)
		}
	}
	emitExp()
	return out
}

var nfFixedDenRE = regexp.MustCompile(`(?s)^([1-9][0-9]*)(.*)$`)

func nfFindFraction(toks []nfTok) int {
	for i, t := range toks {
		if t.t != tkSlash || i == 0 || toks[i-1].t != tkDig || i+1 >= len(toks) {
			continue
		}
		next := toks[i+1]
		if next.t == tkDig || (next.t == tkLit && nfFixedDenRE.MatchString(next.s)) {
			return i
		}
	}
	return -1
}

// nfApproxFraction: continued-fraction convergents, plus the last
// semiconvergent when it is more than halfway along.
func nfApproxFraction(x float64, maxDen int) (int, int) {
	p0, q0, p1, q1 := 0, 1, 1, 0
	y := x
	for iter := 0; iter < 64; iter++ {
		a := int(math.Floor(y + 1e-9))
		p2 := a*p1 + p0
		q2 := a*q1 + q0
		if q2 > maxDen {
			if q1 == 0 {
				return int(jsRound(x)), 1
			}
			k := (maxDen - q0) / q1
			if 2*k > a {
				return k*p1 + p0, k*q1 + q0
			}
			return p1, q1
		}
		p0, q0, p1, q1 = p1, q1, p2, q2
		f := y - float64(a)
		if f < 1e-9 || math.Abs(x-float64(p1)/float64(q1)) < 1e-12 {
			break
		}
		y = 1 / f
	}
	return p1, q1
}

func nfRenderFraction(toks []nfTok, slash int, v float64, neg bool) []nfRun {
	ns := slash - 1
	for ns > 0 && toks[ns-1].t == tkDig {
		ns--
	}
	var numSlots, intSlots []byte
	for i := ns; i < slash; i++ {
		numSlots = append(numSlots, toks[i].c)
	}
	hasComma := false
	for i := 0; i < ns; i++ {
		if toks[i].t == tkDig {
			intSlots = append(intSlots, toks[i].c)
		}
		if toks[i].t == tkComma {
			hasComma = true
		}
	}
	de := slash + 1
	fixedDen := 0
	fixedRest := ""
	var denSlots []byte
	if next := toks[slash+1]; next.t == tkLit {
		m := nfFixedDenRE.FindStringSubmatch(next.s)
		den := m[1]
		fixedRest = m[2]
		de = slash + 2
		if fixedRest == "" {
			for de < len(toks) && toks[de].t == tkDig && toks[de].c == '0' {
				den += "0"
				de++
			}
		}
		fixedDen, _ = strconv.Atoi(den)
	} else {
		for de < len(toks) && toks[de].t == tkDig {
			denSlots = append(denSlots, toks[de].c)
			de++
		}
	}
	hasInt := len(intSlots) > 0
	ip, fp := nfRoundDec(nfToDec(v), 12)
	whole := 0
	frac := v
	if hasInt {
		if ip != "" {
			whole, _ = strconv.Atoi(ip)
		}
		frac, _ = strconv.ParseFloat("0."+fp, 64)
	}
	var n, d int
	if fixedDen > 0 {
		n = int(jsRound(nfClean15(frac * float64(fixedDen))))
		d = fixedDen
	} else {
		maxDen := int(math.Pow(10, float64(len(denSlots)))) - 1
		n, d = nfApproxFraction(frac, maxDen)
	}
	if hasInt && n == d && d > 0 {
		whole++
		n = 0
	}
	isZero := whole == 0 && n == 0
	var out []nfRun
	if neg && !isZero {
		out = append(out, nfRun{text: "-"})
	}
	if hasInt && n == 0 {
		ws := strconv.Itoa(whole)
		cells := nfFillInt(intSlots, ws, false)
		ii := 0
		for i := 0; i < ns; i++ {
			t := toks[i]
			if t.t == tkDig {
				out = append(out, nfRun{text: cells[ii]})
				ii++
			} else if whole != 0 && t.t != tkComma {
				out = nfPushLiteral(out, t)
			}
		}
		return out
	}
	ws := ""
	if whole != 0 {
		ws = strconv.Itoa(whole)
	}
	intCells := nfFillInt(intSlots, ws, hasComma)
	numCells := nfFillInt(numSlots, strconv.Itoa(n), false)
	denStr := strconv.Itoa(d)
	denCells := make([]string, len(denSlots))
	for k := range denSlots {
		switch {
		case k < len(denStr):
			denCells[k] = string(denStr[k])
		case denSlots[k] == '0':
			denCells[k] = "0"
		case denSlots[k] == '?':
			denCells[k] = " "
		}
	}
	if len(denStr) > len(denSlots) && len(denSlots) > 0 {
		denCells[len(denSlots)-1] += denStr[len(denSlots):]
	}
	ii, ni := 0, 0
	for i, t := range toks {
		switch {
		case i < ns:
			if t.t == tkDig {
				out = append(out, nfRun{text: intCells[ii]})
				ii++
			} else if t.t != tkComma {
				out = nfPushLiteral(out, t)
			}
		case i < slash:
			out = append(out, nfRun{text: numCells[ni]})
			ni++
		case i == slash:
			out = append(out, nfRun{text: "/"})
		case i < de:
			if fixedDen > 0 {
				if i == slash+1 {
					out = append(out, nfRun{text: strconv.Itoa(fixedDen) + fixedRest})
				}
			} else {
				out = append(out, nfRun{text: denCells[i-slash-1]})
			}
		case t.t == tkDig:
			out = append(out, nfRun{text: ""})
		case t.t != tkComma:
			out = nfPushLiteral(out, t)
		}
	}
	return out
}

func nfPad2(n int) string {
	if n < 10 && n >= 0 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func nfPadLeft(s string, n int) string {
	for len(s) < n {
		s = "0" + s
	}
	return s
}

func nfRenderDate(sec *nfSection, v float64, date1904 bool) []nfRun {
	if v < 0 || v > nfMaxSerial {
		return []nfRun{{text: "#"}}
	}
	toks := sec.toks
	p := 0
	ampm := false
	for _, t := range toks {
		if t.t == tkSub {
			n := t.n
			if n > 3 {
				n = 3
			}
			if n > p {
				p = n
			}
		}
		if t.t == tkAmPm {
			ampm = true
		}
	}
	unit := int64(math.Pow(10, float64(p)))
	total := int64(jsRound(nfClean15(v * 86400 * float64(unit))))
	perDay := 86400 * unit
	days := total / perDay
	rem := total - days*perDay
	secs := rem / unit
	sub := rem - secs*unit
	h := int(secs / 3600)
	mi := int((secs % 3600) / 60)
	s := int(secs % 60)
	date := nfSerialToDate(float64(days), date1904)
	var out []nfRun
	for _, t := range toks {
		switch t.t {
		case tkDate:
			text := ""
			switch t.c {
			case 'y':
				if t.n <= 2 {
					text = nfPad2(date.y % 100)
				} else {
					text = nfPadLeft(strconv.Itoa(date.y), 4)
				}
			case 'm':
				name := nfMonthNames[date.m-1]
				switch t.n {
				case 1:
					text = strconv.Itoa(date.m)
				case 2:
					text = nfPad2(date.m)
				case 3:
					text = name[:3]
				case 5:
					text = name[:1]
				default:
					text = name
				}
			case 'd':
				switch t.n {
				case 1:
					text = strconv.Itoa(date.d)
				case 2:
					text = nfPad2(date.d)
				case 3:
					text = nfDayNames[date.wd][:3]
				default:
					text = nfDayNames[date.wd]
				}
			case 'a':
				if t.n == 3 {
					text = nfDayNames[date.wd][:3]
				} else {
					text = nfDayNames[date.wd]
				}
			case 'h':
				hh := h
				if ampm {
					hh = (h+11)%12 + 1
				}
				if t.n == 1 {
					text = strconv.Itoa(hh)
				} else {
					text = nfPad2(hh)
				}
			case 'M':
				if t.n == 1 {
					text = strconv.Itoa(mi)
				} else {
					text = nfPad2(mi)
				}
			case 's':
				if t.n == 1 {
					text = strconv.Itoa(s)
				} else {
					text = nfPad2(s)
				}
			}
			out = append(out, nfRun{text: text})
		case tkElapsed:
			base := unit
			switch t.c {
			case 'h':
				base = 3600 * unit
			case 'm':
				base = 60 * unit
			}
			out = append(out, nfRun{text: nfPadLeft(strconv.FormatInt(total/base, 10), t.n)})
		case tkAmPm:
			pm := h >= 12
			short := len([]rune(t.s)) == 3
			text := "AM"
			switch {
			case short && pm:
				text = "P"
			case short:
				text = "A"
			case pm:
				text = "PM"
			}
			if short && t.s[:1] == strings.ToLower(t.s[:1]) {
				text = strings.ToLower(text)
			}
			out = append(out, nfRun{text: text})
		case tkSub:
			digits := nfPadLeft(strconv.FormatInt(sub, 10), p)
			if len(digits) > t.n {
				digits = digits[:t.n]
			}
			for len(digits) < t.n {
				digits += "0"
			}
			out = append(out, nfRun{text: "." + digits})
		case tkDot:
			out = append(out, nfRun{text: "."})
		default:
			out = nfPushLiteral(out, t)
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Format classification

type nfKind int

const (
	nfkGeneral nfKind = iota
	nfkNumber
	nfkScientific
	nfkCurrency
	nfkPercent
	nfkFraction
	nfkDate
	nfkTime
	nfkText
)

var nfCurrencyLitRE = regexp.MustCompile(`[$€£¥₽₹]|р\.`)

func nfFormatKind(code string) nfKind {
	if strings.TrimSpace(code) == "" || strings.EqualFold(strings.TrimSpace(code), "general") {
		return nfkGeneral
	}
	s := nfParseFormat(code)[0]
	if s.kind == secText {
		return nfkText
	}
	if s.kind == secDate {
		for _, t := range s.toks {
			if t.t == tkDate && (t.c == 'y' || t.c == 'm' || t.c == 'd' || t.c == 'a') {
				return nfkDate
			}
		}
		return nfkTime
	}
	has := func(k nfTokKind) bool {
		for _, t := range s.toks {
			if t.t == k {
				return true
			}
		}
		return false
	}
	switch {
	case has(tkGen):
		return nfkGeneral
	case has(tkPct):
		return nfkPercent
	case has(tkExp):
		return nfkScientific
	case nfFindFraction(s.toks) >= 0:
		return nfkFraction
	}
	for _, t := range s.toks {
		if (t.t == tkLit && nfCurrencyLitRE.MatchString(t.s)) || t.t == tkFill {
			return nfkCurrency
		}
	}
	return nfkNumber
}

var nfReplaceable = map[string]bool{
	"general": true, "0.00e+00": true, "##0.0e+0": true, "0%": true, "0.00%": true,
	"# ?/?": true, "# ??/??": true, "m/d/yyyy": true, "d-mmm-yy": true, "d-mmm": true,
	"mmm-yy": true, "h:mm am/pm": true, "h:mm:ss am/pm": true, "h:mm": true, "h:mm:ss": true,
	"m/d/yyyy h:mm": true, "mm:ss": true, "[h]:mm:ss": true, "mm:ss.0": true,
}

// ---------------------------------------------------------------------------
// Typed input

type nfCulture struct{ decimal, group string }

var nfEnUS = nfCulture{".", ","}

type nfParseOpts struct {
	cellFormat string
	culture    *nfCulture
	date1904   bool
	year       int
	pdf        bool
}

// nfParsed is a recognised typed value and the format the cell should get.
type nfParsed struct {
	value                         float64
	format                        string
	percent, currency, date, time bool
}

const (
	nfFmtThousands  = "#,##0"
	nfFmtThousands2 = "#,##0.00"
	nfFmtCurrency   = `\$#,##0_);[Red](\$#,##0)`
	nfFmtCurrency2  = `\$#,##0.00_);[Red](\$#,##0.00)`
	nfFmtPercent    = "0%"
	nfFmtPercent2   = "0.00%"
	nfFmtFraction1  = "# ?/?"
	nfFmtFraction2  = "# ??/??"
	nfFmtDateShort  = "m/d/yyyy"
	nfFmtDateMedium = "d-mmm"
	nfFmtMonthYear  = "mmm-yy"
	nfFmtDateLong   = "d-mmm-yy"
	nfFmtDateTime   = "m/d/yyyy h:mm"
	nfFmtTime       = "h:mm"
	nfFmtTimeSec    = "h:mm:ss"
	nfFmtTime12     = "h:mm AM/PM"
	nfFmtTime12Sec  = "h:mm:ss AM/PM"
	nfFmtElapsed    = "[h]:mm:ss"
	nfFmtScientific = "0.00E+00"
)

var (
	nfCurrencyPrefix = []string{"$", "€", "£", "¥", "₽", "₹", "₩", "₪", "₫", "₺", "₴", "¢"}
	nfCurrencySuffix = []string{"р.", "руб.", "₽", "€", "zł", "kr", "Kč", "Ft", "₴", "лв"}
)

func nfIsLocaleNumber(s string, c *nfCulture) bool {
	if c == nil {
		c = &nfEnUS
	}
	d := regexp.QuoteMeta(c.decimal)
	return regexp.MustCompile(`^[+-]?(\d+(` + d + `\d*)?|` + d + `\d+)$`).MatchString(s)
}

func nfParseLocaleNumber(s string, c *nfCulture) float64 {
	if c == nil {
		c = &nfEnUS
	}
	f, _ := strconv.ParseFloat(strings.ReplaceAll(s, c.decimal, "."), 64)
	return f
}

type nfRecognised struct {
	value             float64
	kind              string // plain grouped currency percent fraction date time scientific
	format            string
	percent, currency bool
}

// nfParseInput parses text typed into a cell; ok is false when it stays text.
func nfParseInput(text string, o nfParseOpts) (nfParsed, bool) {
	if strings.TrimSpace(text) == "" {
		return nfParsed{}, false
	}
	cellFormat := o.cellFormat
	if cellFormat == "" {
		cellFormat = "General"
	}
	if strings.TrimSpace(cellFormat) == "@" {
		return nfParsed{}, false
	}
	cellKind := nfFormatKind(cellFormat)
	c := nfEnUS
	if o.culture != nil {
		c = *o.culture
	}
	if r, ok := nfParseNumberText(text, c); ok {
		return nfWithFormat(r, cellFormat, cellKind), true
	}
	r, st := nfParseFractionText(text, c, cellKind)
	if st == "text" {
		return nfParsed{}, false
	}
	if st == "ok" {
		return nfWithFormat(r, cellFormat, cellKind), true
	}
	if r, ok := nfParseDateTime(text, o); ok {
		return nfWithFormat(r, cellFormat, cellKind), true
	}
	return nfParsed{}, false
}

func nfWithFormat(r nfRecognised, cellFormat string, cellKind nfKind) nfParsed {
	out := nfParsed{value: r.value, format: cellFormat, percent: r.percent, currency: r.currency}
	if r.kind == "date" {
		out.date = true
	}
	if r.kind == "time" {
		out.date, out.time = true, true
	}
	replaceable := nfReplaceable[strings.ToLower(strings.TrimSpace(cellFormat))]
	switch r.kind {
	case "plain":
	case "grouped":
		if cellKind == nfkGeneral {
			out.format = r.format
		}
	default:
		same := (r.kind == "percent" && cellKind == nfkPercent) ||
			(r.kind == "currency" && cellKind == nfkCurrency) ||
			(r.kind == "fraction" && cellKind == nfkFraction) ||
			(r.kind == "scientific" && cellKind == nfkScientific) ||
			(r.kind == "date" && cellKind == nfkDate) ||
			(r.kind == "time" && cellKind == nfkTime)
		if !same && replaceable {
			out.format = r.format
		}
	}
	return out
}

func nfParseNumberText(raw string, c nfCulture) (nfRecognised, bool) {
	s := strings.TrimSpace(raw)
	neg, paren := false, false
	currency := ""
	pct := 0
	takeCurrency := func() bool {
		for _, sym := range nfCurrencyPrefix {
			if strings.HasPrefix(s, sym) {
				if currency != "" {
					return false
				}
				currency = sym
				s = strings.TrimSpace(s[len(sym):])
				return true
			}
		}
		return true
	}
	takeSign := func() bool {
		if s != "" && (s[0] == '-' || s[0] == '+') {
			if len(s) > 1 && (s[1] == '-' || s[1] == '+') {
				return false
			}
			if s[0] == '-' {
				neg = !neg
			}
			s = strings.TrimSpace(s[1:])
		}
		return true
	}
	fail := nfRecognised{}
	if !takeSign() || !takeCurrency() {
		return fail, false
	}
	if strings.HasPrefix(s, "(") {
		if !strings.HasSuffix(s, ")") {
			return fail, false
		}
		paren = true
		s = strings.TrimSpace(s[1 : len(s)-1])
	} else if strings.HasSuffix(s, ")") {
		return fail, false
	}
	if paren {
		if !takeSign() || !takeCurrency() {
			return fail, false
		}
	}
	if !takeSign() {
		return fail, false
	}
	if strings.HasPrefix(s, "%") {
		pct++
		s = strings.TrimSpace(s[1:])
	}
	for _, sym := range nfCurrencySuffix {
		if strings.HasSuffix(s, sym) && len(s) > len(sym) {
			if currency != "" {
				return fail, false
			}
			currency = sym
			s = strings.TrimSpace(s[:len(s)-len(sym)])
			break
		}
	}
	if currency == "" {
		for _, sym := range nfCurrencyPrefix {
			if strings.HasSuffix(s, sym) {
				return fail, false
			}
		}
	}
	for strings.HasSuffix(s, "%") {
		pct++
		s = strings.TrimSpace(s[:len(s)-1])
	}
	if pct > 1 || strings.ContainsAny(s, "$€£¥₽") {
		return fail, false
	}
	if paren && neg {
		return fail, false
	}
	if paren {
		neg = true
	}
	g := regexp.QuoteMeta(c.group)
	d := regexp.QuoteMeta(c.decimal)
	re := regexp.MustCompile(`^(\d+(?:` + g + `\d+)*)?(?:` + d + `(\d*))?(?:[eE]([+-]?\d+))?$`)
	m := re.FindStringSubmatchIndex(s)
	if m == nil {
		return fail, false
	}
	group := func(k int) (string, bool) {
		if m[2*k] < 0 {
			return "", false
		}
		return s[m[2*k]:m[2*k+1]], true
	}
	intTxt, hasInt := group(1)
	fracPart, hasFrac := group(2)
	expTxt, hasExp := group(3)
	if !hasInt && (!hasFrac || fracPart == "") {
		return fail, false
	}
	intPart := strings.ReplaceAll(intTxt, c.group, "")
	grouped := hasInt && strings.Contains(intTxt, c.group)
	e := 0
	if hasExp {
		e, _ = strconv.Atoi(expTxt)
	}
	if intPart == "" {
		intPart = "0"
	}
	fp := fracPart
	if fp == "" {
		fp = "0"
	}
	value, err := strconv.ParseFloat(intPart+"."+fp+"e"+strconv.Itoa(e-pct*2), 64)
	if err != nil || math.IsInf(value, 0) {
		return fail, false
	}
	if neg {
		value = -value
	}
	hasDecimals := strings.TrimRight(fracPart, "0") != "" || (fracPart != "" && grouped)
	if pct > 0 {
		f := nfFmtPercent
		if fracPart != "" {
			f = nfFmtPercent2
		}
		return nfRecognised{value: value, kind: "percent", percent: true, currency: currency != "", format: f}, true
	}
	if currency != "" {
		nonInt := math.Round(value*1e9)/1e9 != math.Trunc(math.Round(value*1e9)/1e9)
		dec := ""
		if nonInt {
			dec = ".00"
		}
		var f string
		isSuffix := false
		for _, sym := range nfCurrencySuffix {
			if sym == currency {
				isSuffix = true
			}
		}
		switch {
		case currency == "$" && nonInt:
			f = nfFmtCurrency2
		case currency == "$":
			f = nfFmtCurrency
		case isSuffix:
			f = `#,##0` + dec + `"` + currency + `"`
		default:
			f = `"` + currency + `"#,##0` + dec
		}
		return nfRecognised{value: value, kind: "currency", currency: true, format: f}, true
	}
	if hasExp {
		return nfRecognised{value: value, kind: "scientific", format: nfFmtScientific}, true
	}
	if grouped {
		f := nfFmtThousands
		if hasDecimals || fracPart != "" {
			f = nfFmtThousands2
		}
		return nfRecognised{value: value, kind: "grouped", format: f}, true
	}
	return nfRecognised{value: value, kind: "plain", format: "General"}, true
}

var nfSimpleFracRE = regexp.MustCompile(`^([+-]?)(\d+)/(\d+)$`)

func nfParseFractionText(raw string, c nfCulture, cellKind nfKind) (nfRecognised, string) {
	if !strings.Contains(raw, "/") {
		return nfRecognised{}, ""
	}
	g := regexp.QuoteMeta(c.group)
	mixed := regexp.MustCompile(`^([+-]?)(\(?)\s*([$€£¥₽]?)\s*(\d+(?:` + g + `\d{3})*)\s+(\d+)/(\d+)\s*(\)?)\s*(%?)$`).FindStringSubmatch(strings.TrimSpace(raw))
	if mixed != nil {
		sign, open, wholeTxt, numTxt, denTxt, closeP, pctTxt := mixed[1], mixed[2], mixed[4], mixed[5], mixed[6], mixed[7], mixed[8]
		if (open != "") != (closeP != "") {
			return nfRecognised{}, "text"
		}
		den, _ := strconv.Atoi(denTxt)
		if den == 0 {
			return nfRecognised{}, "text"
		}
		whole, _ := strconv.Atoi(strings.ReplaceAll(wholeTxt, c.group, ""))
		num, _ := strconv.Atoi(numTxt)
		value := float64(whole) + float64(num)/float64(den)
		if sign == "-" || open != "" {
			value = -value
		}
		if pctTxt != "" {
			return nfRecognised{value: value / 100, kind: "percent", percent: true, format: nfFmtPercent2}, "ok"
		}
		f := nfFmtFraction1
		if len(denTxt) > 1 {
			f = nfFmtFraction2
		}
		return nfRecognised{value: value, kind: "fraction", format: f}, "ok"
	}
	m := nfSimpleFracRE.FindStringSubmatch(raw)
	if m == nil {
		return nfRecognised{}, ""
	}
	numeric := cellKind != nfkGeneral && cellKind != nfkDate && cellKind != nfkTime && cellKind != nfkText
	if !numeric {
		if m[1] != "" {
			return nfRecognised{}, "text"
		}
		return nfRecognised{}, ""
	}
	n, _ := strconv.Atoi(m[2])
	d, _ := strconv.Atoi(m[3])
	if d == 0 {
		return nfRecognised{}, "text"
	}
	value := float64(n) / float64(d)
	if m[1] == "-" {
		value = -value
	}
	f := nfFmtFraction1
	if len(m[3]) > 1 {
		f = nfFmtFraction2
	}
	return nfRecognised{value: value, kind: "fraction", format: f}, "ok"
}

func nfMonthIndex(word string) int {
	w := strings.TrimSuffix(strings.ToLower(word), ".")
	if len(w) < 3 {
		return -1
	}
	for i, m := range nfMonthNames {
		lm := strings.ToLower(m)
		if lm == w || (len(w) == 3 && strings.HasPrefix(lm, w)) {
			return i
		}
	}
	if w == "sept" {
		return 8
	}
	return -1
}

func nfFullYear(y string) int {
	n, _ := strconv.Atoi(y)
	if len(y) <= 2 {
		if n < 30 {
			return 2000 + n
		}
		return 1900 + n
	}
	return n
}

type nfTimeParts struct {
	seconds               float64
	hasSec, ampm, elapsed bool
}

var (
	nfTimeRE     = regexp.MustCompile(`(?i)^(\d{1,})\s*:\s*(\d{0,2})(?:\s*:\s*(\d{0,2}(?:\.\d+)?))?\s*(am|pm|a|p)?$`)
	nfHourAmPmRE = regexp.MustCompile(`(?i)^(\d{1,2})\s*(am|pm|a|p)$`)
)

func nfParseTime(s string, allowElapsed bool) (nfTimeParts, bool) {
	s = strings.TrimSpace(s)
	m := nfTimeRE.FindStringSubmatch(s)
	if m == nil {
		h := nfHourAmPmRE.FindStringSubmatch(s)
		if h == nil {
			return nfTimeParts{}, false
		}
		hr, _ := strconv.Atoi(h[1])
		if hr > 12 {
			return nfTimeParts{}, false
		}
		pm := strings.ToLower(h[2])[0] == 'p'
		if hr == 12 {
			hr = 0
		}
		if pm {
			hr += 12
		}
		return nfTimeParts{seconds: float64(hr * 3600), ampm: true}, true
	}
	hr, _ := strconv.Atoi(m[1])
	mi := 0
	if m[2] != "" {
		mi, _ = strconv.Atoi(m[2])
	}
	hasSec := m[3] != ""
	se := 0.0
	if hasSec {
		se, _ = strconv.ParseFloat(m[3], 64)
	}
	if mi > 59 || se >= 60 {
		return nfTimeParts{}, false
	}
	ap := strings.ToLower(m[4])
	if ap != "" {
		if hr > 12 {
			return nfTimeParts{}, false
		}
		if hr == 12 {
			hr = 0
		}
		if ap[0] == 'p' {
			hr += 12
		}
	}
	elapsed := ap == "" && hr > 23
	if (elapsed && !allowElapsed) || hr > 9999 {
		return nfTimeParts{}, false
	}
	return nfTimeParts{seconds: float64(hr*3600+mi*60) + se, hasSec: hasSec, ampm: ap != "", elapsed: elapsed}, true
}

type nfDateHit struct {
	y, m0, d int
	format   string
}

const nfWordRE = `([A-Za-z]+\.?)`

var (
	nfDateMDY   = regexp.MustCompile(`^(\d{1,2})([/-])(\d{1,2})([/-])(\d{1,4})$`)
	nfDateYMD   = regexp.MustCompile(`^(\d{4})([/-])(\d{1,2})([/-])(\d{1,2})$`)
	nfDateMD    = regexp.MustCompile(`^(\d{1,2})/(\d{1,2})$`)
	nfDateDMonY = regexp.MustCompile(`^(\d{1,2})[\s-]+` + nfWordRE + `(?:[\s,-]+(\d{2,4}))?$`)
	nfDateMonDY = regexp.MustCompile(`^` + nfWordRE + `[\s-]+(\d{1,2})(?:(?:,\s*|[\s-]+)(\d{4}|\d{2}))?$`)
	nfDateMonY  = regexp.MustCompile(`^` + nfWordRE + `[\s-]+(\d{4})$`)
)

func nfAtoi(s string) int { n, _ := strconv.Atoi(s); return n }

func nfParseDatePart(s string, o nfParseOpts) (nfDateHit, bool) {
	year := o.year
	if year == 0 {
		year = time.Now().Year()
	}
	t := strings.TrimSpace(s)
	if m := nfDateMDY.FindStringSubmatch(t); m != nil && m[2] == m[4] {
		return nfDateHit{nfFullYear(m[5]), nfAtoi(m[1]) - 1, nfAtoi(m[3]), nfFmtDateShort}, true
	}
	if m := nfDateYMD.FindStringSubmatch(t); m != nil && m[2] == m[4] {
		return nfDateHit{nfAtoi(m[1]), nfAtoi(m[3]) - 1, nfAtoi(m[5]), nfFmtDateShort}, true
	}
	if m := nfDateMD.FindStringSubmatch(t); m != nil {
		return nfDateHit{year, nfAtoi(m[1]) - 1, nfAtoi(m[2]), nfFmtDateMedium}, true
	}
	if m := nfDateDMonY.FindStringSubmatch(t); m != nil {
		mi := nfMonthIndex(m[2])
		if mi < 0 {
			return nfDateHit{}, false
		}
		if m[3] != "" {
			return nfDateHit{nfFullYear(m[3]), mi, nfAtoi(m[1]), nfFmtDateLong}, true
		}
		return nfDateHit{year, mi, nfAtoi(m[1]), nfFmtDateMedium}, true
	}
	if m := nfDateMonDY.FindStringSubmatch(t); m != nil {
		mi := nfMonthIndex(m[1])
		if mi < 0 {
			return nfDateHit{}, false
		}
		if m[3] != "" {
			return nfDateHit{nfFullYear(m[3]), mi, nfAtoi(m[2]), nfFmtDateLong}, true
		}
		return nfDateHit{year, mi, nfAtoi(m[2]), nfFmtDateMedium}, true
	}
	if m := nfDateMonY.FindStringSubmatch(t); m != nil {
		mi := nfMonthIndex(m[1])
		if mi < 0 {
			return nfDateHit{}, false
		}
		return nfDateHit{nfAtoi(m[2]), mi, 1, nfFmtMonthYear}, true
	}
	return nfDateHit{}, false
}

var (
	nfLeadFracRE  = regexp.MustCompile(`^\s*\d+/\d+$`)
	nfTimeOnlyRE  = regexp.MustCompile(`^\d+\s*:`)
	nfHourOnlyRE  = regexp.MustCompile(`(?i)^\d{1,2}\s*(am|pm)$`)
	nfDateTimeRE  = regexp.MustCompile(`(?i)^(.*?[^\s:])\s+(\d+\s*:.*|\d{1,2}\s*(?:am|pm))$`)
	nfPDFDateTime = regexp.MustCompile(`^(.*?[^\s:])\s+(\d+\s*:.*)$`)
)

func nfPDFSerial(dh nfDateHit) float64 {
	return nfDays(nfEpoch1900, time.Date(dh.y, time.Month(dh.m0+1), dh.d, 0, 0, 0, 0, time.UTC))
}

func nfParseDateTime(raw string, o nfParseOpts) (nfRecognised, bool) {
	fail := nfRecognised{}
	if raw != strings.TrimLeft(raw, " \t\n\r") && nfLeadFracRE.MatchString(raw) {
		return fail, false
	}
	s := strings.TrimSpace(raw)
	valid := nfIsValidDate
	if o.pdf {
		valid = nfIsValidDatePDF
	}
	if nfTimeOnlyRE.MatchString(s) || nfHourOnlyRE.MatchString(s) {
		tm, ok := nfParseTime(s, true)
		if !ok {
			return fail, false
		}
		f := nfFmtTime
		switch {
		case tm.elapsed:
			f = nfFmtElapsed
		case tm.ampm && tm.hasSec:
			f = nfFmtTime12Sec
		case tm.ampm:
			f = nfFmtTime12
		case tm.hasSec:
			f = nfFmtTimeSec
		}
		return nfRecognised{value: tm.seconds / 86400, kind: "time", format: f}, true
	}
	datePart, timePart := s, ""
	if m := nfDateTimeRE.FindStringSubmatch(s); m != nil {
		datePart, timePart = m[1], m[2]
	}
	dh, ok := nfParseDatePart(datePart, o)
	if !ok || !valid(dh.y, dh.m0, dh.d) {
		return fail, false
	}
	var value float64
	if o.pdf {
		value = nfPDFSerial(dh)
	} else {
		value = nfDateToSerial(dh.y, dh.m0, dh.d, o.date1904)
	}
	f := dh.format
	if timePart != "" {
		tm, ok := nfParseTime(timePart, true)
		if !ok {
			return fail, false
		}
		value += tm.seconds / 86400
		if tm.elapsed {
			return nfRecognised{value: value, kind: "plain", format: "General"}, true
		}
		f = nfFmtDateTime
	}
	return nfRecognised{value: value, kind: "date", format: f}, true
}

// nfParseDatePDF parses a date (and time) for PDF form fields; years before
// 1900 are allowed.
func nfParseDatePDF(text string, o nfParseOpts) (value float64, hasTime bool, ok bool) {
	s := strings.TrimSpace(text)
	datePart, timePart := s, ""
	if m := nfPDFDateTime.FindStringSubmatch(s); m != nil {
		datePart, timePart = m[1], m[2]
	}
	dh, ok := nfParseDatePart(datePart, o)
	if !ok || !nfIsValidDatePDF(dh.y, dh.m0, dh.d) {
		return 0, false, false
	}
	value = nfPDFSerial(dh)
	if timePart != "" {
		tm, ok := nfParseTime(timePart, false)
		if !ok {
			return 0, false, false
		}
		value += tm.seconds / 86400
		hasTime = true
	}
	return value, hasTime, true
}
