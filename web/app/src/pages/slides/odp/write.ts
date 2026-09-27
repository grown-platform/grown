// ODP writer: Grown DeckDoc → OpenDocument Presentation (ODF 1.3) bytes.
//
// The package is built by hand with jszip: `mimetype` (first, stored),
// META-INF/manifest.xml, content.xml (slides, automatic styles), styles.xml
// (page layout sized from the deck, master page, gradients, dashes,
// markers), meta.xml and Pictures/* for data: URL images. Every XML part is
// produced by a pure helper so it can be unit-tested.
//
// Geometry: the logical canvas is 960 units wide = 10 in = 25.4 cm, so one
// unit = 0.02646 cm and font sizes are units × 0.75 pt. Charts, media and
// warped word art are turned into pictures by the caller beforehand
// (exportObjects.objectsToPictures), and remote asset images are inlined
// (assets.inlineImages), so images are mostly data: URLs here.

import JSZip from "jszip";
import {
  CANVAS_W,
  type ArrowHead,
  type DashStyle,
  type DeckDoc,
  type RunStyle,
  type Slide,
  type SlideElement,
  type TextAlign,
} from "../model";
import { flattenGroups } from "../groupOps";
import { effective, insetsOf, type StyleKey, listMarkers, paragraphs, paraIndent, type Paragraph } from "../textOps";
import { cellFormat, cellTextEl, colWidths, isCovered, rowHeights, spanOf } from "../tableOps";
import { elementGeometry } from "../shapeRender";
import { deckSize } from "../slideProps";
import { withFooters } from "../layouts";
import type { Seg } from "../presetGeometry";

export const ODP_MIME = "application/vnd.oasis.opendocument.presentation";

// ------------------------------------------------------------------ units

/** Logical units → centimetres (960 units = 25.4 cm). */
export function toCm(u: number): number {
  return (u / CANVAS_W) * 25.4;
}
const num = (n: number, d = 4) => {
  const v = Math.round(n * 10 ** d) / 10 ** d;
  return Object.is(v, -0) ? "0" : String(v);
};
/** A length attribute value in cm. */
export function cm(u: number): string {
  return `${num(toCm(u))}cm`;
}
/** Logical units → pt string (960 units = 720 pt). */
export function pt(u: number): string {
  return `${num(u * 0.75, 2)}pt`;
}

/** XML-escape text and attribute values (also drops XML-illegal controls). */
export function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A CSS-ish colour → `#rrggbb` plus alpha (0–1); null for none/transparent. */
export function odfColor(c: string | undefined): { hex: string; alpha: number } | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return null;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { hex: "#" + m[1].split("").map((x) => x + x).join(""), alpha: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return { hex: "#" + m[1], alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const h = (v: string) => Math.max(0, Math.min(255, Math.round(+v))).toString(16).padStart(2, "0");
    let a = 1;
    if (m[4]) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
    return { hex: `#${h(m[1])}${h(m[2])}${h(m[3])}`, alpha: a };
  }
  return null;
}
const hexOr = (c: string | undefined, dflt: string) => odfColor(c)?.hex ?? dflt;

const safeUrl = (u: string | undefined) => (u && /^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : undefined);

// ------------------------------------------------------------------ pictures

export interface PictureFile {
  path: string;
  mime: string;
  data: Uint8Array;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tif",
};

function decodeDataUrl(src: string): { mime: string; data: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(src);
  if (!m) return null;
  const mime = (m[1] || "text/plain").toLowerCase();
  try {
    if (/;base64/i.test(m[2])) {
      const bin = atob(m[3].replace(/\s+/g, ""));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return { mime, data: out };
    }
    return { mime, data: new TextEncoder().encode(decodeURIComponent(m[3])) };
  } catch {
    return null;
  }
}

/** Collects the package's pictures: data: URLs become Pictures/imgN.ext
 *  files (deduplicated), http(s) URLs stay external links. */
export class PictureStore {
  readonly files: PictureFile[] = [];
  private bySrc = new Map<string, string>();

  /** The xlink:href for an image source, or null if it cannot be written. */
  add(src: string | undefined): string | null {
    if (!src) return null;
    const hit = this.bySrc.get(src);
    if (hit) return hit;
    let href: string | null = null;
    if (/^data:/i.test(src)) {
      const d = decodeDataUrl(src);
      const ext = d && MIME_EXT[d.mime];
      if (d && ext && d.data.length) {
        href = `Pictures/img${this.files.length + 1}.${ext}`;
        this.files.push({ path: href, mime: d.mime === "image/jpg" ? "image/jpeg" : d.mime, data: d.data });
      }
    } else if (/^https?:\/\//i.test(src)) href = src;
    if (href) this.bySrc.set(src, href);
    return href;
  }
}

// ------------------------------------------------------------------ styles

/** Automatic styles, deduplicated by family + properties. */
class StyleBank {
  private byKey = new Map<string, string>();
  private out: string[] = [];
  private counters: Record<string, number> = {};

