import { describe, it, expect } from "vitest";
import {
  NUDGE_LARGE,
  NUDGE_SMALL,
  editorKeyAction,
  isSaveKey,
  nudgeDelta,
  paneKey,
  presentKeyAction,
  preventsDefaultKey,
  railKeyAction,
  zoomKey,
  presentKeyPreventsDefault,
  textKeyAction,
  type KeyInput,
} from "./keymap";

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
    for (const key of ["a", "q"])
      expect(editorKeyAction({ key, ctrlKey: key === "q" }, sel)).toBeNull();
    // Enter edits the selected text box (M13), and means nothing without one.
    expect(editorKeyAction({ key: "Enter" }, none)).toBeNull();
    // Esc only means something with a selection.
    expect(editorKeyAction({ key: "Escape" }, none)).toBeNull();
  });

  it("binds the M2 selection and group keys", () => {
    expect(editorKeyAction({ key: "a", ctrlKey: true }, none)).toEqual({ type: "selectAll" });
    expect(editorKeyAction({ key: "a", metaKey: true }, sel)).toEqual({ type: "selectAll" });
    expect(editorKeyAction({ key: "Tab" }, none)).toEqual({ type: "cycle", dir: 1 });
    expect(editorKeyAction({ key: "Tab", shiftKey: true }, sel)).toEqual({ type: "cycle", dir: -1 });
    expect(editorKeyAction({ key: "Escape" }, sel)).toEqual({ type: "deselect" });
    // OnlyOffice/PowerPoint Ctrl+G and Google Slides Ctrl+Alt+G both group.
    expect(editorKeyAction({ key: "g", ctrlKey: true }, sel)).toEqual({ type: "group" });
    expect(editorKeyAction({ key: "g", ctrlKey: true, altKey: true }, sel)).toEqual({ type: "group" });
    expect(editorKeyAction({ key: "G", metaKey: true, altKey: true, shiftKey: true }, sel)).toEqual({ type: "ungroup" });
    expect(editorKeyAction({ key: "©", code: "KeyG", metaKey: true, altKey: true }, sel)).toEqual({ type: "group" });
    expect(editorKeyAction({ key: "x", ctrlKey: true }, sel)).toEqual({ type: "cut" });
    expect(editorKeyAction({ key: "x", ctrlKey: true }, none)).toBeNull();
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
    for (const key of ["ArrowRight", "ArrowDown", " ", "PageDown", "n", "N"]) expect(presentKeyAction({ key })).toBe("next");
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"]) expect(presentKeyAction({ key })).toBe("prev");
    expect(presentKeyAction({ key: "s" })).toBe("togglePresenter");
    expect(presentKeyAction({ key: "S" })).toBe("togglePresenter");
    expect(presentKeyAction({ key: "Escape" })).toBe("exit");
    expect(presentKeyAction({ key: "Home" })).toBe("first");
    expect(presentKeyAction({ key: "End" })).toBe("last");
    expect(presentKeyAction({ key: "Enter" })).toBe("enter");
    expect(presentKeyAction({ key: "7" })).toEqual({ digit: "7" });
    expect(presentKeyAction({ key: "b" })).toBe("black");
    expect(presentKeyAction({ key: "." })).toBe("black");
    expect(presentKeyAction({ key: "W" })).toBe("white");
    expect(presentKeyAction({ key: "l", ctrlKey: true })).toBe("laser");
    expect(presentKeyAction({ key: "p", metaKey: true })).toBe("pen");
    expect(presentKeyAction({ key: "e" })).toBe("erase");
    expect(presentKeyAction({ key: "x" })).toBeNull();
    expect(presentKeyAction({ key: "n", altKey: true })).toBeNull();
  });

  it("swallows everything it handles except Esc", () => {
    expect(presentKeyPreventsDefault("next")).toBe(true);
    expect(presentKeyPreventsDefault("prev")).toBe(true);
    expect(presentKeyPreventsDefault("pen")).toBe(true);
    expect(presentKeyPreventsDefault({ digit: "1" })).toBe(true);
    expect(presentKeyPreventsDefault("exit")).toBe(false);
    expect(presentKeyPreventsDefault(null)).toBe(false);
  });
});

