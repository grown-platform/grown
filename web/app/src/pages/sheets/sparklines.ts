/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */

// Sparkline groups (M10): a data range drawn as one SPARKLINE() per row (or
// column) into a location range, remembered on the sheet as grownSparklines
// so the group can be listed, replaced or removed as a unit.

import type { ChartRange } from "./chartData";
import { colName } from "./chartData";

export type SparklineType = "line" | "column" | "winloss";

export interface SparklineGroup {
  id: string;
  data: ChartRange;
  location: ChartRange;
  type: SparklineType;
  color?: string;
}

export function sheetSparklines(sheet: any): SparklineGroup[] {
  return Array.isArray(sheet?.grownSparklines) ? sheet.grownSparklines : [];
}

const ref = (r: number, c: number) => `${colName(c)}${r + 1}`;

/**
 * The formula for each location cell. A one-column location takes one data
 * row per cell; a one-row location one data column per cell (a single cell
 * takes a single-row or single-column range).
 */
export function sparklineFormulas(g: SparklineGroup): { r: number; c: number; f: string }[] | { error: string } {
  const d = g.data;
  const l = g.location;
  const rows = d.r1 - d.r0 + 1;
  const cols = d.c1 - d.c0 + 1;
  const locRows = l.r1 - l.r0 + 1;
  const locCols = l.c1 - l.c0 + 1;
  const opt = g.type === "line" ? "" : `,{"charttype","${g.type}"}`;
  const f = (r0: number, c0: number, r1: number, c1: number) => `=SPARKLINE(${ref(r0, c0)}:${ref(r1, c1)}${opt})`;
  const inside = !(l.r1 < d.r0 || d.r1 < l.r0 || l.c1 < d.c0 || d.c1 < l.c0);
  if (inside) return { error: "The location can't overlap the data." };
  if (locCols === 1 && locRows === rows) {
    return Array.from({ length: rows }, (_, i) => ({ r: l.r0 + i, c: l.c0, f: f(d.r0 + i, d.c0, d.r0 + i, d.c1) }));
  }
  if (locRows === 1 && locCols === cols) {
    return Array.from({ length: cols }, (_, i) => ({ r: l.r0, c: l.c0 + i, f: f(d.r0, d.c0 + i, d.r1, d.c0 + i) }));
  }
  if (locRows === 1 && locCols === 1 && (rows === 1 || cols === 1)) return [{ r: l.r0, c: l.c0, f: f(d.r0, d.c0, d.r1, d.c1) }];
  return { error: `The location needs one cell per data row (${rows}) or per data column (${cols}).` };
}
