// Ports of OnlyOffice word/js-api/api-paragraph.js (behaviour only), plus
// Grown tests for the M3 paragraph properties (indents, tabs, line rules,
// keep/widow/page-break, borders, outline level): commands, HTML render /
// parse round trip and Yjs persistence.
//
// Not ported: "ParaId" (w14:paraId is a DOCX identity with no Grown
// equivalent; n/a). GetRange's "detached paragraph throws" half is n/a:
// every Grown paragraph lives in the document.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import {
  makeEditor,
  makeSyncedEditors,
  pressKey,
  selectAll,
  setCursor,
  textblocks,
  typeText,
} from "../harness";
import { getParagraphShading, getText, getTextColor, rgbHex, setTextColor } from "../../textOps";
import { directProps, parseTabs } from "../../paragraphProps";

/** [from, to) of textblock i's content, and `mark` = to + 1 (includes the
 *  paragraph mark). */
const range = (e: Editor, i = 0) => {
  const b = textblocks(e)[i];
  return { from: b.pos, to: b.pos + b.node.content.size, mark: b.pos + b.node.content.size + 1 };
};

describe("OnlyOffice js-api: paragraph", () => {
  it("oo:word/js-api/api-paragraph.js#GetText", () => {
    const e = makeEditor("<p></p>");
    typeText(e, "123");
    pressKey(e, "Tab");
    typeText(e, "456");
    pressKey(e, "Shift-Enter");
    typeText(e, "789");
    const { from, mark } = range(e);
    expect(getText(e, {}, from, mark)).toBe("123\t456\r789\r\n");
    expect(getText(e, { tabSymbol: "_t_", newLineSeparator: "_nl_" }, from, mark)).toBe(
      "123_t_456_nl_789\r\n",
    );
  });

  it("oo:word/js-api/api-paragraph.js#SetShd, GetShd", () => {
    const e = makeEditor("<p>Shade</p>");
    const { from } = range(e);
    expect(getParagraphShading(e, from)).toBe(null);
    e.commands.setParagraphShading(rgbHex(255, 122, 100));
    expect(getParagraphShading(e, from)).toBe("#ff7a64");
    e.commands.setParagraphShading("#55aa00");
    expect(getParagraphShading(e, from)).toBe("#55aa00");
    // Theme colours: n/a (no document theme). Auto colour = no shading.
    e.commands.setParagraphShading(null);
    expect(getParagraphShading(e, from)).toBe(null);
  });

  it("oo:word/js-api/api-paragraph.js#GetRange", () => {
    const e = makeEditor("<p>Hello World</p>");
    const { from, mark } = range(e);
    expect(getText(e, {}, from, mark)).toBe("Hello World\r\n");
    expect(getText(e, {}, from, from + 5)).toBe("Hello");
  });

  it("oo:word/js-api/api-paragraph.js#SetColor, GetColor", () => {
    const e = makeEditor("<p>Run for testing paragraph color</p>");
    const { from, to } = range(e);
    expect(getTextColor(e, from, to)).toBe(null);
    setTextColor(e, from, to, rgbHex(80, 160, 240));
    expect(getTextColor(e, from, to)).toBe("#50a0f0");
    setTextColor(e, from, to, "#BADA55");
    expect(getTextColor(e, from, to)?.toUpperCase()).toBe("#BADA55");
    setTextColor(e, from, to, null);
    expect(getTextColor(e, from, to)).toBe(null);
  });
});

