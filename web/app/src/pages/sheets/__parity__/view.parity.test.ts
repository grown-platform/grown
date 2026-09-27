import { describe, expect, it } from "vitest";
import { typedCell } from "../cellValue";
import { cellViewText, sheetViewOptions, viewColumnWidth, ViewHistory } from "../sheetView";
import { readTable, writeTable } from "../xlsx/xlsxTables";
import { parseXml } from "../xlsx/ooxml";

// Ports of OnlyOffice's SheetViewTests.js (show formulas) and
// open-oox-in-browser.js (a table part read and written back).

describe("sheets parity: view", () => {
  it("oo:cell/spreadsheet-calculation/SheetViewTests.js#Test: show formulas option ", () => {
    const data = [
      ["=1+1", "test1"],
      ["=2+1", "test2"],
      ["=3+1", "test3"],
      ["=4+1", "test4"],
      ["=5+1", "test5"],
      ["=6+1", "test6"],
    ].map((row) => row.map((x) => typedCell(x)));
    const h = new ViewHistory(sheetViewOptions({}));
    h.set({ ...h.current, showFormulas: true });
    const flag = (want: boolean, desc: string) => expect(!!h.current.showFormulas, desc).toBe(want);
    flag(true, "after_action");
    h.undo();
    flag(false, "after_undo");
    h.redo();
    flag(true, "after_redo");

    const defaultWidth = 64;
    const widths = (want: number, desc: string) => {
      expect(viewColumnWidth(defaultWidth, h.current), desc + "_column_0_width_").toBe(want);
      expect(viewColumnWidth(defaultWidth, h.current), desc + "_column_1_width_").toBe(want);
    };
    widths(defaultWidth * 2, "after_action");
    h.undo();
    widths(defaultWidth, "after_undo");
    h.redo();
    widths(defaultWidth * 2, "after_redo");

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const shown = cellViewText(data[r][c], h.current);
        expect(shown.align, `align_horizonal_${c}_${r}`).toBe("left");
        if (c === 0) expect(shown.text).toBe(`=${r + 1}+1`);
      }
    }
  });

  it("oo:cell/spreadsheet-calculation/open-oox-in-browser.js#Tables", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" displayName="Table1" ref="B2:B3" insertRow="1" totalsRowShown="0">' +
      '<autoFilter ref="B2:B3"/><tableColumns count="1"><tableColumn id="1" name="Column1"/></tableColumns>' +
      '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>';
    const t = readTable(parseXml(xml))!;
    expect(t).toMatchObject({ name: "Table1", displayName: "Table1", ref: { r1: 1, c1: 1, r2: 2, c2: 1 }, insertRow: true, totalsRowShown: false, autoFilter: true });
    // Written back, the part is the same XML (Grown writes no revision uids).
    expect(writeTable(t)).toBe(xml);
    expect(readTable(parseXml(writeTable(t)))).toEqual(t);
  });
});
