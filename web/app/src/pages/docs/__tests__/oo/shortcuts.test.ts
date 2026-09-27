// Ports of OnlyOffice word/shortcuts/shortcuts.js (behaviour only).
//
// OnlyOffice's tests fire a shortcut *action* (e.g. "apply heading 1"), not a
// specific key, because its key map is configurable. The ports press Grown's
// binding for the same action through the real keymap (shortcuts.ts). Where
// Grown keeps a Google Docs binding instead of OnlyOffice's, the chord used
// is marked "grown-variant".
//
// Ported elsewhere: the caret-movement, deletion and UI-event cases need a
// real browser (web/e2e/docs/oo-shortcuts.spec.ts). Not ported (n/a): "Check
// disable shortcuts" (NumLock/ScrollLock/browser zoom suppression) and
// "Check reset drag'n'drop" (OnlyOffice's own drag tracking).
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { SYMBOLS } from "../../shortcuts";
import { insertTableOfContents } from "../../references";
import { layoutOf, pagedEditor } from "../pagination-harness";
import {
  blockPaths,
  makeEditor,
  marksAt,
  paragraphPos,
  paragraphText,
  paragraphTexts,
  pressKey,
  selectAll,
  selectInParagraph,
  selectRange,
  selectedText,
  setCursor,
  textblocks,
  typeText,
} from "../harness";

/** Is `mark` active across the whole selection? */
const active = (e: Editor, mark: string, attrs?: object) => e.isActive(mark, attrs);

/** Paragraph alignment of the first textblock ("left" when unset). */
const align = (e: Editor) =>
  (textblocks(e)[0].node.attrs.textAlign as string | null) ?? "left";

/** Left indent (pt) of each textblock. */
const indents = (e: Editor) =>
  textblocks(e).map(({ node }) => (node.attrs.indent as number | null) ?? 0);

const count = (e: Editor, type: string) => {
  let n = 0;
  e.state.doc.descendants((node) => {
    if (node.type.name === type) n++;
  });
  return n;
};

describe("OnlyOffice shortcuts: breaks and characters", () => {
  it("oo:word/shortcuts/shortcuts.js#Check page break shortcut", () => {
    // OnlyOffice counts pages; with no layout in jsdom the equivalent is the
    // number of page-break nodes (each starts a new printed page).
    const e = makeEditor("<p>Hello</p>");
    for (const n of [1, 2, 3]) {
      expect(pressKey(e, "Mod-Enter")).toBe(true);
      expect(count(e, "pageBreak")).toBe(n);
    }
    // The caret stays in text after the last break, so typing continues.
    typeText(e, "World");
    expect(paragraphTexts(e)).toEqual(["Hello", "", "", "World"]);
  });

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

  it("oo:word/shortcuts/shortcuts.js#Check column break shortcut", () => {
    // Three columns; Ctrl+Shift+Enter splits the paragraph with a column
    // break node (Grown's breaks are blocks, OnlyOffice's are runs), so the
    // text "paragraph" spans one more column each time, on one page.
    const e = pagedEditor("<p>Hello</p>", { section: { cols: { num: 3, space: 36, sep: false, equal: true } } });
    const columns = () => {
      const l = layoutOf(e);
      const out: number[] = [];
      e.state.doc.forEach((n, _p, i) => {
        if (n.type.name === "paragraph") out.push(...l.blocks[i].map((p) => p.col));
      });
      expect(l.pages).toHaveLength(1);
      return out;
    };
    expect(columns()).toEqual([0]);
    expect(pressKey(e, "Mod-Shift-Enter")).toBe(true);
    expect(columns()).toEqual([0, 1]);
    expect(pressKey(e, "Mod-Shift-Enter")).toBe(true);
    expect(columns()).toEqual([0, 1, 2]);
  });

  it("oo:word/shortcuts/shortcuts.js#Check reset char shortcut", () => {
    const e = makeEditor(
      '<p><a href="https://example.com"><strong><em><u>Hello world</u></em></strong></a></p>',
    );
    selectAll(e);
    expect(active(e, "bold") && active(e, "italic") && active(e, "underline")).toBe(true);
    expect(pressKey(e, "Mod-Space")).toBe(true);
    expect(active(e, "bold") || active(e, "italic") || active(e, "underline")).toBe(false);
    // Links are content, not character formatting: they stay.
    expect(active(e, "link")).toBe(true);
  });

  it("oo:word/shortcuts/shortcuts.js#Check adding various characters", () => {
    const e = makeEditor("<p></p>");
    const steps: [string, string][] = [
      ["Mod-Shift-Space", SYMBOLS.nbsp],
      ["Mod-Alt-g", "©"],
      ["Mod-Alt-e", "€"],
      ["Mod-Alt-r", "®"],
      ["Mod-Alt-t", "™"],
      ["Mod-NumpadSubtract", "–"],
      ["Mod-Alt-NumpadSubtract", "—"],
      // OnlyOffice reports a non-breaking hyphen as "-" in plain text;
      // Grown stores the Unicode character U+2011.
      ["Mod-Shift--", SYMBOLS.nbHyphen],
      ["Mod-Alt-.", "…"],
      // grown-variant: dashes without a numeric keypad.
      ["Alt--", "–"],
      ["Alt-Shift--", "—"],
    ];
    let expected = "";
    for (const [chord, ch] of steps) {
      expect(pressKey(e, chord)).toBe(true);
      expected += ch;
      expect(paragraphText(e, 0)).toBe(expected);
    }
    // OnlyOffice's last step (the "SJK space" hotkey) inserts an ordinary
    // space; in Grown that is plain typing.
    typeText(e, " ");
    expect(paragraphText(e, 0)).toBe(expected + " ");
  });

  it("oo:word/shortcuts/shortcuts.js#Check add tab to paragraph", () => {
    const e = makeEditor("<p></p>");
    expect(pressKey(e, "Tab")).toBe(true);
    expect(paragraphText(e, 0)).toBe("\t");
  });

  it("oo:word/shortcuts/shortcuts.js#Check add new paragraph in content", () => {
    const e = makeEditor("<p>Hello text</p>");
    expect(pressKey(e, "Enter")).toBe(true);
    expect(paragraphTexts(e)).toEqual(["Hello text", ""]);
  });

  it("oo:word/shortcuts/shortcuts.js#Check replace unicode to char hotkeys", () => {
    const e = makeEditor("<p>2601</p>");
    selectInParagraph(e, 0, 0, 4);
    expect(pressKey(e, "Alt-x")).toBe(true);
    expect(selectedText(e)).toBe("☁");
    setCursor(e, paragraphPos(e, 0, 1));
    typeText(e, " 261d");
    // With nothing selected the hex digits before the caret are converted
    // (Word's rule); Cmd/Ctrl+Alt+X is the macOS-safe chord.
    expect(pressKey(e, "Mod-Alt-x")).toBe(true);
    expect(selectedText(e)).toBe("☝");
    expect(paragraphText(e, 0)).toBe("☁ ☝");
  });
});

