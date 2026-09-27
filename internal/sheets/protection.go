package sheets

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strconv"
	"strings"
	"time"
)

// Protected sheets and ranges (the Go twin of web/app/src/pages/sheets/protection.ts).
//
// Each sheet may carry `grownProtection`:
//
//	{"sheet": {"users": [...], "by": "...", "except": [rect...], "allowFormat": bool} | null,
//	 "ranges": [{"id", "name", "ranges": [rect...], "users": [...], "by"}]}
//
// with rect = {"r1","c1","r2","c2"} (0-based). The workbook owner may always
// edit; otherwise a protected range may be changed only by its author and the
// users it lists, and a protected sheet locks every cell outside its `except`
// ranges and cells whose format is unlocked (`lo: 0`) for users it does not
// list. Enforcement happens where edits reach the server: SaveSheet reverts
// blocked cell edits and protection changes (EnforceProtection), and the
// collaboration hub drops blocked ops (OpGuard).

// ProtRect is a cell rectangle.
type ProtRect struct {
	R1 int `json:"r1"`
	C1 int `json:"c1"`
	R2 int `json:"r2"`
	C2 int `json:"c2"`
}

func (r ProtRect) contains(row, col int) bool {
	r1, r2 := minInt(r.R1, r.R2), maxInt(r.R1, r.R2)
	c1, c2 := minInt(r.C1, r.C2), maxInt(r.C1, r.C2)
	return row >= r1 && row <= r2 && col >= c1 && col <= c2
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// SheetProt is sheet-level protection.
type SheetProt struct {
	Users       []string   `json:"users"`
	By          string     `json:"by,omitempty"`
	Except      []ProtRect `json:"except"`
	AllowFormat bool       `json:"allowFormat,omitempty"`
}

// ProtRange is a protected range.
type ProtRange struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	Ranges []ProtRect `json:"ranges"`
	Users  []string   `json:"users"`
	By     string     `json:"by,omitempty"`
}

// Protection is a sheet's protection model.
type Protection struct {
	Sheet  *SheetProt  `json:"sheet"`
	Ranges []ProtRange `json:"ranges"`
}

// Empty reports whether nothing is protected.
func (p Protection) Empty() bool { return p.Sheet == nil && len(p.Ranges) == 0 }

// Editor identifies who is editing.
type Editor struct {
	User  string
	Owner string
}

func (e Editor) isOwner() bool { return e.User != "" && e.User == e.Owner }

func listed(users []string, by string, e Editor) bool {
	if e.isOwner() {
		return true
	}
	if by != "" && by == e.User {
		return true
	}
	for _, u := range users {
		if u == e.User {
			return true
		}
	}
	return false
}

// CanEditCell reports whether e may change cell (r, c). unlocked is true when
// the cell's own format is unlocked (`lo: 0`).
func (p Protection) CanEditCell(r, c int, e Editor, unlocked bool) bool {
	if e.isOwner() {
		return true
	}
	for _, pr := range p.Ranges {
		if listed(pr.Users, pr.By, e) {
			continue
		}
		for _, x := range pr.Ranges {
			if x.contains(r, c) {
				return false
			}
		}
	}
	if sp := p.Sheet; sp != nil && !unlocked && !listed(sp.Users, sp.By, e) {
		for _, x := range sp.Except {
			if x.contains(r, c) {
				return true
			}
		}
		return false
	}
	return true
}

// sheetLocked reports whether the whole sheet is protected against e.
func (p Protection) sheetLocked(e Editor) bool {
	return p.Sheet != nil && !listed(p.Sheet.Users, p.Sheet.By, e)
}

// ParseProtection reads a sheet's `grownProtection` value (nil/invalid → empty).
func ParseProtection(raw json.RawMessage) Protection {
	var p Protection
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return p
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return Protection{}
	}
	return p.normalized()
}

// normalized replaces nil slices with empty ones so equal models compare equal.
func (p Protection) normalized() Protection {
	if p.Ranges == nil {
		p.Ranges = []ProtRange{}
	}
	for i := range p.Ranges {
		if p.Ranges[i].Users == nil {
			p.Ranges[i].Users = []string{}
		}
		if p.Ranges[i].Ranges == nil {
			p.Ranges[i].Ranges = []ProtRect{}
		}
	}
	if p.Sheet != nil {
		s := *p.Sheet
		if s.Users == nil {
			s.Users = []string{}
		}
		if s.Except == nil {
			s.Except = []ProtRect{}
		}
		p.Sheet = &s
	}
	return p
}

