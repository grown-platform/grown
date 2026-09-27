// ODP reader: OpenDocument Presentation bytes → Grown DeckDoc, written from
// the ODF 1.3 spec (part 3, §9 drawing shapes, §16 styles).
//
// Scope: slides (draw:page) with their background colour and visibility,
// presenter notes, text frames, pictures (draw:frame/draw:image), custom
// shapes (draw:enhanced-geometry draw:type → a Grown preset), draw:rect /
// draw:ellipse / draw:line / draw:connector, groups (flattened), shape text,
// click actions that open a URL or document (presentation:event-listener
// "show"), rotation (draw:transform) and the page size. Styles are resolved
// through style:parent-style-name and the family's default style.
// Animations, tables, charts and embedded objects are reported as warnings.

import JSZip from "jszip";
import { CANVAS_W, DEFAULT_CANVAS_H, uid, type DeckDoc, type Slide, type SlideElement, type TextAlign } from "../model";
import { hasPreset } from "../presetGeometry";
import { ODP_MIME } from "./write";

export interface OdpImport {
  deck: DeckDoc;
  /** dc:title from meta.xml, when set. */
  title?: string;
  /** Human-readable notes about content that could not be mapped. */
  warnings: string[];
}

const NS = {
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  style: "urn:oasis:names:tc:opendocument:xmlns:style:1.0",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  draw: "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
  fo: "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
  svg: "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0",
  presentation: "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0",
  xlink: "http://www.w3.org/1999/xlink",
  dc: "http://purl.org/dc/elements/1.1/",
  anim: "urn:oasis:names:tc:opendocument:xmlns:animation:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
} as const;
type Prefix = keyof typeof NS;

const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ xml helpers

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}
const is = (el: Element, p: Prefix, local: string) => el.namespaceURI === NS[p] && el.localName === local;
const kids = (el: Element | null | undefined, p?: Prefix, local?: string): Element[] =>
  el ? Array.from(el.children).filter((c) => !p || (c.namespaceURI === NS[p] && (!local || c.localName === local))) : [];
const kid = (el: Element | null | undefined, p: Prefix, local: string) => kids(el, p, local)[0] ?? null;
const at = (el: Element | null | undefined, p: Prefix, local: string): string | null => el?.getAttributeNS(NS[p], local) ?? null;
const all = (el: Element | Document | null | undefined, p: Prefix, local: string): Element[] =>
  el ? Array.from(el.getElementsByTagNameNS(NS[p], local)) : [];

// ------------------------------------------------------------------ units

/** An ODF length ("2.5cm", "12pt", "1in"…) in centimetres; null if unparsable. */
export function lengthCm(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*(cm|mm|in|inch|pt|pc|px)?\s*$/i.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch ((m[2] ?? "cm").toLowerCase()) {
    case "mm":
      return n / 10;
    case "in":
    case "inch":
      return n * 2.54;
    case "pt":
      return (n * 2.54) / 72;
    case "pc":
      return (n * 2.54) / 6;
    case "px":
      return (n * 2.54) / 96;
    default:
      return n;
  }
}

/** A font size ("18pt", "0.5in") in points; null when relative/unknown. */
function fontPt(v: string | null): number | null {
  if (!v || v.endsWith("%")) return null;
  const c = lengthCm(v);
  return c === null ? null : (c * 72) / 2.54;
}

// ------------------------------------------------------------------ styles

type Family = "graphic" | "presentation" | "paragraph" | "text" | "drawing-page";
type PropKind = "graphic-properties" | "paragraph-properties" | "text-properties" | "drawing-page-properties";

class Styles {
  private named = new Map<string, Element>();
  private defaults = new Map<string, Element>();

  add(root: Element | null) {
    for (const s of kids(root, "style", "style")) {
      const fam = at(s, "style", "family");
      const name = at(s, "style", "name");
      if (fam && name) this.named.set(`${fam}:${name}`, s);
    }
    for (const s of kids(root, "style", "default-style")) {
      const fam = at(s, "style", "family");
      if (fam) this.defaults.set(fam, s);
    }
  }

