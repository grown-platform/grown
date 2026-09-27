package sheets

// Sheet structure operations (M7): insert / delete / move whole rows or
// columns, insert / delete cells with a shift, and the formula-reference
// arithmetic they need. This is the server twin of
// web/app/src/pages/sheets/formulaShift.ts; both run the shared fixture
// testdata/structure/shift.json, so keep the rules in step.
//
//   - TranslateFormula: relative refs move with the formula (fill, paste).
//   - ShiftFormula: refs keep pointing at the same cells after a structure op
//     (absolute refs included, as in Excel); refs to deleted cells → #REF!.
//   - ApplyStructureOp: the whole-workbook rewrite (cells, merges, row/column
//     sizes, hidden flags, borders, grownCF / grownDV / grownFilter, named
//     ranges, FortuneSheet's per-cell maps).

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// Sheet limits (Excel's).
const (
	structMaxRows = 1048576
	structMaxCols = 16384
)

// StructureRect is a cell rectangle (0-based, inclusive), like cellRange.ts CellRect.
type StructureRect struct {
	C1 int `json:"c1"`
	R1 int `json:"r1"`
	C2 int `json:"c2"`
	R2 int `json:"r2"`
}

// StructureOp is one structure change. Kind is insert | delete | move (with
// Axis row | col, Index, Count and, for move, To = the pre-move index the block
// is inserted before) or insertCells (Shift down | right) / deleteCells (Shift
// up | left) over Rect. Sheet names the target sheet (name, or id for
// ApplyStructureOp).
type StructureOp struct {
	Kind  string         `json:"kind"`
	Axis  string         `json:"axis,omitempty"`
	Sheet string         `json:"sheet"`
	Index int            `json:"index,omitempty"`
	Count int            `json:"count,omitempty"`
	To    int            `json:"to,omitempty"`
	Rect  *StructureRect `json:"rect,omitempty"`
	Shift string         `json:"shift,omitempty"`
}

// Validate reports whether op is well formed.
func (op StructureOp) Validate() error {
	if op.Sheet == "" {
		return errors.New("op.sheet is required")
	}
	switch op.Kind {
	case "insert", "delete", "move":
		if op.Axis != "row" && op.Axis != "col" {
			return errors.New("op.axis must be row or col")
		}
		limit := structMaxRows
		if op.Axis == "col" {
			limit = structMaxCols
		}
		if op.Index < 0 || op.Count < 1 || op.Index+op.Count > limit {
			return errors.New("op.index/op.count out of range")
		}
		if op.Kind == "move" && (op.To < 0 || op.To > limit) {
			return errors.New("op.to out of range")
		}
	case "insertCells", "deleteCells":
		if op.Rect == nil {
			return errors.New("op.rect is required")
		}
		r := normRect(*op.Rect)
		if r.R1 < 0 || r.C1 < 0 || r.R2 >= structMaxRows || r.C2 >= structMaxCols {
			return errors.New("op.rect out of range")
		}
		want := map[string][]string{"insertCells": {"down", "right"}, "deleteCells": {"up", "left"}}[op.Kind]
		if op.Shift != want[0] && op.Shift != want[1] {
			return fmt.Errorf("op.shift must be %s or %s", want[0], want[1])
		}
	default:
		return fmt.Errorf("unknown op.kind %q", op.Kind)
	}
	return nil
}

func normRect(r StructureRect) StructureRect {
	return StructureRect{C1: min(r.C1, r.C2), R1: min(r.R1, r.R2), C2: max(r.C1, r.C2), R2: max(r.R1, r.R2)}
}

// ---- reference scanner --------------------------------------------------------

func structIdent(r rune) bool {
	return r == '_' || r == '.' || unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsNumber(r)
}

type sCoord struct {
	abs bool
	n   int
}

type sRef struct {
	kind           string // cell | range | cols | rows
	r1, c1, r2, c2 sCoord
}

