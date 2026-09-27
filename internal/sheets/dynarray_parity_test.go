package sheets

// Workbook-level parity runner for dynamic arrays (OnlyOffice
// DynamicArraysTests.js). Unlike TestParity, which evaluates one formula in a
// fixed sheet, a case here is a sequence of edits and reads on one sheet: the
// state is saved (recomputed with RecomputeWorkbook's machinery, spill marks
// and all) after every edit, the way the editor's autosave does, so spills
// that grow, shrink, get blocked and unblocked are replayed faithfully.
//
// Fixture: testdata/dynarray/dynamic-arrays.json
//
//	{"cases": [{"id": "<tag>", "pending": "reason", "steps": [
//	  {"set": {"A1": "1", "B1": "", "C1": "=A1*2"}},  // typed input; "" clears
//	  {"enter": "=SIN(A1:A3)", "at": "D1"},           // a formula typed into a cell
//	  {"clear": "A1:Z30"},
//	  {"check": "value", "cell": "D2", "want": 0.9092, "approx": true, "tol": 0.01},
//	  {"check": "stored", "cell": "A1", "want": "SIN(_xlfn.SINGLE(B1))"},  // storage form
//	  {"check": "storedNorm", …}   // storage form without _xlfn./_xlws. prefixes
//	  {"check": "edit", "cell": "A1", "want": "=SIN(@B1)"},  // stored form read back
//	  {"check": "dynRows"|"dynCols", "cell": "A1", "want": 2},  // spill extent
//	  {"check": "shapeArray"|"shapeRows"|"shapeCols", "formula": "SIN(A1:A3)", "at": "D1", "want": 3},
//	  {"check": "arrElem", "formula": "A100:B101", "at": "D100", "dr": 0, "dc": 2, "want": "#N/A"},
//	  … any step may carry "pending": "oo-diff/<key>: reason"
//	]}]}
//
// "approx" numbers were read back truncated to as many decimals as the
// expected value shows; they match within one unit of that last decimal.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
)

type daFile struct {
	Cases []daCase `json:"cases"`
}

type daCase struct {
	ID      string   `json:"id"`
	Pending string   `json:"pending"`
	Steps   []daStep `json:"steps"`
}

type daStep struct {
	Set     map[string]string `json:"set"`
	Enter   string            `json:"enter"`
	At      string            `json:"at"`
	Ctrl    bool              `json:"ctrl"`
	CSE     bool              `json:"cse"`
	Clear   string            `json:"clear"`
	Check   string            `json:"check"`
	Cell    string            `json:"cell"`
	Formula string            `json:"formula"`
	DR      int               `json:"dr"`
	DC      int               `json:"dc"`
	Want    interface{}       `json:"want"`
	Approx  bool              `json:"approx"`
	Tol     float64           `json:"tol"`
	Pending string            `json:"pending"`
}

// daBook is the sheet under test: persisted celldata plus the formulas as
// typed, and the evaluator of the last recalculation.
type daBook struct {
	data    []FsCellData
	entered map[cellAddr]string
	ev      *Evaluator
	dirty   bool
}

const daRows, daCols = 100, 26 // FortuneSheet's default grid

func (b *daBook) put(a cellAddr, c *FsCell) {
	for i := range b.data {
		if b.data[i].R == a.row && b.data[i].C == a.col {
			if c == nil {
				b.data = append(b.data[:i], b.data[i+1:]...)
			} else {
				b.data[i].V = c
			}
			b.dirty = true
			return
		}
	}
	if c != nil {
		b.data = append(b.data, FsCellData{R: a.row, C: a.col, V: c})
		sort.Slice(b.data, func(i, j int) bool {
			if b.data[i].R != b.data[j].R {
				return b.data[i].R < b.data[j].R
			}
			return b.data[i].C < b.data[j].C
		})
	}
	b.dirty = true
}

// typed converts typed input into a cell (numbers, dates, booleans, errors,
// formulas, text).
func daTyped(text string) *FsCell {
	if text == "" {
		return nil
	}
	if strings.HasPrefix(text, "=") {
		return &FsCell{F: text}
	}
	switch strings.ToUpper(text) {
	case "TRUE":
		return &FsCell{V: true, M: "TRUE", CT: &FsCellType{T: "b"}}
	case "FALSE":
		return &FsCell{V: false, M: "FALSE", CT: &FsCellType{T: "b"}}
	}
	if isErrorCode(text) {
		return &FsCell{V: text, M: text, CT: &FsCellType{T: "e"}}
	}
	if p, ok := nfParseInput(text, nfParseOpts{}); ok {
		return &FsCell{V: p.value, M: text, CT: &FsCellType{FA: p.format, T: "n"}}
	}
	return &FsCell{V: text, M: text, CT: &FsCellType{FA: "General", T: "g"}}
}

