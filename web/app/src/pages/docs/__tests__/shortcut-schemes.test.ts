// The Office (Word) and Google (Docs) shortcut schemes: every scheme action
// is bound in both, no chord is listed twice within a scheme, and the chords
// that differ run the right command in the right scheme only.
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  SCHEME_BINDINGS,
  schemeActionFor,
  shortcutGroups,
  shortcutHint,
  type SchemeAction,
} from "../shortcuts";
import { SHORTCUT_SCHEMES, type ShortcutScheme } from "../../../lib/shortcutScheme";
import { keyEvent } from "./keys";
import { blockPaths, makeEditor, pressKey, selectAll, textblocks } from "./harness";

// Extension storage is shared by every editor: un-pin after each test.
afterEach(() => {
  makeEditor().storage.docShortcuts.scheme = null;
});

const ACTIONS = Object.keys(SCHEME_BINDINGS.office) as SchemeAction[];

function editor(scheme: ShortcutScheme, html = "<p>Hello world</p>"): Editor {
  const e = makeEditor(html);
  e.storage.docShortcuts.scheme = scheme;
  selectAll(e);
  return e;
}
const align = (e: Editor) => (textblocks(e)[0].node.attrs.textAlign as string | null) ?? "left";

/** Every chord a scheme's dialog lists, with ranges ("Ctrl+Alt+1…6") expanded. */
function chords(scheme: ShortcutScheme): string[] {
  return shortcutGroups(scheme).flatMap((g) =>
    g.items.flatMap((r) =>
      r.keys.split(" / ").flatMap((k) => {
        const m = /^(.*\+)(\d)…(\d)$/.exec(k.trim());
        if (!m) return [k.trim()];
        const out: string[] = [];
        for (let n = Number(m[2]); n <= Number(m[3]); n++) out.push(`${m[1]}${n}`);
        return out;
      }),
    ),
  );
}

