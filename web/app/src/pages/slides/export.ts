import {
  CANVAS_W,
  CANVAS_H,
  shapeClipPath,
  elementTransform,
  type DeckDoc,
  type Slide,
  type CellBorder,
  type SlideElement,
} from "./model";
import { flattenGroups } from "./groupOps";
import { shapeLayersMarkup, shapeSvgGroup } from "./shapeRender";
import { isRich, LINK_COLOR, textBodyHtml } from "./textLayout";
import { effective, insetsOf } from "./textOps";
import { resolveSlideLink } from "./links";
import { cropShapePath, fullImageRect, imageStretched } from "./imageOps";
import { inlineImages } from "./assets";
import { objectsToPictures } from "./exportObjects";
import { wordArtCssText, wordArtSvgAttrs } from "./wordArt";
import { canvasMeasure, layoutTextLines, type Measure } from "./svgText";
import { backgroundCss } from "./slideProps";
import { withFooters } from "./layouts";
import { CELL_PAD, cellFormat, cellTextEl, colWidths, isCovered, offsets, rowHeights, spanOf } from "./tableOps";

export type DeckFormat =
  | "pptx"
  | "odp"
  | "pdf"
  | "txt"
  | "html"
  | "jpg"
  | "png"
  | "svg"
  | "png-zip"
  | "jpg-zip"
  | "svg-zip";

