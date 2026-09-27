// Ported from OnlyOffice sdkjs tests/word/js-api/api-section.js (behaviour
// only), plus Grown's section model: breaks, page setup per section,
// headers/footers per section, page numbering.
import { describe, expect, it } from "vitest";
import { makeEditor, paragraphTexts, setCursor } from "../harness";
import { currentSection, docSections, getSettings, setSectionProps } from "../../pageLayout";
import {
  columnBoxes,
  columnWidths,
  defaultSection,
  hfFragment,
  pageHfKind,
  setEqualColumns,
  setNotEqualColumns,
  setOrientation,
  formatPageNumber,
} from "../../sections";
import { layoutOf, pagedEditor, pagesOf } from "../pagination-harness";
import { getLayout } from "../../paginationPlugin";
import { layoutPageResolver } from "../../paginationModel";

describe("ApiSection columns (api-section.js)", () => {
  it("oo:word/js-api/api-section.js#GetColumnsCount, GetColumnsSpaces, GetColumnsWidths", () => {
    const e = makeEditor("<p>text</p>");
    const widths = [1440, 2880, 4320];
    const spaces = [720, 480];
    setSectionProps(e, (p) => setNotEqualColumns(p, widths, spaces), "document");
    const cols = currentSection(e).props.cols;
    expect(cols.num).toBe(3);
    widths.forEach((w, i) => expect(cols.widths?.[i]).toBe(w));
    spaces.forEach((s, i) => expect(cols.spaces?.[i]).toBe(s));
  });
});

describe("sections (Grown)", () => {
  it("a section break splits the paragraph and both halves keep the setup", () => {
    const e = makeEditor("<p>HelloWorld</p>");
    setSectionProps(e, (p) => setOrientation(p, "landscape"), "document");
    setCursor(e, 6);
    expect(e.commands.insertSectionBreak("continuous")).toBe(true);
    expect(paragraphTexts(e)).toEqual(["Hello", "World"]);
    const secs = docSections(e);
    expect(secs).toHaveLength(2);
    expect(secs.map((s) => s.props.orient)).toEqual(["landscape", "landscape"]);
    expect(secs[1].start).toBe("continuous");
    // Changing the second section leaves the first alone.
    setCursor(e, e.state.doc.content.size - 2);
    setSectionProps(e, (p) => setOrientation(p, "portrait"));
    expect(docSections(e).map((s) => s.props.orient)).toEqual(["landscape", "portrait"]);
    expect(getSettings(e).section.orient).toBe("portrait");
  });

  it("this point forward inserts a next-page break", () => {
    const e = makeEditor("<p>one</p><p>two</p><p>three</p>");
    setCursor(e, 7); // in "two"
    setSectionProps(e, { pageW: 792, pageH: 1224 }, "forward");
    const secs = docSections(e);
    expect(secs).toHaveLength(2);
    expect(secs[0].props.pageH).toBe(792);
    expect(secs[1].props.pageH).toBe(1224);
    expect(secs[1].start).toBe("nextPage");
  });

  it("columns: equal and unequal geometry", () => {
    const p = setEqualColumns(defaultSection(), 2, 36);
    // 468pt of text, 36pt apart.
    expect(columnBoxes(p)).toEqual([
      { x: 0, w: 216 },
      { x: 252, w: 216 },
    ]);
    const u = setNotEqualColumns(defaultSection(), [100, 200], [36]);
    const cw = columnWidths(u);
    // Scaled to the 468pt text width.
    expect(cw.widths[0] + cw.widths[1] + cw.spaces[0]).toBeCloseTo(468);
    expect(cw.widths[1] / cw.widths[0]).toBeCloseTo(2);
  });

  it("orientation swaps the page and rotates the margins", () => {
    const p = { ...defaultSection(), margins: { ...defaultSection().margins, top: 10, right: 20, bottom: 30, left: 40 } };
    const l = setOrientation(p, "landscape");
    expect([l.pageW, l.pageH]).toEqual([792, 612]);
    expect([l.margins.top, l.margins.right, l.margins.bottom, l.margins.left]).toEqual([40, 10, 20, 30]);
    expect(setOrientation(l, "portrait").margins.top).toBe(10);
  });

  it("headers and footers: own parts, link to previous, first / even pages", () => {
    const e = makeEditor("<p>a</p><p>b</p><p>c</p>");
    setCursor(e, 2);
    e.commands.insertSectionBreak("nextPage");
    setCursor(e, e.state.doc.content.size - 2);
    e.commands.insertSectionBreak("nextPage");
    let secs = docSections(e);
    expect(secs).toHaveLength(3);
    // Everything links back to the first section's original fragments.
    expect(hfFragment(secs, 2, "header", "default")).toBe("header");
    expect(hfFragment(secs, 1, "footer", "default")).toBe("footer");
    // Section 2 unlinks its header.
    setCursor(e, e.state.doc.content.size - 2);
    setSectionProps(e, (p) => ({ ...p, own: ["header:default"] }));
    secs = docSections(e);
    expect(hfFragment(secs, 2, "header", "default")).toBe(`hf:final:default:header`);
    expect(hfFragment(secs, 2, "footer", "default")).toBe("footer");
    expect(hfFragment(secs, 1, "header", "first")).toBe("hf:first-section:first:header");
    expect(pageHfKind({ firstOfSection: true, titlePg: true, pageNumber: 4, evenOdd: true })).toBe("first");
    expect(pageHfKind({ firstOfSection: false, titlePg: true, pageNumber: 4, evenOdd: true })).toBe("even");
    expect(pageHfKind({ firstOfSection: false, titlePg: true, pageNumber: 3, evenOdd: true })).toBe("default");
  });

  it("page number formats", () => {
    expect([1, 4, 9, 14].map((n) => formatPageNumber(n, "lowerRoman"))).toEqual(["i", "iv", "ix", "xiv"]);
    expect(formatPageNumber(28, "upperLetter")).toBe("BB");
    expect(formatPageNumber(7, "decimal")).toBe("7");
  });
});