func (b *daBook) recalc() {
	if !b.dirty && b.ev != nil {
		return
	}
	wb := FsWorkbook{{Name: "Sheet1", Row: daRows, Column: daCols, CellData: b.data}}
	ev := recomputeFsWorkbook(wb, parityNow)
	b.data, b.ev, b.dirty = wb[0].CellData, ev, false
}

func (b *daBook) apply(s daStep) error {
	switch {
	case s.Clear != "":
		r1, c1, r2, c2, err := daArea(s.Clear)
		if err != nil {
			return err
		}
		kept := b.data[:0]
		for _, cd := range b.data {
			if cd.R >= r1 && cd.R <= r2 && cd.C >= c1 && cd.C <= c2 {
				delete(b.entered, cellAddr{row: cd.R, col: cd.C})
				continue
			}
			kept = append(kept, cd)
		}
		b.data = kept
		b.dirty = true
	case s.Set != nil:
		keys := make([]string, 0, len(s.Set))
		for k := range s.Set {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			a, ok := parseCellRef(k)
			if !ok {
				return fmt.Errorf("bad cell %q", k)
			}
			b.put(a, daTyped(s.Set[k]))
			if strings.HasPrefix(s.Set[k], "=") {
				b.entered[a] = s.Set[k]
			} else {
				delete(b.entered, a)
			}
		}
	case s.Enter != "":
		r1, c1, r2, c2, err := daArea(s.At)
		if err != nil {
			return err
		}
		for r := r1; r <= r2; r++ {
			for c := c1; c <= c2; c++ {
				// Ctrl+Enter over a range fills every cell, moving relative refs.
				f := s.Enter
				if r != r1 || c != c1 {
					f = TranslateFormula(f, r-r1, c-c1)
				}
				a := cellAddr{row: r, col: c}
				b.put(a, &FsCell{F: f})
				b.entered[a] = f
			}
		}
	}
	return nil
}

func daArea(ref string) (r1, c1, r2, c2 int, err error) {
	parts := strings.Split(strings.ToUpper(ref), ":")
	a, ok := parseCellRef(parts[0])
	if !ok {
		return 0, 0, 0, 0, fmt.Errorf("bad ref %q", ref)
	}
	bb := a
	if len(parts) == 2 {
		if bb, ok = parseCellRef(parts[1]); !ok {
			return 0, 0, 0, 0, fmt.Errorf("bad ref %q", ref)
		}
	}
	return a.row, a.col, bb.row, bb.col, nil
}

// cell returns the computed value of a cell after the last recalculation.
func (b *daBook) cell(ref string) value {
	a, _ := parseCellRef(ref)
	st := b.ev.book().sheets[0]
	if v, ok := st.results[a]; ok {
		return v
	}
	if v, ok := st.spillCells[a]; ok {
		return v
	}
	var v value
	b.ev.onSheet(0, func() { v = b.ev.cellValue(a) })
	return v
}

// evalAt evaluates a formula as if typed at cell at, without storing it.
func (b *daBook) evalAt(f, at string) value {
	a, _ := parseCellRef(at)
	var v value
	b.ev.onSheet(0, func() {
		pr, pc := b.ev.curRow, b.ev.curCol
		b.ev.curRow, b.ev.curCol = a.row, a.col
		v = b.ev.evalExpr(strings.TrimPrefix(f, "="))
		b.ev.curRow, b.ev.curCol = pr, pc
	})
	return v
}

// daShape is the spill shape of an evaluated formula: rows, cols, array?
func daShape(v value) (int, int, bool) {
	if v.kind == kindArray && v.arr != nil {
		return v.arr.rows, v.arr.cols, true
	}
	return 1, 1, false
}

