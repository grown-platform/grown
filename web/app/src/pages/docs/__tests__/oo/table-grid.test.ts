// Ports of OnlyOffice word/document-calculation/table/table-grid.js
// (behaviour only): the fixed-layout grid a table is laid out on.
// OnlyOffice lays the table out and reads TableGridCalc; Grown's resolver
// (resolveFixedGrid in tableModel.ts) is the same rule as a pure function,
// used by the DOCX reader and, through pmColumnWidths, by the editor's
// table view. Widths are unitless here (OnlyOffice uses millimetres).
import { describe, expect, it } from "vitest";
import { resolveFixedGrid, type GridRow } from "../../tableModel";

/** Rows of `cols` cells; `widths[r][c]` null = auto width. */
const rows = (widths: (number | null)[][]): GridRow[] =>
  widths.map((r) => ({ cells: r.map((w) => ({ span: 1, width: w })) }));

const close = (got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length);
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 2));
};

describe("OnlyOffice table-grid: fixed layout", () => {
  it("oo:word/document-calculation/table/table-grid.js#Test: cell widths smaller than grid shrink columns", () => {
    // Cells without their own width (the second row) don't vote.
    close(resolveFixedGrid([50, 50, 50], rows([[30, 25, 40], [null, null, null]])), [30, 25, 40]);
    // A table created with cell widths equal to the grid: the widest wins.
    close(resolveFixedGrid([50, 50, 50], rows([[30, 25, 40], [50, 50, 50]])), [50, 50, 50]);
  });

  it("oo:word/document-calculation/table/table-grid.js#Test: cell widths larger than grid expand columns", () => {
    close(resolveFixedGrid([30, 30, 30], rows([[50, 60, 70]])), [50, 60, 70]);
  });

  it("oo:word/document-calculation/table/table-grid.js#Test: maximum cell width wins across multiple rows", () => {
    close(resolveFixedGrid([50, 50], rows([[30, 60], [45, 55], [35, 58]])), [45, 60]);
  });

  it("oo:word/document-calculation/table/table-grid.js#Test: auto width cells fall back to original grid", () => {
    close(resolveFixedGrid([50, 60, 70], rows([[null, null, null]])), [50, 60, 70]);
  });

  it("oo:word/document-calculation/table/table-grid.js#Test: mixed explicit and auto widths", () => {
    close(resolveFixedGrid([50, 60, 70], rows([[null, 40, null], [null, null, null]])), [50, 40, 70]);
  });

  it("oo:word/document-calculation/table/table-grid.js#Test: vmerge_Continue cells are ignored", () => {
    const r: GridRow[] = [
      { cells: [{ width: 30 }, { width: null }] },
      { cells: [{ width: 80, vMerge: "continue" }, { width: null }] },
    ];
    expect(resolveFixedGrid([50, 50], r)[0]).toBeCloseTo(30, 2);
  });
});
