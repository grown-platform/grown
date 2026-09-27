// Pure canvas geometry for the slide editor: drag-to-move / handle-resize
// maths, resize-handle placement and cursors, and stage fitting. Coordinates
// are in the logical CANVAS_W × CANVAS_H space unless stated otherwise.

import { CANVAS_W, CANVAS_H, type SlideElement } from "./model";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** Lines only get the two end handles. */
export const LINE_HANDLES: Handle[] = ["w", "e"];

export type DragMode = "move" | Handle;

/** Smallest width/height (logical px) a resize can shrink an element to. */
export const MIN_ELEMENT_SIZE = 10;

/** dragElement returns `start` moved (mode "move") or resized from one of the
 *  8 handles by the logical delta (dx, dy). Resizing clamps to
 *  MIN_ELEMENT_SIZE and keeps the opposite edge fixed; a line may be dragged to
 *  zero height from its bottom edge. A group's children follow (move) or are
 *  scaled into the new box (resize). */
export function dragElement(
  start: SlideElement,
  mode: DragMode,
  dx: number,
  dy: number,
): SlideElement {
  const s = start;
  if (mode === "move")
    return setElementBox(s, { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h });
  let { x, y, w, h } = s;
  if (mode.includes("e")) w = Math.max(MIN_ELEMENT_SIZE, s.w + dx);
  if (mode.includes("s"))
    h = Math.max(s.type === "line" ? 0 : MIN_ELEMENT_SIZE, s.h + dy);
  if (mode.includes("w")) {
    w = Math.max(MIN_ELEMENT_SIZE, s.w - dx);
    x = s.x + (s.w - w);
  }
  if (mode.includes("n")) {
    h = Math.max(MIN_ELEMENT_SIZE, s.h - dy);
    y = s.y + (s.h - h);
  }
  return setElementBox(s, { x, y, w, h });
}

// ---- boxes, bounds and hit-testing ----

/** An axis-aligned rectangle in logical px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Round away float noise (e.g. cos 90° = 6e-17) so tests compare exactly. */
function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function normDeg(d: number | undefined): number {
  return ((((d || 0) % 360) + 360) % 360);
}

/** rotatePoint turns (px, py) by `deg` clockwise (screen y-down) about (cx, cy). */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number,
): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return { x: clean(cx + dx * c - dy * s), y: clean(cy + dx * s + dy * c) };
}

/** elementBounds is the axis-aligned box an element covers as drawn, i.e.
 *  after its rotation about its centre (flips don't change the box). */
export function elementBounds(el: SlideElement): Rect {
  const rot = normDeg(el.rotation);
  if (!rot) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const r = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = el.w * c + el.h * s;
  const h = el.w * s + el.h * c;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return { x: clean(cx - w / 2), y: clean(cy - h / 2), w: clean(w), h: clean(h) };
}

/** unionRects is the smallest rectangle covering all `rects` (null when empty). */
export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** selectionBounds is the union of the drawn bounds of `els`. */
export function selectionBounds(els: SlideElement[]): Rect | null {
  return unionRects(els.map(elementBounds));
}