// Mirrors Google Slides' File → Download menu. jpg/png/svg export the current
// slide (like Google); the -zip variants every slide; pptx/odp/pdf/txt/html
// cover the whole deck. The PDF is built in the browser (pdfWriter.ts);
// File ▸ Print offers handouts, notes pages and the outline.
export const DECK_DOWNLOAD_FORMATS: { fmt: DeckFormat; label: string }[] = [
  { fmt: "pptx", label: "Microsoft PowerPoint (.pptx)" },
  { fmt: "odp", label: "ODP Document (.odp)" },
  { fmt: "pdf", label: "PDF Document (.pdf)" },
  { fmt: "txt", label: "Plain Text (.txt)" },
  { fmt: "html", label: "Web Page (.html)" },
  { fmt: "jpg", label: "JPEG image (.jpg, current slide)" },
  { fmt: "png", label: "PNG image (.png, current slide)" },
  { fmt: "svg", label: "Scalable Vector Graphics (.svg, current slide)" },
  { fmt: "png-zip", label: "PNG images, all slides (.zip)" },
  { fmt: "jpg-zip", label: "JPEG images, all slides (.zip)" },
  { fmt: "svg-zip", label: "SVG images, all slides (.zip)" },
];

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Serialize one element to an absolutely-positioned HTML string (for print/HTML export).
function elementHTML(el: SlideElement, slideHref?: (url: string) => string | null): string {
  const tf = elementTransform(el);
  const xform = tf ? `transform:${tf};transform-origin:center;` : "";
  const box = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;${xform}`;
  if (el.type === "text") {
    const ins = insetsOf(el);
    const style =
      box +
      `font-size:${el.fontSize}px;font-family:${el.fontFamily || "Arial"};color:${el.color || "#000"};` +
      `font-weight:${el.bold ? 700 : 400};font-style:${el.italic ? "italic" : "normal"};` +
      `text-decoration:${isRich(el) ? "none" : [el.underline ? "underline" : "", el.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none"};text-align:${el.align || "left"};` +
      `display:flex;flex-direction:column;justify-content:${el.valign === "middle" ? "center" : el.valign === "bottom" ? "flex-end" : "flex-start"};` +
      `white-space:pre-wrap;word-break:break-word;line-height:${el.lineSpacing || 1.2};padding:${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px;overflow:hidden;box-sizing:border-box;` +
      (el.rtl ? "direction:rtl;" : "") +
      (el.vert ? "writing-mode:vertical-rl;" : "");
    const body = isRich(el)
      ? textBodyHtml(el, (url) => {
          const i = slideHref ? slideHref(url) : null;
          return i ?? (url.startsWith("#") ? null : url);
        })
      : esc(el.text || "").replace(/\n/g, "<br/>");
    const art = el.wordArt ? `<div style="width:100%;${wordArtCssText(el.wordArt).replace(/"/g, "&quot;")}">${body}</div>` : body;
    return `<div style="${style}">${el.vert === "vert270" ? `<div style="transform:rotate(180deg)">${art}</div>` : art}</div>`;
  }
  const bd =
    el.stroke && el.stroke !== "none"
      ? `border:${el.strokeWidth}px solid ${el.stroke};`
      : "";
  if (el.type === "rect")
    return `<div style="${box}background:${el.fill};${bd}box-sizing:border-box;"></div>`;
  if (el.type === "roundRect")
    return `<div style="${box}background:${el.fill};border-radius:${Math.min(el.w, el.h) * 0.18}px;${bd}box-sizing:border-box;"></div>`;
  if (el.type === "ellipse")
    return `<div style="${box}background:${el.fill};border-radius:50%;${bd}box-sizing:border-box;"></div>`;
  if (
    el.type === "triangle" ||
    el.type === "diamond" ||
    el.type === "rightArrow"
  ) {
    const clip = shapeClipPath(el.type);
    const sh =
      el.stroke && el.stroke !== "none"
        ? `filter:drop-shadow(0 0 ${el.strokeWidth || 1}px ${el.stroke});`
        : "";
    return `<div style="${box}background:${el.fill};clip-path:${clip};${sh}"></div>`;
  }
  if (el.type === "line")
    return `<div style="position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${Math.max(el.strokeWidth || 2, 1)}px;background:${el.stroke};"></div>`;
  if (el.type === "shape" || el.type === "connector")
    return `<svg style="${box}overflow:visible;" width="${Math.max(el.w, 1)}" height="${Math.max(el.h, 1)}">${shapeLayersMarkup(el)}</svg>`;
  if (el.type === "image")
    return el.src ? imageHTML(el, box) : `<div style="${box}background:#f1f3f4;"></div>`;
  if (el.type === "table" && el.table) return tableHTML(el, box, slideHref);
  return "";
}

/** A picture as HTML: crop, crop to shape, opacity, border and shadow. */
function imageHTML(el: SlideElement, box: string): string {
  const clip = cropShapePath(el);
  const f = fullImageRect(el);
  const img = imageStretched(el)
    ? `position:absolute;left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;max-width:none;`
    : `width:100%;height:100%;object-fit:contain;display:block;`;
  const outer =
    box +
    (el.opacity !== undefined ? `opacity:${el.opacity};` : "") +
    (el.shadow ? `filter:drop-shadow(3px 3px 4px rgba(0,0,0,0.45));` : "");
  const stroked = !!el.stroke && el.stroke !== "none" && (el.strokeWidth ?? 0) > 0;
  const border = stroked
    ? `<svg width="${el.w}" height="${el.h}" style="position:absolute;left:0;top:0;overflow:visible">${
        clip
          ? `<path d="${clip}" fill="none" stroke="${el.stroke}" stroke-width="${el.strokeWidth}"/>`
          : `<rect x="0" y="0" width="${el.w}" height="${el.h}" fill="none" stroke="${el.stroke}" stroke-width="${el.strokeWidth}"/>`
      }</svg>`
    : "";
  return `<div style="${outer}"><div style="position:absolute;inset:0;overflow:hidden;${clip ? `clip-path:path('${clip}');` : ""}"><img src="${el.src}" alt="${esc(el.alt ?? "")}" style="${img}"/></div>${border}</div>`;
}

/** A picture as SVG (nested viewport = the box; clip path = crop shape). */
function imageSVG(el: SlideElement): string {
  const clip = cropShapePath(el);
  const f = fullImageRect(el);
  const id = `clip-${el.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const image = imageStretched(el)
    ? `<image href="${el.src}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" preserveAspectRatio="none"/>`
    : `<image href="${el.src}" x="0" y="0" width="${el.w}" height="${el.h}" preserveAspectRatio="xMidYMid meet"/>`;
  const stroked = !!el.stroke && el.stroke !== "none" && (el.strokeWidth ?? 0) > 0;
  const border = stroked
    ? clip
      ? `<path d="${clip}" fill="none" stroke="${el.stroke}" stroke-width="${el.strokeWidth}"/>`
      : `<rect x="0" y="0" width="${el.w}" height="${el.h}" fill="none" stroke="${el.stroke}" stroke-width="${el.strokeWidth}"/>`
    : "";
  return (
    `<svg x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}"${el.opacity !== undefined ? ` opacity="${el.opacity}"` : ""}>` +
    (clip ? `<defs><clipPath id="${id}"><path d="${clip}"/></clipPath></defs><g clip-path="url(#${id})">${image}</g>` : image) +
    border +
    `</svg>`
  );
}

