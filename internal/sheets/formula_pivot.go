package sheets

// GETPIVOTDATA over the pivot reports Grown keeps on the workbook.
//
//	GETPIVOTDATA(data_field, pivot_table, [field1, item1], ...)
//
// The editor writes each pivot table onto the grid and stores what it wrote
// (`grownPivots[].output` on the first sheet): the report's range and every
// value cell with the data field and the (field, item) pairs that address
// it. GETPIVOTDATA finds the pivot whose range holds pivot_table and returns
// the value cell whose pairs are exactly the ones given, in any order, like
// Excel: a cell the report does not show (a hidden subtotal or grand total,
// a filtered item, an unknown field) is #REF!, an empty value cell is 0.

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

func init() {
	registerFunc("GETPIVOTDATA", fnGetPivotData)
}

// pivotOutput mirrors PivotOutput in web/app/src/pages/sheets/pivotModel.ts.
type pivotOutput struct {
	SheetID    string `json:"sheetId"`
	R0         int    `json:"r0"`
	C0         int    `json:"c0"`
	Rows       int    `json:"rows"`
	Cols       int    `json:"cols"`
	DataFields []struct {
		Name  string `json:"name"`
		Field string `json:"field"`
	} `json:"dataFields"`
	Entries []pivotEntry `json:"entries"`
	Pages   []struct {
		Field string `json:"field"`
		Item  string `json:"item"`
	} `json:"pages"`
	sheet int
}

// pivotEntry is one value cell: data field index, (field, caption[, number])
// items and the value.
type pivotEntry struct {
	D int               `json:"d"`
	F []json.RawMessage `json:"f"`
	V json.RawMessage   `json:"v"`
}

type pivotItem struct {
	field   string
	caption string
	num     float64
	hasNum  bool
}

func (e pivotEntry) items() []pivotItem {
	out := make([]pivotItem, 0, len(e.F))
	for _, raw := range e.F {
		var parts []interface{}
		if json.Unmarshal(raw, &parts) != nil || len(parts) < 2 {
			continue
		}
		it := pivotItem{field: fmtAny(parts[0]), caption: fmtAny(parts[1])}
		if len(parts) > 2 {
			if n, ok := parts[2].(float64); ok {
				it.num, it.hasNum = n, true
			}
		}
		out = append(out, it)
	}
	return out
}

func (e pivotEntry) value() value {
	var v interface{}
	if len(e.V) == 0 || json.Unmarshal(e.V, &v) != nil || v == nil {
		return numVal(0)
	}
	switch x := v.(type) {
	case float64:
		return numVal(x)
	case bool:
		return boolVal(x)
	case string:
		if isErrorCode(x) {
			return errVal(x)
		}
		return strVal(x)
	case map[string]interface{}:
		if s, ok := x["error"].(string); ok {
			return errVal(s)
		}
	}
	return numVal(0)
}

func isErrorCode(s string) bool {
	switch s {
	case "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#SPILL!", "#CALC!", "#CIRC!":
		return true
	}
	return false
}

// pivotStore is the `grownPivots` entry shape (only the stored output matters).
type pivotStore struct {
	Output *pivotOutput `json:"output"`
}

// loadPivots reads the stored pivot reports from the first sheet.
func loadPivots(wb FsWorkbook, view *workbookView) {
	if len(wb) == 0 || wb[0].Extra == nil {
		return
	}
	raw, ok := wb[0].Extra["grownPivots"]
	if !ok {
		return
	}
	var list []pivotStore
	if json.Unmarshal(raw, &list) != nil {
		return
	}
	for _, p := range list {
		if p.Output == nil {
			continue
		}
		o := *p.Output
		o.sheet = -1
		for i := range wb {
			if wb[i].ID == o.SheetID {
				o.sheet = i
			}
		}
		if o.sheet < 0 && o.SheetID == "" {
			o.sheet = 0
		}
		if o.sheet >= 0 {
			view.pivots = append(view.pivots, o)
		}
	}
}

// pivotAt returns the stored pivot whose report range holds the reference's
// top-left cell.
func (c *callCtx) pivotAt(ref *refInfo) *pivotOutput {
	if ref == nil || len(ref.areas) == 0 {
		return nil
	}
	a := ref.first()
	wb := c.ev.book()
	for i := range wb.pivots {
		p := &wb.pivots[i]
		if p.sheet == ref.sheet && a.r1 >= p.R0 && a.r1 < p.R0+p.Rows && a.c1 >= p.C0 && a.c1 < p.C0+p.Cols {
			return p
		}
	}
	return nil
}

