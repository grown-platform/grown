// Pure picture operations (M6): crop maths (stored as pptx-style srcRect
// fractions), crop-to-shape clip paths from the preset engine, sizing
// (insert box, actual size, fit to slide), opacity and alt text.

import { CANVAS_H, CANVAS_W, type ImageCrop, type SlideElement } from "./model";
import type { Handle } from "./geometry";
import { evaluatePreset, hasPreset } from "./presetGeometry";

export interface Size {
  w: number;
  h: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
/** Smallest visible share of the picture on an axis. */
const MIN_VISIBLE = 0.02;
const MIN_BOX = 8;

export const NO_CROP: ImageCrop = { l: 0, t: 0, r: 0, b: 0 };

/** The element's crop, or none. */
export function cropOf(el: SlideElement): ImageCrop {
  return el.crop ?? NO_CROP;
}

/** normCrop clamps each side to [0, 1) keeping at least MIN_VISIBLE of the
 *  picture on each axis, rounded to 1e-4 (pptx stores 1/100 000). */
export function normCrop(c: ImageCrop): ImageCrop {
  const cl = (v: number) => Math.max(0, Math.min(1 - MIN_VISIBLE, Number.isFinite(v) ? v : 0));
  let { l, t, r, b } = { l: cl(c.l), t: cl(c.t), r: cl(c.r), b: cl(c.b) };
  if (l + r > 1 - MIN_VISIBLE) r = 1 - MIN_VISIBLE - l;
  if (t + b > 1 - MIN_VISIBLE) b = 1 - MIN_VISIBLE - t;
  return { l: r4(l), t: r4(t), r: r4(r), b: r4(b) };
}

/** Where the whole (uncropped) picture lies, relative to the element box:
 *  the box shows the part of it the crop leaves. */
export function fullImageRect(el: SlideElement): { x: number; y: number; w: number; h: number } {
  const c = cropOf(el);
  const w = el.w / (1 - c.l - c.r);
  const h = el.h / (1 - c.t - c.b);
  return { x: -c.l * w || 0, y: -c.t * h || 0, w, h };
}

/**
 * cropResize drags a crop handle: the box edge moves but the picture stays
 * where it is, so the crop on that side changes (PowerPoint's crop mode).
 * An edge can't move past the picture's own edge.
 */
export function cropResize(start: SlideElement, handle: Handle, dx: number, dy: number): SlideElement {
  const full = fullImageRect(start);
  const fx = start.x + full.x;
  const fy = start.y + full.y;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = Math.max(fx, Math.min(right - MIN_BOX, left + dx));
  if (handle.includes("e")) right = Math.min(fx + full.w, Math.max(left + MIN_BOX, right + dx));
  if (handle.includes("n")) top = Math.max(fy, Math.min(bottom - MIN_BOX, top + dy));
  if (handle.includes("s")) bottom = Math.min(fy + full.h, Math.max(top + MIN_BOX, bottom + dy));
  const crop = normCrop({
    l: (left - fx) / full.w,
    r: (fx + full.w - right) / full.w,
    t: (top - fy) / full.h,
    b: (fy + full.h - bottom) / full.h,
  });
  return { ...start, x: r2(left), y: r2(top), w: r2(right - left), h: r2(bottom - top), crop };
}

/** cropPan moves the picture inside a fixed crop box (drag in crop mode). */
export function cropPan(start: SlideElement, dx: number, dy: number): SlideElement {
  const c = cropOf(start);
  const full = fullImageRect(start);
  const shiftX = Math.max(-c.l * full.w, Math.min(c.r * full.w, -dx));
  const shiftY = Math.max(-c.t * full.h, Math.min(c.b * full.h, -dy));
  const l = c.l + shiftX / full.w;
  const t = c.t + shiftY / full.h;
  const crop = normCrop({ l, r: 1 - (1 - c.l - c.r) - l, t, b: 1 - (1 - c.t - c.b) - t });
  return { ...start, crop };
}

/** resetCrop shows the whole picture again at the same scale. */
export function resetCrop(el: SlideElement): SlideElement {
  if (!el.crop) return el;
  const f = fullImageRect(el);
  const out: SlideElement = { ...el, x: r2(el.x + f.x), y: r2(el.y + f.y), w: r2(f.w), h: r2(f.h) };
  delete out.crop;
  return out;
}

/** cropToFill crops the picture (centred) so it fills the box without
 *  distortion (OnlyOffice/PowerPoint Crop ▸ Fill). */
export function cropToFill(el: SlideElement, nat: Size): SlideElement {
  if (!nat.w || !nat.h || !el.w || !el.h) return el;
  const boxAr = el.w / el.h;
  const imgAr = nat.w / nat.h;
  let crop: ImageCrop = { ...NO_CROP };
  if (imgAr > boxAr) {
    const cut = (1 - boxAr / imgAr) / 2;
    crop = { l: cut, r: cut, t: 0, b: 0 };
  } else if (imgAr < boxAr) {
    const cut = (1 - imgAr / boxAr) / 2;
    crop = { l: 0, r: 0, t: cut, b: cut };
  }
  return { ...el, crop: normCrop(crop) };
}

/** cropToFit shrinks the box to the picture's (visible) proportions, keeping
 *  its centre (Crop ▸ Fit: the whole picture, no distortion). */
export function cropToFit(el: SlideElement, nat: Size): SlideElement {
  if (!nat.w || !nat.h) return el;
  const out: SlideElement = { ...el };
  delete out.crop;
  const ar = nat.w / nat.h;
  let w = el.w;
  let h = w / ar;
  if (h > el.h) {
    h = el.h;
    w = h * ar;
  }
  return { ...out, x: r2(el.x + (el.w - w) / 2), y: r2(el.y + (el.h - h) / 2), w: r2(w), h: r2(h), crop: { ...NO_CROP } };
}

/** Scale a size down (never up) to fit max. */
export function fitWithin(s: Size, max: Size): Size {
  const k = Math.min(1, max.w / s.w, max.h / s.h);
  return { w: r2(s.w * k), h: r2(s.h * k) };
}

/** The box for a newly inserted picture: its own proportions, at most
 *  60 % of the slide, centred. */
export function insertBox(nat: Size | null): { x: number; y: number; w: number; h: number } {
  const s = nat && nat.w > 0 && nat.h > 0 ? fitWithin(nat, { w: CANVAS_W * 0.6, h: CANVAS_H * 0.6 }) : { w: 320, h: 200 };
  return { x: r2((CANVAS_W - s.w) / 2), y: r2((CANVAS_H - s.h) / 2), w: s.w, h: s.h };
}

/** actualSize: the picture at its natural pixel size (visible part), shrunk
 *  to fit the slide if needed; the top-left corner stays. */
export function actualSize(el: SlideElement, nat: Size): SlideElement {
  if (!nat.w || !nat.h) return el;
  const c = cropOf(el);
  const s = fitWithin({ w: nat.w * (1 - c.l - c.r), h: nat.h * (1 - c.t - c.b) }, { w: CANVAS_W, h: CANVAS_H });
  return { ...el, w: s.w, h: s.h };
}

/** fitToSlide scales the picture (visible part, proportions kept) to fill
 *  the slide as far as it can, centred. */
export function fitToSlide(el: SlideElement, nat: Size): SlideElement {
  const c = cropOf(el);
  const vis = nat.w && nat.h ? { w: nat.w * (1 - c.l - c.r), h: nat.h * (1 - c.t - c.b) } : { w: el.w, h: el.h };
  const k = Math.min(CANVAS_W / vis.w, CANVAS_H / vis.h);
  const w = r2(vis.w * k);
  const h = r2(vis.h * k);
  return { ...el, x: r2((CANVAS_W - w) / 2), y: r2((CANVAS_H - h) / 2), w, h, rotation: undefined };
}

/** setOpacity: 0–1 (fully opaque drops the field). */
export function setOpacity(el: SlideElement, v: number): SlideElement {
  const out: SlideElement = { ...el };
  const o = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  if (o >= 1 || !Number.isFinite(o)) delete out.opacity;
  else out.opacity = o;
  return out;
}

/** setAlt sets alternative text (blank removes it). */
export function setAlt(el: SlideElement, alt: string): SlideElement {
  const out: SlideElement = { ...el };
  const v = alt.trim();
  if (v) out.alt = v;
  else delete out.alt;
  return out;
}

/** setCropShape clips the picture to a preset (null/"rect" = no shape). */
export function setCropShape(el: SlideElement, preset: string | null): SlideElement {
  const out: SlideElement = { ...el };
  if (preset && preset !== "rect" && hasPreset(preset)) out.cropShape = preset;
  else delete out.cropShape;
  return out;
}

/** The SVG path (element-local px) a crop shape clips to, or undefined. */
export function cropShapePath(el: SlideElement): string | undefined {
  if (!el.cropShape) return undefined;
  const g = evaluatePreset(el.cropShape, el.w, el.h);
  if (!g) return undefined;
  const d = g.paths
    .filter((p) => p.fill !== "none")
    .map((p) => p.d)
    .join(" ");
  return d || undefined;
}

/** replaceImage swaps the picture, keeping the box; a new picture starts
 *  uncropped, with its proportions fitted inside the old box. */
export function replaceImage(el: SlideElement, src: string, nat: Size | null): SlideElement {
  const out: SlideElement = { ...el, src };
  delete out.crop;
  if (!nat || !nat.w || !nat.h) return out;
  const s = fitWithin(nat, { w: el.w, h: el.h });
  // fitWithin never scales up: scale up to the box too.
  const k = Math.min(el.w / s.w, el.h / s.h);
  const w = r2(s.w * k);
  const h = r2(s.h * k);
  return { ...out, x: r2(el.x + (el.w - w) / 2), y: r2(el.y + (el.h - h) / 2), w, h };
}

/** Is `src` an inline data: URL (candidate for moving to asset storage)? */
export function isDataUrl(src: string | undefined): boolean {
  return !!src && src.startsWith("data:");
}

/** Is the picture drawn stretched to its box (cropped or clipped to a shape,
 *  as in pptx), rather than letterboxed (legacy pictures)? */
export function imageStretched(el: SlideElement): boolean {
  return !!(el.crop || el.cropShape);
}
