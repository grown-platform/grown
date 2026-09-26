package sheets

// OnlyOffice parity fixture runner.
//
// Every file in testdata/parity/*.json describes behaviour observed in one
// OnlyOffice test suite (formula text in, value out) and is replayed here
// through Grown's real formula engine. The fixtures are written from scratch
// for Grown; see docs/plans/onlyoffice-parity/sheets.md §6 for the schema and
// the tag convention (`oo:<path under sdkjs tests/>#<test title>`).
//
// Schema (one JSON document per file):
//
//	{
//	  "source": "free-text provenance",
//	  "cases": [{
//	    "id":      "oo:cell/spreadsheet-calculation/formula-tests/logicalTests.js#AND",  // scoreboard tag + subtest name
//	    "at":      "A2",               // default formula cell for every check (default A1)
//	    "cells":   {"A1": 1, "B1": "=A1*2", "C1": {"error": "#N/A"}, "Sheet2!A1": true},
//	    "names":   {"MyName": "Sheet1!$A$1"},   // defined names (not evaluated yet — M1)
//	    "pending": "reason",           // skip the whole case
//	    "checks": [{
//	      "set":      {"A1": 5, "B2": null},    // cell edits applied before this check (persist)
//	      "formula":  "=SUM(A1:B1)",
//	      "at":       "C3",            // formula cell (ROW()/COLUMN() context)
//	      "sheet":    "Sheet2",        // sheet the formula lives on (default Sheet1)
//	      "array":    true,            // entered as an array formula (Grown: ARRAYFORMULA)
//	      "expect":   15,              // number | string | bool | {"error": "#N/A"}
//	      "elements": [[0, 1, 2]],     // [row, col, value] of an array result
//	      "tol":      1e-9,            // absolute tolerance, scaled by max(1,|want|)
//	      "invalid":  true,            // OnlyOffice rejects the formula; Grown must return an error
//	      "date1904": true,            // workbook uses the 1904 date system
//	      "pending":  "reason"         // skip this check (known semantic difference)
//	    }]
//	  }]
//	}
//
// Cell values follow "typed input" semantics: numbers, booleans, text, a
// string beginning with "=" is a formula, {"error": code} is an error value.
// Keys with a sheet prefix ("Sheet2!A1") and "names" are carried for the
// cross-sheet / defined-name milestone; the runner skips checks that need them.
//
// Set PARITY_REPORT=<file> to write every non-pending failure as JSON lines
// instead of failing the test (used when triaging a freshly ported suite).

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type parityFile struct {
	Source string       `json:"source"`
	Cases  []parityCase `json:"cases"`
}

type parityCase struct {
	ID      string                     `json:"id"`
	At      string                     `json:"at"`
	Cells   map[string]json.RawMessage `json:"cells"`
	Names   map[string]string          `json:"names"`
	Pending string                     `json:"pending"`
	Checks  []parityCheck              `json:"checks"`
}

type parityCheck struct {
	Set      map[string]json.RawMessage `json:"set"`
	Formula  string                     `json:"formula"`
	At       string                     `json:"at"`
	Sheet    string                     `json:"sheet"`
	Array    bool                       `json:"array"`
	Expect   json.RawMessage            `json:"expect"`
	Elements [][3]json.RawMessage       `json:"elements"`
	Tol      float64                    `json:"tol"`
	Invalid  bool                       `json:"invalid"`
	Date1904 bool                       `json:"date1904"`
	Pending  string                     `json:"pending"`
}

// parityNow pins TODAY()/NOW() for every fixture.
var parityNow = time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC)

