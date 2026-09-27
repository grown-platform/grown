// Connector endpoints, connection sites and glue (pure).
//
// A connector's path runs from its box's top-left to bottom-right; flipH /
// flipV mirror it, so the two endpoints are box corners. An end may be glued
// to a connection site of another top-level element (`stCxn`/`endCxn`, the
// pptx model); when that element moves, rerouteConnectors moves the end.

import { connectorBox, type CxnRef, type SlideElement } from "./model";
import { elementGeometry } from "./shapeRender";
import { evaluatePreset, solveHandle } from "./presetGeometry";

type Pt = [number, number];

/** Local box point → slide coordinates (flip, then rotate about the centre). */
export function localToSlide(el: SlideElement, lx: number, ly: number): Pt {
  const cx = el.w / 2;
  const cy = el.h / 2;
  let x = lx - cx;
  let y = ly - cy;
  if (el.flipH) x = -x;
  if (el.flipV) y = -y;
  const a = ((el.rotation || 0) * Math.PI) / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  return [el.x + cx + rx, el.y + cy + ry];
}

/** Slide point → the element's local, unrotated, unflipped box coordinates. */
export function slideToLocal(el: SlideElement, px: number, py: number): Pt {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const a = (-(el.rotation || 0) * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  let x = dx * Math.cos(a) - dy * Math.sin(a);
  let y = dx * Math.sin(a) + dy * Math.cos(a);
  if (el.flipH) x = -x;
  if (el.flipV) y = -y;
  return [x + el.w / 2, y + el.h / 2];
}

/** A connector's start and end in slide coordinates. */
export function connectorEnds(el: SlideElement): { start: Pt; end: Pt } {
  return { start: localToSlide(el, 0, 0), end: localToSlide(el, el.w, el.h) };
}

/** Connection sites of an element in slide coordinates ([] if none). */
export function connectionSites(el: SlideElement): Pt[] {
  if (el.type === "connector" || el.type === "group") return [];
  const g = elementGeometry(el);
  if (!g) {
    // Text boxes, images, tables: the four edge midpoints (PowerPoint).
    if (el.type === "text" || el.type === "image" || el.type === "table")
      return [
        [el.w / 2, 0],
        [0, el.h / 2],
        [el.w / 2, el.h],
        [el.w, el.h / 2],
      ].map(([x, y]) => localToSlide(el, x, y));
    return [];
  }
  return g.cxn.map((c) => localToSlide(el, c.x, c.y));
}

/** Default glue radius in logical px. */
export const GLUE_DISTANCE = 10;

/** The connection site nearest (px, py) within `maxDist`, among `elements`
 *  (top level, excluding `excludeId`). */
export function nearestSite(
  elements: readonly SlideElement[],
  px: number,
  py: number,
  excludeId?: string,
  maxDist = GLUE_DISTANCE,
): { ref: CxnRef; x: number; y: number } | null {
  let best: { ref: CxnRef; x: number; y: number } | null = null;
  let bestD = maxDist;
  for (const el of elements) {
    if (el.id === excludeId) continue;
    connectionSites(el).forEach(([x, y], idx) => {
      const d = Math.hypot(x - px, y - py);
      if (d <= bestD) {
        bestD = d;
        best = { ref: { id: el.id, idx }, x, y };
      }
    });
  }
  return best;
}

/** Slide position of a glue reference, or null if the target is gone. */
export function sitePosition(elements: readonly SlideElement[], ref: CxnRef): Pt | null {
  const t = elements.find((e) => e.id === ref.id);
  if (!t) return null;
  return connectionSites(t)[ref.idx] ?? null;
}

/** A connector moved so its ends are at `start`/`end` (upright, flips set),
 *  with the given glue. */
export function setConnectorEnds(
  el: SlideElement,
  start: Pt,
  end: Pt,
  glue: { stCxn?: CxnRef | null; endCxn?: CxnRef | null } = {},
): SlideElement {
  const next: SlideElement = { ...el, ...connectorBox(start[0], start[1], end[0], end[1]) };
  if (glue.stCxn !== undefined) {
    if (glue.stCxn) next.stCxn = glue.stCxn;
    else delete next.stCxn;
  }
  if (glue.endCxn !== undefined) {
    if (glue.endCxn) next.endCxn = glue.endCxn;
    else delete next.endCxn;
  }
  for (const k of ["flipH", "flipV", "rotation"] as const) if (next[k] === undefined) delete next[k];
  return next;
}

/**
 * After `changed` elements are updated, the glued connectors that must move
 * with them. Connectors inside `changed` whose glued end no longer sits on
 * its site (the connector itself was dragged away) are returned unglued.
 * Returns only elements that differ from `elements`' versions (including
 * the adjusted members of `changed`).
 */
export function rerouteConnectors(
  elements: readonly SlideElement[],
  changed: readonly SlideElement[],
): SlideElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const c of changed) byId.set(c.id, c);
  const all = [...byId.values()];
  const changedIds = new Set(changed.map((c) => c.id));
  const out = new Map<string, SlideElement>();
  for (const el of all) {
    if (el.type !== "connector" || (!el.stCxn && !el.endCxn)) continue;
    const self = changedIds.has(el.id);
    const touchesChanged =
      (el.stCxn && changedIds.has(el.stCxn.id)) || (el.endCxn && changedIds.has(el.endCxn.id));
    if (!self && !touchesChanged) continue;
    let { start, end } = connectorEnds(el);
    let stCxn: CxnRef | null | undefined = undefined;
    let endCxn: CxnRef | null | undefined = undefined;
    const fix = (ref: CxnRef | undefined, cur: Pt): { p: Pt; ref: CxnRef | null | undefined } => {
      if (!ref) return { p: cur, ref: undefined };
      const site = sitePosition(all, ref);
      if (!site) return { p: cur, ref: null };
      // The connector was moved on its own (target unchanged): unglue.
      if (self && !changedIds.has(ref.id) && Math.hypot(site[0] - cur[0], site[1] - cur[1]) > 0.5)
        return { p: cur, ref: null };
      return { p: site, ref: undefined };
    };
    const a = fix(el.stCxn, start);
    const b = fix(el.endCxn, end);
    start = a.p;
    end = b.p;
    stCxn = a.ref;
    endCxn = b.ref;
    const next = setConnectorEnds(el, start, end, { stCxn, endCxn });
    const prev = byId.get(el.id)!;
    if (JSON.stringify(next) !== JSON.stringify(prev) || self) out.set(el.id, next);
  }
  return [...out.values()];
}