describe("editorKeyAction: Ctrl/Cmd shortcuts", () => {
  const ctrl = (key: string, extra: object = {}) => ({ key, ctrlKey: true, ...extra });
  const cmd = (key: string, extra: object = {}) => ({ key, metaKey: true, ...extra });

  it("Ctrl/Cmd+Z undo, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z redo", () => {
    for (const mod of [ctrl, cmd]) {
      expect(editorKeyAction(mod("z"), none)).toEqual({ type: "undo" });
      expect(editorKeyAction(mod("y"), sel)).toEqual({ type: "redo" });
      // Shift upper-cases the key on most layouts.
      expect(editorKeyAction(mod("Z", { shiftKey: true }), none)).toEqual({ type: "redo" });
      expect(editorKeyAction(mod("z", { shiftKey: true }), none)).toEqual({ type: "redo" });
    }
    expect(editorKeyAction({ key: "z" }, sel)).toBeNull();
  });

  it("Ctrl/Cmd+D duplicates the selected element, else the slide", () => {
    expect(editorKeyAction(ctrl("d"), sel)).toEqual({ type: "duplicateElement" });
    expect(editorKeyAction(cmd("D"), none)).toEqual({ type: "duplicateSlide" });
  });

  it("Ctrl/Cmd+S saves with or without a selection", () => {
    expect(editorKeyAction(ctrl("s"), sel)).toEqual({ type: "save" });
    expect(editorKeyAction(cmd("s"), none)).toEqual({ type: "save" });
    expect(isSaveKey(cmd("S"))).toBe(true);
    expect(isSaveKey({ key: "s" })).toBe(false);
    expect(isSaveKey(ctrl("s", { altKey: true }))).toBe(false);
  });

  it("Ctrl/Cmd+C copies only with a selection; Ctrl/Cmd+V always asks to paste", () => {
    expect(editorKeyAction(ctrl("c"), sel)).toEqual({ type: "copy" });
    expect(editorKeyAction(ctrl("c"), none)).toBeNull();
    expect(editorKeyAction(cmd("v"), none)).toEqual({ type: "paste" });
    expect(editorKeyAction({ key: "v" }, sel)).toBeNull();
  });

  it("leaves Alt chords unbound", () => {
    expect(editorKeyAction(ctrl("z", { altKey: true }), sel)).toBeNull();
  });
});

