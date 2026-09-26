// Key-event helpers for the headless Docs harness.
//
// Chords use ProseMirror's keymap notation ("Mod-b", "Shift-Enter",
// "Mod-Alt-1", "Mod-Shift-8"). Events are dispatched as real DOM keydown
// events on the editor's contenteditable root, so they travel the same path
// as a user's key press: ProseMirror's keydown handler -> every plugin's
// handleKeyDown (TipTap keyboard shortcuts, list/heading/mark keymaps,
// Suggesting's Backspace handling) -> the base keymap.
//
// jsdom reports a non-Mac platform, so "Mod" resolves to Ctrl, matching how
// prosemirror-keymap normalises bindings in the same environment.
import type { Editor } from "@tiptap/core";

export interface KeyChord {
  key: string;
  code: string;
  keyCode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// Named keys -> [key, code, keyCode].
const NAMED: Record<string, [string, string, number]> = {
  Enter: ["Enter", "Enter", 13],
  Backspace: ["Backspace", "Backspace", 8],
  Delete: ["Delete", "Delete", 46],
  Tab: ["Tab", "Tab", 9],
  Escape: ["Escape", "Escape", 27],
  Space: [" ", "Space", 32],
  ArrowLeft: ["ArrowLeft", "ArrowLeft", 37],
  ArrowUp: ["ArrowUp", "ArrowUp", 38],
  ArrowRight: ["ArrowRight", "ArrowRight", 39],
  ArrowDown: ["ArrowDown", "ArrowDown", 40],
  Home: ["Home", "Home", 36],
  End: ["End", "End", 35],
  PageUp: ["PageUp", "PageUp", 33],
  PageDown: ["PageDown", "PageDown", 34],
};

// Punctuation -> [code, keyCode, shifted key] on a US layout.
const PUNCT: Record<string, [string, number, string]> = {
  ".": ["Period", 190, ">"],
  ",": ["Comma", 188, "<"],
  "-": ["Minus", 189, "_"],
  "=": ["Equal", 187, "+"],
  "/": ["Slash", 191, "?"],
  ";": ["Semicolon", 186, ":"],
  "'": ["Quote", 222, '"'],
  "[": ["BracketLeft", 219, "{"],
  "]": ["BracketRight", 221, "}"],
  "\\": ["Backslash", 220, "|"],
  "`": ["Backquote", 192, "~"],
};
const DIGIT_SHIFT = ")!@#$%^&*(";

/** parseChord turns "Mod-Shift-s" into the fields of a KeyboardEvent, with the
 *  `key` a browser would report (Shift+s -> "S", Shift+8 -> "*"). */
export function parseChord(chord: string): KeyChord {
  // Split on "-" but keep a trailing "-" (the Minus key) as the key itself.
  const parts = chord.endsWith("--")
    ? [...chord.slice(0, -2).split("-"), "-"]
    : chord.split("-");
  const base = parts.pop() as string;
  const mods = new Set(parts.map((m) => m.toLowerCase()));
  const shiftKey = mods.has("shift");
  const c: KeyChord = {
    key: base,
    code: base,
    keyCode: 0,
    ctrlKey: mods.has("ctrl") || mods.has("control") || mods.has("mod"),
    metaKey: mods.has("meta") || mods.has("cmd"),
    altKey: mods.has("alt"),
    shiftKey,
  };
  if (NAMED[base]) {
    [c.key, c.code, c.keyCode] = NAMED[base];
  } else if (/^[a-z]$/i.test(base)) {
    const lower = base.toLowerCase();
    c.key = shiftKey ? lower.toUpperCase() : lower;
    c.code = `Key${lower.toUpperCase()}`;
    c.keyCode = lower.toUpperCase().charCodeAt(0);
  } else if (/^[0-9]$/.test(base)) {
    c.key = shiftKey ? DIGIT_SHIFT[Number(base)] : base;
    c.code = `Digit${base}`;
    c.keyCode = base.charCodeAt(0);
  } else if (PUNCT[base]) {
    const [code, keyCode, shifted] = PUNCT[base];
    c.key = shiftKey ? shifted : base;
    c.code = code;
    c.keyCode = keyCode;
  } else if (/^F([1-9]|1[0-2])$/.test(base)) {
    c.keyCode = 111 + Number(base.slice(1));
  }
  return c;
}

/** keyEvent builds a keydown KeyboardEvent for a chord. */
export function keyEvent(chord: string, type = "keydown"): KeyboardEvent {
  const c = parseChord(chord);
  const ev = new KeyboardEvent(type, {
    key: c.key,
    code: c.code,
    ctrlKey: c.ctrlKey,
    metaKey: c.metaKey,
    altKey: c.altKey,
    shiftKey: c.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  // keyCode is read-only on KeyboardEvent and not settable via the init dict
  // in jsdom; prosemirror-keymap uses it for the shifted/base fallback.
  Object.defineProperty(ev, "keyCode", { get: () => c.keyCode });
  Object.defineProperty(ev, "which", { get: () => c.keyCode });
  return ev;
}

/** pressKey sends one chord through the editor's real keymap. Returns true if
 *  a handler claimed it (ProseMirror calls preventDefault on handled keys).
 *  Unhandled keys fall through to the browser's native contenteditable
 *  behaviour, which jsdom does not emulate — so plain character deletion,
 *  caret movement by arrow keys, etc. are Playwright territory. */
export function pressKey(editor: Editor, chord: string): boolean {
  const ev = keyEvent(chord);
  editor.view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;
}

/** pressKeys presses several chords in order; returns how many were handled. */
export function pressKeys(editor: Editor, ...chords: string[]): number {
  return chords.filter((c) => pressKey(editor, c)).length;
}