/** A table as HTML: widths, heights, merges, fills, borders, rich cells. */
function tableHTML(el: SlideElement, box: string, slideHref?: (url: string) => string | null): string {
  const t = el.table!;
  const cols = colWidths(el)
    .map((w) => `<col style="width:${w}px"/>`)
    .join("");
  const hs = rowHeights(el);
  const bcss = (b?: CellBorder) => (b ? `${b.width}px ${!b.dash || b.dash === "solid" ? "solid" : b.dash === "sysDot" ? "dotted" : "dashed"} ${b.color}` : "none");
  const rows = t.cells
    .map((row, r) => {
      const tds = row
        .map((_, c) => {
          if (isCovered(t, r, c)) return "";
          const { rs, cs } = spanOf(t, r, c);
          const f = cellFormat(el, r, c);
          const te = cellTextEl(el, r, c);
          const span = `${rs > 1 ? ` rowspan="${rs}"` : ""}${cs > 1 ? ` colspan="${cs}"` : ""}`;
          const va = te.valign === "middle" ? "middle" : te.valign === "bottom" ? "bottom" : "top";
          const td =
            `border-top:${bcss(f.borders.t)};border-right:${bcss(f.borders.r)};border-bottom:${bcss(f.borders.b)};border-left:${bcss(f.borders.l)};` +
            `padding:${CELL_PAD}px;vertical-align:${va};overflow:hidden;` +
            (f.fill ? `background:${f.fill};` : "") +
            `font-size:${te.fontSize}px;font-family:${te.fontFamily};color:${te.color};font-weight:${te.bold ? 700 : 400};font-style:${te.italic ? "italic" : "normal"};text-align:${te.align || "left"};white-space:pre-wrap;word-break:break-word;line-height:${te.lineSpacing || 1.2};`;
          const body = isRich(te) || te.underline || te.strike
            ? textBodyHtml({ ...te, runs: te.runs ?? [{ text: te.text || "" }] }, (url) => {
                const i = slideHref ? slideHref(url) : null;
                return i ?? (url.startsWith("#") ? null : url);
              })
            : esc(te.text || "").replace(/\n/g, "<br/>");
          return `<td${span} style="${td}">${body}</td>`;
        })
        .join("");
      return `<tr style="height:${hs[r]}px">${tds}</tr>`;
    })
    .join("");
  return `<table style="${box}border-collapse:collapse;table-layout:fixed;"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}

/** A table as SVG: cell fills, border lines and cell text. */
function tableSVG(el: SlideElement, measure: Measure): string {
  const t = el.table!;
  const xs = offsets(colWidths(el));
  const ys = offsets(rowHeights(el));
  const fills: string[] = [];
  const lines: string[] = [];
  const texts: string[] = [];
  for (let r = 0; r < t.rows; r++)
    for (let c = 0; c < t.cols; c++) {
      if (isCovered(t, r, c)) continue;
      const { rs, cs } = spanOf(t, r, c);
      const x0 = el.x + xs[c];
      const x1 = el.x + xs[c + cs];
      const y0 = el.y + ys[r];
      const y1 = el.y + ys[r + rs];
      const f = cellFormat(el, r, c);
      if (f.fill) fills.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${f.fill}"/>`);
      const seg = (b: CellBorder | undefined, a: [number, number], z: [number, number]) => {
        if (b) lines.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${z[0]}" y2="${z[1]}" stroke="${b.color}" stroke-width="${b.width}"/>`);
      };
      seg(f.borders.t, [x0, y0], [x1, y0]);
      seg(f.borders.b, [x0, y1], [x1, y1]);
      seg(f.borders.l, [x0, y0], [x0, y1]);
      seg(f.borders.r, [x1, y0], [x1, y1]);
      const te = cellTextEl(el, r, c);
      if (te.text) texts.push(textSVG({ ...te, x: x0 + CELL_PAD, y: y0 + CELL_PAD, w: x1 - x0 - 2 * CELL_PAD, h: y1 - y0 - 2 * CELL_PAD, insets: { l: 0, t: 0, r: 0, b: 0 } }, measure));
    }
  return fills.join("") + lines.join("") + texts.join("");
}