describe("OnlyOffice parity", () => {
  // Ctrl+B/I/U/5/./, and Ctrl+] / Ctrl+[ map to text actions, inside a text
  // box and on selected text boxes (textOps.test checks what they do).
  it("oo:slide/shortcuts/shortcuts.js#Check text property change", () => {
    for (const editing of [true, false]) {
      const t = (key: string, extra: Partial<KeyInput> = {}) => textKeyAction({ key, ctrlKey: true, ...extra }, { editing });
      expect(t("b")).toEqual({ type: "toggle", key: "bold" });
      expect(t("i")).toEqual({ type: "toggle", key: "italic" });
      expect(t("u")).toEqual({ type: "toggle", key: "underline" });
      expect(t("5")).toEqual({ type: "toggle", key: "strike" });
      expect(t(".")).toEqual({ type: "toggle", key: "super" });
      expect(t(",")).toEqual({ type: "toggle", key: "sub" });
      expect(t("]")).toEqual({ type: "fontStep", dir: 1 });
      expect(t("[")).toEqual({ type: "fontStep", dir: -1 });
      expect(t(">", { shiftKey: true, code: "Period" })).toEqual({ type: "fontStep", dir: 1 });
      expect(t("<", { shiftKey: true, code: "Comma" })).toEqual({ type: "fontStep", dir: -1 });
    }
    expect(textKeyAction({ key: "%", altKey: true, shiftKey: true, code: "Digit5" }, { editing: false })).toEqual({
      type: "toggle",
      key: "strike",
    });
  });

  // Ctrl+E/J/L/R align; Ctrl+Shift+L bullets; Tab / Shift+Tab indent (the
  // editor indents list paragraphs, see TextEditor).
  it("oo:slide/shortcuts/shortcuts.js#Check paragraph property change", () => {
    const t = (key: string, extra: Partial<KeyInput> = {}) => textKeyAction({ key, ctrlKey: true, ...extra }, { editing: true });
    expect(t("e")).toEqual({ type: "align", align: "center" });
    expect(t("j")).toEqual({ type: "align", align: "justify" });
    expect(t("l")).toEqual({ type: "align", align: "left" });
    expect(t("r")).toEqual({ type: "align", align: "right" });
    expect(t("L", { shiftKey: true, code: "KeyL" })).toEqual({ type: "list", list: "bullet" });
    expect(t("*", { shiftKey: true, code: "Digit8" })).toEqual({ type: "list", list: "bullet" });
    expect(t("&", { shiftKey: true, code: "Digit7" })).toEqual({ type: "list", list: "number" });
    expect(textKeyAction({ key: "Tab" }, { editing: true })).toEqual({ type: "tab", dir: 1 });
    expect(textKeyAction({ key: "Tab", shiftKey: true }, { editing: true })).toEqual({ type: "tab", dir: -1 });
    // Outside a text box Tab still cycles the selection.
    expect(textKeyAction({ key: "Tab" }, { editing: false })).toBeNull();
  });

  // Ctrl+Shift+Space → NBSP, Ctrl+Alt+E → €, Ctrl+Alt+- → en dash (while
  // editing text; a plain Space types itself). e2e: slides-text.spec.ts.
  it("oo:slide/shortcuts/shortcuts.js#Check add various characters", () => {
    const e = { editing: true };
    expect(textKeyAction({ key: " ", code: "Space", ctrlKey: true, shiftKey: true }, e)).toEqual({ type: "insert", text: "\u00a0" });
    expect(textKeyAction({ key: "€", code: "KeyE", ctrlKey: true, altKey: true }, e)).toEqual({ type: "insert", text: "\u20ac" });
    expect(textKeyAction({ key: "-", code: "Minus", ctrlKey: true, altKey: true }, e)).toEqual({ type: "insert", text: "\u2013" });
    expect(textKeyAction({ key: " ", code: "Space" }, e)).toBeNull();
    // Not while a box is merely selected.
    expect(textKeyAction({ key: "-", code: "Minus", ctrlKey: true, altKey: true }, { editing: false })).toBeNull();
  });

  it("text actions: paint format, clear, link, Esc", () => {
    const t = (key: string, extra: Partial<KeyInput> = {}, hasFormat = false) =>
      textKeyAction({ key, ctrlKey: true, ...extra }, { editing: false, hasFormat });
    expect(t("C", { shiftKey: true, code: "KeyC" })).toEqual({ type: "copyFormat" });
    expect(t("V", { shiftKey: true, code: "KeyV" })).toBeNull();
    expect(t("V", { shiftKey: true, code: "KeyV" }, true)).toEqual({ type: "pasteFormat" });
    expect(t(" ")).toEqual({ type: "clearFormat" });
    expect(t("\\")).toEqual({ type: "clearFormat" });
    expect(t("k")).toEqual({ type: "link" });
    expect(t("c")).toBeNull();
    expect(textKeyAction({ key: "Escape" }, { editing: true })).toEqual({ type: "exitEdit" });
    expect(textKeyAction({ key: "Escape" }, { editing: false })).toBeNull();
  });

  // Ctrl/Cmd+S flushes the debounced autosave immediately; the editor checks
  // isSaveKey before its text-editing guard so it works inside a text box too.
  it("oo:slide/shortcuts/shortcuts.js#Check save action", () => {
    expect(editorKeyAction({ key: "s", ctrlKey: true }, none)).toEqual({ type: "save" });
    expect(isSaveKey({ key: "s", ctrlKey: true })).toBe(true);
  });
});