  constructor(private prefixOffset: Record<string, number> = {}) {}

  get(family: string, prefix: string, body: string, extraAttrs = ""): string {
    const key = `${family}|${extraAttrs}|${body}`;
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const n = (this.counters[prefix] = (this.counters[prefix] ?? this.prefixOffset[prefix] ?? 0) + 1);
    const name = `${prefix}${n}`;
    this.byKey.set(key, name);
    this.out.push(`<style:style style:name="${name}" style:family="${family}"${extraAttrs}>${body}</style:style>`);
    return name;
  }

  xml(): string {
    return this.out.join("");
  }
}

const attrs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v!)}"`)
    .join("");

/** Dash patterns (dash, gap, dot, gap…) as multiples of the line width. */
const DASH_PAT: Record<Exclude<DashStyle, "solid">, number[]> = {
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
};
const dashName = (d: DashStyle) => `Grown_${d}`;

const MARKERS: Record<string, { box: string; d: string }> = {
  Arrow: { box: "0 0 20 30", d: "M10 0l-10 30h20z" },
  Stealth: { box: "0 0 20 30", d: "M10 0l-10 30l10-9l10 9z" },
  Diamond: { box: "0 0 20 20", d: "M10 0l10 10l-10 10l-10-10z" },
  Circle: {
    box: "0 0 20 20",
    d: "M10 0C15.52 0 20 4.48 20 10C20 15.52 15.52 20 10 20C4.48 20 0 15.52 0 10C0 4.48 4.48 0 10 0z",
  },
};
function markerFor(k: ArrowHead | undefined): string | undefined {
  switch (k) {
    case "triangle":
    case "arrow":
      return "Arrow";
    case "stealth":
      return "Stealth";
    case "diamond":
      return "Diamond";
    case "oval":
      return "Circle";
    default:
      return undefined;
  }
}

function fillProps(fill: string | undefined, opacity?: number): Record<string, string | undefined> {
  const c = odfColor(fill);
  if (!c) return { "draw:fill": "none" };
  const a = c.alpha * (opacity ?? 1);
  return {
    "draw:fill": "solid",
    "draw:fill-color": c.hex,
    "draw:opacity": a < 1 ? `${num(a * 100, 1)}%` : undefined,
  };
}

function strokeProps(el: SlideElement, dfltWidth = 1): Record<string, string | undefined> {
  const c = odfColor(el.stroke);
  const sw = el.strokeWidth ?? dfltWidth;
  if (!c || !(sw > 0)) return { "draw:stroke": "none" };
  const dashed = el.dash && el.dash !== "solid";
  const head = markerFor(el.headEnd);
  const tail = markerFor(el.tailEnd);
  const mw = `${num(Math.max(sw, 2) * 3.5 * 0.0353, 3)}cm`;
  return {
    "draw:stroke": dashed ? "dash" : "solid",
    "draw:stroke-dash": dashed ? dashName(el.dash!) : undefined,
    "svg:stroke-color": c.hex,
    "svg:stroke-width": `${num(sw, 2)}pt`,
    "svg:stroke-opacity": c.alpha < 1 ? `${num(c.alpha * 100, 1)}%` : undefined,
    "draw:stroke-linejoin": "miter",
    "draw:marker-start": head,
    "draw:marker-start-width": head ? mw : undefined,
    "draw:marker-start-center": head === "Circle" || head === "Diamond" ? "true" : undefined,
    "draw:marker-end": tail,
    "draw:marker-end-width": tail ? mw : undefined,
    "draw:marker-end-center": tail === "Circle" || tail === "Diamond" ? "true" : undefined,
  };
}

const shadowProps = (el: SlideElement): Record<string, string | undefined> =>
  el.shadow
    ? {
        "draw:shadow": "visible",
        "draw:shadow-offset-x": "0.1cm",
        "draw:shadow-offset-y": "0.1cm",
        "draw:shadow-color": "#000000",
        "draw:shadow-opacity": "40%",
      }
    : {};

// ------------------------------------------------------------------ placement

/** Position attributes for a box rotated `rot` degrees clockwise about its
 *  centre: plain svg:x/y, or an ODF draw:transform (ODF rotates counter-
 *  clockwise about the shape's own origin, then translates). */
export function placement(x: number, y: number, w: number, h: number, rot?: number): string {
  const size = ` svg:width="${cm(w)}" svg:height="${cm(h)}"`;
  const r = ((rot ?? 0) % 360 + 360) % 360;
  if (!r) return `${size} svg:x="${cm(x)}" svg:y="${cm(y)}"`;
  const t = (r * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Where the box's top-left corner lands after a clockwise turn about the centre.
  const tx = cx - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t);
  const ty = cy - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t);
  return `${size} draw:transform="rotate(${num(-t, 6)}) translate(${cm(tx)} ${cm(ty)})"`;
}

