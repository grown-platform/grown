// @vitest-environment node
// Ports of OnlyOffice's second pivot suite (behaviour only, clean-room):
//   cell/spreadsheet-calculation/PivotTests2.js
// The suite opens workbooks made in Excel, changes their pivot tables
// (refresh, change the source, move or remove fields, add calculated items,
// rename captions) and compares the reports with the ones Excel saved.
// pivot2.fixtures.json holds, per workbook, each pivot's definition as a
// Grown PivotConfig, its source cells and the report Excel rendered (raw
// values). Here each change is made on the config and the report
// pivotEngine.ts computes must equal Excel's. The cell fill and number-format
// flags the suite also compares belong to OnlyOffice's pivot styles, which
// Grown does not have; formats of value fields are checked instead.
// GETPIVOTDATA itself is evaluated by the Go engine
// (internal/sheets/formula_pivot_test.go); the formula Excel writes for a
// clicked pivot cell is checked here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import fixtures from "./pivot2.fixtures.json";
import type { Cell } from "../cellValue";
import { formatGeneral, formatValue } from "../numberFormat";
import { computeReport, type PivotReport } from "../pivotEngine";
import { getPivotDataFormula, pivotAt, pivotDataParams, pivotDataParamsFor, reportAreas } from "../pivotGrid";
import {
  applyPivotEdit,
  calculatedItemError,
  canAddCalculatedItemName,
  freezeItemOrder,
  remapFields,
  sourceFromGrid,
  VALUES,
  type PivotConfig,
  type PivotOutput,
  type PivotSource,
} from "../pivotModel";

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture JSON is loosely typed. */

interface FxPivot {
  ref: string;
  config: PivotConfig & { source: string };
  expected: { r0: number; c0: number; cells: any[][] };
}
interface FxBook {
  sources: Record<string, ({ v: any; fa: string } | null)[][]>;
  sheets: Record<string, { pivots: FxPivot[] }>;
}
const BOOKS = (fixtures as any).workbooks as Record<string, FxBook>;

function cellOf(x: { v: any; fa: string } | null): Cell {
  if (!x) return null;
  const v = x.v;
  if (v && typeof v === "object") return { v: v.error, m: v.error };
  if (typeof v === "number")
    return { v, m: x.fa && x.fa !== "General" ? formatValue(v, x.fa) : formatGeneral(v), ct: { fa: x.fa ?? "General", t: "n" } };
  if (typeof v === "boolean") return { v, m: v ? "TRUE" : "FALSE", ct: { fa: "General", t: "b" } };
  return { v, m: String(v), ct: { fa: "General", t: "g" } };
}

function source(book: FxBook, key: string): PivotSource {
  return sourceFromGrid(book.sources[key].map((r) => r.map(cellOf)));
}

function pivotOf(book: string, sheet: string, i = 0): FxPivot {
  return BOOKS[book].sheets[sheet].pivots[i];
}

function report(book: string, cfg: PivotConfig & { source: string }, src?: PivotSource): PivotReport {
  return computeReport({ ...cfg, range: { r0: 0, r1: 0, c0: 0, c1: 0 } }, src ?? source(BOOKS[book], cfg.source));
}

/** The report's values next to Excel's (numbers to 1e-9). */
function expectSame(rep: PivotReport, expected: any[][], label: string) {
  const rows = Math.max(expected.length, rep.rows);
  const cols = Math.max(expected[0]?.length ?? 0, rep.cols);
  const diffs: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = expected[r]?.[c] ?? null;
      const g = rep.cells[r]?.[c]?.v ?? null;
      const same = typeof e === "number" && typeof g === "number" ? Math.abs(e - g) < 1e-9 : JSON.stringify(e) === JSON.stringify(g);
      if (!same) diffs.push(`${label} (${r},${c}): Excel ${JSON.stringify(e)}, Grown ${JSON.stringify(g)}`);
    }
  }
  expect(diffs).toEqual([]);
}

