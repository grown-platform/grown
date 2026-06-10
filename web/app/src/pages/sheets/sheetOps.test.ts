import { describe, it, expect } from "vitest";
import {
  cellText,
  compareCells,
  sortGridRows,
  shuffleGridRows,
  buildMatcher,
  replaceInText,
  findMatches,
  splitDelimited,
  detectDelimiter,
  type CellGrid,
} from "./sheetOps";

const cell = (v: unknown) => (v == null ? null : { v, m: String(v) });
const grid = (rows: unknown[][]): CellGrid => rows.map((r) => r.map(cell));

describe("cellText", () => {
  it("prefers display value, falls back to raw, handles null", () => {
    expect(cellText(null)).toBe("");
    expect(cellText({ v: 5, m: "5.00" })).toBe("5.00");
    expect(cellText({ v: 5 })).toBe("5");
    expect(cellText({ v: 0 })).toBe("0");
  });
});

describe("compareCells", () => {
  it("orders numbers numerically before text", () => {
    expect(compareCells(cell(2), cell(10))).toBeLessThan(0);
    expect(compareCells(cell(10), cell("apple"))).toBeLessThan(0);
  });
  it("is case-insensitive for text", () => {
    expect(compareCells(cell("Apple"), cell("apple"))).toBe(0);
  });
  it("sinks blanks to the bottom", () => {
    expect(compareCells(null, cell("z"))).toBeGreaterThan(0);
    expect(compareCells(cell("z"), null)).toBeLessThan(0);
  });
});

describe("sortGridRows", () => {
  it("sorts ascending by a column, blanks last, original untouched", () => {
    const g = grid([
      ["b", 2],
      ["", 9],
      ["a", 1],
      ["c", 3],
    ]);
    const out = sortGridRows(g, 0, true);
    expect(out.map((r) => cellText(r[0]))).toEqual(["a", "b", "c", ""]);
    // original preserved
    expect(cellText(g[0][0])).toBe("b");
  });
  it("sorts descending but keeps blanks last", () => {
    const g = grid([["b"], [""], ["a"], ["c"]]);
    const out = sortGridRows(g, 0, false);
    expect(out.map((r) => cellText(r[0]))).toEqual(["c", "b", "a", ""]);
  });
  it("keeps whole rows together when sorting by one column", () => {
    const g = grid([
      ["b", "two"],
      ["a", "one"],
    ]);
    const out = sortGridRows(g, 0, true);
    expect(cellText(out[0][1])).toBe("one");
    expect(cellText(out[1][1])).toBe("two");
  });
});

describe("shuffleGridRows", () => {
  it("preserves all rows and uses the provided rng deterministically", () => {
    const g = grid([["a"], ["b"], ["c"]]);
    const out = shuffleGridRows(g, () => 0); // always pick index 0
    const labels = out.map((r) => cellText(r[0])).sort();
    expect(labels).toEqual(["a", "b", "c"]);
    expect(out.length).toBe(3);
  });
});

describe("buildMatcher", () => {
  it("substring, case-insensitive by default", () => {
    const m = buildMatcher("foo", {
      matchCase: false,
      matchEntireCell: false,
      useRegex: false,
    });
    expect(m("a FOObar")).toBe(true);
    expect(m("nope")).toBe(false);
  });
  it("match case", () => {
    const m = buildMatcher("Foo", {
      matchCase: true,
      matchEntireCell: false,
      useRegex: false,
    });
    expect(m("Foo")).toBe(true);
    expect(m("foo")).toBe(false);
  });
  it("match entire cell", () => {
    const m = buildMatcher("foo", {
      matchCase: false,
      matchEntireCell: true,
      useRegex: false,
    });
    expect(m("foo")).toBe(true);
    expect(m("foobar")).toBe(false);
  });
  it("regex", () => {
    const m = buildMatcher("^a.*z$", {
      matchCase: false,
      matchEntireCell: false,
      useRegex: true,
    });
    expect(m("abcz")).toBe(true);
    expect(m("abc")).toBe(false);
  });
  it("throws on invalid regex", () => {
    expect(() =>
      buildMatcher("(", {
        matchCase: false,
        matchEntireCell: false,
        useRegex: true,
      }),
    ).toThrow();
  });
});

describe("replaceInText", () => {
  it("literal replace all, case-sensitive", () => {
    expect(
      replaceInText("a-a-a", "a", "b", {
        matchCase: true,
        matchEntireCell: false,
        useRegex: false,
      }),
    ).toBe("b-b-b");
  });
  it("literal replace all, case-insensitive escapes metachars", () => {
    expect(
      replaceInText("1.2.3", ".", "_", {
        matchCase: false,
        matchEntireCell: false,
        useRegex: false,
      }),
    ).toBe("1_2_3");
  });
  it("whole-cell swap only on full match", () => {
    const o = { matchCase: false, matchEntireCell: true, useRegex: false };
    expect(replaceInText("yes", "yes", "no", o)).toBe("no");
    expect(replaceInText("yessir", "yes", "no", o)).toBe("yessir");
  });
  it("regex with backreference groups", () => {
    expect(
      replaceInText("John Smith", "(\\w+) (\\w+)", "$2 $1", {
        matchCase: false,
        matchEntireCell: false,
        useRegex: true,
      }),
    ).toBe("Smith John");
  });
  it("empty query is a no-op", () => {
    expect(
      replaceInText("abc", "", "x", {
        matchCase: false,
        matchEntireCell: false,
        useRegex: false,
      }),
    ).toBe("abc");
  });
});

describe("findMatches", () => {
  it("returns absolute coordinates from the grid origin", () => {
    const g = grid([
      ["foo", "bar"],
      ["baz", "FOO"],
    ]);
    const hits = findMatches(g, { r: 5, c: 3 }, "foo", {
      matchCase: false,
      matchEntireCell: false,
      useRegex: false,
    });
    expect(hits).toEqual([
      { r: 5, c: 3 },
      { r: 6, c: 4 },
    ]);
  });
  it("empty query returns nothing", () => {
    expect(
      findMatches(grid([["a"]]), { r: 0, c: 0 }, "", {
        matchCase: false,
        matchEntireCell: false,
        useRegex: false,
      }),
    ).toEqual([]);
  });
});

describe("splitDelimited / detectDelimiter", () => {
  it("splits on a literal delimiter", () => {
    expect(splitDelimited("a,b,c", ",")).toEqual(["a", "b", "c"]);
    expect(splitDelimited("a", ",")).toEqual(["a"]);
  });
  it("detects the most common delimiter", () => {
    expect(detectDelimiter(["a,b,c", "d,e,f"])).toBe(",");
    expect(detectDelimiter(["a\tb", "c\td"])).toBe("\t");
  });
});
