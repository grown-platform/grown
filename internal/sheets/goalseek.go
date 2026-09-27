package sheets

// Goal Seek (Data ▸ What-if analysis ▸ Goal seek): find the value of one input
// cell that makes a formula cell reach a target. The changing cell must hold a
// constant (or be empty); every trial value is written into a copy of the
// workbook and only the formula cell (and what it needs) is recomputed, so the
// posted workbook is never modified.
//
// The search is Grown's own: Newton steps on a forward-difference slope, each
// step halved while it makes things worse; when the slope is flat or the
// steps stall, the search widens outward from the start value until the
// target is bracketed and then narrows the bracket by regula falsi (Illinois
// variant) with a bisection guard. A found value is finally shortened to the
// fewest significant digits that are no worse, so a linear formula lands on
// 2000 rather than 1999.9999999998.

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// GoalSeekRequest is the body of POST …/goalseek.
type GoalSeekRequest struct {
	Data string `json:"data"`
	// Sheet is the sheet id or name the cell addresses are on (default: the
	// first sheet). Addresses may also carry a Sheet! prefix.
	Sheet        string  `json:"sheet,omitempty"`
	FormulaCell  string  `json:"formulaCell"`
	Target       float64 `json:"target"`
	ChangingCell string  `json:"changingCell"`
	// MaxIterations bounds the solver steps (default 100); MaxChange is how
	// close the result must get to the target to count as found (default 0.001).
	MaxIterations int     `json:"maxIterations,omitempty"`
	MaxChange     float64 `json:"maxChange,omitempty"`
}

// GoalSeekResult reports the outcome.
type GoalSeekResult struct {
	Found bool `json:"found"`
	// Value is the changing cell's value at the end of the search (the start
	// value when nothing better was found); Result is the formula's value
	// there (a number, or an error text).
	Value      float64     `json:"value"`
	Result     interface{} `json:"result"`
	Iterations int         `json:"iterations"`
	// SheetID / FormulaCell / ChangingCell echo the resolved cells.
	SheetID      string `json:"sheetId"`
	ChangingCell string `json:"changingCell"`
	FormulaCell  string `json:"formulaCell"`
}

// Errors for requests goal seek cannot run.
var (
	ErrGoalSeekCell     = errors.New("goal seek: invalid cell reference")
	ErrGoalSeekFormula  = errors.New("goal seek: the set cell must contain a formula")
	ErrGoalSeekChanging = errors.New("goal seek: the changing cell must contain a number, not a formula")
)

// GoalSeek runs a goal seek over a workbook JSON document.
func GoalSeek(req GoalSeekRequest) (GoalSeekResult, error) {
	var wb FsWorkbook
	if err := json.Unmarshal([]byte(req.Data), &wb); err != nil || len(wb) == 0 {
		return GoalSeekResult{}, ErrNotWorkbook
	}
	gs, err := newGoalSeeker(wb, req)
	if err != nil {
		return GoalSeekResult{}, err
	}
	gs.run()
	return gs.result(), nil
}

// goalSeeker holds the search state; step() advances it one attempt so the
// search can be paused and resumed (as OnlyOffice's dialog does).
type goalSeeker struct {
	wb      FsWorkbook
	now     time.Time
	fSheet  int
	fAddr   cellAddr
	cSheet  int
	cAddr   cellAddr
	target  float64
	maxIter int
	tol     float64 // "found" threshold (MaxChange)
	fine    float64 // keep refining below tol while progress is cheap

	x, fx    float64 // best point so far (fx = f(x) - target)
	start    float64
	attempts int
	done     bool
	found    bool
	// bracket search
	bracketed      bool
	lo, hi         float64
	flo, fhi       float64
	widen          int // bracket expansion round
	ringInit       bool
	side           [2]sample // last sample right / left of the start
	poles          []float64
	lastRes        value
	evals          int
	stalled        int
	requestSheetID string
}

const goalSeekMaxEvals = 5000

type sample struct{ x, f float64 }

