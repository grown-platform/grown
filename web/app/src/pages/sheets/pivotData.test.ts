import { describe, it, expect, beforeEach } from "vitest";
import { buildReport, readHeaders, normalizeConfig, type PivotConfig } from "./pivotData";
import { reportText } from "./pivotEngine";
import { calcFieldRefs, evalCalculated, isValidCalc } from "./pivotCalc";
import { createPivotSync, getPivotDataFormula, pivotAt, showDetails, writePivot } from "./pivotGrid";

/* eslint-disable @typescript-eslint/no-explicit-any -- a minimal FortuneSheet fake. */

// A minimal fake of the FortuneSheet workbook ref: sheets with a live `data`
// grid, and batchCallApis/addSheet/setSheetName/activateSheet that edit it.
function fakeWb(sheets: { id: string; name: string; rows: (string | number)[][] }[]) {
  const all: any[] = sheets.map((s) => ({
    id: s.id,
    name: s.name,
    data: s.rows.map((row) => row.map((v) => (v === "" ? null : { v, m: String(v) }))),
  }));
  let active = all[0].id;
  const byId = (id: string) => all.find((s) => s.id === id);
  const set = (id: string, r: number, c: number, cell: any) => {
    const sh = byId(id);
    while (sh.data.length <= r) sh.data.push([]);
    sh.data[r][c] = cell;
  };
  const wb = {
    getSheet: () => byId(active),
    getAllSheets: () => all,
    getSelection: () => [{ row: [0, 0], column: [0, 0] }],
    batchCallApis: (calls: { name: string; args: any[] }[]) => {
      for (const { name, args } of calls) {
        if (name === "setCellValue") set(args[4]?.id ?? active, args[0], args[1], args[2]);
        else if (name === "clearCell") set(args[2]?.id ?? active, args[0], args[1], null);
      }
    },
    addSheet: (id: string) => all.push({ id, name: `Sheet${all.length + 1}`, data: [] }),
    setSheetName: (name: string, o: { id: string }) => (byId(o.id).name = name),
    activateSheet: (o: { id: string }) => (active = o.id),
    cell: (id: string, r: number, c: number) => byId(id).data[r]?.[c] ?? null,
    all,
  };
  return wb;
}

const TABLE: (string | number)[][] = [
  ["Region", "Product", "Amount"],
  ["East", "A", 100],
  ["East", "B", 50],
  ["West", "A", 30],
];

const cfgOf = (over: Partial<PivotConfig> = {}): PivotConfig => ({
  id: "p1",
  title: "Pivot",
  range: { r0: 0, r1: 3, c0: 0, c1: 2 },
  sourceSheetId: "s1",
  rows: [0],
  cols: [1],
  values: [{ field: 2, agg: "sum" }],
  ...over,
});

