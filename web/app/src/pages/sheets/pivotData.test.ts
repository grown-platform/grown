import { describe, it, expect } from "vitest";
import { buildPivot, readHeaders, type PivotConfig } from "./pivotData";

// A minimal fake of the FortuneSheet workbook ref: buildPivot only reads
// getSheet()/getAllSheets()[].celldata.
function wbFrom(rows: (string | number)[][]) {
  const celldata: { r: number; c: number; v: string | number }[] = [];
  rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v !== "") celldata.push({ r, c, v });
    }),
  );
  return {
    getSheet: () => ({ id: "s1" }),
    getAllSheets: () => [{ id: "s1", celldata }],
  };
}

const TABLE: (string | number)[][] = [
  ["Region", "Product", "Amount"],
  ["East", "A", 100],
  ["East", "B", 50],
  ["West", "A", 30],
];

const baseCfg = (over: Partial<PivotConfig> = {}): PivotConfig => ({
  id: "p1",
  title: "Pivot",
  range: { r0: 0, r1: 3, c0: 0, c1: 2 },
  rowField: 0,
  colField: 1,
  valueField: 2,
  agg: "sum",
  ...over,
});

describe("pivotData", () => {
  it("readHeaders returns the first row of the range", () => {
    const wb = wbFrom(TABLE);
    expect(readHeaders(wb, { r0: 0, r1: 3, c0: 0, c1: 2 })).toEqual([
      "Region",
      "Product",
      "Amount",
    ]);
  });

  it("sum with row+column fields cross-tabulates correctly", () => {
    const res = buildPivot(wbFrom(TABLE), baseCfg());
    expect(res.rowFieldName).toBe("Region");
    expect(res.colFieldName).toBe("Product");
    expect(res.valueLabel).toBe("Sum of Amount");
    expect(res.colKeys).toEqual(["A", "B"]);

    const east = res.rows.find((r) => r.key === "East")!;
    const west = res.rows.find((r) => r.key === "West")!;
    expect(east.values).toEqual([100, 50]); // A, B
    expect(east.total).toBe(150);
    expect(west.values).toEqual([30, 0]); // no B → 0
    expect(west.total).toBe(30);

    expect(res.colTotals).toEqual([130, 50]); // A=100+30, B=50
    expect(res.grandTotal).toBe(180);
  });

  it("count aggregates record counts, not values", () => {
    const res = buildPivot(wbFrom(TABLE), baseCfg({ agg: "count" }));
    expect(res.valueLabel).toBe("Count of Amount");
    const east = res.rows.find((r) => r.key === "East")!;
    expect(east.values).toEqual([1, 1]);
    expect(east.total).toBe(2);
    expect(res.grandTotal).toBe(3); // three data records
  });

  it("average and min/max aggregate per bucket", () => {
    const avg = buildPivot(wbFrom(TABLE), baseCfg({ agg: "average", colField: null }));
    expect(avg.rows.find((r) => r.key === "East")!.total).toBe(75); // (100+50)/2
    expect(avg.rows.find((r) => r.key === "West")!.total).toBe(30);

    const max = buildPivot(wbFrom(TABLE), baseCfg({ agg: "max", colField: null }));
    expect(max.rows.find((r) => r.key === "East")!.total).toBe(100);
    const min = buildPivot(wbFrom(TABLE), baseCfg({ agg: "min", colField: null }));
    expect(min.rows.find((r) => r.key === "East")!.total).toBe(50);
  });

  it("with no column field, rows carry just a total and colKeys is empty", () => {
    const res = buildPivot(wbFrom(TABLE), baseCfg({ colField: null }));
    expect(res.colKeys).toEqual([]);
    expect(res.colFieldName).toBeNull();
    expect(res.rows.find((r) => r.key === "East")!.total).toBe(150);
    expect(res.rows.find((r) => r.key === "West")!.total).toBe(30);
    expect(res.grandTotal).toBe(180);
  });
});