func isASCIILetter(r rune) bool { return r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' }
func isASCIIDigit(r rune) bool  { return r >= '0' && r <= '9' }

// scanCol reads `$?[A-Za-z]{1,3}` (not followed by another letter); ok=false otherwise.
func scanCol(s []rune, at int) (sCoord, int, bool) {
	i := at
	abs := i < len(s) && s[i] == '$'
	if abs {
		i++
	}
	j := i
	for j < len(s) && isASCIILetter(s[j]) && j-i < 3 {
		j++
	}
	if j == i || (j < len(s) && isASCIILetter(s[j])) {
		return sCoord{}, at, false
	}
	n := 0
	for _, ch := range strings.ToUpper(string(s[i:j])) {
		n = n*26 + int(ch-'A'+1)
	}
	n--
	return sCoord{abs: abs, n: n}, j, n >= 0 && n < structMaxCols
}

// scanRow reads `$?[0-9]+`.
func scanRow(s []rune, at int) (sCoord, int, bool) {
	i := at
	abs := i < len(s) && s[i] == '$'
	if abs {
		i++
	}
	j := i
	for j < len(s) && isASCIIDigit(s[j]) {
		j++
	}
	if j == i {
		return sCoord{}, at, false
	}
	if j-i > 8 {
		return sCoord{}, j, false
	}
	n, _ := strconv.Atoi(string(s[i:j]))
	return sCoord{abs: abs, n: n - 1}, j, n >= 1 && n <= structMaxRows
}

func scanCell(s []rune, at int) (sCoord, sCoord, int, bool) {
	c, j, ok := scanCol(s, at)
	if !ok && j == at {
		return sCoord{}, sCoord{}, at, false
	}
	// A column part that parsed but is out of range still consumes letters.
	r, k, rok := scanRow(s, j)
	if k == j {
		return sCoord{}, sCoord{}, at, false
	}
	return c, r, k, ok && rok
}

func structRefEndOK(s []rune, end int) bool {
	if end >= len(s) {
		return true
	}
	ch := s[end]
	return !(structIdent(ch) || ch == '(' || ch == '!' || ch == '$')
}

// matchStructRef parses a reference starting exactly at `at`.
func matchStructRef(s []rune, at int) (sRef, int, bool) {
	// cell:cell
	if c1, r1, j, ok := scanCell(s, at); j > at {
		if j < len(s) && s[j] == ':' {
			if c2, r2, k, ok2 := scanCell(s, j+1); k > j+1 && ok && ok2 && structRefEndOK(s, k) {
				return sRef{kind: "range", c1: c1, r1: r1, c2: c2, r2: r2}, k, true
			}
		}
		if ok && structRefEndOK(s, j) {
			return sRef{kind: "cell", c1: c1, r1: r1, c2: c1, r2: r1}, j, true
		}
	}
	// col:col
	if c1, j, ok := scanCol(s, at); j > at && j < len(s) && s[j] == ':' {
		if c2, k, ok2 := scanCol(s, j+1); k > j+1 && ok && ok2 && structRefEndOK(s, k) {
			return sRef{kind: "cols", c1: c1, c2: c2}, k, true
		}
	}
	// row:row
	if r1, j, ok := scanRow(s, at); j > at && j < len(s) && s[j] == ':' {
		if r2, k, ok2 := scanRow(s, j+1); k > j+1 && ok && ok2 && structRefEndOK(s, k) {
			return sRef{kind: "rows", r1: r1, r2: r2}, k, true
		}
	}
	return sRef{}, at, false
}

func structColLetters(c int) string {
	s := ""
	n := c + 1
	for n > 0 {
		m := (n - 1) % 26
		s = string(rune('A'+m)) + s
		n = (n - 1) / 26
	}
	return s
}

func (c sCoord) colStr() string {
	if c.abs {
		return "$" + structColLetters(c.n)
	}
	return structColLetters(c.n)
}

func (c sCoord) rowStr() string {
	if c.abs {
		return "$" + strconv.Itoa(c.n+1)
	}
	return strconv.Itoa(c.n + 1)
}

func (r sRef) render() string {
	switch r.kind {
	case "cell":
		return r.c1.colStr() + r.r1.rowStr()
	case "range":
		return r.c1.colStr() + r.r1.rowStr() + ":" + r.c2.colStr() + r.r2.rowStr()
	case "cols":
		return r.c1.colStr() + ":" + r.c2.colStr()
	default:
		return r.r1.rowStr() + ":" + r.r2.rowStr()
	}
}

func (r sRef) same(o sRef) bool {
	return r.kind == o.kind && r.r1.n == o.r1.n && r.r2.n == o.r2.n && r.c1.n == o.c1.n && r.c2.n == o.c2.n
}

// refVisit returns the replacement for a reference: keep=true leaves the text,
// deleted=true writes #REF!, otherwise the returned ref is rendered.
type refVisit func(sheet *string, ref sRef) (next sRef, keep, deleted bool)

func rewriteStructRefs(formula string, visit refVisit) string {
	s := []rune(formula)
	n := len(s)
	var out strings.Builder
	slice := func(a, b int) string {
		if b > n {
			b = n
		}
		if a > b {
			return ""
		}
		return string(s[a:b])
	}
	i := 0
	for i < n {
		ch := s[i]
		if ch == '"' {
			j := i + 1
			for j < n {
				if s[j] == '"' {
					if j+1 < n && s[j+1] == '"' {
						j += 2
						continue
					}
					break
				}
				j++
			}
			out.WriteString(slice(i, j+1))
			i = j + 1
			continue
		}
		if ch == '[' {
			depth, j := 0, i
			for ; j < n; j++ {
				if s[j] == '[' {
					depth++
				} else if s[j] == ']' {
					depth--
					if depth == 0 {
						break
					}
				}
			}
			out.WriteString(slice(i, j+1))
			i = j + 1
			continue
		}
		if i > 0 && (structIdent(s[i-1]) || s[i-1] == '$') {
			out.WriteRune(ch)
			i++
			continue
		}
		var sheet *string
		j := i
		wordEnd := -1
		if ch == '\'' {
			k := i + 1
			var name strings.Builder
			for k < n {
				if s[k] == '\'' {
					if k+1 < n && s[k+1] == '\'' {
						name.WriteRune('\'')
						k += 2
						continue
					}
					break
				}
				name.WriteRune(s[k])
				k++
			}
			if !(k+1 < n && s[k+1] == '!') {
				out.WriteString(slice(i, k+1))
				i = k + 1
				continue
			}
			nm := name.String()
			sheet = &nm
			j = k + 2
		} else if structIdent(ch) {
			k := i
			for k < n && structIdent(s[k]) {
				k++
			}
			wordEnd = k
			if k < n && s[k] == '!' {
				nm := string(s[i:k])
				sheet = &nm
				j = k + 1
			}
		}
		if ref, end, ok := matchStructRef(s, j); ok {
			next, keep, deleted := visit(sheet, ref)
			switch {
			case deleted:
				out.WriteString("#REF!")
			case keep || next.same(ref):
				out.WriteString(slice(i, end))
			default:
				out.WriteString(slice(i, j) + next.render())
			}
			i = end
			continue
		}
		if sheet != nil {
			out.WriteString(slice(i, j))
			i = j
			continue
		}
		if wordEnd > i {
			out.WriteString(slice(i, wordEnd))
			i = wordEnd
			continue
		}
		out.WriteRune(ch)
		i++
	}
	return out.String()
}

// TranslateFormula moves relative refs by (dr, dc); $-absolute parts stay.
// Refs pushed off the sheet become #REF!.
func TranslateFormula(formula string, dr, dc int) string {
	if dr == 0 && dc == 0 {
		return formula
	}
	mv := func(c sCoord, d, limit int) (sCoord, bool) {
		n := c.n
		if !c.abs {
			n += d
		}
		return sCoord{abs: c.abs, n: n}, n >= 0 && n < limit
	}
	return rewriteStructRefs(formula, func(_ *string, ref sRef) (sRef, bool, bool) {
		next := ref
		if ref.kind != "rows" {
			c1, ok1 := mv(ref.c1, dc, structMaxCols)
			c2, ok2 := mv(ref.c2, dc, structMaxCols)
			if !ok1 || !ok2 {
				return ref, false, true
			}
			next.c1, next.c2 = c1, c2
		}
		if ref.kind != "cols" {
			r1, ok1 := mv(ref.r1, dr, structMaxRows)
			r2, ok2 := mv(ref.r2, dr, structMaxRows)
			if !ok1 || !ok2 {
				return ref, false, true
			}
			next.r1, next.r2 = r1, r2
		}
		return next, false, false
	})
}

// ---- position arithmetic ------------------------------------------------------

type axisOp struct {
	kind             string
	index, count, to int
}

func (op axisOp) mapPos(x int) (int, bool) {
	i, n, to := op.index, op.count, op.to
	if n <= 0 {
		return x, true
	}
	switch op.kind {
	case "insert":
		if x >= i {
			return x + n, true
		}
		return x, true
	case "delete":
		if x < i {
			return x, true
		}
		if x >= i+n {
			return x - n, true
		}
		return 0, false
	}
	// move
	if to >= i && to <= i+n {
		return x, true
	}
	if to > i+n {
		switch {
		case x >= i && x < i+n:
			return x + (to - i - n), true
		case x >= i+n && x < to:
			return x - n, true
		}
		return x, true
	}
	switch {
	case x >= i && x < i+n:
		return x - (i - to), true
	case x >= to && x < i:
		return x + n, true
	}
	return x, true
}

func (op axisOp) mapInterval(a, b int) (int, int, bool) {
	if op.kind == "delete" {
		end := op.index + op.count
		if op.count <= 0 {
			return a, b, true
		}
		if a >= op.index && b < end {
			return 0, 0, false
		}
		na, nb := a, b
		if a >= end {
			na = a - op.count
		} else if a >= op.index {
			na = op.index
		}
		if b >= end {
			nb = b - op.count
		} else if b >= op.index {
			nb = op.index - 1
		}
		return na, nb, true
	}
	na, _ := op.mapPos(a)
	nb, _ := op.mapPos(b)
	if na > nb {
		na, nb = nb, na
	}
	return na, nb, true
}

type sArea struct{ r1, c1, r2, c2 int }

// shiftArea moves an area on op's sheet; span is area | cols | rows.
func shiftArea(a sArea, span string, op StructureOp) (sArea, bool) {
	if op.Kind == "insertCells" || op.Kind == "deleteCells" {
		if span != "area" || op.Rect == nil {
			return a, true
		}
		r := normRect(*op.Rect)
		kind := "insert"
		vertical := op.Shift == "down"
		if op.Kind == "deleteCells" {
			kind = "delete"
			vertical = op.Shift == "up"
		}
		if vertical {
			if a.c1 < r.C1 || a.c2 > r.C2 {
				return a, true
			}
			r1, r2, ok := axisOp{kind: kind, index: r.R1, count: r.R2 - r.R1 + 1}.mapInterval(a.r1, a.r2)
			a.r1, a.r2 = r1, r2
			return a, ok
		}
		if a.r1 < r.R1 || a.r2 > r.R2 {
			return a, true
		}
		c1, c2, ok := axisOp{kind: kind, index: r.C1, count: r.C2 - r.C1 + 1}.mapInterval(a.c1, a.c2)
		a.c1, a.c2 = c1, c2
		return a, ok
	}
	ax := axisOp{kind: op.Kind, index: op.Index, count: op.Count}
	if op.Kind == "move" {
		ax.to = op.To
	}
	if op.Axis == "row" {
		if span == "cols" {
			return a, true
		}
		r1, r2, ok := ax.mapInterval(a.r1, a.r2)
		a.r1, a.r2 = r1, r2
		return a, ok
	}
	if span == "rows" {
		return a, true
	}
	c1, c2, ok := ax.mapInterval(a.c1, a.c2)
	a.c1, a.c2 = c1, c2
	return a, ok
}

// ShiftFormula rewrites the refs of a formula living on sheet host after op.
// Unqualified refs belong to host; sheet names compare case-insensitively.
func ShiftFormula(formula, host string, op StructureOp) string {
	return rewriteStructRefs(formula, func(sheet *string, ref sRef) (sRef, bool, bool) {
		name := host
		if sheet != nil {
			name = *sheet
		}
		if !strings.EqualFold(name, op.Sheet) {
			return ref, true, false
		}
		span := "area"
		if ref.kind == "cols" || ref.kind == "rows" {
			span = ref.kind
		}
		a, ok := shiftArea(sArea{ref.r1.n, ref.c1.n, ref.r2.n, ref.c2.n}, span, op)
		if !ok || a.r2 >= structMaxRows || a.c2 >= structMaxCols {
			return ref, false, true
		}
		return sRef{
			kind: ref.kind,
			r1:   sCoord{ref.r1.abs, a.r1}, r2: sCoord{ref.r2.abs, a.r2},
			c1: sCoord{ref.c1.abs, a.c1}, c2: sCoord{ref.c2.abs, a.c2},
		}, false, false
	})
}

// ShiftRect returns rect (on op's sheet) after op; ok=false when deleted.
func ShiftRect(rect StructureRect, op StructureOp) (StructureRect, bool) {
	r := normRect(rect)
	a, ok := shiftArea(sArea{r.R1, r.C1, r.R2, r.C2}, "area", op)
	if !ok {
		return StructureRect{}, false
	}
	return StructureRect{C1: a.c1, R1: a.r1, C2: min(a.c2, structMaxCols-1), R2: min(a.r2, structMaxRows-1)}, true
}

func structMapCell(r, c int, op StructureOp) (int, int, bool) {
	a, ok := shiftArea(sArea{r, c, r, c}, "area", op)
	return a.r1, a.c1, ok
}

func structAxisMapper(op StructureOp, axis string) func(int) (int, bool) {
	if op.Kind == "insertCells" || op.Kind == "deleteCells" || op.Axis != axis {
		return nil
	}
	ax := axisOp{kind: op.Kind, index: op.Index, count: op.Count}
	if op.Kind == "move" {
		ax.to = op.To
	}
	return ax.mapPos
}

// ---- workbook ------------------------------------------------------------------

func isFormulaText(v interface{}) (string, bool) {
	s, ok := v.(string)
	return s, ok && strings.HasPrefix(s, "=")
}

func jsonInt(v interface{}) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case int:
		return n
	}
	return 0
}

func copyMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func rectFromMap(m map[string]interface{}) StructureRect {
	return StructureRect{C1: jsonInt(m["c1"]), R1: jsonInt(m["r1"]), C2: jsonInt(m["c2"]), R2: jsonInt(m["r2"])}
}

func rectToMap(r StructureRect) map[string]interface{} {
	return map[string]interface{}{"c1": r.C1, "r1": r.R1, "c2": r.C2, "r2": r.R2}
}

func shiftRangeList(v interface{}, op StructureOp) []interface{} {
	list, _ := v.([]interface{})
	out := []interface{}{}
	for _, x := range list {
		m, ok := x.(map[string]interface{})
		if !ok {
			continue
		}
		if r, ok := ShiftRect(rectFromMap(m), op); ok {
			out = append(out, rectToMap(r))
		}
	}
	return out
}

func shiftCFRules(v interface{}, host string, op StructureOp, onTarget bool) interface{} {
	rules, ok := v.([]interface{})
	if !ok {
		return v
	}
	out := []interface{}{}
	for _, x := range rules {
		rule, ok := x.(map[string]interface{})
		if !ok {
			out = append(out, x)
			continue
		}
		next := copyMap(rule)
		for _, k := range []string{"formula1", "formula2", "text"} {
			if f, ok := isFormulaText(next[k]); ok {
				next[k] = ShiftFormula(f, host, op)
			}
		}
		if cfvos, ok := next["cfvos"].([]interface{}); ok {
			nv := make([]interface{}, len(cfvos))
			for i, c := range cfvos {
				nv[i] = c
				if m, ok := c.(map[string]interface{}); ok && m["type"] == "formula" {
					if s, ok := m["value"].(string); ok {
						mm := copyMap(m)
						mm["value"] = ShiftFormula(s, host, op)
						nv[i] = mm
					}
				}
			}
			next["cfvos"] = nv
		}
		if onTarget {
			if _, ok := next["ranges"].([]interface{}); ok {
				ranges := shiftRangeList(next["ranges"], op)
				if len(ranges) == 0 {
					continue
				}
				next["ranges"] = ranges
			}
			if base, ok := next["base"].(map[string]interface{}); ok {
				if r, c, ok := structMapCell(jsonInt(base["r"]), jsonInt(base["c"]), op); ok {
					next["base"] = map[string]interface{}{"r": r, "c": c}
				} else if ranges, ok := next["ranges"].([]interface{}); ok && len(ranges) > 0 {
					f := ranges[0].(map[string]interface{})
					next["base"] = map[string]interface{}{"r": f["r1"], "c": f["c1"]}
				}
			}
		}
		out = append(out, next)
	}
	return out
}

