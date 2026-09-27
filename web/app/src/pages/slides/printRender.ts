// Draws `PrintPage`s (printLayout.ts) as SVG: one renderer for the print
// preview, the print window (inline SVG, so the browser prints vectors)
// and the PDF file (each page rasterized, plus a text layer and links).

import { CANVAS_W, newElement, type Slide, type SlideElement } from "./model";
import { flattenGroups } from "./groupOps";
import { slideToSVG } from "./export";
import { canvasMeasure, layoutTextLines, lineText, type Measure } from "./svgText";
import { OUTLINE_BODY_PT, OUTLINE_LINE, OUTLINE_TITLE_PT, type Box, type OutlineEntry, type PrintOptions, type PrintPage } from "./printLayout";
import type { PdfPage, PdfText } from "./pdfWriter";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** prefixIds makes a standalone SVG's ids unique (several slides share a
 *  handout page): every id="x" and its url(#x) / href="#x" references. */
export function prefixIds(svg: string, prefix: string): string {
  const ids = new Set<string>();
  svg.replace(/\sid="([^"]+)"/g, (_, id: string) => {
    ids.add(id);
    return "";
  });
  if (!ids.size) return svg;
  return svg
    .replace(/\sid="([^"]+)"/g, (_m, id: string) => ` id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id: string) => (ids.has(id) ? `url(#${prefix}${id})` : m))
    .replace(/href="#([^"]+)"/g, (m, id: string) => (ids.has(id) ? `href="#${prefix}${id}"` : m));
}

/** A slide's standalone SVG placed into `box` of a page. */
export function placeSlide(svg: string, box: Box, prefix: string): string {
  return prefixIds(svg, prefix).replace(/^<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.w)}" height="${r2(box.h)}" preserveAspectRatio="none"`);
}

/** A pseudo text element in page points (reuses the slide text layout). */
function pageText(box: Box, text: string, size: number, over: Partial<SlideElement> = {}): SlideElement {
  return { ...newElement("text"), id: "p", x: box.x, y: box.y, w: box.w, h: box.h, text, fontSize: size, fontFamily: "Arial", color: "#202124", insets: { l: 0, t: 0, r: 0, b: 0 }, lineSpacing: 1.3, ...over };
}

/** The outline entries as one text element: bold numbered titles, indented body. */
export function outlineElement(entries: readonly OutlineEntry[], box: Box): SlideElement {
  const runs: { text: string; bold?: boolean; fontSize?: number }[] = [];
  const paras: { level?: number }[] = [];
  const add = (t: string, level: number, title: boolean) => {
    if (runs.length) runs.push({ text: "\n" });
    runs.push({ text: t, bold: title || undefined, fontSize: title ? OUTLINE_TITLE_PT : OUTLINE_BODY_PT });
    paras.push(level ? { level } : {});
  };
  for (const e of entries) {
    add(`${e.index + 1}   ${e.title || "(untitled)"}`, 0, true);
    for (const b of e.body) add(b.text, Math.min(8, b.level + 1), false);
  }
  const text = runs.map((r) => r.text).join("");
  // The run model keeps paragraph breaks inside runs; merge the "\n" runs.
  const merged: typeof runs = [];
  for (const r of runs) {
    if (r.text === "\n" && merged.length) merged[merged.length - 1] = { ...merged[merged.length - 1], text: merged[merged.length - 1].text + "\n" };
    else merged.push(r);
  }
  return pageText(box, text, OUTLINE_BODY_PT, { runs: merged, paras, lineSpacing: OUTLINE_LINE });
}

/** SVG <text> lines of a laid-out element (page coordinates). */
function linesSvg(el: SlideElement, measure: Measure, texts: PdfText[]): string {
  const lines = layoutTextLines(el, measure).filter((l) => l.y <= el.y + el.h + 2);
  return lines
    .map((l) => {
      texts.push({ x: l.segs[0]?.x ?? el.x, y: l.y, size: l.size, text: lineText(l) });
      const segs = l.segs
        .map((s, i) => `<tspan${i === 0 ? ` x="${r2(s.x)}"` : ""} font-size="${r2(s.size)}"${s.run.bold ? ' font-weight="bold"' : ""}>${esc(s.text)}</tspan>`)
        .join("");
      return `<text y="${r2(l.y)}">${segs}</text>`;
    })
    .join("");
}

export interface RenderedPage {
  svg: string;
  /** Text layer + links for the PDF (page points, top-left origin). */
  pdf: Pick<PdfPage, "texts" | "links">;
}