export function slideHTML(slide: Slide, idx: number, slides: readonly Slide[]): string {
  // Slide links jump to the slide's anchor in the exported page.
  const slideHref = (url: string) => {
    const i = resolveSlideLink(url, slides, idx);
    return i === null ? null : `#slide-${i + 1}`;
  };
  const inner = flattenGroups(slide.elements)
    .map((e) => elementHTML(e, slideHref))
    .join("");
  const bg = backgroundCss(slide).replace(/"/g, "&quot;");
  return `<div class="slide" id="slide-${idx + 1}" style="position:relative;width:${CANVAS_W}px;height:${CANVAS_H}px;background:${bg};overflow:hidden;">${inner}</div>`;
}

function fullHTML(deck: DeckDoc, title: string): string {
  const slides = deck.slides.map((_, i) => slideHTML(withFooters(deck, i), i, deck.slides)).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:${CANVAS_W}px ${CANVAS_H}px;margin:0}body{margin:0}.slide{page-break-after:always}</style>
</head><body>${slides}</body></html>`;
}


// Fractional (0..1) polygon points for clip-path shapes, kept in sync with
// shapeClipPath() in model.ts. Used for SVG/pptx polygon rendering.
function clipPathPoints(type: SlideElement["type"]): [number, number][] {
  switch (type) {
    case "triangle":
      return [
        [0.5, 0],
        [1, 1],
        [0, 1],
      ];
    case "diamond":
      return [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ];
    case "rightArrow":
      return [
        [0, 0.3],
        [0.6, 0.3],
        [0.6, 0],
        [1, 0.5],
        [0.6, 1],
        [0.6, 0.7],
        [0, 0.7],
      ];
    default:
      return [];
  }
}

/** A text element as SVG <text>: one <text> per visual line, wrapped at the
 *  box width like the HTML renderer (see svgText.ts). */
export function textSVG(el: SlideElement, measure: Measure = canvasMeasure): string {
  const lines = layoutTextLines(el, measure);
  // Word art (M11): gradient fill, outline and shadow/glow on the whole text.
  const art = wordArtSvgAttrs(el, `wa-${el.id}`);
  const gradient = !!art.defs;
  const body = lines
    .map((ln) => {
      const mark = ln.marker
        ? `<tspan x="${r2(ln.marker.x)}" font-size="${ln.marker.size}"${gradient ? "" : ` fill="${esc(ln.marker.color || el.color || "#000")}"`}>${esc(ln.marker.text)}</tspan>`
        : "";
      const segs = ln.segs
        .map((sg, i) => {
          const r = sg.run;
          const deco = [effective(el, r, "underline") || r.url ? "underline" : "", effective(el, r, "strike") ? "line-through" : ""]
            .filter(Boolean)
            .join(" ");
          const bl = effective(el, r, "baseline");
          const fam = effective(el, r, "fontFamily") as string | undefined;
          const fill = gradient ? "" : ` fill="${esc(r.color ?? (r.url ? LINK_COLOR : el.color) ?? "#000")}"`;
          return `<tspan${i === 0 || ln.marker ? ` x="${r2(sg.x)}"` : ""} font-size="${r2(sg.size)}"${fam ? ` font-family="${esc(fam)}"` : ""}${fill} font-weight="${effective(el, r, "bold") ? "bold" : "normal"}" font-style="${effective(el, r, "italic") ? "italic" : "normal"}"${deco ? ` text-decoration="${deco}"` : ""}${bl ? ` baseline-shift="${bl}"` : ""}>${esc(sg.text)}</tspan>`;
        })
        .join("");
      return `<text y="${r2(ln.y)}">${mark}${segs}</text>`;
    })
    .join("");
  const fillAttr = art.attrs.includes(' fill="') ? "" : ` fill="${esc(el.color || "#000")}"`;
  return (
    (art.defs ? `<defs>${art.defs}</defs>` : "") +
    `<g font-family="${esc(el.fontFamily || "Arial")}" font-size="${el.fontSize || 18}"${fillAttr}${art.attrs} xml:space="preserve">${body}</g>`
  );
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The rotate/flip transform of a box element about its centre (SVG). */
function boxTransform(el: SlideElement): string {
  if (!el.rotation && !el.flipH && !el.flipV) return "";
  const cx = r2(el.x + el.w / 2);
  const cy = r2(el.y + el.h / 2);
  const parts = [`translate(${cx} ${cy})`];
  if (el.rotation) parts.push(`rotate(${el.rotation})`);
  if (el.flipH || el.flipV) parts.push(`scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1})`);
  parts.push(`translate(${-cx} ${-cy})`);
  return parts.join(" ");
}