func shiftDVRules(v interface{}, host string, op StructureOp, onTarget bool) interface{} {
	rules, ok := v.([]interface{})
	if !ok {
		return v
	}
	out := []interface{}{}
	for _, x := range rules {
		rule, ok := x.(map[string]interface{})
		if !ok {
			out = append(out, x)
			continue
		}
		next := copyMap(rule)
		for _, k := range []string{"formula1", "formula2"} {
			if f, ok := isFormulaText(next[k]); ok {
				next[k] = ShiftFormula(f, host, op)
			}
		}
		if onTarget {
			if _, ok := next["ranges"].([]interface{}); ok {
				ranges := shiftRangeList(next["ranges"], op)
				if len(ranges) == 0 {
					continue
				}
				next["ranges"] = ranges
			}
		}
		out = append(out, next)
	}
	return out
}

func shiftFilterState(v interface{}, op StructureOp) interface{} {
	state, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	oldM, ok := state["range"].(map[string]interface{})
	if !ok {
		return v
	}
	old := rectFromMap(oldM)
	rng, ok := ShiftRect(old, op)
	if !ok {
		return nil
	}
	colMap := func(off int) (int, bool) {
		_, c, ok := structMapCell(old.R1, old.C1+off, op)
		if !ok {
			return 0, false
		}
		k := c - rng.C1
		return k, k >= 0 && k <= rng.C2-rng.C1
	}
	next := copyMap(state)
	nr := copyMap(oldM)
	for k, val := range rectToMap(rng) {
		nr[k] = val
	}
	next["range"] = nr
	if cols, ok := state["columns"].(map[string]interface{}); ok {
		nc := map[string]interface{}{}
		for k, val := range cols {
			off, err := strconv.Atoi(k)
			if err != nil {
				continue
			}
			if nk, ok := colMap(off); ok {
				nc[strconv.Itoa(nk)] = val
			}
		}
		next["columns"] = nc
	}
	if srt, ok := state["sort"].(map[string]interface{}); ok {
		if nk, ok := colMap(jsonInt(srt["colId"])); ok {
			ns := copyMap(srt)
			ns["colId"] = nk
			next["sort"] = ns
		} else {
			delete(next, "sort")
		}
	}
	return next
}

