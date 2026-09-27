// Slide properties (M7): slide size with content scaling, gradient and
// picture backgrounds, hidden (skipped) slides. Pure functions.

import {
  CANVAS_W,
  DEFAULT_CANVAS_H,
  type DeckDoc,
  type Slide,
  type SlideElement,
  type SlideFill,
} from "./model";
import { withFooters } from "./layouts";

// ------------------------------------------------------------ size

export interface SizePreset {
  id: string;
  label: string;
  /** Physical size in inches (what Page setup shows and pptx gets). */
  wIn: number;
  hIn: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: "16:9", label: "Widescreen 16:9", wIn: 10, hIn: 5.625 },
  { id: "16:10", label: "Widescreen 16:10", wIn: 10, hIn: 6.25 },
  { id: "4:3", label: "Standard 4:3", wIn: 10, hIn: 7.5 },
  { id: "a4", label: "A4 paper", wIn: 10.833, hIn: 7.5 },
];

/** Logical size of a deck's slides (width is always CANVAS_W). */
export function deckSize(deck: Pick<DeckDoc, "size"> | null | undefined): { w: number; h: number } {
  const s = deck?.size;
  if (!s || !(s.w > 0) || !(s.h > 0)) return { w: CANVAS_W, h: DEFAULT_CANVAS_H };
  return { w: CANVAS_W, h: Math.round((CANVAS_W * s.h) / s.w) };
}

/** Logical size for a physical size in inches. */
export function sizeFromInches(wIn: number, hIn: number): { w: number; h: number } {
  return { w: CANVAS_W, h: Math.round((CANVAS_W * hIn) / wIn) };
}

/** The preset matching a deck's size, or undefined (custom). */
export function presetOf(deck: Pick<DeckDoc, "size">): SizePreset | undefined {
  const { h } = deckSize(deck);
  return SIZE_PRESETS.find((p) => sizeFromInches(p.wIn, p.hIn).h === h);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scale an element by `k` about the origin, then shift it (dx, dy). Text
 *  sizes scale with it (PowerPoint's "Ensure fit"/"Maximize"). */
export function scaleElement(el: SlideElement, k: number, dx: number, dy: number): SlideElement {
  const out: SlideElement = {
    ...el,
    x: r2(el.x * k + dx),
    y: r2(el.y * k + dy),
    w: r2(el.w * k),
    h: r2(el.h * k),
  };
  if (k !== 1) {
    if (el.fontSize) out.fontSize = r2(el.fontSize * k);
    if (el.runs) out.runs = el.runs.map((r) => (r.fontSize ? { ...r, fontSize: r2(r.fontSize * k) } : r));
    if (el.insets) out.insets = { l: r2(el.insets.l * k), t: r2(el.insets.t * k), r: r2(el.insets.r * k), b: r2(el.insets.b * k) };
  }
  if (el.children) out.children = el.children.map((c) => scaleElement(c, k, dx, dy));
  return out;
}

/**
 * resizeDeck changes the slide size from `from` to `to` (logical px) and
 * scales content: "fit" keeps everything on the slide (scale by the smaller
 * ratio and centre), "max" fills the new size (scale by the larger ratio and
 * centre; content may run off the edges). Layout boxes scale the same way.
 */
export function resizeDeck(
  deck: DeckDoc,
  to: { w: number; h: number },
  mode: "fit" | "max" = "fit",
): DeckDoc {
  const from = deckSize(deck);
  const next = { w: CANVAS_W, h: Math.round((CANVAS_W * to.h) / to.w) };
  const kx = next.w / from.w;
  const ky = next.h / from.h;
  const k = mode === "fit" ? Math.min(kx, ky) : Math.max(kx, ky);
  const dx = r2((next.w - from.w * k) / 2);
  const dy = r2((next.h - from.h * k) / 2);
  const sc = (els: SlideElement[]) => els.map((e) => scaleElement(e, k, dx, dy));
  const isDefault = next.h === DEFAULT_CANVAS_H;
  const out: DeckDoc = {
    ...deck,
    slides: deck.slides.map((s) => ({ ...s, elements: sc(s.elements) })),
    ...(deck.layouts ? { layouts: deck.layouts.map((l) => ({ ...l, elements: sc(l.elements) })) } : {}),
  };
  if (isDefault) delete out.size;
  else out.size = next;
  return out;
}

// ------------------------------------------------------------ background

/** CSS `background` for a slide: its gradient/picture over its colour. */
export function backgroundCss(s: Pick<Slide, "background" | "bgFill">): string {
  const base = s.background || "#ffffff";
  const f = s.bgFill;
  if (!f) return base;
  if (f.kind === "image") return `${base} url("${f.src.replace(/"/g, "%22")}") center / cover no-repeat`;
  return `${gradientCss(f)}, ${base}`;
}

export function gradientCss(f: Extract<SlideFill, { kind: "gradient" }>): string {
  const stops = f.stops.map((s) => `${s.color} ${r2(s.pos * 100)}%`).join(", ");
  if (f.radial) return `radial-gradient(circle, ${stops})`;
  // CSS angles run clockwise from "to top"; DrawingML/Grown 0° is left→right.
  return `linear-gradient(${r2((f.angle ?? 90) + 90)}deg, ${stops})`;
}

/** A two-stop linear gradient. */
export function twoStop(from: string, to: string, angle = 90): SlideFill {
  return { kind: "gradient", stops: [{ pos: 0, color: from }, { pos: 1, color: to }], angle };
}

export interface BackgroundPatch {
  background: string;
  bgFill?: SlideFill;
  bgRef?: string;
}

/** Set a slide's background (colour, optional gradient/picture). A colour
 *  from the theme passes its ref; an explicit one drops the ref. */
export function setSlideBackground(s: Slide, p: BackgroundPatch): Slide {
  const out: Slide = { ...s, background: p.background };
  if (p.bgFill) out.bgFill = p.bgFill;
  else delete out.bgFill;
  if (p.bgRef) out.bgRef = p.bgRef;
  else delete out.bgRef;
  return out;
}

/** Apply one slide's background to every slide (Background ▸ Apply to all). */
export function backgroundToAll(slides: Slide[], from: Slide): Slide[] {
  return slides.map((s) =>
    setSlideBackground(s, { background: from.background, bgFill: from.bgFill, bgRef: from.bgRef }),
  );
}

// ------------------------------------------------------------ hidden slides

export function toggleHidden(slides: Slide[], ids: readonly string[]): Slide[] {
  const set = new Set(ids);
  const hide = slides.some((s) => set.has(s.id) && !s.hidden);
  return slides.map((s) => {
    if (!set.has(s.id)) return s;
    if (hide) return { ...s, hidden: true };
    const o = { ...s };
    delete o.hidden;
    return o;
  });
}

/**
 * The slides a slideshow plays: visible ones, with their header/footer
 * boxes drawn in, plus the index into that list to start from for editor
 * slide `cur` (the next visible slide at or after it, else the last).
 */
export function showSlides(deck: DeckDoc, cur = 0, now?: Date): { slides: Slide[]; start: number; indexOf: number[] } {
  const slides: Slide[] = [];
  const indexOf: number[] = [];
  let start = -1;
  deck.slides.forEach((s, i) => {
    if (s.hidden) return;
    if (start < 0 && i >= cur) start = slides.length;
    slides.push(withFooters(deck, i, now));
    indexOf.push(i);
  });
  if (start < 0) start = Math.max(0, slides.length - 1);
  return { slides, start, indexOf };
}
