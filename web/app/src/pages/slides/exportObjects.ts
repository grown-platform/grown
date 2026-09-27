// Picture stand-ins for the M11 objects in exports that have no notion of
// them (HTML/PDF, SVG/PNG/JPEG): a chart becomes an SVG picture of itself
// (drawn by the shared ChartRenderer), a clip its poster frame, and warped
// word art an SVG picture of the warp. pptx keeps the real objects.

import { createElement } from "react";
import { chartConfigOf, chartInputOf } from "./chartElement";
import type { DeckDoc, SlideElement } from "./model";
import { themeOf } from "./theme";
import { warpSvgMarkup } from "./wordArt";

function svgDataUrl(svg: string): string {
  const withNs = svg.startsWith("<svg") && !/^<svg[^>]*\sxmlns=/.test(svg) ? svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"') : svg;
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(withNs)));
}

const MEDIA_PLACEHOLDER = {
  video:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" preserveAspectRatio="none"><rect width="160" height="90" fill="#000"/><rect x="58" y="29" width="44" height="32" rx="8" fill="#444"/><path d="M74 37 L88 45 L74 53 Z" fill="#fff"/></svg>',
  audio:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="3" fill="#e8f0fe"/><path d="M5 10v4h3l4 4V6L8 10H5z M15.5 12A3.5 3.5 0 0 0 14 9v6a3.5 3.5 0 0 0 1.5-3z" fill="#1a73e8"/></svg>',
};

/** The picture a chart, clip or warp exports as (null: leave it alone). */
export async function objectPicture(el: SlideElement, deck: DeckDoc): Promise<SlideElement | null> {
  const base = { id: el.id, type: "image" as const, x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation, flipH: el.flipH, flipV: el.flipV, url: el.url, alt: el.alt };
  if (el.type === "chart" && el.chart) {
    const [{ renderToStaticMarkup }, { ChartRenderer }] = await Promise.all([import("react-dom/server"), import("../sheets/ChartRenderer")]);
    const svg = renderToStaticMarkup(
      createElement(ChartRenderer, {
        config: chartConfigOf(el.chart, themeOf(deck), el.id),
        input: chartInputOf(el.chart),
        width: Math.max(40, el.w),
        height: Math.max(30, el.h),
      }),
    );
    return { ...base, src: svgDataUrl(svg), crop: { l: 0, t: 0, r: 0, b: 0 } };
  }
  if (el.type === "media" && el.media) {
    const src = el.media.poster || svgDataUrl(MEDIA_PLACEHOLDER[el.media.kind]);
    return { ...base, src, crop: { l: 0, t: 0, r: 0, b: 0 } };
  }
  if (el.type === "text" && el.wordArt?.warp) {
    return { ...base, src: svgDataUrl(warpSvgMarkup(el, `wa-${el.id}`)), crop: { l: 0, t: 0, r: 0, b: 0 } };
  }
  return null;
}

/** The deck with every chart, clip and warp replaced by its picture. */
export async function objectsToPictures(deck: DeckDoc): Promise<DeckDoc> {
  const swap = async (els: SlideElement[]): Promise<SlideElement[]> =>
    Promise.all(
      els.map(async (e) => {
        if (e.children) return { ...e, children: await swap(e.children) };
        return (await objectPicture(e, deck)) ?? e;
      }),
    );
  const has = (els: SlideElement[]): boolean => els.some((e) => e.type === "chart" || e.type === "media" || !!e.wordArt?.warp || (e.children ? has(e.children) : false));
  if (!deck.slides.some((s) => has(s.elements))) return deck;
  return { ...deck, slides: await Promise.all(deck.slides.map(async (s) => ({ ...s, elements: await swap(s.elements) }))) };
}