// ------------------------------------------------------------------ text

/** Text with ODF whitespace elements (spaces, tabs, soft line breaks).
 *  ODF collapses space runs across spans and drops leading spaces in a
 *  paragraph, so `ctx.atStart` carries "previous char was a space / the
 *  paragraph start" from one span to the next. */
export function textContent(s: string, ctx: { atStart: boolean } = { atStart: true }): string {
  let out = "";
  let spaces = 0;
  const flush = () => {
    if (!spaces) return;
    if (ctx.atStart) out += `<text:s${spaces > 1 ? ` text:c="${spaces}"` : ""}/>`;
    else out += " " + (spaces > 1 ? `<text:s${spaces > 2 ? ` text:c="${spaces - 1}"` : ""}/>` : "");
    spaces = 0;
    ctx.atStart = true; // a following space would collapse into this one
  };
  for (const ch of s) {
    if (ch === " ") {
      spaces++;
      continue;
    }
    flush();
    if (ch === "\v" || ch === "\u2028") {
      out += "<text:line-break/>";
      ctx.atStart = true;
      continue;
    }
    if (ch === "\t") out += "<text:tab/>";
    else out += esc(ch);
    ctx.atStart = false;
  }
  flush();
  return out;
}

function textPropsXml(el: SlideElement, run: RunStyle): string {
  const g = (k: StyleKey) => effective(el, run, k);
  const size = (g("fontSize") as number) || 18;
  const color = odfColor(g("color") as string | undefined);
  const font = g("fontFamily") as string | undefined;
  const base = g("baseline") as string | undefined;
  const a: Record<string, string | undefined> = {
    "fo:font-size": pt(size),
    "style:font-size-asian": pt(size),
    "style:font-size-complex": pt(size),
    "fo:font-family": font ? `'${font.replace(/'/g, "")}'` : undefined,
    "style:font-family-asian": font ? `'${font.replace(/'/g, "")}'` : undefined,
    "style:font-family-complex": font ? `'${font.replace(/'/g, "")}'` : undefined,
    "fo:font-weight": g("bold") ? "bold" : "normal",
    "style:font-weight-asian": g("bold") ? "bold" : "normal",
    "style:font-weight-complex": g("bold") ? "bold" : "normal",
    "fo:font-style": g("italic") ? "italic" : "normal",
    "style:font-style-asian": g("italic") ? "italic" : "normal",
    "style:font-style-complex": g("italic") ? "italic" : "normal",
    "fo:color": color?.hex,
  };
  if (g("underline")) {
    a["style:text-underline-style"] = "solid";
    a["style:text-underline-width"] = "auto";
    a["style:text-underline-color"] = "font-color";
  }
  if (g("strike")) a["style:text-line-through-style"] = "solid";
  if (base === "super") a["style:text-position"] = "super 58%";
  else if (base === "sub") a["style:text-position"] = "sub 58%";
  return `<style:text-properties${attrs(a)}/>`;
}

const ALIGN: Record<TextAlign, string> = { left: "start", center: "center", right: "end", justify: "justify" };

function paraStyle(bank: StyleBank, el: SlideElement, p: Paragraph, list: boolean): string {
  const indent = paraIndent(el, p.props);
  const hang = list ? Math.min(indent, 42) : 0;
  const a: Record<string, string | undefined> = {
    "fo:text-align": ALIGN[p.props.align ?? el.align ?? "left"],
    "fo:margin-left": cm(indent),
    "fo:margin-right": "0cm",
    "fo:text-indent": cm(-hang),
    "fo:margin-top": cm(el.spaceBefore ?? 0),
    "fo:margin-bottom": cm(el.spaceAfter ?? 0),
    "fo:line-height": el.lineSpacing ? `${num((el.lineSpacing / 1.2) * 100, 0)}%` : "100%",
    "style:writing-mode": el.rtl ? "rl-tb" : undefined,
  };
  // The marker is followed by a tab; stop it where the text starts.
  const tabs = hang ? `<style:tab-stops><style:tab-stop style:position="0cm"/></style:tab-stops>` : "";
  return bank.get(
    "paragraph",
    "P",
    `<style:paragraph-properties${attrs(a)}${tabs ? `>${tabs}</style:paragraph-properties>` : "/>"}${textPropsXml(el, {})}`,
  );
}