describe("OnlyOffice parity: draw-to-insert", () => {
  // StartAddShape('rect') then Esc: the pending "add shape" track is reset.
  // Grown arms a draw tool from the shape gallery; Esc maps to cancelDraw
  // (before deselect), and DeckEditor clears the tool (e2e: slides-shapes).
  it("oo:slide/shortcuts/shortcuts.js#Check reset action with adding new shape", () => {
    expect(editorKeyAction({ key: "Escape" }, { hasSelection: false, drawing: true })).toEqual({
      type: "cancelDraw",
    });
    expect(editorKeyAction({ key: "Escape" }, { hasSelection: true, drawing: true })).toEqual({
      type: "cancelDraw",
    });
    expect(editorKeyAction({ key: "Escape" }, { hasSelection: true })).toEqual({ type: "deselect" });
  });
});

describe("OnlyOffice parity: M13 shortcuts", () => {
  // NumLock, ScrollLock and Ctrl+= are swallowed. Ctrl+=/-/0 drive the
  // editor's own zoom (the page zoom would scale the toolbars instead).
  it("oo:slide/shortcuts/shortcuts.js#Check prevent default", () => {
    expect(preventsDefaultKey({ key: "NumLock" })).toBe(true);
    expect(preventsDefaultKey({ key: "ScrollLock" })).toBe(true);
    expect(preventsDefaultKey({ key: "=", code: "Equal", ctrlKey: true })).toBe(true);
    expect(preventsDefaultKey({ key: "=", code: "Equal", metaKey: true })).toBe(true);
    expect(preventsDefaultKey({ key: "=" })).toBe(false);
    expect(preventsDefaultKey({ key: "a", ctrlKey: true })).toBe(false);
    expect(editorKeyAction({ key: "=", code: "Equal", ctrlKey: true }, none)).toEqual({ type: "zoom", dir: 1 });
    expect(editorKeyAction({ key: "-", code: "Minus", ctrlKey: true }, none)).toEqual({ type: "zoom", dir: -1 });
    expect(editorKeyAction({ key: "0", code: "Digit0", ctrlKey: true }, none)).toEqual({ type: "zoom", dir: 0 });
  });

  // (grown-variant) OnlyOffice toggles paragraph marks with Ctrl+Shift+8
  // everywhere. Grown keeps Google Slides' Ctrl+Shift+8 = bulleted list
  // when text boxes are selected or edited (textKeyAction runs first), and
  // toggles the marks otherwise (also View ▸ Show paragraph marks).
  it("oo:slide/shortcuts/shortcuts.js#Check show paragraph marks (grown-variant)", () => {
    const key = { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true };
    expect(editorKeyAction(key, none)).toEqual({ type: "toggleMarks" });
    expect(textKeyAction(key, { editing: true })).toEqual({ type: "list", list: "bullet" });
  });
});

describe("keyboard-only operation", () => {
  it("Enter and F2 edit the selected text box; F6 cycles panes", () => {
    expect(editorKeyAction({ key: "Enter" }, sel)).toEqual({ type: "editText" });
    expect(editorKeyAction({ key: "F2" }, sel)).toEqual({ type: "editText" });
    expect(editorKeyAction({ key: "F2" }, none)).toBeNull();
    expect(paneKey({ key: "F6" })).toBe(1);
    expect(paneKey({ key: "F6", shiftKey: true })).toBe(-1);
    expect(paneKey({ key: "F6", ctrlKey: true })).toBeNull();
    expect(zoomKey({ key: "+", shiftKey: true, ctrlKey: true })).toBe(1);
    expect(zoomKey({ key: "0" })).toBeNull();
  });

  it("rail keys", () => {
    expect(railKeyAction({ key: "ArrowRight" })).toEqual({ type: "go", to: "next", extend: false });
    expect(railKeyAction({ key: "End", shiftKey: true })).toEqual({ type: "go", to: "last", extend: true });
    expect(railKeyAction({ key: "ArrowUp", metaKey: true, shiftKey: true })).toEqual({ type: "move", how: "start" });
    expect(railKeyAction({ key: "d", ctrlKey: true })).toEqual({ type: "duplicate" });
    expect(railKeyAction({ key: "H", ctrlKey: true, shiftKey: true })).toEqual({ type: "hide" });
    expect(railKeyAction({ key: "ArrowDown", altKey: true })).toBeNull();
    expect(railKeyAction({ key: "x" })).toBeNull();
  });
});
