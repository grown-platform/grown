import { describe, expect, it } from "vitest";
import { cellDisplay, gridFromRows } from "./cellValue";
import {
  compareSortValues,
  detectHeader,
  planApiSort,
  resolveSortKey,
  sortBlock,
  sortGrid,
  type SortCell,
} from "./sortOps";

const g = (rows: unknown[][]) => gridFromRows(rows) as SortCell[][];
const show = (block: SortCell[][]) => block.map((r) => r.map((c) => cellDisplay(c)));
const all = (grid: SortCell[][]) => ({ r1: 0, c1: 0, r2: grid.length - 1, c2: grid[0].length - 1 });

describe("sortBlock", () => {
  it("orders numbers < text < booleans < errors with blanks last, both directions", () => {
    const grid = g([["b"], [true], [3], [null], ["#N/A"], [1], ["A"], [false]]);
    const asc = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true }] })!;
    expect(show(asc.block).flat()).toEqual(["1", "3", "A", "b", "FALSE", "TRUE", "#N/A", ""]);
    const desc = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: false }] })!;
    expect(show(desc.block).flat()).toEqual(["#N/A", "TRUE", "FALSE", "b", "A", "3", "1", ""]);
  });

  it("returns the permutation and keeps a header row in place", () => {
    const grid = g([["Name"], ["c"], ["a"], ["b"]]);
    const res = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true }], header: true })!;
    expect(res.order).toEqual([0, 2, 3, 1]);
    expect(show(res.block).flat()).toEqual(["Name", "a", "b", "c"]);
  });

  it("is case-blind by default and puts lower case first when case-sensitive", () => {
    const grid = g([["B"], ["a"], ["b"], ["A"]]);
    const blind = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true }] })!;
    expect(show(blind.block).flat()).toEqual(["a", "A", "B", "b"]);
    const cs = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true }], caseSensitive: true })!;
    expect(show(cs.block).flat()).toEqual(["a", "A", "b", "B"]);
  });

  it("works on a sub-range using absolute key indexes and leaves the rest alone", () => {
    const grid = g([
      ["x", "x", "x"],
      ["x", 3, "c"],
      ["x", 1, "a"],
      ["x", 2, "b"],
    ]);
    const out = sortGrid(grid, { r1: 1, c1: 1, r2: 3, c2: 2 }, { keys: [{ index: 1, ascending: true }] });
    expect(show(out)).toEqual([
      ["x", "x", "x"],
      ["x", "1", "a"],
      ["x", "2", "b"],
      ["x", "3", "c"],
    ]);
    expect(sortBlock(grid, { r1: 1, c1: 1, r2: 3, c2: 2 }, { keys: [{ index: 0, ascending: true }] })).toBeNull();
  });

  it("sorts columns left-to-right by a row, with a header column", () => {
    const grid = g([
      ["k", 3, 1, 2],
      ["v", "c", "a", "b"],
    ]);
    const res = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true }], orientation: "columns", header: true })!;
    expect(show(res.block)).toEqual([
      ["k", "1", "2", "3"],
      ["v", "a", "b", "c"],
    ]);
  });

  it("puts the chosen fill / font colour on top (or bottom), rest in original order", () => {
    const grid: SortCell[][] = [[{ v: "a" }], [{ v: "b", bg: "#FF0000" }], [{ v: "c" }], [{ v: "d", bg: "#f00" }]];
    const top = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true, by: "fill", color: "#ff0000" }] })!;
    expect(top.order).toEqual([1, 3, 0, 2]);
    const bottom = sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: false, by: "fill", color: "#ff0000" }] })!;
    expect(bottom.order).toEqual([0, 2, 1, 3]);
    const font: SortCell[][] = [[{ v: 1 }], [{ v: 2, fc: "rgb(0,0,255)" }]];
    expect(sortBlock(font, all(font), { keys: [{ index: 0, ascending: true, by: "font", color: "#0000ff" }] })!.order).toEqual([1, 0]);
  });

  it("translates formulas by the distance their row moved", () => {
    const grid: SortCell[][] = [[{ v: 3, f: "=B1*2" }], [{ v: 1, f: "=B2*2" }]];
    const calls: [string, number, number][] = [];
    const res = sortBlock(grid, all(grid), {
      keys: [{ index: 0, ascending: true }],
      translate: (f, dr, dc) => {
        calls.push([f, dr, dc]);
        return f.replace(/\d+/, (n) => String(Number(n) + dr));
      },
    })!;
    expect(res.block.map((r) => r[0]?.f)).toEqual(["=B1*2", "=B2*2"]);
    expect(calls).toEqual([
      ["=B2*2", -1, 0],
      ["=B1*2", 1, 0],
    ]);
  });

  it("returns null for no keys or a single data line", () => {
    const grid = g([["h"], [1]]);
    expect(sortBlock(grid, all(grid), { keys: [] })).toBeNull();
    expect(sortBlock(grid, all(grid), { keys: [{ index: 0, ascending: true }], header: true })).toBeNull();
  });
});

describe("compareSortValues", () => {
  it("ranks errors equal and FALSE before TRUE", () => {
    expect(compareSortValues({ error: "#N/A" }, { error: "#DIV/0!" })).toBe(0);
    expect(compareSortValues(false, true)).toBeLessThan(0);
  });
});

describe("detectHeader", () => {
  it("spots a text row above numbers", () => {
    const grid = g([
      ["Name", "Age"],
      ["Bob", 30],
    ]);
    expect(detectHeader(grid, all(grid))).toBe(true);
  });
  it("rejects a first row that holds numbers or matches the data below", () => {
    expect(detectHeader(g([[1], [2]]), { r1: 0, c1: 0, r2: 1, c2: 0 })).toBe(false);
    expect(detectHeader(g([["a"], ["b"]]), { r1: 0, c1: 0, r2: 1, c2: 0 })).toBe(false);
  });
  it("accepts a bold text row over plain text", () => {
    const grid: SortCell[][] = [[{ v: "Name", bl: 1 }], [{ v: "Bob" }]];
    expect(detectHeader(grid, { r1: 0, c1: 0, r2: 1, c2: 0 })).toBe(true);
  });
});

describe("API key resolution", () => {
  it("maps cells and defined names to a column or row", () => {
    expect(resolveSortKey("C7", "rows")).toBe(2);
    expect(resolveSortKey("C7", "columns")).toBe(6);
    expect(resolveSortKey("data", "rows", { data: "Sheet1!$D$2:$F$9" })).toBe(3);
    expect(resolveSortKey("nope", "rows")).toBeNull();
    expect(resolveSortKey(null, "rows")).toBeNull();
  });
  it("skips null keys and guesses headers on xlGuess", () => {
    const grid = g([
      ["Name", "Age"],
      ["Bob", 30],
      ["Al", 20],
    ]);
    const plan = planApiSort(grid, { range: "A1:B3", key1: null, key2: "B1", order2: "xlDescending", header: "xlGuess" })!;
    expect(plan.opts.keys).toEqual([{ index: 1, ascending: false }]);
    expect(plan.opts.header).toBe(true);
    expect(planApiSort(grid, { range: "A1:B3", key1: "bogus" })).toBeNull();
  });
});
