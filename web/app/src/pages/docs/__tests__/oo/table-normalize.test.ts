// Port of OnlyOffice word/document-calculation/table/correctBadTable.js
// (behaviour only): repairing invalid vertical merges. Grown keeps
// WordprocessingML's vMerge model only while reading a .docx, so the case
// runs against correctBadTable (tableModel.ts), which the DOCX reader
// applies before building the editor table. The editor-side normaliser
// (normalizeTable, used on paste and import) has its own tests in
// ../tables.test.ts.
import { describe, expect, it } from "vitest";
import { correctBadTable, type RawRow } from "../../tableModel";

const table = (rows: number, cols: number): RawRow[] =>
  Array.from({ length: rows }, () => ({
    cells: Array.from({ length: cols }, () => ({ span: 1, vMerge: null as "restart" | "continue" | null })),
  }));

describe("OnlyOffice: correction of bad tables", () => {
  it("oo:word/document-calculation/table/correctBadTable.js#Test: bad vMerge", () => {
    let t = table(3, 3);
    expect(t).toHaveLength(3);
    t = correctBadTable(t);
    expect(t).toHaveLength(3); // a valid table is left alone

    for (const row of t) for (const cell of row.cells) cell.vMerge = "continue";
    t = correctBadTable(t);
    expect(t).toHaveLength(1);
    for (const cell of t[0].cells) expect(cell.vMerge).toBe("restart");
  });
});
