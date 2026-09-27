package sheets

// formula_stat_tests.go — hypothesis tests and descriptive statistics
// (OnlyOffice parity milestone M3b): T.TEST, Z.TEST, F.TEST, CHISQ.TEST and
// their legacy names, CONFIDENCE.T, COVARIANCE.P/S, PROB, STEYX,
// PERMUTATIONA, VARA, VARPA and STDEVPA.

import "math"

func init() {
	registerFunc("T.TEST", sttTTest)
	registerFunc("TTEST", sttTTest)
	registerFunc("Z.TEST", sttZTest)
	registerFunc("ZTEST", sttZTest)
	registerFunc("F.TEST", sttFTest)
	registerFunc("FTEST", sttFTest)
	registerFunc("CHISQ.TEST", sttChiTest)
	registerFunc("CHITEST", sttChiTest)

	registerFunc("CONFIDENCE.T", func(c *callCtx) value {
		return sdCall(c, 3, 3, func(a []float64) value {
			alpha, sd, n := a[0], a[1], math.Trunc(a[2])
			if alpha <= 0 || alpha >= 1 || sd <= 0 || n < 1 {
				return errNum
			}
			if n == 1 {
				return errDiv0
			}
			x, ok := sdInvertDown(func(x float64) float64 { _, u := tCDF2(x, n-1); return u }, alpha/2, 0, math.Inf(1), 1)
			if !ok {
				return errNum
			}
			return sdNum(x * sd / math.Sqrt(n))
		})
	})
	registerFunc("COVARIANCE.P", func(c *callCtx) value { return sttCovariance(c, false) })
	registerFunc("COVARIANCE.S", func(c *callCtx) value { return sttCovariance(c, true) })
	registerFunc("PROB", sttProb)
	registerFunc("STEYX", sttSteyx)
	registerFunc("PERMUTATIONA", func(c *callCtx) value {
		return sdCall(c, 2, 2, func(a []float64) value {
			n, k := a[0], a[1]
			if n < 0 || k < 0 {
				return errNum
			}
			return sdNum(math.Pow(math.Trunc(n), math.Trunc(k)))
		})
	})
	registerFunc("VARA", func(c *callCtx) value { return sttVarA(c, true, false) })
	registerFunc("VARPA", func(c *callCtx) value { return sttVarA(c, false, false) })
	registerFunc("STDEVPA", func(c *callCtx) value { return sttVarA(c, false, true) })
}

// sttSample gathers the numbers of one data-set argument the way the
// statistical tests read them: numbers count, everything else in a range
// or array is skipped, and the first error propagates.
func sttSample(c *callCtx, i int) ([]float64, *value) {
	switch v := c.raw(i).(type) {
	case value:
		if v.kind != kindArray && isOmitted(v) {
			e := errValue
			return nil, &e
		}
	case nil:
		e := errNA
		return nil, &e
	}
	rv, _ := c.rangeArg(i)
	var out []float64
	for _, x := range rv.flat() {
		if x.isErr() {
			return nil, &x
		}
		if x.kind == kindNum && !x.blank {
			out = append(out, x.num)
		}
	}
	return out, nil
}

// sttMeanVar returns the mean and the sample variance (n−1 divisor).
func sttMeanVar(xs []float64) (mean, variance float64) {
	n := float64(len(xs))
	mean = sttSum(xs) / n
	ss := 0.0
	for _, x := range xs {
		d := x - mean
		ss += d * d
	}
	return mean, ss / (n - 1)
}

// sttTTest implements T.TEST(array1, array2, tails, type).
func sttTTest(c *callCtx) value {
	if c.nargs() != 4 {
		return errNA
	}
	var tt [2]float64
	for i := 0; i < 2; i++ {
		x, e, ok := sdArg(c, 2+i)
		if !ok {
			return e
		}
		tt[i] = math.Trunc(x)
	}
	tails, typ := tt[0], tt[1]
	if tails != 1 && tails != 2 || typ < 1 || typ > 3 {
		return errNum
	}
	var t, df float64
	if typ == 1 {
		ra, _ := c.rangeArg(0)
		rb, _ := c.rangeArg(1)
		fa, fb := ra.flat(), rb.flat()
		for _, v := range append(append([]value{}, fa...), fb...) {
			if v.isErr() {
				return v
			}
		}
		if len(fa) != len(fb) {
			return errNA
		}
		var d []float64
		for i := range fa {
			if fa[i].kind == kindNum && !fa[i].blank && fb[i].kind == kindNum && !fb[i].blank {
				d = append(d, fa[i].num-fb[i].num)
			}
		}
		if len(d) < 2 {
			return errDiv0
		}
		m, v := sttMeanVar(d)
		n := float64(len(d))
		if v == 0 {
			return errDiv0
		}
		t, df = m/math.Sqrt(v/n), n-1
	} else {
		xs, e := sttSample(c, 0)
		if e != nil {
			return *e
		}
		ys, e := sttSample(c, 1)
		if e != nil {
			return *e
		}
		if len(xs) < 2 || len(ys) < 2 {
			return errDiv0
		}
		m1, v1 := sttMeanVar(xs)
		m2, v2 := sttMeanVar(ys)
		n1, n2 := float64(len(xs)), float64(len(ys))
		if typ == 2 {
			df = n1 + n2 - 2
			sp := ((n1-1)*v1 + (n2-1)*v2) / df
			se := math.Sqrt(sp * (1/n1 + 1/n2))
			if se == 0 {
				return errDiv0
			}
			t = (m1 - m2) / se
		} else {
			a, b := v1/n1, v2/n2
			if a+b == 0 {
				return errDiv0
			}
			t = (m1 - m2) / math.Sqrt(a+b)
			df = (a + b) * (a + b) / (a*a/(n1-1) + b*b/(n2-1))
		}
	}
	if math.IsNaN(t) || math.IsNaN(df) {
		return errNum
	}
	_, u := tCDF2(math.Abs(t), df)
	return sdNum(tails * u)
}

