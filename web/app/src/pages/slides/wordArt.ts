// Word art (M11): text effects on a text box — outline, gradient fill,
// shadow and glow — as CSS, plus the text-warp presets that an SVG textPath
// can draw (flagged exception F5: only a cheap subset of PowerPoint's 40
// `text*` warps; the text follows one path as a single line).
//
// Effects apply to the whole box. The pptx mapping lives in pptx/textXml.ts
// (run `a:ln`, `a:gradFill`, `a:effectLst`; `a:bodyPr/a:prstTxWarp`).

import type { SlideElement, TextWarp, WordArt } from "./model";

/** Warp presets offered (pptx `a:prstTxWarp@prst`). */
export const TEXT_WARPS: { value: TextWarp; label: string }[] = [
  { value: "textArchUp", label: "Arch up" },
  { value: "textArchDown", label: "Arch down" },
  { value: "textCircle", label: "Circle" },
  { value: "textWave1", label: "Wave" },
  { value: "textSlantUp", label: "Slant up" },
  { value: "textSlantDown", label: "Slant down" },
];

export function isTextWarp(v: string | null | undefined): v is TextWarp {
  return TEXT_WARPS.some((w) => w.value === v);
}

/** Ready-made styles (Insert ▸ Word art and the gallery). */
export const WORD_ART_STYLES: { id: string; label: string; art: WordArt; color: string }[] = [
  { id: "fill-outline", label: "Fill with outline", color: "#4285f4", art: { outline: { color: "#1a3d7c", width: 1.5 } } },
  {
    id: "gradient",
    label: "Gradient",
    color: "#f4511e",
    art: { gradient: { from: "#f4511e", to: "#8e24aa", angle: 0 }, shadow: { color: "#00000059", blur: 4, dist: 3, dir: 45 } },
  },
  { id: "glow", label: "Glow", color: "#ffffff", art: { glow: { color: "#4285f4", radius: 8 }, outline: { color: "#1a73e8", width: 1 } } },
  { id: "shadow", label: "Shadow", color: "#202124", art: { shadow: { color: "#00000080", blur: 6, dist: 4, dir: 45 } } },
  {
    id: "arch",
    label: "Arch",
    color: "#0b8043",
    art: { warp: "textArchUp", gradient: { from: "#0b8043", to: "#33b679", angle: 90 }, outline: { color: "#0a5c31", width: 1 } },
  },
];

/** A new word-art text box: large bold text with a style applied. */
export function newWordArt(styleId = "gradient", text = "Your text here"): Partial<SlideElement> {
  const s = WORD_ART_STYLES.find((x) => x.id === styleId) ?? WORD_ART_STYLES[0];
  return {
    text,
    fontSize: 54,
    bold: true,
    color: s.color,
    align: "center",
    valign: "middle",
    fontFamily: "Arial",
    wordArt: structuredCloneArt(s.art),
    w: 640,
    h: s.art.warp ? 220 : 120,
    x: 160,
    y: s.art.warp ? 160 : 210,
  };
}

function structuredCloneArt(a: WordArt): WordArt {
  return JSON.parse(JSON.stringify(a)) as WordArt;
}

/** Set (or with `undefined`, clear) one word-art property; the object
 *  disappears when nothing is left. */
export function setWordArt<K extends keyof WordArt>(el: SlideElement, key: K, value: WordArt[K] | undefined): SlideElement {
  const art: WordArt = { ...el.wordArt };
  if (value === undefined || value === null) delete art[key];
  else art[key] = value;
  const out = { ...el };
  if (Object.keys(art).length) out.wordArt = art;
  else delete out.wordArt;
  return out;
}

export function hasWordArt(el: Pick<SlideElement, "wordArt">): boolean {
  return !!el.wordArt && Object.keys(el.wordArt).length > 0;
}

/** Shadow offset (px) from a DrawingML distance + direction (0° = right, 90° = down). */
export function shadowOffset(dist: number, dirDeg: number): { dx: number; dy: number } {
  const a = (dirDeg * Math.PI) / 180;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { dx: r(dist * Math.cos(a)), dy: r(dist * Math.sin(a)) };
}

/** CSS `filter` drop shadows for the shadow and glow (they follow the glyphs
 *  and, unlike text-shadow, sit behind a gradient-clipped fill). */
