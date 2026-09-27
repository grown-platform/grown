import { describe, expect, it } from "vitest";
import type { CellRect } from "../cellRange";
import { MAX_COLS, MAX_ROWS, type StructureOp } from "../formulaShift";
import {
  addProtectedRange,
  canChangeRowsCols,
  canChangeStructure,
  canEditCell,
  canFormat,
  canMoveCells,
  changeProtectedRange,
  deleteProtectedRanges,
  emptyProtection,
  moveProtectedCells,
  protectedRangeRef,
  shiftProtection,
  validRangeName,
  type EditContext,
  type ProtectionModel,
} from "../protection";

// Ports of OnlyOffice's ProtectTests.js and UserProtectedRangesTest.js onto
// Grown's protection model (protection.ts). OnlyOffice's undo/redo history is
// modelled by keeping the model states; OnlyOffice re-appends a range whose
// deletion is undone at the end of its list, so the manipulation checks look
// ranges up by name instead of by index.

const A1 = (a1: string): CellRect => {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1)!;
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { c1: col(m[1]), r1: Number(m[2]) - 1, c2: col(m[3]), r2: Number(m[4]) - 1 };
};

/** Undo/redo over immutable states. */
class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public state: T) {}
  apply(f: (s: T) => T | null): boolean {
    const next = f(this.state);
    if (next === null) return false;
    this.past.push(this.state);
    this.future = [];
    this.state = next;
    return true;
  }
  undo() {
    const p = this.past.pop();
    if (p !== undefined) {
      this.future.push(this.state);
      this.state = p;
    }
  }
  redo() {
    const n = this.future.pop();
    if (n !== undefined) {
      this.past.push(this.state);
      this.state = n;
    }
  }
  get length() {
    return this.past.length;
  }
}

const refOf = (m: ProtectionModel, i: number) => protectedRangeRef("Sheet1", m.ranges[i]);
const refByName = (m: ProtectionModel, name: string) => {
  const pr = m.ranges.find((r) => r.name === name);
  return pr ? protectedRangeRef("Sheet1", pr) : null;
};