// sttZTest implements Z.TEST(array, x, [sigma]).
func sttZTest(c *callCtx) value {
	if c.nargs() < 2 || c.nargs() > 3 {
		return errNA
	}
	xs, e := sttSample(c, 0)
	if e != nil {
		return *e
	}
	x, ev, ok := sdArg(c, 1)
	if !ok {
		return ev
	}
	sigma := math.NaN()
	if c.nargs() == 3 && !isOmitted(c.scalar(2)) {
		s, ev, ok := sdArg(c, 2)
		if !ok {
			return ev
		}
		if s <= 0 {
			return errNum
		}
		sigma = s
	}
	if len(xs) < 2 {
		return errDiv0
	}
	m, v := sttMeanVar(xs)
	if math.IsNaN(sigma) {
		if v == 0 {
			return errDiv0
		}
		sigma = math.Sqrt(v)
	}
	n := float64(len(xs))
	z := (m - x) / (sigma / math.Sqrt(n))
	if math.IsNaN(z) {
		return errNum
	}
	return sdNum(normCDF(-z))
}

// sttFTest implements F.TEST(array1, array2).
func sttFTest(c *callCtx) value {
	if c.nargs() != 2 {
		return errNA
	}
	xs, e := sttSample(c, 0)
	if e != nil {
		return *e
	}
	ys, e := sttSample(c, 1)
	if e != nil {
		return *e
	}
	if len(xs) < 2 || len(ys) < 2 {
		return errDiv0
	}
	_, v1 := sttMeanVar(xs)
	_, v2 := sttMeanVar(ys)
	if v1 == 0 || v2 == 0 {
		return errDiv0
	}
	l, u := fCDF2(v1/v2, float64(len(xs)-1), float64(len(ys)-1))
	return sdNum(2 * math.Min(l, u))
}

// sttChiTest implements CHISQ.TEST(actual_range, expected_range).
func sttChiTest(c *callCtx) value {
	if c.nargs() != 2 {
		return errNA
	}
	ra, _ := c.rangeArg(0)
	rb, _ := c.rangeArg(1)
	for _, r := range []rangeVal{ra, rb} {
		if r.rows == 1 && r.cols == 1 && r.cells[0][0].isErr() {
			return r.cells[0][0]
		}
	}
	if ra.rows != rb.rows || ra.cols != rb.cols || ra.rows*ra.cols < 2 {
		return errNA
	}
	chi := 0.0
	n := 0
	for i := 0; i < ra.rows; i++ {
		for j := 0; j < ra.cols; j++ {
			a, b := ra.cells[i][j], rb.cells[i][j]
			if a.isErr() {
				return a
			}
			if b.isErr() {
				return b
			}
			if a.kind != kindNum || b.kind != kindNum || a.blank || b.blank {
				continue
			}
			if b.num == 0 {
				return errDiv0
			}
			d := a.num - b.num
			chi += d * d / b.num
			n++
		}
	}
	if n == 0 {
		return errDiv0
	}
	var df float64
	if ra.rows > 1 && ra.cols > 1 {
		df = float64((ra.rows - 1) * (ra.cols - 1))
	} else {
		df = float64(ra.rows*ra.cols - 1)
	}
	if chi < 0 {
		return errNum
	}
	_, u := chiCDF2(chi, df)
	return sdNum(u)
}