func namedRangeHostName(wb FsWorkbook, nr map[string]interface{}) string {
	if id, ok := nr["sheetId"]; ok && id != nil && fmt.Sprint(id) != "" {
		for _, sh := range wb {
			if sh.ID == fmt.Sprint(id) {
				return sh.Name
			}
		}
	}
	if s, ok := nr["sheetName"].(string); ok && s != "" {
		return s
	}
	if len(wb) > 0 {
		return wb[0].Name
	}
	return ""
}

func shiftNamedRangeList(v interface{}, wb FsWorkbook, op StructureOp) interface{} {
	list, ok := v.([]interface{})
	if !ok {
		return v
	}
	out := make([]interface{}, len(list))
	for i, x := range list {
		out[i] = x
		nr, ok := x.(map[string]interface{})
		if !ok {
			continue
		}
		rng, ok := nr["range"].(string)
		if !ok {
			continue
		}
		if next := ShiftFormula(rng, namedRangeHostName(wb, nr), op); next != rng {
			m := copyMap(nr)
			m["range"] = next
			out[i] = m
		}
	}
	return out
}

// shiftRectList shifts a JSON list of rects, dropping deleted ones.
func shiftRectList(v interface{}, op StructureOp) []interface{} {
	list, _ := v.([]interface{})
	out := []interface{}{}
	for _, x := range list {
		m, ok := x.(map[string]interface{})
		if !ok {
			continue
		}
		if r, ok := ShiftRect(rectFromMap(m), op); ok {
			out = append(out, rectToMap(r))
		}
	}
	return out
}