/** text:p elements for a text element (or a table cell presented as one). */
export function paragraphsXml(el: SlideElement, bank: StyleBankLike): string {
  const b = bank as StyleBank;
  const paras = paragraphs(el);
  const markers = listMarkers(el);
  const elUrl = el.type === "text" ? safeUrl(el.url) : undefined;
  return paras
    .map((p, i) => {
      const ps = paraStyle(b, el, p, !!el.list);
      let inner = "";
      const ctx = { atStart: true };
      if (markers[i]) {
        const ts = b.get("text", "T", textPropsXml(el, p.runs[0] ?? {}));
        inner += `<text:span text:style-name="${ts}">${esc(markers[i])}</text:span><text:tab/>`;
      }
      for (const r of p.runs) {
        const ts = b.get("text", "T", textPropsXml(el, r));
        // Impress reads links as fields inside a span (text:span > text:a).
        let body = textContent(r.text, ctx);
        const url = safeUrl(r.url) ?? elUrl;
        if (url) body = `<text:a xlink:type="simple" xlink:href="${esc(url)}">${body}</text:a>`;
        inner += `<text:span text:style-name="${ts}">${body}</text:span>`;
      }
      return `<text:p text:style-name="${ps}">${inner}</text:p>`;
    })
    .join("");
}

/** Opaque handle to the style bank (exported for tests of paragraphsXml). */
export type StyleBankLike = object;
export function newStyleBank(): StyleBankLike {
  return new StyleBank();
}

// ------------------------------------------------------------------ shapes

const r2 = (n: number) => Math.round(n * 100);

/** ODF enhanced-path commands for geometry segments (coordinates in
 *  hundredths of a logical unit; quadratic curves raised to cubic). */
function enhancedPath(segs: Seg[], w: number, h: number, flipH?: boolean, flipV?: boolean): string {
  const X = (x: number) => r2(flipH ? w - x : x);
  const Y = (y: number) => r2(flipV ? h - y : y);
  const out: string[] = [];
  let cur: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  for (const s of segs) {
    switch (s.c) {
      case "M":
        out.push(`M ${X(s.p[0])} ${Y(s.p[1])}`);
        cur = [s.p[0], s.p[1]];
        start = cur;
        break;
      case "L":
        out.push(`L ${X(s.p[0])} ${Y(s.p[1])}`);
        cur = [s.p[0], s.p[1]];
        break;
      case "Q": {
        const [qx, qy, x, y] = s.p;
        const c1 = [cur[0] + (2 / 3) * (qx - cur[0]), cur[1] + (2 / 3) * (qy - cur[1])];
        const c2 = [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)];
        out.push(`C ${X(c1[0])} ${Y(c1[1])} ${X(c2[0])} ${Y(c2[1])} ${X(x)} ${Y(y)}`);
        cur = [x, y];
        break;
      }
      case "C":
        out.push(`C ${X(s.p[0])} ${Y(s.p[1])} ${X(s.p[2])} ${Y(s.p[3])} ${X(s.p[4])} ${Y(s.p[5])}`);
        cur = [s.p[4], s.p[5]];
        break;
      case "Z":
        out.push("Z");
        cur = start;
        break;
    }
  }
  return out.join(" ");
}

/** SVG path data (flips baked in), for draw:path. */
function svgPath(segs: Seg[], w: number, h: number, flipH?: boolean, flipV?: boolean): string {
  return enhancedPath(segs, w, h, flipH, flipV);
}

/** ODF draw:type for fixed-geometry presets. Adjustable ones (roundRect,
 *  rightArrow, …) are written as "non-primitive": LibreOffice treats e.g.
 *  "round-rectangle" as its own primitive and mangles the explicit path. */
const ODF_TYPE: Record<string, string> = {
  rect: "rectangle",
  ellipse: "ellipse",
  triangle: "isosceles-triangle",
  diamond: "diamond",
};

function titleDesc(el: SlideElement): string {
  return (el.name ? `<svg:title>${esc(el.name)}</svg:title>` : "") + (el.alt ? `<svg:desc>${esc(el.alt)}</svg:desc>` : "");
}

const nameAttr = (el: SlideElement) => (el.name ? ` draw:name="${esc(el.name)}"` : "");

function shapeXml(el: SlideElement, bank: StyleBank): string {
  const g = elementGeometry(el);
  if (!g || !g.paths.length) return "";
  const w = Math.max(el.w, 0.01);
  const h = Math.max(el.h, 0.01);
  const ins = insetsOf(el);
  const style = bank.get(
    "graphic",
    "gr",
    `<style:graphic-properties${attrs({
      ...fillProps(el.fill, el.opacity),
      ...strokeProps(el),
      ...shadowProps(el),
      "draw:textarea-vertical-align": el.valign ?? "middle",
      "draw:textarea-horizontal-align": "justify",
      "draw:auto-grow-height": "false",
      "fo:wrap-option": "wrap",
      "fo:padding-left": cm(ins.l),
      "fo:padding-right": cm(ins.r),
      "fo:padding-top": cm(ins.t),
      "fo:padding-bottom": cm(ins.b),
    })}/>`,
  );
  const path = g.paths
    .map((p) => enhancedPath(p.segs, el.w, el.h, el.flipH, el.flipV) + (p.fill === "none" ? " F" : "") + (p.stroke ? "" : " S") + " N")
    .join(" ");
  const type = el.type === "shape" ? ODF_TYPE[el.preset ?? ""] : ODF_TYPE[el.type];
  return (
    `<draw:custom-shape${nameAttr(el)} draw:style-name="${style}"${placement(el.x, el.y, w, h, el.rotation)}>` +
    titleDesc(el) +
    `<draw:enhanced-geometry svg:viewBox="0 0 ${r2(w)} ${r2(h)}" draw:type="${type ?? "non-primitive"}" draw:enhanced-path="${path}"/>` +
    `</draw:custom-shape>`
  );
}

