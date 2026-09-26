// Rectangular cell-range arithmetic shared by selection-, merge- and
// rule-range code (conditional formats, validation, protected ranges).
// Coordinates are 0-based column/row indices; c1/r1 is the top-left corner
// once normalised.

export interface CellRect {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

/** Builds a rectangle; with `normalize` the corners are ordered top-left → bottom-right. */
export function rect(c1: number, r1: number, c2: number, r2: number, normalize = false): CellRect {
  const r = { c1, r1, c2, r2 };
  return normalize ? normalizeRect(r) : r;
}

/** Returns a copy whose first corner is the top-left one. */
export function normalizeRect(r: CellRect): CellRect {
  return {
    c1: Math.min(r.c1, r.c2),
    r1: Math.min(r.r1, r.r2),
    c2: Math.max(r.c1, r.c2),
    r2: Math.max(r.r1, r.r2),
  };
}

/** True when cell (c, r) lies inside the (normalised) rectangle, borders included. */
export function rectContains(a: CellRect, c: number, r: number): boolean {
  const n = normalizeRect(a);
  return c >= n.c1 && c <= n.c2 && r >= n.r1 && r <= n.r2;
}

/** Overlap of two rectangles, or null when they share no cell. */
export function rectIntersection(a: CellRect, b: CellRect): CellRect | null {
  const x = normalizeRect(a);
  const y = normalizeRect(b);
  const c1 = Math.max(x.c1, y.c1);
  const r1 = Math.max(x.r1, y.r1);
  const c2 = Math.min(x.c2, y.c2);
  const r2 = Math.min(x.r2, y.r2);
  if (c1 > c2 || r1 > r2) return null;
  return { c1, r1, c2, r2 };
}

/** Smallest rectangle covering both inputs. */
export function rectUnion(a: CellRect, b: CellRect): CellRect {
  const x = normalizeRect(a);
  const y = normalizeRect(b);
  return {
    c1: Math.min(x.c1, y.c1),
    r1: Math.min(x.r1, y.r1),
    c2: Math.max(x.c2, y.c2),
    r2: Math.max(x.r2, y.r2),
  };
}

/**
 * Rounds to the nearest integer (halves go up, like Math.round) after
 * discarding binary floating-point noise, so 0.6+0.7+0.7 (1.9999999999999998)
 * rounds as 2 and 0.1+0.2-0.3 as 0. Used for pixel/coordinate maths.
 */
export function roundCoord(x: number): number {
  const cleaned = Number.isFinite(x) ? Number(x.toPrecision(12)) : x;
  return Math.round(cleaned);
}
