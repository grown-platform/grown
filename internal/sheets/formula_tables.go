package sheets

// Excel tables (ListObjects) and structured references.
//
// A table lives on its sheet as an entry of `grownTables` (the model the
// editor and the xlsx reader/writer share, web/app/src/pages/sheets/tables.ts):
// a name, the whole range (header row, data rows, optional totals row) and
// its column names. Formulas address a table by name:
//
//	Table1                     the data rows (same as Table1[#Data])
//	Table1[Col]                one column's data cells
//	Table1[[Col1]:[Col3]]      adjacent columns
//	Table1[#All] [#Data] [#Headers] [#Totals] [#This Row]
//	Table1[[#Headers],[Col]]   a row specifier with columns
//	Table1[[#Headers],[#Data],[Col]]  headers + data (or [#Data],[#Totals])
//	Table1[@] Table1[@Col] Table1[@[Col1]:[Col2]]   the formula's own row
//	[Col] [@Col] [[Col1]:[Col2]] …                  inside the table itself
//
// Inside a column name `'` escapes the next character ([, ], #, ', @).
// Names are case-insensitive. A reference resolves to an ordinary area on the
// table's sheet, so every reference-aware function (ROWS, INDEX, SUM, …) and
// the dependency graph see it like A1 text.

import (
	"encoding/json"
	"strconv"
	"strings"
)

// tableDef is one table of the workbook view.
type tableDef struct {
	sheet  int
	name   string
	ref    area // header row, data rows and totals row
	header int  // header rows (0 or 1)
	totals int  // totals rows (0 or 1)
	cols   []string
}

// dataArea is the table without its header and totals rows.
func (t *tableDef) dataArea() area {
	a := t.ref
	a.r1 += t.header
	a.r2 -= t.totals
	return a
}

// colIndex finds a column by name (case-insensitive); -1 when missing.
func (t *tableDef) colIndex(name string) int {
	for i, c := range t.cols {
		if strings.EqualFold(c, name) {
			return i
		}
	}
	return -1
}

// tableStore is the `grownTables` entry shape the engine reads.
type tableStore struct {
	Name           string                        `json:"name"`
	DisplayName    string                        `json:"displayName"`
	Ref            *struct{ R1, C1, R2, C2 int } `json:"ref"`
	HeaderRowCount *int                          `json:"headerRowCount"`
	TotalsRowCount int                           `json:"totalsRowCount"`
	Columns        []struct {
		Name string `json:"name"`
	} `json:"columns"`
}

// loadTables reads every sheet's `grownTables`.
func loadTables(wb FsWorkbook, view *workbookView) {
	for si := range wb {
		if wb[si].Extra == nil {
			continue
		}
		raw, ok := wb[si].Extra["grownTables"]
		if !ok {
			continue
		}
		var list []tableStore
		if json.Unmarshal(raw, &list) != nil {
			continue
		}
		for _, ts := range list {
			if t := ts.def(si); t != nil {
				view.tables = append(view.tables, t)
			}
		}
	}
}

func (ts tableStore) def(si int) *tableDef {
	name := ts.DisplayName
	if name == "" {
		name = ts.Name
	}
	if name == "" || ts.Ref == nil {
		return nil
	}
	t := &tableDef{sheet: si, name: name, ref: normArea(area{r1: ts.Ref.R1, c1: ts.Ref.C1, r2: ts.Ref.R2, c2: ts.Ref.C2}), header: 1, totals: ts.TotalsRowCount}
	if ts.HeaderRowCount != nil {
		t.header = *ts.HeaderRowCount
	}
	t.header = min(max(t.header, 0), 1)
	t.totals = min(max(t.totals, 0), 1)
	if !t.ref.inGrid() || t.ref.rows() <= t.header+t.totals {
		return nil
	}
	for i := 0; i < t.ref.cols(); i++ {
		name := ""
		if i < len(ts.Columns) {
			name = ts.Columns[i].Name
		}
		if name == "" {
			name = "Column" + strconv.Itoa(i+1)
		}
		t.cols = append(t.cols, name)
	}
	return t
}