/** SVG for a gradient/picture background (M7), drawn over the colour. */
export function backgroundSVG(slide: Pick<Slide, "bgFill">): string {
  const f = slide.bgFill;
  if (!f) return "";
  if (f.kind === "image")
    return `<image x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="xMidYMid slice" href="${esc(f.src)}"/>`;
  const stops = f.stops.map((s) => `<stop offset="${s.pos}" stop-color="${esc(s.color)}"/>`).join("");
  let grad: string;
  if (f.radial) grad = `<radialGradient id="slide-bg">${stops}</radialGradient>`;
  else {
    const a = ((f.angle ?? 90) * Math.PI) / 180;
    const dx = Math.cos(a) / 2;
    const dy = Math.sin(a) / 2;
    const n = (v: number) => Math.round(v * 1000) / 1000;
    grad = `<linearGradient id="slide-bg" x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}">${stops}</linearGradient>`;
  }
  return `<defs>${grad}</defs><rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#slide-bg)"/>`;
}

// Render one slide to a standalone SVG string (matches the canvas model).
export function slideToSVG(slide: Slide, measure: Measure = canvasMeasure): string {
  const parts: string[] = [
    `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="${slide.background || "#ffffff"}"/>`,
    backgroundSVG(slide),
  ];
  for (const el of flattenGroups(slide.elements)) {
    const before = parts.length;
    const strokeAttr =
      el.stroke && el.stroke !== "none"
        ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth || 1}"`
        : "";
    if (el.type === "rect") {
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${el.fill || "none"}"${strokeAttr}/>`,
      );
    } else if (el.type === "roundRect") {
      const r = Math.min(el.w, el.h) * 0.18;
      parts.push(
        `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${r}" ry="${r}" fill="${el.fill || "none"}"${strokeAttr}/>`,
      );
    } else if (
      el.type === "triangle" ||
      el.type === "diamond" ||
      el.type === "rightArrow"
    ) {
      // Map the CSS clip-path percentages to absolute SVG points.
      const pts = clipPathPoints(el.type)
        .map(([px, py]) => `${el.x + px * el.w},${el.y + py * el.h}`)
        .join(" ");
      parts.push(
        `<polygon points="${pts}" fill="${el.fill || "none"}"${strokeAttr}/>`,
      );
    } else if (el.type === "ellipse") {
      parts.push(
        `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${el.w / 2}" ry="${el.h / 2}" fill="${el.fill || "none"}"${el.stroke && el.stroke !== "none" ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth || 1}"` : ""}/>`,
      );
    } else if (el.type === "line") {
      parts.push(
        `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.w}" y2="${el.y}" stroke="${el.stroke || "#000"}" stroke-width="${el.strokeWidth || 2}"/>`,
      );
    } else if (el.type === "shape" || el.type === "connector") {
      parts.push(shapeSvgGroup(el));
    } else if (el.type === "image" && el.src) {
      parts.push(imageSVG(el));
    } else if (el.type === "text") {
      parts.push(textSVG(el, measure));
    } else if (el.type === "table" && el.table) {
      parts.push(tableSVG(el, measure));
    }
    // Rotation/flip of everything but presets (those carry their own).
    const tf = el.type === "shape" || el.type === "connector" ? "" : boxTransform(el);
    if (tf && parts.length > before) parts.splice(before, parts.length - before, `<g transform="${tf}">${parts.slice(before).join("")}</g>`);
    // Alt text as an SVG title (screen readers, tooltips).
    if (el.alt && parts.length > before) parts.splice(before, parts.length - before, `<g><title>${esc(el.alt)}</title>${parts.slice(before).join("")}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">${parts.join("")}</svg>`;
}

/** Pixels per logical unit of the PNG/JPEG exports (1920 px wide). */
export const IMAGE_SCALE = 2;

// Rasterize an SVG string to a PNG/JPEG blob via an offscreen canvas.
export function svgToImage(
  svg: string,
  type: "image/png" | "image/jpeg",
  size: { w: number; h: number } = { w: CANVAS_W * IMAGE_SCALE, h: CANVAS_H * IMAGE_SCALE },
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url =
      "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(size.w);
      canvas.height = Math.round(size.h);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("no 2d context"));
        return;
      }
      ctx.fillStyle = "#fff";
      if (type === "image/jpeg") ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        type,
        quality,
      );
    };
    img.onerror = () => reject(new Error("SVG render failed"));
    img.src = url;
  });
}

