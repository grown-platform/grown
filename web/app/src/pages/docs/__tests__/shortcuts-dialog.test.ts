// Grown-native: the Help > Keyboard shortcuts dialog lists only chords the
// editor actually handles, in both shortcut schemes. Each editing chord in
// shortcutGroups(scheme) is pressed in a fresh editor set to that scheme and
// must be claimed by a keymap handler. App-level
// chords (handled by DocEditor's window listener) and browser-native ones
// are listed explicitly below.
import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, shortcutGroups } from "../shortcuts";
import type { ShortcutScheme } from "../../../lib/shortcutScheme";
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
  "Ctrl+Shift+G", // DocEditor: word count (Office)
  "F7", // DocEditor: spelling (Office)
  "Alt+/", // DocEditor: command palette
  "Ctrl+/", // DocEditor: this dialog
  "Ctrl+Alt+M", // DocEditor: comment
  "Ctrl+Alt+Shift+H", // DocEditor: version history
  "Ctrl+Alt+V", // needs formatting copied first (tested in oo/shortcuts)
  "Ctrl+Click", // mouse (references.test.ts)
  "Alt+Enter", // needs a link at the caret (oo/shortcuts "Check visit hyperlink")
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

// Handled outside the ProseMirror keymap in one scheme only.
const NOT_EDITOR_IN: Record<ShortcutScheme, Set<string>> = {
  office: new Set(),
  google: new Set(["Ctrl+Alt+X"]), // DocEditor: spelling
};

const rowsFor = (scheme: ShortcutScheme) =>
  shortcutGroups(scheme)
    .flatMap((g) =>
      g.items.flatMap((r) =>
        r.keys.split(" / ").map((k) => ({ scheme, label: r.label, keys: k.trim() })),
      ),
    )
    .filter((r) => !NOT_EDITOR.has(r.keys) && !NOT_EDITOR_IN[scheme].has(r.keys));

describe("ShortcutsDialog lists bound chords (Grown)", () => {
  it("the default list is the Office scheme's", () => {
    expect(SHORTCUT_GROUPS).toEqual(shortcutGroups("office"));
  });

  it.each([...rowsFor("office"), ...rowsFor("google")])("$scheme $label: $keys", ({ scheme, keys }) => {
    // A two-item list so list chords (indent) apply; text selected so mark
    // and case chords have something to act on.
    const e = makeEditor("<ul><li><p>one</p></li><li><p>two words</p></li></ul>");
    e.storage.docShortcuts.scheme = scheme;
    if (/^Ctrl\+(Z|Y|Shift\+Z)$/.test(keys)) {
      typeText(e, "x"); // something to undo
      if (keys !== "Ctrl+Z") pressKey(e, "Mod-z");
    } else if (keys.endsWith("Alt+X")) {
      typeText(e, " 00e9"); // a hex code before the caret
    } else if (!/Tab|Enter|Space|Num|Alt\+-|Shift\+-|Alt\+[.GRTEFDX]|Alt\+Shift/.test(keys)) {
      selectAll(e);
    }
    expect(pressKey(e, toChord(keys))).toBe(true);
  });
});
