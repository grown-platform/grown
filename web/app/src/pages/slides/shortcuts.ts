// The Slides keyboard shortcut list (M13): one table that the Ctrl+/ dialog
// renders and that shortcuts.test.ts checks against the key maps in
// keymap.ts, so the dialog can't drift from what the keys do. Our own
// table (OnlyOffice's hotkey list, tests/slide/shortcuts/events.js, was
// read for coverage only).

import type { KeyInput } from "./keymap";

export type ShortcutArea = "editor" | "text" | "rail" | "present" | "global";

export interface Shortcut {
  group: string;
  label: string;
  /** Display keys ("Ctrl" becomes ⌘ on macOS). Alternatives are separate. */
  keys: string[];
  /** A key press that must map to `action` in `area` (checked by tests). */
  probe?: { area: ShortcutArea; input: KeyInput; ctx?: { hasSelection?: boolean; editing?: boolean; drawing?: boolean }; action: unknown };
}

const C = (key: string, more: Partial<KeyInput> = {}): KeyInput => ({ key, ctrlKey: true, ...more });

export const SHORTCUTS: Shortcut[] = [
  // ---- general
  { group: "General", label: "Save now", keys: ["Ctrl+S"], probe: { area: "global", input: C("s"), action: "save" } },
  { group: "General", label: "Print / print preview", keys: ["Ctrl+P"], probe: { area: "global", input: C("p"), action: "print" } },
  { group: "General", label: "Find and replace", keys: ["Ctrl+H"] },
  { group: "General", label: "Undo", keys: ["Ctrl+Z"], probe: { area: "editor", input: C("z"), action: { type: "undo" } } },
  { group: "General", label: "Redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"], probe: { area: "editor", input: C("y"), action: { type: "redo" } } },
  { group: "General", label: "Keyboard shortcuts", keys: ["Ctrl+/"] },
  { group: "General", label: "Next / previous pane (slides, canvas, notes)", keys: ["F6", "Shift+F6"], probe: { area: "global", input: { key: "F6" }, action: "pane:1" } },
  { group: "General", label: "Zoom in / out / fit", keys: ["Ctrl+=", "Ctrl+-", "Ctrl+0"], probe: { area: "editor", input: C("=", { code: "Equal" }), action: { type: "zoom", dir: 1 } } },
  { group: "General", label: "Show paragraph marks (nothing selected)", keys: ["Ctrl+Shift+8"], probe: { area: "editor", input: C("*", { shiftKey: true, code: "Digit8" }), action: { type: "toggleMarks" } } },
  // ---- slides
  { group: "Slides", label: "New slide", keys: ["Ctrl+M"], probe: { area: "editor", input: C("m"), action: { type: "newSlide" } } },
  { group: "Slides", label: "Duplicate slide (nothing selected)", keys: ["Ctrl+D"], probe: { area: "editor", input: C("d"), ctx: { hasSelection: false }, action: { type: "duplicateSlide" } } },
  { group: "Slides", label: "Slideshow from the beginning", keys: ["F5"] },
  { group: "Slides", label: "Slideshow from the current slide", keys: ["Shift+F5", "Ctrl+F5"] },
  { group: "Slides", label: "Next / previous slide (slide list)", keys: ["↓", "↑"], probe: { area: "rail", input: { key: "ArrowDown" }, action: { type: "go", to: "next", extend: false } } },
  { group: "Slides", label: "First / last slide (slide list)", keys: ["Home", "End"], probe: { area: "rail", input: { key: "End" }, action: { type: "go", to: "last", extend: false } } },
  { group: "Slides", label: "Extend slide selection", keys: ["Shift+↓", "Shift+↑", "Shift+Home", "Shift+End"], probe: { area: "rail", input: { key: "ArrowDown", shiftKey: true }, action: { type: "go", to: "next", extend: true } } },
  { group: "Slides", label: "Move selected slides down / up", keys: ["Ctrl+↓", "Ctrl+↑"], probe: { area: "rail", input: C("ArrowDown"), action: { type: "move", how: 1 } } },
  { group: "Slides", label: "Move selected slides to the end / start", keys: ["Ctrl+Shift+↓", "Ctrl+Shift+↑"], probe: { area: "rail", input: C("ArrowUp", { shiftKey: true }), action: { type: "move", how: "start" } } },
  { group: "Slides", label: "Select all slides (slide list)", keys: ["Ctrl+A"], probe: { area: "rail", input: C("a"), action: { type: "selectAll" } } },
  { group: "Slides", label: "Delete selected slides (slide list)", keys: ["Delete"], probe: { area: "rail", input: { key: "Delete" }, action: { type: "delete" } } },
  { group: "Slides", label: "Hide / unhide selected slides (slide list)", keys: ["Ctrl+Shift+H"], probe: { area: "rail", input: C("h", { shiftKey: true }), action: { type: "hide" } } },
  // ---- objects
  { group: "Objects", label: "Select next / previous object", keys: ["Tab", "Shift+Tab"], probe: { area: "editor", input: { key: "Tab" }, action: { type: "cycle", dir: 1 } } },
  { group: "Objects", label: "Select all objects", keys: ["Ctrl+A"], probe: { area: "editor", input: C("a"), action: { type: "selectAll" } } },
  { group: "Objects", label: "Edit the selected text box", keys: ["Enter", "F2"], probe: { area: "editor", input: { key: "Enter" }, ctx: { hasSelection: true }, action: { type: "editText" } } },
  { group: "Objects", label: "Stop editing / deselect", keys: ["Esc"], probe: { area: "editor", input: { key: "Escape" }, ctx: { hasSelection: true }, action: { type: "deselect" } } },
  { group: "Objects", label: "Nudge (Shift: 10 px)", keys: ["←↑→↓", "Shift+←↑→↓"], probe: { area: "editor", input: { key: "ArrowRight" }, ctx: { hasSelection: true }, action: { type: "nudge", dx: 2, dy: 0 } } },
  { group: "Objects", label: "Delete", keys: ["Delete", "Backspace"], probe: { area: "editor", input: { key: "Delete" }, ctx: { hasSelection: true }, action: { type: "deleteSelected" } } },
  { group: "Objects", label: "Cut / copy / paste", keys: ["Ctrl+X", "Ctrl+C", "Ctrl+V"], probe: { area: "editor", input: C("c"), ctx: { hasSelection: true }, action: { type: "copy" } } },
  { group: "Objects", label: "Duplicate", keys: ["Ctrl+D"], probe: { area: "editor", input: C("d"), ctx: { hasSelection: true }, action: { type: "duplicateElement" } } },
  { group: "Objects", label: "Group / ungroup", keys: ["Ctrl+G", "Ctrl+Shift+G"], probe: { area: "editor", input: C("g", { shiftKey: true }), action: { type: "ungroup" } } },
  { group: "Objects", label: "Next placeholder (new slide after the last)", keys: ["Ctrl+Enter"] },
  { group: "Objects", label: "Cancel drawing a shape", keys: ["Esc"], probe: { area: "editor", input: { key: "Escape" }, ctx: { drawing: true }, action: { type: "cancelDraw" } } },
  // ---- text
  { group: "Text", label: "Bold / italic / underline", keys: ["Ctrl+B", "Ctrl+I", "Ctrl+U"], probe: { area: "text", input: C("b"), action: { type: "toggle", key: "bold" } } },
  { group: "Text", label: "Strikethrough", keys: ["Ctrl+5", "Alt+Shift+5"], probe: { area: "text", input: C("5"), action: { type: "toggle", key: "strike" } } },
  { group: "Text", label: "Superscript / subscript", keys: ["Ctrl+.", "Ctrl+,"], probe: { area: "text", input: C("."), action: { type: "toggle", key: "super" } } },
  { group: "Text", label: "Bigger / smaller font", keys: ["Ctrl+]", "Ctrl+["], probe: { area: "text", input: C("]"), action: { type: "fontStep", dir: 1 } } },
  { group: "Text", label: "Align left / centre / right / justify", keys: ["Ctrl+L", "Ctrl+E", "Ctrl+R", "Ctrl+J"], probe: { area: "text", input: C("e"), action: { type: "align", align: "center" } } },
  { group: "Text", label: "Bulleted / numbered list", keys: ["Ctrl+Shift+L", "Ctrl+Shift+7"], probe: { area: "text", input: C("l", { shiftKey: true }), action: { type: "list", list: "bullet" } } },
  { group: "Text", label: "Increase / decrease list level", keys: ["Tab", "Shift+Tab"], probe: { area: "text", input: { key: "Tab" }, ctx: { editing: true }, action: { type: "tab", dir: 1 } } },
  { group: "Text", label: "Copy / paste formatting", keys: ["Ctrl+Shift+C", "Ctrl+Shift+V"], probe: { area: "text", input: C("c", { shiftKey: true }), action: { type: "copyFormat" } } },
  { group: "Text", label: "Clear formatting", keys: ["Ctrl+Space", "Ctrl+\\"], probe: { area: "text", input: C(" "), action: { type: "clearFormat" } } },
  { group: "Text", label: "Insert link", keys: ["Ctrl+K"], probe: { area: "text", input: C("k"), action: { type: "link" } } },
  { group: "Text", label: "Line break", keys: ["Shift+Enter"] },
  { group: "Text", label: "No-break space / € / en dash", keys: ["Ctrl+Shift+Space", "Ctrl+Alt+E", "Ctrl+Alt+-"], probe: { area: "text", input: C("e", { altKey: true, code: "KeyE" }), ctx: { editing: true }, action: { type: "insert", text: "€" } } },
  // ---- slideshow
  { group: "Slideshow", label: "Next", keys: ["→", "↓", "Space", "PgDn", "N"], probe: { area: "present", input: { key: " " }, action: "next" } },
  { group: "Slideshow", label: "Previous", keys: ["←", "↑", "PgUp", "P", "Backspace"], probe: { area: "present", input: { key: "PageUp" }, action: "prev" } },
  { group: "Slideshow", label: "First / last slide", keys: ["Home", "End"], probe: { area: "present", input: { key: "End" }, action: "last" } },
  { group: "Slideshow", label: "Go to slide number", keys: ["number, Enter"], probe: { area: "present", input: { key: "7" }, action: { digit: "7" } } },
  { group: "Slideshow", label: "Black / white screen", keys: ["B", "W"], probe: { area: "present", input: { key: "b" }, action: "black" } },
  { group: "Slideshow", label: "Presenter view", keys: ["S"], probe: { area: "present", input: { key: "s" }, action: "togglePresenter" } },
  { group: "Slideshow", label: "Laser pointer / pen / erase ink", keys: ["Ctrl+L", "Ctrl+P", "E"], probe: { area: "present", input: C("l"), action: "laser" } },
  { group: "Slideshow", label: "End the show", keys: ["Esc"], probe: { area: "present", input: { key: "Escape" }, action: "exit" } },
];

/** formatKeys renders display keys for the platform (⌘/⌥ on macOS). */
export function formatKeys(keys: string, mac: boolean): string {
  if (!mac) return keys;
  return keys.replace(/Ctrl\+/g, "⌘").replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧");
}

/** filterShortcuts keeps the rows whose label, group or keys match `q`. */
export function filterShortcuts(q: string, list: readonly Shortcut[] = SHORTCUTS): Shortcut[] {
  const t = q.trim().toLowerCase();
  if (!t) return [...list];
  return list.filter((s) => s.label.toLowerCase().includes(t) || s.group.toLowerCase().includes(t) || s.keys.some((k) => k.toLowerCase().includes(t)));
}
