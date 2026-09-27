import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { TraceArrow, TraceCellRef, TraceResult } from "./api";
import { gridGeometry, type GridGeometry } from "./chartAnchor";

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

// Trace precedents / dependents arrows (Formulas ▸ Trace …), drawn like the
// desktop spreadsheets: a blue arrow from the cell that is read to the cell
// that reads it, a dot at the source, a box around a source range, and a
// dashed arrow to a small sheet icon when the other end is on another sheet.
// The SVG sits in FortuneSheet's cell area, like the charts on the grid.

export interface TraceState {
  /** The traced cell, and how many levels deep each direction goes (0 = off). */
  sheetId: string;
  r: number;
  c: number;
  precedents: number;
  dependents: number;
  result: TraceResult | null;
}

const BLUE = "#1a5fd0";

interface Seg {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
  box?: { x: number; y: number; w: number; h: number };
  sheetIcon?: { x: number; y: number; label: string };
  title: string;
  kind: "precedent" | "dependent";
}

function center(g: GridGeometry, r: number, c: number) {
  return { x: (g.colLeft(c) + g.colLeft(c + 1)) / 2, y: (g.rowTop(r) + g.rowTop(r + 1)) / 2 };
}

/** Line segments for the arrows of the active sheet (exported for tests). */
export function traceSegments(result: TraceResult | null, sheetId: string, g: GridGeometry): Seg[] {
  if (!result) return [];
  const out: Seg[] = [];
  const onSheet = (ref: TraceCellRef) => ref.sheetId === sheetId;
  const add = (a: TraceArrow, i: number, kind: Seg["kind"]) => {
    // Normalise: src is read by dst.
    const src = kind === "precedent" ? a.to : a.from;
    const dst = kind === "precedent" ? a.from : a.to;
    const key = `${kind}-${i}`;
    const title = `${src.sheet}!${src.ref} → ${dst.sheet}!${dst.ref}`;
    if (onSheet(src) && onSheet(dst)) {
      const p = center(g, src.r1, src.c1);
      const q = center(g, dst.r1, dst.c1);
      const multi = src.r2 > src.r1 || src.c2 > src.c1;
      // A whole column/row source is boxed only over its first cells.
      const r2 = Math.min(src.r2, src.r1 + 200);
      const c2 = Math.min(src.c2, src.c1 + 50);
      out.push({
        key,
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        box: multi ? { x: g.colLeft(src.c1), y: g.rowTop(src.r1), w: g.colLeft(c2 + 1) - g.colLeft(src.c1), h: g.rowTop(r2 + 1) - g.rowTop(src.r1) } : undefined,
        title,
        kind,
      });
    } else if (onSheet(dst)) {
      const q = center(g, dst.r1, dst.c1);
      const ix = Math.max(12, q.x - 60);
      const iy = Math.max(10, q.y - 34);
      out.push({ key, x1: ix, y1: iy, x2: q.x, y2: q.y, dashed: true, sheetIcon: { x: ix, y: iy, label: `${src.sheet}!${src.ref}` }, title, kind });
    } else if (onSheet(src)) {
      const p = center(g, src.r1, src.c1);
      const ix = p.x + 60;
      const iy = Math.max(10, p.y - 34);
      out.push({ key, x1: p.x, y1: p.y, x2: ix, y2: iy, dashed: true, sheetIcon: { x: ix, y: iy, label: `${dst.sheet}!${dst.ref}` }, title, kind });
    }
  };
  result.precedents.forEach((a, i) => add(a, i, "precedent"));
  result.dependents.forEach((a, i) => add(a, i, "dependent"));
  return out;
}

export function TraceOverlay({ getWb, container, trace }: { getWb: () => any; container: HTMLElement | null; trace: TraceState | null }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!container) return;
    const find = () => {
      const el = container.querySelector<HTMLElement>(".fortune-cell-area");
      setTarget((cur) => (cur === el ? cur : el));
    };
    find();
    const mo = new MutationObserver(find);
    mo.observe(container, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [container]);

  if (!target || !trace?.result) return null;
  let sheet: any = null;
  try {
    const wb = getWb();
    const cur = wb?.getSheet?.();
    sheet = (wb?.getAllSheets?.() ?? []).find((s: any) => s?.id === cur?.id) ?? cur;
  } catch {
    return null;
  }
  if (!sheet) return null;
  const g = gridGeometry(sheet);
  const segs = traceSegments(trace.result, String(sheet.id ?? ""), g);
  if (!segs.length) return null;
  let w = 0;
  let h = 0;
  for (const s of segs) {
    w = Math.max(w, s.x1, s.x2, (s.box?.x ?? 0) + (s.box?.w ?? 0)) ;
    h = Math.max(h, s.y1, s.y2, (s.box?.y ?? 0) + (s.box?.h ?? 0));
  }
  return createPortal(
    <svg
      data-testid="trace-arrows"
      width={w + 40}
      height={h + 40}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 105, overflow: "visible" }}
    >
      <defs>
        <marker id="grown-trace-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={BLUE} />
        </marker>
      </defs>
      {segs.map((s) => (
        <g key={s.key} data-trace={s.kind} data-title={s.title}>
          <title>{s.title}</title>
          {s.box && <rect x={s.box.x + 1} y={s.box.y + 1} width={Math.max(0, s.box.w - 2)} height={Math.max(0, s.box.h - 2)} fill="none" stroke={BLUE} strokeWidth={1.5} />}
          {s.sheetIcon && (
            <g transform={`translate(${s.sheetIcon.x - 9}, ${s.sheetIcon.y - 7})`}>
              <rect width={18} height={14} rx={1.5} fill="#fff" stroke={BLUE} strokeWidth={1.2} />
              <path d="M0,5 H18 M0,9.5 H18 M6,0 V14 M12,0 V14" stroke={BLUE} strokeWidth={0.8} />
            </g>
          )}
          <circle cx={s.x1} cy={s.y1} r={3} fill={BLUE} />
          <line
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={BLUE}
            strokeWidth={1.6}
            strokeDasharray={s.dashed ? "5 3" : undefined}
            markerEnd="url(#grown-trace-head)"
          />
        </g>
      ))}
    </svg>,
    target,
  );
}
