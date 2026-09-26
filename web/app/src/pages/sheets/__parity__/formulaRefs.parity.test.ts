import { describe, it, expect } from "vitest";
import { sheetRenameEdits } from "../formulaRefs";

// Port of FormulaTests.js "rename sheet #1": after a sheet is renamed, a
// formula that referred to it by name refers to the new name (and back).
describe("FormulaTests.js rename", () => {
  it("oo:cell/spreadsheet-calculation/formula-tests/FormulaTests.js#rename sheet #1", () => {
    const sheet = {
      id: "s1",
      name: "Sheet1",
      data: [] as unknown[][],
    };
    // S95 = 2, S100 = Sheet1!S95 (row 99, column S = 18).
    sheet.data[94] = [];
    sheet.data[94][18] = { v: 2 };
    sheet.data[99] = [];
    sheet.data[99][18] = { f: "=Sheet1!S95" };
    const toTmp = sheetRenameEdits([sheet], "Sheet1", "SheetTmp");
    expect(toTmp).toEqual([{ sheetId: "s1", r: 99, c: 18, f: "=SheetTmp!S95" }]);
    (sheet.data[99][18] as { f: string }).f = toTmp[0].f;
    const back = sheetRenameEdits([sheet], "SheetTmp", "Sheet1");
    expect(back[0].f).toBe("=Sheet1!S95");
  });
});
