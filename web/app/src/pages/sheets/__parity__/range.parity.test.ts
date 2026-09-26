import { describe, it, expect } from "vitest";
import {
  rect,
  normalizeRect,
  rectContains,
  rectIntersection,
  rectUnion,
  roundCoord,
  type CellRect,
} from "../cellRange";

// Parity ports of the OnlyOffice range/rounding utility suite
// (sdkjs tests/cell/spreadsheet-calculation/tests.js). See README.md here.

const box = (c1: number, r1: number, c2: number, r2: number): CellRect => ({ c1, r1, c2, r2 });

describe("sheets parity: range utilities", () => {
  it("oo:cell/spreadsheet-calculation/tests.js#Asc.round", () => {
    const plain = [0, 45, 45.4, 45.5, 45.6, 46, -45, -45.4, -45.5, -45.6, -46, 0.49, -0.5];
    for (const x of plain) expect(roundCoord(x)).toBe(Math.round(x));
    expect(roundCoord(-0) === 0).toBe(true);
    // Floating-point noise must not flip the result.
    expect(roundCoord(0.6 + 0.7 + 0.7)).toBe(2);
    expect(roundCoord(-0.6 - 0.7 - 0.7)).toBe(-2);
    expect(roundCoord(0.1 + 0.2 - 0.3) === 0).toBe(true);
    expect(roundCoord(-0.1 - 0.2 + 0.3) === 0).toBe(true);
    expect(roundCoord(0.1 + 0.2 + 0.9 - 0.2)).toBe(1);
    expect(roundCoord(-0.1 - 0.2 - 0.9 + 0.2)).toBe(-1);
  });

  it("oo:cell/spreadsheet-calculation/tests.js#Asc.Range", () => {
    expect(rect(1, 2, 3, 4)).toEqual(box(1, 2, 3, 4));
    // Unnormalised corners are kept as given unless asked to normalise.
    expect(rect(8, 3, 2, 5)).toEqual(box(8, 3, 2, 5));
    expect(rect(5, 4, 3, 2, true)).toEqual(box(3, 2, 5, 4));
    expect(normalizeRect(rect(8, 3, 2, 5))).toEqual(box(2, 3, 8, 5));

    const r = rect(1, 2, 3, 4);
    const inside: [number, number][] = [
      [1, 2], [2, 2], [3, 2], [3, 3], [3, 4], [2, 4], [1, 4], [1, 3], [2, 3],
    ];
    const outside: [number, number][] = [
      [2, 1], [4, 3], [2, 5], [0, 3], [4, 1], [4, 5], [0, 5], [0, 1],
    ];
    for (const [c, rr] of inside) expect(rectContains(r, c, rr)).toBe(true);
    for (const [c, rr] of outside) expect(rectContains(r, c, rr)).toBe(false);
  });

  it("oo:cell/spreadsheet-calculation/tests.js#Asc.Range.intersection", () => {
    const base = rect(2, 4, 10, 12);
    // Disjoint neighbours on every side.
    for (const other of [
      box(1, 1, 2, 2), box(4, 1, 5, 2), box(13, 1, 14, 2), box(13, 7, 14, 8),
      box(13, 15, 14, 16), box(8, 15, 9, 16), box(0, 13, 1, 14), box(0, 5, 1, 6),
    ]) {
      expect(rectIntersection(base, other)).toBeNull();
    }
    const cases: [CellRect, CellRect][] = [
      [box(1, 3, 3, 5), box(2, 4, 3, 5)],     // top-left corner
      [box(1, 6, 3, 7), box(2, 6, 3, 7)],     // left edge
      [box(1, 11, 3, 13), box(2, 11, 3, 12)], // bottom-left corner
      [box(4, 3, 5, 5), box(4, 4, 5, 5)],     // top edge
      [box(4, 6, 5, 7), box(4, 6, 5, 7)],     // fully inside
      [box(4, 11, 5, 13), box(4, 11, 5, 12)], // bottom edge
      [box(9, 3, 11, 5), box(9, 4, 10, 5)],   // top-right corner
      [box(9, 6, 11, 7), box(9, 6, 10, 7)],   // right edge
      [box(9, 11, 11, 13), box(9, 11, 10, 12)], // bottom-right corner
      [box(1, 3, 3, 13), box(2, 4, 3, 12)],   // vertical band across the left
      [box(6, 3, 7, 13), box(6, 4, 7, 12)],   // vertical band through the middle
      [box(8, 2, 12, 14), box(8, 4, 10, 12)], // covers the right part
      [box(1, 3, 11, 5), box(2, 4, 10, 5)],   // horizontal band across the top
      [box(1, 8, 11, 9), box(2, 8, 10, 9)],   // horizontal band through the middle
      [box(1, 11, 11, 13), box(2, 11, 10, 12)], // horizontal band across the bottom
    ];
    for (const [other, want] of cases) {
      expect(rectIntersection(base, other)).toEqual(want);
      expect(rectIntersection(other, base)).toEqual(want);
    }
  });

  it("oo:cell/spreadsheet-calculation/tests.js#Asc.Range.union", () => {
    const base = rect(2, 4, 10, 12);
    expect(rectUnion(base, box(2, 4, 3, 5))).toEqual(box(2, 4, 10, 12)); // contained
    expect(rectUnion(base, box(9, 3, 13, 5))).toEqual(box(2, 3, 13, 12)); // grows up and right
    expect(rectUnion(box(5, 5, 1, 1), box(7, 0, 7, 0))).toEqual(box(1, 0, 7, 5)); // unnormalised input
  });
});
