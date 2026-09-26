// Grown-native: the Help > Keyboard shortcuts dialog lists only chords the
// editor actually handles. Each editing chord in SHORTCUT_GROUPS is pressed
// in a fresh editor and must be claimed by a keymap handler. App-level
// chords (handled by DocEditor's window listener) and browser-native ones
// are listed explicitly below.
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS } from "../shortcuts";
import { makeEditor, pressKey, selectAll, typeText } from "./harness";

// Handled outside the ProseMirror keymap.
const NOT_EDITOR = new Set([
  "Ctrl+C", // browser copy
  "Ctrl+X", // browser cut
  "Ctrl+V", // browser paste
  "Ctrl+Shift+V", // browser paste as plain text
  "Ctrl+P", // browser print
  "Ctrl+F", // DocEditor: find bar
  "Ctrl+H", // DocEditor: find and replace
  "Ctrl+K", // DocEditor: insert link
  "Ctrl+Shift+C", // DocEditor: word count
  "Alt+/", // DocEditor: command palette
  "Ctrl+/", // DocEditor: this dialog
  "Ctrl+Alt+M", // DocEditor: comment
  "Ctrl+Alt+Shift+H", // DocEditor: version history
  "Ctrl+Alt+V", // needs formatting copied first (tested in oo/shortcuts)
]);

/** "Ctrl+Shift+." -> "Mod-Shift-."; "Num-" -> NumpadSubtract. */
function toChord(keys: string): string {
  return keys
    .replace(/…\d/, "")
    .replace("Num-", "NumpadSubtract")
    .split("+")
    .map((k) => (k === "Ctrl" ? "Mod" : k))
    .join("-");
}

const rows = SHORTCUT_GROUPS.flatMap((g) =>
  g.items.flatMap((r) =>
    r.keys.split(" / ").map((k) => ({ label: r.label, keys: k.trim() })),
  ),
).filter((r) => !NOT_EDITOR.has(r.keys));

describe("ShortcutsDialog lists bound chords (Grown)", () => {
  it.each(rows)("$label: $keys", ({ keys }) => {
    // A two-item list so list chords (indent) apply; text selected so mark
    // and case chords have something to act on.
    const e = makeEditor("<ul><li><p>one</p></li><li><p>two words</p></li></ul>");
    if (/^Ctrl\+(Z|Y|Shift\+Z)$/.test(keys)) {
      typeText(e, "x"); // something to undo
      if (keys !== "Ctrl+Z") pressKey(e, "Mod-z");
    } else if (keys === "Alt+X") {
      typeText(e, " 00e9"); // a hex code before the caret
    } else if (!/Tab|Enter|Space|Num|Alt\+-|Shift\+-|Alt\+[.GRTEFDX]|Alt\+Shift/.test(keys)) {
      selectAll(e);
    }
    expect(pressKey(e, toChord(keys))).toBe(true);
  });
});
