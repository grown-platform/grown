// Ported from OnlyOffice sdkjs tests/word/document-calculation/keep-next.js
// (behaviour only). Page 400 x 400 with 50 margins; the MockMeasurer
// gives every line 20 units (OnlyOffice's test font height).
//
// OnlyOffice reports "p3 has 2 pages, the first empty" when a paragraph
// is pushed to the next page; Grown's layout says the same thing as "p3
// starts on page 2" (pieces only exist where content is).
import { describe, expect, it } from "vitest";
import { layoutOf, pagedEditor, pagesOf } from "../pagination-harness";
import { setCursor } from "../harness";

const PAGE = { w: 400, h: 400, margin: 50 };
const p = (style = "") => `<p${style ? ` style="${style}"` : ""}></p>`;

describe("keep with next (keep-next.js)", () => {
  it("oo:word/document-calculation/keep-next.js#Test a simple situation with three paragraphs: keepNext = [false, true, false]", () => {
    let e = pagedEditor(p() + p() + p(), PAGE);
    expect(layoutOf(e).pages).toHaveLength(1);

    // p1 gets 250 after: p3 no longer fits.
    e = pagedEditor(p("margin-bottom: 250pt") + p() + p(), PAGE);
    expect(pagesOf(e, 1)).toEqual([0]);
    expect(pagesOf(e, 2)).toEqual([1]);

    // p2 keeps with p3: both move on.
    e = pagedEditor(p("margin-bottom: 250pt") + p("break-after: avoid") + p(), PAGE);
    expect(pagesOf(e, 1)).toEqual([1]);
    expect(pagesOf(e, 2)).toEqual([1]);
    expect(layoutOf(e).pages).toHaveLength(2);
  });

  it("oo:word/document-calculation/keep-next.js#Test the case when a paragraph with the KeepNext property is followed by a table", () => {
    const table = `<table><tbody>${'<tr data-height="50"><td><p></p></td><td><p></p></td><td><p></p></td></tr>'.repeat(3)}</tbody></table>`;
    let e = pagedEditor(p() + p() + table, PAGE);
    expect(layoutOf(e).pages).toHaveLength(1);

    e = pagedEditor(p("margin-bottom: 250pt") + p() + table, PAGE);
    expect(pagesOf(e, 1)).toEqual([0]);
    // The table's first row doesn't fit: the whole table starts page 2.
    expect(pagesOf(e, 2)).toEqual([1]);
    expect(layoutOf(e).blocks[2][0].from).toBe(0);

    e = pagedEditor(p("margin-bottom: 250pt") + p("break-after: avoid") + table, PAGE);
    expect(pagesOf(e, 1)).toEqual([1]);
    expect(pagesOf(e, 2)).toEqual([1]);
  });

  it("keeps a chain of keep-with-next paragraphs together, and updates as you edit (Grown)", () => {
    const e = pagedEditor(
      p("margin-bottom: 220pt") + p("break-after: avoid") + p("break-after: avoid") + p("break-after: avoid") + "<p>end</p>",
      PAGE,
    );
    // 20 + 220 + 4 * 20 > 300: the whole chain moves with "end".
    expect([1, 2, 3, 4].map((b) => pagesOf(e, b)[0])).toEqual([1, 1, 1, 1]);
    // A chain that starts a page can't move: it just flows.
    const f = pagedEditor(`${p("break-after: avoid")}`.repeat(20), PAGE);
    expect(layoutOf(f).pages.length).toBeGreaterThan(1);
    // Removing the space lets everything come back to page 1.
    setCursor(e, 1);
    e.commands.setSpacingPt({ after: 0 });
    expect(pagesOf(e, 4)).toEqual([0]);
  });
});