function lineXml(el: SlideElement, bank: StyleBank): string {
  const style = bank.get(
    "graphic",
    "gr",
    `<style:graphic-properties${attrs({ "draw:fill": "none", ...strokeProps(el, 2), ...shadowProps(el) })}/>`,
  );
  // A "line" is a horizontal bar across its box, turned about the centre.
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const t = ((el.rotation ?? 0) * Math.PI) / 180;
  const dx = (el.w / 2) * Math.cos(t);
  const dy = (el.w / 2) * Math.sin(t);
  return `<draw:line${nameAttr(el)} draw:style-name="${style}" svg:x1="${cm(cx - dx)}" svg:y1="${cm(cy - dy)}" svg:x2="${cm(cx + dx)}" svg:y2="${cm(cy + dy)}">${titleDesc(el)}<text:p/></draw:line>`;
}

function connectorXml(el: SlideElement, bank: StyleBank): string {
  const g = elementGeometry(el);
  const p0 = g?.paths[0];
  if (!p0) return "";
  const style = bank.get(
    "graphic",
    "gr",
    `<style:graphic-properties${attrs({ "draw:fill": "none", ...strokeProps(el), ...shadowProps(el) })}/>`,
  );
  const pts = p0.segs.filter((s) => s.c !== "Z");
  const straight = pts.length === 2 && pts[0].c === "M" && pts[1].c === "L" && !el.rotation;
  if (straight) {
    const P = (p: number[]) => [el.x + (el.flipH ? el.w - p[0] : p[0]), el.y + (el.flipV ? el.h - p[1] : p[1])];
    const [x1, y1] = P((pts[0] as { p: number[] }).p);
    const [x2, y2] = P((pts[1] as { p: number[] }).p);
    return `<draw:line${nameAttr(el)} draw:style-name="${style}" svg:x1="${cm(x1)}" svg:y1="${cm(y1)}" svg:x2="${cm(x2)}" svg:y2="${cm(y2)}">${titleDesc(el)}<text:p/></draw:line>`;
  }
  const w = Math.max(el.w, 0.01);
  const h = Math.max(el.h, 0.01);
  const d = svgPath(p0.segs, el.w, el.h, el.flipH, el.flipV).replace(/ ?Z/g, " Z");
  return `<draw:path${nameAttr(el)} draw:style-name="${style}"${placement(el.x, el.y, w, h, el.rotation)} svg:viewBox="0 0 ${r2(w)} ${r2(h)}" svg:d="${d}">${titleDesc(el)}<text:p/></draw:path>`;
}

function textFrameXml(el: SlideElement, bank: StyleBank): string {
  const ins = insetsOf(el);
  const style = bank.get(
    "graphic",
    "gr",
    `<style:graphic-properties${attrs({
      ...fillProps(el.fill, el.opacity),
      ...strokeProps({ ...el, stroke: el.stroke ?? "none" }),
      ...shadowProps(el),
      "draw:textarea-vertical-align": el.valign ?? "top",
      "draw:auto-grow-height": "false",
      "draw:auto-grow-width": "false",
      "fo:min-height": cm(el.h),
      "fo:padding-left": cm(ins.l),
      "fo:padding-right": cm(ins.r),
      "fo:padding-top": cm(ins.t),
      "fo:padding-bottom": cm(ins.b),
      "fo:wrap-option": "wrap",
      "style:writing-mode": el.vert ? "tb-rl" : undefined,
    })}/>`,
  );
  return (
    `<draw:frame${nameAttr(el)} draw:style-name="${style}"${placement(el.x, el.y, el.w, el.h, el.rotation)}>` +
    `<draw:text-box>${paragraphsXml(el, bank)}</draw:text-box>${titleDesc(el)}</draw:frame>`
  );
}

