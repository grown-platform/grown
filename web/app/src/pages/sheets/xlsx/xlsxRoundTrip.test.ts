/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { newRule, colorScaleRule } from "../cfOps";
import { makeRule } from "../validationOps";
import { defaultPrintSettings } from "../printSettings";
import { workbookToXlsx, prefixFunctions } from "./xlsxWrite";
import { readXlsx, unprefixFormula } from "./xlsxRead";
import { flattenBorders } from "./xlsxStyles";
import { pxToWidth, widthToPx, applyTint, readColor, parseXml } from "./ooxml";

const cell = (sheet: any, r: number, c: number) => sheet.celldata.find((x: any) => x.r === r && x.c === c)?.v;

function baseWorkbook(): any[] {
  const s1: any = {
    name: "Data",
    id: "s1",
    order: 0,
    celldata: [
      { r: 0, c: 0, v: { v: "Item", m: "Item", ct: { fa: "General", t: "g" }, bl: 1, bg: "#ffff00", fc: "#ff0000", fs: 14, ff: "Verdana" } },
      { r: 0, c: 1, v: { v: "Amount", m: "Amount", ct: { fa: "General", t: "g" }, ht: 0, vt: 1, tb: "2", it: 1, un: 1, cl: 1 } },
      { r: 1, c: 0, v: { v: "Apples", m: "Apples", ct: { fa: "General", t: "g" } } },
      { r: 1, c: 1, v: { v: 1234.5, m: "$1,234.50", ct: { fa: '"$"#,##0.00', t: "n" } } },
      { r: 2, c: 0, v: { v: "Pears", m: "Pears", ct: { fa: "General", t: "g" }, ps: { value: "Ripe next week", isShow: false } } },
      { r: 2, c: 1, v: { v: 0.25, m: "25%", ct: { fa: "0%", t: "n" } } },
      { r: 3, c: 0, v: { v: true, m: "TRUE", ct: { fa: "General", t: "b" } } },
      { r: 3, c: 1, v: { f: "=SUM(B2:B3)", v: 1234.75, m: "1234.75", ct: { fa: "General", t: "n" } } },
      { r: 4, c: 0, v: { v: 45292, m: "1/1/2024", ct: { fa: "m/d/yyyy", t: "d" } } },
      { r: 4, c: 1, v: { f: "=1/0", v: "#DIV/0!", m: "#DIV/0!" } },
      { r: 5, c: 0, v: { ct: { fa: "General", t: "inlineStr", s: [{ v: "bold ", bl: 1 }, { v: "red", fc: "#ff0000" }] } } },
      { r: 5, c: 1, v: { f: '=TEXTJOIN(",",TRUE,A2:A3)', v: "Apples,Pears", m: "Apples,Pears" } },
      { r: 6, c: 0, v: { v: "Merged", m: "Merged", mc: { r: 6, c: 0, rs: 2, cs: 2 } } },
      { r: 6, c: 1, v: { mc: { r: 6, c: 0 } } },
      { r: 7, c: 0, v: { mc: { r: 6, c: 0 } } },
      { r: 7, c: 1, v: { mc: { r: 6, c: 0 } } },
      { r: 8, c: 0, v: { v: "Locked off", m: "Locked off", lo: 0 } },
      { r: 9, c: 0, v: { v: "Rotated", m: "Rotated", tr: "4" } },
    ],
    config: {
      merge: { "6_0": { r: 6, c: 0, rs: 2, cs: 2 } },
      columnlen: { "0": 120, "3": 40 },
      rowlen: { "1": 30 },
      rowhidden: { "10": 0 },
      colhidden: { "4": 0 },
      borderInfo: [
        { rangeType: "range", borderType: "border-all", style: 1, color: "#000000", range: [{ row: [1, 2], column: [0, 1] }] },
        { rangeType: "cell", value: { row_index: 0, col_index: 0, b: { style: 8, color: "#0000ff" } } },
      ],
    },
    frozen: { type: "rangeBoth", range: { row_focus: 0, column_focus: 0 } },
    color: "#00ff00",
    showGridLines: 0,
    zoomRatio: 1.5,
    grownView: { showFormulas: true, showHeadings: false },
    hyperlink: { "1_0": { linkType: "webpage", linkAddress: "https://example.com/" }, "2_0": { linkType: "cellrange", linkAddress: "Data!B2" } },
    _namedRanges: [{ name: "Amounts", range: "B2:B3", sheetId: "s1", sheetName: "Data" }],
  };
  const s2: any = { name: "Other sheet", id: "s2", order: 1, hide: 1, celldata: [{ r: 0, c: 0, v: { f: "=Data!B2*2", v: 2469, m: "2469", ct: { fa: "General", t: "n" } } }] };
  return [s1, s2];
}