func (b *daBook) check(s daStep) string {
	b.recalc()
	switch s.Check {
	case "value":
		return daMatch(b.cell(strings.ToUpper(s.Cell)), s)
	case "stored", "storedNorm":
		f := b.entered[mustAddr(s.Cell)]
		got := FormulaToStorage(f)
		if s.Check == "storedNorm" {
			got = strings.NewReplacer("_xlfn._xlws.", "", "_xlfn.", "", "_xlws.", "").Replace(got)
		}
		if got != fmt.Sprint(s.Want) {
			return fmt.Sprintf("stored %q, want %q", got, s.Want)
		}
	case "edit":
		f := b.entered[mustAddr(s.Cell)]
		got := FormulaFromStorage(FormulaToStorage(f), formulaLifts(f))
		if got != fmt.Sprint(s.Want) {
			return fmt.Sprintf("edit text %q, want %q", got, s.Want)
		}
	case "dynRows", "dynCols":
		a := mustAddr(s.Cell)
		ar, ok := b.ev.book().sheets[0].spillAreas[a]
		rows, cols := 1, 1
		if ok {
			rows, cols = ar.rows(), ar.cols()
		}
		got := rows
		if s.Check == "dynCols" {
			got = cols
		}
		if w, _ := s.Want.(float64); int(w) != got {
			return fmt.Sprintf("%s = %d, want %v", s.Check, got, s.Want)
		}
	case "shapeArray", "shapeRows", "shapeCols":
		rows, cols, isArr := daShape(b.evalAt(s.Formula, s.At))
		var got interface{}
		switch {
		case s.Check == "shapeArray":
			got = isArr
		case !isArr:
			got = false
		case s.Check == "shapeRows":
			got = float64(rows)
		default:
			got = float64(cols)
		}
		if got != s.Want {
			return fmt.Sprintf("%s(%s) = %v, want %v", s.Check, s.Formula, got, s.Want)
		}
	case "arrElem":
		v := b.evalAt(s.Formula, s.At)
		var e value
		cells, rows, cols := cellsOf(v)
		if s.DR < rows && s.DC < cols {
			e = cells[s.DR][s.DC]
		} else {
			e = errNA
		}
		return daMatch(e, s)
	default:
		return "unknown check " + s.Check
	}
	return ""
}

func mustAddr(ref string) cellAddr {
	a, _ := parseCellRef(strings.ToUpper(ref))
	return a
}

// daMatch compares a cell value with what OnlyOffice's getValue returned.
func daMatch(got value, s daStep) string {
	if got.kind == kindArray {
		got = got.topLeft()
	}
	switch w := s.Want.(type) {
	case float64:
		n, ok := got.toNum()
		if got.kind == kindStr || got.kind == kindErr || !ok {
			return fmt.Sprintf("want %v, got %s", w, describeValue(got))
		}
		tol := s.Tol
		if tol == 0 {
			if s.Approx {
				tol = daDecimalUnit(w)
			} else {
				tol = 1e-9 * math.Max(1, math.Abs(w))
			}
		}
		if math.Abs(n-w) > tol+1e-12 {
			return fmt.Sprintf("want %v, got %v", w, n)
		}
	case string:
		if w == "" {
			if got.blank || (got.kind == kindStr && got.str == "") {
				return ""
			}
			return fmt.Sprintf("want empty, got %s", describeValue(got))
		}
		if got.kind == kindNum && !got.blank {
			if f, err := strconv.ParseFloat(w, 64); err == nil {
				if math.Abs(got.num-f) <= 1e-9*math.Max(1, math.Abs(f)) {
					return ""
				}
			}
			return fmt.Sprintf("want %q, got %s", w, describeValue(got))
		}
		if got.toStr() != w {
			return fmt.Sprintf("want %q, got %s", w, describeValue(got))
		}
	case bool:
		if got.kind != kindBool || (got.num != 0) != w {
			return fmt.Sprintf("want %v, got %s", w, describeValue(got))
		}
	default:
		return fmt.Sprintf("unsupported expectation %v", s.Want)
	}
	return ""
}

// daDecimalUnit is one unit in the last decimal place the number shows.
func daDecimalUnit(w float64) float64 {
	s := strconv.FormatFloat(w, 'f', -1, 64)
	if i := strings.IndexByte(s, '.'); i >= 0 {
		return math.Pow(10, -float64(len(s)-i-1))
	}
	return 1
}

func TestDynamicArrayParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/dynarray/dynamic-arrays.json")
	if err != nil {
		t.Fatal(err)
	}
	var f daFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	report := os.Getenv("PARITY_DA_REPORT") != ""
	for _, c := range f.Cases {
		c := c
		t.Run(c.ID, func(t *testing.T) {
			if c.Pending != "" {
				t.Skip(c.Pending)
			}
			b := &daBook{entered: map[cellAddr]string{}}
			ran := 0
			for i, s := range c.Steps {
				if s.Check == "" {
					if err := b.apply(s); err != nil {
						t.Fatalf("step %d: %v", i, err)
					}
					continue
				}
				msg := b.check(s)
				if s.Pending != "" {
					if report && msg == "" {
						t.Logf("NOW PASSING step %d: %s", i, s.Pending)
					}
					continue
				}
				ran++
				if msg != "" {
					if report {
						t.Logf("FAIL step %d %s %s%s: %s", i, s.Check, s.Cell, s.Formula, msg)
						continue
					}
					t.Errorf("step %d (%s %s%s): %s", i, s.Check, s.Cell, s.Formula, msg)
				}
			}
			if ran == 0 {
				t.Skip("every check in this case is pending")
			}
		})
	}
}
