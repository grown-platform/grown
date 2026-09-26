// Ports of OnlyOffice word/shortcuts/shortcuts.js (behaviour only).
//
// OnlyOffice's tests fire a shortcut *action* (e.g. "apply heading 1"), not a
// specific key, because its key map is configurable. The ports press Grown's
// binding for the same action through the real keymap — so where Grown binds
// the action to a different chord (Google Docs conventions), that chord is
// used and noted.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  blockPaths,
  makeEditor,
  paragraphText,
  paragraphTexts,
  pressKey,
  selectAll,
  typeText,
} from "../harness";


/** Is `mark` active across the whole selection? */
const active = (e: Editor, mark: string, attrs?: object) => e.isActive(mark, attrs);

/** Paragraph alignment of the first textblock ("left" when unset). */
const align = (e: Editor) =>
  (e.state.doc.firstChild?.attrs.textAlign as string | null) ?? "left";

describe("OnlyOffice shortcuts", () => {
  it("oo:word/shortcuts/shortcuts.js#Check line break shortcut", () => {
    // OnlyOffice counts laid-out lines; with no layout in jsdom the
    // equivalent is 1 + the number of hard breaks in the paragraph.
    const e = makeEditor("<p></p>");
    const lines = () => paragraphText(e, 0).split("\n").length;
    for (const expected of [2, 3, 4]) {
      expect(pressKey(e, "Shift-Enter")).toBe(true);
      expect(lines()).toBe(expected);
    }
    expect(paragraphTexts(e)).toHaveLength(1);
  });

  it("oo:word/shortcuts/shortcuts.js#Check select all shortcut", () => {
    const e = makeEditor(
      "<p>Hello world</p><table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr>" +
        "<tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>",
    );
    expect(e.state.selection.empty).toBe(true);
    expect(pressKey(e, "Mod-a")).toBe(true);
    const { from, to } = e.state.selection;
    expect(from).toBe(0);
    expect(to).toBe(e.state.doc.content.size);
  });

  it("oo:word/shortcuts/shortcuts.js#Check toggle bullet list", () => {
    // OnlyOffice: Ctrl+Shift+L. Grown: Ctrl+Shift+8 (Google Docs / TipTap).
    const e = makeEditor("<p></p>");
    expect(blockPaths(e)).toEqual(["paragraph"]);
    expect(pressKey(e, "Mod-Shift-8")).toBe(true);
    expect(blockPaths(e)).toEqual(["bulletList>listItem>paragraph"]);
  });

  it("oo:word/shortcuts/shortcuts.js#Check undo/redo history", () => {
    // In the app Yjs owns undo; the headless editor uses ProseMirror
    // history, which exposes the same Mod-z / Mod-Shift-z bindings.
    const e = makeEditor("<p>Hello</p>");
    typeText(e, " World");
    expect(paragraphText(e, 0)).toBe("Hello World");
    expect(pressKey(e, "Mod-z")).toBe(true);
    expect(paragraphText(e, 0)).toBe("Hello");
    expect(pressKey(e, "Mod-Shift-z")).toBe(true);
    expect(paragraphText(e, 0)).toBe("Hello World");
  });

  it.skip("oo:word/shortcuts/shortcuts.js#Check text property change", () => {
    // TODO(M1): the mark toggles all pass today (Mod-b/i/u, Mod-Shift-s
    // strike, Mod-. superscript, Mod-, subscript), but Increase/Decrease font
    // size (OnlyOffice steps 10->11->12->14->16 and back) has no key binding
    // in Grown — Format menu only, and it steps by 1pt.
    const e = makeEditor("<p>Hello world</p>");
    selectAll(e);
    for (const [chord, mark] of [
      ["Mod-b", "bold"],
      ["Mod-i", "italic"],
      ["Mod-Shift-s", "strike"],
      ["Mod-u", "underline"],
      ["Mod-.", "superscript"],
      ["Mod-,", "subscript"],
    ] as const) {
      pressKey(e, chord);
      expect(active(e, mark)).toBe(true);
      pressKey(e, chord);
      expect(active(e, mark)).toBe(false);
    }
    const size = () => e.getAttributes("textStyle").fontSize as string;
    for (const pt of [11, 12, 14, 16]) {
      pressKey(e, "Mod-Shift-.");
      expect(size()).toBe(`${pt}pt`);
    }
    for (const pt of [14, 12, 11, 10]) {
      pressKey(e, "Mod-Shift-,");
      expect(size()).toBe(`${pt}pt`);
    }
  });

  it.skip("oo:word/shortcuts/shortcuts.js#Check paragraph property change", () => {
    // TODO(M1): headings (Grown: Mod-Alt-1..3) and setting alignment pass,
    // but Grown's align shortcuts don't toggle back to left when pressed
    // again, and Ctrl+M / Ctrl+Shift+M paragraph indent is not bound
    // (Tab indents list items only).
    const e = makeEditor("<p>Hello world</p>");
    for (const n of [1, 2, 3]) {
      pressKey(e, `Mod-Alt-${n}`);
      expect(blockPaths(e)).toEqual([`heading${n}`]);
    }
    pressKey(e, "Mod-Shift-e");
    expect(align(e)).toBe("center");
    pressKey(e, "Mod-Shift-e");
    expect(align(e)).toBe("left");
    pressKey(e, "Mod-Shift-j");
    expect(align(e)).toBe("justify");
    pressKey(e, "Mod-Shift-j");
    expect(align(e)).toBe("left");
    pressKey(e, "Mod-Shift-r");
    expect(align(e)).toBe("right");
    pressKey(e, "Mod-Shift-r");
    expect(align(e)).toBe("left");
    expect(pressKey(e, "Mod-m")).toBe(true);
  });

  it.skip("oo:word/shortcuts/shortcuts.js#Check page break shortcut", () => {
    // TODO(M1): Grown has a pageBreak node (Insert > Page break) but no
    // Ctrl+Enter binding.
    const e = makeEditor("<p>Hello</p>");
    for (const n of [1, 2, 3]) {
      pressKey(e, "Mod-Enter");
      let breaks = 0;
      e.state.doc.descendants((node) => {
        if (node.type.name === "pageBreak") breaks++;
      });
      expect(breaks).toBe(n);
    }
  });

  it.skip("oo:word/shortcuts/shortcuts.js#Check reset char shortcut", () => {
    // TODO(M1): Ctrl+Space (clear character formatting) is not bound;
    // Format > Clear formatting exists without a key.
    const e = makeEditor("<p><strong><em><u>Hello world</u></em></strong></p>");
    selectAll(e);
    pressKey(e, "Mod-Space");
    expect(active(e, "bold") || active(e, "italic") || active(e, "underline")).toBe(false);
  });

  it.skip("oo:word/shortcuts/shortcuts.js#Check adding various characters", () => {
    // TODO(M1): no shortcuts for non-breaking space, ©, €, ®, ™, en/em
    // dash, non-breaking hyphen or ellipsis.
    const e = makeEditor("<p></p>");
    pressKey(e, "Mod-Shift-Space");
    expect(paragraphText(e, 0)).toBe(" ");
  });

  it.skip("oo:word/shortcuts/shortcuts.js#Check remove symbols", () => {
    // TODO(M1, Playwright): deleting a character or a word with
    // (Ctrl+)Backspace/Delete inside a text run is native contenteditable
    // behaviour that ProseMirror leaves to the browser; jsdom does not
    // emulate it. Port to web/e2e/docs/oo-shortcuts.spec.ts.
    const e = makeEditor("<p>Hello Hello</p>");
    pressKey(e, "Backspace");
    expect(paragraphText(e, 0)).toBe("Hello Hell");
  });
});