/** safeName makes a deck title usable as a file name. */
export function safeName(title: string): string {
  return (title || "presentation").replace(/[/\\?%*:|"<>]/g, "-");
}

/**
 * prepareDeck turns a deck into what the picture-based exports draw:
 * charts, clips and warps as pictures, the asset pictures inlined (an SVG
 * drawn to a canvas can't fetch), and header/footer placeholders applied.
 */
export async function prepareDeck(deck: DeckDoc): Promise<DeckDoc> {
  const d = await inlineImages(await objectsToPictures(deck));
  return { ...d, slides: d.slides.map((_, i) => withFooters(d, i)) };
}

/** A zip of every slide as PNG/JPEG/SVG (slide-01.png, …). */
async function imagesZip(deck: DeckDoc, kind: "png" | "jpg" | "svg"): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const pad = String(deck.slides.length).length;
  for (let i = 0; i < deck.slides.length; i++) {
    const svg = slideToSVG(deck.slides[i]);
    const name = `slide-${String(i + 1).padStart(Math.max(2, pad), "0")}.${kind}`;
    if (kind === "svg") zip.file(name, svg);
    else zip.file(name, await svgToImage(svg, kind === "png" ? "image/png" : "image/jpeg"));
  }
  return zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

/**
 * downloadDeck exports the presentation. pptx is built by pptx/write.ts, odp
 * by odp/write.ts, the PDF by pdfExport.ts; the rest are written here.
 */
export async function downloadDeck(
  deck: DeckDoc,
  title: string,
  fmt: DeckFormat,
  slideIndex = 0,
): Promise<void> {
  const name = safeName(title);
  if (fmt === "pdf") {
    const { deckToPdf } = await import("./pdfExport");
    const bytes = await deckToPdf(deck, title, { layout: "slides", includeHidden: true });
    triggerDownload(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${name}.pdf`);
    return;
  }
  // Charts, clips and warped word art export as pictures (not to pptx).
  if (fmt !== "pptx" && fmt !== "txt") deck = await objectsToPictures(deck);
  // Files that leave the browser carry their pictures inline.
  if (fmt !== "txt") deck = await inlineImages(deck);

  if (fmt === "png-zip" || fmt === "jpg-zip" || fmt === "svg-zip") {
    const withHF = { ...deck, slides: deck.slides.map((_, i) => withFooters(deck, i)) };
    triggerDownload(await imagesZip(withHF, fmt.slice(0, 3) as "png" | "jpg" | "svg"), `${name}.zip`);
    return;
  }

  // Current-slide image exports (Google parity: jpg/png/svg).
  if (fmt === "svg" || fmt === "png" || fmt === "jpg") {
    const slide = withFooters(deck, Math.max(0, Math.min(slideIndex, deck.slides.length - 1)));
    const svg = slideToSVG(slide);
    if (fmt === "svg") {
      triggerDownload(
        new Blob([svg], { type: "image/svg+xml" }),
        `${name}.svg`,
      );
      return;
    }
    const blob = await svgToImage(
      svg,
      fmt === "png" ? "image/png" : "image/jpeg",
    );
    triggerDownload(blob, `${name}.${fmt}`);
    return;
  }

  if (fmt === "txt") {
    const text = deck.slides
      .map((s, i) => {
        const body = flattenGroups(s.elements)
          .filter((e) => e.type === "text" && e.text)
          .map((e) => (e.text || "").replace(/\v/g, "\n"))
          .join("\n");
        const notes =
          s.notes && s.notes.trim()
            ? `\n\n[Speaker notes]\n${s.notes.trim()}`
            : "";
        return `--- Slide ${i + 1} ---\n${body}${notes}`;
      })
      .join("\n\n");
    triggerDownload(new Blob([text], { type: "text/plain" }), `${name}.txt`);
    return;
  }

  if (fmt === "html") {
    triggerDownload(
      new Blob([fullHTML(deck, name)], { type: "text/html" }),
      `${name}.html`,
    );
    return;
  }

  if (fmt === "odp") {
    const { deckToOdp } = await import("./odp/write");
    const bytes = await deckToOdp(deck, title || "Presentation");
    triggerDownload(new Blob([bytes as BlobPart], { type: "application/vnd.oasis.opendocument.presentation" }), `${name}.odp`);
    return;
  }

  // pptx — pptxgenjs package, post-processed for what it can't express
  // (see pptx/write.ts).
  const { deckToPptx } = await import("./pptx/write");
  const bytes = await deckToPptx(deck, title || "Presentation");
  triggerDownload(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
    `${name}.pptx`,
  );
}

export { triggerDownload };
