/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet sheets are loosely typed. */

// Charts anchored on the grid (M10). A chart keeps the cell its top-left
// corner sits in plus a pixel offset, and its size; the pixel position is
// worked out from the sheet's row heights and column widths the way
// FortuneSheet lays out its grid (each row/column takes its size + 1 px of
// gridline, scaled by the zoom and rounded, hidden ones take none). Because
// the anchor is a cell, a chart moves with row/column inserts and deletes
// (formulaShift.shiftCharts).

import type { ChartAnchor } from "./chartData";

export interface GridGeometry {
  /** Left edge of column c (cell-area pixels, zoomed). */
  colLeft: (c: number) => number;
  /** Top edge of row r. */
  rowTop: (r: number) => number;
  /** Column / row containing a pixel offset. */
  colAt: (x: number) => number;
  rowAt: (y: number) => number;
  zoom: number;
}

function axisGeometry(sizes: Record<string, number> | undefined, hidden: Record<string, unknown> | undefined, dflt: number, zoom: number) {
  const cache: number[] = [0];
  const step = (i: number) => {
    if (hidden && hidden[String(i)] != null) return 0;
    const v = sizes?.[String(i)];
    const len = typeof v === "number" && v > 0 ? v : dflt;
    return Math.round((len + 1) * zoom);
  };
  const edge = (i: number) => {
    const n = Math.max(0, Math.floor(i));
    while (cache.length <= n) cache.push(cache[cache.length - 1] + step(cache.length - 1));
    return cache[n];
  };
  const at = (px: number) => {
    let i = 0;
    while (edge(i + 1) <= px && i < 1048576) i++;
    return i;
  };
  return { edge, at };
}

export function gridGeometry(sheet: any, zoomIn?: number): GridGeometry {
  const zoom = zoomIn ?? (typeof sheet?.zoomRatio === "number" && sheet.zoomRatio > 0 ? sheet.zoomRatio : 1);
  const cfg = sheet?.config ?? {};
  const cols = axisGeometry(cfg.columnlen, cfg.colhidden, Number(sheet?.defaultColWidth) || 73, zoom);
  const rows = axisGeometry(cfg.rowlen, cfg.rowhidden, Number(sheet?.defaultRowHeight) || 19, zoom);
  return { colLeft: cols.edge, rowTop: rows.edge, colAt: cols.at, rowAt: rows.at, zoom };
}

/** The chart's box in cell-area pixels. */
export function anchorRect(a: ChartAnchor, g: GridGeometry): { left: number; top: number; width: number; height: number } {
  return {
    left: g.colLeft(a.c) + a.dx * g.zoom,
    top: g.rowTop(a.r) + a.dy * g.zoom,
    width: a.w * g.zoom,
    height: a.h * g.zoom,
  };
}

/** The anchor for a box whose top-left corner is at (left, top) cell-area pixels. */
export function anchorAt(left: number, top: number, w: number, h: number, g: GridGeometry): ChartAnchor {
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const c = g.colAt(x);
  const r = g.rowAt(y);
  return {
    r,
    c,
    dx: Math.round((x - g.colLeft(c)) / g.zoom),
    dy: Math.round((y - g.rowTop(r)) / g.zoom),
    w: Math.max(120, Math.round(w)),
    h: Math.max(90, Math.round(h)),
  };
}
