package sheets

import (
	"sort"
	"strconv"
	"strings"
)

// QUERY(data, query, [headers]) runs a subset of the Google Visualization API
// Query Language over a range. Supported clauses: SELECT (columns or aggregates
// count/sum/avg/min/max), WHERE (=, !=, <>, <, >, <=, >=, contains, starts
// with, ends with, plus AND/OR), GROUP BY, ORDER BY (asc/desc), LIMIT, OFFSET.
// Columns are referenced by letter (A = first column of the data range). Not yet
// supported: PIVOT, LABEL/FORMAT, scalar functions, regular-expression MATCHES.

func init() { registerFunc("QUERY", fnQuery) }

type querySelect struct {
	col int    // column index within data
	agg string // "", "count", "sum", "avg", "min", "max"
}

type queryCond struct {
	col int
	op  string // = != < > <= >= contains startswith endswith
	val string // raw comparison literal (numeric compares coerce)
}

func fnQuery(c *callCtx) value {
	rv, ok := c.rangeArg(0)
	if !ok || rv.rows == 0 {
		return errNA
	}
	q := strings.TrimSpace(c.text(1))
	if q == "" {
		return errValue
	}
	headerRows := 0
	if c.nargs() >= 3 {
		if h, ok := c.num(2); ok && h > 0 {
			headerRows = int(h)
		}
	}
	header := rv.cells[:min(headerRows, rv.rows)]
	body := rv.cells[min(headerRows, rv.rows):]

	cl := splitClauses(q)
	sels, selErr := parseSelect(cl["select"], rv.cols)
	if selErr {
		return errVal("#VALUE!")
	}
	conds, conn, condErr := parseWhere(cl["where"])
	if condErr {
		return errVal("#VALUE!")
	}
	groupCols, groupErr := parseColList(cl["group by"])
	if groupErr {
		return errVal("#VALUE!")
	}
	orderKeys, orderErr := parseOrder(cl["order by"])
	if orderErr {
		return errVal("#VALUE!")
	}

	// 1. WHERE filter.
	rows := make([][]value, 0, len(body))
	for _, r := range body {
		if matchConds(r, conds, conn) {
			rows = append(rows, r)
		}
	}

	// 2. GROUP BY + aggregates (or plain projection).
	hasAgg := false
	for _, s := range sels {
		if s.agg != "" {
			hasAgg = true
		}
	}
	var out [][]value
	if len(groupCols) > 0 || hasAgg {
		out = aggregate(rows, sels, groupCols)
		// ORDER BY after aggregation: order on the matching selected column.
		if len(orderKeys) > 0 {
			sort.SliceStable(out, func(i, j int) bool {
				for _, k := range orderKeys {
					ci := selColPos(sels, k.col)
					if ci < 0 || ci >= len(out[i]) {
						continue
					}
					if cmp := arrCmp(out[i][ci], out[j][ci]); cmp != 0 {
						if k.desc {
							return cmp > 0
						}
						return cmp < 0
					}
				}
				return false
			})
		}
	} else {
		// ORDER BY before projection so we can sort by any data column, even one
		// not in the SELECT list.
		if len(orderKeys) > 0 {
			sort.SliceStable(rows, func(i, j int) bool {
				for _, k := range orderKeys {
					if k.col >= len(rows[i]) || k.col >= len(rows[j]) {
						continue
					}
					if cmp := arrCmp(rows[i][k.col], rows[j][k.col]); cmp != 0 {
						if k.desc {
							return cmp > 0
						}
						return cmp < 0
					}
				}
				return false
			})
		}
		for _, r := range rows {
			out = append(out, projectRow(r, sels))
		}
	}

	// 4. OFFSET / LIMIT.
	if off := parseIntClause(cl["offset"]); off > 0 {
		if off >= len(out) {
			out = nil
		} else {
			out = out[off:]
		}
	}
	if lim := parseIntClause(cl["limit"]); lim >= 0 && cl["limit"] != "" {
		if lim < len(out) {
			out = out[:lim]
		}
	}

	// 5. Prepend matching header cells (projected) when the data had headers.
	if len(header) > 0 && len(groupCols) == 0 && !hasAgg {
		hdr := projectRow(header[0], sels)
		out = append([][]value{hdr}, out...)
	}
	if len(out) == 0 {
		return errVal("#N/A")
	}
	return arrayValue(out)
}

