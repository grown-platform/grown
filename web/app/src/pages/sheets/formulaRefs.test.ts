import { describe, it, expect } from "vitest";
import {
  quoteSheetName,
  renameSheetInFormula,
  renameSheetInNamedRanges,
  sheetRenameEdits,
  recalcWrites,
  workbookHasFormulas,
} from "./formulaRefs";

describe("quoteSheetName", () => {
  it("quotes only when needed", () => {
    expect(quoteSheetName("Sheet1")).toBe("Sheet1");
    expect(quoteSheetName("Budget 2026")).toBe("'Budget 2026'");
    expect(quoteSheetName("It's")).toBe("'It''s'");
    expect(quoteSheetName("A1")).toBe("'A1'");
    expect(quoteSheetName("2026")).toBe("'2026'");
    expect(quoteSheetName("हरियाणवी")).toBe("हरियाणवी");
  });
});

describe("renameSheetInFormula", () => {
  it("rewrites plain and quoted references", () => {
    expect(renameSheetInFormula("=Sheet1!A1+Sheet2!B2", "Sheet1", "Data")).toBe(
      "=Data!A1+Sheet2!B2",
    );
    expect(renameSheetInFormula("=SUM('My Data'!A1:B2)", "My Data", "Totals")).toBe(
      "=SUM(Totals!A1:B2)",
    );
    expect(renameSheetInFormula("=Data!A1", "data", "New name")).toBe(
      "='New name'!A1",
    );
  });
  it("leaves strings, longer names and other sheets alone", () => {
    const f = '=IF(A1="Sheet1!A1",MySheet1!A1,XSheet1!B1)&Sheet1x!C1';
    expect(renameSheetInFormula(f, "Sheet1", "S")).toBe(f);
  });
  it("handles quotes inside names", () => {
    expect(renameSheetInFormula("='It''s'!A1", "It's", "Ok")).toBe("=Ok!A1");
  });
});

describe("sheet rename edits", () => {
  it("finds formulas in the data matrix and named ranges", () => {
    const sheets = [
      {
        id: "s1",
        name: "Sheet1",
        data: [[{ f: "=Sheet2!A1*2", v: 2 }, { v: 5 }], [null, { f: "=A1" }]],
      },
      { id: "s2", name: "Sheet2", celldata: [{ r: 0, c: 0, v: { f: "=Sheet2!B1" } }] },
    ];
    expect(sheetRenameEdits(sheets, "Sheet2", "Inputs")).toEqual([
      { sheetId: "s1", r: 0, c: 0, f: "=Inputs!A1*2" },
      { sheetId: "s2", r: 0, c: 0, f: "=Inputs!B1" },
    ]);
    expect(
      renameSheetInNamedRanges(
        [{ name: "Rate", range: "Sheet2!B1", sheetId: "s2", sheetName: "Sheet2" }],
        "Sheet2",
        "Inputs",
      ),
    ).toEqual([{ name: "Rate", range: "Inputs!B1", sheetId: "s2", sheetName: "Inputs" }]);
    expect(workbookHasFormulas(sheets)).toBe(true);
    expect(workbookHasFormulas([{ id: "x", data: [[{ v: 1 }]] }])).toBe(false);
  });
});

describe("recalcWrites", () => {
  const sheets = [
    {
      id: "s1",
      data: [
        [{ f: "=Sheet2!A1", v: "#NAME?", m: "#NAME?" }, { f: "=1+1", v: 2, m: "2" }],
        [{ f: "=SEQUENCE(3)", v: 1, m: "1" }, null],
        [{ v: "typed", m: "typed" }, null],
        [{ v: 9, m: "9", grownSpill: "9" }, null],
      ],
    },
  ];
  it("updates stale formula values and fills spill cells", () => {
    const writes = recalcWrites(sheets, [
      { sheetId: "s1", sheetIndex: 0, r: 0, c: 0, f: "=Sheet2!A1", v: 7, m: "7" },
      { sheetId: "s1", sheetIndex: 0, r: 0, c: 1, f: "=1+1", v: 2, m: "2" },
      { sheetId: "s1", sheetIndex: 0, r: 1, c: 1, f: "=OLD()", v: 1, m: "1" },
      { sheetId: "s1", sheetIndex: 0, r: 2, c: 0, v: 3, m: "3", spill: true },
      { sheetId: "s1", sheetIndex: 0, r: 3, c: 0, v: 3, m: "3", spill: true },
      { sheetId: "s1", sheetIndex: 0, r: 4, c: 0, v: 4, m: "4", spill: true },
    ]);
    expect(writes).toEqual([
      { sheetId: "s1", r: 0, c: 0, value: { f: "=Sheet2!A1", v: 7, m: "7" } },
      { sheetId: "s1", r: 3, c: 0, value: { v: 3, m: "3", grownSpill: "3" } },
      { sheetId: "s1", r: 4, c: 0, value: { v: 4, m: "4", grownSpill: "4" } },
    ]);
  });
});