describe("paragraph properties (M3)", () => {
  it("sets indents, spacing rules, keeps, borders, tabs and outline level", () => {
    const e = makeEditor("<p>One</p><p>Two</p>");
    selectAll(e);
    e.commands.setParagraphProps({
      indLeft: 36,
      indRight: 18,
      indFirstLine: -18,
      lineRule: "exact",
      lineValue: 14,
      keepNext: true,
      keepLines: true,
      widowControl: false,
      pageBreakBefore: true,
      borders: { top: { width: 1, style: "solid", color: "#000000" } },
      tabs: [
        { pos: 72, align: "left", leader: "none" },
        { pos: 216, align: "right", leader: "dot" },
      ],
      outlineLevel: 2,
      spaceBefore: 6,
      spaceAfter: 12,
    });
    const p = directProps(textblocks(e)[1].node);
    expect(p).toMatchObject({
      indLeft: 36,
      indRight: 18,
      indFirstLine: -18,
      lineRule: "exact",
      lineValue: 14,
      keepNext: true,
      keepLines: true,
      widowControl: false,
      pageBreakBefore: true,
      outlineLevel: 2,
      spaceBefore: 6,
      spaceAfter: 12,
    });
    expect(p.borders?.top).toEqual({ width: 1, style: "solid", color: "#000000" });
    expect(p.tabs).toEqual([
      { pos: 72, align: "left", leader: "none" },
      { pos: 216, align: "right", leader: "dot" },
    ]);

    const html = e.getHTML();
    for (const css of [
      "36pt", // margin-left (jsdom may serialise margins as a shorthand)
      "18pt", // margin-right
      "text-indent: -18pt",
      "line-height: 14pt",
      "break-after: avoid",
      "break-inside: avoid",
      "widows: 1",
      "break-before: page",
      "border-top: 1pt solid",
    ])
      expect(html).toContain(css);
    expect(html).toContain('data-outline-level="2"');

    // The HTML parses back to the same properties (paste / import / copy).
    const back = makeEditor(html);
    expect(directProps(textblocks(back)[0].node)).toEqual(directProps(textblocks(e)[0].node));
  });

  it("at-least line spacing and clearing a property", () => {
    const e = makeEditor("<p>One</p>");
    e.commands.setParagraphProps({ lineRule: "atLeast", lineValue: 20 });
    expect(directProps(textblocks(e)[0].node)).toMatchObject({ lineRule: "atLeast", lineValue: 20 });
    expect(e.getHTML()).toContain("line-height: max(1.15em, 20pt)");
    e.commands.setParagraphProps({ lineRule: "auto", lineValue: 1.5 });
    expect(directProps(textblocks(e)[0].node)).toMatchObject({ lineRule: "auto", lineValue: 1.5 });
    e.commands.setParagraphProps({ lineValue: null, keepNext: null });
    expect(directProps(textblocks(e)[0].node).lineValue).toBeUndefined();
  });

  it("tab stops encode sorted and deduplicated", () => {
    expect(parseTabs("216r.,72l,x,144c")).toEqual([
      { pos: 216, align: "right", leader: "dot" },
      { pos: 72, align: "left", leader: "none" },
      { pos: 144, align: "center", leader: "none" },
    ]);
  });

  it("page break before stays with the first half on Enter", () => {
    const e = makeEditor("<p>OneTwo</p>");
    e.commands.setParagraphProps({ pageBreakBefore: true, indLeft: 36 });
    setCursor(e, textblocks(e)[0].pos + 3);
    pressKey(e, "Enter");
    const [a, b] = textblocks(e).map((t) => directProps(t.node));
    expect(a.pageBreakBefore).toBe(true);
    expect(b.pageBreakBefore).toBeUndefined();
    expect(b.indLeft).toBe(36);
  });

  it("persists through Yjs to another editor", () => {
    const { editors, sync } = makeSyncedEditors(2);
    const [a, b] = editors;
    typeText(a, "Synced");
    a.commands.setParagraphProps({ indFirstLine: 24, keepNext: true, tabs: [{ pos: 90, align: "center", leader: "hyphen" }] });
    sync();
    expect(directProps(textblocks(b)[0].node)).toMatchObject({
      indFirstLine: 24,
      keepNext: true,
      tabs: [{ pos: 90, align: "center", leader: "hyphen" }],
    });
  });
});
