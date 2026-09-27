// Pure keyboard mapping for the slides editor and present mode. The components
// translate a KeyboardEvent into an action here, then perform it; keeping the
// mapping pure makes the shortcut table testable without a DOM.

/** The subset of KeyboardEvent the key maps look at. */
export interface KeyInput {
  key: string;
  /** Physical key (e.g. "KeyG"); Option+G on macOS reports key "©". */
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Arrow-key nudge distance in logical px (Shift = large step). */
export const NUDGE_SMALL = 2;
export const NUDGE_LARGE = 10;

export type EditorKeyAction =
  | { type: "deleteSelected" }
  | { type: "newSlide" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "duplicateElement" }
  | { type: "duplicateSlide" }
  | { type: "save" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "cut" }
  | { type: "selectAll" }
  | { type: "cycle"; dir: 1 | -1 }
  | { type: "deselect" }
  | { type: "group" }
  | { type: "ungroup" }
  | { type: "cancelDraw" };

/** isSaveKey reports Ctrl/Cmd+S. The editor handles it even while a text box
 *  is being edited, so the browser's "Save page" dialog never opens. */
export function isSaveKey(e: KeyInput): boolean {
  return (!!e.ctrlKey || !!e.metaKey) && !e.altKey && e.key.toLowerCase() === "s";
}

/** nudgeDelta maps an arrow key to a (dx, dy) move, or null for other keys. */
export function nudgeDelta(
  key: string,
  shift: boolean,
): { dx: number; dy: number } | null {
  const d = shift ? NUDGE_LARGE : NUDGE_SMALL;
  switch (key) {
    case "ArrowLeft":
      return { dx: -d, dy: 0 };
    case "ArrowRight":
      return { dx: d, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -d };
    case "ArrowDown":
      return { dx: 0, dy: d };
    default:
      return null;
  }
}

/** editorKeyAction maps a key press on the editing canvas (not inside a text
 *  field) to an editor action. `hasSelection` is whether an element is selected;
 *  `drawing` is whether a draw-to-insert tool is armed (Esc cancels it first).
 *  Ctrl and Cmd are interchangeable. */
export function editorKeyAction(
  e: KeyInput,
  ctx: { hasSelection: boolean; drawing?: boolean },
): EditorKeyAction | null {
  if (e.key === "Escape" && ctx.drawing) return { type: "cancelDraw" };
  if ((e.key === "Delete" || e.key === "Backspace") && ctx.hasSelection)
    return { type: "deleteSelected" };
  const mod = !!e.ctrlKey || !!e.metaKey;
  // Group: Ctrl+G (OnlyOffice/PowerPoint) or Ctrl+Alt+G (Google Slides);
  // ungroup adds Shift. Checked before the Alt guard below.
  if (mod && (e.key.toLowerCase() === "g" || e.code === "KeyG"))
    return { type: e.shiftKey ? "ungroup" : "group" };
  if (e.key === "Escape") return ctx.hasSelection ? { type: "deselect" } : null;
  if (e.key === "Tab" && !mod && !e.altKey)
    return { type: "cycle", dir: e.shiftKey ? -1 : 1 };
  if (mod && !e.altKey) {
    switch (e.key.toLowerCase()) {
      case "a":
        return { type: "selectAll" };
      case "x":
        return ctx.hasSelection ? { type: "cut" } : null;
      case "m":
        return { type: "newSlide" };
      case "z":
        return { type: e.shiftKey ? "redo" : "undo" };
      case "y":
        return { type: "redo" };
      case "s":
        return { type: "save" };
      // OnlyOffice/PowerPoint: duplicate the selected object, or the current
      // slide when nothing is selected.
      case "d":
        return { type: ctx.hasSelection ? "duplicateElement" : "duplicateSlide" };
      // The element clipboard is in-app; copy needs something to copy, paste
      // is decided by the editor (it may hold an image from the OS clipboard).
      case "c":
        return ctx.hasSelection ? { type: "copy" } : null;
      case "v":
        return { type: "paste" };
    }
  }
  if (ctx.hasSelection) {
    const d = nudgeDelta(e.key, !!e.shiftKey);
    if (d) return { type: "nudge", ...d };
  }
  return null;
}

export type PresentKeyAction = "next" | "prev" | "togglePresenter" | "exit";

/** presentKeyAction maps a key press during a slideshow to a navigation action. */
export function presentKeyAction(e: KeyInput): PresentKeyAction | null {
  if (e.key === "ArrowRight" || e.key === " " || e.key === "ArrowDown")
    return "next";
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") return "prev";
  if (e.key.toLowerCase() === "s") return "togglePresenter";
  if (e.key === "Escape") return "exit";
  return null;
}

/** presentKeyPreventsDefault reports whether the slideshow swallows the key
 *  (navigation keys would otherwise scroll the page). */
export function presentKeyPreventsDefault(a: PresentKeyAction | null): boolean {
  return a === "next" || a === "prev";
}

// ---- text formatting (inside a text box, or on selected text boxes) ----

export type TextToggle = "bold" | "italic" | "underline" | "strike" | "super" | "sub";

export type TextKeyAction =
  | { type: "toggle"; key: TextToggle }
  | { type: "fontStep"; dir: 1 | -1 }
  | { type: "align"; align: "left" | "center" | "right" | "justify" }
  | { type: "list"; list: "bullet" | "number" }
  | { type: "copyFormat" }
  | { type: "pasteFormat" }
  | { type: "clearFormat" }
  | { type: "link" }
  /** Editing only: insert a character (NBSP, €, en dash, tab). */
  | { type: "insert"; text: string }
  /** Editing only: Tab / Shift+Tab (the editor indents list paragraphs,
   *  otherwise Tab inserts a tab character). */
  | { type: "tab"; dir: 1 | -1 }
  /** Editing only: Esc leaves the text box (it stays selected). */
  | { type: "exitEdit" };

/**
 * textKeyAction maps the text-formatting shortcuts (OnlyOffice / PowerPoint
 * names, with Google Slides aliases):
 * Ctrl+B/I/U, Ctrl+5 or Alt+Shift+5 strikethrough, Ctrl+. superscript,
 * Ctrl+, subscript, Ctrl+] / Ctrl+[ (or Ctrl+Shift+> / <) font size,
 * Ctrl+E/J/L/R (or Ctrl+Shift+E/J/L/R) align, Ctrl+Shift+L or Ctrl+Shift+8
 * bullets, Ctrl+Shift+7 numbering, Ctrl+Shift+C/V copy/paste format,
 * Ctrl+Space or Ctrl+\ clear formatting, Ctrl+K link; while editing also
 * Ctrl+Shift+Space no-break space, Ctrl+Alt+E euro sign, Ctrl+Alt+- en
 * dash, Tab/Shift+Tab and Esc. `hasFormat` is whether paint format holds
 * a captured style (otherwise Ctrl+Shift+V is left to the paste handler).
 */
export function textKeyAction(
  e: KeyInput,
  ctx: { editing: boolean; hasFormat?: boolean },
): TextKeyAction | null {
  const mod = !!e.ctrlKey || !!e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (ctx.editing) {
    if (e.key === "Escape") return { type: "exitEdit" };
    if (e.key === "Tab" && !mod && !e.altKey) return { type: "tab", dir: e.shiftKey ? -1 : 1 };
    if (mod && e.altKey && !e.shiftKey) {
      if (e.code === "KeyE" || k === "e") return { type: "insert", text: "€" };
      if (e.code === "Minus" || k === "-") return { type: "insert", text: "–" };
    }
    if (mod && e.shiftKey && !e.altKey && (e.key === " " || e.code === "Space"))
      return { type: "insert", text: " " };
  }
  // Google Slides strikethrough: Alt+Shift+5.
  if (!mod && e.altKey && e.shiftKey && (e.code === "Digit5" || k === "5" || k === "%"))
    return { type: "toggle", key: "strike" };
  if (!mod || e.altKey) return null;
  if (e.shiftKey) {
    if (e.code === "KeyC" || k === "c") return { type: "copyFormat" };
    if (e.code === "KeyV" || k === "v") return ctx.hasFormat ? { type: "pasteFormat" } : null;
    if (e.code === "KeyL" || k === "l") return { type: "list", list: "bullet" };
    if (e.code === "Digit8" || k === "*" || k === "8") return { type: "list", list: "bullet" };
    if (e.code === "Digit7" || k === "&" || k === "7") return { type: "list", list: "number" };
    if (e.code === "KeyE" || k === "e") return { type: "align", align: "center" };
    if (e.code === "KeyJ" || k === "j") return { type: "align", align: "justify" };
    if (e.code === "KeyR" || k === "r") return { type: "align", align: "right" };
    if (k === ">" || e.code === "Period") return { type: "fontStep", dir: 1 };
    if (k === "<" || e.code === "Comma") return { type: "fontStep", dir: -1 };
    return null;
  }
  switch (k) {
    case "b":
      return { type: "toggle", key: "bold" };
    case "i":
      return { type: "toggle", key: "italic" };
    case "u":
      return { type: "toggle", key: "underline" };
    case "5":
      return { type: "toggle", key: "strike" };
    case ".":
      return { type: "toggle", key: "super" };
    case ",":
      return { type: "toggle", key: "sub" };
    case "]":
      return { type: "fontStep", dir: 1 };
    case "[":
      return { type: "fontStep", dir: -1 };
    case "e":
      return { type: "align", align: "center" };
    case "j":
      return { type: "align", align: "justify" };
    case "l":
      return { type: "align", align: "left" };
    case "r":
      return { type: "align", align: "right" };
    case " ":
    case "\\":
      return { type: "clearFormat" };
    case "k":
      return { type: "link" };
  }
  return null;
}
