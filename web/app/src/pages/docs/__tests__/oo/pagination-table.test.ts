// Ported from OnlyOffice sdkjs tests/word/document-calculation/table/
// pageBreak.js and table-header.js (behaviour only). Row heights are the
// M4 row `height` attribute ("at least"), cell content is laid out on the
// MockMeasurer grid (20 per line), borders add their width to the row.
import { describe, expect, it } from "vitest";
import { layoutOf, pagedEditor, pagesOf } from "../pagination-harness";
import { rowBounds } from "../../pagination";
import { getLayout } from "../../paginationPlugin";

const cell = (inner = "<p></p>", attrs = "") => `<td${attrs}>${inner}</td>`;
const row = (h: number | null, cells: string[], attrs = "") =>
  `<tr${h ? ` data-height="${h}"` : ""}${attrs}>${cells.join("")}</tr>`;
const table = (rows: string[]) => `<table><tbody>${rows.join("")}</tbody></table>`;
const three = (inner?: string, attrs?: string) => [cell(inner, attrs), cell(), cell()];

describe("tables across pages (pageBreak.js)", () => {
  const PAGE = { w: 400, h: 820, margin: 10 };

  it("oo:word/document-calculation/table/pageBreak.js#Test page break because of bottom border width", () => {
    let e = pagedEditor(table([50, 50, 50, 50].map((h) => row(h, three()))), PAGE);
    expect(pagesOf(e, 0)).toEqual([0]);

    e = pagedEditor(table([700, 50, 45, 50].map((h) => row(h, three()))), PAGE);
    let l = layoutOf(e);
    expect(pagesOf(e, 0)).toEqual([0, 1]);
    expect(l.blocks[0][1].from).toBe(3); // the page breaks on the 4th row

    // A 10pt bottom border on the third row pushes it over the edge.
    const border = ` data-borders='{"bottom":"10 solid #000000"}'`;
    e = pagedEditor(
      table([row(700, three()), row(50, three()), row(45, three(undefined, border)), row(50, three())]),
      PAGE,
    );
    l = layoutOf(e);
    expect(pagesOf(e, 0)).toEqual([0, 1]);
    expect(l.blocks[0][1].from).toBe(2); // now on the 3rd row
  });

  it("oo:word/document-calculation/table/pageBreak.js#Test page break of a float table in a special case (bug 57159)", () => {
    // grown-variant: Grown has no floating tables (F2); the table's
    // vertical offset from its anchor paragraph becomes space before it.
    const rows = Array.from({ length: 8 }, () => row(50, three()));
    let e = pagedEditor(table(rows), PAGE);
    expect(pagesOf(e, 0)).toEqual([0]);

    e = pagedEditor(`<p style="margin-bottom: 585pt"></p>` + table(rows), PAGE);
    let l = layoutOf(e);
    expect(pagesOf(e, 1)).toEqual([0, 1]);
    expect(l.blocks[1][1].from).toBe(3);

    e = pagedEditor(`<p style="margin-bottom: 485pt"></p>` + table(rows), PAGE);
    l = layoutOf(e);
    expect(pagesOf(e, 1)).toEqual([0, 1]);
    expect(l.blocks[1][1].from).toBe(5);
  });

  it("oo:word/document-calculation/table/pageBreak.js#Page break before table and table breaks on the second page (bug 75532)", () => {
    // A page break, then a table whose first row (a cell with 80 and 700
    // after its two paragraphs) is taller than a page.
    const tall = `<p style="margin-bottom: 80pt"></p><p style="margin-bottom: 700pt"></p>`;
    const e = pagedEditor(
      `<p></p><div data-page-break></div><p></p>` + table([row(null, [cell(), cell(tall)]), row(null, [cell(), cell()])]),
      PAGE,
    );
    const l = layoutOf(e);
    expect(pagesOf(e, 2)).toEqual([1]); // the paragraph after the break
    // The first row doesn't fit under it: the table starts on page 3, the
    // row splits there and ends on page 4 with the second row.
    expect(pagesOf(e, 3)).toEqual([2, 3]);
    expect(l.blocks[3].map((p) => [p.from, p.to])).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });
});

describe("repeated header rows (table-header.js)", () => {
  const PAGE = { w: 400, h: 400, margin: 50 };
  const body = (before: number, header: boolean) =>
    `<p style="margin-top: ${before}pt"></p>` +
    table([
      row(50, [cell("<p></p><p></p><p></p>"), cell(), cell()], header ? " data-repeat-header" : ""),
      row(50, three()),
      row(50, three()),
      row(50, three()),
    ]);

  it("oo:word/document-calculation/table/table-header.js#Test page break", () => {
    let e = pagedEditor(body(150, false), PAGE);
    let dl = getLayout(e)!;
    const para = dl.layout.blocks[0][0];
    // Paragraph bounds include its space before: 50..220.
    expect(para.top - 150).toBe(50);
    expect(para.bottom).toBe(220);

    // A normal table split over two pages.
    expect(pagesOf(e, 1)).toEqual([0, 1]);
    expect(rowBounds(dl.layout, dl.measured.boxes, 1, 1, 0)).toEqual({ top: 280, bottom: 330 });
    expect(rowBounds(dl.layout, dl.measured.boxes, 1, 2, 1)).toEqual({ top: 50, bottom: 100 });

    // With a header row, page 2 starts with the header: the row moves down.
    e = pagedEditor(body(150, true), PAGE);
    dl = getLayout(e)!;
    expect(pagesOf(e, 1)).toEqual([0, 1]);
    expect(dl.layout.blocks[1][1].headerRows).toEqual([0]);
    expect(rowBounds(dl.layout, dl.measured.boxes, 1, 0, 1)).toEqual({ top: 50, bottom: 110 });
    expect(rowBounds(dl.layout, dl.measured.boxes, 1, 2, 1)).toEqual({ top: 110, bottom: 160 });

    // Word 2013+ (Grown has this one compatibility mode; the 2010 cases
    // are n/a): a split right after the header row, or inside it, moves
    // the whole table on.
    for (const before of [200, 225]) {
      e = pagedEditor(body(before, true), PAGE);
      expect(pagesOf(e, 1)).toEqual([1]);
    }
  });
});

describe("tables across pages (Grown)", () => {
  it("repeats several header rows on every page of a long table", () => {
    const rows = [row(30, three(), " data-repeat-header"), row(30, three(), " data-repeat-header")];
    for (let i = 0; i < 30; i++) rows.push(row(30, three()));
    const e = pagedEditor(table(rows), { w: 400, h: 400, margin: 50 });
    const l = layoutOf(e);
    expect(l.blocks[0].length).toBeGreaterThan(2);
    for (const p of l.blocks[0].slice(1)) {
      expect(p.headerRows).toEqual([0, 1]);
      expect(p.from).toBeGreaterThan(1);
    }
    // Every body row is placed exactly once.
    const placed = l.blocks[0].flatMap((p) => Array.from({ length: p.to - p.from }, (_, k) => p.from + k));
    expect(placed).toEqual(Array.from({ length: 32 }, (_, k) => k));
  });
});