// ---- clause splitting -------------------------------------------------------

var clauseKeywords = []string{"select", "where", "group by", "order by", "pivot", "limit", "offset", "label", "format", "options"}

// splitClauses lowercases keyword detection while preserving the original text
// of each clause body (quoted strings keep their case).
func splitClauses(q string) map[string]string {
	low := strings.ToLower(q)
	type mark struct {
		kw  string
		pos int
	}
	var marks []mark
	for _, kw := range clauseKeywords {
		start := 0
		for {
			i := indexWord(low, kw, start)
			if i < 0 {
				break
			}
			marks = append(marks, mark{kw, i})
			start = i + len(kw)
		}
	}
	sort.Slice(marks, func(i, j int) bool { return marks[i].pos < marks[j].pos })
	res := map[string]string{}
	for i, m := range marks {
		end := len(q)
		if i+1 < len(marks) {
			end = marks[i+1].pos
		}
		body := strings.TrimSpace(q[m.pos+len(m.kw) : end])
		if _, ok := res[m.kw]; !ok {
			res[m.kw] = body
		}
	}
	return res
}

// indexWord finds kw in s at a word boundary (not inside a quoted string),
// starting at from. Returns -1 if not found.
func indexWord(s, kw string, from int) int {
	for i := from; i+len(kw) <= len(s); i++ {
		if s[i:i+len(kw)] != kw {
			continue
		}
		// boundary check
		if i > 0 && isWordByte(s[i-1]) {
			continue
		}
		if i+len(kw) < len(s) && isWordByte(s[i+len(kw)]) {
			continue
		}
		if insideQuote(s, i) {
			continue
		}
		return i
	}
	return -1
}

func isWordByte(b byte) bool {
	return b == '_' || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9')
}

func insideQuote(s string, pos int) bool {
	q := 0
	for i := 0; i < pos; i++ {
		if s[i] == '\'' || s[i] == '"' {
			q++
		}
	}
	return q%2 == 1
}

// ---- column refs ------------------------------------------------------------

// colLetterIndex converts "A"→0, "B"→1, "AA"→26. Returns -1 if not letters.
func colLetterIndex(s string) int {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return -1
	}
	idx := 0
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch < 'A' || ch > 'Z' {
			return -1
		}
		idx = idx*26 + int(ch-'A'+1)
	}
	return idx - 1
}

// ---- SELECT -----------------------------------------------------------------

func parseSelect(s string, ncols int) ([]querySelect, bool) {
	s = strings.TrimSpace(s)
	if s == "" || s == "*" {
		out := make([]querySelect, ncols)
		for i := range out {
			out[i] = querySelect{col: i}
		}
		return out, false
	}
	var sels []querySelect
	for _, part := range splitTopLevel(s, ',') {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		agg, inner := parseAgg(part)
		idx := colLetterIndex(inner)
		if idx < 0 || idx >= ncols {
			return nil, true
		}
		sels = append(sels, querySelect{col: idx, agg: agg})
	}
	if len(sels) == 0 {
		return nil, true
	}
	return sels, false
}

func parseAgg(part string) (agg, inner string) {
	low := strings.ToLower(part)
	for _, a := range []string{"count", "sum", "avg", "min", "max"} {
		if strings.HasPrefix(low, a+"(") && strings.HasSuffix(part, ")") {
			return a, part[len(a)+1 : len(part)-1]
		}
	}
	return "", part
}

func projectRow(r []value, sels []querySelect) []value {
	out := make([]value, len(sels))
	for i, s := range sels {
		if s.col < len(r) {
			out[i] = r[s.col]
		} else {
			out[i] = strVal("")
		}
	}
	return out
}

func selColPos(sels []querySelect, col int) int {
	for i, s := range sels {
		if s.col == col && s.agg == "" {
			return i
		}
	}
	return -1
}

// ---- WHERE ------------------------------------------------------------------