func fnGetPivotData(c *callCtx) value {
	// The two-argument form GETPIVOTDATA(pivot_table, name) (Excel's older
	// syntax): the first argument points into a pivot table.
	if c.nargs() == 2 {
		if pv := c.pivotAt(c.refArg(0)); pv != nil {
			return pivotByName(pv, c.scalar(1))
		}
	}
	if c.nargs() < 2 || c.nargs()%2 != 0 {
		return errRef
	}
	df := c.scalar(0)
	if df.isErr() {
		return df
	}
	pv := c.pivotAt(c.refArg(1))
	if pv == nil {
		return errRef
	}
	// The data field, by caption first, then by source field name.
	name := strings.TrimSpace(df.toStr())
	di := -1
	for i, d := range pv.DataFields {
		if strings.EqualFold(strings.TrimSpace(d.Name), name) {
			di = i
			break
		}
	}
	if di < 0 {
		for i, d := range pv.DataFields {
			if strings.EqualFold(strings.TrimSpace(d.Field), name) {
				di = i
				break
			}
		}
	}
	if di < 0 {
		return errRef
	}
	type want struct {
		field string
		item  value
	}
	var wants []want
	for i := 2; i+1 < c.nargs(); i += 2 {
		f := c.scalar(i)
		if f.isErr() {
			return f
		}
		var it value
		if c.omitted(i + 1) {
			it = emptyArg
		} else {
			it = c.scalar(i + 1)
		}
		wants = append(wants, want{field: strings.TrimSpace(f.toStr()), item: it})
	}
	// Page fields may be named with the item they show.
	var filtered []want
	for _, w := range wants {
		page := false
		for _, p := range pv.Pages {
			if strings.EqualFold(p.Field, w.field) {
				page = true
				if p.Item != "" && !strings.EqualFold(p.Item, w.item.toStr()) {
					return errRef
				}
			}
		}
		if !page {
			filtered = append(filtered, w)
		}
	}
	for _, e := range pv.Entries {
		if e.D != di {
			continue
		}
		items := e.items()
		if len(items) != len(filtered) {
			continue
		}
		ok := true
		for _, w := range filtered {
			found := false
			for _, it := range items {
				if strings.EqualFold(strings.TrimSpace(it.field), w.field) && pivotItemMatches(it, w.item) {
					found = true
					break
				}
			}
			if !found {
				ok = false
				break
			}
		}
		if ok {
			return e.value()
		}
	}
	return errRef
}

// pivotItemMatches compares a GETPIVOTDATA item argument with an item: by
// number (dates, numbers, grouped numbers), by caption (case-insensitive),
// an empty argument for (blank), "<" / ">" for a group's out-of-range items.
func pivotItemMatches(it pivotItem, v value) bool {
	if isEmptyArg(v) || v.blank {
		return it.caption == "(blank)"
	}
	switch v.kind {
	case kindNum:
		if it.hasNum && math.Abs(it.num-v.num) < 1e-9 {
			return true
		}
		return strings.EqualFold(it.caption, formatGeneralNum(v.num))
	case kindBool:
		if v.num != 0 {
			return it.caption == "TRUE"
		}
		return it.caption == "FALSE"
	case kindErr:
		return strings.EqualFold(it.caption, v.str)
	}
	s := strings.TrimSpace(v.str)
	if strings.EqualFold(it.caption, s) {
		return true
	}
	if it.hasNum {
		if n, err := strconv.ParseFloat(s, 64); err == nil && math.Abs(n-it.num) < 1e-9 {
			return true
		}
	}
	if (s == "<" || s == ">") && strings.HasPrefix(it.caption, s) {
		return true
	}
	return false
}

func formatGeneralNum(n float64) string {
	return strconv.FormatFloat(n, 'g', 15, 64)
}

// pivotByName is the two-argument GETPIVOTDATA: name is a space-separated
// description of a cell — item captions, a data field caption, "Total" /
// "Grand Total" words — ("East", "Boy Total", "Total Sum of Cost", "" for
// the grand total). Words that name nothing are #N/A; a description that
// fits no single shown cell (ambiguous, hidden) is #REF!.
func pivotByName(pv *pivotOutput, v value) value {
	if v.isErr() {
		return v
	}
	name := strings.ToLower(strings.TrimSpace(v.toStr()))
	if v.kind == kindNum && !v.blank && !isEmptyArg(v) {
		name = strings.ToLower(formatGeneralNum(v.num))
	}
	// A data field caption anywhere in the name picks the data field.
	di := -1
	best := 0
	for i, d := range pv.DataFields {
		n := strings.ToLower(strings.TrimSpace(d.Name))
		if n != "" && len(n) > best && containsWords(name, n) {
			di, best = i, len(n)
		}
	}
	if di >= 0 {
		name = strings.TrimSpace(removeWords(name, strings.ToLower(strings.TrimSpace(pv.DataFields[di].Name))))
	}
	// Item captions the pivot shows.
	captions := map[string]bool{}
	for _, e := range pv.Entries {
		for _, it := range e.items() {
			captions[strings.ToLower(it.caption)] = true
		}
	}
	words := strings.Fields(name)
	var want []string
	for i := 0; i < len(words); {
		matched := 0
		for j := len(words); j > i; j-- {
			if captions[strings.Join(words[i:j], " ")] {
				want = append(want, strings.Join(words[i:j], " "))
				matched = j - i
				break
			}
		}
		if matched > 0 {
			i += matched
			continue
		}
		switch words[i] {
		case "total", "grand":
			i++
			continue
		}
		return errNA
	}
	if di < 0 {
		if len(pv.DataFields) != 1 {
			return errRef
		}
		di = 0
	}
	var hit *pivotEntry
	for k := range pv.Entries {
		e := &pv.Entries[k]
		if e.D != di {
			continue
		}
		items := e.items()
		if len(items) != len(want) {
			continue
		}
		ok := true
		for _, w := range want {
			found := false
			for _, it := range items {
				if strings.EqualFold(it.caption, w) {
					found = true
					break
				}
			}
			if !found {
				ok = false
				break
			}
		}
		if ok {
			if hit != nil {
				return errRef
			}
			hit = e
		}
	}
	if hit == nil {
		return errRef
	}
	return hit.value()
}

func containsWords(s, sub string) bool {
	i := strings.Index(s, sub)
	if i < 0 {
		return false
	}
	before := i == 0 || s[i-1] == ' '
	after := i+len(sub) == len(s) || s[i+len(sub)] == ' '
	return before && after
}

func removeWords(s, sub string) string {
	i := strings.Index(s, sub)
	if i < 0 {
		return s
	}
	return s[:i] + " " + s[i+len(sub):]
}
