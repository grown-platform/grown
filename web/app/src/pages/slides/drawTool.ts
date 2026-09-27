// Draw-to-insert: the shape gallery arms a tool, the next drag on the canvas
// draws the element (a click inserts it at its default size), Esc cancels.

import {
  newConnector,
  newShape,
  presetDefaultSize,
  type ArrowHead,
  type SlideElement,
} from "./model";
import { isConnectorPreset } from "./presetDefs";
import { nearestSite, setConnectorEnds } from "./connectorOps";

export interface DrawTool {
  preset: string;
  kind: "shape" | "connector";
  headEnd?: ArrowHead;
  tailEnd?: ArrowHead;
}

/** A gallery id ("bentConnector3:arrow", "star5") → the tool it arms. */
export function toolFromGalleryId(id: string): DrawTool {
  const [preset, variant] = id.split(":");
  if (!isConnectorPreset(preset)) return { preset, kind: "shape" };
  return {
    preset,
    kind: "connector",
    ...(variant === "arrow" || variant === "double" ? { tailEnd: "triangle" as const } : {}),
    ...(variant === "double" ? { headEnd: "triangle" as const } : {}),
  };
}

/** Below this drag distance (logical px) a gesture counts as a click. */
export const CLICK_SLOP = 4;

/** Default length of a clicked-in connector. */
export const DEFAULT_CONNECTOR_LEN = 200;

/**
 * The element a draw gesture from (x0, y0) to (x1, y1) creates. Shapes get
 * the dragged box (Shift keeps it square) or, for a click, their default
 * size centred on the point. Connector ends glue to connection sites of
 * `elements` within `glue` px.
 */
export function drawnElement(
  tool: DrawTool,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  opts: { elements?: readonly SlideElement[]; shift?: boolean; glue?: number } = {},
): SlideElement {
  const click = Math.hypot(x1 - x0, y1 - y0) < CLICK_SLOP;
  if (tool.kind === "connector") {
    const els = opts.elements ?? [];
    const s = nearestSite(els, x0, y0, undefined, opts.glue);
    let e = click ? null : nearestSite(els, x1, y1, undefined, opts.glue);
    if (e && s && e.ref.id === s.ref.id && e.ref.idx === s.ref.idx) e = null;
    const start: [number, number] = s ? [s.x, s.y] : [x0, y0];
    const end: [number, number] = e
      ? [e.x, e.y]
      : click
        ? [start[0] + DEFAULT_CONNECTOR_LEN, start[1]]
        : [x1, y1];
    const base = newConnector(tool.preset, { headEnd: tool.headEnd, tailEnd: tool.tailEnd });
    return setConnectorEnds(base, start, end, {
      stCxn: s ? s.ref : null,
      endCxn: e ? e.ref : null,
    });
  }
  if (click) {
    const { w, h } = presetDefaultSize(tool.preset);
    return newShape(tool.preset, { x: Math.round(x0 - w / 2), y: Math.round(y0 - h / 2), w, h });
  }
  let w = Math.abs(x1 - x0);
  let h = Math.abs(y1 - y0);
  if (opts.shift) w = h = Math.max(w, h);
  const x = x1 < x0 ? x0 - w : x0;
  const y = y1 < y0 ? y0 - h : y0;
  const r = (n: number) => Math.round(n * 100) / 100;
  return newShape(tool.preset, { x: r(x), y: r(y), w: r(w), h: r(h) });
}