// shiftProtectionModel moves protected ranges and a protected sheet's
// editable ranges with the cells (protection.ts shiftProtection).
func shiftProtectionModel(v interface{}, op StructureOp) interface{} {
	p, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	next := copyMap(p)
	if sp, ok := p["sheet"].(map[string]interface{}); ok {
		ns := copyMap(sp)
		ns["except"] = shiftRectList(sp["except"], op)
		next["sheet"] = ns
	}
	if ranges, ok := p["ranges"].([]interface{}); ok {
		kept := []interface{}{}
		for _, x := range ranges {
			pr, ok := x.(map[string]interface{})
			if !ok {
				continue
			}
			rects := shiftRectList(pr["ranges"], op)
			if len(rects) == 0 {
				continue
			}
			np := copyMap(pr)
			np["ranges"] = rects
			kept = append(kept, np)
		}
		next["ranges"] = kept
	}
	return next
}

func extraValue(sh *FsSheet, key string) (interface{}, bool) {
	raw, ok := sh.Extra[key]
	if !ok {
		return nil, false
	}
	var v interface{}
	if json.Unmarshal(raw, &v) != nil {
		return nil, false
	}
	return v, true
}

func setExtra(sh *FsSheet, key string, v interface{}) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	if sh.Extra == nil {
		sh.Extra = map[string]json.RawMessage{}
	}
	sh.Extra[key] = raw
}

var rcKeyRe = regexp.MustCompile(`^(\d+)_(\d+)$`)

func remapRCMap(v interface{}, op StructureOp) interface{} {
	m, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	out := map[string]interface{}{}
	for k, val := range m {
		mm := rcKeyRe.FindStringSubmatch(k)
		if mm == nil {
			out[k] = val
			continue
		}
		r, _ := strconv.Atoi(mm[1])
		c, _ := strconv.Atoi(mm[2])
		if nr, nc, ok := structMapCell(r, c, op); ok {
			out[fmt.Sprintf("%d_%d", nr, nc)] = val
		}
	}
	return out
}

var digitsRe = regexp.MustCompile(`^\d+$`)

func remapAxisMap(v interface{}, fn func(int) (int, bool)) interface{} {
	m, ok := v.(map[string]interface{})
	if fn == nil || !ok {
		return v
	}
	out := map[string]interface{}{}
	for k, val := range m {
		if !digitsRe.MatchString(k) {
			out[k] = val
			continue
		}
		x, _ := strconv.Atoi(k)
		if n, ok := fn(x); ok {
			out[strconv.Itoa(n)] = val
		}
	}
	return out
}

// shiftFsRange shifts a FortuneSheet {row:[r1,r2], column:[c1,c2]}; ok=false when deleted.
func shiftFsRange(v interface{}, op StructureOp) (interface{}, bool) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return v, true
	}
	row, ok1 := m["row"].([]interface{})
	col, ok2 := m["column"].([]interface{})
	if !ok1 || !ok2 || len(row) < 2 || len(col) < 2 {
		return v, true
	}
	r, ok := ShiftRect(StructureRect{R1: jsonInt(row[0]), R2: jsonInt(row[1]), C1: jsonInt(col[0]), C2: jsonInt(col[1])}, op)
	if !ok {
		return nil, false
	}
	out := copyMap(m)
	out["row"] = []interface{}{r.R1, r.R2}
	out["column"] = []interface{}{r.C1, r.C2}
	return out, true
}

func shiftFsRangeList(v interface{}, op StructureOp) []interface{} {
	list, _ := v.([]interface{})
	out := []interface{}{}
	for _, x := range list {
		if nx, ok := shiftFsRange(x, op); ok {
			out = append(out, nx)
		}
	}
	return out
}

func shiftBorderInfo(v interface{}, op StructureOp) interface{} {
	list, ok := v.([]interface{})
	if !ok {
		return v
	}
	out := []interface{}{}
	for _, x := range list {
		b, ok := x.(map[string]interface{})
		if !ok {
			out = append(out, x)
			continue
		}
		if val, ok := b["value"].(map[string]interface{}); ok && b["rangeType"] == "cell" {
			if r, c, ok := structMapCell(jsonInt(val["row_index"]), jsonInt(val["col_index"]), op); ok {
				nv := copyMap(val)
				nv["row_index"], nv["col_index"] = r, c
				nb := copyMap(b)
				nb["value"] = nv
				out = append(out, nb)
			}
			continue
		}
		if _, ok := b["range"].([]interface{}); ok {
			rng := shiftFsRangeList(b["range"], op)
			if len(rng) > 0 {
				nb := copyMap(b)
				nb["range"] = rng
				out = append(out, nb)
			}
			continue
		}
		out = append(out, x)
	}
	return out
}

type mergeRect struct{ r, c, rs, cs int }

