import { describe, expect, it } from "vitest";
import {
  SHEET_SHORTCUTS,
  arrayFormulaText,
  findShortcut,
  matchCombo,
  serialOf,
  stepFontSize,
  toggleReference,
} from "./sheetShortcuts";
import { proposeSum, type CellKind } from "./autoSum";

describe("sheet shortcut table", () => {
  it("matches combos by physical key and exact modifiers", () => {
    expect(matchCombo("Ctrl+Shift+1", { key: "!", code: "Digit1", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(matchCombo("Ctrl+Shift+1", { key: "1", code: "Digit1", ctrlKey: true })).toBe(false);
    expect(matchCombo("Ctrl+;", { key: ";", code: "Semicolon", metaKey: true })).toBe(true);
    expect(matchCombo("Ctrl+Shift+;", { key: ":", code: "Semicolon", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(matchCombo("Alt+=", { key: "=", code: "Equal", altKey: true })).toBe(true);
    expect(matchCombo("Alt+=", { key: "≠", code: "Equal", altKey: true })).toBe(true);
    expect(matchCombo("F4", { key: "F4", code: "F4" })).toBe(true);
    expect(matchCombo("Shift+F9", { key: "F9", code: "F9" })).toBe(false);
    expect(matchCombo("Ctrl+PageDown", { key: "PageDown", code: "PageDown", ctrlKey: true })).toBe(true);
    expect(matchCombo("Ctrl+Alt+M", { key: "µ", code: "KeyM", ctrlKey: true, altKey: true })).toBe(true);
    expect(matchCombo("Ctrl+/", { key: "/", code: "Slash", ctrlKey: true })).toBe(true);
  });

  it("finds a binding for its context only", () => {
    expect(findShortcut({ key: "F4", code: "F4" }, "editor")?.id).toBe("toggleRef");
    expect(findShortcut({ key: "F4", code: "F4" }, "grid")).toBeUndefined();
    expect(findShortcut({ key: "$", code: "Digit4", ctrlKey: true, shiftKey: true }, "grid")?.id).toBe("fmtCurrency");
    expect(findShortcut({ key: "c", code: "KeyC", ctrlKey: true }, "grid")).toBeUndefined(); // native
  });

  it("has unique ids and no combo bound twice in one context", () => {
    const ids = new Set(SHEET_SHORTCUTS.map((s) => s.id));
    expect(ids.size).toBe(SHEET_SHORTCUTS.length);
    const seen = new Map<string, string>();
    for (const s of SHEET_SHORTCUTS) {
      for (const k of s.keys) {
        for (const c of s.ctx === "any" ? ["grid", "editor"] : [s.ctx]) {
          const key = `${c}:${k}`;
          expect(seen.get(key), `${key} bound by ${seen.get(key)} and ${s.id}`).toBeUndefined();
          seen.set(key, s.id);
        }
      }
    }
  });
});

describe("F4 reference cycling", () => {
  it("oo:cell/shortcuts/shortcuts.js#Check switch reference of formula", () => {
    let t = { text: "=F4", caret: 3, selEnd: 3 };
    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      t = toggleReference(t.text, t.caret);
      seq.push(t.text);
    }
    expect(seq).toEqual(["=$F$4", "=F$4", "=$F4", "=F4"]);
  });

  it("cycles the reference under the caret and keeps the caret after it", () => {
    const r = toggleReference("=SUM(A1:B2)+C3", 6);
    expect(r.text).toBe("=SUM($A$1:B2)+C3");
    expect(r.caret).toBe(9);
    expect(toggleReference("=SUM(A1:B2)+C3", 14).text).toBe("=SUM(A1:B2)+$C$3");
    // A selection cycles every reference in it.
    expect(toggleReference("=A1+B2", 1, 6).text).toBe("=$A$1+$B$2");
    // Function names, sheet names and strings are not references.
    expect(toggleReference("=LOG10(2)", 6).text).toBe("=LOG10(2)");
    expect(toggleReference('="A1"&Sheet1!B2', 3).text).toBe('="A1"&Sheet1!B2');
    expect(toggleReference('="A1"&Sheet1!B2', 15).text).toBe('="A1"&Sheet1!$B$2');
  });
});

describe("AutoSum proposal", () => {
  const grid = (rows: unknown[][]) => (r: number, c: number): CellKind => {
    const v = rows[r]?.[c];
    if (v === undefined || v === null || v === "") return "empty";
    if (typeof v === "number") return "num";
    return v === "SUM" ? "sum" : "text";
  };
  it("takes the numbers above (blanks between included), else to the left", () => {
    expect(proposeSum(grid([[1], [2], [3], []]), 3, 0)).toBe("A1:A3");
    expect(proposeSum(grid([["Head"], [2], [3], [], []]), 4, 0)).toBe("A2:A4");
    expect(proposeSum(grid([[1, 2, 3, null]]), 0, 3)).toBe("A1:C1");
    expect(proposeSum(grid([[1, null, null, null]]), 0, 3)).toBe("A1:C1");
    expect(proposeSum(grid([[], []]), 1, 0)).toBe("");
    // Far from the data (the shortcuts suite's H8) there is nothing to propose.
    expect(proposeSum(grid([[1, 2]]), 7, 7)).toBe("");
    // A subtotal ends the run.
    expect(proposeSum(grid([[1], [2], ["SUM"], [4], []]), 4, 0)).toBe("A3:A4");
  });
});

describe("font size steps", () => {
  it("walks the size list and stops at both ends", () => {
    const up: number[] = [];
    let s = 11;
    for (let i = 0; i < 13; i++) up.push((s = stepFontSize(s, 1)));
    expect(up).toEqual([12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72, 72]);
    const down: number[] = [];
    for (let i = 0; i < 16; i++) down.push((s = stepFontSize(s, -1)));
    expect(down).toEqual([48, 36, 28, 26, 24, 22, 20, 18, 16, 14, 12, 11, 10, 9, 8, 8]);
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
  });
});

describe("date serials", () => {
  it("counts days from 1899-12-30", () => {
    expect(serialOf(new Date(2026, 8, 26))).toBe(46291);
    expect(serialOf(new Date(2026, 8, 26, 12, 0, 0))).toBe(46291.5);
  });
});

describe("Ctrl+Shift+Enter", () => {
  it("wraps a formula once in ARRAYFORMULA", () => {
    expect(arrayFormulaText("=A1:A3*2")).toBe("=ARRAYFORMULA(A1:A3*2)");
    expect(arrayFormulaText("=ARRAYFORMULA(A1)")).toBe("=ARRAYFORMULA(A1)");
    expect(arrayFormulaText("text")).toBe("text");
  });
});
