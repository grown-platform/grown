package sheets

// Excel tables under structure ops (the twin of formulaShift.ts
// shiftTableList and structuredRefs.ts dropTableColumnsInFormula; shared
// fixture testdata/structure/shift.json).
//
// A table's range moves with its cells. A column inserted inside it becomes
// a new column named ColumnN (written into the header row), a deleted column
// goes and structured references to it become #REF!, a moved column keeps its
// name at its new place. A table whose header row, or every data row, is
// deleted goes, and every reference to it becomes #REF!.

import (
	"fmt"
	"strings"
)

// tableHeaderWrite is a header cell for an inserted table column.
type tableHeaderWrite struct {
	r, c int
	name string
}

// tableShiftResult is what an op does to one sheet's tables.
type tableShiftResult struct {
	tables  []interface{}
	removed map[string][]string // table → removed columns; nil slice = the whole table
	headers []tableHeaderWrite
}

func mapInt(m map[string]interface{}, k string) int { return jsonInt(m[k]) }

// shiftTableModels applies op to a sheet's grownTables list (generic JSON).
func shiftTableModels(v interface{}, host string, op StructureOp) tableShiftResult {
	res := tableShiftResult{removed: map[string][]string{}}
	list, _ := v.([]interface{})
	for _, x := range list {
		t, ok := x.(map[string]interface{})
		if !ok {
			res.tables = append(res.tables, x)
			continue
		}
		refm, ok := t["ref"].(map[string]interface{})
		if !ok {
			continue
		}
		name := fmt.Sprint(t["displayName"])
		if t["displayName"] == nil || name == "" {
			name = fmt.Sprint(t["name"])
		}
		old := normRect(rectFromMap(refm))
		ref, ok := ShiftRect(old, op)
		cols := old.C2 - old.C1 + 1
		header := mapInt(t, "headerRowCount") > 0
		totals := mapInt(t, "totalsRowCount") > 0
		gone := func(row int) bool {
			for i := 0; i < cols; i++ {
				if _, _, ok := structMapCell(row, old.C1+i, op); ok {
					return false
				}
			}
			return true
		}
		if !ok || header && gone(old.R1) {
			res.removed[name] = nil
			continue
		}
		nt := copyMap(t)
		nt["ref"] = rectToMap(ref)
		columns, hasCols := t["columns"].([]interface{})
		if !hasCols {
			res.tables = append(res.tables, nt)
			continue
		}
		if totals && gone(old.R2) {
			nt["totalsRowCount"] = 0
			totals = false
		}
		minRows := 1
		if header {
			minRows++
		}
		if totals {
			minRows++
		}
		if ref.R2-ref.R1+1 < minRows {
			res.removed[name] = nil
			continue
		}
		at := map[int]int{}
		for i := 0; i < cols; i++ {
			if r, c, ok := structMapCell(old.R1, old.C1+i, op); ok && r == ref.R1 {
				at[c] = i
			}
		}
		maxID := 0
		var names []string
		for _, cx := range columns {
			if cm, ok := cx.(map[string]interface{}); ok {
				maxID = max(maxID, mapInt(cm, "id"))
				names = append(names, fmt.Sprint(cm["name"]))
			}
		}
		used := map[int]bool{}
		var out []interface{}
		for c := ref.C1; c <= ref.C2; c++ {
			if i, ok := at[c]; ok && i < len(columns) && !used[i] {
				used[i] = true
				cm, _ := columns[i].(map[string]interface{})
				n := copyMap(cm)
				if f, ok := n["calculatedColumnFormula"].(string); ok {
					n["calculatedColumnFormula"] = ShiftFormula(f, host, op)
				}
				if f, ok := n["totalsRowFormula"].(string); ok {
					n["totalsRowFormula"] = ShiftFormula(f, host, op)
				}
				out = append(out, n)
				continue
			}
			colName := newTableColumnName(names, c-ref.C1+1)
			names = append(names, colName)
			maxID++
			out = append(out, map[string]interface{}{"id": maxID, "name": colName})
			if header {
				res.headers = append(res.headers, tableHeaderWrite{r: ref.R1, c: c, name: colName})
			}
		}
		for i, cx := range columns {
			if !used[i] {
				if cm, ok := cx.(map[string]interface{}); ok {
					res.removed[name] = append(res.removed[name], fmt.Sprint(cm["name"]))
				}
			}
		}
		if out == nil {
			out = []interface{}{}
		}
		nt["columns"] = out
		res.tables = append(res.tables, nt)
	}
	if res.tables == nil {
		res.tables = []interface{}{}
	}
	return res
}

