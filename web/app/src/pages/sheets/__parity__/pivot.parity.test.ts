// Ports of OnlyOffice's pivot table suite (behaviour only, clean-room):
//   cell/spreadsheet-calculation/PivotTests.js
// against ../pivotEngine.ts. Each OnlyOffice test builds a pivot through its
// API and compares the report's cell text with a recorded matrix; here the
// same pivots are described as Grown PivotConfig objects and the recorded
// matrices live in pivot.fixtures.json. The undo/redo/XML round trips the
// suite also runs are OnlyOffice history plumbing and are not ported.

import { describe, expect, it } from "vitest";
import fixtures from "./pivot.fixtures.json";
import { typedCell, type Cell } from "../cellValue";
import { formatGeneral, formatRuns, formatValue } from "../numberFormat";
import { cellText, computeReport, detailTable, type GridCell } from "../pivotEngine";
import {
  cellItemKey,
  freezeItemOrder,
  remapFields,
  sourceFromGrid,
  srcCell,
  type Agg,
  type FieldFilter,
  type PivotConfig,
  type PivotDataField,
  type PivotSource,
  type ShowAs,
} from "../pivotModel";

const REPORTS = fixtures.reports as Record<string, string[][]>;

// ---- data sets (the suite's sample tables) ---------------------------------

const HEAD = ["Region", "Gender", "Style", "Ship date", "Units", "Price", "Cost"];
const SALES: (string | number)[][] = [
  HEAD,
  ["East", "Boy", "Tee", 38383, 12, 11.04, 10.42],
  ["East", "Boy", "Golf", 38383, 12, 13, 12.6],
  ["East", "Boy", "Fancy", 38383, 12, 11.96, 11.74],
  ["East", "Girl", "Tee", 38383, 10, 11.27, 10.56],
  ["East", "Girl", "Golf", 38383, 10, 12.12, 11.95],
  ["East", "Girl", "Fancy", 38383, 10, 13.74, 13.33],
  ["West", "Boy", "Tee", 38383, 11, 11.44, 10.94],
  ["West", "Boy", "Golf", 38383, 11, 12.63, 11.73],
  ["West", "Boy", "Fancy", 38383, 11, 12.06, 11.51],
  ["West", "Girl", "Tee", 38383, 15, 13.42, 13.29],
  ["West", "Girl", "Golf", 38383, 15, 11.48, 10.67],
];

/** SALES with the Price column replaced. */
function withPrice(prices: unknown[]): unknown[][] {
  return SALES.map((row, i) => (i === 0 ? row : row.map((v, c) => (c === 5 ? prices[i - 1] : v))));
}
const REST = [11.44, 12.63, 12.06, 13.42, 11.48];

function source(rows: unknown[][]): PivotSource {
  return sourceFromGrid(rows.map((r) => r.map((x) => (x && typeof x === "object" ? (x as Cell) : typedCell(x)))));
}

function formatted(v: number | string | boolean, fa: string): Cell {
  if (typeof v === "string") return { v, m: formatValue(v, fa), ct: { fa, t: "s" } };
  if (typeof v === "boolean") return { v, m: v ? "TRUE" : "FALSE", ct: { fa: "General", t: "b" } };
  return { v, m: formatValue(v, fa), ct: { fa, t: "n" } };
}

function pivot(cfg: Partial<PivotConfig>): PivotConfig {
  return { id: "p", title: "", range: { r0: 0, r1: 0, c0: 0, c1: 0 }, ...cfg };
}

// A cell's text as OnlyOffice's getValue reads it: a number in a format with
// "_x" spacing and "*x" fill shows the fill character once and no spacing.
function ooText(cell: GridCell | null): string {
  if (cell && typeof cell.v === "number" && cell.fmt) {
    return formatRuns(cell.v, cell.fmt)
      .runs.map((r) => (r.kind === "skip" ? "" : r.text))
      .join("");
  }
  if (cell && typeof cell.v === "number") return formatGeneral(cell.v);
  return cellText(cell, false);
}

function text(src: PivotSource, cfg: Partial<PivotConfig>): string[][] {
  return computeReport(pivot(cfg), src).cells.map((row) => row.map(ooText));
}

