package sheets

// formula_stat_regression.go — least-squares regression: LINEST, LOGEST,
// TREND and GROWTH (OnlyOffice parity milestone M3).
//
// Every function fits y = m1·x1 + … + mk·xk + b (LOGEST and GROWTH fit
// ln y, i.e. y = b·m1^x1·…·mk^xk) with one or several x variables:
//
//   - known_x's of the same shape as known_y's is one variable;
//   - a column of y with several x columns (or a row of y with several x
//     rows) gives one variable per column (row);
//   - any other pairing is #REF!.
//
// The fit centres the data when the intercept is estimated and runs a
// modified Gram–Schmidt QR decomposition. A variable that is (nearly) a
// linear combination of the ones before it is dropped: its coefficient and
// standard error are 0, as in Excel. With stats=TRUE the result has Excel's
// five rows: coefficients, standard errors, r² and the standard error of y,
// the F statistic and the degrees of freedom, and the regression and
// residual sums of squares.

import "math"

func init() {
	registerFunc("LINEST", func(c *callCtx) value { return regEstimate(c, false) })
	registerFunc("LOGEST", func(c *callCtx) value { return regEstimate(c, true) })
	registerFunc("TREND", func(c *callCtx) value { return regPredict(c, false) })
	registerFunc("GROWTH", func(c *callCtx) value { return regPredict(c, true) })
}

// regMatrix reads a regression data argument as a grid of numbers. A
// scalar error propagates; any cell that is not a number (text, a boolean,
// an empty cell, an error inside the range) is #VALUE!.
func regMatrix(c *callCtx, i int) ([][]float64, *value) {
	if v, ok := c.raw(i).(value); ok && v.kind != kindArray && v.isErr() {
		return nil, &v
	}
	rv, ok := c.rangeArg(i)
	if !ok || rv.rows == 0 || rv.cols == 0 {
		e := errValue
		return nil, &e
	}
	out := make([][]float64, rv.rows)
	for r, row := range rv.cells {
		out[r] = make([]float64, rv.cols)
		for col, v := range row {
			if v.kind != kindNum || v.blank || isOmitted(v) {
				e := errValue
				return nil, &e
			}
			out[r][col] = v.num
		}
	}
	return out, nil
}

// regFlag reads an optional logical argument.
func regFlag(c *callCtx, i int, def bool) (bool, *value) {
	if i >= c.nargs() {
		return def, nil
	}
	if rv, ok := c.raw(i).(rangeVal); ok && rv.rows*rv.cols > 1 {
		e := errValue
		return false, &e
	}
	v := c.scalar(i).topLeft()
	switch {
	case isOmitted(v), v.blank:
		return def, nil
	case v.isErr():
		return false, &v
	case v.kind == kindNum, v.kind == kindBool:
		return v.num != 0, nil
	}
	e := errValue
	return false, &e
}

// regLayout describes how the x variables are laid out.
type regLayout int

const (
	regSame regLayout = iota // one variable, same shape as y
	regCols                  // y is a column, one variable per x column
	regRows                  // y is a row, one variable per x row
)

// regData holds the observations: ys[n] and xs[n][k].
type regData struct {
	ys     []float64
	xs     [][]float64
	layout regLayout
	yRows  int // shape of known_y's (for the default new_x's)
	yCols  int
	xGrid  [][]float64
}

func regRead(c *callCtx, logY bool) (*regData, *value) {
	y, e := regMatrix(c, 0)
	if e != nil {
		return nil, e
	}
	ry, cy := len(y), len(y[0])
	d := &regData{yRows: ry, yCols: cy}
	for _, row := range y {
		for _, v := range row {
			if logY {
				if v <= 0 {
					e := errNum
					return nil, &e
				}
				v = math.Log(v)
			}
			d.ys = append(d.ys, v)
		}
	}
	n := len(d.ys)
	var x [][]float64
	if c.nargs() < 2 || isOmitted(c.scalar(1).topLeft()) {
		x = make([][]float64, ry)
		for r := range x {
			x[r] = make([]float64, cy)
			for col := range x[r] {
				x[r][col] = float64(r*cy + col + 1)
			}
		}
	} else if x, e = regMatrix(c, 1); e != nil {
		return nil, e
	}
	d.xGrid = x
	rx, cx := len(x), len(x[0])
	switch {
	case rx == ry && cx == cy:
		d.layout = regSame
		for _, row := range x {
			for _, v := range row {
				d.xs = append(d.xs, []float64{v})
			}
		}
	case cy == 1 && rx == ry:
		d.layout = regCols
		d.xs = x
	case ry == 1 && cx == cy:
		d.layout = regRows
		d.xs = make([][]float64, n)
		for i := range d.xs {
			d.xs[i] = make([]float64, rx)
			for j := 0; j < rx; j++ {
				d.xs[i][j] = x[j][i]
			}
		}
	default:
		e := errRef
		return nil, &e
	}
	return d, nil
}

