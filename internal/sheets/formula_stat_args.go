package sheets

// formula_stat_args.go — Excel's rules for the data arguments of the
// statistical aggregates (AVERAGE, MIN, MAX, COUNT, COUNTA, MEDIAN, STDEV,
// VAR, GEOMEAN, …), which depend on where a value came from:
//
//   - typed directly as an argument: a number or boolean counts, numeric
//     text ("10", "1/1/2023") counts as its number, other text is #VALUE!;
//   - read from a reference: only numbers count; empty cells, text and
//     booleans are skipped (the *A functions count text as 0 and booleans
//     as 0/1);
//   - inside an array (a constant or a computed array): only numbers count
//     (the *A functions also count booleans).
//
// Errors propagate from all three. The collectors below normalise
// arguments into plain number values (plus the first error), so the
// existing helpers (sttNums, sttNumsA) can consume them unchanged.

func init() {
	registerFunc("AVERAGE", sttAverage)
	registerFunc("MIN", func(c *callCtx) value { return sttMinMax(c, false) })
	registerFunc("MAX", func(c *callCtx) value { return sttMinMax(c, true) })
	registerFunc("COUNT", sttCount)
	registerFunc("COUNTA", sttCountA)
}

// sttFlat collects every argument's data values under the rules above.
func sttFlat(c *callCtx, aMode bool) []value {
	return sttFlatRange(c, 0, c.nargs(), aMode)
}

// sttFlatRange collects the data values of arguments from..to-1.
func sttFlatRange(c *callCtx, from, to int, aMode bool) []value {
	var out []value
	for i := from; i < to && i < c.nargs(); i++ {
		out = sttAppendArg(out, c.raw(i), aMode)
		if n := len(out); n > 0 && out[n-1].isErr() {
			return out
		}
	}
	return out
}

func sttAppendArg(out []value, a interface{}, aMode bool) []value {
	switch v := a.(type) {
	case rangeVal:
		fromRef := v.ref != nil
		for _, row := range v.cells {
			for _, x := range row {
				if y, ok := sttDataValue(x, fromRef, aMode); ok {
					out = append(out, y)
					if y.isErr() {
						return out
					}
				}
			}
		}
	case value:
		if v.kind == kindArray && v.arr != nil {
			for _, row := range v.arr.cells {
				for _, x := range row {
					if y, ok := sttDataValue(x, false, aMode); ok {
						out = append(out, y)
						if y.isErr() {
							return out
						}
					}
				}
			}
			return out
		}
		if v.ref != nil {
			if y, ok := sttDataValue(v, true, aMode); ok {
				out = append(out, y)
			}
			return out
		}
		// A direct argument.
		switch {
		case v.isErr():
			out = append(out, v)
		case v.kind == kindNum, v.kind == kindBool:
			out = append(out, numVal(v.num))
		case v.kind == kindStr:
			n, e, ok := mthNum(v)
			if !ok {
				out = append(out, e)
			} else {
				out = append(out, numVal(n))
			}
		}
	}
	return out
}

// sttDataValue maps one value read from a reference (fromRef) or an array
// to the number it contributes, if any.
func sttDataValue(x value, fromRef, aMode bool) (value, bool) {
	switch {
	case x.isErr():
		return x, true
	case x.blank:
		return value{}, false
	case x.kind == kindNum:
		return numVal(x.num), true
	case x.kind == kindBool:
		if aMode {
			return numVal(x.num), true
		}
	case x.kind == kindStr:
		if aMode && fromRef {
			return numVal(0), true
		}
	}
	return value{}, false
}

// sttFlatArg collects the data values of argument i alone.
func sttFlatArg(c *callCtx, i int) []value {
	return sttFlatRange(c, i, i+1, false)
}

func sttAverage(c *callCtx) value {
	nums, err := sttNums(sttFlat(c, false))
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return errDiv0
	}
	return sdNum(sttSum(nums) / float64(len(nums)))
}

func sttMinMax(c *callCtx, wantMax bool) value {
	nums, err := sttNums(sttFlat(c, false))
	if err != nil {
		return *err
	}
	if len(nums) == 0 {
		return numVal(0)
	}
	best := nums[0]
	for _, x := range nums[1:] {
		if (wantMax && x > best) || (!wantMax && x < best) {
			best = x
		}
	}
	return numVal(best)
}

// sttCount implements COUNT: numbers (and, typed directly, booleans and
// numeric text) are counted; nothing else is, and errors are not raised.
func sttCount(c *callCtx) value {
	n := 0
	isNum := func(x value) bool { return x.kind == kindNum && !x.blank }
	for i := 0; i < c.nargs(); i++ {
		switch v := c.raw(i).(type) {
		case rangeVal:
			for _, x := range v.flat() {
				if isNum(x) {
					n++
				}
			}
		case value:
			switch {
			case v.kind == kindArray && v.arr != nil:
				for _, x := range flattenArgs([]interface{}{v}) {
					if isNum(x) {
						n++
					}
				}
			case v.ref != nil:
				if isNum(v) {
					n++
				}
			case v.kind == kindNum, v.kind == kindBool:
				n++
			case v.kind == kindStr:
				if _, _, ok := mthNum(v); ok {
					n++
				}
			}
		}
	}
	return numVal(float64(n))
}

// sttCountA implements COUNTA: every value that is not an empty cell counts,
// including errors and empty text.
func sttCountA(c *callCtx) value {
	n := 0
	for i := 0; i < c.nargs(); i++ {
		switch v := c.raw(i).(type) {
		case rangeVal:
			for _, x := range v.flat() {
				if !x.blank {
					n++
				}
			}
		case value:
			if v.kind == kindArray && v.arr != nil {
				n += len(flattenArgs([]interface{}{v}))
			} else if !v.blank {
				n++
			}
		}
	}
	return numVal(float64(n))
}
