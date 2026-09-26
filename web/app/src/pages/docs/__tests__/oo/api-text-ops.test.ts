// Ports of OnlyOffice's text-operation tests (behaviour only):
//   word/api/api.js                     document API: add text, spacing, numbering
//   word/js-api/api-document-content.js GetText with separators
//   word/js-api/api-range.js            range text / colour / shading
//   word/js-api/api-run.js              run text / colour / shading
// OnlyOffice drives its model through API objects; the ports drive Grown's
// editor through the same user-level operations (typing, keys, commands)
// and the helpers in textOps.ts / paragraphFormat.ts.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  blockPaths,
  makeEditor,
  paragraphPos,
  paragraphText,
  paragraphTexts,
  pressKey,
  selectAll,
  selectedText,
  selectInParagraph,
  selectRange,
  setCursor,
  textblocks,
  typeText,
} from "../harness";
import {
  addText,
  getParagraphShading,
  getRunShading,
  getSelectedText,
  getText,
  getTextColor,
  rgbHex,
  runsOf,
  setRangeShading,
  setRunShading,
  setTextColor,
} from "../../textOps";
import { hasSpaceAfter, hasSpaceBefore, spacingOf } from "../../paragraphFormat";

/** Empty doc, then text typed as a user would. */
function withText(text: string): Editor {
  const e = makeEditor("<p></p>");
  addText(e, text);
  return e;
}

/** Text of the whole document with no paragraph separators. */
const flatText = (e: Editor) => getText(e, { paraSeparator: "" });