  /** Merged attributes of `kind` for a style (its ancestors, then itself). */
  props(family: Family, name: string | null, kind: PropKind): Map<string, string> {
    const chain: Element[] = [];
    const seen = new Set<string>();
    let cur = name ? this.named.get(`${family}:${name}`) : undefined;
    while (cur) {
      chain.unshift(cur);
      const parent = at(cur, "style", "parent-style-name");
      const key = `${family}:${parent}`;
      if (!parent || seen.has(key)) break;
      seen.add(key);
      cur = this.named.get(key);
    }
    const d = this.defaults.get(family === "presentation" ? "graphic" : family);
    if (d) chain.unshift(d);
    const out = new Map<string, string>();
    for (const s of chain)
      for (const p of kids(s, "style", kind))
        for (const a of Array.from(p.attributes)) out.set(`${a.prefix ?? ""}:${a.localName}`, a.value);
    return out;
  }
}

// ------------------------------------------------------------------ shapes

/** LibreOffice custom-shape types → Grown presets (ooxml-<preset> is how
 *  LibreOffice keeps OOXML presets). */
const ODF_PRESET: Record<string, string> = {
  rectangle: "rect",
  ellipse: "ellipse",
  circle: "ellipse",
  "round-rectangle": "roundRect",
  "isosceles-triangle": "triangle",
  "right-triangle": "rtTriangle",
  diamond: "diamond",
  parallelogram: "parallelogram",
  trapezoid: "trapezoid",
  pentagon: "pentagon",
  hexagon: "hexagon",
  octagon: "octagon",
  cross: "plus",
  "right-arrow": "rightArrow",
  "left-arrow": "leftArrow",
  "up-arrow": "upArrow",
  "down-arrow": "downArrow",
  "left-right-arrow": "leftRightArrow",
  "up-down-arrow": "upDownArrow",
  star4: "star4",
  star5: "star5",
  star6: "star6",
  star8: "star8",
  heart: "heart",
  smiley: "smileyFace",
  sun: "sun",
  moon: "moon",
  cube: "cube",
  can: "can",
  ring: "donut",
  "flowchart-process": "flowChartProcess",
  "flowchart-decision": "flowChartDecision",
  "flowchart-terminator": "flowChartTerminator",
  "flowchart-connector": "flowChartConnector",
};

/** The Grown preset for a draw:type, or null. */
export function presetForOdfType(type: string | null): string | null {
  if (!type) return null;
  const p = type.startsWith("ooxml-") ? type.slice(6) : ODF_PRESET[type];
  return p && hasPreset(p) ? p : null;
}

interface Ctx {
  zip: JSZip;
  styles: Styles;
  /** Logical units per centimetre. */
  k: number;
  warnings: Set<string>;
}

const colorOf = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);

function graphicLook(ctx: Ctx, el: Element) {
  const g = at(el, "presentation", "style-name")
    ? ctx.styles.props("presentation", at(el, "presentation", "style-name"), "graphic-properties")
    : ctx.styles.props("graphic", at(el, "draw", "style-name"), "graphic-properties");
  const fillKind = g.get("draw:fill");
  const fill = fillKind === "solid" || (fillKind === undefined && g.has("draw:fill-color")) ? colorOf(g.get("draw:fill-color")) : undefined;
  if (fillKind === "gradient" || fillKind === "bitmap" || fillKind === "hatch") ctx.warnings.add(`A ${fillKind} fill was imported as a plain colour`);
  const strokeKind = g.get("draw:stroke");
  const stroke = strokeKind && strokeKind !== "none" ? colorOf(g.get("svg:stroke-color")) ?? "#000000" : undefined;
  const swCm = lengthCm(g.get("svg:stroke-width"));
  const strokeWidth = stroke ? Math.max(0.5, r2(swCm ? (swCm * 72) / 2.54 : 1)) : 0;
  const va = g.get("draw:textarea-vertical-align");
  const valign: SlideElement["valign"] = va === "middle" || va === "bottom" || va === "top" ? va : undefined;
  return { fill: fill ?? (fillKind === "gradient" ? colorOf(g.get("draw:fill-color")) : undefined), stroke, strokeWidth, valign };
}