// sttCovariance implements COVARIANCE.P (sample=false) and COVARIANCE.S.
func sttCovariance(c *callCtx, sample bool) value {
	if c.nargs() != 2 {
		return errNA
	}
	xs, ys, err, bad := sttPairs(c, 0, 1)
	if err != nil {
		return *err
	}
	if bad {
		return errNA
	}
	n := float64(len(xs))
	if n == 0 || (sample && n < 2) {
		return errDiv0
	}
	mx, my := sttSum(xs)/n, sttSum(ys)/n
	s := 0.0
	for i := range xs {
		s += (xs[i] - mx) * (ys[i] - my)
	}
	if sample {
		return sdNum(s / (n - 1))
	}
	return sdNum(s / n)
}

// sttProb implements PROB(x_range, prob_range, lower_limit, [upper_limit]).
func sttProb(c *callCtx) value {
	if c.nargs() < 3 || c.nargs() > 4 {
		return errNA
	}
	rx, _ := c.rangeArg(0)
	rp, _ := c.rangeArg(1)
	fx, fp := rx.flat(), rp.flat()
	for _, v := range append(append([]value{}, fx...), fp...) {
		if v.isErr() {
			return v
		}
	}
	lo, e, ok := sdArg(c, 2)
	if !ok {
		return e
	}
	hi := lo
	if c.nargs() == 4 && !isOmitted(c.scalar(3)) {
		if hi, e, ok = sdArg(c, 3); !ok {
			return e
		}
	}
	if len(fx) != len(fp) {
		return errNA
	}
	sum, total := 0.0, 0.0
	for i := range fx {
		if fx[i].kind != kindNum || fp[i].kind != kindNum || fx[i].blank || fp[i].blank {
			return errNA
		}
		p := fp[i].num
		if p < 0 || p > 1 {
			return errNum
		}
		total += p
		if x := fx[i].num; x >= lo && x <= hi {
			sum += p
		}
	}
	if math.Abs(total-1) > 1e-10 {
		return errNum
	}
	return sdNum(sum)
}

// sttSteyx implements STEYX(known_y's, known_x's).
func sttSteyx(c *callCtx) value {
	if c.nargs() != 2 {
		return errNA
	}
	for i := 0; i < 2; i++ {
		if v, ok := c.raw(i).(value); ok && v.kind != kindArray && isOmitted(v) {
			return errValue
		}
	}
	ys, xs, err, bad := sttPairs(c, 0, 1)
	if err != nil {
		return *err
	}
	if bad {
		return errNA
	}
	n := float64(len(xs))
	if n < 3 {
		return errDiv0
	}
	mx, my := sttSum(xs)/n, sttSum(ys)/n
	var sxx, syy, sxy float64
	for i := range xs {
		dx, dy := xs[i]-mx, ys[i]-my
		sxx += dx * dx
		syy += dy * dy
		sxy += dx * dy
	}
	if sxx == 0 {
		return errDiv0
	}
	r := (syy - sxy*sxy/sxx) / (n - 2)
	if r < 0 || math.IsNaN(r) || math.IsInf(r, 0) {
		return errNum
	}
	return sdNum(math.Sqrt(r))
}

// sttVarA implements VARA (sample), VARPA and STDEVPA (population) with the
// *A counting rules: in a reference, text counts as 0 and TRUE/FALSE as
// 1/0 (empty cells are skipped); in an array constant, text is skipped;
// a direct text argument must be numeric.
func sttVarA(c *callCtx, sample, stdev bool) value {
	var xs []float64
	for i := 0; i < c.nargs(); i++ {
		switch a := c.raw(i).(type) {
		case rangeVal:
			fromRef := a.ref != nil
			for _, v := range a.flat() {
				switch {
				case v.isErr():
					return v
				case v.blank:
				case v.kind == kindNum, v.kind == kindBool:
					xs = append(xs, v.num)
				case v.kind == kindStr && fromRef:
					xs = append(xs, 0)
				}
			}
		case value:
			if a.kind == kindArray {
				for _, v := range flattenArgs([]interface{}{a}) {
					switch {
					case v.isErr():
						return v
					case v.kind == kindNum, v.kind == kindBool:
						xs = append(xs, v.num)
					}
				}
				continue
			}
			switch {
			case a.isErr():
				return a
			case a.ref != nil && a.blank:
			case a.kind == kindNum, a.kind == kindBool:
				xs = append(xs, a.num)
			case a.kind == kindStr && a.ref != nil:
				xs = append(xs, 0)
			case a.kind == kindStr:
				n, e, ok := mthNum(a)
				if !ok {
					return e
				}
				xs = append(xs, n)
			}
		}
	}
	n := float64(len(xs))
	if n == 0 || (sample && n < 2) {
		return errDiv0
	}
	mean := sttSum(xs) / n
	ss := 0.0
	for _, x := range xs {
		d := x - mean
		ss += d * d
	}
	div := n
	if sample {
		div = n - 1
	}
	v := ss / div
	if stdev {
		v = math.Sqrt(v)
	}
	return sdNum(v)
}