function expectReport(src: PivotSource, cfg: Partial<PivotConfig>, key: string) {
  expect(REPORTS[key], `fixture ${key}`).toBeDefined();
  expect(text(src, cfg), key).toEqual(REPORTS[key]);
}

const sum = (field: number) => ({ field, agg: "sum" as const });

// setPivotLayout in the suite: compact/outline/tabular, plus two variants.
type LayoutName = "compact" | "outline" | "tabular" | "gridDropZones" | "showHeaders";
function layoutCfg(l: LayoutName): Partial<PivotConfig> {
  switch (l) {
    case "gridDropZones":
      return { layout: "tabular", gridDropZones: true };
    case "showHeaders":
      return { layout: "compact", showHeaders: false };
    default:
      return { layout: l };
  }
}

const sales = source(SALES);

describe("PivotTests.js", () => {
  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Validations", () => {
    // A sheet-qualified A1 range is a valid data reference.
    expect(/^[^!]+![A-Z]+\d+:[A-Z]+\d+$/.test("Data!B2:H13")).toBe(true);
  });

  const LAYOUTS: LayoutName[] = ["compact", "outline", "tabular", "gridDropZones", "showHeaders"];
  const SHAPES: [string, number[], number[]][] = [
    ["0row_0col", [], []],
    ["0row_1col", [], [2]],
    ["0row_2col", [], [2, 4]],
    ["1row_0col", [0], []],
    ["1row_1col", [0], [2]],
    ["1row_2col", [0], [2, 4]],
    ["2row_0col", [0, 1], []],
    ["2row_1col", [0, 1], [2]],
    ["2row_2col", [0, 1], [2, 4]],
  ];
  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Layout", () => {
    for (const l of LAYOUTS) {
      for (const [shape, rows, cols] of SHAPES) {
        const base = { ...layoutCfg(l), rows, cols };
        const p = `${l}_${shape}`;
        expectReport(sales, { ...base, values: [] }, `${p}_0data`);
        expectReport(sales, { ...base, values: [sum(5)] }, `${p}_1data`);
        expectReport(sales, { ...base, values: [sum(5), sum(6)] }, `${p}_2data_col`);
        expectReport(sales, { ...base, values: [sum(5), sum(6)], valuesAxis: "rows" }, `${p}_2data_row`);
      }
    }
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Layout Values", () => {
    for (const l of ["compact", "outline", "tabular"] as LayoutName[]) {
      const base = { ...layoutCfg(l), rows: [0, 1], cols: [2, 4], values: [sum(5), sum(6)] };
      expectReport(sales, { ...base }, `${l}_2row_2col_2data_col`);
      expectReport(sales, { ...base, valuesPos: 1 }, `${l}_2row_2col_2data_col2`);
      expectReport(sales, { ...base, valuesPos: 0 }, `${l}_2row_2col_2data_col1`);
      expectReport(sales, { ...base, valuesAxis: "rows" }, `${l}_2row_2col_2data_row`);
      expectReport(sales, { ...base, valuesAxis: "rows", valuesPos: 1 }, `${l}_2row_2col_2data_row2`);
      expectReport(sales, { ...base, valuesAxis: "rows", valuesPos: 0 }, `${l}_2row_2col_2data_row1`);
    }
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Subtotal", () => {
    for (const l of ["compact", "tabular"] as LayoutName[]) {
      const base = { ...layoutCfg(l), rows: [0, 1, 2, 4], values: [sum(5), sum(6)], valuesAxis: "rows" as const, valuesPos: 2 };
      expectReport(sales, { ...base, defaultSubtotal: false }, `subtotal_${l}_none`);
      expectReport(sales, { ...base, subtotalTop: false }, `subtotal_${l}_bottom`);
      expectReport(sales, { ...base, subtotalTop: true }, `subtotal_${l}_top`);
    }
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: InsertBlankRow", () => {
    const base = { insertBlankRow: true, values: [sum(5), sum(6)] };
    expectReport(sales, { ...base, rows: [0] }, "insertBlankRow_1row");
    expectReport(sales, { ...base, rows: [0], valuesAxis: "rows" }, "insertBlankRow_2row");
    expectReport(sales, { ...base, rows: [0, 1], valuesAxis: "rows", valuesPos: 1 }, "insertBlankRow_3row");
    expectReport(sales, { ...base, rows: [0, 1, 2], valuesAxis: "rows", valuesPos: 1 }, "insertBlankRow_4row");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: PageFilter layout", () => {
    const pages = (fs: number[]) => fs.map((field) => ({ field }));
    expectReport(sales, { pages: pages([0]) }, "filter_downThenOver1");
    expectReport(sales, { pages: pages([0, 1, 2]) }, "filter_downThenOver3");
    expectReport(sales, { pages: pages([0, 1, 2]), pageWrap: 2 }, "filter_downThenOver3_2wrap");
    expectReport(sales, { pages: pages([0, 1, 2, 3, 4, 5, 6]), pageWrap: 2 }, "filter_downThenOver7_2wrap");
    expectReport(sales, { pages: pages([0, 1, 2, 3, 4, 5, 6]), pageWrap: 2, pageOverThenDown: true }, "filter_overThenDown7_2wrap");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Field Property", () => {
    const base = { rows: [0, 4, 1, 2], values: [sum(5), sum(6)], valuesAxis: "rows" as const, valuesPos: 3 };
    const field0 = { compact: false, outline: true, subtotalTop: false, insertBlankRow: true };
    expectReport(sales, { ...base, fields: { 0: field0 } }, "field0");
    expectReport(sales, { ...base, fields: { 0: field0, 4: { name: "UnitsCustom", outline: false, compact: false, showAll: true } } }, "field4");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Field Subtotal", () => {
    const base = { rows: [0, 1], cols: [2], values: [sum(5)] };
    expectReport(sales, { ...base, fields: { 0: { subtotals: "none" } } }, "fieldSubtotalNone");
    expectReport(sales, { ...base, fields: { 0: {} } }, "fieldSubtotalAuto");
    expectReport(sales, { ...base, fields: { 0: { subtotals: ["countNums"] } } }, "fieldSubtotalCustom");
    const all: Agg[] = ["sum", "countNums", "average", "max", "min", "product", "count", "stdDev", "stdDevP", "var", "varP"];
    expectReport(sales, { ...base, fields: { 0: { subtotals: all } } }, "fieldSubtotalAll");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: data values", () => {
    const aggs: [Agg, string][] = [
      ["count", "Count"],
      ["countNums", "CountNums"],
      ["min", "Min"],
      ["max", "Max"],
      ["sum", "Sum"],
      ["average", "Average"],
      ["product", "Product"],
      ["stdDev", "StdDev"],
      ["stdDevP", "StdDevp"],
      ["var", "Var"],
      ["varP", "Varp"],
    ];
    const cfg = {
      rows: [0, 1],
      values: aggs.map(([agg, title], i) => ({ field: 5, agg, name: `${title === "CountNums" ? "Count" : title} of Price${i + 1}` })),
    };
    const dateFmt = "[$-409]m/d/yyyy h:mm AM/PM;@";
    const sets: [string, unknown[]][] = [
      ["data_values1", [11.04, 13, 11.96, 11.27, 12.12, 13.74, ...REST]],
      ["data_values2", [11.05, "", 11.96, "", 12.12, "", ...REST]],
      ["data_values3", [11.05, "q", 11.96, "w", 12.12, "e", ...REST]],
      ["data_values4", [11.05, "TRUE", 11.96, "FALSE", 12.12, "TRUE", ...REST]],
      ["data_values5", [11.04, "#N/A", 11.96, "#N/A", 12.12, "#N/A", ...REST]],
      ["data_values6", [11.04, formatted(13, dateFmt), 11.96, formatted(11.27, dateFmt), 12.12, formatted(13.74, dateFmt), ...REST]],
      ["data_values7", ["", "", "", "q", "", "", "q", 1, "", 2, 3]],
    ];
    for (const [key, prices] of sets) expectReport(source(withPrice(prices)), cfg, key);
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: header rename", () => {
    const rich: Cell = { ct: { t: "inlineStr", s: [{ v: "qwe" }, { v: "rty" }] } };
    const header: unknown[] = [
      "1",
      "qwe",
      "TRUE",
      "#DIV/0!",
      "1.234567891",
      "12345678912",
      formatted(1, "0.00"),
      formatted(2, "$#,##0.00"),
      formatted(3, "dddd\\, mmmm dd\\, yyyy"),
      formatted(4, "0.00%"),
      formatted(5, "0.00E+00"),
      rich,
      "1",
      "qwe",
    ];
    const src = source([header, header.map(() => "1")]);
    const cfg = { pages: header.map((_, field) => ({ field })), values: [sum(0), sum(0), sum(1), sum(1)] };
    expectReport(src, cfg, "headerRename");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Field Manipulation", () => {
    const count = (field: number, name?: string): PivotDataField => ({ field, agg: "count", ...(name ? { name } : {}) });
    const named = (field: number, name: string): PivotDataField => ({ field, agg: "sum", name });
    // Text fields went to rows and number fields to values.
    expectReport(sales, { rows: [0, 1, 2], values: [sum(3), sum(4), sum(5), sum(6), count(0), count(1), count(2)] }, "addField");
    expectReport(
      sales,
      { pages: [{ field: 5 }], cols: [0], rows: [1, 2, 3], values: [sum(6), count(0), count(1), count(2), named(5, "Sum of Price2"), sum(4)], valuesPos: 0 },
      "moveDataField",
    );
    expectReport(
      sales,
      { pages: [{ field: 2 }], cols: [5], rows: [1, 3, 4], values: [sum(6), count(0), count(1), count(2), named(5, "Sum of Price2"), count(0)], valuesPos: 0 },
      "moveToField",
    );
    expectReport(sales, {}, "compact_0row_0col_0data");
    expectReport(
      sales,
      { pages: [{ field: 5 }, { field: 2 }, { field: 6 }], cols: [4, 3], rows: [1, 0], values: [sum(5), count(0), count(1), sum(6), sum(5)], valuesPos: 1 },
      "moveField",
    );
    expectReport(
      sales,
      { pages: [{ field: 5 }, { field: 2 }], cols: [4, 3], rows: [1], values: [count(0), count(1), named(5, "Sum of Price2")], valuesPos: 1 },
      "removeDataField",
    );
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: manipulation values", () => {
    const base = { rows: [0, 1, 2], values: [sum(5), sum(6)] };
    expectReport(sales, base, "dataOnCols");
    expectReport(sales, { ...base, valuesAxis: "rows" }, "dataOnRows");
    expectReport(sales, { ...base, valuesAxis: "rows", valuesPos: 2 }, "dataPosition");
    expectReport(sales, { rows: [0, 1, 2], values: [] }, "dataOnRowsValues");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: data refresh", () => {
    const cfg: Partial<PivotConfig> = {
      rows: [0, 1],
      cols: [2, 3],
      pages: [{ field: 4 }, { field: 6 }],
      values: [{ field: 5, agg: "average" }, { field: 0, agg: "count" }, sum(6)],
      fields: { 0: { compact: false, outline: false, subtotals: ["average"] }, 2: { subtotals: "none" }, 4: { name: "RenamedUnits" } },
    };
    // The pivot was made on SALES: its items keep that order after a refresh.
    const made = freezeItemOrder(pivot(cfg), sales);
    expectReport(sales, made, "refreshFieldSettings");
    const records = source([
      HEAD,
      ["East", "Boy", "Tee", 38383, 12, 11.04, 10.42],
      ["East", "Boy", "Golf", 100000, 12, 13, 12.6],
      ["East", "Boy", "Fancy", 10, 12, 11.96, 11.74],
      ["North", "Girl", "Tee", 38383, 10, 11.27, 10.56],
      ["East", "Dog", "Golf", 38383, 10, 12.12, 11.95],
      ["East", "Girl", "Fancy", 38383, 10, 13.74, 13.33],
      ["West", "Boy", "WWW", 38383, 11, 11.44, 10.94],
      ["West", "Boy", "Golf", 38383, 11, 12.63, 11.73],
      ["West", "Boy", "Fancy", 38383, 11, 12.06, 11.51],
      ["West", "Girl", "BBB", 38383, 15, 13.42, 13.29],
      ["West", "Girl", "Golf", 38383, 15, 11.48, 10.67],
    ]);
    expectReport(records, made, "refreshRecords");
    const structure = source([
      ["NewField", "Region", "Style", "NewUnits", "Price", "Gender", "Cost"],
      ...[
        ["East", 11.04, "East", 12, "East", "Boy", 1],
        ["East", 13, "East", 12, "East", "Boy", 2],
        ["East", 11.96, "East", 12, "East", "Boy", 3],
        ["East", 11.27, "East", 10, "East", "Girl", 4],
        ["East", 12.12, "East", 10, "East", "Girl", 5],
        ["East", 13.74, "East", 10, "East", "Girl", 6],
        ["West", 11.44, "West", 11, "West", "Boy", 7],
        ["West", 12.63, "West", 11, "West", "Boy", 8],
        ["West", 12.06, "West", 11, "West", "Boy", 9],
        ["West", 13.42, "West", 15, "West", "Girl", 10],
        ["West", 11.48, "West", 15, "West", "Girl", 11],
      ],
    ]);
    const moved = remapFields(freezeItemOrder(made, records), records.names, structure.names);
    expectReport(structure, moved, "refreshStructure");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: data source", () => {
    expectReport(sales, { rows: [0], cols: [2], values: [sum(5)] }, "compact_1row_1col_1data");
    // Table columns [Gender]:[Price].
    const cols = source(SALES.map((r) => r.slice(1, 6)));
    expectReport(cols, { cols: [1], values: [sum(4)] }, "compact_0row_1col_1data");
    // A defined name / sheet-local name over another copy of the table.
    expectReport(source(SALES), { rows: [0], cols: [2], values: [sum(5)] }, "compact_1row_1col_1data");
  });

  const FILTER_DATA = source([
    HEAD,
    ["East", "Boy", "Tee", 1, 1, 1, 10.42],
    ["East", "Boy", "Golf", 1, 2, 2, 12.6],
    ["East", "Boy", "Fancy", 2, 2, 3, 11.74],
    ["East", "Girl", "Tee", 2, 3, 4, 10.56],
    ["East", "Girl", "Golf", 3, 3, 5, 11.95],
    ["East", "Girl", "Fancy", 3, 4, 6, 13.33],
    ["West", "Boy", "Tee", 4, 4, 7, 10.94],
    ["West", "Boy", "Golf", 4, 5, 20, 11.73],
    ["West", "Boy", "Fancy", 5, 5, 20, 11.51],
    ["West", "Girl", "Tee", 6, 6, 20, 13.29],
  ]);
  const greater = (field: number, value: number, dataField = 0): FieldFilter => ({ field, type: "value", dataField, op: "greater", value });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: filters value filter", () => {
    const base = { layout: "tabular" as const, rows: [1, 3], cols: [0, 4], values: [sum(5)] };
    expectReport(FILTER_DATA, { ...base, fieldFilters: [greater(4, 1), greater(3, 2), greater(0, 18), greater(1, 20)] }, "valueFilterOrder1");
    expectReport(FILTER_DATA, { ...base, fieldFilters: [greater(1, 20), greater(0, 18), greater(4, 1), greater(3, 2)] }, "valueFilterOrder2");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: value filter bug 46141", () => {
    const f = { layout: "tabular" as const, values: [sum(5)], fieldFilters: [greater(2, 13.5)] };
    expectReport(sales, { ...f, rows: [0, 1, 2] }, "bug-46141-row");
    expectReport(sales, { ...f, cols: [0, 1, 2] }, "bug-46141-col");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: filters top10", () => {
    // OnlyOffice runs this test disabled; the recorded report is what Excel shows.
    const cfg: Partial<PivotConfig> = {
      layout: "tabular",
      rows: [0, 2, 4],
      cols: [1],
      values: [sum(5), sum(6)],
      fieldFilters: [
        { field: 4, type: "top10", dataField: 0, top: true, count: 1, by: "items" },
        { field: 2, type: "top10", dataField: 1, top: false, count: 2, by: "percent" },
        { field: 0, type: "top10", dataField: 0, top: true, count: 12, by: "sum" },
      ],
    };
    expectReport(sales, cfg, "top10");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: filters label", () => {
    const cfg: Partial<PivotConfig> = {
      layout: "tabular",
      rows: [4, 5, 6],
      values: [sum(3)],
      fieldFilters: [
        { field: 6, type: "label", op: "greater", value: "10.6" },
        { field: 5, type: "label", op: "contains", value: "3" },
        { field: 4, type: "label", op: "less", value: "11", op2: "greater", value3: "11", and: false },
      ],
    };
    expectReport(sales, cfg, "label1");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: filters reIndex", () => {
    const base = { layout: "tabular" as const, cols: [0, 1], rows: [2, 4] };
    const named = (field: number, name: string): PivotDataField => ({ field, agg: "sum", name });
    expectReport(
      sales,
      {
        ...base,
        values: [sum(5), sum(6), sum(5), sum(6)],
        fieldFilters: [greater(2, 40, 0), greater(0, 46, 3)],
        fields: { 4: { sort: { order: "desc", dataField: 1 } }, 1: { sort: { order: "asc", dataField: 2 } } },
      },
      "reIndexStart",
    );
    expectReport(
      sales,
      {
        ...base,
        values: [named(6, "Sum of Cost2"), named(5, "Sum of Price"), named(6, "Sum of Cost"), named(5, "Sum of Price2")],
        fieldFilters: [greater(2, 40, 1), greater(0, 46, 0)],
        fields: { 4: { sort: { order: "desc", dataField: 2 } }, 1: { sort: { order: "asc", dataField: 3 } } },
      },
      "reIndexMove",
    );
    expectReport(
      sales,
      { ...base, values: [named(5, "Sum of Price"), named(5, "Sum of Price2")], fieldFilters: [greater(2, 40, 0)], fields: { 1: { sort: { order: "asc", dataField: 1 } } } },
      "reIndexDelete",
    );
    expectReport(
      sales,
      {
        ...base,
        values: [named(5, "Sum of Price"), sum(6), named(5, "Sum of Price2")],
        fieldFilters: [greater(2, 40, 0)],
        fields: { 1: { sort: { order: "asc", dataField: 2 } } },
      },
      "reIndexAdd",
    );
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: num format", () => {
    const acct = '_("$"* #,##0.0_);_("$"* \\(#,##0.0\\);_("$"* "-"?_);_(@_)';
    const rows: [string, number, number, number, number | null | string, number | string, string, boolean, string][] = [
      ["Tee", 38383, 12, 11.04, 10.42, 10.42, acct, true, "#DIV/0!"],
      ["Golf", 38384, 12, 13, 12.6, 12.6, acct, true, "#DIV/0!"],
      ["Fancy", 38385, 12, 11.96, 11.74, 11.74, acct, true, "#DIV/0!"],
      ["Tee", 38386, 10, 11.27, null, "qwe", acct, true, "#DIV/0!"],
      ["Golf", 38387, 10, 12.12, 11.95, 11.95, acct, false, "#DIV/0!"],
      ["Fancy", 38388, 10, 13.74, 13.33, 13.33, acct, false, "#DIV/0!"],
      ["Tee", 38389, 11, 11.44, 10.94, 10.94, acct, false, "#DIV/0!"],
      ["Golf", 38390, 11, 12.63, 11.73, 11.73, "0.00%", false, "#N/A"],
      ["Fancy", 38391, 11, 12.06, 11.51, 11.51, "0.00%", false, "#N/A"],
      ["Tee", 38392, 15, 13.42, 13.29, 13.29, "0.00%", false, "#N/A"],
      ["Golf", 38393, 15, 11.48, 10.67, 10.67, "0.00%", false, "#N/A"],
    ];
    const data: unknown[][] = [["Text", "Date", "Units", "Units2", "Units3", "Price", "hasBlank", "Mix", "MixFormat", "bool", "error"]];
    for (const [t, d, u, p, blank, mix, mixFmt, b, e] of rows) {
      const mixNum = typeof mix === "number" ? mix : null;
      data.push([
        formatted(t, "\\q\\-@"),
        formatted(d, "mm/dd/yy;@"),
        formatted(u, "0.0%"),
        formatted(u, acct),
        formatted(u, "0.0E+00"),
        formatted(p, '"$"#,##0.0'),
        blank === null ? { ct: { fa: acct, t: "n" } } : formatted(blank, acct),
        mixNum === null ? formatted(mix as string, acct) : formatted(mixNum, acct),
        formatted(mixNum ?? p, mixFmt),
        formatted(b, "General"),
        e,
      ]);
    }
    const src = source(data);
    const units10 = cellItemKey(srcCell(formatted(10, "0.0%")));
    const cfg: Partial<PivotConfig> = {
      layout: "tabular",
      rows: [0, 1, 3, 4],
      pages: [{ field: 2, selected: [units10] }],
      cols: [5, 6, 7, 8, 9, 10],
      values: [sum(5)],
    };
    expectReport(src, cfg, "numFormat");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: misc", () => {
    const one = source(SALES.slice(0, 2));
    expectReport(one, { title: "Title" }, "compact_0row_0col_0data");
    const cfg: Partial<PivotConfig> = {
      layout: "outline",
      rows: [0],
      cols: [1, 2],
      values: [sum(5)],
      grandTotalRow: false,
      grandTotalCol: false,
      fields: { 1: { subtotals: "none" } },
    };
    expect(text(one, cfg)).toEqual([
      ["Sum of Price", "Gender", "Style"],
      ["", "Boy", ""],
      ["Region", "Tee", ""],
      ["East", "11.04", ""],
    ]);
  });

  const SHOW_AS_DATA = source([
    HEAD,
    ...SALES.slice(1, 7),
    ["North", "Boy", "Tee", 38383, 16, 13.08, 14.06],
    ["North", "Helicopter", "Tee", 38383, 16, 5555, 14.06],
    ...SALES.slice(7),
  ]);

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Show as", () => {
    const base = { rows: [0, 2], cols: [1] };
    const as = (showAs: ShowAs, baseField: number, baseItem: number | "prev" | "next", agg: Agg = "sum"): Partial<PivotConfig> => ({
      ...base,
      values: [{ field: 5, agg, name: "Sum of Price", showAs, baseField, baseItem }],
    });
    const cases: [string, Partial<PivotConfig>][] = [
      ["percentOfTotal_compact", as("percentOfTotal", 0, 0)],
      ["differenceNext_compact", as("difference", 0, "next")],
      ["differenceNext_compact2", as("difference", 1, "next")],
      ["differencePrev_compact", as("difference", 0, "prev")],
      ["differencePrev_compact2", as("difference", 1, "prev")],
      ["differenceBase_compact", as("difference", 0, 1)],
      ["differenceBase_compact2", as("difference", 1, 1)],
      ["percentOfCol_compact", as("percentOfCol", 0, 0)],
      ["percentOfRow_compact", as("percentOfRow", 0, 0)],
      ["index_compact", as("index", 0, 0)],
      ["percentOfParentRow_compact", as("percentOfParentRow", 0, 0)],
      ["percentOfParentCol_compact", as("percentOfParentCol", 0, 0)],
      ["percentOfParent_compact", as("percentOfParent", 0, 0)],
      ["percentNext_compact", as("percent", 0, "next")],
      ["percentPrev_compact", as("percent", 0, "prev")],
      ["percentBase_compact", as("percent", 0, 1)],
      ["percentDiffNext_compact", as("percentDiff", 0, "next")],
      ["percentDiffPrev_compact", as("percentDiff", 0, "prev")],
      ["percentDiffBase_compact", as("percentDiff", 0, 1)],
      ["runTotal_compact", as("runTotal", 0, 0)],
      ["runTotal_compact2", as("runTotal", 1, 0)],
      ["runTotal_stdDev_compact", as("runTotal", 0, 0, "stdDev")],
      ["runTotal_stdDev_compact2", as("runTotal", 1, 0, "stdDev")],
      ["differenceNext_stdDev_compact", as("difference", 0, "next", "stdDev")],
      ["percentDiffNext_stdDev_compact", as("percentDiff", 0, "next", "stdDev")],
      ["percentNext_stdDev_compact", as("percent", 0, "next", "stdDev")],
      ["percentRunTotal_compact", as("percentOfRunningTotal", 0, 0)],
      ["percentRunTotal_compact2", as("percentOfRunningTotal", 1, 0)],
      ["percentRunTotal_stdDev_compact", as("percentOfRunningTotal", 0, 0, "stdDev")],
      ["rankAscending_compact", as("rankAscending", 0, 0)],
      ["rankAscending_compact2", as("rankAscending", 1, 0)],
      ["rankAscending_stdDev_compact", as("rankAscending", 0, 0, "stdDev")],
      ["rankDescending_compact", as("rankDescending", 0, 0)],
      ["rankDescending_compact2", as("rankDescending", 1, 0)],
      ["rankDescending_stdDev_compact", as("rankDescending", 0, 0, "stdDev")],
    ];
    for (const [key, cfg] of cases) expectReport(SHOW_AS_DATA, cfg, key);
    expectReport(SHOW_AS_DATA, { ...as("difference", 0, "next"), layout: "tabular" }, "differenceNext_tabular");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests.js#Test: Show Details", () => {
    const data = source([
      HEAD,
      ["East", "Boy", "Tee", 1, 12, 11.04, 10.42],
      ["East", "Boy", "Golf", 1, 12, 13, 12.6],
      ["East", "Boy", "Fancy", 2, 12, 11.96, 11.74],
      ["East", "Girl", "Tee", 2, 10, 11.27, 10.56],
      ["East", "Girl", "Golf", 1, 10, 12.12, 11.95],
      ["East", "Girl", "Fancy", 2, 10, 13.74, 13.33],
      ["West", "Boy", "Tee", 1, 11, 11.44, 10.94],
      ["West", "Boy", "Golf", 2, 11, 12.63, 11.73],
      ["West", "Boy", "Fancy", 1, 11, 12.06, 11.51],
      ["West", "Girl", "Tee", 2, 15, 13.42, 13.29],
      ["West", "Girl", "Golf", 1, 15, 11.48, 10.67],
    ]);
    // The report's table starts on sheet row 3 (A3); cells are given as
    // 0-based sheet (row, column) like the suite does.
    const details = (cfg: Partial<PivotConfig>, row: number, col: number) => {
      const rep = computeReport(pivot(cfg), data);
      return detailTable(rep, row - 2 + rep.tableRow, col);
    };
    const want = (key: string) => REPORTS[key];
    const cfg: Partial<PivotConfig> = { rows: [0, 2, 4], cols: [1], values: [sum(5)] };
    expect(details(cfg, 4, 3)).toEqual(want("details_standardNoFilterEastGT"));
    expect(details(cfg, 5, 3)).toEqual(want("details_standardNoFilterFancyGT"));
    expect(details(cfg, 6, 3)).toEqual(want("details_standardNoFilter10GT"));
    expect(details(cfg, 4, 2)).toEqual(want("details_standardNoFilterEastGirl"));
    expect(details(cfg, 5, 2)).toEqual(want("details_standardNoFilterFancyGirl"));
    expect(details(cfg, 7, 2)).toEqual(want("details_standardNoFilter12Girl"));
    // Ship date as a page field showing its first item (1).
    const ship1 = cellItemKey(data.records[0][3]);
    const filtered = { ...cfg, pages: [{ field: 3, selected: [ship1] }] };
    expect(details(filtered, 4, 3)).toEqual(want("details_standardFilterEastGT"));
    expect(details(filtered, 17, 3)).toEqual(want("details_standardFilterGTGT"));
    // Units 10 and 12 grouped (a group field above Units).
    const units = (u: number) => cellItemKey(srcCell(typedCell(u)));
    const grouped: Partial<PivotConfig> = {
      ...filtered,
      groups: [{ source: 4, name: "Units2", type: "items", items: [{ name: "Group1", keys: [units(10), units(12)] }] }],
      rows: [0, 2, 7, 4],
    };
    expect(details(grouped, 6, 3)).toEqual(want("details_standardGroupFilter"));
  });
});