// mergeProtection is the protection model after e's change from old to next:
// items e may not manage stay as they were; new items are attributed to e.
func mergeProtection(old, next Protection, e Editor) Protection {
	if e.isOwner() {
		return next
	}
	out := Protection{Ranges: []ProtRange{}}
	switch {
	case old.Sheet != nil && !listed(old.Sheet.Users, old.Sheet.By, e):
		out.Sheet = old.Sheet
	case old.Sheet == nil && next.Sheet != nil:
		s := *next.Sheet
		s.By = e.User
		out.Sheet = &s
	default:
		out.Sheet = next.Sheet
	}
	nextByID := map[string]ProtRange{}
	for _, r := range next.Ranges {
		nextByID[r.ID] = r
	}
	oldIDs := map[string]bool{}
	for _, r := range old.Ranges {
		oldIDs[r.ID] = true
		if !listed(r.Users, r.By, e) {
			out.Ranges = append(out.Ranges, r)
			continue
		}
		if n, ok := nextByID[r.ID]; ok {
			out.Ranges = append(out.Ranges, n)
		}
	}
	for _, r := range next.Ranges {
		if oldIDs[r.ID] {
			continue
		}
		r.By = e.User
		out.Ranges = append(out.Ranges, r)
	}
	return out
}

type cellEntry struct {
	R int             `json:"r"`
	C int             `json:"c"`
	V json.RawMessage `json:"v"`
}

func cellKey(r, c int) string { return strconv.Itoa(r) + "_" + strconv.Itoa(c) }

// cellUnlocked reports whether a stored cell's format is unlocked (lo: 0).
func cellUnlocked(v json.RawMessage) bool {
	var m struct {
		Lo *float64 `json:"lo"`
	}
	if len(v) == 0 || json.Unmarshal(v, &m) != nil || m.Lo == nil {
		return false
	}
	return *m.Lo == 0
}

// cellsDiffer compares two stored cells. Computed values of an unchanged
// formula are ignored (the engine rewrites them on every save).
func cellsDiffer(a, b json.RawMessage) bool {
	var ma, mb map[string]interface{}
	emptyA := len(a) == 0 || string(a) == "null"
	emptyB := len(b) == 0 || string(b) == "null"
	if emptyA || emptyB {
		return emptyA != emptyB
	}
	if json.Unmarshal(a, &ma) != nil || json.Unmarshal(b, &mb) != nil {
		return !bytes.Equal(a, b)
	}
	fa, _ := ma["f"].(string)
	fb, _ := mb["f"].(string)
	if fa != "" && fa == fb {
		for _, k := range []string{"v", "m", "ct"} {
			delete(ma, k)
			delete(mb, k)
		}
	}
	return !reflect.DeepEqual(ma, mb)
}

func decodeCells(raw json.RawMessage) ([]cellEntry, bool) {
	if len(raw) == 0 {
		return nil, true
	}
	var cells []cellEntry
	if err := json.Unmarshal(raw, &cells); err != nil {
		return nil, false
	}
	return cells, true
}