describe("shortcut scheme tables", () => {
  it.each(SHORTCUT_SCHEMES)("%s binds every scheme action", (scheme) => {
    expect(Object.keys(SCHEME_BINDINGS[scheme]).sort()).toEqual([...ACTIONS].sort());
    for (const a of ACTIONS) expect(SCHEME_BINDINGS[scheme][a].length, a).toBeGreaterThan(0);
    // ...and every dialog row has keys.
    for (const g of shortcutGroups(scheme)) for (const r of g.items) expect(r.keys, r.label).not.toBe("");
  });

  it.each(SHORTCUT_SCHEMES)("%s lists no chord twice", (scheme) => {
    const all = chords(scheme);
    const dupes = all.filter((k, i) => all.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it("only the differing actions change", () => {
    const office = shortcutGroups("office").flatMap((g) => g.items.map((r) => r.label));
    const google = shortcutGroups("google").flatMap((g) => g.items.map((r) => r.label));
    expect(google).toEqual(office);
  });

  it("menu hints follow the scheme", () => {
    expect(shortcutHint("office", "alignCenter")).toBe("Ctrl+E");
    expect(shortcutHint("google", "alignCenter")).toBe("Ctrl+Shift+E");
    expect(shortcutHint("office", "strikethrough")).toBe("Ctrl+Shift+S");
    expect(shortcutHint("google", "strikethrough")).toBe("Alt+Shift+5");
    expect(shortcutHint("office", "wordCount")).toBe("Ctrl+Shift+G");
    expect(shortcutHint("google", "wordCount")).toBe("Ctrl+Shift+C");
    expect(shortcutHint("office", "spelling")).toBe("F7");
    expect(shortcutHint("google", "spelling")).toBe("Ctrl+Alt+X");
  });
});

describe("Google scheme (Google Docs)", () => {
  it("Ctrl+Shift+L/E/R/J align; Ctrl+L/E/R/J do not", () => {
    const e = editor("google");
    expect(pressKey(e, "Mod-Shift-e")).toBe(true);
    expect(align(e)).toBe("center");
    expect(pressKey(e, "Mod-Shift-r")).toBe(true);
    expect(align(e)).toBe("right");
    expect(pressKey(e, "Mod-Shift-j")).toBe(true);
    expect(align(e)).toBe("justify");
    expect(pressKey(e, "Mod-Shift-l")).toBe(true);
    expect(align(e)).toBe("left");
    for (const k of ["Mod-l", "Mod-r", "Mod-j"]) {
      expect(pressKey(e, k), k).toBe(false);
      expect(align(e)).toBe("left");
    }
    pressKey(e, "Mod-e"); // TipTap's inline code, not alignment
    expect(align(e)).toBe("left");
  });

  it("Alt+Shift+5 strikes through; Ctrl+Shift+S does not", () => {
    const e = editor("google");
    expect(pressKey(e, "Alt-Shift-5")).toBe(true);
    expect(e.isActive("strike")).toBe(true);
    expect(pressKey(e, "Alt-Shift-5")).toBe(true);
    expect(e.isActive("strike")).toBe(false);
    expect(pressKey(e, "Mod-Shift-s")).toBe(false);
    expect(e.isActive("strike")).toBe(false);
  });

  it("lists, headings, normal text", () => {
    const e = editor("google");
    expect(pressKey(e, "Mod-Shift-7")).toBe(true);
    expect(blockPaths(e)).toEqual(["orderedList>listItem>paragraph"]);
    expect(pressKey(e, "Mod-Shift-8")).toBe(true);
    expect(blockPaths(e)).toEqual(["bulletList>listItem>paragraph"]);
    const p = editor("google");
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(pressKey(p, `Mod-Alt-${n}`)).toBe(true);
      expect(blockPaths(p)).toEqual([`heading${n}`]);
    }
    expect(pressKey(p, "Mod-Alt-0")).toBe(true);
    expect(blockPaths(p)).toEqual(["paragraph"]);
  });

  it("superscript Ctrl+., subscript Ctrl+,; Ctrl+= is not bound", () => {
    const e = editor("google");
    expect(pressKey(e, "Mod-.")).toBe(true);
    expect(e.isActive("superscript")).toBe(true);
    expect(pressKey(e, "Mod-.")).toBe(true);
    expect(pressKey(e, "Mod-,")).toBe(true);
    expect(e.isActive("subscript")).toBe(true);
    expect(pressKey(e, "Mod-,")).toBe(true);
    expect(pressKey(e, "Mod-=")).toBe(false);
    expect(pressKey(e, "Mod-Shift-=")).toBe(false);
    expect(e.isActive("subscript") || e.isActive("superscript")).toBe(false);
  });

  it("font size Ctrl+Shift+. / ,, clear formatting Ctrl+\\", () => {
    const e = editor("google", '<p><strong><span style="font-size: 10pt">Hello</span></strong></p>');
    expect(pressKey(e, "Mod-Shift-.")).toBe(true);
    expect(e.getAttributes("textStyle").fontSize).toBe("11pt");
    expect(pressKey(e, "Mod-Shift-,")).toBe(true);
    expect(e.getAttributes("textStyle").fontSize).toBe("10pt");
    expect(pressKey(e, "Mod-\\")).toBe(true);
    expect(e.isActive("bold")).toBe(false);
  });

  it("word count Ctrl+Shift+C and spelling Ctrl+Alt+X are app-level", () => {
    expect(schemeActionFor("google", keyEvent("Mod-Shift-c"))).toBe("wordCount");
    expect(schemeActionFor("google", keyEvent("Mod-Shift-g"))).toBeNull();
    expect(schemeActionFor("google", keyEvent("Mod-Alt-x"))).toBe("spelling");
    expect(schemeActionFor("google", keyEvent("F7"))).toBeNull();
    // Ctrl+Alt+X is left to the app (spelling), not converted in the editor.
    const e = editor("google");
    expect(pressKey(e, "Mod-Alt-x")).toBe(false);
  });
});

describe("Office scheme (Word), the default", () => {
  it("is the default (no preference saved)", () => {
    const e = makeEditor("<p>Hello</p>");
    expect(e.storage.docShortcuts.scheme).toBeNull(); // follows the preference
    selectAll(e);
    expect(pressKey(e, "Mod-e")).toBe(true);
    expect(align(e)).toBe("center");
  });

  it("Ctrl+L/E/R/J align (E/R/J again: left); Ctrl+Shift+L/E/R/J still work", () => {
    const e = editor("office");
    expect(pressKey(e, "Mod-e")).toBe(true);
    expect(align(e)).toBe("center");
    expect(e.isActive("code")).toBe(false);
    expect(pressKey(e, "Mod-e")).toBe(true);
    expect(align(e)).toBe("left");
    expect(pressKey(e, "Mod-r")).toBe(true);
    expect(align(e)).toBe("right");
    expect(pressKey(e, "Mod-j")).toBe(true);
    expect(align(e)).toBe("justify");
    expect(pressKey(e, "Mod-l")).toBe(true);
    expect(align(e)).toBe("left");
    expect(pressKey(e, "Mod-Shift-e")).toBe(true);
    expect(align(e)).toBe("center");
  });

  it("Ctrl+= subscript, Ctrl+Shift+= superscript", () => {
    const e = editor("office");
    expect(pressKey(e, "Mod-=")).toBe(true);
    expect(e.isActive("subscript")).toBe(true);
    expect(pressKey(e, "Mod-Shift-=")).toBe(true);
    expect(e.isActive("superscript")).toBe(true);
    expect(pressKey(e, "Mod-Shift-=")).toBe(true);
    expect(e.isActive("superscript")).toBe(false);
  });

  it("Ctrl+Shift+S strikes through; Alt+Shift+5 does not", () => {
    const e = editor("office");
    expect(pressKey(e, "Alt-Shift-5")).toBe(false);
    expect(e.isActive("strike")).toBe(false);
    expect(pressKey(e, "Mod-Shift-s")).toBe(true);
    expect(e.isActive("strike")).toBe(true);
  });

  it("Ctrl+Alt+1..3 headings, Ctrl+Space resets character formatting", () => {
    const e = editor("office", "<p><strong>Hello</strong></p>");
    for (const n of [1, 2, 3]) {
      expect(pressKey(e, `Mod-Alt-${n}`)).toBe(true);
      expect(blockPaths(e)).toEqual([`heading${n}`]);
    }
    expect(pressKey(e, "Mod-Space")).toBe(true);
    expect(e.isActive("bold")).toBe(false);
  });

  it("word count Ctrl+Shift+G (and Ctrl+Shift+C), spelling F7", () => {
    expect(schemeActionFor("office", keyEvent("Mod-Shift-g"))).toBe("wordCount");
    expect(schemeActionFor("office", keyEvent("Mod-Shift-c"))).toBe("wordCount");
    expect(schemeActionFor("office", keyEvent("F7"))).toBe("spelling");
    expect(schemeActionFor("office", keyEvent("Mod-Alt-x"))).toBeNull(); // hex to character, in the editor
  });

  it("switching the scheme takes effect on the next key press", () => {
    const e = editor("office");
    expect(pressKey(e, "Mod-e")).toBe(true);
    expect(align(e)).toBe("center");
    e.storage.docShortcuts.scheme = "google";
    expect(pressKey(e, "Mod-r")).toBe(false); // Ctrl+R is not alignment in Google
    expect(align(e)).toBe("center");
    expect(pressKey(e, "Alt-Shift-5")).toBe(true);
    expect(e.isActive("strike")).toBe(true);
  });
});