async function roundTrip(sheets: any[]) {
  const bytes = await workbookToXlsx(sheets);
  return readXlsx(bytes, { userId: "u-import" });
}

describe("xlsx round trip", () => {
  it("keeps values, formulas, formats and rich text", async () => {
    const { sheets } = await roundTrip(baseWorkbook());
    const s = sheets[0];
    expect(s.name).toBe("Data");
    expect(cell(s, 0, 0).v).toBe("Item");
    expect(cell(s, 1, 1)).toMatchObject({ v: 1234.5, ct: { fa: '"$"#,##0.00', t: "n" } });
    expect(cell(s, 2, 1)).toMatchObject({ v: 0.25, ct: { fa: "0%" } });
    expect(cell(s, 3, 0)).toMatchObject({ v: true, ct: { t: "b" } });
    expect(cell(s, 3, 1)).toMatchObject({ f: "=SUM(B2:B3)", v: 1234.75 });
    expect(cell(s, 4, 0)).toMatchObject({ v: 45292, ct: { fa: "m/d/yyyy", t: "d" } });
    expect(cell(s, 4, 1)).toMatchObject({ f: "=1/0", v: "#DIV/0!" });
    expect(cell(s, 5, 0).ct.t).toBe("inlineStr");
    expect(cell(s, 5, 0).ct.s).toEqual([
      expect.objectContaining({ v: "bold ", bl: 1 }),
      expect.objectContaining({ v: "red", fc: "#ff0000" }),
    ]);
    // _xlfn. prefixes are added on write and stripped on read.
    expect(cell(s, 5, 1).f).toBe('=TEXTJOIN(",",TRUE,A2:A3)');
    expect(sheets[1]).toMatchObject({ name: "Other sheet", hide: 1 });
    expect(cell(sheets[1], 0, 0).f).toBe("=Data!B2*2");
  });

  it("keeps fonts, fills, alignment, borders and locking", async () => {
    const { sheets } = await roundTrip(baseWorkbook());
    const s = sheets[0];
    expect(cell(s, 0, 0)).toMatchObject({ bl: 1, bg: "#ffff00", fc: "#ff0000", fs: 14, ff: "Verdana" });
    expect(cell(s, 0, 1)).toMatchObject({ ht: 0, vt: 1, tb: "2", it: 1, un: 1, cl: 1 });
    expect(cell(s, 8, 0).lo).toBe(0);
    expect(cell(s, 9, 0).tr).toBe("4");
    const b = flattenBorders(s.config.borderInfo);
    expect(b.get("1_0")).toEqual({ l: { style: 1, color: "#000000" }, r: { style: 1, color: "#000000" }, t: { style: 1, color: "#000000" }, b: { style: 1, color: "#000000" } });
    expect(b.get("0_0")?.b).toEqual({ style: 8, color: "#0000ff" });
  });

  it("keeps merges, sizes, hidden rows/columns, panes and view options", async () => {
    const { sheets } = await roundTrip(baseWorkbook());
    const s = sheets[0];
    expect(s.config.merge).toEqual({ "6_0": { r: 6, c: 0, rs: 2, cs: 2 } });
    expect(cell(s, 6, 0).mc).toEqual({ r: 6, c: 0, rs: 2, cs: 2 });
    expect(cell(s, 7, 1).mc).toEqual({ r: 6, c: 0 });
    expect(s.config.columnlen["0"]).toBe(120);
    expect(s.config.columnlen["3"]).toBe(40);
    expect(s.config.rowlen["1"]).toBe(30);
    expect(s.config.rowhidden).toHaveProperty("10");
    expect(s.config.colhidden).toHaveProperty("4");
    expect(s.frozen).toEqual({ type: "rangeBoth", range: { row_focus: 0, column_focus: 0 } });
    expect(s.color).toBe("#00ff00");
    expect(s.showGridLines).toBe(0);
    expect(s.zoomRatio).toBe(1.5);
    expect(s.grownView).toEqual({ showFormulas: true, showHeadings: false });
  });

  it("keeps named ranges, hyperlinks and comments", async () => {
    const { sheets, namedRanges } = await roundTrip(baseWorkbook());
    expect(namedRanges).toEqual([expect.objectContaining({ name: "Amounts", range: "B2:B3", sheetName: "Data" })]);
    expect(sheets[0]._namedRanges[0].name).toBe("Amounts");
    expect(sheets[0].hyperlink["1_0"]).toEqual({ linkType: "webpage", linkAddress: "https://example.com/" });
    expect(sheets[0].hyperlink["2_0"]).toEqual({ linkType: "cellrange", linkAddress: "Data!B2" });
    expect(cell(sheets[0], 2, 0).ps.value).toBe("Ripe next week");
  });

  it("keeps conditional formatting rules", async () => {
    const wb = baseWorkbook();
    const R = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });
    wb[0].grownCF = [
      newRule("cellIs", [R(1, 1, 5, 1)], { priority: 1, operator: "greaterThan", formula1: "100", style: { fill: "#ffc7ce", color: "#9c0006", bold: true } }),
      newRule("cellIs", [R(1, 1, 5, 1)], { priority: 2, operator: "between", formula1: "1", formula2: "=$C$1", style: { fill: "#00ff00" } }),
      newRule("containsText", [R(1, 0, 5, 0)], { priority: 3, text: "App", style: { color: "#0000ff" }, stopIfTrue: true }),
      newRule("expression", [R(1, 0, 5, 1)], { priority: 4, formula1: "=MOD(ROW(),2)=0", style: { fill: "#eeeeee" } }),
      newRule("top10", [R(1, 1, 5, 1)], { priority: 5, rank: 3, percent: true, bottom: true, style: { italic: true } }),
      newRule("aboveAverage", [R(1, 1, 5, 1)], { priority: 6, above: false, equalAverage: true, stdDev: 1, style: { underline: true } }),
      newRule("timePeriod", [R(1, 0, 5, 0)], { priority: 7, period: "lastMonth", style: { fill: "#123456" } }),
      newRule("duplicateValues", [R(1, 0, 5, 0)], { priority: 8, style: { fill: "#654321" } }),
      { ...colorScaleRule([R(1, 1, 5, 1)], 3), priority: 9 },
      newRule("dataBar", [R(1, 1, 5, 1)], { priority: 10 }),
      newRule("iconSet", [R(1, 1, 5, 1)], { priority: 11, iconSet: "5Arrows", reverse: true, showValue: false, cfvos: [{ type: "percent", value: "0" }, { type: "percent", value: "20", gte: false }, { type: "num", value: "40" }, { type: "percentile", value: "60" }, { type: "formula", value: "=$C$2" }] }),
      newRule("containsBlanks", [R(1, 0, 5, 0)], { priority: 12, style: { fill: "#cccccc" } }),
    ];
    const { sheets } = await roundTrip(wb);
    const got = sheets[0].grownCF;
    const strip = (r: any) => {
      const { id: _id, ...rest } = r;
      return rest;
    };
    expect(got.map(strip)).toEqual(wb[0].grownCF.map(strip).map((r: any) => (r.type === "dataBar" ? { ...r, bar: { ...r.bar, min: { type: "min" }, max: { type: "max" }, color: "#638ec6" } } : r)));
  });

  it("keeps data validation", async () => {
    const wb = baseWorkbook();
    const R = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });
    wb[0].grownDV = [
      makeRule([R(1, 2, 5, 2)], { type: "list", formula1: ["Yes", "No", "Maybe"], showInput: true, promptTitle: "Pick", prompt: "One of three" }),
      makeRule([R(1, 3, 5, 3)], { type: "whole", operator: "between", formula1: 1, formula2: 10, errorStyle: "warning", error: "1 to 10", errorTitle: "Range" }),
      makeRule([R(1, 4, 5, 4)], { type: "list", formula1: { range: R(1, 0, 5, 0) } }),
      makeRule([R(1, 5, 5, 5)], { type: "custom", formula1: "=ISNUMBER(F2)" }),
      makeRule([R(1, 6, 5, 6)], { type: "date", operator: "greaterThan", formula1: "45292" }),
    ];
    const { sheets } = await roundTrip(wb);
    const strip = (r: any) => {
      const { id: _id, checked: _c, unchecked: _u, ...rest } = r;
      return rest;
    };
    expect(sheets[0].grownDV.map(strip)).toEqual(wb[0].grownDV.map(strip));
  });

  it("keeps the autofilter with its criteria", async () => {
    const wb = baseWorkbook();
    wb[0].grownFilter = {
      range: { r1: 0, c1: 0, r2: 5, c2: 1 },
      columns: {
        "0": { type: "values", values: ["Apples", "Pears"], blank: true },
        "1": { type: "custom", and: true, conditions: [{ op: "isGreaterThan", val: "10" }, { op: "doesNotContain", val: "x" }] },
      },
      sort: { colId: 1, desc: true },
    };
    const { sheets } = await roundTrip(wb);
    expect(sheets[0].grownFilter).toEqual(wb[0].grownFilter);
    expect(sheets[0].filter_select).toEqual({ row: [0, 5], column: [0, 1] });
  });

  it("keeps print settings, print area and titles", async () => {
    const wb = baseWorkbook();
    wb[0].grownPrint = {
      ...defaultPrintSettings(),
      orientation: "landscape",
      paper: "a4",
      margins: { top: 1, bottom: 1, left: 0.5, right: 0.5, header: 0.2, footer: 0.2 },
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: { r1: 0, c1: 0, r2: 20, c2: 5 },
      titleRows: [0, 1],
      titleCols: [0, 0],
      gridLines: true,
      headings: true,
      hCenter: true,
      rowBreaks: [10, 15],
      colBreaks: [3],
      header: "Quarterly report",
      footer: "Page &P of &N",
      pageOrder: "overThenDown",
    };
    const { sheets } = await roundTrip(wb);
    expect(sheets[0].grownPrint).toEqual(wb[0].grownPrint);
  });

  it("keeps sheet protection, unlocked ranges and user-protected ranges", async () => {
    const wb = baseWorkbook();
    wb[0].grownProtection = {
      sheet: { users: ["u2"], by: "u1", except: [{ r1: 20, c1: 0, r2: 21, c2: 1 }] },
      ranges: [{ id: "p1", name: "Totals", ranges: [{ r1: 3, c1: 1, r2: 3, c2: 1 }], users: ["u3", "u4"], by: "u1", description: "Totals row" }],
    };
    const { sheets } = await roundTrip(wb);
    const p = sheets[0].grownProtection;
    // Excel has no per-user sheet protection: the sheet comes back owned by the importer.
    expect(p.sheet).toMatchObject({ users: [], by: "u-import", except: [] });
    // Unlocked cells come back as unlocked cell formats.
    expect(cell(sheets[0], 20, 0).lo).toBe(0);
    expect(cell(sheets[0], 21, 1).lo).toBe(0);
    expect(p.ranges).toEqual([expect.objectContaining({ name: "Totals", ranges: [{ r1: 3, c1: 1, r2: 3, c2: 1 }], users: ["u3", "u4"], by: "u1", description: "Totals row" })]);
  });

  it("keeps tables", async () => {
    const wb = baseWorkbook();
    wb[0].grownTables = [
      {
        id: 7,
        name: "Fruit",
        displayName: "Fruit",
        ref: { r1: 0, c1: 0, r2: 5, c2: 1 },
        headerRowCount: 1,
        totalsRowCount: 0,
        totalsRowShown: false,
        insertRow: false,
        autoFilter: true,
        columns: [{ id: 1, name: "Item" }, { id: 2, name: "Amount" }],
        style: { name: "TableStyleMedium9", showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
      },
    ];
    const { sheets } = await roundTrip(wb);
    expect(sheets[0].grownTables).toEqual([{ ...wb[0].grownTables[0], id: 1 }]);
  });

  it("keeps a styled table with totals, a calculated column and structured references", async () => {
    const sheet: any = {
      name: "Sales",
      id: "s1",
      order: 0,
      celldata: [
        { r: 0, c: 0, v: { v: "Region", m: "Region" } },
        { r: 0, c: 1, v: { v: "Qty", m: "Qty" } },
        { r: 0, c: 2, v: { v: "Unit price", m: "Unit price" } },
        { r: 0, c: 3, v: { v: "Total", m: "Total" } },
        { r: 1, c: 0, v: { v: "East", m: "East" } },
        { r: 1, c: 1, v: { v: 2, m: "2" } },
        { r: 1, c: 2, v: { v: 10, m: "10" } },
        { r: 1, c: 3, v: { f: "=[@Qty]*[@[Unit price]]", v: 20, m: "20" } },
        { r: 2, c: 0, v: { v: "West", m: "West" } },
        { r: 2, c: 1, v: { v: 3, m: "3" } },
        { r: 2, c: 2, v: { v: 20, m: "20" } },
        { r: 2, c: 3, v: { f: "=[@Qty]*[@[Unit price]]", v: 60, m: "60" } },
        { r: 3, c: 0, v: { v: "Total", m: "Total" } },
        { r: 3, c: 3, v: { f: "=SUBTOTAL(109,[Total])", v: 80, m: "80" } },
        { r: 5, c: 0, v: { f: "=SUM(Sales[Total])/ROWS(Sales)", v: 40, m: "40" } },
      ],
      grownTables: [
        {
          id: 1,
          name: "Sales",
          displayName: "Sales",
          ref: { r1: 0, c1: 0, r2: 3, c2: 3 },
          headerRowCount: 1,
          totalsRowCount: 1,
          totalsRowShown: true,
          insertRow: false,
          autoFilter: true,
          columns: [
            { id: 1, name: "Region", totalsRowLabel: "Total" },
            { id: 2, name: "Qty" },
            { id: 3, name: "Unit price" },
            { id: 4, name: "Total", totalsRowFunction: "sum", calculatedColumnFormula: "=[@Qty]*[@[Unit price]]" },
          ],
          style: { name: "TableStyleLight9", showFirstColumn: true, showLastColumn: false, showRowStripes: false, showColumnStripes: true },
        },
      ],
    };
    const zip = await JSZip.loadAsync(await workbookToXlsx([sheet]));
    const part = await zip.file("xl/tables/table1.xml")!.async("string");
    expect(part).toContain('totalsRowCount="1"');
    expect(part).toContain("<calculatedColumnFormula>Sales[[#This Row],[Qty]]*Sales[[#This Row],[Unit price]]</calculatedColumnFormula>");
    expect(part).toContain('totalsRowFunction="sum"');
    expect(part).toContain('<autoFilter ref="A1:D3"/>');
    expect(part).toContain('name="TableStyleLight9" showFirstColumn="1" showLastColumn="0" showRowStripes="0" showColumnStripes="1"');
    const ws = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(ws).toContain("<f>Sales[[#This Row],[Qty]]*Sales[[#This Row],[Unit price]]</f>");
    expect(ws).toContain("<f>SUBTOTAL(109,Sales[Total])</f>");
    expect(ws).toContain("<f>SUM(Sales[Total])/ROWS(Sales)</f>");
    const { sheets } = await roundTrip([sheet]);
    expect(sheets[0].grownTables).toEqual(sheet.grownTables);
    // Back in the edit form, the own table's name dropped inside it.
    expect(cell(sheets[0], 1, 3).f).toBe("=[@Qty]*[@[Unit price]]");
    expect(cell(sheets[0], 3, 3).f).toBe("=SUBTOTAL(109,[Total])");
    expect(cell(sheets[0], 5, 0).f).toBe("=SUM(Sales[Total])/ROWS(Sales)");
  });

  it("writes a package Excel can open (content types, relationships, parts)", async () => {
    const zip = await JSZip.loadAsync(await workbookToXlsx(baseWorkbook()));
    const names = Object.keys(zip.files);
    for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/comments1.xml", "xl/drawings/vmlDrawing1.vml"]) {
      expect(names).toContain(p);
    }
    for (const p of names.filter((n) => n.endsWith(".xml") || n.endsWith(".rels"))) {
      const doc = parseXml(await zip.file(p)!.async("string"));
      expect(doc.getElementsByTagName("parsererror").length, p).toBe(0);
    }
    const ws = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    // Elements appear in the schema's sequence.
    const order = ["sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "mergeCells", "hyperlinks", "pageMargins", "pageSetup", "legacyDrawing"];
    const pos = order.map((t) => ws.indexOf(`<${t}`));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(ws).toContain("_xlfn.TEXTJOIN");
  });

  it("expands shared formulas and reads inline strings", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file(
      "_rels/.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    );
    zip.file(
      "xl/workbook.xml",
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c></row>' +
        '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>inline</t></is></c><c r="B3"><f t="shared" si="0"/><v>0</v></c></row>' +
        "</sheetData></worksheet>",
    );
    const { sheets } = await readXlsx(await zip.generateAsync({ type: "uint8array" }));
    expect(cell(sheets[0], 1, 1).f).toBe("=A2*2");
    expect(cell(sheets[0], 2, 1).f).toBe("=A3*2");
    expect(cell(sheets[0], 2, 0).v).toBe("inline");
  });
});

describe("ooxml helpers", () => {
  it("converts column widths and pixels both ways", () => {
    for (const px of [20, 64, 73, 100, 200]) expect(widthToPx(pxToWidth(px))).toBe(px);
    // Excel stores the default 8.43-character column as 9.140625 (padding included).
    expect(widthToPx(9.140625)).toBe(64);
  });
  it("applies theme tints", () => {
    expect(applyTint("4472C4", 0)).toBe("4472C4");
    expect(applyTint("000000", 0.5)).toBe("808080");
    const el = parseXml('<color theme="4" tint="-0.25"/>').documentElement;
    expect(readColor(el, ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4"])).toBe("#2f5597");
  });
  it("prefixes newer functions and strips the prefixes again", () => {
    expect(prefixFunctions('XLOOKUP(A1,B:B,C:C)+SUM(FILTER(A1:A3,A1:A3>1))&"IFS("')).toBe(
      '_xlfn.XLOOKUP(A1,B:B,C:C)+SUM(_xlfn._xlws.FILTER(A1:A3,A1:A3>1))&"IFS("',
    );
    expect(unprefixFormula("_xlfn.LET(_xlpm.x,1,_xlpm.x+1)")).toBe("LET(x,1,x+1)");
  });
});