export function wordArtFilter(art: WordArt | undefined): string | undefined {
  if (!art) return undefined;
  const parts: string[] = [];
  if (art.glow && art.glow.radius > 0) {
    const r = Math.max(1, art.glow.radius / 2);
    parts.push(`drop-shadow(0 0 ${r}px ${art.glow.color})`, `drop-shadow(0 0 ${r}px ${art.glow.color})`);
  }
  if (art.shadow) {
    const { dx, dy } = shadowOffset(art.shadow.dist, art.shadow.dir);
    parts.push(`drop-shadow(${dx}px ${dy}px ${Math.max(0, art.shadow.blur)}px ${art.shadow.color})`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

/** CSS linear-gradient for a DrawingML `lin@ang` (0° = left→right,
 *  clockwise), which is CSS's angle minus 90°. */
export function gradientCss(g: NonNullable<WordArt["gradient"]>): string {
  return `linear-gradient(${(((g.angle + 90) % 360) + 360) % 360}deg, ${g.from}, ${g.to})`;
}

/** The CSS a text box's body gets for its (unwarped) word art. */
export function wordArtCss(art: WordArt | undefined): Record<string, string | undefined> {
  if (!art) return {};
  const css: Record<string, string | undefined> = {};
  if (art.outline && art.outline.width > 0) {
    css.WebkitTextStroke = `${art.outline.width}px ${art.outline.color}`;
    css.paintOrder = "stroke fill";
  }
  if (art.gradient) {
    css.backgroundImage = gradientCss(art.gradient);
    css.WebkitBackgroundClip = "text";
    css.backgroundClip = "text";
    css.WebkitTextFillColor = "transparent";
  }
  const f = wordArtFilter(art);
  if (f) css.filter = f;
  return css;
}

/** The same as a CSS declaration string (the HTML export). */
export function wordArtCssText(art: WordArt | undefined): string {
  return Object.entries(wordArtCss(art))
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(";");
}

/** How far the ends of an arch warp lean in from horizontal (radians). */
const ARCH_END = (25 * Math.PI) / 180;

export interface WarpPath {
  /** SVG path data in the box's coordinates. */
  d: string;
  /** Approximate path length (for textLength). */
  length: number;
}

function polyLength(pts: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

const f2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The baseline path of a warp preset inside a w×h box for text of size fs.
 * Arches are half ellipses (the text rides the outside of the arch up, the
 * inside of the arch down); the circle starts on the left and runs
 * clockwise; the wave is one sine period; slants are the box diagonals.
 */
export function warpPath(warp: TextWarp, w: number, h: number, fs: number): WarpPath {
  const pad = Math.min(fs * 0.3, w * 0.05);
  const sample = (fn: (t: number) => [number, number], n = 64) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
  };
  switch (warp) {
    case "textArchUp": {
      // An elliptical arc whose ends lean in by ARCH_END (not a full half
      // ellipse, so the end glyphs don't turn sideways and leave the box).
      const t = fs * 0.95;
      const b = fs * 0.35;
      const m = Math.min(fs * 0.6, w * 0.2);
      const rx = Math.max(1, (w / 2 - m) / Math.cos(ARCH_END));
      const ry = Math.max(1, (h - b - t) / (1 - Math.sin(ARCH_END)));
      const cy = t + ry;
      const pt = (phi: number): [number, number] => [w / 2 + rx * Math.cos(phi), cy - ry * Math.sin(phi)];
      const [x0, y0] = pt(Math.PI - ARCH_END);
      const [x1, y1] = pt(ARCH_END);
      const pts = sample((u) => pt(Math.PI - ARCH_END - u * (Math.PI - 2 * ARCH_END)));
      return { d: `M${f2(x0)},${f2(y0)} A${f2(rx)},${f2(ry)} 0 0 1 ${f2(x1)},${f2(y1)}`, length: polyLength(pts) };
    }
    case "textArchDown": {
      const t = fs * 0.95;
      const b = fs * 0.3;
      const m = Math.min(fs * 0.6, w * 0.2);
      const rx = Math.max(1, (w / 2 - m) / Math.cos(ARCH_END));
      const ry = Math.max(1, (h - b - t) / (1 - Math.sin(ARCH_END)));
      const cy = h - b - ry;
      const pt = (phi: number): [number, number] => [w / 2 + rx * Math.cos(phi), cy + ry * Math.sin(phi)];
      const [x0, y0] = pt(Math.PI - ARCH_END);
      const [x1, y1] = pt(ARCH_END);
      const pts = sample((u) => pt(Math.PI - ARCH_END - u * (Math.PI - 2 * ARCH_END)));
      return { d: `M${f2(x0)},${f2(y0)} A${f2(rx)},${f2(ry)} 0 0 0 ${f2(x1)},${f2(y1)}`, length: polyLength(pts) };
    }
    case "textCircle": {
      const rx = Math.max(1, w / 2 - fs);
      const ry = Math.max(1, h / 2 - fs);
      const cx = w / 2;
      const cy = h / 2;
      const pts = sample((t) => [cx - rx * Math.cos(2 * Math.PI * t), cy - ry * Math.sin(2 * Math.PI * t)], 128);
      return {
        d: `M${f2(cx - rx)},${f2(cy)} A${f2(rx)},${f2(ry)} 0 1 1 ${f2(cx + rx)},${f2(cy)} A${f2(rx)},${f2(ry)} 0 1 1 ${f2(cx - rx)},${f2(cy)}`,
        length: polyLength(pts),
      };
    }
    case "textWave1": {
      const a = Math.max(0, (h - fs * 1.2) / 2);
      const mid = h / 2 + fs * 0.35;
      const x0 = pad;
      const x1 = w - pad;
      const pts = sample((t) => [x0 + (x1 - x0) * t, mid - a * Math.sin(2 * Math.PI * t)]);
      return { d: "M" + pts.map((p) => `${f2(p[0])},${f2(p[1])}`).join(" L"), length: polyLength(pts) };
    }
    case "textSlantUp":
    case "textSlantDown": {
      const yLow = h - fs * 0.25;
      const yHigh = fs;
      const [ya, yb] = warp === "textSlantUp" ? [yLow, yHigh] : [yHigh, yLow];
      return { d: `M${f2(pad)},${f2(ya)} L${f2(w - pad)},${f2(yb)}`, length: Math.hypot(w - 2 * pad, yb - ya) };
    }
  }
}

/** The single line of text a warp draws (paragraphs and breaks become spaces). */
export function warpText(el: Pick<SlideElement, "text">): string {
  return (el.text ?? "").replace(/[\n\v]+/g, " ").trim();
}

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Gradient geometry (objectBoundingBox) for a DrawingML angle. */
function gradVector(angle: number) {
  const rad = (angle * Math.PI) / 180;
  const f = (n: number) => Math.round(n * 10000) / 10000;
  return { x1: f(0.5 - Math.cos(rad) / 2), y1: f(0.5 - Math.sin(rad) / 2), x2: f(0.5 + Math.cos(rad) / 2), y2: f(0.5 + Math.sin(rad) / 2) };
}

/** SVG `<linearGradient>` for a word-art gradient. */
export function gradientDef(id: string, g: NonNullable<WordArt["gradient"]>): string {
  const v = gradVector(g.angle);
  return `<linearGradient id="${id}" x1="${v.x1}" y1="${v.y1}" x2="${v.x2}" y2="${v.y2}"><stop offset="0" stop-color="${escXml(g.from)}"/><stop offset="1" stop-color="${escXml(g.to)}"/></linearGradient>`;
}

/** Fill/stroke/filter attributes for SVG text with word art (the SVG
 *  export); `defs` holds the gradient when there is one. */
export function wordArtSvgAttrs(el: Pick<SlideElement, "wordArt" | "color">, id: string): { attrs: string; defs: string } {
  const art = el.wordArt;
  if (!art) return { attrs: "", defs: "" };
  let attrs = "";
  let defs = "";
  if (art.gradient) {
    defs = gradientDef(id, art.gradient);
    attrs += ` fill="url(#${id})"`;
  }
  if (art.outline && art.outline.width > 0)
    attrs += ` stroke="${escXml(art.outline.color)}" stroke-width="${art.outline.width}" paint-order="stroke" stroke-linejoin="round"`;
  const f = wordArtFilter(art);
  if (f) attrs += ` style="filter:${escXml(f)}"`;
  return { attrs, defs };
}

/**
 * Warped word art as a standalone SVG document string in the element's own
 * w×h coordinates: the single line of text on the warp path. The editor,
 * slideshow and every export draw warps from this one function.
 */
export function warpSvgMarkup(el: SlideElement, id: string): string {
  const art = el.wordArt;
  if (!art?.warp) return "";
  const fs = el.fontSize || 18;
  const w = Math.max(1, el.w);
  const h = Math.max(1, el.h);
  const p = warpPath(art.warp, w, h, fs);
  const gid = `${id}-g`;
  const pid = `${id}-p`;
  const g = art.gradient;
  const stroke =
    art.outline && art.outline.width > 0
      ? ` stroke="${escXml(art.outline.color)}" stroke-width="${art.outline.width}" paint-order="stroke" stroke-linejoin="round"`
      : "";
  const f = wordArtFilter(art);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"${f ? ` style="overflow:visible;filter:${escXml(f)}"` : ""}>` +
    `<defs>${g ? gradientDef(gid, g) : ""}<path id="${pid}" d="${p.d}" fill="none"/></defs>` +
    `<text font-size="${fs}" font-family="${escXml(el.fontFamily || "Arial")}" font-weight="${el.bold ? 700 : 400}" font-style="${el.italic ? "italic" : "normal"}" fill="${g ? `url(#${gid})` : escXml(el.color || "#000")}"${stroke}>` +
    `<textPath href="#${pid}"${warpFit(art.warp, warpText(el), fs, p.length, !!el.bold)}>${escXml(warpText(el))}</textPath></text></svg>`
  );
}

/** How the text sits on a warp path: a circle is filled (spread out); on
 *  other paths text shorter than the path is centred at its own width, and
 *  longer text is squeezed to fit (as PowerPoint fits warped text). The
 *  natural width is estimated at ~0.58 em per character (0.62 bold). */
export function warpFit(warp: TextWarp, text: string, fs: number, length: number, bold = false): string {
  const natural = text.length * fs * (bold ? 0.62 : 0.58);
  const fit = Math.max(1, Math.round(length * 0.98 * 100) / 100);
  if (natural > fit) return ` textLength="${fit}" lengthAdjust="spacingAndGlyphs"`;
  if (warp === "textCircle") return ` textLength="${fit}" lengthAdjust="spacing"`;
  return ` startOffset="50%" text-anchor="middle"`;
}
