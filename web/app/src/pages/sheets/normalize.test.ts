import { describe, it, expect } from "vitest";
import { fillCellDisplay, normalizeWorkbook, seedSelection } from "./normalize";

const A1 = { row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 };

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
    expect(normalizeWorkbook([null, { name: "x" }])).toEqual([
      null,
      { name: "x", luckysheet_select_save: [A1] },
    ]);
  });
});

describe("seedSelection", () => {
  // Regression: with no saved selection FortuneSheet selects
  // {row: [0], column: [0]} and the name box reads "A1:NaN".
  it("seeds A1 as a complete range when the sheet has no selection", () => {
    expect(seedSelection({ name: "S" }).luckysheet_select_save).toEqual([A1]);
    expect(
      seedSelection({ luckysheet_select_save: [] }).luckysheet_select_save,
    ).toEqual([A1]);
  });

  it("completes saved ranges missing their end index", () => {
    const s = seedSelection({
      luckysheet_select_save: [
        { row: [0], column: [0], row_focus: 0, column_focus: 0 },
        { row: [2, null], column: [1, 3] },
      ],
    });
    expect(s.luckysheet_select_save).toEqual([
      { row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 },
      { row: [2, 2], column: [1, 3], row_focus: 2, column_focus: 1 },
    ]);
  });

  it("keeps complete selections and drops unusable ones", () => {
    const good = { row: [1, 4], column: [2, 2], row_focus: 3, column_focus: 2 };
    expect(
      seedSelection({ luckysheet_select_save: [good, { row: "x" }] })
        .luckysheet_select_save,
    ).toEqual([good]);
    expect(
      seedSelection({ luckysheet_select_save: [{}] }).luckysheet_select_save,
    ).toEqual([A1]);
  });

  it("selects A1's merged block when A1 is merged", () => {
    const sheet = {
      celldata: [{ r: 0, c: 0, v: { v: "x", mc: { r: 0, c: 0, rs: 2, cs: 3 } } }],
    };
    expect(seedSelection(sheet).luckysheet_select_save).toEqual([
      { row: [0, 1], column: [0, 2], row_focus: 0, column_focus: 0 },
    ]);
  });
});

describe("fillCellDisplay with number formats", () => {
  it("renders custom formats with numberFormat.ts", () => {
    const acct = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';
    expect(fillCellDisplay({ v: -1234.5, ct: { fa: acct, t: "n" } }).m).toBe(" $(1,234.50)");
    expect(fillCellDisplay({ v: 1.5, ct: { fa: "[h]:mm", t: "d" } }).m).toBe("36:00");
    expect(fillCellDisplay({ v: 1.75, ct: { fa: "# ?/?", t: "n" } }).m).toBe("1 3/4");
    expect(fillCellDisplay({ v: 60, ct: { fa: "yyyy-mm-dd", t: "d" } }).m).toBe("1900-02-29");
  });
  it("re-renders a stale m under a custom format but keeps General text", () => {
    expect(fillCellDisplay({ v: 0.5, m: "0.5", ct: { fa: "0%", t: "n" } }).m).toBe("50%");
    expect(fillCellDisplay({ v: 0.5, m: "kept", ct: { fa: "General", t: "n" } }).m).toBe("kept");
  });
});