/** Every pivot of a workbook renders as Excel rendered it, also after a refresh. */
function expectBook(book: string) {
  for (const [sheet, { pivots }] of Object.entries(BOOKS[book].sheets)) {
    for (const p of pivots) {
      const src = source(BOOKS[book], p.config.source);
      expectSame(report(book, p.config, src), p.expected.cells, `${book}/${sheet}`);
      const refreshed = freezeItemOrder(p.config, src) as PivotConfig & { source: string };
      expectSame(report(book, refreshed, src), p.expected.cells, `${book}/${sheet} refreshed`);
    }
  }
}

describe("PivotTests2.js", () => {
  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: refresh test_formats check values and format", () => {
    expect(Object.keys(BOOKS.test_formats.sheets).filter((s) => BOOKS.test_formats.sheets[s].pivots.length)).toHaveLength(13);
    expectBook("test_formats");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: refresh pivot-styles-numformat check values and format", () => {
    expectBook("pivot_styles_numformat");
    const p = pivotOf("pivot_styles_numformat", "pivot");
    const rep = report("pivot_styles_numformat", p.config);
    // Values of "Sum of Price" keep its number format; "Sum of Cost" has none.
    const priceCells = rep.cells.flat().filter((c) => c && (c.kind === "value" || c.kind === "grand" || c.kind === "subtotal") && c.fmt);
    expect(priceCells.length).toBeGreaterThan(0);
    expect(new Set(priceCells.map((c) => c!.fmt))).toEqual(new Set(['"$"#,##0.0']));
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: refresh pivot check formats after dataField reindex", () => {
    const b = "pivot_datafield_reindex";
    const start = pivotOf(b, "DataFieldStart");
    expectSame(report(b, start.config), start.expected.cells, "start");
    // Move the first data field after the second.
    const moved = { ...start.config, values: [start.config.values![1], start.config.values![0]] };
    expectSame(report(b, moved), pivotOf(b, "moveDataFieldResult").expected.cells, "moved");
    // Remove the Price data field (now the second).
    const removed = { ...moved, values: moved.values.filter((d) => d.field !== 5) };
    expectSame(report(b, removed), pivotOf(b, "RemoveDataFieldResult").expected.cells, "removed");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: refresh pivot check formats after change source data 1", () => {
    const b = "pivot_data_reindex1";
    const p = pivotOf(b, "pivot");
    const oldSrc = source(BOOKS[b], p.config.source);
    const newKey = "Sheet1!I2:O13";
    const newSrc = source(BOOKS[b], newKey);
    const cfg = remapFields(freezeItemOrder(p.config, oldSrc), oldSrc.names, newSrc.names) as PivotConfig & { source: string };
    expectSame(report(b, { ...cfg, source: newKey }, newSrc), p.expected.cells, "new source");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: refresh pivot check formats after change source data 2", () => {
    const b = "pivot_data_reindex2";
    const start = pivotOf(b, "start");
    let src = source(BOOKS[b], start.config.source);
    let cfg: PivotConfig = start.config;
    for (const [key, sheet] of [
      ["Sheet1!I2:O8", "reindex"],
      ["Sheet1!A2:G13", "result"],
    ] as const) {
      const next = source(BOOKS[b], key);
      cfg = remapFields(freezeItemOrder(cfg, src), src.names, next.names);
      src = next;
      expectSame(report(b, { ...cfg, source: key }, src), pivotOf(b, sheet).expected.cells, sheet);
    }
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: refresh pivot check formats after remove field", () => {
    const b = "remove_field";
    const start = pivotOf(b, "start");
    // Remove Region, add it back as the last row field, move it first.
    let rows = start.config.rows!.filter((f) => f !== 0);
    rows = [...rows, 0];
    rows = [rows[1], rows[0]];
    expectSame(report(b, { ...start.config, rows }), pivotOf(b, "result").expected.cells, "result");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: GETPIVOTDATA", () => {
    // The formula Excel writes when a pivot cell is clicked, for the cells the
    // suite checks (formula cell → pivot cell), over the Go fixture's reports.
    const gpd = JSON.parse(
      readFileSync(new URL("../../../../../../internal/sheets/testdata/pivot/getpivotdata.json", import.meta.url), "utf8"),
    ).workbooks["Test: GETPIVOTDATA"] as { name: string; formulas: { cell: string; f: string }[]; pivots: PivotOutput[] }[];
    const pairs: Record<string, [string, string][]> = {
      general: [["G4", "E11"], ["G5", "E8"], ["G6", "E9"], ["G7", "D9"], ["G8", "D11"], ["G9", "B10"], ["G15", "C17"], ["G16", "B17"], ["I23", "B24"], ["G28", "B34"], ["G29", "B41"]],
      total: [["H3", "D7"], ["H10", "B13"], ["H17", "D19"], ["H43", "A44"]],
      // D10 → B10 (an item row whose subtotal is shown below it) is left
      // out: Grown writes no GETPIVOTDATA for the empty cells of such rows.
      subtotal: [["D3", "B3"], ["D21", "B21"], ["D26", "B26"], ["D34", "B34"], ["K3", "H3"], ["K10", "H10"], ["K21", "H21"], ["K26", "I26"], ["K34", "I34"], ["R5", "O5"], ["R12", "O12"], ["R28", "P28"], ["R33", "P33"], ["AB5", "Y5"], ["AB12", "Y12"], ["AH18", "Z20"], ["AH20", "AE20"]],
      "values-col": [["AG7", "Y7"], ["AH7", "AC7"], ["AI7", "AE7"], ["AG13", "Y13"], ["AH13", "AC13"], ["AI13", "AE13"], ["AG20", "X20"], ["AH20", "AC20"], ["AI20", "AE20"], ["AG26", "X26"], ["AH26", "AC26"], ["AI26", "AE26"], ["AG33", "Y33"], ["AH33", "AC33"], ["AI33", "AE33"], ["AG39", "Y39"], ["AH39", "AC39"], ["AI39", "AE39"]],
      "values-row": [["R7", "K7"], ["S7", "O7"], ["T7", "P7"], ["R20", "K20"], ["S20", "O20"], ["T20", "P20"], ["R30", "K30"], ["S30", "O30"], ["T30", "P30"], ["R45", "K45"], ["S45", "O45"], ["T45", "P45"], ["R57", "K57"], ["S57", "O57"], ["T57", "P57"], ["R70", "K70"], ["S70", "O70"], ["T70", "P70"]],
      groups: [["F5", "D5"], ["F6", "D6"], ["F7", "D7"], ["F8", "D8"], ["F9", "D9"], ["F10", "D10"], ["F11", "D11"], ["G5", "C6"], ["G8", "C8"], ["F15", "D15"], ["F16", "D16"], ["F17", "D17"], ["F18", "D18"], ["F19", "D19"], ["F20", "D20"], ["F21", "D21"], ["F22", "D22"], ["F23", "D23"], ["F24", "D24"], ["G15", "B15"], ["G16", "B16"], ["G17", "B17"], ["G18", "B18"], ["G19", "B19"], ["G20", "B20"], ["F35", "D35"]],
    };
    const rc = (ref: string) => {
      const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
      let c = 0;
      for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
      return { r: Number(m[2]) - 1, c: c - 1 };
    };
    const wrong: string[] = [];
    let checked = 0;
    for (const [sheet, list] of Object.entries(pairs)) {
      const sh = gpd.find((s) => s.name === sheet)!;
      for (const [fcell, pcell] of list) {
        const want = sh.formulas.find((f) => f.cell === fcell)!.f.slice(1);
        const at = rc(pcell);
        const out = sh.pivots.find((o) => at.r >= o.r0 && at.r < o.r0 + o.rows && at.c >= o.c0 && at.c < o.c0 + o.cols)!;
        const got = getPivotDataFormula(out, at.r, at.c);
        checked++;
        if (got !== want) wrong.push(`${sheet}!${fcell} (${pcell}): ${got} ≠ ${want}`);
      }
    }
    expect(checked).toBe(94);
    expect(wrong).toEqual([]);
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: Api pivot builder", () => {
    const b = "pivotBuilder";
    const p = pivotOf(b, "Test");
    const rep = report(b, p.config);
    const { r0, c0 } = p.expected;
    const sheetArea = (a: { r1: number; r2: number; c1: number; c2: number }) => [a.r1 + r0, a.r2 + r0, a.c1 + c0, a.c2 + c0];
    const areas = reportAreas(rep);
    expect(sheetArea(areas.columns)).toEqual([2, 3, 1, 3]);
    expect(sheetArea(areas.rows)).toEqual([3, 12, 0, 0]);
    expect(sheetArea(areas.body)).toEqual([4, 12, 1, 3]);
    const out: PivotOutput = { sheetId: "Test", r0, c0, rows: rep.rows, cols: rep.cols, dataFields: rep.dataFields, entries: rep.entries };
    const byItems = pivotDataParamsFor(out, ["East", "Boy", "Fancy"]);
    expect(byItems).toEqual(pivotDataParams(out, 5, 1));
    expect(byItems?.dataFieldName).toBe("Sum of Price");
    expect(pivotAt([{ ...p.config, output: out }], "Test", 5, 1)?.id).toBe(p.config.id);
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS refresh", () => {
    expectBook("test_calculated");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS add", () => {
    const start = pivotOf("AddCalculatedItemsStart", "Sheet2");
    const cfg = {
      ...start.config,
      calculatedItems: [
        ...(start.config.calculatedItems ?? []),
        { field: 0, name: "Formula3", formula: "East2-10+'we''s t'" },
        { field: 1, name: "Formula2", formula: "Boy-Girl" },
        { field: 2, name: "Formula1", formula: "Fancy+Tee" },
      ],
    };
    expectSame(report("AddCalculatedItemsStart", cfg), pivotOf("AddCalculatedItemsStandard", "Sheet2").expected.cells, "added");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS remove", () => {
    const b = "AddCalculatedItemsStandard";
    const p = pivotOf(b, "Sheet2");
    const cfg = {
      ...p.config,
      calculatedItems: p.config.calculatedItems!.filter((c) => !(c.field === 0 && c.name === "Formula1") && !(c.field === 1 && c.name === "Formula2")),
    };
    expectSame(report(b, cfg), pivotOf("RemoveCalculatedItemsStandard", "Sheet2").expected.cells, "removed");
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS modify", () => {
    const b = "RemoveCalculatedItemsStandard";
    const p = pivotOf(b, "Sheet2");
    const cfg = {
      ...p.config,
      calculatedItems: p.config.calculatedItems!.map((c) =>
        c.field === 0 && c.name === "Formula2" ? { ...c, formula: "East2-15" } : c.field === 2 && c.name === "Formula1" ? { ...c, formula: "Fancy+Tee-10" } : c,
      ),
    };
    expectSame(report(b, cfg), pivotOf("ModifyCalculatedItemsStandard", "Sheet2").expected.cells, "modified");
  });

  // The field a report cell belongs to, for sheet rows 2..29 and columns A..F.
  function cellFields(book: string) {
    const p = pivotOf(book, "Sheet2");
    const rep = report(book, p.config);
    const { r0 } = p.expected;
    const out: (number | null)[][] = [];
    for (let r = 2; r < 30; r++) {
      const row: (number | null)[] = [];
      for (let c = 0; c < 6; c++) {
        const f = rep.cells[r - r0]?.[c]?.field;
        row.push(f === undefined || f === VALUES ? null : f);
      }
      out.push(row);
    }
    return out;
  }
  const rowsOf = (n: number, first: (number | null)[]) => Array.from({ length: n }, () => first);

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS getFieldIndexByCell", () => {
    const itemRows: (number | null)[][] = [];
    for (let i = 0; i < 5; i++) itemRows.push([0, null, null, null, null, null], ...rowsOf(4, [1, null, null, null, null, null]));
    expect(cellFields("AddCalculatedItemsStandard")).toEqual([
      [null, 2, null, null, null, null],
      [0, 2, 2, 2, 2, null],
      ...itemRows,
      [null, null, null, null, null, null],
    ]);
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS hasTablesErrorForCalculatedItems", () => {
    // Pivots over the same source share their items.
    const all = Object.values(BOOKS.isTablesValidForCalculatedItems.sheets).flatMap((s) => s.pivots.map((p) => p.config));
    const sharing = (cfg: PivotConfig & { source: string }) => all.filter((p) => p.source === cfg.source);
    const at = (ref: string) => BOOKS.isTablesValidForCalculatedItems.sheets.Sheet2.pivots.find((p) => p.ref.startsWith(ref))!.config;
    expect(calculatedItemError(sharing(at("A3:")), 0)).toBe("notUniqueField");
    expect(calculatedItemError(sharing(at("A12:")), 0)).toBe("pageField");
    expect(calculatedItemError(sharing(at("A19:")), 0)).toBeNull();
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS can add calculatedItemsName", () => {
    const b = "AddCalculatedItemsStandard";
    const cfg = pivotOf(b, "Sheet2").config;
    const src = source(BOOKS[b], cfg.source);
    expect(canAddCalculatedItemName(cfg, src, 0, "East2")).toBe(false);
    expect(canAddCalculatedItemName(cfg, src, 0, "East")).toBe(false);
    expect(canAddCalculatedItemName(cfg, src, 0, "Formula2")).toBe(false);
    expect(canAddCalculatedItemName(cfg, src, 0, "East3")).toBe(true);
    expect(canAddCalculatedItemName(cfg, src, 1, "East3")).toBe(true);
    expect(canAddCalculatedItemName(cfg, src, 1, "Boy")).toBe(false);
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: CALCULATED-ITEMS canChangeCalculatedItemsByActiveCell", () => {
    // A cell that names a row or column field (a caption or an item) can take a calculated item.
    const can = cellFields("AddCalculatedItemsStandard").map((row) => row.map((f) => f !== null));
    const itemRows: boolean[][] = [];
    for (let i = 0; i < 25; i++) itemRows.push([true, false, false, false, false, false]);
    expect(can).toEqual([
      [false, true, false, false, false, false],
      [true, true, true, true, true, false],
      ...itemRows,
      [false, false, false, false, false, false],
    ]);
  });

  it("oo:cell/spreadsheet-calculation/PivotTests2.js#Test: change pivot headers and labels", () => {
    const b = "PivotFieldNames";
    const editable: Record<string, string[]> = {
      General: ["A1", "A4", "C3", "B4", "C4", "D4", "E4", "A5", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "A16", "B16", "B17", "B18", "B19", "B20", "B21", "B22", "B23", "B24"],
      ValuesRow: ["A3", "B3", "A4", "B4", "B5", "A6", "B6", "B7"],
      DataOnly: ["A3"],
      Default: ["A3", "B3", "A4", "B4", "C4", "D4", "A5", "A6", "A7"],
    };
    const name = (r: number, c: number) => `${String.fromCharCode(65 + c)}${r + 1}`;
    for (const [sheet, cells] of Object.entries(editable)) {
      const p = pivotOf(b, sheet);
      const rep = report(b, p.config);
      const { r0, c0 } = p.expected;
      // Which cells of the report can be retyped.
      const found: string[] = [];
      rep.cells.forEach((row, r) => row.forEach((cell, c) => cell?.edit && found.push(name(r + r0, c + c0))));
      expect(found.sort(), sheet).toEqual([...cells].sort());
      // Retyping one renames what it shows.
      for (const ref of cells) {
        const r = Number(ref.slice(1)) - 1 - r0;
        const c = ref.charCodeAt(0) - 65 - c0;
        const edit = rep.cells[r][c]!.edit!;
        const next = report(b, { ...applyPivotEdit(p.config, edit, `testName_${ref}`), source: p.config.source } as PivotConfig & { source: string });
        expect(next.cells[r][c]?.v, `${sheet}!${ref}`).toBe(`testName_${ref}`);
      }
    }
  });
});