// newTableColumnName is ColumnN with the smallest free N from `from`.
func newTableColumnName(existing []string, from int) string {
	for n := from; ; n++ {
		name := fmt.Sprintf("Column%d", n)
		free := true
		for _, e := range existing {
			if strings.EqualFold(e, name) {
				free = false
				break
			}
		}
		if free {
			return name
		}
	}
}

// tableAreasOf lists a sheet's tables (name, range) from generic JSON.
func tableAreasOf(v interface{}) []struct {
	name string
	r    StructureRect
} {
	var out []struct {
		name string
		r    StructureRect
	}
	list, _ := v.([]interface{})
	for _, x := range list {
		t, ok := x.(map[string]interface{})
		if !ok {
			continue
		}
		refm, ok := t["ref"].(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := t["displayName"].(string)
		if name == "" {
			name, _ = t["name"].(string)
		}
		out = append(out, struct {
			name string
			r    StructureRect
		}{name, normRect(rectFromMap(refm))})
	}
	return out
}

func hostTableAt(tables []struct {
	name string
	r    StructureRect
}, r, c int) string {
	for _, t := range tables {
		if r >= t.r.R1 && r <= t.r.R2 && c >= t.r.C1 && c <= t.r.C2 {
			return t.name
		}
	}
	return ""
}

// structuredSpan is one structured reference in formula text.
type structuredSpan struct {
	start, end int // rune offsets of name + brackets
	table      string
	inner      string
}

func tableNameRune(r rune) bool {
	return r == '_' || r == '.' || r == '\\' || structIdent(r)
}

// structuredSpans finds the structured references of a formula (outside
// string literals and quoted sheet names).
func structuredSpans(s []rune) []structuredSpan {
	var out []structuredSpan
	n := len(s)
	for i := 0; i < n; i++ {
		ch := s[i]
		if ch == '"' || ch == '\'' {
			j := i + 1
			for j < n {
				if s[j] == ch {
					if j+1 < n && s[j+1] == ch {
						j += 2
						continue
					}
					break
				}
				j++
			}
			i = j
			continue
		}
		if ch != '[' {
			continue
		}
		k := i
		for k > 0 && tableNameRune(s[k-1]) {
			k--
		}
		depth, end := 0, n
		for j := i; j < n; j++ {
			if s[j] == '\'' {
				j++
				continue
			}
			if s[j] == '[' {
				depth++
			} else if s[j] == ']' {
				depth--
				if depth == 0 {
					end = j + 1
					break
				}
			}
		}
		inner := s[i+1 : end]
		if end > i+1 && s[end-1] == ']' {
			inner = s[i+1 : end-1]
		}
		out = append(out, structuredSpan{start: k, end: end, table: string(s[k:i]), inner: string(inner)})
		i = end - 1
	}
	return out
}

// DropTableRefs rewrites references to removed table columns (or removed
// tables: a nil column list) as #REF!. host is the table the formula's cell
// is in (for [@Col] without a table name).
func DropTableRefs(formula string, removed map[string][]string, host string) string {
	if len(removed) == 0 {
		return formula
	}
	lookup := func(name string) ([]string, bool) {
		for k, v := range removed {
			if strings.EqualFold(k, name) {
				return v, true
			}
		}
		return nil, false
	}
	s := []rune(formula)
	var b strings.Builder
	at := 0
	for _, sp := range structuredSpans(s) {
		owner := sp.table
		if owner == "" {
			owner = host
		}
		cols, ok := lookup(owner)
		if owner == "" || !ok {
			continue
		}
		drop := cols == nil
		if !drop {
			spec, ok := parseStructSpec(sp.inner)
			if !ok {
				continue
			}
			for _, c := range cols {
				if spec.col1 != "" && strings.EqualFold(spec.col1, c) || spec.col2 != "" && strings.EqualFold(spec.col2, c) {
					drop = true
				}
			}
		}
		if drop {
			b.WriteString(string(s[at:sp.start]))
			b.WriteString("#REF!")
			at = sp.end
		}
	}
	b.WriteString(string(s[at:]))
	out := b.String()
	// A removed table used by its bare name (=ROWS(Table1)).
	for name, cols := range removed {
		if cols == nil {
			out = replaceBareName(out, name, "#REF!")
		}
	}
	return out
}

// replaceBareName replaces identifiers equal to name (not a function, sheet
// or table-bracket prefix) outside strings and brackets.
func replaceBareName(formula, name, with string) string {
	s := []rune(formula)
	spans := structuredSpans(s)
	inSpan := func(p int) bool {
		for _, sp := range spans {
			if p >= sp.start && p < sp.end {
				return true
			}
		}
		return false
	}
	var b strings.Builder
	n := len(s)
	for i := 0; i < n; {
		ch := s[i]
		if ch == '"' || ch == '\'' {
			j := i + 1
			for j < n {
				if s[j] == ch {
					if j+1 < n && s[j+1] == ch {
						j += 2
						continue
					}
					break
				}
				j++
			}
			end := min(j+1, n)
			b.WriteString(string(s[i:end]))
			i = end
			continue
		}
		if tableNameRune(ch) && (i == 0 || !tableNameRune(s[i-1]) && s[i-1] != '$') {
			j := i
			for j < n && tableNameRune(s[j]) {
				j++
			}
			word := string(s[i:j])
			next := rune(0)
			if j < n {
				next = s[j]
			}
			if strings.EqualFold(word, name) && next != '(' && next != '[' && next != '!' && !inSpan(i) {
				b.WriteString(with)
			} else {
				b.WriteString(word)
			}
			i = j
			continue
		}
		b.WriteRune(ch)
		i++
	}
	return b.String()
}

// applyTableShift updates the target sheet's tables for op and returns what
// was removed (for every sheet's formulas) and the post-op table areas.
func applyTableShift(sh *FsSheet, op StructureOp) tableShiftResult {
	v, ok := extraValue(sh, "grownTables")
	if !ok {
		return tableShiftResult{}
	}
	res := shiftTableModels(v, sh.Name, op)
	setExtra(sh, "grownTables", res.tables)
	return res
}

// writeTableHeaders puts inserted columns' names into the header row.
func writeTableHeaders(sh *FsSheet, heads []tableHeaderWrite) {
	for _, h := range heads {
		ct := &FsCellType{FA: "@", T: "s"}
		cell := &FsCell{V: h.name, M: h.name, CT: ct}
		replaced := false
		for i := range sh.CellData {
			if sh.CellData[i].R == h.r && sh.CellData[i].C == h.c {
				if old := sh.CellData[i].V; old != nil {
					cp := *old
					cp.F, cp.V, cp.M, cp.CT = "", h.name, h.name, ct
					cell = &cp
				}
				sh.CellData[i].V = cell
				replaced = true
			}
		}
		if !replaced {
			sh.CellData = append(sh.CellData, FsCellData{R: h.r, C: h.c, V: cell})
		}
	}
	sortCellData(sh.CellData)
}

func sortCellData(cd []FsCellData) {
	for i := 1; i < len(cd); i++ {
		for j := i; j > 0 && (cd[j].R < cd[j-1].R || cd[j].R == cd[j-1].R && cd[j].C < cd[j-1].C); j-- {
			cd[j], cd[j-1] = cd[j-1], cd[j]
		}
	}
}

// dropTableRefsOnSheet rewrites a sheet's formulas for removed tables/columns.
func dropTableRefsOnSheet(sh *FsSheet, removed map[string][]string) {
	if len(removed) == 0 {
		return
	}
	var areas []struct {
		name string
		r    StructureRect
	}
	if v, ok := extraValue(sh, "grownTables"); ok {
		areas = tableAreasOf(v)
	}
	for j := range sh.CellData {
		cd := &sh.CellData[j]
		if cd.V == nil || !strings.HasPrefix(cd.V.F, "=") {
			continue
		}
		if f := DropTableRefs(cd.V.F, removed, hostTableAt(areas, cd.R, cd.C)); f != cd.V.F {
			cell := *cd.V
			cell.F = f
			cd.V = &cell
		}
	}
}
