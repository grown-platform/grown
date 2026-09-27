import { describe, expect, it } from "vitest";
import { selectAllTarget, type TableRange } from "../selectAll";
import { rectToA1 } from "../cellValue";
import type { CellRect } from "../cellRange";

// SheetStructureTests "All selection test": Ctrl+A steps from the active
// cell (null = the whole sheet).
describe("select all", () => {
  it("oo:cell/spreadsheet-calculation/SheetStructureTests.js#All selection test", () => {
    const data = new Set(["0,0", "1,0", "0,1", "1,1", "1,2"]); // A1 A2 B1 B2 C2
    const filled = (r: number, c: number) => data.has(`${r},${c}`);
    const one = (r: number, c: number): CellRect => ({ r1: r, c1: c, r2: r, c2: c });
    const name = (x: CellRect | null) => (x ? rectToA1(x) : "sheet");
    // A1 → the data block A1:C2 → the sheet.
    let t = selectAllTarget(filled, one(0, 0), 0, 0);
    expect(name(t)).toBe("A1:C2");
    expect(name(selectAllTarget(filled, t!, 0, 0))).toBe("sheet");
    // An empty cell away from the data → the sheet.
    expect(name(selectAllTarget(filled, one(10, 10), 10, 10))).toBe("sheet");
    // With a table A1:C3 (one header row): from B2 its data rows, then the table, then the sheet.
    const tables: TableRange[] = [{ ref: { r1: 0, c1: 0, r2: 2, c2: 2 }, headerRowCount: 1 }];
    t = selectAllTarget(filled, one(1, 1), 1, 1, tables);
    expect(name(t)).toBe("A2:C3");
    t = selectAllTarget(filled, t!, 1, 1, tables);
    expect(name(t)).toBe("A1:C3");
    expect(name(selectAllTarget(filled, t!, 1, 1, tables))).toBe("sheet");
    // From the header cell A1: the table, then the sheet.
    t = selectAllTarget(filled, one(0, 0), 0, 0, tables);
    expect(name(t)).toBe("A1:C3");
    expect(name(selectAllTarget(filled, t!, 0, 0, tables))).toBe("sheet");
  });
});