func parseWhere(s string) ([]queryCond, string, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, "and", false
	}
	conn := "and"
	parts := splitByWord(s, " or ")
	if len(parts) > 1 {
		conn = "or"
	} else {
		parts = splitByWord(s, " and ")
	}
	var conds []queryCond
	for _, p := range parts {
		cnd, err := parseCond(strings.TrimSpace(p))
		if err {
			return nil, conn, true
		}
		conds = append(conds, cnd)
	}
	return conds, conn, false
}

func parseCond(p string) (queryCond, bool) {
	low := strings.ToLower(p)
	// string operators
	for _, so := range []struct{ kw, op string }{
		{" contains ", "contains"}, {" starts with ", "startswith"}, {" ends with ", "endswith"},
	} {
		if i := strings.Index(low, so.kw); i >= 0 {
			col := colLetterIndex(strings.TrimSpace(p[:i]))
			val := unquote(strings.TrimSpace(p[i+len(so.kw):]))
			if col < 0 {
				return queryCond{}, true
			}
			return queryCond{col: col, op: so.op, val: val}, false
		}
	}
	// comparison operators (order matters: check 2-char first)
	for _, op := range []string{"<=", ">=", "<>", "!=", "=", "<", ">"} {
		if i := strings.Index(p, op); i >= 0 {
			col := colLetterIndex(strings.TrimSpace(p[:i]))
			val := unquote(strings.TrimSpace(p[i+len(op):]))
			if col < 0 {
				return queryCond{}, true
			}
			o := op
			if o == "<>" {
				o = "!="
			}
			return queryCond{col: col, op: o, val: val}, false
		}
	}
	return queryCond{}, true
}

func matchConds(r []value, conds []queryCond, conn string) bool {
	if len(conds) == 0 {
		return true
	}
	for _, c := range conds {
		ok := matchCond(r, c)
		if conn == "or" && ok {
			return true
		}
		if conn == "and" && !ok {
			return false
		}
	}
	return conn == "and"
}

func matchCond(r []value, c queryCond) bool {
	if c.col >= len(r) {
		return false
	}
	cell := r[c.col]
	switch c.op {
	case "contains":
		return strings.Contains(strings.ToLower(cell.toStr()), strings.ToLower(c.val))
	case "startswith":
		return strings.HasPrefix(strings.ToLower(cell.toStr()), strings.ToLower(c.val))
	case "endswith":
		return strings.HasSuffix(strings.ToLower(cell.toStr()), strings.ToLower(c.val))
	}
	// numeric compare when both sides are numeric, else string compare
	cmp := 0
	if cn, ok := cell.toNum(); ok && cell.kind != kindStr {
		if vn, err := strconv.ParseFloat(c.val, 64); err == nil {
			switch {
			case cn < vn:
				cmp = -1
			case cn > vn:
				cmp = 1
			}
		} else {
			cmp = strings.Compare(strings.ToLower(cell.toStr()), strings.ToLower(c.val))
		}
	} else {
		cmp = strings.Compare(strings.ToLower(cell.toStr()), strings.ToLower(c.val))
	}
	switch c.op {
	case "=":
		return cmp == 0
	case "!=":
		return cmp != 0
	case "<":
		return cmp < 0
	case ">":
		return cmp > 0
	case "<=":
		return cmp <= 0
	case ">=":
		return cmp >= 0
	}
	return false
}

// ---- GROUP BY + aggregates --------------------------------------------------

func aggregate(rows [][]value, sels []querySelect, groupCols []int) [][]value {
	type bucket struct {
		key  string
		rows [][]value
	}
	var order []string
	groups := map[string]*bucket{}
	for _, r := range rows {
		var kb strings.Builder
		for _, gc := range groupCols {
			if gc < len(r) {
				kb.WriteString(r[gc].toStr())
			}
			kb.WriteByte('\x00')
		}
		k := kb.String()
		b := groups[k]
		if b == nil {
			b = &bucket{key: k}
			groups[k] = b
			order = append(order, k)
		}
		b.rows = append(b.rows, r)
	}
	// single implicit group when aggregating without GROUP BY
	if len(groupCols) == 0 {
		order = []string{""}
		groups[""] = &bucket{rows: rows}
	}
	var out [][]value
	for _, k := range order {
		b := groups[k]
		row := make([]value, len(sels))
		for i, s := range sels {
			if s.agg == "" {
				if len(b.rows) > 0 && s.col < len(b.rows[0]) {
					row[i] = b.rows[0][s.col]
				} else {
					row[i] = strVal("")
				}
				continue
			}
			row[i] = computeAgg(b.rows, s)
		}
		out = append(out, row)
	}
	return out
}

