package sheets

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	grownv1 "code.pick.haus/grown/grown/gen/go/grown/v1"
)

// A two-sheet workbook: Sheet1 has a protected range B2:B3 (alice may edit)
// and A1 = 1; Locked is a protected sheet whose A2:A3 are left editable and
// whose C1 has an unlocked format.
const protWorkbook = `[
 {"name":"Sheet1","id":"s1","celldata":[
   {"r":0,"c":0,"v":{"v":1,"m":"1"}},
   {"r":1,"c":1,"v":{"v":10,"m":"10"}},
   {"r":2,"c":1,"v":{"f":"=A1*2","v":2,"m":"2"}}],
  "grownProtection":{"sheet":null,"ranges":[{"id":"p1","name":"Totals","ranges":[{"r1":1,"c1":1,"r2":2,"c2":1}],"users":["alice"],"by":"carol"}]}},
 {"name":"Locked","id":"s2","celldata":[
   {"r":0,"c":0,"v":{"v":"title","m":"title"}},
   {"r":0,"c":2,"v":{"v":"free","m":"free","lo":0}}],
  "config":{"columnlen":{"0":100}},
  "grownProtection":{"sheet":{"users":[],"by":"carol","except":[{"r1":1,"c1":0,"r2":2,"c2":0}]},"ranges":[]}}
]`

func mustSheets(t *testing.T, data string) []map[string]json.RawMessage {
	t.Helper()
	var wb []map[string]json.RawMessage
	if err := json.Unmarshal([]byte(data), &wb); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return wb
}

func cellOf(t *testing.T, data, sheetID string, r, c int) map[string]interface{} {
	t.Helper()
	for _, s := range mustSheets(t, data) {
		if opSheetID(s["id"]) != sheetID {
			continue
		}
		cells, _ := decodeCells(s["celldata"])
		for _, x := range cells {
			if x.R == r && x.C == c {
				var m map[string]interface{}
				_ = json.Unmarshal(x.V, &m)
				return m
			}
		}
	}
	return nil
}

// edit returns protWorkbook with cell (r, c) of sheet id set to v (nil deletes it).
func edit(t *testing.T, data, sheetID string, r, c int, v interface{}) string {
	t.Helper()
	wb := mustSheets(t, data)
	for _, s := range wb {
		if opSheetID(s["id"]) != sheetID {
			continue
		}
		cells, _ := decodeCells(s["celldata"])
		out := []cellEntry{}
		found := false
		for _, x := range cells {
			if x.R == r && x.C == c {
				found = true
				if v == nil {
					continue
				}
				raw, _ := json.Marshal(v)
				x.V = raw
			}
			out = append(out, x)
		}
		if !found && v != nil {
			raw, _ := json.Marshal(v)
			out = append(out, cellEntry{R: r, C: c, V: raw})
		}
		raw, _ := json.Marshal(out)
		s["celldata"] = raw
	}
	b, _ := json.Marshal(wb)
	return string(b)
}

