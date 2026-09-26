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
 *  zero height from its bottom edge. */
export function dragElement(
  start: SlideElement,
  mode: DragMode,
  dx: number,
  dy: number,
): SlideElement {
  const s = start;
  if (mode === "move") return { ...s, x: s.x + dx, y: s.y + dy };
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
  return { ...s, x, y, w, h };
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
