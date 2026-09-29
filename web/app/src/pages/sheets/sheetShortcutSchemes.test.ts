import { describe, expect, it } from "vitest";
import { SHEET_SHORTCUTS, findShortcut, keysFor, sheetShortcuts, shortcutHint, type KeyLike } from "./sheetShortcuts";
import { spanIndices, structureTarget, wholeSpan } from "./sheetKeyActions";
import { SHORTCUT_SCHEMES, type ShortcutScheme } from "../../lib/shortcutScheme";

/** A key event for a combo as sheetShortcuts writes it ("Ctrl+Alt+=", "Shift+Space"). */
function ev(combo: string, mac = false): KeyLike {
  const parts = combo.split("+");
  const key = parts.pop() || "+";
  const mods = new Set(parts);
  const CODES: Record<string, string> = { "=": "Equal", "-": "Minus", ".": "Period", ",": "Comma", "\\": "Backslash", "`": "Backquote", ";": "Semicolon", "/": "Slash" };
  const code = /^[A-Z]$/i.test(key)
    ? `Key${key.toUpperCase()}`
    : /^[0-9]$/.test(key)
      ? `Digit${key}`
      : key === "Space"
        ? "Space"
        : (CODES[key] ?? key);
  return {
    // Shift/Alt change the character; matching must go by the physical key.
    key: key === "Space" ? " " : mods.has("Alt") ? "∆" : key,
    code,
    ctrlKey: mods.has("Ctrl") && !mac,
    metaKey: mods.has("Ctrl") && mac,
    altKey: mods.has("Alt"),
    shiftKey: mods.has("Shift"),
  };
}
const grid = (combo: string, scheme: ShortcutScheme, mac = false) => findShortcut(ev(combo, mac), "grid", scheme)?.id;

describe("sheet shortcut schemes", () => {
  it.each(SHORTCUT_SCHEMES)("%s: every listed action has a binding, no combo twice per context", (scheme) => {
    const table = sheetShortcuts(scheme);
    expect(table.length).toBeGreaterThan(40);
    const seen = new Map<string, string>();
    for (const s of table) {
      expect(s.keys.length, s.id).toBeGreaterThan(0);
      for (const k of s.keys) {
        for (const c of s.ctx === "any" ? ["grid", "editor"] : [s.ctx]) {
          const key = `${c}:${k}`;
          expect(seen.get(key), `${key} bound by ${seen.get(key)} and ${s.id}`).toBeUndefined();
          seen.set(key, s.id);
        }
      }
    }
  });

  it("the default scheme is office and keeps every existing binding", () => {
    expect(findShortcut(ev("Ctrl+5"), "grid")?.id).toBe("strikethrough");
    const office = sheetShortcuts("office");
    for (const s of SHEET_SHORTCUTS.filter((d) => d.keys.length)) {
      expect(office.find((o) => o.id === s.id)?.keys).toEqual(s.keys);
    }
  });

  it("a binding without a google override is the same in both schemes", () => {
    for (const s of SHEET_SHORTCUTS.filter((d) => !d.google)) expect(keysFor(s, "google")).toEqual(s.keys);
  });

  it.each([
    // [combo, office action, google action]
    ["Ctrl+5", "strikethrough", undefined],
    ["Alt+Shift+5", "strikethrough", "strikethrough"],
    ["Ctrl+Shift+V", "pasteValues", "pasteValues"],
    ["Ctrl+Alt+V", "pasteSpecial", undefined],
    ["Ctrl+1", "formatCells", undefined],
    ["Ctrl+Shift+=", "insertRowsCols", undefined],
    ["Ctrl+Alt+=", undefined, "insertRowsCols"],
    ["Ctrl+-", "deleteRowsCols", undefined],
    ["Ctrl+Alt+-", undefined, "deleteRowsCols"],
    ["Ctrl+9", "hideRows", undefined],
    ["Ctrl+0", "hideCols", undefined],
    ["Ctrl+Alt+9", undefined, "hideRows"],
    ["Ctrl+Alt+0", undefined, "hideCols"],
    ["Ctrl+Shift+9", "unhideRows", "unhideRows"],
    ["Ctrl+Shift+0", "unhideCols", "unhideCols"],
    ["Ctrl+Shift+L", "filter", "alignLeft"],
    ["Ctrl+Shift+E", undefined, "alignCenter"],
    ["Ctrl+Shift+R", "tableTotals", "alignRight"],
    ["Ctrl+Alt+M", "comment", "comment"],
    ["Shift+F2", "comment", "comment"],
    ["Ctrl+Space", "selectCol", "selectCol"],
    ["Shift+Space", "selectRow", "selectRow"],
    ["Ctrl+D", "fillDown", "fillDown"],
    ["Ctrl+R", "fillRight", "fillRight"],
    ["Ctrl+L", "insertTable", undefined],
    ["Ctrl+Alt+T", undefined, "insertTable"],
    ["Ctrl+B", "bold", "bold"],
    ["Ctrl+Z", undefined, undefined], // native: FortuneSheet's own undo
  ])("%s -> office %s, google %s", (combo, office, google) => {
    expect(grid(combo, "office")).toBe(office);
    expect(grid(combo, "google")).toBe(google);
    // ⌘ stands in for Ctrl on a Mac.
    expect(grid(combo, "office", true)).toBe(office);
    expect(grid(combo, "google", true)).toBe(google);
  });

  it("grid-only bindings stay off while a cell is being edited", () => {
    expect(findShortcut(ev("Shift+Space"), "editor", "google")).toBeUndefined();
    expect(findShortcut(ev("Alt+Shift+5"), "editor", "google")?.id).toBe("strikethrough");
  });

  it("menu hints follow the scheme", () => {
    expect(shortcutHint("strikethrough", "office")).toBe("Ctrl+5");
    expect(shortcutHint("strikethrough", "google")).toBe("Alt+Shift+5");
    expect(shortcutHint("insertRowsCols", "office")).toBe("Ctrl+Shift+=");
    expect(shortcutHint("insertRowsCols", "google")).toBe("Ctrl+Alt+=");
    expect(shortcutHint("alignCenter", "office")).toBe("");
    expect(shortcutHint("alignCenter", "google")).toBe("Ctrl+Shift+E");
    expect(shortcutHint("nope", "google")).toBe("");
  });
});

describe("row/column targets", () => {
  it("whole columns selected act on columns, anything else on rows", () => {
    expect(structureTarget({ row: [0, 99], column: [2, 3] }, 100)).toEqual({ axis: "col", start: 2, end: 3 });
    expect(structureTarget({ row: [4, 2], column: [0, 0] }, 100)).toEqual({ axis: "row", start: 2, end: 4 });
    expect(structureTarget({ row: [0, 50], column: [1, 1] }, 100)).toEqual({ axis: "row", start: 0, end: 50 });
  });

  it("lists the indices to hide and widens a selection to whole rows or columns", () => {
    expect(spanIndices({ row: [3, 1], column: [0, 0] }, "row")).toEqual(["1", "2", "3"]);
    expect(spanIndices({ row: [0, 0], column: [4, 4] }, "col")).toEqual(["4"]);
    expect(wholeSpan({ row: [2, 3], column: [1, 1] }, "row", { rows: 100, cols: 26 })).toEqual({ row: [2, 3], column: [0, 25] });
    expect(wholeSpan({ row: [2, 3], column: [1, 1] }, "col", { rows: 100, cols: 26 })).toEqual({ row: [0, 99], column: [1, 1] });
  });
});
