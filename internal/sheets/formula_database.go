package sheets

import (
	"math"
	"strconv"
	"strings"
)

// Excel database functions: D...(database, field, criteria). `database` is a
// range whose first row holds column headers; `field` selects a column by header
// name or 1-based index; `criteria` is a range whose first row names fields and
// whose remaining rows are condition sets (AND across columns in a row, OR across
// rows). A criteria cell may carry a leading comparison operator (>, <, >=, <=,
// =, <>); a bare value means equality.

func init() {
	registerFunc("DSUM", func(c *callCtx) value { return dbAgg(c, "sum") })
	registerFunc("DAVERAGE", func(c *callCtx) value { return dbAgg(c, "avg") })
	registerFunc("DMAX", func(c *callCtx) value { return dbAgg(c, "max") })
	registerFunc("DMIN", func(c *callCtx) value { return dbAgg(c, "min") })
	registerFunc("DCOUNT", func(c *callCtx) value { return dbAgg(c, "count") })
	registerFunc("DCOUNTA", func(c *callCtx) value { return dbAgg(c, "counta") })
	registerFunc("DPRODUCT", func(c *callCtx) value { return dbAgg(c, "product") })
	registerFunc("DSTDEV", func(c *callCtx) value { return dbAgg(c, "stdev") })
	registerFunc("DVAR", func(c *callCtx) value { return dbAgg(c, "var") })
	registerFunc("DGET", dbGet)
}

func dbColIndex(headers []value, field value) int {
	if field.kind == kindNum {
		return int(field.num) - 1
	}
	name := strings.TrimSpace(field.toStr())
	for i, h := range headers {
		if strings.EqualFold(strings.TrimSpace(h.toStr()), name) {
			return i
		}
	}
	return -1
}

func dbCellMatch(cell value, crit string) bool {
	op, rest := "=", strings.TrimSpace(crit)
	for _, o := range []string{">=", "<=", "<>", "=", ">", "<"} {
		if strings.HasPrefix(rest, o) {
			op = o
			rest = strings.TrimSpace(rest[len(o):])
			break
		}
	}
	if cn, ok := cell.toNum(); ok && cell.kind != kindStr {
		if vn, err := strconv.ParseFloat(rest, 64); err == nil {
			switch op {
			case "=":
				return cn == vn
			case "<>":
				return cn != vn
			case ">":
				return cn > vn
			case "<":
				return cn < vn
			case ">=":
				return cn >= vn
			case "<=":
				return cn <= vn
			}
		}
	}
	cs := strings.ToLower(strings.TrimSpace(cell.toStr()))
	rs := strings.ToLower(rest)
	switch op {
	case "=":
		return cs == rs
	case "<>":
		return cs != rs
	case ">":
		return cs > rs
	case "<":
		return cs < rs
	case ">=":
		return cs >= rs
	case "<=":
		return cs <= rs
	}
	return false
}

func dbMatch(record, headers []value, crit rangeVal) bool {
	if crit.rows < 2 {
		return true // headers only → match all
	}
	chead := crit.cells[0]
	for ri := 1; ri < crit.rows; ri++ {
		row := crit.cells[ri]
		all := true
		for ci := 0; ci < len(chead) && ci < len(row); ci++ {
			cstr := strings.TrimSpace(row[ci].toStr())
			if cstr == "" {
				continue
			}
			col := dbColIndex(headers, chead[ci])
			if col < 0 || col >= len(record) {
				all = false
				break
			}
			if !dbCellMatch(record[col], cstr) {
				all = false
				break
			}
		}
		if all {
			return true
		}
	}
	return false
}

// dbSelect returns the matched field cells (and their numeric subset).
func dbSelect(c *callCtx) (cells []value, nums []float64, ok bool) {
	db, ok1 := c.rangeArg(0)
	crit, ok3 := c.rangeArg(2)
	if !ok1 || !ok3 || db.rows < 2 {
		return nil, nil, false
	}
	headers := db.cells[0]
	col := dbColIndex(headers, c.scalar(1))
	if col < 0 {
		return nil, nil, false
	}
	for ri := 1; ri < db.rows; ri++ {
		rec := db.cells[ri]
		if !dbMatch(rec, headers, crit) || col >= len(rec) {
			continue
		}
		cell := rec[col]
		cells = append(cells, cell)
		if n, okn := cell.toNum(); okn && cell.kind != kindStr {
			nums = append(nums, n)
		}
	}
	return cells, nums, true
}

func dbAgg(c *callCtx, op string) value {
	cells, nums, ok := dbSelect(c)
	if !ok {
		return errValue
	}
	switch op {
	case "count":
		return numVal(float64(len(nums)))
	case "counta":
		n := 0
		for _, cell := range cells {
			if !(cell.kind == kindStr && cell.str == "") {
				n++
			}
		}
		return numVal(float64(n))
	case "sum":
		s := 0.0
		for _, n := range nums {
			s += n
		}
		return numVal(s)
	case "product":
		p := 1.0
		for _, n := range nums {
			p *= n
		}
		return numVal(p)
	case "avg":
		if len(nums) == 0 {
			return errDiv0
		}
		s := 0.0
		for _, n := range nums {
			s += n
		}
		return numVal(s / float64(len(nums)))
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
	case "stdev", "var":
		if len(nums) < 2 {
			return errDiv0
		}
		mean := 0.0
		for _, n := range nums {
			mean += n
		}
		mean /= float64(len(nums))
		ss := 0.0
		for _, n := range nums {
			ss += (n - mean) * (n - mean)
		}
		variance := ss / float64(len(nums)-1)
		if op == "var" {
			return numVal(variance)
		}
		return numVal(math.Sqrt(variance))
	}
	return errValue
}

func dbGet(c *callCtx) value {
	cells, _, ok := dbSelect(c)
	if !ok {
		return errValue
	}
	if len(cells) == 0 {
		return errVal("#VALUE!")
	}
	if len(cells) > 1 {
		return errNum
	}
	return cells[0]
}
