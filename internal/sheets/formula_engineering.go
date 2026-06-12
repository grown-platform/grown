package sheets

import (
	"math"
	"strconv"
	"strings"
)

// formula_engineering.go — Excel-compatible ENGINEERING worksheet functions.
//
// Covers base conversion (DEC2BIN … HEX2OCT), bitwise operators (BITAND …
// BITRSHIFT), comparison (DELTA, GESTEP) and unit conversion (CONVERT).
//
// All unexported helpers/types are prefixed `eng` to avoid collisions with
// sibling formula_*.go files.

// ---- shared helpers ---------------------------------------------------------

// engArgNum reads argument i as a number, propagating any error value. The
// returned error value is meaningful only when ok is false.
func engArgNum(c *callCtx, i int) (float64, value, bool) {
	v := c.scalar(i)
	if v.isErr() {
		return 0, v, false
	}
	n, ok := v.toNum()
	if !ok {
		return 0, errValue, false
	}
	return n, value{}, true
}

// engArgInt reads argument i as a number and truncates toward zero to an int64.
func engArgInt(c *callCtx, i int) (int64, value, bool) {
	n, ev, ok := engArgNum(c, i)
	if !ok {
		return 0, ev, false
	}
	return int64(math.Trunc(n)), value{}, true
}

// engPlaces reads an optional [places] argument at index i. ok is false (with a
// meaningful error value) only when present but invalid. present reports whether
// the argument was supplied at all.
func engPlaces(c *callCtx, i int) (places int, present bool, ev value, ok bool) {
	if i >= c.nargs() {
		return 0, false, value{}, true
	}
	v := c.scalar(i)
	if v.isErr() {
		return 0, true, v, false
	}
	n, nok := v.toNum()
	if !nok {
		return 0, true, errValue, false
	}
	p := int(math.Trunc(n))
	if p < 0 {
		return 0, true, errNum, false
	}
	return p, true, value{}, true
}

// engPad left-zero-pads s to the requested number of places. Returns errNum
// when the string is already longer than the requested width.
func engPad(s string, places int, present bool) value {
	if !present {
		return strVal(s)
	}
	if len(s) > places {
		return errNum
	}
	if len(s) < places {
		s = strings.Repeat("0", places-len(s)) + s
	}
	return strVal(s)
}

// engParseSigned parses an unsigned text representation in the given base into a
// signed decimal, applying Excel's 10-digit two's-complement rule for the binary,
// octal and hexadecimal formats. maxDigits is the maximum number of digits Excel
// accepts (10 for bin/oct/hex). The sign bit lives at value base^maxDigits / 2.
func engParseSigned(text string, base int, maxDigits int) (int64, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, false
	}
	if len(text) > maxDigits {
		return 0, false
	}
	u, err := strconv.ParseUint(strings.ToUpper(text), base, 64)
	if err != nil {
		return 0, false
	}
	// Two's-complement window: total = base^maxDigits, sign threshold = total/2.
	var total uint64 = 1
	for i := 0; i < maxDigits; i++ {
		total *= uint64(base)
	}
	half := total / 2
	if u >= half {
		return int64(u) - int64(total), true
	}
	return int64(u), true
}

// engFormatSigned formats a signed decimal into the given base using Excel's
// 10-digit two's-complement rule for negatives. Returns errNum when out of the
// representable range.
func engFormatSigned(n int64, base int, maxDigits int) (string, bool) {
	var total int64 = 1
	for i := 0; i < maxDigits; i++ {
		total *= int64(base)
	}
	half := total / 2
	if n >= half || n < -half {
		return "", false
	}
	if n < 0 {
		// Two's complement within the maxDigits-wide window.
		u := uint64(total + n)
		return strings.ToUpper(strconv.FormatUint(u, base)), true
	}
	return strings.ToUpper(strconv.FormatInt(n, base)), true
}

// ---- base conversion: DEC2* -------------------------------------------------

// engDec2 converts a decimal number to base with Excel's 10-bit window and an
// optional [places] pad argument (only meaningful for non-negative results).
func engDec2(c *callCtx, base int) value {
	n, ev, ok := engArgInt(c, 0)
	if !ok {
		return ev
	}
	places, present, pev, pok := engPlaces(c, 1)
	if !pok {
		return pev
	}
	s, ok := engFormatSigned(n, base, 10)
	if !ok {
		return errNum
	}
	// Excel ignores [places] for negative numbers (already 10 digits wide).
	if n < 0 {
		return strVal(s)
	}
	return engPad(s, places, present)
}

