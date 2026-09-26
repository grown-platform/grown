// pptx writer: Grown DeckDoc → PowerPoint bytes.
//
// pptxgenjs builds the package; anything it cannot express (slide
// transitions) is patched into its output zip afterwards with jszip. The
// patch helpers work on XML strings so each one is unit-testable.

import JSZip from "jszip";
import type PptxGenJSType from "pptxgenjs";
import {
  CANVAS_W,
  type DeckDoc,
  type SlideElement,
  type TransitionType,
} from "../model";

/** Slide size written to every pptx: 10 in × 5.625 in (16:9). */
export const SLIDE_W_IN = 10;
export const SLIDE_H_IN = 5.625;

/** Logical px → inches (960 px canvas = 10 in). */
export function pxToInch(px: number): number {
  return (px / CANVAS_W) * SLIDE_W_IN;
}
/** Logical px → points (960 px = 720 pt). */
export function pxToPt(px: number): number {
  return px * 0.75;
}
/** `#rrggbb[aa]` → `RRGGBB` for pptxgenjs (alpha is written separately). */
export function hex6(c?: string): string {
  return (c || "#000000")
    .replace("#", "")
    .slice(0, 6)
    .padEnd(6, "0")
    .toUpperCase();
}
/** Transparency percent (0–100) from an `#rrggbbaa` colour, or undefined. */
export function transparencyOf(c?: string): number | undefined {
  const m = /^#?[0-9a-f]{6}([0-9a-f]{2})$/i.exec(c || "");
  if (!m) return undefined;
  const a = parseInt(m[1], 16);
  return a === 255 ? undefined : Math.round((1 - a / 255) * 100);
}

/** Rounded-rectangle corner radius as a fraction of the short side; matches the renderer. */
export const ROUND_RECT_RATIO = 0.18;

// ------------------------------------------------------------ transitions

/**
 * The `<p:transition>` element for a Grown transition, or "" for none.
 * Directions follow PowerPoint: "Push from right" moves the old slide left
 * (`dir="l"`).
 */
export function transitionXml(t: TransitionType | undefined): string {
  switch (t) {
    case "fade":
      return `<p:transition spd="med"><p:fade/></p:transition>`;
    case "slide-left":
      return `<p:transition spd="med"><p:push dir="l"/></p:transition>`;
    case "slide-right":
      return `<p:transition spd="med"><p:push dir="r"/></p:transition>`;
    case "slide-up":
      return `<p:transition spd="med"><p:push dir="u"/></p:transition>`;
    default:
      return "";
  }
}

/**
 * Insert a transition into a slide part. ECMA-376 orders the children of
 * `<p:sld>` as cSld, clrMapOvr, transition, timing, extLst, so it goes right
 * after clrMapOvr (or cSld when there is no colour-map override). An existing
 * transition is replaced.
 */
export function insertTransition(slideXml: string, xml: string): string {
  const s = slideXml.replace(
    /<p:transition\b(?:[^>]*\/>|[\s\S]*?<\/p:transition>)/,
    "",
  );
  if (!xml) return s;
  for (const anchor of ["</p:clrMapOvr>", "</p:cSld>"]) {
    const i = s.indexOf(anchor);
    if (i >= 0) {
      const at = i + anchor.length;
      return s.slice(0, at) + xml + s.slice(at);
    }
  }
  return s;
}

// ------------------------------------------------------------ build

type Pptx = PptxGenJSType;
type PSlide = ReturnType<Pptx["addSlide"]>;

function linkOpt(el: SlideElement) {
  return el.url ? { hyperlink: { url: el.url } } : {};
}

function geomOpts(el: SlideElement) {
  return {
    x: pxToInch(el.x),
    y: pxToInch(el.y),
    w: pxToInch(el.w),
    h: pxToInch(Math.max(el.h, 1)),
    ...(el.rotation ? { rotate: el.rotation } : {}),
    ...(el.flipH ? { flipH: true } : {}),
    ...(el.flipV ? { flipV: true } : {}),
  };
}

function textRunOpts(el: SlideElement) {
  return {
    fontSize: pxToPt(el.fontSize || 18),
    fontFace: el.fontFamily || "Arial",
    bold: !!el.bold,
    italic: !!el.italic,
    ...(el.underline ? { underline: { style: "sng" as const } } : {}),
    ...(el.strike ? { strike: "sngStrike" as const } : {}),
    color: hex6(el.color),
  };
}