function imageXml(el: SlideElement, bank: StyleBank, pics: PictureStore): string {
  const href = pics.add(el.src);
  if (!href) return "";
  const style = bank.get(
    "graphic",
    "gr",
    `<style:graphic-properties${attrs({
      "draw:fill": "none",
      ...strokeProps({ ...el, stroke: el.stroke ?? "none" }),
      ...shadowProps(el),
      "draw:image-opacity": el.opacity !== undefined && el.opacity < 1 ? `${num(el.opacity * 100, 1)}%` : undefined,
      "style:mirror": el.flipH && el.flipV ? "horizontal vertical" : el.flipH ? "horizontal" : el.flipV ? "vertical" : undefined,
    })}/>`,
  );
  const alt = el.alt ? `<svg:title>${esc(el.name || el.alt)}</svg:title><svg:desc>${esc(el.alt)}</svg:desc>` : el.name ? `<svg:title>${esc(el.name)}</svg:title>` : "";
  return (
    `<draw:frame${nameAttr(el)} draw:style-name="${style}"${placement(el.x, el.y, el.w, el.h, el.rotation)}>` +
    `<draw:image xlink:href="${esc(href)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"><text:p/></draw:image>${alt}</draw:frame>`
  );
}

function border(b: { color: string; width: number } | undefined): string {
  return b ? `${num(b.width, 2)}pt solid ${hexOr(b.color, "#000000")}` : "none";
}

function tableXml(el: SlideElement, bank: StyleBank): string {
  const t = el.table;
  if (!t || !t.rows || !t.cols) return "";
  const cw = colWidths(el);
  const rh = rowHeights(el);
  const cols = cw
    .map((w) => {
      const s = bank.get("table-column", "co", `<style:table-column-properties style:column-width="${cm(w)}"/>`);
      return `<table:table-column table:style-name="${s}"/>`;
    })
    .join("");
  const rows: string[] = [];
  for (let r = 0; r < t.rows; r++) {
    const rs = bank.get("table-row", "ro", `<style:table-row-properties style:row-height="${cm(rh[r])}"/>`);
    let cells = "";
    for (let c = 0; c < t.cols; c++) {
      if (isCovered(t, r, c)) {
        cells += "<table:covered-table-cell/>";
        continue;
      }
      const f = cellFormat(el, r, c);
      const te = cellTextEl(el, r, c);
      const ins = insetsOf(te);
      const fill = odfColor(f.fill);
      const cs = bank.get(
        "table-cell",
        "ce",
        `<style:graphic-properties${attrs({
          "draw:fill": fill ? "solid" : "none",
          "draw:fill-color": fill?.hex,
          "draw:textarea-vertical-align": te.valign ?? "top",
          "fo:padding-left": cm(ins.l),
          "fo:padding-right": cm(ins.r),
          "fo:padding-top": cm(ins.t),
          "fo:padding-bottom": cm(ins.b),
        })}/>` +
          `<style:paragraph-properties${attrs({
            "fo:border-top": border(f.borders.t),
            "fo:border-right": border(f.borders.r),
            "fo:border-bottom": border(f.borders.b),
            "fo:border-left": border(f.borders.l),
          })}/>`,
      );
      const sp = spanOf(t, r, c);
      const span =
        (sp.cs > 1 ? ` table:number-columns-spanned="${sp.cs}"` : "") +
        (sp.rs > 1 ? ` table:number-rows-spanned="${sp.rs}"` : "");
      cells += `<table:table-cell table:style-name="${cs}"${span}>${paragraphsXml(te, bank)}</table:table-cell>`;
    }
    rows.push(`<table:table-row table:style-name="${rs}">${cells}</table:table-row>`);
  }
  const style = bank.get("graphic", "gr", `<style:graphic-properties draw:fill="none" draw:stroke="none"/>`);
  return (
    `<draw:frame${nameAttr(el)} draw:style-name="${style}"${placement(el.x, el.y, el.w, el.h, el.rotation)}>` +
    `<table:table>${cols}${rows.join("")}</table:table>${titleDesc(el)}</draw:frame>`
  );
}

/** One element's draw markup ("" for unsupported/empty elements). */
function elementXml(el: SlideElement, bank: StyleBank, pics: PictureStore): string {
  switch (el.type) {
    case "text":
      return textFrameXml(el, bank);
    case "rect":
    case "roundRect":
    case "ellipse":
    case "triangle":
    case "diamond":
    case "rightArrow":
    case "shape":
      return shapeXml(el, bank);
    case "line":
      return lineXml(el, bank);
    case "connector":
      return connectorXml(el, bank);
    case "image":
      return imageXml(el, bank, pics);
    case "table":
      return tableXml(el, bank);
    case "media":
      // Normally converted to a picture by the caller; fall back to the poster.
      return el.media?.poster ? imageXml({ ...el, type: "image", src: el.media.poster }, bank, pics) : "";
    default:
      return "";
  }
}

// ------------------------------------------------------------------ content

const NS =
  ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
  ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"' +
  ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
  ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
  ' xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"' +
  ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"' +
  ' xmlns:xlink="http://www.w3.org/1999/xlink"' +
  ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
  ' xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"' +
  ' xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"' +
  ' xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"' +
  ' xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"' +
  ' xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0"' +
  ' xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0"';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

const gradientName = (i: number) => `Grown_bg_gradient_${i + 1}`;
const bgImageName = (i: number) => `Grown_bg_image_${i + 1}`;