func shiftMergeMap(v interface{}, op StructureOp) (interface{}, []mergeRect) {
	m, ok := v.(map[string]interface{})
	if !ok {
		return v, nil
	}
	out := map[string]interface{}{}
	var rects []mergeRect
	for _, x := range m {
		mm, ok := x.(map[string]interface{})
		if !ok {
			continue
		}
		if _, ok := mm["r"].(float64); !ok {
			continue
		}
		r0, c0 := jsonInt(mm["r"]), jsonInt(mm["c"])
		rs, cs := 1, 1
		if v, ok := mm["rs"]; ok {
			rs = jsonInt(v)
		}
		if v, ok := mm["cs"]; ok {
			cs = jsonInt(v)
		}
		r, ok := ShiftRect(StructureRect{R1: r0, C1: c0, R2: r0 + rs - 1, C2: c0 + cs - 1}, op)
		if !ok {
			continue
		}
		nrs, ncs := r.R2-r.R1+1, r.C2-r.C1+1
		if nrs == 1 && ncs == 1 {
			continue
		}
		nm := copyMap(mm)
		nm["r"], nm["c"], nm["rs"], nm["cs"] = r.R1, r.C1, nrs, ncs
		out[fmt.Sprintf("%d_%d", r.R1, r.C1)] = nm
		rects = append(rects, mergeRect{r.R1, r.C1, nrs, ncs})
	}
	return out, rects
}

func shiftSheetConfig(v interface{}, op StructureOp) (interface{}, []mergeRect) {
	cfg, ok := v.(map[string]interface{})
	if !ok {
		return v, nil
	}
	rowFn := structAxisMapper(op, "row")
	colFn := structAxisMapper(op, "col")
	next := copyMap(cfg)
	var merges []mergeRect
	if mv, ok := next["merge"]; ok {
		next["merge"], merges = shiftMergeMap(mv, op)
	}
	for _, k := range []string{"rowlen", "rowhidden", "customHeight"} {
		if val, ok := next[k]; ok {
			next[k] = remapAxisMap(val, rowFn)
		}
	}
	for _, k := range []string{"columnlen", "colhidden", "customWidth"} {
		if val, ok := next[k]; ok {
			next[k] = remapAxisMap(val, colFn)
		}
	}
	if val, ok := next["borderInfo"]; ok {
		next["borderInfo"] = shiftBorderInfo(val, op)
	}
	return next, merges
}

func cellIsEmpty(c *FsCell) bool {
	return c.F == "" && c.V == nil && c.M == "" && c.CT == nil && len(c.Extra) == 0
}

// denseToCellData moves a live `data` matrix (if any) into CellData.
func denseToCellData(sh *FsSheet) {
	raw, ok := sh.Extra["data"]
	if !ok {
		return
	}
	var rows [][]*FsCell
	if json.Unmarshal(raw, &rows) == nil && len(sh.CellData) == 0 {
		for r, row := range rows {
			for c, cell := range row {
				if cell != nil {
					sh.CellData = append(sh.CellData, FsCellData{R: r, C: c, V: cell})
				}
			}
		}
	}
	delete(sh.Extra, "data")
}

func moveSheetCells(sh *FsSheet, op StructureOp, merges []mergeRect) {
	host := sh.Name
	type key struct{ r, c int }
	cells := map[key]*FsCell{}
	for _, cd := range sh.CellData {
		if cd.V == nil {
			continue
		}
		r, c, ok := structMapCell(cd.R, cd.C, op)
		if !ok || r >= structMaxRows || c >= structMaxCols {
			continue
		}
		cell := *cd.V
		if strings.HasPrefix(cell.F, "=") {
			cell.F = ShiftFormula(cell.F, host, op)
		}
		if _, ok := cell.Extra["mc"]; ok {
			extra := make(map[string]json.RawMessage, len(cell.Extra))
			for k, v := range cell.Extra {
				if k != "mc" {
					extra[k] = v
				}
			}
			cell.Extra = extra
			if len(extra) == 0 {
				cell.Extra = nil
			}
			if cellIsEmpty(&cell) {
				continue
			}
		}
		cells[key{r, c}] = &cell
	}
	for _, m := range merges {
		for r := m.r; r < m.r+m.rs; r++ {
			for c := m.c; c < m.c+m.cs; c++ {
				var mc interface{} = map[string]int{"r": m.r, "c": m.c}
				if r == m.r && c == m.c {
					mc = map[string]int{"r": m.r, "c": m.c, "rs": m.rs, "cs": m.cs}
				}
				raw, _ := json.Marshal(mc)
				cell := cells[key{r, c}]
				if cell == nil {
					cell = &FsCell{}
				} else {
					cp := *cell
					cell = &cp
				}
				extra := make(map[string]json.RawMessage, len(cell.Extra)+1)
				for k, v := range cell.Extra {
					extra[k] = v
				}
				extra["mc"] = raw
				cell.Extra = extra
				cells[key{r, c}] = cell
			}
		}
	}
	out := make([]FsCellData, 0, len(cells))
	for k, v := range cells {
		out = append(out, FsCellData{R: k.r, C: k.c, V: v})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].R != out[j].R {
			return out[i].R < out[j].R
		}
		return out[i].C < out[j].C
	})
	sh.CellData = out
}

func findStructTarget(wb FsWorkbook, sheet string) int {
	for i := range wb {
		if wb[i].ID != "" && wb[i].ID == sheet {
			return i
		}
	}
	for i := range wb {
		if strings.EqualFold(wb[i].Name, sheet) {
			return i
		}
	}
	return -1
}

// ErrSheetNotFound is returned when op.sheet names no sheet of the workbook.
var ErrSheetNotFound = errors.New("structure op: sheet not found")