/**
 * renderPage draws one page. `slides` are the prepared slides (footers
 * applied, objects as pictures); `slideSvg` caches each slide's SVG.
 */
export function renderPage(page: PrintPage, slides: readonly Slide[], opts: Pick<PrintOptions, "grayscale">, slideSvg: (i: number) => string, measure: Measure = canvasMeasure): RenderedPage {
  const texts: PdfText[] = [];
  const links: { box: Box; url: string }[] = [];
  const parts: string[] = [`<rect width="${r2(page.w)}" height="${r2(page.h)}" fill="#fff"/>`];
  page.items.forEach((it, k) => {
    if (it.kind === "slide") {
      const slide = slides[it.index];
      parts.push(placeSlide(slideSvg(it.index), it.box, `p${k}-`));
      if (it.frame) parts.push(`<rect x="${r2(it.box.x)}" y="${r2(it.box.y)}" width="${r2(it.box.w)}" height="${r2(it.box.h)}" fill="none" stroke="#5f6368" stroke-width="0.75"/>`);
      // Text layer and links, scaled from slide units into the box.
      const s = it.box.w / CANVAS_W;
      for (const el of flattenGroups(slide.elements)) {
        const box = { x: it.box.x + el.x * s, y: it.box.y + el.y * s, w: el.w * s, h: el.h * s };
        if (el.url && /^(https?:|mailto:)/i.test(el.url)) links.push({ box, url: el.url });
        if (el.type !== "text" || !(el.text || "").trim()) continue;
        for (const l of layoutTextLines(el, measure)) {
          texts.push({ x: it.box.x + (l.segs[0]?.x ?? el.x) * s, y: it.box.y + l.y * s, size: l.size * s, text: lineText(l) });
          for (const sg of l.segs)
            if (sg.run.url && /^(https?:|mailto:)/i.test(sg.run.url))
              links.push({ box: { x: it.box.x + sg.x * s, y: it.box.y + (l.y - l.size) * s, w: sg.w * s, h: l.size * 1.2 * s }, url: sg.run.url });
        }
      }
    } else if (it.kind === "notes") {
      const notes = (slides[it.index].notes || "").trim();
      if (notes) parts.push(`<g font-family="Arial" fill="#202124">${linesSvg(pageText(it.box, notes, 12), measure, texts)}</g>`);
    } else if (it.kind === "lines") {
      const step = it.box.h / it.count;
      for (let i = 1; i <= it.count; i++) {
        const y = r2(it.box.y + i * step);
        parts.push(`<line x1="${r2(it.box.x)}" y1="${y}" x2="${r2(it.box.x + it.box.w)}" y2="${y}" stroke="#9aa0a6" stroke-width="0.5"/>`);
      }
    } else if (it.kind === "outline") {
      parts.push(`<g font-family="Arial" fill="#202124">${linesSvg(outlineElement(it.entries, it.box), measure, texts)}</g>`);
    } else if (it.kind === "label") {
      parts.push(`<g font-family="Arial" fill="#5f6368">${linesSvg(pageText(it.box, it.text, it.size, { align: it.align }), measure, texts)}</g>`);
    }
  });
  const body = opts.grayscale ? `<defs><filter id="gray"><feColorMatrix type="saturate" values="0"/></filter></defs><g filter="url(#gray)">${parts.join("")}</g>` : parts.join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r2(page.w)}pt" height="${r2(page.h)}pt" viewBox="0 0 ${r2(page.w)} ${r2(page.h)}">${body}</svg>`;
  return { svg, pdf: { texts, links } };
}

/** A slide-SVG cache over prepared slides. */
export function slideSvgCache(slides: readonly Slide[], measure: Measure = canvasMeasure): (i: number) => string {
  const cache = new Map<number, string>();
  return (i) => {
    let s = cache.get(i);
    if (s === undefined) {
      s = slideToSVG(slides[i], measure);
      cache.set(i, s);
    }
    return s;
  };
}

/** The print window's document: each page an inline SVG on its own sheet. */
export function printDocument(pages: readonly RenderedPage[], size: { w: number; h: number }, title: string): string {
  const w = r2(size.w);
  const h = r2(size.h);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:${w}pt ${h}pt;margin:0}html,body{margin:0;padding:0}.page{width:${w}pt;height:${h}pt;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.page>svg{display:block}
@media screen{body{background:#e8eaed}.page{margin:12px auto;box-shadow:0 1px 3px rgba(0,0,0,.3);background:#fff}}</style>
</head><body>${pages.map((p) => `<div class="page">${p.svg}</div>`).join("\n")}</body></html>`;
}