// EnforceProtection returns next (a workbook JSON the user is saving) with
// every change the protections of prev (the stored workbook) forbid undone:
// edits of protected cells, changes to protection items the user may not
// manage, deleted protected sheets and (on a sheet the user may not edit)
// structure/size changes. It also reports how many changes were reverted.
// Workbooks that cannot be parsed are returned unchanged.
func EnforceProtection(prev, next string, e Editor) (string, int) {
	if e.isOwner() || prev == "" || next == "" || !strings.Contains(prev, "grownProtection") {
		return next, 0
	}
	var oldWB, newWB []map[string]json.RawMessage
	if json.Unmarshal([]byte(prev), &oldWB) != nil || json.Unmarshal([]byte(next), &newWB) != nil {
		return next, 0
	}
	sheetID := func(s map[string]json.RawMessage) string {
		var id interface{}
		_ = json.Unmarshal(s["id"], &id)
		switch v := id.(type) {
		case string:
			return v
		case float64:
			return strconv.FormatFloat(v, 'f', -1, 64)
		}
		return ""
	}
	newByID := map[string]int{}
	for i, s := range newWB {
		newByID[sheetID(s)] = i
	}
	reverted := 0
	for _, os := range oldWB {
		prot := ParseProtection(os["grownProtection"])
		if prot.Empty() {
			continue
		}
		idx, ok := newByID[sheetID(os)]
		if !ok {
			// A protected sheet was deleted: keep it unless the user could edit all of it.
			if prot.sheetLocked(e) || anyRangeLocked(prot, e) {
				newWB = append(newWB, os)
				reverted++
			}
			continue
		}
		ns := newWB[idx]
		// Protection items.
		merged := mergeProtection(prot, ParseProtection(ns["grownProtection"]), e)
		if !reflect.DeepEqual(merged, ParseProtection(ns["grownProtection"])) {
			if raw, err := json.Marshal(merged); err == nil {
				ns["grownProtection"] = raw
				reverted++
			}
		}
		// Cells (checked against the stored protections).
		oldCells, ok1 := decodeCells(os["celldata"])
		newCells, ok2 := decodeCells(ns["celldata"])
		if ok1 && ok2 {
			oldMap := map[string]cellEntry{}
			for _, c := range oldCells {
				oldMap[cellKey(c.R, c.C)] = c
			}
			newMap := map[string]int{}
			for i, c := range newCells {
				newMap[cellKey(c.R, c.C)] = i
			}
			changed := false
			out := make([]cellEntry, 0, len(newCells))
			for _, c := range newCells {
				k := cellKey(c.R, c.C)
				oc, had := oldMap[k]
				if prot.CanEditCell(c.R, c.C, e, had && cellUnlocked(oc.V)) || !cellsDiffer(oc.V, c.V) {
					out = append(out, c)
					continue
				}
				reverted++
				changed = true
				if had {
					out = append(out, oc)
				}
			}
			for _, oc := range oldCells {
				if _, still := newMap[cellKey(oc.R, oc.C)]; still {
					continue
				}
				if !prot.CanEditCell(oc.R, oc.C, e, cellUnlocked(oc.V)) && cellsDiffer(oc.V, nil) {
					out = append(out, oc)
					reverted++
					changed = true
				}
			}
			if changed {
				if raw, err := json.Marshal(out); err == nil {
					ns["celldata"] = raw
				}
			}
		}
		// On a sheet the user may not edit, sizes, merges, hidden rows and borders stay.
		if prot.sheetLocked(e) {
			for _, k := range []string{"config", "frozen"} {
				if !bytes.Equal(os[k], ns[k]) && !(len(os[k]) == 0 && len(ns[k]) == 0) {
					if len(os[k]) == 0 {
						delete(ns, k)
					} else {
						ns[k] = os[k]
					}
					reverted++
				}
			}
		}
	}
	if reverted == 0 {
		return next, 0
	}
	out, err := json.Marshal(newWB)
	if err != nil {
		return next, 0
	}
	return string(out), reverted
}

// StructureAllowed reports whether e may insert, delete or move rows, columns
// or cells on the sheet: not while any of its cells are protected against e.
func (p Protection) StructureAllowed(e Editor) bool {
	return e.isOwner() || (!p.sheetLocked(e) && !anyRangeLocked(p, e))
}

// WorkbookProtection returns the protection model of the sheet with the given
// id or name in a workbook JSON.
func WorkbookProtection(data, sheet string) Protection {
	if !strings.Contains(data, "grownProtection") {
		return Protection{}
	}
	var wb []map[string]json.RawMessage
	if json.Unmarshal([]byte(data), &wb) != nil {
		return Protection{}
	}
	for _, s := range wb {
		var name string
		_ = json.Unmarshal(s["name"], &name)
		if opSheetID(s["id"]) == sheet || name == sheet {
			return ParseProtection(s["grownProtection"])
		}
	}
	return Protection{}
}

func anyRangeLocked(p Protection, e Editor) bool {
	for _, r := range p.Ranges {
		if !listed(r.Users, r.By, e) {
			return true
		}
	}
	return false
}

// ---- collaboration ops --------------------------------------------------------------

// OpGuard filters FortuneSheet ops a user relays to collaborators against the
// protections of the stored workbook. Load returns the current stored
// workbook JSON (called at most once per Refresh interval by the hub).
type OpGuard struct {
	Editor Editor
	Load   func() (string, error)
	// MaxAge is how long loaded protections are trusted (default 3s).
	MaxAge time.Duration

	sheets map[string]Protection
	at     time.Time
}