// ApplyStructureOp applies op to wb in place (cells moved on the target sheet,
// formulas rewritten on every sheet, merges, sizes, hidden flags, borders,
// grownCF / grownDV / grownFilter, _namedRanges and FortuneSheet's per-cell
// maps). op.sheet may be the target's id or name.
func ApplyStructureOp(wb FsWorkbook, op StructureOp) error {
	target := findStructTarget(wb, op.Sheet)
	if target < 0 {
		return ErrSheetNotFound
	}
	op.Sheet = wb[target].Name
	// Named ranges resolve their host against the pre-op workbook (names do
	// not change, so reading them after the loop is equivalent).
	for i := range wb {
		sh := &wb[i]
		host := sh.Name
		onTarget := i == target
		if v, ok := extraValue(sh, "grownCF"); ok {
			setExtra(sh, "grownCF", shiftCFRules(v, host, op, onTarget))
		}
		if v, ok := extraValue(sh, "grownDV"); ok {
			setExtra(sh, "grownDV", shiftDVRules(v, host, op, onTarget))
		}
		if i == 0 {
			if v, ok := extraValue(sh, "_namedRanges"); ok {
				setExtra(sh, "_namedRanges", shiftNamedRangeList(v, wb, op))
			}
		}
		if !onTarget {
			if _, ok := sh.Extra["data"]; ok {
				denseToCellData(sh)
			}
			for j := range sh.CellData {
				cd := &sh.CellData[j]
				if cd.V != nil && strings.HasPrefix(cd.V.F, "=") {
					if f := ShiftFormula(cd.V.F, host, op); f != cd.V.F {
						cell := *cd.V
						cell.F = f
						cd.V = &cell
					}
				}
			}
			continue
		}
		if v, ok := extraValue(sh, "grownFilter"); ok {
			setExtra(sh, "grownFilter", shiftFilterState(v, op))
		}
		if v, ok := extraValue(sh, "grownProtection"); ok {
			setExtra(sh, "grownProtection", shiftProtectionModel(v, op))
		}
		var merges []mergeRect
		if v, ok := extraValue(sh, "config"); ok {
			var cfg interface{}
			cfg, merges = shiftSheetConfig(v, op)
			setExtra(sh, "config", cfg)
		}
		denseToCellData(sh)
		moveSheetCells(sh, op, merges)
		if op.Kind == "insert" || op.Kind == "delete" {
			d := op.Count
			if op.Kind == "delete" {
				d = -d
			}
			if op.Axis == "row" && sh.Row > 0 {
				sh.Row = max(1, sh.Row+d)
			}
			if op.Axis == "col" && sh.Column > 0 {
				sh.Column = max(1, sh.Column+d)
			}
		}
		for _, k := range []string{"dataVerification", "hyperlink"} {
			if v, ok := extraValue(sh, k); ok {
				setExtra(sh, k, remapRCMap(v, op))
			}
		}
		if v, ok := extraValue(sh, "luckysheet_conditionformat_save"); ok {
			if list, ok := v.([]interface{}); ok {
				out := []interface{}{}
				for _, x := range list {
					cf, ok := x.(map[string]interface{})
					if !ok {
						out = append(out, x)
						continue
					}
					if _, ok := cf["cellrange"].([]interface{}); !ok {
						out = append(out, x)
						continue
					}
					rng := shiftFsRangeList(cf["cellrange"], op)
					if len(rng) > 0 {
						n := copyMap(cf)
						n["cellrange"] = rng
						out = append(out, n)
					}
				}
				setExtra(sh, "luckysheet_conditionformat_save", out)
			}
		}
		if v, ok := extraValue(sh, "filter_select"); ok && v != nil {
			nv, _ := shiftFsRange(v, op)
			setExtra(sh, "filter_select", nv)
		}
		if v, ok := extraValue(sh, "calcChain"); ok {
			if list, ok := v.([]interface{}); ok {
				out := []interface{}{}
				for _, x := range list {
					e, ok := x.(map[string]interface{})
					if !ok {
						out = append(out, x)
						continue
					}
					if _, isNum := e["r"].(float64); !isNum {
						out = append(out, x)
						continue
					}
					if id, has := e["id"]; has && id != nil && fmt.Sprint(id) != sh.ID {
						out = append(out, x)
						continue
					}
					if r, c, ok := structMapCell(jsonInt(e["r"]), jsonInt(e["c"]), op); ok {
						n := copyMap(e)
						n["r"], n["c"] = r, c
						out = append(out, n)
					}
				}
				setExtra(sh, "calcChain", out)
			}
		}
	}
	return nil
}

// ApplyStructureOpJSON applies op to a stored workbook JSON document.
func ApplyStructureOpJSON(data string, op StructureOp) (string, error) {
	if err := op.Validate(); err != nil {
		return "", err
	}
	var wb FsWorkbook
	if err := json.Unmarshal([]byte(data), &wb); err != nil {
		return "", ErrNotWorkbook
	}
	if err := ApplyStructureOp(wb, op); err != nil {
		return "", err
	}
	out, err := json.Marshal(wb)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