/** normalizeRect builds a rectangle from two corner points in any order
 *  (a marquee dragged up/left has negative extents). */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** rectContains reports whether `inner` lies entirely inside `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** rectsIntersect reports whether two rectangles overlap (touching edges count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}

/** marqueeSelect returns the ids of the elements a rubber-band rectangle
 *  selects, in z-order. Like PowerPoint and OnlyOffice an element must lie
 *  entirely inside the marquee ("contain"); "intersect" selects anything the
 *  marquee touches. */
export function marqueeSelect(
  elements: SlideElement[],
  rect: Rect,
  mode: "contain" | "intersect" = "contain",
): string[] {
  return elements
    .filter((el) => {
      const b = elementBounds(el);
      return mode === "contain" ? rectContains(rect, b) : rectsIntersect(rect, b);
    })
    .map((el) => el.id);
}

/** Half-width (logical px) of the clickable band around a line. */
export const LINE_HIT_SLOP = 4;

/** pointInElement hit-tests a point against an element's rotated box. Lines
 *  get a LINE_HIT_SLOP band so a 0-height line is still clickable. */
export function pointInElement(el: SlideElement, px: number, py: number): boolean {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const p = normDeg(el.rotation)
    ? rotatePoint(px, py, cx, cy, -normDeg(el.rotation))
    : { x: px, y: py };
  const slop = el.type === "line" ? Math.max(LINE_HIT_SLOP, (el.strokeWidth || 0) / 2) : 0;
  return (
    p.x >= el.x - slop &&
    p.x <= el.x + el.w + slop &&
    p.y >= el.y - slop &&
    p.y <= el.y + el.h + slop
  );
}

/** hitTest returns the id of the topmost element (last in z-order) under the
 *  point, or null. A group is hit as a whole anywhere inside its box. */
export function hitTest(elements: SlideElement[], px: number, py: number): string | null {
  for (let i = elements.length - 1; i >= 0; i--)
    if (pointInElement(elements[i], px, py)) return elements[i].id;
  return null;
}

/** mapElementInto maps an element's box from the `from` frame to the `to`
 *  frame (translate + independent x/y scale), recursing into groups. */
export function mapElementInto(el: SlideElement, from: Rect, to: Rect): SlideElement {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  return setElementBox(el, {
    x: clean(to.x + (el.x - from.x) * sx),
    y: clean(to.y + (el.y - from.y) * sy),
    w: clean(el.w * sx),
    h: clean(el.h * sy),
  });
}

/** setElementBox gives an element a new box. A group's children are moved
 *  and scaled with it (fonts and stroke widths are not scaled, as in
 *  PowerPoint). */
export function setElementBox(el: SlideElement, box: Rect): SlideElement {
  const next: SlideElement = { ...el, x: box.x, y: box.y, w: box.w, h: box.h };
  if (el.type === "group" && el.children)
    next.children = el.children.map((c) => mapElementInto(c, el, box));
  return next;
}

/** resizeBox resizes a rectangle from handle `mode` by (dx, dy), keeping the
 *  opposite edge fixed and clamping to `min`. */
export function resizeBox(
  b: Rect,
  mode: Handle,
  dx: number,
  dy: number,
  min = MIN_ELEMENT_SIZE,
): Rect {
  let { x, y, w, h } = b;
  if (mode.includes("e")) w = Math.max(min, b.w + dx);
  if (mode.includes("s")) h = Math.max(min, b.h + dy);
  if (mode.includes("w")) {
    w = Math.max(min, b.w - dx);
    x = b.x + (b.w - w);
  }
  if (mode.includes("n")) {
    h = Math.max(min, b.h - dy);
    y = b.y + (b.h - h);
  }
  return { x, y, w, h };
}

/** resizeSelection scales several elements together: their union box is
 *  resized from `mode` to `box` and every element is mapped into it. */
export function resizeSelection(
  starts: SlideElement[],
  box: Rect,
): SlideElement[] {
  const from = selectionBounds(starts);
  if (!from) return starts;
  return starts.map((el) => mapElementInto(el, from, box));
}

// ---- snapping (smart guides + grid) ----

/** A guide line drawn while snapping: vertical (axis "x", at x = pos, spanning
 *  y from..to) or horizontal (axis "y"). */
export interface Guide {
  axis: "x" | "y";
  pos: number;
  from: number;
  to: number;
}

/** Distance (logical px) within which an edge or centre snaps to a guide. */
export const SNAP_THRESHOLD = 6;
/** Default grid pitch (logical px): 960 / 40 = 24 columns. */
export const GRID_SIZE = 20;

export interface SnapOptions {
  /** Snap to the slide and other elements' edges/centres (smart guides). */
  guides?: boolean;
  /** Grid pitch in logical px; 0/undefined = no grid snapping. */
  grid?: number;
  threshold?: number;
}

const SLIDE_RECT: Rect = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };

function lines(r: Rect, axis: "x" | "y"): number[] {
  return axis === "x" ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h];
}

/** snapTargets is the list of rectangles a drag can snap to: every element
 *  not being dragged (drawn bounds). The slide itself is always a target. */
export function snapTargets(elements: SlideElement[], exclude: ReadonlySet<string>): Rect[] {
  return elements.filter((e) => !exclude.has(e.id)).map(elementBounds);
}

/** Closest target line to any of `moving` within the threshold, per axis. */
function bestSnap(
  moving: number[],
  targets: Rect[],
  axis: "x" | "y",
  threshold: number,
): number | null {
  let best: number | null = null;
  for (const t of [SLIDE_RECT, ...targets])
    for (const tl of lines(t, axis))
      for (const m of moving) {
        const d = tl - m;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best)))
          best = d;
      }
  return best;
}

/** guidesFor lists the guides a (snapped) box lines up with: each target
 *  edge/centre equal to one of the box's, spanning both shapes. */
export function guidesFor(box: Rect, targets: Rect[]): Guide[] {
  const out: Guide[] = [];
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const add = (g: Guide) => {
    const k = `${g.axis}:${Math.round(g.pos * 10)}`;
    const prev = out.find((o) => `${o.axis}:${Math.round(o.pos * 10)}` === k);
    if (prev) {
      prev.from = Math.min(prev.from, g.from);
      prev.to = Math.max(prev.to, g.to);
      return;
    }
    out.push(g);
  };
  for (const m of lines(box, "x"))
    for (const t of lines(SLIDE_RECT, "x"))
      if (eq(m, t)) add({ axis: "x", pos: t, from: 0, to: CANVAS_H });
  for (const m of lines(box, "y"))
    for (const t of lines(SLIDE_RECT, "y"))
      if (eq(m, t)) add({ axis: "y", pos: t, from: 0, to: CANVAS_W });
  for (const r of targets) {
    for (const m of lines(box, "x"))
      for (const t of lines(r, "x"))
        if (eq(m, t))
          add({
            axis: "x",
            pos: t,
            from: Math.min(box.y, r.y),
            to: Math.max(box.y + box.h, r.y + r.h),
          });
    for (const m of lines(box, "y"))
      for (const t of lines(r, "y"))
        if (eq(m, t))
          add({
            axis: "y",
            pos: t,
            from: Math.min(box.x, r.x),
            to: Math.max(box.x + box.w, r.x + r.w),
          });
  }
  return out;
}

/** snapMove adjusts a move so the dragged box's left/centre/right (and
 *  top/middle/bottom) lock onto the nearest slide or element edge/centre
 *  within the threshold. Without a guide hit, the box's top-left snaps to the
 *  grid when one is set. Returns the corrected box offset and the guides to
 *  draw. */
export function snapMove(
  box: Rect,
  targets: Rect[],
  opts: SnapOptions,
): { dx: number; dy: number; guides: Guide[] } {
  const th = opts.threshold ?? SNAP_THRESHOLD;
  let dx = opts.guides ? bestSnap(lines(box, "x"), targets, "x", th) : null;
  let dy = opts.guides ? bestSnap(lines(box, "y"), targets, "y", th) : null;
  const g = opts.grid || 0;
  if (dx === null && g > 0) dx = Math.round(box.x / g) * g - box.x;
  if (dy === null && g > 0) dy = Math.round(box.y / g) * g - box.y;
  const moved = { ...box, x: box.x + (dx ?? 0), y: box.y + (dy ?? 0) };
  return {
    dx: clean(dx ?? 0),
    dy: clean(dy ?? 0),
    guides: opts.guides ? guidesFor(moved, targets) : [],
  };
}

/** snapResize snaps only the edges a resize handle drags (e.g. "se" moves the
 *  right and bottom edges) to guides, else to the grid. */
export function snapResize(
  box: Rect,
  mode: Handle,
  targets: Rect[],
  opts: SnapOptions,
): { box: Rect; guides: Guide[] } {
  const th = opts.threshold ?? SNAP_THRESHOLD;
  const g = opts.grid || 0;
  const snap1 = (v: number, axis: "x" | "y"): number => {
    const d = opts.guides ? bestSnap([v], targets, axis, th) : null;
    if (d !== null) return v + d;
    if (g > 0) return Math.round(v / g) * g;
    return v;
  };
  let { x, y, w, h } = box;
  if (mode.includes("e")) w = Math.max(MIN_ELEMENT_SIZE, snap1(x + w, "x") - x);
  if (mode.includes("w")) {
    const nx = Math.min(snap1(x, "x"), x + w - MIN_ELEMENT_SIZE);
    w = x + w - nx;
    x = nx;
  }
  if (mode.includes("s")) h = Math.max(MIN_ELEMENT_SIZE, snap1(y + h, "y") - y);
  if (mode.includes("n")) {
    const ny = Math.min(snap1(y, "y"), y + h - MIN_ELEMENT_SIZE);
    h = y + h - ny;
    y = ny;
  }
  const out = { x: clean(x), y: clean(y), w: clean(w), h: clean(h) };
  return { box: out, guides: opts.guides ? guidesFor(out, targets) : [] };
}

/** screenToLogical converts a pointer delta in screen px to logical px. */
export function screenToLogical(
  dxPx: number,
  dyPx: number,
  scale: number,
): { dx: number; dy: number } {
  return { dx: dxPx / scale, dy: dyPx / scale };
}

/** canvasScale is the render scale for a canvas drawn `width` px wide. */
export function canvasScale(width: number): number {
  return width / CANVAS_W;
}

/** canvasHeight is the 16:9 pixel height for a canvas drawn `width` px wide. */
export function canvasHeight(width: number): number {
  return width * (CANVAS_H / CANVAS_W);
}

/** handlePosition places a resize handle on the element's box (percentages;
 *  centred on the edge/corner via translate). */
export function handlePosition(h: Handle): {
  top: string;
  left: string;
  transform: string;
} {
  const top = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
  const left = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%";
  return { top, left, transform: "translate(-50%, -50%)" };
}

/** handleCursor is the CSS resize cursor for a handle. */
export function handleCursor(h: Handle): string {
  if (h === "n" || h === "s") return "ns-resize";
  if (h === "e" || h === "w") return "ew-resize";
  if (h === "ne" || h === "sw") return "nesw-resize";
  return "nwse-resize";
}

/** Padding (px) around the canvas inside the editor stage, per axis total. */
export const STAGE_PADDING = 48;
/** Minimum rendered canvas width (px). */
export const MIN_CANVAS_PX = 320;

/** fitCanvasWidth returns the largest 16:9 canvas width that fits a stage of
 *  the given client size, never below MIN_CANVAS_PX. */
export function fitCanvasWidth(stageW: number, stageH: number): number {
  const w = stageW - STAGE_PADDING;
  const h = stageH - STAGE_PADDING;
  return Math.max(MIN_CANVAS_PX, Math.min(w, h * (CANVAS_W / CANVAS_H)));
}

/** fitPresentWidth returns the largest 16:9 width that fits a viewport. */
export function fitPresentWidth(viewW: number, viewH: number): number {
  return Math.min(viewW, viewH * (CANVAS_W / CANVAS_H));
}