// Refresh reloads the protections from storage.
func (g *OpGuard) Refresh() {
	g.sheets = map[string]Protection{}
	g.at = time.Now()
	if g.Load == nil {
		return
	}
	data, err := g.Load()
	if err != nil || !strings.Contains(data, "grownProtection") {
		return
	}
	var wb []map[string]json.RawMessage
	if json.Unmarshal([]byte(data), &wb) != nil {
		return
	}
	for _, s := range wb {
		var id interface{}
		_ = json.Unmarshal(s["id"], &id)
		key := ""
		switch v := id.(type) {
		case string:
			key = v
		case float64:
			key = strconv.FormatFloat(v, 'f', -1, 64)
		}
		if p := ParseProtection(s["grownProtection"]); !p.Empty() {
			g.sheets[key] = p
		}
	}
}

type fsOp struct {
	Op    string          `json:"op"`
	ID    json.RawMessage `json:"id"`
	Path  []interface{}   `json:"path"`
	Value json.RawMessage `json:"value"`
}

func opSheetID(raw json.RawMessage) string {
	var id interface{}
	if json.Unmarshal(raw, &id) != nil {
		return ""
	}
	switch v := id.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

func pathInt(p []interface{}, i int) (int, bool) {
	if i >= len(p) {
		return 0, false
	}
	switch v := p[i].(type) {
	case float64:
		return int(v), true
	case string:
		n, err := strconv.Atoi(v)
		return n, err == nil
	}
	return 0, false
}

// Filter returns msg (a JSON array of ops) without the ops the user may not
// make, and whether anything is left to relay. Presence and other non-array
// messages pass unchanged.
func (g *OpGuard) Filter(msg []byte) ([]byte, bool) {
	if g == nil || g.Editor.isOwner() {
		return msg, true
	}
	maxAge := g.MaxAge
	if maxAge == 0 {
		maxAge = 3 * time.Second
	}
	if g.sheets == nil || time.Since(g.at) > maxAge {
		g.Refresh()
	}
	if len(g.sheets) == 0 {
		return msg, true
	}
	t := bytes.TrimLeft(msg, " \t\r\n")
	if len(t) == 0 || t[0] != '[' {
		return msg, true
	}
	var ops []json.RawMessage
	if json.Unmarshal(msg, &ops) != nil {
		return msg, true
	}
	kept := make([]json.RawMessage, 0, len(ops))
	for _, raw := range ops {
		var op fsOp
		if json.Unmarshal(raw, &op) != nil {
			kept = append(kept, raw)
			continue
		}
		prot, ok := g.sheets[opSheetID(op.ID)]
		if !ok || g.allowed(prot, op) {
			kept = append(kept, raw)
		}
	}
	if len(kept) == len(ops) {
		return msg, true
	}
	if len(kept) == 0 {
		return nil, false
	}
	out, err := json.Marshal(kept)
	if err != nil {
		return nil, false
	}
	return out, true
}

func (g *OpGuard) allowed(p Protection, op fsOp) bool {
	e := g.Editor
	switch op.Op {
	case "insertRowCol", "deleteRowCol":
		// Structure changes move protected cells; only allowed when nothing is locked.
		return !p.sheetLocked(e) && !anyRangeLocked(p, e)
	case "deleteSheet":
		return !p.sheetLocked(e) && !anyRangeLocked(p, e)
	}
	if len(op.Path) == 0 {
		return true
	}
	head, _ := op.Path[0].(string)
	switch head {
	case "data":
		r, ok1 := pathInt(op.Path, 1)
		c, ok2 := pathInt(op.Path, 2)
		if !ok1 {
			return !p.sheetLocked(e) && !anyRangeLocked(p, e)
		}
		if !ok2 {
			// A whole row replaced.
			for _, pr := range p.Ranges {
				if listed(pr.Users, pr.By, e) {
					continue
				}
				for _, x := range pr.Ranges {
					if r >= minInt(x.R1, x.R2) && r <= maxInt(x.R1, x.R2) {
						return false
					}
				}
			}
			return !p.sheetLocked(e)
		}
		return p.CanEditCell(r, c, e, false)
	case "grownProtection":
		merged := mergeProtection(p, ParseProtection(op.Value), e)
		return reflect.DeepEqual(merged, ParseProtection(op.Value))
	case "config", "frozen":
		return !p.sheetLocked(e)
	}
	return true
}