func newGoalSeeker(wb FsWorkbook, req GoalSeekRequest) (*goalSeeker, error) {
	gs := &goalSeeker{wb: wb, now: time.Now(), target: req.Target, maxIter: req.MaxIterations, tol: req.MaxChange}
	if gs.maxIter <= 0 {
		gs.maxIter = 100
	}
	if gs.tol <= 0 {
		gs.tol = 0.001
	}
	gs.fine = math.Min(gs.tol, 1e-10*math.Max(1, math.Abs(req.Target)))
	base := 0
	if req.Sheet != "" {
		base = -1
		for i, s := range wb {
			if s.ID == req.Sheet || s.Name == req.Sheet {
				base = i
				break
			}
		}
		if base < 0 {
			if n, err := strconv.Atoi(req.Sheet); err == nil && n >= 0 && n < len(wb) {
				base = n
			} else {
				return nil, ErrGoalSeekCell
			}
		}
	}
	var ok bool
	if gs.fSheet, gs.fAddr, ok = resolveSheetAddr(wb, base, req.FormulaCell); !ok {
		return nil, ErrGoalSeekCell
	}
	if gs.cSheet, gs.cAddr, ok = resolveSheetAddr(wb, base, req.ChangingCell); !ok {
		return nil, ErrGoalSeekCell
	}
	fc := findCell(wb[gs.fSheet].CellData, gs.fAddr)
	if fc == nil || !strings.HasPrefix(fc.F, "=") {
		return nil, ErrGoalSeekFormula
	}
	cc := findCell(wb[gs.cSheet].CellData, gs.cAddr)
	start := 0.0
	if cc != nil {
		if strings.HasPrefix(cc.F, "=") {
			return nil, ErrGoalSeekChanging
		}
		switch v := cc.V.(type) {
		case nil:
		case float64:
			start = v
		case string:
			if strings.TrimSpace(v) != "" {
				n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
				if err != nil {
					return nil, ErrGoalSeekChanging
				}
				start = n
			}
		case bool:
			return nil, ErrGoalSeekChanging
		default:
			n, err := strconv.ParseFloat(fmt.Sprint(v), 64)
			if err != nil {
				return nil, ErrGoalSeekChanging
			}
			start = n
		}
	}
	gs.start = start
	gs.x = start
	gs.fx = gs.f(start)
	gs.requestSheetID = wb[gs.cSheet].ID
	return gs, nil
}

// resolveSheetAddr parses "A1" or "Sheet2!A1" / "'My sheet'!$A$1".
func resolveSheetAddr(wb FsWorkbook, base int, ref string) (int, cellAddr, bool) {
	ref = strings.TrimSpace(ref)
	si := base
	if i := strings.LastIndex(ref, "!"); i >= 0 {
		name := ref[:i]
		if len(name) >= 2 && name[0] == '\'' && name[len(name)-1] == '\'' {
			name = strings.ReplaceAll(name[1:len(name)-1], "''", "'")
		}
		si = -1
		for k, s := range wb {
			if strings.EqualFold(s.Name, name) {
				si = k
				break
			}
		}
		if si < 0 {
			return 0, cellAddr{}, false
		}
		ref = ref[i+1:]
	}
	a, ok := parseCellRef(strings.ToUpper(strings.ReplaceAll(ref, "$", "")))
	return si, a, ok
}

func findCell(data []FsCellData, a cellAddr) *FsCell {
	for i := range data {
		if data[i].R == a.row && data[i].C == a.col {
			return data[i].V
		}
	}
	return nil
}

// eval computes the formula cell with the changing cell set to x.
func (gs *goalSeeker) eval(x float64) value {
	gs.evals++
	wb := make(FsWorkbook, len(gs.wb))
	copy(wb, gs.wb)
	src := gs.wb[gs.cSheet].CellData
	data := make([]FsCellData, 0, len(src)+1)
	set := false
	for _, cd := range src {
		if cd.R == gs.cAddr.row && cd.C == gs.cAddr.col {
			nc := FsCell{}
			if cd.V != nil {
				nc = *cd.V
			}
			nc.F, nc.V, nc.M = "", x, ""
			cd.V = &nc
			set = true
		}
		data = append(data, cd)
	}
	if !set {
		data = append(data, FsCellData{R: gs.cAddr.row, C: gs.cAddr.col, V: &FsCell{V: x}})
	}
	wb[gs.cSheet].CellData = data
	ev := newWorkbookEvaluator(wb, gs.now)
	return ev.ensureFormula(gs.fSheet, gs.fAddr)
}

