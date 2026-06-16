import { describe, it, expect } from "vitest";
import { colName, buildChartInput, type ChartConfig } from "./chartData";

// A minimal fake of the FortuneSheet workbook ref. buildChartInput only reads
// getSheet()/getAllSheets()[].celldata. Cells may be raw values or FortuneSheet
// cell objects ({ v, m }); empty-string cells are omitted entirely.
function wbFrom(rows: (string | number | { v?: unknown; m?: unknown })[][]) {
  const celldata: { r: number; c: number; v: unknown }[] = [];
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

const baseCfg = (over: Partial<ChartConfig> = {}): ChartConfig => ({
  id: "c1",
  type: "column",
  title: "Chart",
  range: { r0: 0, r1: 3, c0: 0, c1: 2 },
  headerRow: true,
  labelCol: true,
  ...over,
});

describe("colName", () => {
  it.each([
    [0, "A"],
    [1, "B"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("colName(%i) → %s", (idx, expected) => {
    expect(colName(idx)).toBe(expected);
  });
});

describe("buildChartInput", () => {
  // Region table: header row + label col + two numeric series.
  const TABLE: (string | number)[][] = [
    ["Region", "Sales", "Cost"],
    ["East", 100, 40],
    ["West", 30, 20],
    ["North", 50, 25],
  ];

  it("uses header row for series names and label col for categories", () => {
    const res = buildChartInput(wbFrom(TABLE), baseCfg());
    expect(res.categories).toEqual(["East", "West", "North"]);
    expect(res.series).toEqual([
      { name: "Sales", values: [100, 30, 50] },
      { name: "Cost", values: [40, 20, 25] },
    ]);
  });

  it("without headerRow, series get default 1-based names and row 0 is data", () => {
    const res = buildChartInput(wbFrom(TABLE), baseCfg({ headerRow: false }));
    expect(res.series.map((s) => s.name)).toEqual(["Series 1", "Series 2"]);
    // Row 0 ("Sales"/"Cost" text) is now data → non-numeric → NaN.
    expect(res.series[0].values).toEqual([NaN, 100, 30, 50]);
    expect(res.series[1].values).toEqual([NaN, 40, 20, 25]);
  });

  it("without labelCol, categories are 1-based row numbers and col 0 becomes a series", () => {
    const res = buildChartInput(wbFrom(TABLE), baseCfg({ labelCol: false }));
    expect(res.categories).toEqual(["1", "2", "3"]);
    // Three columns are all series now; first column holds non-numeric region text.
    expect(res.series.map((s) => s.name)).toEqual(["Region", "Sales", "Cost"]);
    expect(res.series[0].values).toEqual([NaN, NaN, NaN]);
    expect(res.series[1].values).toEqual([100, 30, 50]);
  });

  it("falls back to 'Series k' / 'Row n' when header/label cells are blank", () => {
    const sparse: (string | number)[][] = [
      ["", "", ""], // blank header row
      ["", 10, 11],
      ["", 20, 21],
    ];
    const res = buildChartInput(
      wbFrom(sparse),
      baseCfg({ range: { r0: 0, r1: 2, c0: 0, c1: 2 } }),
    );
    expect(res.categories).toEqual(["Row 1", "Row 2"]);
    expect(res.series.map((s) => s.name)).toEqual(["Series 1", "Series 2"]);
    expect(res.series[0].values).toEqual([10, 20]);
  });

  it("non-numeric data cells become NaN; numeric strings with $,% are parsed", () => {
    const messy: (string | number)[][] = [
      ["L", "S"],
      ["a", "$1,200"],
      ["b", "50%"],
      ["c", "n/a"],
    ];
    const res = buildChartInput(
      wbFrom(messy),
      baseCfg({ range: { r0: 0, r1: 3, c0: 0, c1: 1 } }),
    );
    expect(res.categories).toEqual(["a", "b", "c"]);
    expect(res.series[0].values).toEqual([1200, 50, NaN]);
  });

  it("reads cell objects, using .v for values and .m/.v for label text", () => {
    const rows: { v?: unknown; m?: unknown }[][] = [
      [{ m: "Hdr" }, { m: "Series A", v: "Series A" }],
      [{ m: "rowlabel", v: "ignored" }, { v: 7, m: "7.00" }],
      [{ m: "row2" }, { v: 8 }],
    ];
    const res = buildChartInput(
      wbFrom(rows),
      baseCfg({ range: { r0: 0, r1: 2, c0: 0, c1: 1 } }),
    );
    // cellText prefers .m over .v for labels/headers.
    expect(res.categories).toEqual(["rowlabel", "row2"]);
    expect(res.series[0].name).toBe("Series A");
    expect(res.series[0].values).toEqual([7, 8]);
  });
});
