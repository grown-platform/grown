package sheets

// formula_validate.go — Excel's argument rules for scalar-argument functions
// that predate the parity work and read their arguments with c.num (which
// turns an error argument into #VALUE!). Wrapping them here makes, left to
// right:
//
//   - an error argument propagate (FV(0.01,12,-100,NA()) is #N/A);
//   - a multi-cell range in a scalar slot #VALUE!;
//   - non-numeric text #VALUE!;
//   - for the strict group, a boolean #VALUE! and an empty argument #N/A.
//
// This file must sort after the files that register the wrapped functions
// (Go runs a package's init functions in file-name order);
// TestArgumentGuards fails if it does not.

func init() {
	loose := argGuard{}
	for _, n := range []string{
		"PMT", "PV", "FV", "NPER", "RATE", "IPMT", "PPMT", "CUMIPMT", "CUMPRINC",
		"SLN", "SYD", "DB", "DDB", "EFFECT", "NOMINAL", "PDURATION", "RRI", "ISPMT",
		"DOLLARDE", "DOLLARFR", "DISC", "INTRATE", "RECEIVED",
		"TBILLPRICE", "TBILLYIELD", "TBILLEQ",
	} {
		guardFunc(n, loose)
	}
	strict := argGuard{noBool: true, noOmitted: true}
	for _, n := range []string{"ERF", "ERF.PRECISE", "ERFC", "ERFC.PRECISE"} {
		guardFunc(n, strict)
	}
	// Base conversions take text digits, so only errors, ranges and booleans
	// are checked up front.
	conv := argGuard{noBool: true, anyText: true}
	for _, n := range []string{
		"BIN2DEC", "BIN2HEX", "BIN2OCT", "OCT2BIN", "OCT2DEC", "OCT2HEX",
		"HEX2BIN", "HEX2DEC", "HEX2OCT", "DEC2BIN", "DEC2HEX", "DEC2OCT",
		"DELTA", "GESTEP",
	} {
		guardFunc(n, conv)
	}
}

type argGuard struct {
	noBool    bool // a boolean argument is #VALUE!
	noOmitted bool // an empty argument is #N/A
	anyText   bool // text need not be numeric
}

func guardFunc(name string, g argGuard) {
	f, ok := funcTable[name]
	if !ok {
		panic("formula_validate.go: " + name + " is not registered yet")
	}
	funcTable[name] = func(c *callCtx) value {
		if e, bad := g.check(c); bad {
			return e
		}
		return f(c)
	}
}

func (g argGuard) check(c *callCtx) (value, bool) {
	for i := range c.args {
		if rv, ok := c.args[i].(rangeVal); ok && rv.rows*rv.cols > 1 {
			return errValue, true
		}
		v := c.scalar(i).topLeft()
		switch {
		case v.isErr():
			return v, true
		case isOmitted(v):
			if g.noOmitted {
				return errNA, true
			}
		case v.kind == kindBool:
			if g.noBool {
				return errValue, true
			}
		case v.kind == kindStr && !g.anyText:
			if _, e, ok := mthNum(v); !ok {
				return e, true
			}
		}
	}
	return value{}, false
}
