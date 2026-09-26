import { describe, it, expect } from "vitest";
import { fillCellDisplay, normalizeWorkbook } from "./normalize";

describe("fillCellDisplay", () => {
  it("fills m for a bare numeric value (API save without display text)", () => {
    const cell = fillCellDisplay({ v: 10 });
    expect(cell.m).toBe("10");
    expect(cell.ct).toEqual({ fa: "General", t: "n" });
  });

  it("formats with the cell's number format", () => {
    expect(fillCellDisplay({ v: 10, ct: { fa: "0.00", t: "n" } }).m).toBe("10.00");
    expect(fillCellDisplay({ v: 0.5, ct: { fa: "0%", t: "n" } }).m).toBe("50%");
    expect(fillCellDisplay({ v: 1234567, ct: { fa: "#,##0", t: "n" } }).m).toBe(
      "1,234,567",
    );
  });

  it("fills strings and booleans verbatim", () => {
    expect(fillCellDisplay({ v: "abc" }).m).toBe("abc");
    expect(fillCellDisplay({ v: "abc" }).ct).toBeUndefined();
    expect(fillCellDisplay({ v: true }).m).toBe("TRUE");
    expect(fillCellDisplay({ v: false }).m).toBe("FALSE");
  });

  it("leaves existing display text, empty cells and rich text alone", () => {
    expect(fillCellDisplay({ v: 10, m: "ten" }).m).toBe("ten");
    expect(fillCellDisplay({ bl: 1 })).toEqual({ bl: 1 });
    expect(fillCellDisplay(null)).toBeNull();
    const rich = { ct: { t: "inlineStr", s: [{ v: "x" }] } };
    expect(fillCellDisplay(rich)).toEqual({ ct: { t: "inlineStr", s: [{ v: "x" }] } });
  });

  it("keeps a formula cell's computed value", () => {
    expect(fillCellDisplay({ f: "=SUM(1,2)", v: 3 }).m).toBe("3");
  });
});

describe("normalizeWorkbook", () => {
  it("normalises celldata and the 2D data matrix of every sheet", () => {
    const wb = normalizeWorkbook([
      { name: "Sheet1", celldata: [{ r: 1, c: 0, v: { v: 10 } }] },
      { name: "Sheet2", data: [[null, { v: 2.5 }]] },
    ]);
    expect(wb[0].celldata[0].v.m).toBe("10");
    expect(wb[1].data[0][1].m).toBe("2.5");
  });

  it("tolerates non-workbook input", () => {
    expect(normalizeWorkbook(null)).toBeNull();
    expect(normalizeWorkbook([null, { name: "x" }])).toEqual([null, { name: "x" }]);
  });
});