describe("section layout (Grown)", () => {
  const PAGE = { w: 400, h: 400, margin: 50 };
  const many = (n: number) => Array.from({ length: n }, (_, i) => `<p>line ${i}</p>`).join("");

  it("next page, continuous, even and odd page breaks; page number restarts", () => {
    const html = `<p>a</p><div data-section-break data-kind="continuous"></div><p>b</p><div data-section-break data-kind="nextPage"></div><p>c</p>` +
      `<div data-section-break data-kind="evenPage"></div><p>d</p><div data-section-break data-kind="oddPage"></div><p>e</p>`;
    const e = pagedEditor(html, PAGE);
    const l = layoutOf(e);
    // a, b on page 1; c on page 2; d must start an even page: the next
    // page would be 3, so a blank page 3 is inserted and d lands on page
    // 4; e needs an odd page and gets page 5.
    expect(pagesOf(e, 0)).toEqual([0]);
    expect(pagesOf(e, 2)).toEqual([0]);
    expect(pagesOf(e, 4)).toEqual([1]);
    expect(pagesOf(e, 6)).toEqual([3]);
    expect(l.pages[2].blank).toBe(true);
    expect(pagesOf(e, 8)).toEqual([4]);
    expect(l.pages.map((p) => p.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("per-section page size and restart numbering; exact PAGE / NUMPAGES / SECTIONPAGES", () => {
    const land = JSON.stringify({ ...defaultSection(), pageW: 400, pageH: 300, orient: "landscape", margins: { top: 50, bottom: 50, left: 50, right: 50, header: 0, footer: 0, gutter: 0 }, pgNum: { start: 10 } });
    const e = pagedEditor(many(12) + `<div data-section-break data-kind="nextPage" data-sectpr='${land}'></div>` + many(3), PAGE);
    // The first section is a 400 x 300 landscape page numbered from 10.
    const l = layoutOf(e);
    expect(l.pages[0].spec.h).toBe(300);
    expect(l.pages[0].number).toBe(10);
    expect(l.pages[l.pages.length - 1].spec.h).toBe(400);
    expect(l.pages[l.pages.length - 1].number).toBe(l.pages.length + 9);
    const r = layoutPageResolver(getLayout(e)!);
    expect(r.pageCount()).toBe(l.pages.length);
    expect(r.pageAt(e.state.doc.content.size - 2)).toBe(l.pages.length + 9);
    expect(r.sectionPageCount(e.state.doc.content.size - 2)).toBe(l.pages.filter((p) => p.section === 1).length);
  });

  it("widow and orphan control, keep lines together, page break before", () => {
    // 300 units per page = 15 lines. 14 short lines, then a 4-line paragraph.
    const long = `<p>${"word ".repeat(4 * 8).trim()}</p>`; // 8 words (40 chars) per line at 300/10 = 30 chars
    const fill = (n: number) => many(n);
    // Only one line would fit: the paragraph moves (orphan).
    let e = pagedEditor(fill(14) + long, PAGE);
    expect(pagesOf(e, 14)).toEqual([1]);
    // Two lines fit: it splits 2 + rest.
    e = pagedEditor(fill(13) + long, PAGE);
    let l = layoutOf(e);
    expect(pagesOf(e, 13)).toEqual([0, 1]);
    const lines = l.blocks[13][0].to;
    expect(lines).toBe(2);
    // Keep lines together: moves whole.
    e = pagedEditor(fill(13) + long.replace("<p>", '<p style="break-inside: avoid">'), PAGE);
    expect(pagesOf(e, 13)).toEqual([1]);
    // Widow control off: one line stays behind.
    e = pagedEditor(fill(14) + long.replace("<p>", '<p style="widows: 1">'), PAGE);
    l = layoutOf(e);
    expect(pagesOf(e, 14)).toEqual([0, 1]);
    expect(l.blocks[14][0].to).toBe(1);
    // Page break before.
    e = pagedEditor(`<p>a</p><p style="break-before: page">b</p>`, PAGE);
    expect(pagesOf(e, 1)).toEqual([1]);
  });

  it("columns fill in order and balance before a continuous break", () => {
    const two = JSON.stringify({ ...defaultSection(), pageW: 400, pageH: 400, margins: { top: 50, bottom: 50, left: 50, right: 50, header: 0, footer: 0, gutter: 0 }, cols: { num: 2, space: 20, sep: false, equal: true } });
    const e = pagedEditor(many(6) + `<div data-section-break data-kind="continuous" data-sectpr='${two}'></div><p>after</p>`, PAGE);
    const l = layoutOf(e);
    const cols = [0, 1, 2, 3, 4, 5].map((i) => l.blocks[i][0].col);
    expect(cols).toEqual([0, 0, 0, 1, 1, 1]);
    // Balanced: both columns end at the same height, and "after" starts
    // right below them on page 1.
    expect(l.blocks[3][0].top).toBe(l.blocks[0][0].top);
    expect(pagesOf(e, 7)).toEqual([0]);
    expect(l.blocks[7][0].top).toBeGreaterThanOrEqual(l.blocks[2][0].bottom);
    // A long run fills column 1 first, then column 2, then the next page.
    const f = pagedEditor(many(40), { ...PAGE, section: { cols: { num: 2, space: 20, sep: false, equal: true } } });
    const fl = layoutOf(f);
    expect(fl.blocks[0][0].col).toBe(0);
    expect(fl.blocks[15][0].col).toBe(1);
    expect(fl.blocks[30][0].page).toBe(1);
  });

  it("mirror margins swap the text box on even pages", () => {
    const e = pagedEditor(many(40), { ...PAGE, margin: { left: 80, right: 20 }, settings: { mirror: true } });
    const l = layoutOf(e);
    expect(l.pages[0].textLeft).toBe(80);
    expect(l.pages[1].textLeft).toBe(20);
  });
});