// f returns formula(x) − target, NaN when the formula is not a number there.
func (gs *goalSeeker) f(x float64) float64 {
	v := gs.eval(x)
	gs.lastRes = v
	if v.kind == kindArray && v.arr != nil && v.arr.rows > 0 && v.arr.cols > 0 {
		v = v.arr.cells[0][0]
	}
	if v.kind != kindNum && v.kind != kindBool {
		return math.NaN()
	}
	return v.num - gs.target
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// accept moves the best point to (x, fx) when it is closer to the target.
func (gs *goalSeeker) accept(x, fx float64) bool {
	if !finite(fx) {
		return false
	}
	if !finite(gs.fx) || math.Abs(fx) < math.Abs(gs.fx) {
		gs.x, gs.fx = x, fx
		return true
	}
	return false
}

// run steps until the search ends.
func (gs *goalSeeker) run() {
	for !gs.step() {
	}
}

// step performs one attempt; it reports whether the search has finished.
func (gs *goalSeeker) step() bool {
	if gs.done {
		return true
	}
	if finite(gs.fx) && math.Abs(gs.fx) <= gs.fine {
		return gs.finish()
	}
	if gs.attempts >= gs.maxIter || gs.evals >= goalSeekMaxEvals {
		return gs.finish()
	}
	gs.attempts++
	if gs.bracketed {
		gs.bracketStep()
	} else if !gs.newtonStep() {
		gs.searchBracket()
	}
	if finite(gs.fx) && math.Abs(gs.fx) <= gs.fine {
		return gs.finish()
	}
	return false
}

// slope estimates f'(x) by a forward (or backward) difference.
func (gs *goalSeeker) slope(x, fx float64) (float64, bool) {
	h := 1e-7 * math.Max(math.Abs(x), 1e-3)
	fh := gs.f(x + h)
	if !finite(fh) {
		h = -h
		fh = gs.f(x + h)
	}
	if !finite(fh) {
		return 0, false
	}
	gs.accept(x+h, fh)
	d := (fh - fx) / h
	return d, d != 0 && finite(d)
}

// newtonStep tries a damped Newton step from the best point; false when the
// slope is unusable or no step improves the result.
func (gs *goalSeeker) newtonStep() bool {
	if !finite(gs.fx) || gs.stalled >= 3 {
		return false
	}
	x, fx := gs.x, gs.fx
	d, ok := gs.slope(x, fx)
	if !ok {
		return false
	}
	step := -fx / d
	for i := 0; i < 30; i++ {
		nx := x + step
		nf := gs.f(nx)
		if finite(nf) && nf != 0 && math.Signbit(nf) != math.Signbit(fx) && !gs.acrossPole(x, nx) {
			gs.accept(nx, nf)
			gs.setBracket(x, fx, nx, nf)
			return true
		}
		if finite(nf) && math.Abs(nf) < math.Abs(fx) {
			gs.accept(nx, nf)
			if math.Abs(nf) > 0.5*math.Abs(fx) {
				gs.stalled++
			} else {
				gs.stalled = 0
			}
			return true
		}
		step /= 2
	}
	gs.stalled++
	return false
}

func (gs *goalSeeker) setBracket(a, fa, b, fb float64) {
	if a > b {
		a, b, fa, fb = b, a, fb, fa
	}
	gs.bracketed, gs.lo, gs.hi, gs.flo, gs.fhi = true, a, b, fa, fb
}

// acrossPole reports whether [a, b] holds a point where an earlier bracket
// closed in on a jump of the formula instead of a root (1/x at 0).
func (gs *goalSeeker) acrossPole(a, b float64) bool {
	if a > b {
		a, b = b, a
	}
	for _, p := range gs.poles {
		if p >= a && p <= b {
			return true
		}
	}
	return false
}

// searchBracket samples outward from the start value, both ways, in doubling
// steps (one ring per call) until two neighbouring samples on one side straddle
// the target.
func (gs *goalSeeker) searchBracket() {
	if !gs.ringInit {
		gs.ringInit = true
		fc := gs.f(gs.start)
		gs.side[0] = sample{gs.start, fc}
		gs.side[1] = sample{gs.start, fc}
	}
	for tries := 0; tries < 8 && !gs.bracketed && gs.widen < 1100; tries++ {
		gs.widen++
		d := math.Max(math.Abs(gs.start), 1) * math.Pow(2, float64(gs.widen)-12)
		if d > 1e300 {
			return
		}
		for s, dir := range []float64{1, -1} {
			nx := gs.start + dir*d
			nf := gs.f(nx)
			gs.accept(nx, nf)
			prev := gs.side[s]
			if finite(nf) {
				if nf == 0 {
					return
				}
				if finite(prev.f) && math.Signbit(nf) != math.Signbit(prev.f) && !gs.acrossPole(prev.x, nx) {
					gs.setBracket(prev.x, prev.f, nx, nf)
					gs.side[s] = sample{nx, nf}
					return
				}
				gs.side[s] = sample{nx, nf}
			}
		}
	}
}

// bracketStep narrows [lo, hi]: a Newton step from the better end when it
// lands well inside the bracket, bisection otherwise. A bracket that closes
// in on a jump rather than a root is recorded as a pole and dropped.
func (gs *goalSeeker) bracketStep() {
	lo, hi, flo, fhi := gs.lo, gs.hi, gs.flo, gs.fhi
	bx, bf := lo, flo
	if math.Abs(fhi) < math.Abs(flo) {
		bx, bf = hi, fhi
	}
	x := (lo + hi) / 2
	if d, ok := gs.slope(bx, bf); ok {
		if nx := bx - bf/d; nx > lo && nx < hi && math.Abs(nx-bx) < 0.5*(hi-lo) {
			x = nx
		}
	}
	fx := gs.f(x)
	if !finite(fx) && x != (lo+hi)/2 {
		x = (lo + hi) / 2
		fx = gs.f(x)
	}
	if !finite(fx) {
		gs.dropBracket(x)
		return
	}
	gs.accept(x, fx)
	if fx == 0 {
		return
	}
	if math.Signbit(fx) == math.Signbit(flo) {
		gs.lo, gs.flo = x, fx
	} else {
		gs.hi, gs.fhi = x, fx
	}
	if gs.hi-gs.lo <= 1e-14*math.Max(1, math.Abs(gs.hi)) {
		gs.dropBracket((gs.lo + gs.hi) / 2)
	}
}

// dropBracket ends a bracket that did not reach the target (the formula
// jumps there) and goes back to widening the search.
func (gs *goalSeeker) dropBracket(at float64) {
	gs.bracketed = false
	if !(finite(gs.fx) && math.Abs(gs.fx) <= gs.tol) {
		gs.poles = append(gs.poles, at)
	}
	gs.stalled = 3
}

// finish decides "found" and shortens the value to the fewest significant
// digits that do not move the result further from the target.
func (gs *goalSeeker) finish() bool {
	gs.done = true
	gs.found = finite(gs.fx) && math.Abs(gs.fx) <= gs.tol
	if gs.found && gs.fx != 0 {
		for digits := 1; digits <= 15; digits++ {
			r, err := strconv.ParseFloat(strconv.FormatFloat(gs.x, 'g', digits, 64), 64)
			if err != nil || r == gs.x {
				continue
			}
			fr := gs.f(r)
			if finite(fr) && math.Abs(fr) <= math.Abs(gs.fx) {
				gs.x, gs.fx = r, fr
				break
			}
		}
	}
	if !gs.found {
		// Nothing reached the target: leave the input where it was.
		gs.x = gs.start
		gs.fx = gs.f(gs.start)
	}
	return true
}

func (gs *goalSeeker) result() GoalSeekResult {
	v := gs.eval(gs.x)
	var res interface{}
	if v.kind == kindNum || v.kind == kindBool {
		res = v.num
	} else {
		res = v.asInterface()
	}
	return GoalSeekResult{
		Found: gs.found, Value: gs.x, Result: res, Iterations: gs.attempts,
		SheetID:      gs.requestSheetID,
		ChangingCell: addrToName(gs.cAddr.row, gs.cAddr.col),
		FormulaCell:  addrToName(gs.fAddr.row, gs.fAddr.col),
	}
}