// regFit is a fitted model.
type regFit struct {
	k       int       // number of x variables
	m       []float64 // coefficients m1..mk (0 for dropped variables)
	b       float64
	se      []float64 // standard errors of m1..mk
	seB     float64
	kept    int // variables retained
	df      float64
	ssReg   float64
	ssResid float64
	cnst    bool
}

// regSolve fits ys on xs. Variables whose centred column is (numerically)
// dependent on the previous ones are dropped.
func regSolve(ys []float64, xs [][]float64, cnst bool) *regFit {
	n := len(ys)
	k := len(xs[0])
	f := &regFit{k: k, m: make([]float64, k), se: make([]float64, k), cnst: cnst}
	xm := make([]float64, k)
	ym := 0.0
	if cnst {
		for i := 0; i < n; i++ {
			ym += ys[i]
			for j := 0; j < k; j++ {
				xm[j] += xs[i][j]
			}
		}
		ym /= float64(n)
		for j := range xm {
			xm[j] /= float64(n)
		}
	}
	// Columns of the (centred) design matrix.
	cols := make([][]float64, k)
	for j := 0; j < k; j++ {
		cols[j] = make([]float64, n)
		for i := 0; i < n; i++ {
			cols[j][i] = xs[i][j] - xm[j]
		}
	}
	yc := make([]float64, n)
	for i := range yc {
		yc[i] = ys[i] - ym
	}
	// Modified Gram–Schmidt: Q (orthonormal kept columns) and R.
	var q [][]float64
	var keptIdx []int
	R := make([][]float64, 0, k) // R[a][b] for kept a ≤ b (b indexes kept)
	for j := 0; j < k; j++ {
		v := append([]float64(nil), cols[j]...)
		norm0 := regNorm(v)
		coef := make([]float64, len(q))
		for a := range q {
			r := regDot(q[a], v)
			coef[a] = r
			for i := range v {
				v[i] -= r * q[a][i]
			}
		}
		norm := regNorm(v)
		if norm0 == 0 || norm <= 1e-10*norm0 || n <= len(q)+btoi(cnst) {
			continue // dependent (or no degrees left): dropped
		}
		for i := range v {
			v[i] /= norm
		}
		for a := range R {
			R[a] = append(R[a], coef[a])
		}
		row := make([]float64, len(q)+1)
		row[len(q)] = norm
		R = append(R, row)
		q = append(q, v)
		keptIdx = append(keptIdx, j)
	}
	p := len(q)
	f.kept = p
	// Solve R·m = Qᵀy by back substitution.
	qty := make([]float64, p)
	for a := 0; a < p; a++ {
		qty[a] = regDot(q[a], yc)
	}
	coef := make([]float64, p)
	for a := p - 1; a >= 0; a-- {
		s := qty[a]
		for b := a + 1; b < p; b++ {
			s -= R[a][b] * coef[b]
		}
		coef[a] = s / R[a][a]
	}
	for a, j := range keptIdx {
		f.m[j] = coef[a]
	}
	if cnst {
		f.b = ym
		for j := 0; j < k; j++ {
			f.b -= f.m[j] * xm[j]
		}
	}
	// Sums of squares.
	for i := 0; i < n; i++ {
		fit := f.b
		for j := 0; j < k; j++ {
			fit += f.m[j] * xs[i][j]
		}
		r := ys[i] - fit
		f.ssResid += r * r
		if cnst {
			f.ssReg += (fit - ym) * (fit - ym)
		} else {
			f.ssReg += fit * fit
		}
	}
	f.df = float64(n - p - btoi(cnst))
	// Standard errors from (XᵀX)⁻¹ = R⁻¹R⁻ᵀ.
	if f.df > 0 {
		s2 := f.ssResid / f.df
		rinv := regUpperInverse(R)
		for a, j := range keptIdx {
			sum := 0.0
			for b := a; b < p; b++ {
				sum += rinv[a][b] * rinv[a][b]
			}
			f.se[j] = math.Sqrt(s2 * sum)
		}
		if cnst {
			// Var(b) = σ²(1/n + x̄ᵀ(XcᵀXc)⁻¹x̄) with x̄ over the kept variables.
			w := make([]float64, p) // R⁻ᵀ x̄
			for a := 0; a < p; a++ {
				s := 0.0
				for b := 0; b <= a; b++ {
					s += rinv[b][a] * xm[keptIdx[b]]
				}
				w[a] = s
			}
			f.seB = math.Sqrt(s2 * (1/float64(n) + regDot(w, w)))
		}
	}
	return f
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}

func regDot(a, b []float64) float64 {
	s := 0.0
	for i := range a {
		s += a[i] * b[i]
	}
	return s
}

