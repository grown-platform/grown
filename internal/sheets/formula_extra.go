package sheets

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// More Google Sheets functions that were missing: COUNTUNIQUE, ISEMAIL, ISURL,
// ISBETWEEN, ARABIC, ROMAN, BASE, DECIMAL, ENCODEURL.

func init() {
	registerFunc("COUNTUNIQUE", fnCountUnique)
	registerFunc("ISEMAIL", fnIsEmail)
	registerFunc("ISURL", fnIsURL)
	registerFunc("ISBETWEEN", fnIsBetween)
	registerFunc("ARABIC", fnArabic)
	registerFunc("ROMAN", fnRoman)
	registerFunc("BASE", fnBase)
	registerFunc("DECIMAL", fnDecimal)
	registerFunc("ENCODEURL", fnEncodeURL)
}

// COUNTUNIQUE(v1, ...) — count of distinct non-empty values across all args.
func fnCountUnique(c *callCtx) value {
	seen := map[string]bool{}
	for _, v := range c.flat() {
		if v.isErr() {
			return v
		}
		if v.kind == kindStr && v.str == "" {
			continue // skip blanks
		}
		// Key by kind+string so 1 (number) and "1" (text) count distinctly,
		// matching Sheets' value-based uniqueness.
		seen[string(rune(v.kind))+"\x00"+v.toStr()] = true
	}
	return numVal(float64(len(seen)))
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// ISEMAIL(value) — TRUE when the text looks like an email address.
func fnIsEmail(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	return boolVal(emailRe.MatchString(strings.TrimSpace(c.text(0))))
}

// ISURL(value) — TRUE when the text looks like a URL (a scheme://host form, or
// a bare host.tld), leniently like Sheets.
func fnIsURL(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	s := strings.TrimSpace(c.text(0))
	if s == "" || strings.ContainsAny(s, " \t\n") {
		return boolVal(false)
	}
	if u, err := url.Parse(s); err == nil && u.Scheme != "" && u.Host != "" {
		return boolVal(true)
	}
	// Bare domain like "example.com" or "www.example.com/path".
	host := s
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		host = s[:i]
	}
	return boolVal(regexp.MustCompile(`^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$`).MatchString(host))
}

// ISBETWEEN(value, low, high, [inclusive_low=TRUE], [inclusive_high=TRUE]).
func fnIsBetween(c *callCtx) value {
	if c.nargs() < 3 {
		return errNA
	}
	v, ok := c.num(0)
	lo, ok2 := c.num(1)
	hi, ok3 := c.num(2)
	if !ok || !ok2 || !ok3 {
		return errValue
	}
	incLo := true
	if c.nargs() >= 4 {
		incLo = c.scalar(3).isTruthy()
	}
	incHi := true
	if c.nargs() >= 5 {
		incHi = c.scalar(4).isTruthy()
	}
	lowOK := v > lo || (incLo && v == lo)
	highOK := v < hi || (incHi && v == hi)
	return boolVal(lowOK && highOK)
}

var romanVals = map[byte]int{'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}

// ARABIC(roman) — convert a Roman numeral string to a number.
func fnArabic(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	s := strings.ToUpper(strings.TrimSpace(c.text(0)))
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	total, prev := 0, 0
	for i := len(s) - 1; i >= 0; i-- {
		v, ok := romanVals[s[i]]
		if !ok {
			return errValue
		}
		if v < prev {
			total -= v
		} else {
			total += v
		}
		prev = v
	}
	if neg {
		total = -total
	}
	return numVal(float64(total))
}

// ROMAN(number) — convert 1..3999 to a Roman numeral string.
func fnRoman(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	nf, ok := c.num(0)
	if !ok {
		return errValue
	}
	n := int(nf)
	if n <= 0 || n > 3999 {
		return errNum
	}
	vals := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	syms := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var b strings.Builder
	for i, v := range vals {
		for n >= v {
			b.WriteString(syms[i])
			n -= v
		}
	}
	return strVal(b.String())
}

// BASE(number, radix, [min_length]) — number to a string in the given base.
func fnBase(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	nf, ok := c.num(0)
	rf, ok2 := c.num(1)
	if !ok || !ok2 {
		return errValue
	}
	radix := int(rf)
	if radix < 2 || radix > 36 {
		return errNum
	}
	s := strings.ToUpper(strconv.FormatInt(int64(nf), radix))
	if c.nargs() >= 3 {
		if ml, ok := c.num(2); ok {
			for len(s) < int(ml) {
				s = "0" + s
			}
		}
	}
	return strVal(s)
}

// DECIMAL(text, radix) — parse a base-N string to a number.
func fnDecimal(c *callCtx) value {
	if c.nargs() < 2 {
		return errNA
	}
	rf, ok := c.num(1)
	if !ok {
		return errValue
	}
	radix := int(rf)
	if radix < 2 || radix > 36 {
		return errNum
	}
	n, err := strconv.ParseInt(strings.TrimSpace(c.text(0)), radix, 64)
	if err != nil {
		return errValue
	}
	return numVal(float64(n))
}

// ENCODEURL(text) — percent-encode a string for use in a URL.
func fnEncodeURL(c *callCtx) value {
	if c.nargs() < 1 {
		return errNA
	}
	return strVal(url.QueryEscape(c.text(0)))
}