describe("OnlyOffice api", () => {
  it("oo:word/api/api.js#Test AddText/RemoveSelection", () => {
    const e = makeEditor("<p></p>");
    selectAll(e);
    expect(getSelectedText(e)).toBe("\r\n");

    // Typing over a select-all replaces the document.
    addText(e, "Hello World!");
    selectAll(e);
    expect(getSelectedText(e)).toBe("Hello World!\r\n");

    // Add a second paragraph and type into it.
    e.chain().insertContentAt(e.state.doc.content.size, { type: "paragraph" }).run();
    setCursor(e, paragraphPos(e, 1, 0));
    addText(e, "Second paragraph");
    selectAll(e);
    expect(getSelectedText(e)).toBe("Hello World!\r\nSecond paragraph\r\n");

    // Adding text over select-all collapses everything into one paragraph.
    addText(e, "Test");
    selectAll(e);
    expect(getSelectedText(e)).toBe("Test\r\n");
    expect(paragraphTexts(e)).toEqual(["Test"]);

    // Insert "123" at several caret positions, plain and wrapped with spaces.
    const cases: [string, number, string, string][] = [
      // text, caret offset, plain result, wrap-with-spaces result
      ["Text", 3, "Tex123t", "Tex 123 t"],
      ["Tex t", 4, "Tex 123t", "Tex 123 t"],
      ["Tex t", 3, "Tex123 t", "Tex 123 t"],
      ["Text", 4, "Text123", "Text 123"],
      ["Text", 0, "123Text", "123 Text"],
    ];
    for (const [text, at, plain, wrapped] of cases) {
      for (const wrapWithSpaces of [false, true]) {
        const f = withText(text);
        setCursor(f, paragraphPos(f, 0, at));
        addText(f, "123", { wrapWithSpaces });
        expect(flatText(f)).toBe(wrapWithSpaces ? wrapped : plain);
      }
    }
  });

  it("oo:word/api/api.js#Change numbering level", () => {
    // Two numbered items; the second is empty.
    const e = makeEditor("<ol><li><p>First</p></li><li><p></p></li></ol>");
    const OL = "orderedList>listItem>paragraph";
    expect(blockPaths(e)).toEqual([OL, OL]);

    // Enter in an empty top-level item ends the list.
    setCursor(e, paragraphPos(e, 1, 0));
    expect(pressKey(e, "Enter")).toBe(true);
    expect(blockPaths(e)).toEqual([OL, "paragraph"]);

    // Re-applying numbering rejoins the same list (same numbering).
    setCursor(e, paragraphPos(e, 1, 0));
    e.commands.toggleOrderedList();
    expect(blockPaths(e)).toEqual([OL, OL]);
    expect(e.state.doc.childCount).toBe(1);

    // Tab demotes it to level 2 …
    expect(pressKey(e, "Tab")).toBe(true);
    expect(blockPaths(e)).toEqual([OL, `${OL.replace(/>paragraph$/, "")}>${OL}`]);

    // … and Enter in the empty level-2 item promotes it back to level 1.
    expect(pressKey(e, "Enter")).toBe(true);
    expect(blockPaths(e)).toEqual([OL, OL]);
  });

  it("oo:word/api/api.js#Test add/remove space before/after paragraph", () => {
    // Grown's defaults: Normal text has 0pt before and 9pt (0.75em) after;
    // "add space" uses the first paragraph's default for that side, or 12pt.
    const e = makeEditor("<p>A</p><p>B</p><p>C</p>");
    const spacing = () =>
      textblocks(e).map(({ node }) => {
        const s = spacingOf(node);
        return [s.before, s.after];
      });
    const has = () => [hasSpaceBefore(e.state), hasSpaceAfter(e.state)];
    const selectParas = (a: number, b: number) =>
      selectRange(e, paragraphPos(e, a, 0), paragraphPos(e, b, 1));

    expect(spacing()).toEqual([[0, 9], [0, 9], [0, 9]]);
    setCursor(e, paragraphPos(e, 0, 0));
    expect(has()).toEqual([false, true]);

    e.commands.addSpaceBefore();
    expect(spacing()).toEqual([[12, 9], [0, 9], [0, 9]]);
    expect(has()).toEqual([true, true]);

    setCursor(e, paragraphPos(e, 1, 0));
    e.commands.removeSpaceAfter();
    expect(spacing()).toEqual([[12, 9], [0, 0], [0, 9]]);
    expect(has()).toEqual([false, false]);

    selectParas(0, 2);
    e.commands.removeSpaceAfter();
    expect(spacing()).toEqual([[12, 0], [0, 0], [0, 0]]);
    expect(has()).toEqual([true, false]);

    e.commands.removeSpaceBefore();
    expect(spacing()).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(has()).toEqual([false, false]);

    e.commands.addSpaceBefore();
    expect(spacing()).toEqual([[12, 0], [12, 0], [12, 0]]);
    expect(has()).toEqual([true, false]);

    e.commands.addSpaceAfter();
    expect(spacing()).toEqual([[12, 9], [12, 9], [12, 9]]);
    expect(has()).toEqual([true, true]);

    // Style-aware: OnlyOffice uses a paragraph style with its own spacing;
    // Grown's equivalent is a heading, whose default margins (Heading 2:
    // 14.9pt) replace Normal text's.
    const h = makeEditor(
      '<p style="margin-top: 12pt">A</p><h2 style="margin-top: 12pt">B</h2><p style="margin-top: 12pt">C</p>',
    );
    const hs = () =>
      textblocks(h).map(({ node }) => {
        const s = spacingOf(node);
        return [s.before, s.after];
      });
    const hHas = () => [hasSpaceBefore(h.state), hasSpaceAfter(h.state)];
    selectRange(h, paragraphPos(h, 1, 0), paragraphPos(h, 2, 1));

    h.commands.removeSpaceBefore();
    expect(hs()).toEqual([[12, 9], [0, 14.9], [0, 9]]);
    expect(hHas()).toEqual([false, true]);

    // "Add" takes the heading's default and gives it to both paragraphs.
    h.commands.addSpaceBefore();
    expect(hs()).toEqual([[12, 9], [14.9, 14.9], [14.9, 9]]);
    expect(hHas()).toEqual([true, true]);

    h.commands.removeSpaceAfter();
    expect(hs()).toEqual([[12, 9], [14.9, 0], [14.9, 0]]);
    expect(hHas()).toEqual([true, false]);

    h.commands.addSpaceAfter();
    expect(hs()).toEqual([[12, 9], [14.9, 14.9], [14.9, 14.9]]);
    expect(hHas()).toEqual([true, true]);

    h.commands.removeSpaceAfter();
    expect(hs()).toEqual([[12, 9], [14.9, 0], [14.9, 0]]);
    expect(hHas()).toEqual([true, false]);

    // The spacing is stored on the paragraph and survives an HTML round trip.
    const html = h.getHTML();
    const back = makeEditor(html);
    expect(textblocks(back).map(({ node }) => spacingOf(node))).toEqual(
      textblocks(h).map(({ node }) => spacingOf(node)),
    );
  });

  it("oo:word/api/api.js#Get text/selected text", () => {
    // Plain-text half; the equation half is skipped below.
    const e = makeEditor("<p>The quick brown fox jumps over the lazy dog</p>");
    setCursor(e, paragraphPos(e, 0, 4));
    expect(getSelectedText(e)).toBe("");
    selectInParagraph(e, 0, 4, 9);
    expect(getSelectedText(e)).toBe("quick");
    expect(selectedText(e)).toBe("quick");
  });

  it.skip("Get text/selected text: selection inside an equation", () => {
    // TODO(M11): the second half of the OnlyOffice case selects part of an
    // equation ("abcd" -> "bc"), which needs the math node.
  });
});

