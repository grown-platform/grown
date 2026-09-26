import { describe, it, expect } from "vitest";
import {
  NUDGE_LARGE,
  NUDGE_SMALL,
  editorKeyAction,
  nudgeDelta,
  presentKeyAction,
  presentKeyPreventsDefault,
} from "./keymap";
import { moveElementBy } from "./deckOps";
import { newElement } from "./model";

const sel = { hasSelection: true };
const none = { hasSelection: false };

describe("editorKeyAction", () => {
  it("Delete/Backspace delete the selected element only when one is selected", () => {
    expect(editorKeyAction({ key: "Delete" }, sel)).toEqual({ type: "deleteSelected" });
    expect(editorKeyAction({ key: "Backspace" }, sel)).toEqual({ type: "deleteSelected" });
    expect(editorKeyAction({ key: "Delete" }, none)).toBeNull();
  });

  it("Ctrl+M / Cmd+M add a new slide regardless of selection or case", () => {
    expect(editorKeyAction({ key: "m", ctrlKey: true }, none)).toEqual({ type: "newSlide" });
    expect(editorKeyAction({ key: "M", metaKey: true }, sel)).toEqual({ type: "newSlide" });
    expect(editorKeyAction({ key: "m" }, none)).toBeNull();
  });

  it("arrow keys nudge the selection by 2 (Shift: 10)", () => {
    expect(editorKeyAction({ key: "ArrowLeft" }, sel)).toEqual({ type: "nudge", dx: -NUDGE_SMALL, dy: 0 });
    expect(editorKeyAction({ key: "ArrowDown", shiftKey: true }, sel)).toEqual({
      type: "nudge",
      dx: 0,
      dy: NUDGE_LARGE,
    });
    expect(editorKeyAction({ key: "ArrowUp" }, none)).toBeNull();
  });

  it("ignores unbound keys", () => {
    for (const key of ["a", "Enter", "Tab", "Escape", "z"])
      expect(editorKeyAction({ key, ctrlKey: key === "z" }, sel)).toBeNull();
  });
});

describe("nudgeDelta", () => {
  it("maps each arrow", () => {
    expect(nudgeDelta("ArrowRight", false)).toEqual({ dx: 2, dy: 0 });
    expect(nudgeDelta("ArrowUp", true)).toEqual({ dx: 0, dy: -10 });
    expect(nudgeDelta("x", false)).toBeNull();
  });
});

describe("presentKeyAction", () => {
  it("maps navigation keys", () => {
    for (const key of ["ArrowRight", "ArrowDown", " "]) expect(presentKeyAction({ key })).toBe("next");
    for (const key of ["ArrowLeft", "ArrowUp"]) expect(presentKeyAction({ key })).toBe("prev");
    expect(presentKeyAction({ key: "s" })).toBe("togglePresenter");
    expect(presentKeyAction({ key: "S" })).toBe("togglePresenter");
    expect(presentKeyAction({ key: "Escape" })).toBe("exit");
    expect(presentKeyAction({ key: "Home" })).toBeNull();
  });

  it("only swallows navigation keys", () => {
    expect(presentKeyPreventsDefault("next")).toBe(true);
    expect(presentKeyPreventsDefault("prev")).toBe(true);
    expect(presentKeyPreventsDefault("exit")).toBe(false);
    expect(presentKeyPreventsDefault(null)).toBe(false);
  });
});

describe("OnlyOffice parity", () => {
  // SKIP: nudge distances differ. OnlyOffice moves a shape 5 units per Arrow
  // and 1 unit per Ctrl+Arrow; Grown moves 2 logical px per Arrow and 10 per
  // Shift+Arrow (Google Slides-like). Grown also lacks Tab/Shift+Tab object
  // cycling, Enter-to-edit, group/ungroup and table cell navigation, which the
  // rest of this case covers.
  it.skip("oo:slide/shortcuts/shortcuts.js#Check main actions with shapes", () => {
    const shape = { ...newElement("rect"), x: 0, y: 0 };
    const a = editorKeyAction({ key: "ArrowLeft" }, sel);
    expect(a && a.type === "nudge" && moveElementBy(shape, a.dx, a.dy).x).toBe(-5);
    const b = editorKeyAction({ key: "ArrowLeft", ctrlKey: true }, sel);
    expect(b && b.type === "nudge" && b.dx).toBe(-1);
  });

  // SKIP: Ctrl+B/I/U/5 and Ctrl+./Ctrl+, are not bound (Bold/Italic/Underline
  // are toolbar/menu toggles on the whole element), there is no super/subscript,
  // and no Ctrl+]/Ctrl+[ font-size ladder (font size is a free number input).
  it.skip("oo:slide/shortcuts/shortcuts.js#Check text property change", () => {
    expect(editorKeyAction({ key: "b", ctrlKey: true }, sel)).not.toBeNull();
  });

  // SKIP: no justify alignment, no Ctrl+E/J/L/R bindings, no indent levels and
  // no Ctrl+Shift+L bullet shortcut (bullets are a menu toggle).
  it.skip("oo:slide/shortcuts/shortcuts.js#Check paragraph property change", () => {
    expect(editorKeyAction({ key: "e", ctrlKey: true }, sel)).not.toBeNull();
  });

  // SKIP: Ctrl+S is not bound. Grown autosaves (debounced PUT …/data 1.2 s
  // after each edit), so there is no explicit save action to trigger.
  it.skip("oo:slide/shortcuts/shortcuts.js#Check save action", () => {
    expect(editorKeyAction({ key: "s", ctrlKey: true }, none)).not.toBeNull();
  });
});