function pageStyle(bank: StyleBank, s: Slide, i: number, pics: PictureStore): string {
  const f = s.bgFill;
  let fill: Record<string, string | undefined>;
  if (f?.kind === "gradient" && f.stops.length) fill = { "draw:fill": "gradient", "draw:fill-gradient-name": gradientName(i) };
  else if (f?.kind === "image" && pics.add(f.src))
    fill = { "draw:fill": "bitmap", "draw:fill-image-name": bgImageName(i), "style:repeat": "stretch" };
  else fill = { "draw:fill": "solid", "draw:fill-color": hexOr(s.background, "#ffffff") };
  return bank.get(
    "drawing-page",
    "dp",
    `<style:drawing-page-properties${attrs({
      ...fill,
      "presentation:background-visible": "true",
      "presentation:background-objects-visible": "true",
      "presentation:visibility": s.hidden ? "hidden" : undefined,
      "draw:background-size": "full",
    })}/>`,
  );
}

function notesXml(notes: string | undefined, h: number, bank: StyleBank, page: number): string {
  if (!notes || !notes.trim()) return "";
  const lines = notes.split(/\r?\n/);
  const ps = bank.get(
    "paragraph",
    "P",
    `<style:paragraph-properties fo:margin-left="0cm" fo:margin-right="0cm" fo:text-indent="0cm"/><style:text-properties fo:font-size="12pt"/>`,
  );
  const gr = bank.get(
    "graphic",
    "gr",
    `<style:graphic-properties draw:fill="none" draw:stroke="none" draw:textarea-vertical-align="top" draw:auto-grow-height="false"/>`,
  );
  // Notes page: portrait, the slide thumbnail on top, notes below.
  const nw = 21;
  const nh = 29.7;
  const thumbW = 16;
  const thumbH = (thumbW * h) / CANVAS_W;
  return (
    `<presentation:notes>` +
    `<draw:page-thumbnail draw:layer="layout" draw:page-number="${page}" svg:width="${thumbW}cm" svg:height="${num(thumbH)}cm" svg:x="${(nw - thumbW) / 2}cm" svg:y="2cm" presentation:class="page"/>` +
    `<draw:frame draw:style-name="${gr}" draw:layer="layout" svg:width="${nw - 4}cm" svg:height="${num(nh - thumbH - 7)}cm" svg:x="2cm" svg:y="${num(thumbH + 4)}cm" presentation:class="notes" presentation:placeholder="false">` +
    `<draw:text-box>${lines.map((l) => `<text:p text:style-name="${ps}">${textContent(l)}</text:p>`).join("")}</draw:text-box>` +
    `</draw:frame></presentation:notes>`
  );
}

/** content.xml for a deck. Images found on the slides are added to `pictures`. */
export function contentXml(deck: DeckDoc, pictures: PictureStore, now?: Date): string {
  const bank = new StyleBank();
  const { h } = deckSize(deck);
  const pages = deck.slides.map((_, i) => {
    const s = withFooters(deck, i, now);
    const dp = pageStyle(bank, s, i, pictures);
    const body = flattenGroups(s.elements)
      .map((el) => elementXml(el, bank, pictures))
      .join("");
    return (
      `<draw:page draw:name="page${i + 1}" draw:style-name="${dp}" draw:master-page-name="Default">` +
      body +
      notesXml(s.notes, h, bank, i + 1) +
      `</draw:page>`
    );
  });
  const settings = deck.show?.loop ? `<presentation:settings presentation:endless="true" presentation:pause="PT0S"/>` : "";
  return (
    XML_DECL +
    `<office:document-content${NS} office:version="1.3">` +
    `<office:automatic-styles>${bank.xml()}</office:automatic-styles>` +
    `<office:body><office:presentation>${pages.join("")}${settings}</office:presentation></office:body>` +
    `</office:document-content>`
  );
}

// ------------------------------------------------------------------ styles.xml

function dashXml(d: Exclude<DashStyle, "solid">): string {
  const p = DASH_PAT[d];
  const pc = (n: number) => `${n * 100}%`;
  const a: Record<string, string> = {
    "draw:name": dashName(d),
    "draw:display-name": d,
    "draw:style": "rect",
    "draw:dots1": "1",
    "draw:dots1-length": pc(p[0]),
    "draw:distance": pc(p[1]),
  };
  if (p.length > 2) {
    a["draw:dots2"] = String((p.length - 2) / 2);
    a["draw:dots2-length"] = pc(p[2]);
  }
  return `<draw:stroke-dash${attrs(a)}/>`;
}

/** styles.xml: page layout sized from the deck, master page, and the named
 *  styles content.xml refers to (background gradients/bitmaps, dashes,
 *  arrow markers). Background pictures are added to `pictures`. */