var (
	reSheetRef = regexp.MustCompile(`(?i)(^|[^A-Za-z0-9_."])('[^']+'|[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z_][A-Za-z0-9_]*)?)![$A-Za-z0-9]`)
	reTableRef = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]*\[`)
)

func TestParity(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("testdata", "parity", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no parity fixtures found")
	}
	rep := newParityReporter(t)
	defer rep.close()
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var pf parityFile
		if err := json.Unmarshal(raw, &pf); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		for _, c := range pf.Cases {
			c := c
			t.Run(c.ID, func(t *testing.T) {
				if c.Pending != "" {
					t.Skip(c.Pending)
				}
				runParityCase(t, c, rep)
			})
		}
	}
}

func runParityCase(t *testing.T, c parityCase, rep *parityReporter) {
	state := map[string]json.RawMessage{}
	for k, v := range c.Cells {
		state[strings.ToUpper(k)] = v
	}
	ran := 0
	defer func() {
		if ran == 0 && !t.Failed() {
			t.Skip("every check in this case is pending")
		}
	}()
	for i, chk := range c.Checks {
		for k, v := range chk.Set {
			if string(v) == "null" {
				delete(state, strings.ToUpper(k))
			} else {
				state[strings.ToUpper(k)] = v
			}
		}
		name := fmt.Sprintf("%03d_%s", i+1, chk.Formula)
		snapshot := make(map[string]json.RawMessage, len(state))
		for k, v := range state {
			snapshot[k] = v
		}
		chk := chk
		t.Run(name, func(t *testing.T) {
			if reason := parityStaticPending(c, chk); reason != "" {
				t.Skip(reason)
			}
			at := chk.At
			if at == "" {
				at = c.At
			}
			if at == "" {
				at = "A1"
			}
			ran++
			got, err := parityEval(snapshot, chk.Formula, at, chk.Array)
			if err != nil {
				t.Fatalf("fixture error: %v", err)
			}
			if msg := parityCompare(got, chk); msg != "" {
				if rep.enabled() {
					rep.add(c.ID, i+1, chk, got, msg)
					return
				}
				t.Errorf("%s: %s", chk.Formula, msg)
			}
		})
	}
}

// parityStaticPending returns a skip reason for checks that need engine
// features Grown does not have yet (tracked by later milestones).
func parityStaticPending(c parityCase, chk parityCheck) string {
	if chk.Pending != "" {
		return chk.Pending
	}
	f := chk.Formula
	switch {
	case chk.Sheet != "" && !strings.EqualFold(chk.Sheet, "Sheet1"):
		return "M1: formula evaluated on another sheet"
	case chk.Date1904:
		return "1904 date system not supported"
	case reSheetRef.MatchString(stripStringLits(f)):
		return "M1: cross-sheet references"
	case reTableRef.MatchString(stripStringLits(f)):
		return "M1: structured table references"
	case hasWholeLineRef(stripStringLits(f)):
		return "M1: whole-column/row references (A:A, 1:1)"
	}
	for n := range c.Names {
		re := regexp.MustCompile(`(?i)(^|[^A-Za-z0-9_.])` + regexp.QuoteMeta(n) + `($|[^A-Za-z0-9_.(])`)
		if re.MatchString(stripStringLits(f)) {
			return "M1: defined names"
		}
	}
	return ""
}

var reWholeLine = regexp.MustCompile(`(^|[^A-Za-z0-9_.$])(\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[0-9]+:\$?[0-9]+)($|[^A-Za-z0-9_(])`)

func hasWholeLineRef(f string) bool { return reWholeLine.MatchString(f) }

func stripStringLits(f string) string {
	var sb strings.Builder
	in := false
	for i := 0; i < len(f); i++ {
		if f[i] == '"' {
			in = !in
			sb.WriteByte('"')
			continue
		}
		if in {
			sb.WriteByte(' ')
		} else {
			sb.WriteByte(f[i])
		}
	}
	return sb.String()
}

// parityEval recomputes the sheet described by state and evaluates formula as
// if it were entered at cell at.
func parityEval(state map[string]json.RawMessage, formula, at string, array bool) (value, error) {
	var data []FsCellData
	seeds := map[cellAddr]value{}
	for k, raw := range state {
		if strings.Contains(k, "!") {
			continue // other sheets: not visible to the single-sheet evaluator yet
		}
		addr, ok := parseCellRef(k)
		if !ok {
			return value{}, fmt.Errorf("bad cell key %q", k)
		}
		var v interface{}
		if err := json.Unmarshal(raw, &v); err != nil {
			return value{}, fmt.Errorf("cell %s: %v", k, err)
		}
		cell := &FsCell{}
		switch x := v.(type) {
		case map[string]interface{}:
			code, _ := x["error"].(string)
			if code == "" {
				return value{}, fmt.Errorf("cell %s: unsupported object", k)
			}
			seeds[addr] = errVal(code)
			cell.V = code
		case string:
			if strings.HasPrefix(x, "=") {
				cell.F = x
			} else {
				cell.V = x
			}
		case float64, bool:
			cell.V = x
		case nil:
			continue
		default:
			return value{}, fmt.Errorf("cell %s: unsupported value %T", k, v)
		}
		data = append(data, FsCellData{R: addr.row, C: addr.col, V: cell})
	}
	sort.Slice(data, func(i, j int) bool {
		if data[i].R != data[j].R {
			return data[i].R < data[j].R
		}
		return data[i].C < data[j].C
	})
	ev := &Evaluator{
		grid:       newGrid(data),
		results:    seeds,
		now:        parityNow,
		sheetIndex: 1,
	}
	ev.recomputeAll(data)
	a, ok := parseCellRef(strings.ToUpper(at))
	if !ok {
		return value{}, fmt.Errorf("bad at %q", at)
	}
	ev.curRow, ev.curCol = a.row, a.col
	expr := strings.TrimPrefix(formula, "=")
	if array {
		expr = "ARRAYFORMULA(" + expr + ")"
	}
	return ev.evalExpr(expr), nil
}

// parityElement reads element (r,c) of a result the way the OnlyOffice
// suites do: a scalar sits at (0,0), and a position outside the result is
// empty text.
func parityElement(v value, r, c int) value {
	if v.kind != kindArray || v.arr == nil {
		if r == 0 && c == 0 {
			return v
		}
		return strVal("")
	}
	if r >= v.arr.rows || c >= v.arr.cols {
		return strVal("")
	}
	return v.arr.cells[r][c]
}

func parityCompare(got value, chk parityCheck) string {
	if chk.Invalid {
		if got.isErr() {
			return ""
		}
		return fmt.Sprintf("OnlyOffice rejects this formula; got %s", describeValue(got))
	}
	var msgs []string
	if len(chk.Expect) > 0 {
		if m := parityMatch(got.topLeft(), chk.Expect, chk.Tol); m != "" {
			msgs = append(msgs, m)
		}
	}
	for _, e := range chk.Elements {
		var r, c int
		if json.Unmarshal(e[0], &r) != nil || json.Unmarshal(e[1], &c) != nil {
			return "bad element index"
		}
		if m := parityMatch(parityElement(got, r, c), e[2], chk.Tol); m != "" {
			msgs = append(msgs, fmt.Sprintf("[%d,%d] %s", r, c, m))
		}
	}
	return strings.Join(msgs, "; ")
}

func parityMatch(got value, wantRaw json.RawMessage, tol float64) string {
	var want interface{}
	if err := json.Unmarshal(wantRaw, &want); err != nil {
		return "bad expectation: " + err.Error()
	}
	if got.kind == kindArray {
		got = got.topLeft()
	}
	if tol == 0 {
		tol = 1e-9
	}
	switch w := want.(type) {
	case float64:
		if got.kind != kindNum {
			return fmt.Sprintf("want %v, got %s", w, describeValue(got))
		}
		if math.Abs(got.num-w) > tol*math.Max(1, math.Abs(w)) {
			return fmt.Sprintf("want %v, got %v", w, got.num)
		}
	case bool:
		if got.kind == kindBool && (got.num != 0) == w {
			return ""
		}
		return fmt.Sprintf("want %v, got %s", w, describeValue(got))
	case string:
		if got.kind != kindStr || got.str != w {
			return fmt.Sprintf("want %q, got %s", w, describeValue(got))
		}
	case map[string]interface{}:
		code, _ := w["error"].(string)
		if !got.isErr() || got.str != code {
			return fmt.Sprintf("want %s, got %s", code, describeValue(got))
		}
	default:
		return fmt.Sprintf("unsupported expectation %s", string(wantRaw))
	}
	return ""
}

func describeValue(v value) string {
	switch v.kind {
	case kindNum:
		return fmt.Sprintf("number %v", v.num)
	case kindStr:
		return fmt.Sprintf("text %q", v.str)
	case kindBool:
		return fmt.Sprintf("bool %v", v.num != 0)
	case kindErr:
		return "error " + v.str
	case kindArray:
		return fmt.Sprintf("array %dx%d", v.arr.rows, v.arr.cols)
	case kindLambda:
		return "lambda"
	}
	return "?"
}

// ---- triage reporter --------------------------------------------------------

type parityReporter struct {
	mu sync.Mutex
	f  *os.File
}

func newParityReporter(t *testing.T) *parityReporter {
	p := os.Getenv("PARITY_REPORT")
	if p == "" {
		return &parityReporter{}
	}
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	return &parityReporter{f: f}
}

func (r *parityReporter) enabled() bool { return r.f != nil }

func (r *parityReporter) add(id string, idx int, chk parityCheck, got value, msg string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, _ := json.Marshal(map[string]interface{}{
		"id": id, "check": idx, "formula": chk.Formula, "got": describeValue(got), "msg": msg,
	})
	r.f.Write(append(b, '\n'))
}

func (r *parityReporter) close() {
	if r.f != nil {
		r.f.Close()
	}
}