// A paragraph "123<tab>456<line break>789", then a 2x2 table A B / C D,
// then an empty paragraph (a table can't end the document).
const DOC_WITH_TABLE: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "123\t456" },
        { type: "hardBreak" },
        { type: "text", text: "789" },
      ],
    },
    {
      type: "table",
      content: [
        ["A", "B"],
        ["C", "D"],
      ].map((row) => ({
        type: "tableRow",
        content: row.map((t) => ({
          type: "tableCell",
          content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
        })),
      })),
    },
    { type: "paragraph" },
  ],
};

describe("OnlyOffice js-api: document content", () => {
  it("oo:word/js-api/api-document-content.js#GetText", () => {
    const e = makeEditor("<p></p>");
    e.commands.setContent(DOC_WITH_TABLE);
    expect(getText(e)).toBe("123\t456\r789\r\nA\tB\r\nC\tD\r\n\r\n");
    expect(
      getText(e, {
        tabSymbol: "_t_",
        newLineSeparator: "_nl_",
        tableCellSeparator: "_c_",
        tableRowSeparator: "_r_",
        paraSeparator: "_p_",
      }),
    ).toBe("123_t_456_nl_789_p_A_c_B_r_C_c_D_r__p_");
  });
});

/** Types "1<Tab>2<Shift+Enter>3" into an empty document. */
function tabAndBreak(): Editor {
  const e = makeEditor("<p></p>");
  typeText(e, "1");
  expect(pressKey(e, "Tab")).toBe(true);
  typeText(e, "2");
  expect(pressKey(e, "Shift-Enter")).toBe(true);
  typeText(e, "3");
  return e;
}

const firstRun = (e: Editor) => {
  const [b] = textblocks(e);
  return runsOf(b.node, b.pos)[0];
};

const paragraphRange = (e: Editor, i = 0) => {
  const b = textblocks(e)[i];
  return { from: b.pos, to: b.pos + b.node.content.size };
};

const SEPARATORS = { tabSymbol: "_t_", newLineSeparator: "_nl_" };

