import { describe, it, expect } from "vitest";
import {
  applyIconSets,
  clearIconSets,
  type IconSetRule,
} from "./iconSets";

// Fake FortuneSheet ref: getSheet().data is the 2D grid; setCellValuesByRange
// writes back into the grid (so idempotency across calls is observable).
function makeWb(grid: any[][]) {
  const calls: { r: number; c: number; m?: string }[] = [];
  return {
    getSheet: () => ({ data: grid }),
    setCellValuesByRange: (data: any[][], rng: any) => {
      const r = rng.row[0];
      const c = rng.column[0];
      grid[r][c] = data[0][0];
      calls.push({ r, c, m: data[0][0]?.m });
    },
    _calls: calls,
  };
}

const colRule = (style: IconSetRule["style"], rows: number): IconSetRule => ({
  id: "r1",
  range: { r0: 0, r1: rows - 1, c0: 0, c1: 0 },
  style,
});

describe("iconSets", () => {
  it("buckets values into thirds and overlays icons on the display", () => {
    const grid: any[][] = [[{ v: 10 }], [{ v: 20 }], [{ v: 30 }], [{ v: 40 }], [{ v: 50 }], [{ v: 60 }]];
    const wb = makeWb(grid);
    applyIconSets(wb, [colRule("traffic", 6)]);
    // min=10, max=60 → t1≈26.7, t2≈43.3.
    expect(grid[0][0].m).toBe("🔴 10"); // 10 < t1
    expect(grid[1][0].m).toBe("🔴 20"); // 20 < t1
    expect(grid[2][0].m).toBe("🟡 30"); // t1 ≤ 30 < t2
    expect(grid[3][0].m).toBe("🟡 40");
    expect(grid[4][0].m).toBe("🟢 50"); // ≥ t2
    expect(grid[5][0].m).toBe("🟢 60");
    // value (v) is untouched, so formulas still see numbers.
    expect(grid[0][0].v).toBe(10);
  });

  it("is idempotent — re-applying writes nothing", () => {
    const grid = [[{ v: 1 }], [{ v: 5 }], [{ v: 9 }]];
    const wb = makeWb(grid);
    applyIconSets(wb, [colRule("arrows", 3)]);
    const after = wb._calls.length;
    expect(after).toBe(3);
    applyIconSets(wb, [colRule("arrows", 3)]);
    expect(wb._calls.length).toBe(after); // no new writes
  });

  it("re-buckets (and doesn't stack icons) when a value changes", () => {
    const grid = [[{ v: 1, m: "🔻 1" }], [{ v: 5, m: "🔸 5" }], [{ v: 9, m: "🔺 9" }]];
    // Bump the first value to the top of the range.
    grid[0][0] = { v: 100, m: "🔻 100" };
    const wb = makeWb(grid);
    applyIconSets(wb, [colRule("arrows", 3)]);
    expect(grid[0][0].m).toBe("🔺 100"); // now the highest → up-arrow, not stacked
    expect(grid[0][0].v).toBe(100);
  });

  it("clearIconSets strips the icon overlay", () => {
    const grid = [[{ v: 10, m: "🟢 10" }], [{ v: 20, m: "🔴 20" }]];
    const wb = makeWb(grid);
    clearIconSets(wb, [colRule("traffic", 2)]);
    expect(grid[0][0].m).toBeUndefined();
    expect(grid[1][0].m).toBeUndefined();
    expect(grid[0][0].v).toBe(10);
  });

  it("ignores non-numeric cells", () => {
    const grid: any[][] = [[{ v: "hi" }], [{ v: 5 }], [{ v: 9 }]];
    const wb = makeWb(grid);
    applyIconSets(wb, [colRule("signs", 3)]);
    expect(grid[0][0].m).toBeUndefined(); // text untouched
    expect(grid[2][0].m).toBe("✅ 9");
  });
});