func computeAgg(rows [][]value, s querySelect) value {
	var nums []float64
	count := 0
	for _, r := range rows {
		if s.col >= len(r) {
			continue
		}
		cell := r[s.col]
		if cell.kind == kindStr && cell.str == "" {
			continue
		}
		count++
		if n, ok := cell.toNum(); ok && cell.kind != kindStr {
			nums = append(nums, n)
		}
	}
	switch s.agg {
	case "count":
		return numVal(float64(count))
	case "sum":
		sum := 0.0
		for _, n := range nums {
			sum += n
		}
		return numVal(sum)
	case "avg":
		if len(nums) == 0 {
			return numVal(0)
		}
		sum := 0.0
		for _, n := range nums {
			sum += n
		}
		return numVal(sum / float64(len(nums)))
	case "min":
		if len(nums) == 0 {
			return numVal(0)
		}
		m := nums[0]
		for _, n := range nums {
			if n < m {
				m = n
			}
		}
		return numVal(m)
	case "max":
		if len(nums) == 0 {
			return numVal(0)
		}
		m := nums[0]
		for _, n := range nums {
			if n > m {
				m = n
			}
		}
		return numVal(m)
	}
	return errValue
}

// ---- ORDER BY / lists / ints ------------------------------------------------

type orderKey struct {
	col  int
	desc bool
}

func parseOrder(s string) ([]orderKey, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, false
	}
	var keys []orderKey
	for _, part := range splitTopLevel(s, ',') {
		f := strings.Fields(strings.TrimSpace(part))
		if len(f) == 0 {
			continue
		}
		col := colLetterIndex(f[0])
		if col < 0 {
			return nil, true
		}
		desc := len(f) > 1 && strings.EqualFold(f[1], "desc")
		keys = append(keys, orderKey{col: col, desc: desc})
	}
	return keys, false
}

func parseColList(s string) ([]int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, false
	}
	var cols []int
	for _, part := range splitTopLevel(s, ',') {
		col := colLetterIndex(strings.TrimSpace(part))
		if col < 0 {
			return nil, true
		}
		cols = append(cols, col)
	}
	return cols, false
}

func parseIntClause(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return -1
	}
	n, err := strconv.Atoi(strings.Fields(s)[0])
	if err != nil {
		return -1
	}
	return n
}

// ---- small string helpers ---------------------------------------------------

func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && (s[0] == '\'' || s[0] == '"') && s[len(s)-1] == s[0] {
		return s[1 : len(s)-1]
	}
	return s
}

// splitTopLevel splits on sep but not inside quotes or parentheses.
func splitTopLevel(s string, sep byte) []string {
	var parts []string
	depth, q := 0, byte(0)
	start := 0
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case q != 0:
			if ch == q {
				q = 0
			}
		case ch == '\'' || ch == '"':
			q = ch
		case ch == '(':
			depth++
		case ch == ')':
			depth--
		case ch == sep && depth == 0:
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}

// splitByWord splits s on a lowercased word separator (e.g. " or ") outside quotes.
func splitByWord(s, sep string) []string {
	low := strings.ToLower(s)
	var parts []string
	start := 0
	for {
		i := indexWord(low, strings.TrimSpace(sep), start)
		// indexWord matches the bare keyword; require surrounding spaces
		if i <= 0 || i+len(strings.TrimSpace(sep)) >= len(s) {
			break
		}
		if s[i-1] != ' ' {
			start = i + 1
			continue
		}
		parts = append(parts, s[start:i-1])
		start = i + len(strings.TrimSpace(sep)) + 1
	}
	parts = append(parts, s[start:])
	return parts
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
