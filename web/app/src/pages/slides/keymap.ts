// Pure keyboard mapping for the slides editor and present mode. The components
// translate a KeyboardEvent into an action here, then perform it; keeping the
// mapping pure makes the shortcut table testable without a DOM.

/** The subset of KeyboardEvent the key maps look at. */
export interface KeyInput {
  key: string;
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
  | { type: "paste" };

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
 *  field) to an editor action. `hasSelection` is whether an element is selected.
 *  Ctrl and Cmd are interchangeable. */
export function editorKeyAction(
  e: KeyInput,
  ctx: { hasSelection: boolean },
): EditorKeyAction | null {
  if ((e.key === "Delete" || e.key === "Backspace") && ctx.hasSelection)
    return { type: "deleteSelected" };
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    switch (e.key.toLowerCase()) {
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
  // Ctrl+A (select all) is not bound: the editor has a single selection.
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