describe("sheets parity: protection", () => {
  it("oo:cell/spreadsheet-calculation/ProtectTests.js#Test: check valid title name", () => {
    for (const ok of ["test", "test1", "test_1", "test_ 1", "test _ 1", "t test"]) expect(validRangeName(ok), ok).toBe(true);
    for (const bad of ["test!", "1test"]) expect(validRangeName(bad), bad).toBe(false);
  });

  it("oo:cell/spreadsheet-calculation/UserProtectedRangesTest.js#Test: create", () => {
    const h = new History<ProtectionModel>(emptyProtection());
    const create = (ref: string, name: string) => h.apply((m) => addProtectedRange(m, { name, ranges: [A1(ref)], users: ["user3"] }));
    create("B2:B5", "test");
    h.undo();
    expect(h.state.ranges.length).toBe(0);
    h.redo();
    expect(h.state.ranges[0].name).toBe("test");
    expect(refOf(h.state, 0)).toBe("=Sheet1!$B$2:$B$5");

    create("D2:E5", "test2");
    expect(h.state.ranges.length).toBe(2);
    expect(h.state.ranges[1].name).toBe("test2");
    expect(refOf(h.state, 1)).toBe("=Sheet1!$D$2:$E$5");
    h.undo();
    h.undo();
    expect(h.state.ranges.length).toBe(0);
    h.redo();
    h.redo();
    expect(h.state.ranges.length).toBe(2);

    h.apply((m) => deleteProtectedRanges(m, [m.ranges[0].id]));
    expect(h.state.ranges.length).toBe(1);
    expect(refOf(h.state, 0)).toBe("=Sheet1!$D$2:$E$5");
    h.undo();
    expect(h.state.ranges.length).toBe(2);
    h.redo();
    expect(h.state.ranges.length).toBe(1);
    h.undo();
    expect(h.state.ranges.length).toBe(2);

    h.apply((m) => deleteProtectedRanges(m, m.ranges.map((r) => r.id)));
    expect(h.state.ranges.length).toBe(0);
    h.undo();
    expect(h.state.ranges.length).toBe(2);
    h.redo();
    expect(h.state.ranges.length).toBe(0);
  });

  it("oo:cell/spreadsheet-calculation/UserProtectedRangesTest.js#Test: change", () => {
    const h = new History<ProtectionModel>(emptyProtection());
    h.apply((m) => addProtectedRange(m, { name: "test1", ranges: [A1("B2:B5")], users: ["user3"] }));
    const id = h.state.ranges[0].id;
    h.apply((m) => changeProtectedRange(m, id, { ranges: [A1("B2:B10")] }));
    expect(refOf(h.state, 0)).toBe("=Sheet1!$B$2:$B$10");
    h.undo();
    expect(refOf(h.state, 0)).toBe("=Sheet1!$B$2:$B$5");
    h.redo();
    expect(refOf(h.state, 0)).toBe("=Sheet1!$B$2:$B$10");

    h.apply((m) => changeProtectedRange(m, id, { name: "test2" }));
    expect(h.state.ranges[0].name).toBe("test2");
    h.undo();
    expect(h.state.ranges[0].name).toBe("test1");
    h.redo();
    expect(h.state.ranges[0].name).toBe("test2");

    h.apply((m) => deleteProtectedRanges(m, [id]));
    expect(h.state.ranges.length).toBe(0);
  });

  it("oo:cell/spreadsheet-calculation/UserProtectedRangesTest.js#Test: change (range manipulation)", () => {
    let m = emptyProtection();
    m = addProtectedRange(m, { name: "test1", ranges: [A1("B2:B5")], users: ["user3"] });
    m = addProtectedRange(m, { name: "test2", ranges: [A1("D2:E5")], users: ["user3"] });
    const h = new History<ProtectionModel>(m);
    const ctx: EditContext = { user: "user3" };
    const before = (desc: string) => {
      expect(refByName(h.state, "test1"), desc).toBe("=Sheet1!$B$2:$B$5");
      expect(refByName(h.state, "test2"), desc).toBe("=Sheet1!$D$2:$E$5");
    };
    const step = (desc: string, op: StructureOp, after: (d: string) => void) => {
      expect(h.apply((s) => (canChangeStructure(s, op, ctx) ? shiftProtection(s, op) : null)), desc).toBe(true);
      after("after_" + desc);
      h.undo();
      before("undo_" + desc);
      h.redo();
      after("redo_" + desc);
      h.undo();
    };
    const refs = (t1: string | null, t2: string | null) => (d: string) => {
      expect(refByName(h.state, "test1"), d).toBe(t1);
      expect(refByName(h.state, "test2"), d).toBe(t2);
    };
    const S = "Sheet1";
    step("insert_1", { kind: "insert", axis: "col", sheet: S, index: 0, count: 1 }, refs("=Sheet1!$C$2:$C$5", "=Sheet1!$E$2:$F$5"));
    step("insert_2", { kind: "insert", axis: "col", sheet: S, index: 4, count: 1 }, refs("=Sheet1!$B$2:$B$5", "=Sheet1!$D$2:$F$5"));
    step("insert_3", { kind: "insertCells", sheet: S, rect: A1("A2:C5"), shift: "right" }, refs("=Sheet1!$E$2:$E$5", "=Sheet1!$G$2:$H$5"));
    step("insert_4", { kind: "insertCells", sheet: S, rect: A1("A2:C4"), shift: "right" }, refs("=Sheet1!$B$2:$B$5", "=Sheet1!$D$2:$E$5"));
    step("insert_5", { kind: "insertCells", sheet: S, rect: A1("A1:D1"), shift: "down" }, refs("=Sheet1!$B$3:$B$6", "=Sheet1!$D$2:$E$5"));
    step("delete_1", { kind: "delete", axis: "col", sheet: S, index: 1, count: 3 }, (d) => {
      expect(h.state.ranges.length, d).toBe(1);
      expect(refOf(h.state, 0), d).toBe("=Sheet1!$B$2:$B$5");
    });
    step("delete_2", { kind: "deleteCells", sheet: S, rect: A1("A2:C5"), shift: "left" }, (d) => {
      expect(h.state.ranges.length, d).toBe(1);
      expect(refOf(h.state, 0), d).toBe("=Sheet1!$A$2:$B$5");
    });
    step("delete_3", { kind: "deleteCells", sheet: S, rect: A1("A1:D1"), shift: "up" }, refs("=Sheet1!$B$1:$B$4", "=Sheet1!$D$2:$E$5"));
    step("delete_4", { kind: "deleteCells", sheet: S, rect: A1("A1:G11"), shift: "up" }, (d) => expect(h.state.ranges.length, d).toBe(0));
    step("delete_5", { kind: "delete", axis: "col", sheet: S, index: 0, count: 7 }, (d) => expect(h.state.ranges.length, d).toBe(0));
    step("delete_6", { kind: "delete", axis: "col", sheet: S, index: 0, count: 7 }, (d) => expect(h.state.ranges.length, d).toBe(0));

    // Moving D2:E5 to D10:E13 takes the range with it; copying adds a protected copy.
    h.apply((s) => (canMoveCells(s, A1("D2:E5"), { r: 9, c: 3 }, ctx) ? moveProtectedCells(s, A1("D2:E5"), { r: 9, c: 3 }) : null));
    expect(refByName(h.state, "test1")).toBe("=Sheet1!$B$2:$B$5");
    expect(refByName(h.state, "test2")).toBe("=Sheet1!$D$10:$E$13");
    h.undo();
    before("undo_move_1");
    h.redo();
    h.undo();
    h.apply((s) => moveProtectedCells(s, A1("D2:E5"), { r: 9, c: 3 }, true));
    expect(h.state.ranges.length).toBe(3);
    expect(h.state.ranges.map((r) => protectedRangeRef("Sheet1", r)).sort()).toEqual(
      ["=Sheet1!$B$2:$B$5", "=Sheet1!$D$10:$E$13", "=Sheet1!$D$2:$E$5"],
    );
    h.undo();
    before("undo_move_2");
  });

  it("oo:cell/spreadsheet-calculation/UserProtectedRangesTest.js#Test: change_protect", () => {
    let m = emptyProtection();
    m = addProtectedRange(m, { name: "test1", ranges: [A1("B2:B5")], users: ["user1"] });
    m = addProtectedRange(m, { name: "test2", ranges: [A1("D2:E5")], users: ["user2"] });
    const h = new History<ProtectionModel>(m);
    const ctx: EditContext = { user: "someone-else" };
    const unchanged = (desc: string) => {
      expect(refOf(h.state, 0), desc).toBe("=Sheet1!$B$2:$B$5");
      expect(refOf(h.state, 1), desc).toBe("=Sheet1!$D$2:$E$5");
    };
    const tryOp = (desc: string, op: StructureOp) => {
      h.apply((s) => (canChangeStructure(s, op, ctx) ? shiftProtection(s, op) : null));
      unchanged(desc);
    };
    const S = "Sheet1";
    const colE = A1("E1:E6");
    tryOp("check_insert_1", { kind: "insert", axis: "col", sheet: S, index: 4, count: 1 });
    tryOp("check_insert_2", { kind: "insertCells", sheet: S, rect: colE, shift: "right" });
    tryOp("check_insert_3", { kind: "insertCells", sheet: S, rect: colE, shift: "down" });
    tryOp("check_insert_4", { kind: "insert", axis: "row", sheet: S, index: 0, count: MAX_ROWS });
    tryOp("check_delete_1", { kind: "delete", axis: "col", sheet: S, index: 4, count: 1 });
    tryOp("check_delete_2", { kind: "deleteCells", sheet: S, rect: colE, shift: "left" });
    tryOp("check_delete_3", { kind: "deleteCells", sheet: S, rect: colE, shift: "up" });
    tryOp("check_delete_4", { kind: "delete", axis: "row", sheet: S, index: 0, count: MAX_ROWS });

    // Nothing below may reach the history.
    const points = h.length;
    const rowsOfSelection: [number, number] = [3, MAX_ROWS - 1]; // E4:E1048576
    for (const [i, axis] of ([["colWidth", "col"], ["showCols", "col"], ["hideCols", "col"], ["groupCols", "col"]] as const).entries()) {
      expect(canChangeRowsCols(h.state, axis, 4, 4, ctx), `history_test_${i + 1}`).toBe(false);
    }
    for (const [i, axis] of ([["rowHeight", "row"], ["showRows", "row"], ["hideRows", "row"], ["groupRows", "row"]] as const).entries()) {
      expect(canChangeRowsCols(h.state, axis, rowsOfSelection[0], rowsOfSelection[1], ctx), `history_test_${i + 5}`).toBe(false);
    }
    // Clear outline touches every row and column.
    expect(canChangeRowsCols(h.state, "col", 0, MAX_COLS - 1, ctx), "history_test_9").toBe(false);
    // Typing =SUM(...) into E3:E4, and bold/italic/underline/strike/superscript/font size there.
    expect(canEditCell(h.state, 2, 4, ctx), "history_test_11").toBe(false);
    expect(canEditCell(h.state, 3, 4, ctx), "history_test_11").toBe(false);
    for (const attr of ["bold", "italic", "underline", "strike", "superscript", "fontSize"]) {
      expect(canFormat(h.state, A1("E3:E4"), ctx), attr).toBe(false);
    }
    // Moving the protected block.
    expect(canMoveCells(h.state, A1("D2:E5"), { r: 9, c: 3 }, ctx), "history_test_16").toBe(false);
    expect(h.length).toBe(points);
    // A listed user is not blocked.
    expect(canEditCell(h.state, 2, 4, { user: "user2" })).toBe(true);
    expect(canEditCell(h.state, 2, 1, { user: "user2" })).toBe(false);
  });
});
