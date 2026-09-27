// @vitest-environment node
import { describe, expect, it } from "vitest";
import { autofillRange, fillEdge, fillSeries, trimFloatNoise, type CellWrite, type FillCell } from "./autofill";

function grid(rows: FillCell[][]) {
  const get = (r: number, c: number) => rows[r]?.[c] ?? null;
  return get;
}
const num = (v: number, fa = "General", extra: Record<string, any> = {}): FillCell => ({ v, m: String(v), ct: { fa, t: "n" }, ...extra });
const txt = (s: string): FillCell => ({ v: s, m: s, ct: { fa: "General", t: "g" } });
const vals = (ws: CellWrite[]) => ws.map((w) => w.cell?.v ?? null);

describe("autofillRange", () => {
  it("keeps the source cell's style and format and sets the display text", () => {
    const get = grid([[num(1, "0.00", { bl: 1, fc: "#ff0000" }), num(2, "0.00", { bl: 1, fc: "#ff0000" })]]);
    const [w] = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 1 }, { r1: 0, r2: 0, c1: 0, c2: 2 }, "right");
    expect(w).toMatchObject({ r: 0, c: 2, cell: { v: 3, m: "3.00", bl: 1, fc: "#ff0000", ct: { fa: "0.00" } } });
  });

  it("formats dates with the source format", () => {
    const get = grid([[{ v: 36526, m: "1/1/2000", ct: { fa: "m/d/yyyy", t: "d" } }]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 0 }, { r1: 0, r2: 2, c1: 0, c2: 0 }, "down");
    expect(ws.map((w) => w.cell?.m)).toEqual(["1/2/2000", "1/3/2000"]);
  });

  it("translates formulas by their offset from the source cell", () => {
    const get = grid([[{ f: "=A1*2", v: 2, m: "2" }]]);
    const calls: [string, number, number][] = [];
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 0 }, { r1: 0, r2: 2, c1: 0, c2: 0 }, "down", {
      translate: (f, dr, dc) => (calls.push([f, dr, dc]), `${f}+${dr}`),
    });
    expect(ws.map((w) => w.cell?.f)).toEqual(["=A1*2+1", "=A1*2+2"]);
    expect(calls).toEqual([["=A1*2", 1, 0], ["=A1*2", 2, 0]]);
  });

  it("translates formulas backwards when dragging up", () => {
    const get = grid([[null], [null], [{ f: "=B3", v: 0 }]]);
    const ws = autofillRange(get, { r1: 2, r2: 2, c1: 0, c2: 0 }, { r1: 0, r2: 2, c1: 0, c2: 0 }, "up", {
      translate: (f, dr) => `${f}@${dr}`,
    });
    expect(ws.map((w) => [w.r, w.cell?.f])).toEqual([[1, "=B3@-1"], [0, "=B3@-2"]]);
  });

  it("copies a single number, counts with series", () => {
    const get = grid([[num(5)]]);
    const src = { r1: 0, r2: 0, c1: 0, c2: 0 };
    const dest = { r1: 0, r2: 0, c1: 0, c2: 2 };
    expect(vals(autofillRange(get, src, dest, "right"))).toEqual([5, 5]);
    expect(vals(autofillRange(get, src, dest, "right", { series: true }))).toEqual([6, 7]);
  });

  it("extends irregular numbers along their best-fit line", () => {
    const get = grid([[num(1), num(2), num(4)]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 2 }, { r1: 0, r2: 0, c1: 0, c2: 4 }, "right");
    expect(vals(ws)).toEqual([expect.closeTo(16 / 3, 12), expect.closeTo(41 / 6, 12)]);
  });

  it("keeps decimal steps clean", () => {
    const get = grid([[num(0.1), num(0.2)]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 1 }, { r1: 0, r2: 0, c1: 0, c2: 4 }, "right");
    expect(vals(ws)).toEqual([0.3, 0.4, 0.5]);
  });

  it("repeats mixed patterns, counting each numeric part per period", () => {
    const get = grid([[num(1), txt("a"), txt("Item 9"), null]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 3 }, { r1: 0, r2: 0, c1: 0, c2: 11 }, "right");
    expect(vals(ws)).toEqual([2, "a", "Item 10", null, 3, "a", "Item 11", null]);
  });

  it("steps one time value by an hour", () => {
    const get = grid([[num(0.5, "h:mm")]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 0 }, { r1: 0, r2: 0, c1: 0, c2: 2 }, "right");
    expect(ws.map((w) => w.cell?.m)).toEqual(["13:00", "14:00"]);
  });

  it("steps dates a month apart by months, clamping to the month's end", () => {
    const d = (v: number) => ({ v, ct: { fa: "yyyy-mm-dd", t: "d" } });
    // 2000-01-31, 2000-03-31
    const get = grid([[d(36556), d(36616)]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 1 }, { r1: 0, r2: 0, c1: 0, c2: 3 }, "right");
    expect(ws.map((w) => w.cell?.m)).toEqual(["2000-05-31", "2000-07-31"]);
    const one = autofillRange(grid([[d(36556)]]), { r1: 0, r2: 0, c1: 0, c2: 0 }, { r1: 0, r2: 0, c1: 0, c2: 2 }, "right", { mode: "months" });
    expect(one.map((w) => w.cell?.m)).toEqual(["2000-02-29", "2000-03-31"]);
  });

  it("copies cells in copy mode", () => {
    const get = grid([[num(1), num(2)]]);
    const ws = autofillRange(get, { r1: 0, r2: 0, c1: 0, c2: 1 }, { r1: 0, r2: 0, c1: 0, c2: 4 }, "right", { mode: "copy" });
    expect(vals(ws)).toEqual([1, 2, 1]);
  });

  it("fills every column of a block", () => {
    const get = grid([[num(1), txt("x")], [num(2), txt("y")]]);
    const ws = autofillRange(get, { r1: 0, r2: 1, c1: 0, c2: 1 }, { r1: 0, r2: 3, c1: 0, c2: 1 }, "down");
    expect(ws.map((w) => [w.r, w.c, w.cell?.v])).toEqual([
      [2, 0, 3],
      [3, 0, 4],
      [2, 1, "x"],
      [3, 1, "y"],
    ]);
  });
});