/** Box of a shape in logical units, undoing draw:transform rotation. */
function boxOf(ctx: Ctx, el: Element): { x: number; y: number; w: number; h: number; rotation?: number } | null {
  const w = lengthCm(at(el, "svg", "width"));
  const h = lengthCm(at(el, "svg", "height"));
  if (w === null || h === null) return null;
  const tf = at(el, "draw", "transform");
  let x = lengthCm(at(el, "svg", "x")) ?? 0;
  let y = lengthCm(at(el, "svg", "y")) ?? 0;
  let rotation: number | undefined;
  if (tf) {
    // "rotate(a) translate(x y)": ODF turns counter-clockwise about the
    // shape's origin (radians), then moves it.
    const rm = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/.exec(tf);
    const tm = /translate\s*\(\s*([^\s,)]+)[\s,]+([^\s)]+)\s*\)/.exec(tf);
    const a = rm ? -parseFloat(rm[1]) : 0; // clockwise radians
    const tx = tm ? lengthCm(tm[1]) ?? 0 : 0;
    const ty = tm ? lengthCm(tm[2]) ?? 0 : 0;
    const cx = tx + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a);
    const cy = ty + (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
    x = cx - w / 2;
    y = cy - h / 2;
    const deg = ((((a * 180) / Math.PI) % 360) + 360) % 360;
    if (r2(deg) && r2(deg) !== 360) rotation = r2(deg);
  }
  return { x: r2(x * ctx.k), y: r2(y * ctx.k), w: r2(w * ctx.k), h: r2(h * ctx.k), ...(rotation ? { rotation } : {}) };
}

// ------------------------------------------------------------------ text

/** Plain text of a paragraph (text:s, text:tab, text:line-break honoured). */
function paraText(p: Element): string {
  let s = "";
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) s += (c.nodeValue ?? "").replace(/\s+/g, " ");
      else if (c.nodeType === 1) {
        const e = c as Element;
        if (is(e, "text", "s")) s += " ".repeat(Math.max(1, Number(at(e, "text", "c")) || 1));
        else if (is(e, "text", "tab")) s += "\t";
        else if (is(e, "text", "line-break")) s += "\v";
        else if (e.namespaceURI === NS.text || e.namespaceURI === NS.draw) walk(e);
      }
    }
  };
  walk(p);
  return s;
}

/** Paragraphs of a text container (text:p, text:h, lists), with list flags. */
function paragraphsOf(container: Element): { text: string; el: Element; list: boolean }[] {
  const out: { text: string; el: Element; list: boolean }[] = [];
  const walk = (n: Element, list: boolean) => {
    for (const c of kids(n)) {
      if (is(c, "text", "p") || is(c, "text", "h")) out.push({ text: paraText(c), el: c, list });
      else if (is(c, "text", "list")) walk(c, true);
      else if (is(c, "text", "list-item") || is(c, "text", "list-header")) walk(c, list);
    }
  };
  walk(container, false);
  return out;
}

const ALIGN: Record<string, TextAlign> = { start: "left", left: "left", center: "center", end: "right", right: "right", justify: "justify" as TextAlign };