describe("pivotData", () => {
  it("readHeaders returns the first row of the range", () => {
    const wb = fakeWb([{ id: "s1", name: "Data", rows: TABLE }]);
    expect(readHeaders(wb, { r0: 0, r1: 3, c0: 0, c1: 2 })).toEqual(["Region", "Product", "Amount"]);
  });

  it("the legacy one-field shape still reads", () => {
    const legacy: PivotConfig = { id: "p", title: "", range: { r0: 0, r1: 3, c0: 0, c1: 2 }, rowField: 0, colField: 1, valueField: 2, agg: "sum" };
    const n = normalizeConfig(legacy);
    expect(n.rows).toEqual([0]);
    expect(n.cols).toEqual([1]);
    expect(n.values).toEqual([{ field: 2, agg: "sum" }]);
  });

  it("buildReport cross-tabulates the live source", () => {
    const wb = fakeWb([{ id: "s1", name: "Data", rows: TABLE }]);
    expect(reportText(buildReport(wb, cfgOf()))).toEqual([
      ["Sum of Amount", "Column Labels", "", ""],
      ["Row Labels", "A", "B", "Grand Total"],
      ["East", "100", "50", "150"],
      ["West", "30", "", "30"],
      ["Grand Total", "130", "50", "180"],
    ]);
  });

  it("show values as % of grand total uses a percent format", () => {
    const wb = fakeWb([{ id: "s1", name: "Data", rows: TABLE }]);
    const rep = buildReport(wb, cfgOf({ values: [{ field: 2, agg: "sum", showAs: "percentOfTotal" }] }));
    expect(reportText(rep)[2]).toEqual(["East", "55.56%", "27.78%", "83.33%"]);
  });

  it("a value field's number format applies to its cells", () => {
    const wb = fakeWb([{ id: "s1", name: "Data", rows: TABLE }]);
    const rep = buildReport(wb, cfgOf({ values: [{ field: 2, agg: "sum", numFmt: '"$"#,##0.00' }] }));
    expect(reportText(rep)[4]).toEqual(["Grand Total", "$130.00", "$50.00", "$180.00"]);
  });

  it("calculated fields evaluate over the fields' sums", () => {
    expect(isValidCalc("=Amount*2")).toBe(true);
    expect(isValidCalc("=Amount*")).toBe(false);
    expect(calcFieldRefs("='Unit price'*Units")).toEqual(["Unit price", "Units"]);
    expect(evalCalculated("=a/b", (n) => (n === "a" ? 1 : 0))).toEqual({ error: "#DIV/0!" });
    const wb = fakeWb([{ id: "s1", name: "Data", rows: TABLE }]);
    const rep = buildReport(wb, cfgOf({ cols: [], calculated: [{ name: "Double", formula: "=Amount*2" }], values: [{ field: 3, agg: "sum" }] }));
    expect(reportText(rep)).toEqual([
      ["Row Labels", "Sum of Double"],
      ["East", "300"],
      ["West", "60"],
      ["Grand Total", "360"],
    ]);
  });

  it("date grouping by month and number grouping by interval", () => {
    const rows: (string | number)[][] = [["Date", "Qty"], [45292, 1], [45300, 2], [45330, 4], [45420, 8]]; // 1 Jan, 9 Jan, 8 Feb, 8 May 2024
    const wb = fakeWb([{ id: "s1", name: "Data", rows }]);
    const base = { range: { r0: 0, r1: 4, c0: 0, c1: 1 }, cols: [], values: [{ field: 1, agg: "sum" as const }] };
    const months = buildReport(wb, cfgOf({ ...base, groups: [{ source: 0, name: "Months", type: "date", by: "months" }], rows: [2] }));
    expect(reportText(months).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Qty", "Jan|3", "Feb|4", "May|8", "Grand Total|15"]);
    const ranges = buildReport(wb, cfgOf({ ...base, groups: [{ source: 1, name: "Qty ranges", type: "number", start: 0, end: 9, interval: 5 }], rows: [2] }));
    expect(reportText(ranges).map((r) => r.join("|"))).toEqual(["Row Labels|Sum of Qty", "0-4|7", "5-9|8", "Grand Total|15"]);
  });
});

describe("pivotGrid", () => {
  let wb: ReturnType<typeof fakeWb>;
  beforeEach(() => {
    wb = fakeWb([
      { id: "s1", name: "Data", rows: TABLE },
      { id: "s2", name: "Report", rows: [] },
    ]);
  });

  it("writes the report at its anchor and keeps GETPIVOTDATA facts", () => {
    const cfg = cfgOf({ anchor: { sheetId: "s2", r: 1, c: 1 } });
    const res = writePivot(wb, cfg);
    expect(res.blocked).toBeUndefined();
    expect(wb.cell("s2", 1, 1)?.v).toBe("Sum of Amount");
    expect(wb.cell("s2", 3, 1)?.v).toBe("East");
    expect(wb.cell("s2", 3, 2)?.v).toBe(100);
    expect(wb.cell("s2", 5, 4)?.v).toBe(180);
    const out = res.cfg.output!;
    expect(out).toMatchObject({ sheetId: "s2", r0: 1, c0: 1, rows: 5, cols: 4 });
    expect(out.dataFields).toEqual([{ name: "Sum of Amount", field: "Amount" }]);
    expect(getPivotDataFormula(out, 3, 3)).toBe('GETPIVOTDATA("Amount",$B$2,"Region","East","Product","B")');
    expect(getPivotDataFormula(out, 5, 4)).toBe('GETPIVOTDATA("Amount",$B$2)');
    expect(pivotAt([res.cfg], "s2", 5, 4)?.id).toBe("p1");
    expect(pivotAt([res.cfg], "s2", 6, 4)).toBeNull();
  });

  it("refreshes after a source edit and restores tampered cells, then settles", () => {
    let pivots = [writePivot(wb, cfgOf({ anchor: { sheetId: "s2", r: 0, c: 0 } })).cfg];
    const sync = createPivotSync({ getWb: () => wb, getPivots: () => pivots, setPivots: (n) => (pivots = n) });
    wb.all[0].data[1][2] = { v: 1000, m: "1000" }; // East/A 100 → 1000
    wb.all[1].data[2][1] = { v: "typed", m: "typed" }; // someone overwrote East/A
    sync.runNow();
    expect(wb.cell("s2", 2, 1)?.v).toBe(1000);
    expect(wb.cell("s2", 4, 3)?.v).toBe(1080);
    const before = JSON.stringify(wb.all);
    sync.runNow();
    expect(JSON.stringify(wb.all)).toBe(before);
  });

  it("refuses to overwrite other data, and the guard refuses typing", () => {
    wb.all[1].data = [[null, null], [null, { v: "keep", m: "keep" }]];
    const res = writePivot(wb, cfgOf({ anchor: { sheetId: "s2", r: 0, c: 0 } }));
    expect(res.blocked).toBe("occupied");
    expect(wb.cell("s2", 1, 1)?.v).toBe("keep");
    const ok = writePivot(wb, cfgOf({ anchor: { sheetId: "s1", r: 0, c: 5 } }));
    let pivots = [ok.cfg];
    const sync = createPivotSync({ getWb: () => wb, getPivots: () => pivots, setPivots: (n) => (pivots = n) });
    expect(sync.guard(2, 6)).toBe(false);
    expect(sync.guard(2, 2)).toBe(true);
  });

  it("typing over a caption or item label renames it", () => {
    const ok = writePivot(wb, cfgOf({ anchor: { sheetId: "s1", r: 0, c: 5 } }));
    let pivots = [ok.cfg];
    const sync = createPivotSync({ getWb: () => wb, getPivots: () => pivots, setPivots: (n) => (pivots = n) });
    expect(sync.guard(2, 5, "Oriente")).toBe(false); // the "East" label
    expect(pivots[0].fields?.[0]?.itemNames).toEqual({ seast: "Oriente" });
    expect(sync.guard(1, 5, "Regions")).toBe(false); // "Row Labels"
    expect(pivots[0].rowHeaderCaption).toBe("Regions");
    sync.runNow();
    expect(wb.cell("s1", 2, 5)?.v).toBe("Oriente");
    expect(wb.cell("s1", 1, 5)?.v).toBe("Regions");
    expect(sync.guard(2, 6, "5")).toBe(false); // a value stays
    expect(wb.cell("s1", 2, 6)?.v).toBe(100);
  });

  it("show details puts the records behind a value on a new sheet", () => {
    const cfg = cfgOf();
    const id = showDetails(wb, cfg, 2, 3); // East / Grand Total
    expect(id).toBeTruthy();
    const sheet = wb.all.find((s) => s.id === id);
    expect(sheet.name).toBe("Details1");
    expect(sheet.data.map((r: any[]) => r.map((c) => c?.v))).toEqual([
      ["Region", "Product", "Amount"],
      ["East", "A", 100],
      ["East", "B", 50],
    ]);
  });
});
