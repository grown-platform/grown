import { describe, expect, it } from "vitest";
import { applyStructureOp } from "./formulaShift";
import { defaultPrintSettings } from "./printSettings";

describe("structure ops move print and protection models", () => {
  it("shifts protected ranges, the print area, titles, breaks and tables", () => {
    const sheets = [
      {
        name: "S",
        id: "s",
        celldata: [],
        grownProtection: {
          sheet: { users: [], except: [{ r1: 5, c1: 0, r2: 6, c2: 0 }] },
          ranges: [
            { id: "a", name: "a", users: [], ranges: [{ r1: 2, c1: 1, r2: 4, c2: 1 }] },
            { id: "b", name: "b", users: [], ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }] },
          ],
        },
        grownPrint: { ...defaultPrintSettings(), printArea: { r1: 0, c1: 0, r2: 9, c2: 3 }, titleRows: [1, 1], rowBreaks: [3, 8] },
        grownTables: [{ name: "T", ref: { r1: 2, c1: 0, r2: 5, c2: 2 } }],
      },
    ];
    // Delete row 1 (0-based 0), then insert a row at 0-based 3.
    const del = applyStructureOp(sheets, { kind: "delete", axis: "row", sheet: "s", index: 0, count: 1 })[0];
    expect(del.grownProtection.ranges.map((r: any) => r.id)).toEqual(["a"]);
    expect(del.grownProtection.ranges[0].ranges).toEqual([{ r1: 1, c1: 1, r2: 3, c2: 1 }]);
    expect(del.grownProtection.sheet.except).toEqual([{ r1: 4, c1: 0, r2: 5, c2: 0 }]);
    expect(del.grownPrint.printArea).toEqual({ r1: 0, c1: 0, r2: 8, c2: 3 });
    expect(del.grownPrint.titleRows).toEqual([0, 0]);
    expect(del.grownPrint.rowBreaks).toEqual([2, 7]);
    expect(del.grownTables[0].ref).toEqual({ r1: 1, c1: 0, r2: 4, c2: 2 });
    const ins = applyStructureOp([del], { kind: "insert", axis: "row", sheet: "s", index: 3, count: 1 })[0];
    expect(ins.grownProtection.ranges[0].ranges).toEqual([{ r1: 1, c1: 1, r2: 4, c2: 1 }]);
    expect(ins.grownPrint.rowBreaks).toEqual([2, 8]);
  });
});