func TestProtectionCanEditCell(t *testing.T) {
	wb := mustSheets(t, protWorkbook)
	p1 := ParseProtection(wb[0]["grownProtection"])
	p2 := ParseProtection(wb[1]["grownProtection"])
	bob := Editor{User: "bob", Owner: "olga"}
	alice := Editor{User: "alice", Owner: "olga"}
	carol := Editor{User: "carol", Owner: "olga"}
	owner := Editor{User: "olga", Owner: "olga"}
	cases := []struct {
		name     string
		p        Protection
		r, c     int
		e        Editor
		unlocked bool
		want     bool
	}{
		{"outside the range", p1, 0, 0, bob, false, true},
		{"range, not listed", p1, 1, 1, bob, false, false},
		{"range, listed user", p1, 2, 1, alice, false, true},
		{"range, author", p1, 1, 1, carol, false, true},
		{"range, owner", p1, 1, 1, owner, false, true},
		{"locked sheet cell", p2, 0, 0, bob, false, false},
		{"locked sheet, except range", p2, 1, 0, bob, false, true},
		{"locked sheet, unlocked format", p2, 0, 2, bob, true, true},
		{"locked sheet, author", p2, 0, 0, carol, false, true},
	}
	for _, tc := range cases {
		if got := tc.p.CanEditCell(tc.r, tc.c, tc.e, tc.unlocked); got != tc.want {
			t.Errorf("%s: CanEditCell = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestEnforceProtectionRevertsBlockedCells(t *testing.T) {
	bob := Editor{User: "bob", Owner: "olga"}
	next := edit(t, protWorkbook, "s1", 1, 1, map[string]interface{}{"v": 99, "m": "99"}) // protected
	next = edit(t, next, "s1", 0, 0, map[string]interface{}{"v": 5, "m": "5"})             // free
	next = edit(t, next, "s1", 2, 1, nil)                                                   // protected delete
	next = edit(t, next, "s2", 0, 0, map[string]interface{}{"v": "hacked"})                 // locked sheet
	next = edit(t, next, "s2", 1, 0, map[string]interface{}{"v": "ok"})                     // except range
	next = edit(t, next, "s2", 0, 2, map[string]interface{}{"v": "also ok", "lo": 0})       // unlocked cell
	out, n := EnforceProtection(protWorkbook, next, bob)
	if n != 3 {
		t.Errorf("reverted %d changes, want 3", n)
	}
	if got := cellOf(t, out, "s1", 1, 1)["v"]; got != float64(10) {
		t.Errorf("protected B2 = %v, want 10 (reverted)", got)
	}
	if got := cellOf(t, out, "s1", 0, 0)["v"]; got != float64(5) {
		t.Errorf("free A1 = %v, want 5", got)
	}
	if got := cellOf(t, out, "s1", 2, 1)["f"]; got != "=A1*2" {
		t.Errorf("deleted protected B3 = %v, want restored", got)
	}
	if got := cellOf(t, out, "s2", 0, 0)["v"]; got != "title" {
		t.Errorf("locked sheet A1 = %v, want title", got)
	}
	if got := cellOf(t, out, "s2", 1, 0)["v"]; got != "ok" {
		t.Errorf("except-range A2 = %v, want ok", got)
	}
	if got := cellOf(t, out, "s2", 0, 2)["v"]; got != "also ok" {
		t.Errorf("unlocked C1 = %v, want also ok", got)
	}
}

func TestEnforceProtectionLetsListedUsersAndOwnerEdit(t *testing.T) {
	next := edit(t, protWorkbook, "s1", 1, 1, map[string]interface{}{"v": 42})
	for _, e := range []Editor{{User: "alice", Owner: "olga"}, {User: "carol", Owner: "olga"}, {User: "olga", Owner: "olga"}} {
		out, n := EnforceProtection(protWorkbook, next, e)
		if n != 0 || cellOf(t, out, "s1", 1, 1)["v"] != float64(42) {
			t.Errorf("%s: reverted %d, B2 = %v; want the edit kept", e.User, n, cellOf(t, out, "s1", 1, 1)["v"])
		}
	}
}

func TestEnforceProtectionIgnoresRecomputedValues(t *testing.T) {
	// A changed cached value of an unchanged formula is not an edit.
	next := edit(t, protWorkbook, "s1", 2, 1, map[string]interface{}{"f": "=A1*2", "v": 10, "m": "10"})
	if _, n := EnforceProtection(protWorkbook, next, Editor{User: "bob", Owner: "olga"}); n != 0 {
		t.Errorf("reverted %d, want 0", n)
	}
}

func TestEnforceProtectionKeepsProtectionItems(t *testing.T) {
	bob := Editor{User: "bob", Owner: "olga"}
	wb := mustSheets(t, protWorkbook)
	// Bob removes the range he may not manage, unprotects the sheet and adds his own range.
	wb[0]["grownProtection"] = json.RawMessage(`{"sheet":null,"ranges":[{"id":"mine","name":"Bob","ranges":[{"r1":5,"c1":5,"r2":5,"c2":5}],"users":[]}]}`)
	wb[1]["grownProtection"] = json.RawMessage(`{"sheet":null,"ranges":[]}`)
	b, _ := json.Marshal(wb)
	out, n := EnforceProtection(protWorkbook, string(b), bob)
	if n != 2 {
		t.Errorf("reverted %d, want 2", n)
	}
	got := mustSheets(t, out)
	p1 := ParseProtection(got[0]["grownProtection"])
	if len(p1.Ranges) != 2 || p1.Ranges[0].ID != "p1" || p1.Ranges[1].ID != "mine" || p1.Ranges[1].By != "bob" {
		t.Errorf("Sheet1 protection = %+v, want p1 kept and bob's range added (by bob)", p1)
	}
	if p2 := ParseProtection(got[1]["grownProtection"]); p2.Sheet == nil || p2.Sheet.By != "carol" {
		t.Errorf("Locked protection = %+v, want the sheet still protected", p2)
	}
	// Alice (listed on p1) may remove it.
	wb = mustSheets(t, protWorkbook)
	wb[0]["grownProtection"] = json.RawMessage(`{"sheet":null,"ranges":[]}`)
	b, _ = json.Marshal(wb)
	out, _ = EnforceProtection(protWorkbook, string(b), Editor{User: "alice", Owner: "olga"})
	if p := ParseProtection(mustSheets(t, out)[0]["grownProtection"]); len(p.Ranges) != 0 {
		t.Errorf("alice could not remove the range: %+v", p)
	}
}

func TestEnforceProtectionRestoresDeletedSheetAndConfig(t *testing.T) {
	bob := Editor{User: "bob", Owner: "olga"}
	wb := mustSheets(t, protWorkbook)
	wb[0]["config"] = json.RawMessage(`{"columnlen":{"0":300}}`) // Sheet1 isn't sheet-locked: allowed
	only := []map[string]json.RawMessage{wb[0]}                   // Locked deleted
	b, _ := json.Marshal(only)
	out, n := EnforceProtection(protWorkbook, string(b), bob)
	got := mustSheets(t, out)
	if n != 1 || len(got) != 2 || opSheetID(got[1]["id"]) != "s2" {
		t.Fatalf("deleted protected sheet not restored: n=%d sheets=%d", n, len(got))
	}
	if !strings.Contains(string(got[0]["config"]), "300") {
		t.Errorf("Sheet1 column width change was reverted: %s", got[0]["config"])
	}
	// Column widths on the locked sheet stay.
	wb = mustSheets(t, protWorkbook)
	wb[1]["config"] = json.RawMessage(`{"columnlen":{"0":10}}`)
	b, _ = json.Marshal(wb)
	out, _ = EnforceProtection(protWorkbook, string(b), bob)
	if got := string(mustSheets(t, out)[1]["config"]); !strings.Contains(got, "100") {
		t.Errorf("locked sheet config = %s, want the stored widths", got)
	}
}

func TestEnforceProtectionPassThrough(t *testing.T) {
	plain := `[{"name":"S","id":"1","celldata":[{"r":0,"c":0,"v":{"v":1}}]}]`
	next := `[{"name":"S","id":"1","celldata":[{"r":0,"c":0,"v":{"v":2}}]}]`
	if out, n := EnforceProtection(plain, next, Editor{User: "bob"}); out != next || n != 0 {
		t.Errorf("unprotected workbook changed: %s (%d)", out, n)
	}
	if out, n := EnforceProtection(protWorkbook, "not json", Editor{User: "bob"}); out != "not json" || n != 0 {
		t.Errorf("garbage input changed: %s", out)
	}
}

func TestOpGuardFilter(t *testing.T) {
	g := &OpGuard{Editor: Editor{User: "bob", Owner: "olga"}, Load: func() (string, error) { return protWorkbook, nil }}
	msg := `[{"op":"replace","id":"s1","path":["data",1,1],"value":{"v":1}},{"op":"replace","id":"s1","path":["data",0,0,"v"],"value":3}]`
	out, ok := g.Filter([]byte(msg))
	if !ok || strings.Contains(string(out), `"data",1,1`) || !strings.Contains(string(out), `"data",0,0`) {
		t.Errorf("Filter = %s, %v; want only the A1 op", out, ok)
	}
	if _, ok := g.Filter([]byte(`[{"op":"replace","id":"s2","path":["data",0,0],"value":{"v":1}}]`)); ok {
		t.Error("an op on a locked sheet cell was relayed")
	}
	if _, ok := g.Filter([]byte(`[{"op":"insertRowCol","id":"s1","path":[],"value":{}}]`)); ok {
		t.Error("a row insert on a sheet with protected cells was relayed")
	}
	if _, ok := g.Filter([]byte(`[{"op":"replace","id":"s1","path":["grownProtection"],"value":{"sheet":null,"ranges":[]}}]`)); ok {
		t.Error("removing a protection bob may not manage was relayed")
	}
	if out, ok := g.Filter([]byte(`{"type":"presence"}`)); !ok || string(out) != `{"type":"presence"}` {
		t.Error("presence was filtered")
	}
	alice := &OpGuard{Editor: Editor{User: "alice", Owner: "olga"}, Load: g.Load}
	if _, ok := alice.Filter([]byte(msg)); !ok {
		t.Error("alice's edit of her range was dropped")
	}
}

func TestStructureAllowed(t *testing.T) {
	p := WorkbookProtection(protWorkbook, "Sheet1")
	if p.StructureAllowed(Editor{User: "bob", Owner: "olga"}) {
		t.Error("bob may restructure a sheet with a range he cannot edit")
	}
	if !p.StructureAllowed(Editor{User: "alice", Owner: "olga"}) {
		t.Error("alice is listed on every range")
	}
	if !WorkbookProtection(protWorkbook, "Nope").StructureAllowed(Editor{User: "bob"}) {
		t.Error("an unknown sheet has no protection")
	}
}

// TestSaveSheetEnforcesProtection runs the real SaveSheet path against a
// database: another org member's edit of a protected cell is undone.
func TestSaveSheetEnforcesProtection(t *testing.T) {
	pool, orgID, owner := setupDB(t)
	svc := NewService(NewRepository(pool))
	var bob string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO grown.users (org_id, oidc_issuer, oidc_subject, email, display_name)
		 VALUES ($1,'test','subject-bob','bob@grown.localtest.me','Bob') RETURNING id::text`, orgID).Scan(&bob); err != nil {
		t.Fatalf("seed bob: %v", err)
	}
	ownerCtx := authCtx(orgID, owner)
	sh, err := svc.CreateSheet(ownerCtx, &grownv1.CreateSheetRequest{Title: "Protected"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveSheet(ownerCtx, &grownv1.SaveSheetRequest{Id: sh.GetId(), Data: protWorkbook}); err != nil {
		t.Fatal(err)
	}
	bobCtx := authCtx(orgID, bob)
	next := edit(t, protWorkbook, "s1", 1, 1, map[string]interface{}{"v": 99})
	next = edit(t, next, "s1", 0, 0, map[string]interface{}{"v": 7})
	if _, err := svc.SaveSheet(bobCtx, &grownv1.SaveSheetRequest{Id: sh.GetId(), Data: next}); err != nil {
		t.Fatal(err)
	}
	got, err := svc.GetSheet(ownerCtx, &grownv1.GetSheetRequest{Id: sh.GetId()})
	if err != nil {
		t.Fatal(err)
	}
	if v := cellOf(t, got.GetData(), "s1", 1, 1)["v"]; v != float64(10) {
		t.Errorf("B2 after bob's save = %v, want 10", v)
	}
	if v := cellOf(t, got.GetData(), "s1", 0, 0)["v"]; v != float64(7) {
		t.Errorf("A1 after bob's save = %v, want 7", v)
	}
	// B3 = A1*2 is recomputed from the new A1 even though it is protected.
	if v := cellOf(t, got.GetData(), "s1", 2, 1)["v"]; v != float64(14) {
		t.Errorf("B3 = %v, want 14", v)
	}
	// The owner may edit anything.
	if _, err := svc.SaveSheet(ownerCtx, &grownv1.SaveSheetRequest{Id: sh.GetId(), Data: edit(t, got.GetData(), "s1", 1, 1, map[string]interface{}{"v": 1})}); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.GetSheet(ownerCtx, &grownv1.GetSheetRequest{Id: sh.GetId()})
	if v := cellOf(t, got.GetData(), "s1", 1, 1)["v"]; v != float64(1) {
		t.Errorf("owner edit of B2 = %v, want 1", v)
	}
}