function addText(s: PSlide, el: SlideElement) {
  const lines = (el.text || "").split("\n");
  const bullet =
    el.list === "number"
      ? { type: "number" as const }
      : el.list === "bullet"
        ? true
        : undefined;
  const runs = lines.map((ln, i) => ({
    text: ln,
    options: {
      ...(bullet ? { bullet } : {}),
      ...(el.url ? { hyperlink: { url: el.url } } : {}),
      breakLine: i < lines.length - 1,
    },
  }));
  s.addText(runs, {
    ...geomOpts(el),
    ...textRunOpts(el),
    align: el.align || "left",
    valign:
      el.valign === "middle"
        ? "middle"
        : el.valign === "bottom"
          ? "bottom"
          : "top",
    ...(el.lineSpacing ? { lineSpacingMultiple: el.lineSpacing } : {}),
  });
}

function addShape(s: PSlide, el: SlideElement) {
  const noFill = !el.fill || el.fill === "none" || el.fill === "transparent";
  const line =
    el.stroke && el.stroke !== "none"
      ? { color: hex6(el.stroke), width: el.strokeWidth || 1 }
      : undefined;
  s.addShape(el.type as Parameters<PSlide["addShape"]>[0], {
    ...geomOpts(el),
    fill: noFill
      ? { type: "none" }
      : {
          color: hex6(el.fill),
          ...(transparencyOf(el.fill)
            ? { transparency: transparencyOf(el.fill) }
            : {}),
        },
    ...(line ? { line } : {}),
    ...(el.type === "roundRect"
      ? { rectRadius: pxToInch(Math.min(el.w, el.h) * ROUND_RECT_RATIO) }
      : {}),
    ...linkOpt(el),
  });
}

function addTable(s: PSlide, el: SlideElement) {
  const t = el.table;
  if (!t || !t.rows || !t.cols) return;
  const bcol = el.stroke && el.stroke !== "none" ? hex6(el.stroke) : undefined;
  const fill =
    el.fill && el.fill !== "none" ? { color: hex6(el.fill) } : undefined;
  const rows = t.cells.map((row) =>
    row.map((c) => ({
      text: c,
      options: {
        ...(fill ? { fill } : {}),
      },
    })),
  );
  s.addTable(rows, {
    x: pxToInch(el.x),
    y: pxToInch(el.y),
    w: pxToInch(el.w),
    colW: Array.from({ length: t.cols }, () => pxToInch(el.w / t.cols)),
    rowH: Array.from({ length: t.rows }, () => pxToInch(el.h / t.rows)),
    fontSize: pxToPt(el.fontSize || 16),
    fontFace: el.fontFamily || "Arial",
    color: hex6(el.color || "#202124"),
    valign: "top",
    ...(bcol
      ? { border: { type: "solid", pt: el.strokeWidth || 1, color: bcol } }
      : { border: { type: "none" } }),
  });
}

/**
 * Build the pptx package for a deck. Returns the raw zip bytes (post-processed
 * for transitions). pptxgenjs is loaded lazily so it stays in its own chunk.
 */
export async function deckToPptx(
  deck: DeckDoc,
  title = "Presentation",
): Promise<Uint8Array> {
  const mod = await import("pptxgenjs");
  const PptxGenJS = mod.default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "GROWN16x9",
    width: SLIDE_W_IN,
    height: SLIDE_H_IN,
  });
  pptx.layout = "GROWN16x9";
  pptx.title = title;
  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    s.background = { color: hex6(slide.background || "#ffffff") };
    for (const el of slide.elements) {
      try {
        if (el.type === "text") addText(s, el);
        else if (el.type === "table") addTable(s, el);
        else if (el.type === "line") {
          s.addShape("line", {
            ...geomOpts({ ...el, h: 0 }),
            h: 0,
            line: { color: hex6(el.stroke), width: el.strokeWidth || 2 },
            ...linkOpt(el),
          });
        } else if (el.type === "image") {
          if (!el.src) continue;
          const src = el.src.startsWith("data:")
            ? { data: el.src }
            : { path: el.src };
          s.addImage({ ...geomOpts(el), ...src, ...linkOpt(el) });
        } else addShape(s, el);
      } catch {
        /* skip an element pptxgenjs rejects rather than failing the export */
      }
    }
    if (slide.notes && slide.notes.trim()) s.addNotes(slide.notes);
  }
  const raw = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return patchPptx(raw, deck);
}

/** Apply the XML patches pptxgenjs cannot express (currently: transitions). */
export async function patchPptx(
  raw: Uint8Array,
  deck: DeckDoc,
): Promise<Uint8Array> {
  if (!deck.slides.some((s) => s.transition && s.transition !== "none"))
    return raw;
  const zip = await JSZip.loadAsync(raw);
  for (let i = 0; i < deck.slides.length; i++) {
    const xml = transitionXml(deck.slides[i].transition);
    if (!xml) continue;
    const path = `ppt/slides/slide${i + 1}.xml`;
    const f = zip.file(path);
    if (!f) continue;
    zip.file(path, insertTransition(await f.async("string"), xml));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