describe("fillSeries", () => {
  it("formats the new cells like the first one", () => {
    const get = grid([[num(1, "0.0")]]);
    const ws = fillSeries(get, { r1: 0, r2: 0, c1: 0, c2: 2 }, { seriesIn: "rows", type: "linear", dateUnit: "day", step: 0.5, stop: null, trend: false });
    expect(ws.map((w) => w.cell?.m)).toEqual(["1.5", "2.0"]);
  });
});

describe("fillEdge", () => {
  it("copies the row above into a one-row selection (Ctrl+D)", () => {
    const get = grid([[num(7), { f: "=A1", v: 7 }], [null, null]]);
    const ws = fillEdge(get, { r1: 1, r2: 1, c1: 0, c2: 1 }, "down", { translate: (f, dr) => `${f}+${dr}` });
    expect(ws.map((w) => [w.r, w.c, w.cell?.v, w.cell?.f])).toEqual([
      [1, 0, 7, undefined],
      [1, 1, 7, "=A1+1"],
    ]);
  });

  it("does nothing above the first row", () => {
    expect(fillEdge(grid([[num(1)]]), { r1: 0, r2: 0, c1: 0, c2: 0 }, "down")).toEqual([]);
  });

  it("fills left from the rightmost column", () => {
    const get = grid([[null, null, txt("z")]]);
    const ws = fillEdge(get, { r1: 0, r2: 0, c1: 0, c2: 2 }, "left");
    expect(ws.map((w) => [w.c, w.cell?.v])).toEqual([[0, "z"], [1, "z"]]);
  });
});

describe("trimFloatNoise", () => {
  it("drops binary noise only", () => {
    expect(trimFloatNoise(0.1 + 0.2)).toBe(0.3);
    expect(trimFloatNoise(-1.2000000000000002)).toBe(-1.2);
    expect(trimFloatNoise(0.7999999999999999)).toBe(0.8);
    expect(trimFloatNoise(32.14285714285714)).toBe(32.14285714285714);
    expect(trimFloatNoise(0.000001)).toBe(0.000001);
  });
});