export function stylesXml(deck: DeckDoc, pictures: PictureStore): string {
  const { h } = deckSize(deck);
  const named: string[] = [];
  deck.slides.forEach((s, i) => {
    const f = s.bgFill;
    if (f?.kind === "gradient" && f.stops.length) {
      const first = f.stops[0];
      const last = f.stops[f.stops.length - 1];
      named.push(
        `<draw:gradient${attrs({
          "draw:name": gradientName(i),
          "draw:style": f.radial ? "radial" : "linear",
          "draw:cx": f.radial ? "50%" : undefined,
          "draw:cy": f.radial ? "50%" : undefined,
          "draw:start-color": hexOr(first.color, "#ffffff"),
          "draw:end-color": hexOr(last.color, "#ffffff"),
          "draw:start-intensity": "100%",
          "draw:end-intensity": "100%",
          // ODF 0° runs top→bottom and turns counter-clockwise; Grown 0° is left→right.
          "draw:angle": f.radial ? "0deg" : `${num((((90 - (f.angle ?? 90)) % 360) + 360) % 360, 2)}deg`,
          "draw:border": "0%",
        })}/>`,
      );
    } else if (f?.kind === "image") {
      const href = pictures.add(f.src);
      if (href)
        named.push(
          `<draw:fill-image draw:name="${bgImageName(i)}" xlink:href="${esc(href)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`,
        );
    }
  });
  for (const d of Object.keys(DASH_PAT) as Exclude<DashStyle, "solid">[]) named.push(dashXml(d));
  for (const [name, m] of Object.entries(MARKERS))
    named.push(`<draw:marker draw:name="${name}" svg:viewBox="${m.box}" svg:d="${m.d}"/>`);
  const W = cm(CANVAS_W);
  const H = cm(h);
  return (
    XML_DECL +
    `<office:document-styles${NS} office:version="1.3">` +
    `<office:styles>${named.join("")}` +
    `<style:default-style style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none" draw:shadow="hidden"/>` +
    `<style:paragraph-properties fo:line-height="100%"/><style:text-properties fo:font-size="18pt" fo:color="#000000"/></style:default-style>` +
    `</office:styles>` +
    `<office:automatic-styles>` +
    `<style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${W}" fo:page-height="${H}" style:print-orientation="${h > CANVAS_W ? "portrait" : "landscape"}"/></style:page-layout>` +
    `<style:page-layout style:name="PM2"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait"/></style:page-layout>` +
    `<style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#ffffff" draw:background-size="full"/></style:style>` +
    `</office:automatic-styles>` +
    `<office:master-styles>` +
    `<draw:layer-set><draw:layer draw:name="layout"/><draw:layer draw:name="background"/><draw:layer draw:name="backgroundobjects"/><draw:layer draw:name="controls"/><draw:layer draw:name="measurelines"/></draw:layer-set>` +
    `<style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1">` +
    `<presentation:notes style:page-layout-name="PM2"/>` +
    `</style:master-page>` +
    `</office:master-styles>` +
    `</office:document-styles>`
  );
}

// ------------------------------------------------------------------ meta, manifest

export function metaXml(title: string, now: Date = new Date()): string {
  const date = now.toISOString().replace(/\.\d+Z$/, "Z");
  return (
    XML_DECL +
    `<office:document-meta${NS} office:version="1.3"><office:meta>` +
    `<meta:generator>Grown Slides</meta:generator>` +
    `<dc:title>${esc(title)}</dc:title>` +
    `<meta:creation-date>${date}</meta:creation-date><dc:date>${date}</dc:date>` +
    `</office:meta></office:document-meta>`
  );
}

export function manifestXml(files: { path: string; mime: string }[]): string {
  return (
    XML_DECL +
    `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODP_MIME}"/>` +
    files.map((f) => `<manifest:file-entry manifest:full-path="${esc(f.path)}" manifest:media-type="${esc(f.mime)}"/>`).join("") +
    `</manifest:manifest>`
  );
}

// ------------------------------------------------------------------ package

/** deckToOdp builds an .odp package for a deck. */
export async function deckToOdp(deck: DeckDoc, title: string): Promise<Uint8Array> {
  const pics = new PictureStore();
  const content = contentXml(deck, pics);
  const styles = stylesXml(deck, pics);
  const zip = new JSZip();
  zip.file("mimetype", ODP_MIME, { compression: "STORE" });
  zip.file("content.xml", content);
  zip.file("styles.xml", styles);
  zip.file("meta.xml", metaXml(title));
  for (const p of pics.files) zip.file(p.path, p.data, { compression: "STORE" });
  zip.file(
    "META-INF/manifest.xml",
    manifestXml([
      { path: "content.xml", mime: "text/xml" },
      { path: "styles.xml", mime: "text/xml" },
      { path: "meta.xml", mime: "text/xml" },
      ...pics.files.map((p) => ({ path: p.path, mime: p.mime })),
    ]),
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: ODP_MIME });
}