describe("OnlyOffice shortcuts: formatting", () => {
  it("oo:word/shortcuts/shortcuts.js#Check text property change", () => {
    const e = makeEditor('<p><span style="font-size: 10pt">Hello world</span></p>');
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
    // Font size steps 10 -> 11 -> 12 -> 14 -> 16 and back.
    const size = () => e.getAttributes("textStyle").fontSize as string;
    for (const pt of [11, 12, 14, 16]) {
      expect(pressKey(e, "Mod-Shift-.")).toBe(true);
      expect(size()).toBe(`${pt}pt`);
    }
    for (const pt of [14, 12, 11, 10]) {
      expect(pressKey(e, "Mod-Shift-,")).toBe(true);
      expect(size()).toBe(`${pt}pt`);
    }
  });

  it("oo:word/shortcuts/shortcuts.js#Check paragraph property change", () => {
    const e = makeEditor("<p>Hello world</p>");
    // grown-variant: headings are Ctrl+Alt+1-3 (Google Docs), not Alt+1-3.
    for (const n of [1, 2, 3]) {
      pressKey(e, `Mod-Alt-${n}`);
      expect(blockPaths(e)).toEqual([`heading${n}`]);
    }
    expect(align(e)).toBe("left");
    // Center / justify / right toggle back to left when pressed again.
    pressKey(e, "Mod-Shift-e");
    expect(align(e)).toBe("center");
    pressKey(e, "Mod-Shift-e");
    expect(align(e)).toBe("left");
    pressKey(e, "Mod-Shift-j");
    expect(align(e)).toBe("justify");
    pressKey(e, "Mod-Shift-j");
    expect(align(e)).toBe("left");
    pressKey(e, "Mod-Shift-j");
    expect(align(e)).toBe("justify");
    // grown-variant: align left is Ctrl+Shift+L (Ctrl+L in OnlyOffice), and
    // pressing it on a left-aligned paragraph leaves it left (OnlyOffice
    // restores the previous alignment).
    pressKey(e, "Mod-Shift-l");
    expect(align(e)).toBe("left");
    pressKey(e, "Mod-Shift-r");
    expect(align(e)).toBe("right");
    pressKey(e, "Mod-Shift-r");
    expect(align(e)).toBe("left");

    // Ctrl+M / Ctrl+Shift+M indent by one step. Grown's step is 0.5in
    // (36pt, the Google Docs step); OnlyOffice uses 12.5mm.
    expect(pressKey(e, "Mod-m")).toBe(true);
    expect(indents(e)).toEqual([36]);
    expect(pressKey(e, "Mod-Shift-m")).toBe(true);
    expect(indents(e)).toEqual([0]);

    // Tab / Shift+Tab with whole paragraphs selected indent all of them.
    e.chain().insertContentAt(e.state.doc.content.size, "<p>Hello</p>").run();
    selectAll(e);
    expect(pressKey(e, "Tab")).toBe(true);
    expect(indents(e)).toEqual([36, 36]);
    expect(pressKey(e, "Shift-Tab")).toBe(true);
    expect(indents(e)).toEqual([0, 0]);

    // Google Docs' Ctrl+] / Ctrl+[ do the same.
    pressKey(e, "Mod-]");
    pressKey(e, "Mod-]");
    expect(indents(e)).toEqual([72, 72]);
    pressKey(e, "Mod-[");
    expect(indents(e)).toEqual([36, 36]);
  });

  it("oo:word/shortcuts/shortcuts.js#Check toggle bullet list", () => {
    // grown-variant: OnlyOffice binds Ctrl+Shift+L; Grown keeps Ctrl+Shift+8
    // (Google Docs / TipTap) because Ctrl+Shift+L is align left.
    const e = makeEditor("<p></p>");
    expect(blockPaths(e)).toEqual(["paragraph"]);
    expect(pressKey(e, "Mod-Shift-8")).toBe(true);
    expect(blockPaths(e)).toEqual(["bulletList>listItem>paragraph"]);
    // Ctrl+M inside a list nests the item (it needs a previous sibling).
    const l = makeEditor("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
    expect(pressKey(l, "Mod-m")).toBe(true);
    expect(blockPaths(l)[1]).toBe("bulletList>listItem>bulletList>listItem>paragraph");
    expect(pressKey(l, "Mod-Shift-m")).toBe(true);
    expect(blockPaths(l)[1]).toBe("bulletList>listItem>paragraph");
  });

  it("oo:word/shortcuts/shortcuts.js#Check copy/paste format", () => {
    const e = makeEditor("<p><strong><em><u>Hello</u></em></strong></p><p></p>");
    setCursor(e, paragraphPos(e, 0, 2));
    expect(pressKey(e, "Mod-Alt-c")).toBe(true);
    // Into an empty paragraph: the formatting applies to what is typed.
    setCursor(e, paragraphPos(e, 1, 0));
    expect(pressKey(e, "Mod-Alt-v")).toBe(true);
    typeText(e, "World");
    expect(marksAt(e, 1, 0)).toEqual(["bold", "italic", "underline"]);
    // Onto a selection: replaces its character formatting.
    const f = makeEditor("<p><strong>Bold</strong> <em>plain</em></p>");
    setCursor(f, paragraphPos(f, 0, 1));
    pressKey(f, "Mod-Alt-c");
    selectInParagraph(f, 0, 5, 10);
    pressKey(f, "Mod-Alt-v");
    expect(marksAt(f, 0, 6)).toEqual(["bold"]);
  });
});

describe("OnlyOffice shortcuts: document", () => {
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

  it("oo:word/shortcuts/shortcuts.js#Check insert note elements", () => {
    // Footnote Ctrl+Alt+F (Word and Google Docs), endnote Ctrl+Alt+D (Word).
    const e = makeEditor("<p></p>");
    expect(pressKey(e, "Mod-Alt-f")).toBe(true);
    expect(count(e, "footnote")).toBe(1);
    expect(pressKey(e, "Mod-Alt-d")).toBe(true);
    expect(count(e, "endnote")).toBe(1);
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

  it("oo:word/shortcuts/shortcuts.js#Check save", () => {
    // Docs save continuously; Ctrl+S is swallowed (no "Save page as") and
    // reported to the app.
    const e = makeEditor("<p>Hello</p>");
    let saved = 0;
    e.storage.docShortcuts.onSave = () => saved++;
    expect(pressKey(e, "Mod-s")).toBe(true);
    expect(saved).toBe(1);
  });

  it("oo:word/shortcuts/shortcuts.js#Check movement in table", () => {
    const cells = Array.from({ length: 3 }, (_, r) =>
      `<tr>${Array.from({ length: 4 }, (_, c) => `<td><p>${r}${c}</p></td>`).join("")}</tr>`,
    ).join("");
    const e = makeEditor(`<p></p><table><tbody>${cells}</tbody></table>`);
    setCursor(e, paragraphPos(e, 1, 0));
    const cellIndex = () => {
      const $p = e.state.selection.$from;
      for (let d = $p.depth; d > 0; d--) {
        if ($p.node(d).type.name === "tableCell") return $p.index(d - 1);
      }
      return -1;
    };
    expect(cellIndex()).toBe(0);
    for (const i of [1, 2, 3]) {
      expect(pressKey(e, "Tab")).toBe(true);
      expect(cellIndex()).toBe(i);
    }
    for (const i of [2, 1, 0]) {
      expect(pressKey(e, "Shift-Tab")).toBe(true);
      expect(cellIndex()).toBe(i);
    }
  });

  it("reset char keeps suggestion marks (Grown)", () => {
    const e = makeEditor("<p>abc</p>", { suggesting: true });
    setCursor(e, paragraphPos(e, 0, 3));
    typeText(e, "d");
    selectRange(e, paragraphPos(e, 0, 0), paragraphPos(e, 0, 4));
    pressKey(e, "Mod-b");
    pressKey(e, "Mod-Space");
    expect(marksAt(e, 0, 3)).toEqual(["insertion"]);
  });
});

describe("OnlyOffice shortcuts: later milestones", () => {
  it("oo:word/shortcuts/shortcuts.js#Check insert equation", () => {
    // Ctrl+Alt+= (Word: Alt+=) inserts an equation at the caret.
    const e = makeEditor("<p></p>");
    pressKey(e, "Mod-Alt-=");
    let found = false;
    e.state.doc.descendants((n) => {
      if (n.type.name === "math") found = true;
    });
    expect(found).toBe(true);
  });
  it("oo:word/shortcuts/shortcuts.js#Check insert page number", () => {
    // grown-variant chord: Alt+Shift+P (Word's); OnlyOffice's own binding
    // is Ctrl+Shift+P. Inserts a PAGE field at the caret (M8).
    const e = makeEditor("<p></p>");
    expect(pressKey(e, "Alt-Shift-p")).toBe(true);
    const first = e.state.doc.firstChild!.firstChild!;
    expect(first.type.name).toBe("field");
    expect(first.attrs.instr).toBe("PAGE");
    expect(paragraphText(e)).toBe("1");
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check show/hide non printing symbols", () => {
    // TODO(M13): non-printing characters view. OnlyOffice's Ctrl+Shift+8
    // is Grown's bulleted list; the toggle will need another chord.
  });
  it("oo:word/shortcuts/shortcuts.js#Check update fields", () => {
    // Three Heading 1 paragraphs, a table of contents at the start, a
    // fourth heading added afterwards: F9 with the caret in the table
    // updates it from 3 to 4 entries.
    const e = makeEditor("<h1>Hello</h1><h1>Hello</h1><h1>Hello</h1>", { cursor: "start" });
    insertTableOfContents(e);
    const entries = () => e.state.doc.firstChild!.type.name === "tableOfContents" ? e.state.doc.firstChild!.childCount : -1;
    expect(entries()).toBe(3);
    setCursor(e, e.state.doc.content.size - 1);
    e.commands.insertContent({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] });
    expect(entries()).toBe(3);
    setCursor(e, 2); // start of the table, one step right
    expect(pressKey(e, "F9")).toBe(true);
    expect(entries()).toBe(4);
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check actions with shapes", () => {
    // TODO(M7): arrow-key nudging, Tab between objects, Enter into a shape.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check actions with headers/footers", () => {
    // TODO(M9): per-page headers/footers and moving between them.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check reset actions shortcut", () => {
    // TODO(M7): Escape cancels shape insertion / sticky format painter.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check filling forms", () => {
    // TODO(M10): checkbox content controls in form-filling mode.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check movement selecting forms", () => {
    // TODO(M10): Tab moves between form fields.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check select all in chart title", () => {
    // TODO(M7): chart node.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check add new paragraph math", () => {
    // Not planned for M11: Grown edits an equation in its equation panel, so
    // Enter commits the equation instead of splitting the paragraph at a
    // caret inside it.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Test add new line to math", () => {
    // Not planned for M11: Shift+Enter inside an equation argument (turning
    // it into an equation array) needs in-place caret editing of equations.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check remove form", () => {
    // TODO(M10): content controls.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check add break line to inlinelvlsdt", () => {
    // TODO(M10): multi-line complex form.
  });
  it("oo:word/shortcuts/shortcuts.js#Check visit hyperlink", () => {
    // A page break, then a link to the beginning of the document ("_top").
    // grown-variant chord: Alt+Enter follows the link at the caret (Google
    // Docs); OnlyOffice uses Enter on a selected link, Word Ctrl+click
    // (also bound, see references.test.ts).
    const e = makeEditor('<p></p><div data-page-break></div><p><a href="#_top">Beginning of document</a></p>');
    setCursor(e, e.state.doc.content.size - 3);
    expect(pressKey(e, "Alt-Enter")).toBe(true);
    expect(e.state.selection.from).toBe(1);
    expect(e.state.selection.$from.index(0)).toBe(0);
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check handle tab in math", () => {
    // Not planned for M11: equation line breaks and alignment points (m:brk,
    // m:alnAt) are not modelled.
  });
  it.skip("oo:word/shortcuts/shortcuts.js#Check end editing form", () => {
    // TODO(M10): content controls.
  });
});