func regNorm(a []float64) float64 { return math.Sqrt(regDot(a, a)) }

// regUpperInverse inverts an upper-triangular matrix.
func regUpperInverse(R [][]float64) [][]float64 {
	p := len(R)
	inv := make([][]float64, p)
	for i := range inv {
		inv[i] = make([]float64, p)
	}
	for j := p - 1; j >= 0; j-- {
		inv[j][j] = 1 / R[j][j]
		for i := j - 1; i >= 0; i-- {
			s := 0.0
			for l := i + 1; l <= j; l++ {
				s += R[i][l] * inv[l][j]
			}
			inv[i][j] = -s / R[i][i]
		}
	}
	return inv
}

// regEstimate implements LINEST (logY=false) and LOGEST (logY=true).
func regEstimate(c *callCtx, logY bool) value {
	if c.nargs() < 1 || c.nargs() > 4 {
		return errNA
	}
	d, e := regRead(c, logY)
	if e != nil {
		return *e
	}
	cnst, e := regFlag(c, 2, true)
	if e != nil {
		return *e
	}
	stats, e := regFlag(c, 3, false)
	if e != nil {
		return *e
	}
	f := regSolve(d.ys, d.xs, cnst)
	k := f.k
	out := func(x float64) value {
		if logY {
			x = math.Exp(x)
		}
		return sdNum(x)
	}
	row0 := make([]value, k+1)
	for j := 0; j < k; j++ {
		row0[k-1-j] = out(f.m[j])
	}
	if cnst {
		row0[k] = out(f.b)
	} else {
		row0[k] = out(0)
	}
	if !stats {
		return arrayValue([][]value{row0})
	}
	na := func() []value {
		r := make([]value, k+1)
		for i := range r {
			r[i] = errNA
		}
		return r
	}
	row1 := make([]value, k+1)
	for j := 0; j < k; j++ {
		row1[k-1-j] = sdNum(f.se[j])
	}
	if cnst {
		row1[k] = sdNum(f.seB)
	} else {
		row1[k] = errNA
	}
	row2, row3, row4 := na(), na(), na()
	total := f.ssReg + f.ssResid
	if total == 0 {
		row2[0] = errNum
	} else {
		row2[0] = sdNum(f.ssReg / total)
	}
	row3[1] = numVal(f.df)
	if f.df > 0 {
		row2[1] = sdNum(math.Sqrt(f.ssResid / f.df))
		v1 := float64(f.kept)
		if f.ssResid == 0 || v1 == 0 {
			row3[0] = errNum
		} else {
			row3[0] = sdNum((f.ssReg / v1) / (f.ssResid / f.df))
		}
	} else {
		row2[1] = errNum
		row3[0] = errNum
	}
	row4[0] = sdNum(f.ssReg)
	row4[1] = sdNum(f.ssResid)
	if k == 0 {
		return arrayValue([][]value{row0, row1, row2[:1], row3[:1], row4[:1]})
	}
	return arrayValue([][]value{row0, row1, row2, row3, row4})
}

// regPredict implements TREND (logY=false) and GROWTH (logY=true).
func regPredict(c *callCtx, logY bool) value {
	if c.nargs() < 1 || c.nargs() > 4 {
		return errNA
	}
	d, e := regRead(c, logY)
	if e != nil {
		return *e
	}
	cnst, e := regFlag(c, 3, true)
	if e != nil {
		return *e
	}
	f := regSolve(d.ys, d.xs, cnst)
	k := f.k
	nx := d.xGrid
	if c.nargs() >= 3 && !isOmitted(c.scalar(2).topLeft()) {
		if nx, e = regMatrix(c, 2); e != nil {
			return *e
		}
	}
	eval := func(xs []float64) value {
		y := f.b
		for j, x := range xs {
			y += f.m[j] * x
		}
		if logY {
			y = math.Exp(y)
		}
		return sdNum(y)
	}
	rows, cols := len(nx), len(nx[0])
	switch d.layout {
	case regSame:
		out := make([][]value, rows)
		for r := range out {
			out[r] = make([]value, cols)
			for col := range out[r] {
				out[r][col] = eval([]float64{nx[r][col]})
			}
		}
		return arrayValue(out)
	case regCols:
		if cols != k {
			return errRef
		}
		out := make([][]value, rows)
		for r := range out {
			out[r] = []value{eval(nx[r])}
		}
		return arrayValue(out)
	default: // regRows
		if rows != k {
			return errRef
		}
		out := make([]value, cols)
		for col := range out {
			xs := make([]float64, k)
			for j := 0; j < k; j++ {
				xs[j] = nx[j][col]
			}
			out[col] = eval(xs)
		}
		return arrayValue([][]value{out})
	}
}