func init() {
	registerFunc("DEC2BIN", func(c *callCtx) value { return engDec2(c, 2) })
	registerFunc("DEC2OCT", func(c *callCtx) value { return engDec2(c, 8) })
	registerFunc("DEC2HEX", func(c *callCtx) value { return engDec2(c, 16) })
}

// ---- base conversion: *2DEC ------------------------------------------------

func engToDec(c *callCtx, base int) value {
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	n, ok := engParseSigned(v.toStr(), base, 10)
	if !ok {
		return errNum
	}
	return numVal(float64(n))
}

func init() {
	registerFunc("BIN2DEC", func(c *callCtx) value { return engToDec(c, 2) })
	registerFunc("OCT2DEC", func(c *callCtx) value { return engToDec(c, 8) })
	registerFunc("HEX2DEC", func(c *callCtx) value { return engToDec(c, 16) })
}

// ---- base conversion: cross-base (BIN2HEX, HEX2OCT, …) ----------------------

// engCross converts text in fromBase to toBase, routing through a signed decimal
// and honouring an optional [places] pad on non-negative results.
func engCross(c *callCtx, fromBase, toBase int) value {
	v := c.scalar(0)
	if v.isErr() {
		return v
	}
	n, ok := engParseSigned(v.toStr(), fromBase, 10)
	if !ok {
		return errNum
	}
	places, present, pev, pok := engPlaces(c, 1)
	if !pok {
		return pev
	}
	s, ok := engFormatSigned(n, toBase, 10)
	if !ok {
		return errNum
	}
	if n < 0 {
		return strVal(s)
	}
	return engPad(s, places, present)
}

func init() {
	registerFunc("BIN2OCT", func(c *callCtx) value { return engCross(c, 2, 8) })
	registerFunc("BIN2HEX", func(c *callCtx) value { return engCross(c, 2, 16) })
	registerFunc("OCT2BIN", func(c *callCtx) value { return engCross(c, 8, 2) })
	registerFunc("OCT2HEX", func(c *callCtx) value { return engCross(c, 8, 16) })
	registerFunc("HEX2BIN", func(c *callCtx) value { return engCross(c, 16, 2) })
	registerFunc("HEX2OCT", func(c *callCtx) value { return engCross(c, 16, 8) })
}

// ---- bitwise ----------------------------------------------------------------

// engBitMax is 2^48; bitwise operands must be non-negative integers below it.
const engBitMax = 1 << 48

// engBitOperand validates argument i as a non-negative integer < 2^48.
func engBitOperand(c *callCtx, i int) (uint64, value, bool) {
	n, ev, ok := engArgNum(c, i)
	if !ok {
		return 0, ev, false
	}
	if n != math.Trunc(n) || n < 0 || n >= engBitMax {
		return 0, errNum, false
	}
	return uint64(n), value{}, true
}

func engBitwise(c *callCtx, op func(a, b uint64) uint64) value {
	a, ev, ok := engBitOperand(c, 0)
	if !ok {
		return ev
	}
	b, ev, ok := engBitOperand(c, 1)
	if !ok {
		return ev
	}
	return numVal(float64(op(a, b)))
}

func init() {
	registerFunc("BITAND", func(c *callCtx) value {
		return engBitwise(c, func(a, b uint64) uint64 { return a & b })
	})
	registerFunc("BITOR", func(c *callCtx) value {
		return engBitwise(c, func(a, b uint64) uint64 { return a | b })
	})
	registerFunc("BITXOR", func(c *callCtx) value {
		return engBitwise(c, func(a, b uint64) uint64 { return a ^ b })
	})
	registerFunc("BITLSHIFT", func(c *callCtx) value { return engBitShift(c, true) })
	registerFunc("BITRSHIFT", func(c *callCtx) value { return engBitShift(c, false) })
}