// tableByName finds a table by name (case-insensitive).
func (wb *workbookView) tableByName(name string) *tableDef {
	for _, t := range wb.tables {
		if strings.EqualFold(t.name, name) {
			return t
		}
	}
	return nil
}

// tableAt finds the table on sheet si that contains the cell a.
func (wb *workbookView) tableAt(si int, a cellAddr) *tableDef {
	for _, t := range wb.tables {
		if t.sheet == si && t.ref.contains(a.row, a.col) {
			return t
		}
	}
	return nil
}

// ---- structured-reference syntax ---------------------------------------------

// structSpec is a parsed structured reference (the text inside the brackets).
type structSpec struct {
	all, data, headers, totals, thisRow bool
	col1, col2                          string // "" = every column
}

// scanBracket returns the index just past the ']' that closes the '[' at
// s[i] (a quote escapes the next character), or len(s) when it never closes.
func scanBracket(s string, i int) int {
	depth := 0
	for j := i; j < len(s); j++ {
		switch s[j] {
		case '\'':
			j++
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return j + 1
			}
		}
	}
	return len(s)
}

// unescapeColumn removes the quote escapes of a column name.
func unescapeColumn(s string) string {
	if !strings.Contains(s, "'") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' && i+1 < len(s) {
			i++
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// parseStructSpec parses the bracket content of a structured reference
// (inner excludes the outer brackets). ok=false for text Excel would refuse.
func parseStructSpec(inner string) (structSpec, bool) {
	var sp structSpec
	s := strings.TrimSpace(inner)
	if s == "" {
		sp.data = true
		return sp, true
	}
	switch s[0] {
	case '@':
		sp.thisRow = true
		rest := strings.TrimSpace(s[1:])
		if rest == "" {
			return sp, true
		}
		if rest[0] == '[' {
			return parseColumnItems(sp, rest)
		}
		sp.col1 = unescapeColumn(rest)
		return sp, true
	case '#':
		if !sp.setSpecial(s) {
			return sp, false
		}
		return sp, sp.valid()
	case '[':
		return parseColumnItems(sp, s)
	}
	sp.col1 = unescapeColumn(s)
	return sp, true
}

// parseColumnItems reads a list of bracketed items: specifiers (#All, …),
// then a column or a column range ([C1]:[C2]), separated by ',' or ';'.
func parseColumnItems(sp structSpec, s string) (structSpec, bool) {
	i := 0
	haveCols := false
	for i < len(s) {
		for i < len(s) && (s[i] == ' ' || s[i] == ',' || s[i] == ';') {
			i++
		}
		if i >= len(s) {
			break
		}
		if s[i] != '[' {
			return sp, false
		}
		end := scanBracket(s, i)
		if end > len(s) || s[end-1] != ']' {
			return sp, false
		}
		item := s[i+1 : end-1]
		i = end
		if strings.HasPrefix(strings.TrimSpace(item), "#") {
			if haveCols || !sp.setSpecial(strings.TrimSpace(item)) {
				return sp, false
			}
			continue
		}
		if strings.HasPrefix(item, "@") && !sp.thisRow && !haveCols {
			sp.thisRow = true
			item = item[1:]
		}
		if haveCols {
			return sp, false
		}
		haveCols = true
		sp.col1 = unescapeColumn(item)
		// A column range: [C1]:[C2].
		j := i
		for j < len(s) && s[j] == ' ' {
			j++
		}
		if j < len(s) && s[j] == ':' {
			j++
			for j < len(s) && s[j] == ' ' {
				j++
			}
			if j >= len(s) || s[j] != '[' {
				return sp, false
			}
			end := scanBracket(s, j)
			if end > len(s) || s[end-1] != ']' {
				return sp, false
			}
			sp.col2 = unescapeColumn(s[j+1 : end-1])
			i = end
		}
	}
	return sp, sp.valid()
}

// setSpecial records one #specifier; false for an unknown one.
func (sp *structSpec) setSpecial(s string) bool {
	switch strings.ToUpper(strings.Join(strings.Fields(s), " ")) {
	case "#ALL":
		sp.all = true
	case "#DATA":
		sp.data = true
	case "#HEADERS":
		sp.headers = true
	case "#TOTALS":
		sp.totals = true
	case "#THIS ROW":
		sp.thisRow = true
	default:
		return false
	}
	return true
}

// valid reports whether the specifiers combine: one of them alone, headers +
// data, or data + totals.
func (sp structSpec) valid() bool {
	n := 0
	for _, b := range []bool{sp.all, sp.data, sp.headers, sp.totals, sp.thisRow} {
		if b {
			n++
		}
	}
	switch {
	case n <= 1:
		return true
	case n == 2 && sp.headers && sp.data, n == 2 && sp.data && sp.totals:
		return true
	}
	return false
}

// resolve turns a spec into an area of table t. row is the formula's row
// (for #This Row). The error is the value to return when it fails.
func (sp structSpec) resolve(t *tableDef, row int) (area, value, bool) {
	a := t.ref
	d := t.dataArea()
	switch {
	case sp.all:
	case sp.thisRow:
		if row < d.r1 || row > d.r2 {
			return area{}, errValue, false
		}
		a.r1, a.r2 = row, row
	case sp.headers && sp.data:
		a.r1, a.r2 = t.ref.r1, d.r2
	case sp.data && sp.totals:
		a.r1, a.r2 = d.r1, t.ref.r2
	case sp.headers:
		if t.header == 0 {
			return area{}, errRef, false
		}
		a.r1, a.r2 = t.ref.r1, t.ref.r1
	case sp.totals:
		if t.totals == 0 {
			return area{}, errRef, false
		}
		a.r1, a.r2 = t.ref.r2, t.ref.r2
	default:
		a.r1, a.r2 = d.r1, d.r2
	}
	if sp.col1 != "" {
		c1 := t.colIndex(sp.col1)
		c2 := c1
		if sp.col2 != "" {
			c2 = t.colIndex(sp.col2)
		}
		if c1 < 0 || c2 < 0 {
			return area{}, errName, false
		}
		if c2 < c1 {
			c1, c2 = c2, c1
		}
		a.c1, a.c2 = t.ref.c1+c1, t.ref.c1+c2
	}
	return a, value{}, true
}

// structArea resolves a structured reference written in a formula on sheet
// si at cell at: name is the table name ("" = the table holding the cell),
// inner the bracket content.
func (wb *workbookView) structArea(name, inner string, si int, at cellAddr) (*tableDef, area, value, bool) {
	var t *tableDef
	if name == "" {
		t = wb.tableAt(si, at)
		if t == nil {
			return nil, area{}, errRef, false
		}
	} else if t = wb.tableByName(name); t == nil {
		return nil, area{}, errName, false
	}
	sp, ok := parseStructSpec(inner)
	if !ok {
		return nil, area{}, errName, false
	}
	a, e, ok := sp.resolve(t, at.row)
	return t, a, e, ok
}

// structRef evaluates a structured reference at the evaluator's position.
func (ev *Evaluator) structRef(name, inner string) value {
	wb := ev.book()
	t, a, e, ok := wb.structArea(name, inner, ev.cur, cellAddr{row: ev.curRow, col: ev.curCol})
	if !ok {
		return e
	}
	single := a.r1 == a.r2 && a.c1 == a.c2
	return ev.refValue(t.sheet, !single, a)
}

// tableRefs lists what a structured reference token points at, for the
// dependency graph. Without a formula cell (a defined name), #This Row
// stands for the whole column.
func (wb *workbookView) tableRefs(name, inner string, si int, at *cellAddr) []refInfo {
	pos := cellAddr{row: -1, col: -1}
	if at != nil {
		pos = *at
	}
	var t *tableDef
	if name == "" {
		if at == nil {
			return nil
		}
		t = wb.tableAt(si, pos)
	} else {
		t = wb.tableByName(name)
	}
	if t == nil {
		return nil
	}
	sp, ok := parseStructSpec(inner)
	if !ok {
		return nil
	}
	if sp.thisRow && at == nil {
		sp.thisRow, sp.data = false, true
	}
	a, _, ok := sp.resolve(t, pos.row)
	if !ok {
		return nil
	}
	return []refInfo{{sheet: t.sheet, areas: []area{a}}}
}