describe("OnlyOffice js-api: run", () => {
  it("oo:word/js-api/api-run.js#GetText/AddText", () => {
    const empty = makeEditor("<p></p>");
    expect(textblocks(empty)[0].node.childCount).toBe(0);
    const e = tabAndBreak();
    const run = firstRun(e);
    expect(getText(e, {}, run.from, run.to)).toBe("1\t2\r3");
    expect(getText(e, SEPARATORS, run.from, run.to)).toBe("1_t_2_nl_3");
  });

  it("oo:word/js-api/api-run.js#SetColor, GetColor", () => {
    const e = makeEditor('<p><span style="font-size: 14pt">Colour me</span></p>');
    const { from, to } = firstRun(e);
    expect(getTextColor(e, from, to)).toBe(null);
    setTextColor(e, from, to, rgbHex(255, 127, 0));
    expect(getTextColor(e, from, to)).toBe("#ff7f00");
    setTextColor(e, from, to, "#BADA55");
    expect(getTextColor(e, from, to)).toBe("#bada55");
    // Other text-style attributes survive a colour change.
    expect(e.getAttributes("textStyle").fontSize).toBe("14pt");
    // Theme colours are n/a (Grown has no document theme); "auto" colour is
    // no colour.
    setTextColor(e, from, to, null);
    expect(getTextColor(e, from, to)).toBe(null);
    expect(paragraphText(e, 0)).toBe("Colour me");
  });

  it("oo:word/js-api/api-run.js#SetShd, GetShd", () => {
    const e = makeEditor("<p>Shade me</p>");
    const { from, to } = firstRun(e);
    expect(getRunShading(e, from, to)).toBe(null);
    setRunShading(e, from, to, rgbHex(255, 127, 0));
    expect(getRunShading(e, from, to)).toBe("#ff7f00");
    setRunShading(e, from, to, "#BADA55");
    expect(getRunShading(e, from, to)).toBe("#bada55");
    setRunShading(e, from, to, null);
    expect(getRunShading(e, from, to)).toBe(null);
  });
});

describe("OnlyOffice js-api: range", () => {
  it("oo:word/js-api/api-range.js#GetText/AddText", () => {
    const e = tabAndBreak();
    const { from, to } = paragraphRange(e);
    expect(getText(e, {}, from, to)).toBe("1\t2\r3");
    expect(getText(e, SEPARATORS, from, to)).toBe("1_t_2_nl_3");
  });

  it("oo:word/js-api/api-range.js#SetColor, GetColor", () => {
    const e = makeEditor("<p>Paragraph for testing range color</p>");
    const { from, to } = paragraphRange(e);
    expect(getTextColor(e, from, to)).toBe(null);
    setTextColor(e, from, to, rgbHex(80, 160, 240));
    expect(getTextColor(e, from, to)).toBe("#50a0f0");
    setTextColor(e, from, to, rgbHex(255, 127, 0));
    expect(getTextColor(e, from, to)).toBe("#ff7f00");
    setTextColor(e, from, to, "#BADA55");
    expect(getTextColor(e, from, to)?.toUpperCase()).toBe("#BADA55");
    setTextColor(e, from, to, null);
    expect(getTextColor(e, from, to)).toBe(null);
  });

  it("oo:word/js-api/api-range.js#SetShd, GetShd", () => {
    // A range covering a whole paragraph shades the paragraph itself.
    const e = makeEditor("<p>Paragraph for testing range color</p>");
    const { from, to } = paragraphRange(e);
    expect(getParagraphShading(e, from)).toBe(null);
    setRangeShading(e, from, to, rgbHex(80, 160, 240));
    expect(getParagraphShading(e, from)).toBe("#50a0f0");
    setRangeShading(e, from, to, rgbHex(255, 127, 0));
    expect(getParagraphShading(e, from)).toBe("#ff7f00");
    setRangeShading(e, from, to, "#BADA55");
    expect(getParagraphShading(e, from)?.toUpperCase()).toBe("#BADA55");
    expect(e.getHTML()).toContain("background-color");
    setRangeShading(e, from, to, null);
    expect(getParagraphShading(e, from)).toBe(null);
    // A partial range shades only its text.
    setRangeShading(e, from, from + 9, "#bada55");
    expect(getParagraphShading(e, from)).toBe(null);
    expect(getRunShading(e, from, from + 9)).toBe("#bada55");
  });
});