/** `changed` plus the connectors glued to them, rerouted (for one upsert). */
export function withGluedConnectors(
  elements: readonly SlideElement[],
  changed: readonly SlideElement[],
): SlideElement[] {
  const moved = rerouteConnectors(elements, changed);
  if (!moved.length) return [...changed];
  const byId = new Map(moved.map((m) => [m.id, m]));
  const out = changed.map((c) => byId.get(c.id) ?? c);
  for (const m of moved) if (!changed.some((c) => c.id === m.id)) out.push(m);
  return out;
}

/** Adjust-handle positions of an element in its local box coordinates. */
export function adjustHandles(el: SlideElement): { x: number; y: number }[] {
  if (el.type !== "shape" && el.type !== "connector") return [];
  const g = el.preset ? evaluatePreset(el.preset, el.w, el.h, el.adj) : null;
  return g ? g.handles.map((h) => ({ x: h.x, y: h.y })) : [];
}

/** Drag adjust handle `index` of `el` to slide point (px, py); the element
 *  then stores the full adjust map of its preset. */
export function dragAdjustHandle(
  el: SlideElement,
  index: number,
  px: number,
  py: number,
): SlideElement {
  if (!el.preset) return el;
  const [lx, ly] = slideToLocal(el, px, py);
  const adj = solveHandle(el.preset, el.w, el.h, el.adj, index, lx, ly);
  return { ...el, adj };
}