// engBitShift implements BITLSHIFT / BITRSHIFT. A negative shift reverses the
// direction (per Excel). The result must remain below 2^48.
func engBitShift(c *callCtx, left bool) value {
	num, ev, ok := engBitOperand(c, 0)
	if !ok {
		return ev
	}
	shiftF, ev, ok := engArgNum(c, 1)
	if !ok {
		return ev
	}
	if shiftF != math.Trunc(shiftF) {
		return errNum
	}
	shift := int(shiftF)
	if !left {
		shift = -shift
	}
	if shift > 53 || shift < -53 {
		return errNum
	}
	var res uint64
	if shift >= 0 {
		res = num << uint(shift)
	} else {
		res = num >> uint(-shift)
	}
	if shift >= 0 && res >= engBitMax {
		return errNum
	}
	return numVal(float64(res))
}

// ---- comparison: DELTA, GESTEP ----------------------------------------------

func init() {
	registerFunc("DELTA", func(c *callCtx) value {
		a, ev, ok := engArgNum(c, 0)
		if !ok {
			return ev
		}
		b, bok := c.numOr(1, 0)
		if !bok {
			return errValue
		}
		if a == b {
			return numVal(1)
		}
		return numVal(0)
	})
	registerFunc("GESTEP", func(c *callCtx) value {
		n, ev, ok := engArgNum(c, 0)
		if !ok {
			return ev
		}
		step, sok := c.numOr(1, 0)
		if !sok {
			return errValue
		}
		if n >= step {
			return numVal(1)
		}
		return numVal(0)
	})
}

// ---- CONVERT ----------------------------------------------------------------

// engUnit describes a unit within a category: a linear factor to the category's
// base unit, plus an additive offset (used by temperature). value = raw*factor +
// offset expresses the quantity in base units.
type engUnit struct {
	category string
	factor   float64
	offset   float64
}

// engUnits is the supported subset of CONVERT units, keyed case-sensitively
// (Excel's unit abbreviations are case-sensitive). Base units per category:
//
//	mass→g, distance→m, time→sec, temperature→C, volume→l, energy→J.
var engUnits = map[string]engUnit{
	// mass (base: gram)
	"g":     {"mass", 1, 0},
	"kg":    {"mass", 1000, 0},
	"mg":    {"mass", 0.001, 0},
	"lbm":   {"mass", 453.59237, 0},
	"ozm":   {"mass", 28.349523125, 0},
	"stone": {"mass", 6350.29318, 0},

	// distance (base: metre)
	"m":  {"distance", 1, 0},
	"km": {"distance", 1000, 0},
	"cm": {"distance", 0.01, 0},
	"mm": {"distance", 0.001, 0},
	"mi": {"distance", 1609.344, 0},
	"yd": {"distance", 0.9144, 0},
	"ft": {"distance", 0.3048, 0},
	"in": {"distance", 0.0254, 0},

	// time (base: second)
	"sec": {"time", 1, 0},
	"s":   {"time", 1, 0},
	"min": {"time", 60, 0},
	"hr":  {"time", 3600, 0},
	"day": {"time", 86400, 0},
	"yr":  {"time", 31557600, 0}, // Julian year (365.25 days)

	// temperature (base: Celsius, offset conversions)
	"C": {"temperature", 1, 0},
	"F": {"temperature", 5.0 / 9.0, -32.0 * 5.0 / 9.0},
	"K": {"temperature", 1, -273.15},

	// volume (base: litre)
	"l":   {"volume", 1, 0},
	"L":   {"volume", 1, 0},
	"ml":  {"volume", 0.001, 0},
	"gal": {"volume", 3.785411784, 0},
	"qt":  {"volume", 0.946352946, 0},
	"pt":  {"volume", 0.473176473, 0},
	"cup": {"volume", 0.2365882365, 0},

	// energy (base: joule)
	"J":    {"energy", 1, 0},
	"cal":  {"energy", 4.184, 0},
	"kcal": {"energy", 4184, 0},
	"Wh":   {"energy", 3600, 0},
}

func init() {
	registerFunc("CONVERT", func(c *callCtx) value {
		num, ev, ok := engArgNum(c, 0)
		if !ok {
			return ev
		}
		fromV := c.scalar(1)
		if fromV.isErr() {
			return fromV
		}
		toV := c.scalar(2)
		if toV.isErr() {
			return toV
		}
		from, fok := engUnits[fromV.toStr()]
		to, tok := engUnits[toV.toStr()]
		if !fok || !tok {
			return errNA
		}
		if from.category != to.category {
			return errNA
		}
		// Convert to base units, then to the target unit.
		base := num*from.factor + from.offset
		out := (base - to.offset) / to.factor
		return numVal(out)
	})
}