/** Text fields for an element: text, size, colour, weight, alignment. */
function textOf(ctx: Ctx, container: Element, shapeEl: Element): Partial<SlideElement> | null {
  const paras = paragraphsOf(container);
  if (!paras.length || paras.every((p) => !p.text.trim())) return null;
  const first = paras.find((p) => p.text.trim()) ?? paras[0];
  // A span's look applies to the box only when it covers the paragraph
  // (mixed formatting inside a paragraph is not carried over).
  const spans = all(first.el, "text", "span");
  const span = spans.length === 1 && paraText(spans[0]).trim() === first.text.trim() ? spans[0] : null;
  const pStyle = at(first.el, "text", "style-name");
  // Text look: the shape's own style, the paragraph's, then the first span's.
  const tp = new Map<string, string>([
    ...(at(shapeEl, "presentation", "style-name")
      ? ctx.styles.props("presentation", at(shapeEl, "presentation", "style-name"), "text-properties")
      : ctx.styles.props("graphic", at(shapeEl, "draw", "style-name"), "text-properties")),
    ...ctx.styles.props("paragraph", pStyle, "text-properties"),
    ...(span ? ctx.styles.props("text", at(span, "text", "style-name"), "text-properties") : new Map<string, string>()),
  ]);
  const pp = ctx.styles.props("paragraph", pStyle, "paragraph-properties");
  const size = fontPt(tp.get("fo:font-size") ?? null);
  const color = colorOf(tp.get("fo:color"));
  const family = (tp.get("style:font-name") ?? tp.get("fo:font-family") ?? "").replace(/^['"]|['"]$/g, "");
  const align = ALIGN[pp.get("fo:text-align") ?? ""];
  const ul = tp.get("style:text-underline-style");
  return {
    text: paras.map((p) => p.text).join("\n"),
    fontSize: r2((((size ?? 18) * 2.54) / 72) * ctx.k),
    ...(color ? { color } : {}),
    ...(family ? { fontFamily: family } : {}),
    ...(tp.get("fo:font-weight") === "bold" || Number(tp.get("fo:font-weight")) >= 600 ? { bold: true } : {}),
    ...(tp.get("fo:font-style") === "italic" ? { italic: true } : {}),
    ...(ul && ul !== "none" ? { underline: true } : {}),
    ...(align ? { align } : {}),
    ...(paras.some((p) => p.list) ? { list: "bullet" as const } : {}),
  };
}

// ------------------------------------------------------------------ elements

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

async function pictureUrl(ctx: Ctx, href: string | null): Promise<string | null> {
  if (!href) return null;
  if (/^(https?:|data:)/i.test(href)) return href;
  const f = ctx.zip.file(href.replace(/^\.\//, ""));
  if (!f) return null;
  const ext = (href.split(".").pop() ?? "").toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    ctx.warnings.add(`A ${ext || "unknown"} picture could not be shown`);
    return null;
  }
  const b64 = await f.async("base64");
  return `data:${mime};base64,${b64}`;
}

/** The URL a click on the shape opens (presentation:action="show"). */
function clickUrl(ctx: Ctx, el: Element): string | undefined {
  for (const l of all(kid(el, "office", "event-listeners"), "presentation", "event-listener")) {
    const action = at(l, "presentation", "action");
    const href = at(l, "xlink", "href");
    if (action === "show" && href && !href.startsWith("#")) return href;
    if (action && action !== "none") ctx.warnings.add(`A "${action}" click action was not imported`);
  }
  return undefined;
}

const named = (el: Element): Partial<SlideElement> => {
  const name = at(el, "draw", "name");
  const title = kid(el, "svg", "title")?.textContent;
  const desc = kid(el, "svg", "desc")?.textContent;
  return { ...(title || name ? { name: (title || name)! } : {}), ...(desc ? { alt: desc } : {}) };
};

async function readShape(ctx: Ctx, el: Element, out: SlideElement[]): Promise<void> {
  if (is(el, "draw", "g")) {
    for (const c of kids(el)) await readShape(ctx, c, out);
    return;
  }
  if (is(el, "draw", "line") || is(el, "draw", "connector")) {
    const x1 = lengthCm(at(el, "svg", "x1")) ?? 0;
    const y1 = lengthCm(at(el, "svg", "y1")) ?? 0;
    const x2 = lengthCm(at(el, "svg", "x2")) ?? 0;
    const y2 = lengthCm(at(el, "svg", "y2")) ?? 0;
    const look = graphicLook(ctx, el);
    const len = Math.hypot(x2 - x1, y2 - y1) * ctx.k;
    const deg = r2(((((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI) % 360) + 360) % 360);
    const url = clickUrl(ctx, el);
    out.push({
      id: uid(),
      type: "line",
      x: r2(((x1 + x2) / 2) * ctx.k - len / 2),
      y: r2(((y1 + y2) / 2) * ctx.k),
      w: r2(len),
      h: 0,
      ...(deg && deg !== 360 ? { rotation: deg } : {}),
      stroke: look.stroke ?? "#000000",
      strokeWidth: look.strokeWidth || 1,
      ...named(el),
      ...(url ? { url } : {}),
    });
    return;
  }
  const box = boxOf(ctx, el);
  if (!box) return;
  const url = clickUrl(ctx, el);
  if (is(el, "draw", "frame")) {
    const cls = at(el, "presentation", "class");
    const img = kid(el, "draw", "image");
    const tb = kid(el, "draw", "text-box");
    if (img && !tb) {
      const src = await pictureUrl(ctx, at(img, "xlink", "href"));
      if (src) out.push({ id: uid(), type: "image", ...box, src, ...named(el), ...(url ? { url } : {}) });
      return;
    }
    if (tb) {
      const t = textOf(ctx, tb, el);
      if (!t && at(el, "presentation", "placeholder") === "true") return; // an empty placeholder
      const look = graphicLook(ctx, el);
      // A filled or outlined frame: its box is a rectangle under the text.
      if (look.fill || look.stroke)
        out.push({
          id: uid(),
          type: "shape",
          preset: "rect",
          ...box,
          fill: look.fill ?? "none",
          stroke: look.stroke ?? "none",
          strokeWidth: look.stroke ? look.strokeWidth : 0,
        });
      if (!t) return;
      out.push(textElement(box, t, look.valign ?? (cls === "title" ? "middle" : "top"), "left", el, url));
      return;
    }
    if (kid(el, "table", "table")) ctx.warnings.add("A table was not imported");
    else if (kid(el, "draw", "object") || kid(el, "draw", "object-ole")) ctx.warnings.add("An embedded object (chart or OLE) was not imported");
    else if (kid(el, "draw", "plugin")) ctx.warnings.add("A media clip was not imported");
    return;
  }
  let preset: string | null = null;
  if (is(el, "draw", "custom-shape")) {
    const geo = kid(el, "draw", "enhanced-geometry");
    const type = at(geo, "draw", "type");
    preset = presetForOdfType(type);
    if (!preset) {
      ctx.warnings.add(`A "${type ?? "custom"}" shape was imported as a rectangle`);
      preset = "rect";
    }
    if (at(geo, "draw", "mirror-horizontal") === "true") Object.assign(box, { flipH: true });
    if (at(geo, "draw", "mirror-vertical") === "true") Object.assign(box, { flipV: true });
  } else if (is(el, "draw", "rect")) preset = at(el, "draw", "corner-radius") ? "roundRect" : "rect";
  else if (is(el, "draw", "ellipse") || is(el, "draw", "circle")) preset = "ellipse";
  else if (is(el, "draw", "path") || is(el, "draw", "polygon") || is(el, "draw", "polyline")) {
    ctx.warnings.add("A freeform shape was imported as a rectangle");
    preset = "rect";
  }
  if (!preset) return;
  const look = graphicLook(ctx, el);
  out.push({
    id: uid(),
    type: "shape",
    preset,
    ...box,
    fill: look.fill ?? "none",
    stroke: look.stroke ?? "none",
    strokeWidth: look.stroke ? look.strokeWidth : 0,
    ...named(el),
    ...(url ? { url } : {}),
  });
  // Shape text is a text box over the shape (as the pptx reader does).
  const t = textOf(ctx, el, el);
  if (t) out.push(textElement(box, t, look.valign ?? "middle", "center", null, undefined));
}

function textElement(
  box: { x: number; y: number; w: number; h: number; rotation?: number },
  t: Partial<SlideElement>,
  valign: SlideElement["valign"],
  align: TextAlign,
  el: Element | null,
  url: string | undefined,
): SlideElement {
  return {
    id: uid(),
    type: "text",
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    ...(box.rotation ? { rotation: box.rotation } : {}),
    color: "#000000",
    fontFamily: "Arial",
    valign,
    ...t,
    align: t.align ?? align,
    ...(el ? named(el) : {}),
    ...(url ? { url } : {}),
  };
}

// ------------------------------------------------------------------ package

/** True when `bytes` look like an ODP package (its stored mimetype entry). */
export function isOdp(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 120));
  return head.includes("mimetype") && head.includes(ODP_MIME);
}

async function xmlPart(zip: JSZip, path: string): Promise<Document | null> {
  const f = zip.file(path);
  if (!f) return null;
  const doc = parse(await f.async("string"));
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

/** Page size (cm) from the master page used by the first slide. */
function pageSizeCm(styles: Document | null, masterName: string | null): { w: number; h: number } {
  const masters = all(styles, "style", "master-page");
  const master = masters.find((m) => at(m, "style", "name") === masterName) ?? masters[0];
  const layoutName = at(master, "style", "page-layout-name");
  const layouts = all(styles, "style", "page-layout");
  const layout = layouts.find((l) => at(l, "style", "name") === layoutName) ?? layouts[0];
  const p = kid(layout, "style", "page-layout-properties");
  const w = lengthCm(at(p, "fo", "page-width"));
  const h = lengthCm(at(p, "fo", "page-height"));
  return w && h && w > 0 && h > 0 ? { w, h } : { w: 28, h: 15.75 };
}

export async function readOdp(data: ArrayBuffer | Uint8Array | Blob): Promise<OdpImport> {
  const zip = await JSZip.loadAsync(data);
  const content = await xmlPart(zip, "content.xml");
  if (!content) throw new Error("Not an OpenDocument presentation (content.xml missing)");
  const stylesDoc = await xmlPart(zip, "styles.xml");
  const meta = await xmlPart(zip, "meta.xml");
  const styles = new Styles();
  for (const root of [stylesDoc?.documentElement, content.documentElement]) {
    if (!root) continue;
    styles.add(kid(root, "office", "styles"));
    styles.add(kid(root, "office", "automatic-styles"));
  }
  const pres = kid(kid(content.documentElement, "office", "body"), "office", "presentation");
  const pages = kids(pres, "draw", "page");
  const size = pageSizeCm(stylesDoc, at(pages[0], "draw", "master-page-name"));
  const ctx: Ctx = { zip, styles, k: CANVAS_W / size.w, warnings: new Set() };

  const slides: Slide[] = [];
  for (const page of pages) {
    const elements: SlideElement[] = [];
    let notes: string | undefined;
    for (const c of kids(page)) {
      if (is(c, "presentation", "notes")) {
        const frame = kids(c, "draw", "frame").find((f) => at(f, "presentation", "class") === "notes");
        const tb = kid(frame, "draw", "text-box");
        const text = tb ? paragraphsOf(tb).map((p) => p.text.replace(/\v/g, "\n")).join("\n").trim() : "";
        if (text) notes = text;
      } else if (is(c, "anim", "par") || is(c, "anim", "seq")) {
        if (all(c, "anim", "par").length || all(c, "anim", "animate").length || all(c, "anim", "audio").length)
          ctx.warnings.add("Animations were not imported");
      } else if (c.namespaceURI === NS.draw) await readShape(ctx, c, elements);
    }
    const dp = styles.props("drawing-page", at(page, "draw", "style-name"), "drawing-page-properties");
    const bg = dp.get("draw:fill") === "solid" ? colorOf(dp.get("draw:fill-color")) : undefined;
    const slide: Slide = { id: uid(), background: bg ?? "#ffffff", elements };
    if (notes) slide.notes = notes;
    if (dp.get("presentation:visibility") === "hidden") slide.hidden = true;
    slides.push(slide);
  }
  if (!slides.length) slides.push({ id: uid(), background: "#ffffff", elements: [] });

  const deck: DeckDoc = { slides };
  const H = Math.round((CANVAS_W * size.h) / size.w);
  if (H !== DEFAULT_CANVAS_H) deck.size = { w: CANVAS_W, h: H };
  const title = all(meta, "dc", "title")[0]?.textContent?.trim() || undefined;
  return { deck, ...(title ? { title } : {}), warnings: [...ctx.warnings] };
}
