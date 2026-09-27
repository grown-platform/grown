// pptx reader: PowerPoint (PresentationML, ECMA-376 Part 1 §19) → Grown DeckDoc.
//
// Written from the spec with jszip + DOMParser. It maps what Grown's model can
// hold — slides, text boxes, the preset shapes Grown draws, lines, images,
// tables, speaker notes, backgrounds and transitions — and resolves theme
// colours (with their transforms) through lib/colorMods. Everything else is
// skipped and reported in `warnings`.
//
// Geometry: EMUs are scaled so the slide is 960 logical px wide; the deck
// keeps the source's aspect ratio as `DeckDoc.size` (M7; earlier versions
// pillar-boxed a 4:3 deck into 16:9).
//
// Design (M7): the theme becomes `DeckDoc.theme`, slide layouts become
// `DeckDoc.layouts` (placeholders with their text styles, plus decorations),
// slides remember their layout and placeholders, scheme colours and theme
// fonts are kept as `themeRefs`, hidden slides stay hidden, and the
// date/footer/slide-number placeholders become header & footer settings.

import { resolveImportedFont } from "../../../lib/fonts";
import { findTransitionEl, readTiming, readTransitionEl } from "./motionXml";
import JSZip from "jszip";
import { anchorImported, readCommentParts } from "./commentsXml";
import {
  CANVAS_W,
  DEFAULT_CANVAS_H,
  uid,
  type ArrowHead,
  type CellBorder,
  type CellMerge,
  type CellProps,
  type CellSide,
  type DashStyle,
  type TableData,
  type TableLook,
  type DeckDoc,
  type ElementType,
  type Slide,
  type SlideElement,
  type TransitionType,
  type ParaProps,
  type RunStyle,
  type TextAlign,
  type TextInsets,
  type TextRun,
  type DeckHF,
  type DeckTheme,
  type Placeholder,
  type PlaceholderType,
  type SlideFill,
  type SlideHF,
  type SlideLayout,
  type ThemeColors,
  type ThemeRefs,
  DEFAULT_INSET,
} from "../model";
import { BUILTIN_THEMES, formatRef, OFFICE_THEME } from "../theme";
import {
  readColorMods,
  resolveColor,
  toHex,
  type ColorSpec,
} from "../../../lib/colorMods";
import { getUrlType } from "../../../lib/urlType";
import { withRuns } from "../textOps";
import { fromPpAction } from "../links";
import { hasPreset } from "../presetGeometry";
import { isConnectorPreset } from "../presetDefs";
import { cellTextEl, setCellText } from "../tableOps";
import { findTableTemplate, NO_STYLE_NO_GRID } from "../tableStyles";
import { mediaMimeOf, readMediaExt, readSlideChart, readWordArt } from "./objectsXml";
import { parseMediaUrl } from "../media";

export interface PptxImport {
  deck: DeckDoc;
  /** dc:title from docProps/core.xml, when set. */
  title?: string;
  /** Human-readable notes about content that could not be mapped. */
  warnings: string[];
}

const EMU_PER_PT = 12700;

// ------------------------------------------------------------ XML helpers

function parseXml(s: string): Document {
  return new DOMParser().parseFromString(s, "application/xml");
}
/** Direct children with the given local name (namespace-agnostic). */
function kids(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter((c) => c.localName === name);
}
function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name) return c;
  return null;
}
/** Walk a path of direct-child local names. */
function path(
  el: Element | null | undefined,
  ...names: string[]
): Element | null {
  let cur: Element | null | undefined = el;
  for (const n of names) {
    cur = kid(cur, n);
    if (!cur) return null;
  }
  return cur ?? null;
}
function desc(
  el: Element | Document | null | undefined,
  name: string,
): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS("*", name));
}
function num(el: Element | null | undefined, attr: string): number | undefined {
  const v = el?.getAttribute(attr);
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function boolAttr(
  el: Element | null | undefined,
  attr: string,
): boolean | undefined {
  const v = el?.getAttribute(attr);
  if (v === null || v === undefined) return undefined;
  return v === "1" || v === "true";
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Children of an element with `mc:AlternateContent` blocks replaced by their
 * `mc:Fallback` content (or the first `mc:Choice` when there is no fallback),
 * which is the form every consumer is required to understand.
 */
function contentKids(el: Element): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(el.children)) {
    if (c.localName === "AlternateContent") {
      const alt = kid(c, "Fallback") ?? kid(c, "Choice");
      if (alt) out.push(...Array.from(alt.children));
    } else out.push(c);
  }
  return out;
}

// ------------------------------------------------------------ package parts

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
/** Resolve a relationship target against the source part's folder. */
export function resolvePartPath(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = (dirOf(from) ? dirOf(from).split("/") : []).concat(
    target.split("/"),
  );
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}
function relsPathFor(part: string): string {
  const d = dirOf(part);
  const base = part.slice(d.length ? d.length + 1 : 0);
  return `${d ? d + "/" : ""}_rels/${base}.rels`;
}

class Pkg {
  private docs = new Map<string, Document | null>();
  private rels = new Map<string, Map<string, Rel>>();
  constructor(readonly zip: JSZip) {}

  async xml(p: string): Promise<Document | null> {
    if (this.docs.has(p)) return this.docs.get(p)!;
    const f = this.zip.file(p);
    const d = f ? parseXml(await f.async("string")) : null;
    this.docs.set(p, d);
    return d;
  }

  async relsOf(part: string): Promise<Map<string, Rel>> {
    const cached = this.rels.get(part);
    if (cached) return cached;
    const out = new Map<string, Rel>();
    const d = await this.xml(relsPathFor(part));
    for (const r of desc(d, "Relationship")) {
      const external = r.getAttribute("TargetMode") === "External";
      const target = r.getAttribute("Target") || "";
      out.set(r.getAttribute("Id") || "", {
        type: r.getAttribute("Type") || "",
        target: external ? target : resolvePartPath(part, target),
        external,
      });
    }
    this.rels.set(part, out);
    return out;
  }

  async relOfType(part: string, suffix: string): Promise<string | undefined> {
    for (const r of (await this.relsOf(part)).values())
      if (r.type.endsWith("/" + suffix)) return r.target;
    return undefined;
  }
}

// ------------------------------------------------------------ theme + colour

interface Theme {
  scheme: Record<string, string>;
  majorFont?: string;
  minorFont?: string;
  name?: string;
}

function readTheme(doc: Document | null): Theme {
  const scheme: Record<string, string> = {};
  const cs = desc(doc, "clrScheme")[0];
  for (const slot of Array.from(cs?.children ?? [])) {
    const c = slot.children[0];
    if (!c) continue;
    const v =
      c.localName === "sysClr"
        ? c.getAttribute("lastClr")
        : c.getAttribute("val");
    if (v) scheme[slot.localName] = v;
  }
  const fs = desc(doc, "fontScheme")[0];
  const font = (n: string) =>
    path(fs, n, "latin")?.getAttribute("typeface") || undefined;
  const name = doc?.documentElement?.getAttribute("name") || undefined;
  return { scheme, majorFont: font("majorFont"), minorFont: font("minorFont"), name };
}

/** The deck theme for a pptx theme part and master colour map: a built-in
 *  one when the name and colours match (a Grown export), else "imported". */
export function deckThemeOf(t: Theme, clrMap: Record<string, string>): DeckTheme {
  const colors = { ...OFFICE_THEME.colors };
  for (const k of Object.keys(colors) as (keyof ThemeColors)[])
    if (t.scheme[k]) colors[k] = `#${t.scheme[k].toLowerCase()}`;
  const dark = clrMap.bg1 === "dk1";
  const fonts = { major: t.majorFont || "Arial", minor: t.minorFont || "Arial" };
  const same = BUILTIN_THEMES.find(
    (b) =>
      b.name === t.name &&
      !!b.dark === dark &&
      b.fonts.major === fonts.major &&
      b.fonts.minor === fonts.minor &&
      (Object.keys(colors) as (keyof ThemeColors)[]).every((k) => b.colors[k] === colors[k]),
  );
  if (same) return same;
  return { id: "imported", name: t.name || "Imported theme", colors, fonts, ...(dark ? { dark: true } : {}) };
}

/** The theme ref of a scheme colour (the first colour child of `el`), or
 *  undefined for literal colours and `phClr`. */
function schemeRefOf(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const c = Array.from(el.children).find((k) => COLOR_NODES.includes(k.localName));
  if (!c || c.localName !== "schemeClr") return undefined;
  const val = c.getAttribute("val") || "";
  if (!val || val === "phClr") return undefined;
  return formatRef(val, readColorMods(c));
}

/** Preset colour names (ECMA-376 ST_PresetColorVal) that realistic decks use. */
const PRESET_COLORS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  gray: "808080",
  grey: "808080",
  orange: "FFA500",
  purple: "800080",
};

const COLOR_NODES = [
  "srgbClr",
  "schemeClr",
  "sysClr",
  "hslClr",
  "scrgbClr",
  "prstClr",
];

interface ColorCtx {
  theme: Theme;
  /** `<p:clrMap>` aliases: bg1 → lt1, tx1 → dk1, … */
  clrMap: Record<string, string>;
}

function lookupFor(ctx: ColorCtx) {
  return (name: string): string | undefined =>
    ctx.theme.scheme[ctx.clrMap[name] ?? name] ?? ctx.theme.scheme[name];
}

/** Resolve the first colour child of `el` (a solidFill, gs, bgRef, …) to hex. */
function readColor(
  el: Element | null | undefined,
  ctx: ColorCtx,
): string | undefined {
  if (!el) return undefined;
  const c = Array.from(el.children).find((k) =>
    COLOR_NODES.includes(k.localName),
  );
  if (!c) return undefined;
  const mods = readColorMods(c);
  let spec: ColorSpec | null = null;
  switch (c.localName) {
    case "srgbClr":
      spec = { srgb: c.getAttribute("val") || "000000", mods };
      break;
    case "sysClr":
      spec = { srgb: c.getAttribute("lastClr") || "000000", mods };
      break;
    case "prstClr":
      spec = {
        srgb: PRESET_COLORS[c.getAttribute("val") || ""] || "000000",
        mods,
      };
      break;
    case "schemeClr": {
      const name = c.getAttribute("val") || "";
      if (name === "phClr") return undefined;
      spec = { scheme: name, mods };
      break;
    }
    case "hslClr":
      spec = {
        hsl: {
          hue: num(c, "hue") ?? 0,
          sat: num(c, "sat") ?? 0,
          lum: num(c, "lum") ?? 0,
        },
        mods,
      };
      break;
    case "scrgbClr": {
      // Linear-light percentages → sRGB bytes.
      const ch = (a: string) => {
        const l = Math.min(1, Math.max(0, (num(c, a) ?? 0) / 100000));
        const s =
          l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
        return Math.round(s * 255)
          .toString(16)
          .padStart(2, "0");
      };
      spec = { srgb: ch("r") + ch("g") + ch("b"), mods };
      break;
    }
  }
  return spec ? toHex(resolveColor(spec, lookupFor(ctx))) : undefined;
}

/** A gradient fill as a Grown gradient (backgrounds). */
function readGradient(grad: Element, ctx: ColorCtx): Extract<SlideFill, { kind: "gradient" }> | null {
  const stops = desc(grad, "gs")
    .map((g) => ({ pos: r2((num(g, "pos") ?? 0) / 100000), color: readColor(g, ctx) }))
    .filter((g): g is { pos: number; color: string } => !!g.color)
    .sort((a, b) => a.pos - b.pos);
  if (stops.length < 2) return null;
  const lin = kid(grad, "lin");
  const pathEl = kid(grad, "path");
  return {
    kind: "gradient",
    stops,
    ...(pathEl ? { radial: true } : { angle: r2((num(lin, "ang") ?? 0) / 60000) }),
  };
}

/** Fill of a shape/background properties element: hex, "none", or undefined (not specified). */
function readFill(props: Element | null, ctx: ColorCtx): string | undefined {
  if (!props) return undefined;
  if (kid(props, "noFill")) return "none";
  const solid = kid(props, "solidFill");
  if (solid) return readColor(solid, ctx);
  const grad = kid(props, "gradFill");
  if (grad) return readColor(desc(grad, "gs")[0], ctx); // first stop approximates
  const patt = kid(props, "pattFill");
  if (patt) return readColor(kid(patt, "fgClr"), ctx);
  return undefined;
}

interface Stroke {
  color: string;
  width: number;
}
/** Outline: a stroke, "none", or undefined (not specified). */
function readLine(
  props: Element | null,
  ctx: ColorCtx,
): Stroke | "none" | undefined {
  const ln = kid(props, "ln");
  if (!ln) return undefined;
  if (kid(ln, "noFill")) return "none";
  const color = readFill(ln, ctx);
  if (!color || color === "none") return color === "none" ? "none" : undefined;
  const w = num(ln, "w");
  return { color, width: w === undefined ? 1 : r2(w / EMU_PER_PT) };
}

// ------------------------------------------------------------ geometry

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

/** Child → parent EMU mapping for group shapes. Only the offset and scale
 *  are mapped: a group's rotation/flip stays on the Grown group element,
 *  whose members use the group's unrotated frame. */
type Tf = (b: Box) => Box;
const identity: Tf = (b) => b;

function readXfrm(x: Element | null): Box | null {
  const off = kid(x, "off");
  const ext = kid(x, "ext");
  if (!x || !off || !ext) return null;
  return {
    x: num(off, "x") ?? 0,
    y: num(off, "y") ?? 0,
    w: num(ext, "cx") ?? 0,
    h: num(ext, "cy") ?? 0,
    rot: (num(x, "rot") ?? 0) / 60000,
    flipH: !!boolAttr(x, "flipH"),
    flipV: !!boolAttr(x, "flipV"),
  };
}

function groupTf(grpSpPr: Element | null, parent: Tf): Tf {
  const x = kid(grpSpPr, "xfrm");
  const b = readXfrm(x);
  const chOff = kid(x, "chOff");
  const chExt = kid(x, "chExt");
  if (!b || !chOff || !chExt) return parent;
  const cx = num(chOff, "x") ?? 0;
  const cy = num(chOff, "y") ?? 0;
  const chW = num(chExt, "cx") || 0;
  const chH = num(chExt, "cy") || 0;
  const sx = chW ? b.w / chW : 1;
  const sy = chH ? b.h / chH : 1;
  return (c) =>
    parent({
      ...c,
      x: b.x + (c.x - cx) * sx,
      y: b.y + (c.y - cy) * sy,
      w: c.w * sx,
      h: c.h * sy,
    });
}

// ------------------------------------------------------------ presets

/** ECMA preset geometry → the Grown shape that draws it (closest match). */
export function mapPreset(prst: string): ElementType | "line" | null {
  switch (prst) {
    case "rect":
    case "flowChartProcess":
    case "snip1Rect":
    case "snip2SameRect":
    case "plaque":
    case "frame":
      return "rect";
    case "roundRect":
    case "round1Rect":
    case "round2SameRect":
    case "flowChartAlternateProcess":
      return "roundRect";
    case "ellipse":
    case "flowChartConnector":
    case "donut":
      return "ellipse";
    case "triangle":
    case "rtTriangle":
    case "flowChartExtract":
      return "triangle";
    case "diamond":
    case "flowChartDecision":
      return "diamond";
    case "rightArrow":
    case "notchedRightArrow":
    case "stripedRightArrow":
      return "rightArrow";
    case "line":
    case "straightConnector1":
    case "bentConnector2":
    case "bentConnector3":
    case "curvedConnector3":
      return "line";
    default:
      return null;
  }
}

/** Adjust values from `a:avLst` (`<a:gd name="adj" fmla="val 16667"/>`). */
export function readAdjust(prstGeom: Element | null): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const gd of kids(kid(prstGeom, "avLst"), "gd")) {
    const m = /^\s*val\s+(-?\d+(?:\.\d+)?)\s*$/.exec(gd.getAttribute("fmla") ?? "");
    const name = gd.getAttribute("name");
    if (m && name) out[name] = Number(m[1]);
  }
  return Object.keys(out).length ? out : undefined;
}

const DASHES: Record<string, DashStyle> = {
  solid: "solid",
  dash: "dash",
  dashDot: "dashDot",
  lgDash: "lgDash",
  lgDashDot: "lgDashDot",
  lgDashDotDot: "lgDashDotDot",
  sysDash: "sysDash",
  sysDot: "sysDot",
  dot: "sysDot",
  sysDashDot: "dashDot",
  sysDashDotDot: "lgDashDotDot",
};
const HEADS = new Set<ArrowHead>(["triangle", "stealth", "diamond", "oval", "arrow"]);

/** Dash style and arrowheads of an `a:ln`. */
function readLineStyle(spPr: Element | null): {
  dash?: DashStyle;
  headEnd?: ArrowHead;
  tailEnd?: ArrowHead;
} {
  const ln = kid(spPr, "ln");
  const d = kid(ln, "prstDash")?.getAttribute("val");
  const dash = d ? (DASHES[d] ?? "dash") : undefined;
  const head = kid(ln, "headEnd")?.getAttribute("type") as ArrowHead | null;
  const tail = kid(ln, "tailEnd")?.getAttribute("type") as ArrowHead | null;
  return {
    ...(dash && dash !== "solid" ? { dash } : {}),
    ...(head && HEADS.has(head) ? { headEnd: head } : {}),
    ...(tail && HEADS.has(tail) ? { tailEnd: tail } : {}),
  };
}

/**
 * Should a preset import as a legacy Grown shape type? Only when it would
 * look identical: rect/ellipse always, roundRect with Grown's 18 % corner,
 * and triangle/diamond/rightArrow at their default adjusts (and no dash).
 */
function legacyShape(prst: string, adj: Record<string, number> | undefined): ElementType | null {
  const none = !adj;
  switch (prst) {
    case "rect":
    case "ellipse":
    case "diamond":
      return prst;
    case "roundRect":
      return none || Math.abs((adj?.adj ?? 0) - 18000) <= 1 ? "roundRect" : null;
    case "triangle":
      return none || adj?.adj === 50000 ? "triangle" : null;
    case "rightArrow":
      return none ? "rightArrow" : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------ text

interface PartCtx {
  pkg: Pkg;
  part: string;
  color: ColorCtx;
  /** Slide part path → Grown slide id (slide-jump hyperlinks). */
  slideIds?: Map<string, string>;
}

/** The inheritance chain used to resolve text/paragraph properties. */
interface TextChain {
  /** Ordered list-style elements (`a:lstStyle` / `p:titleStyle` …), most specific first. */
  lists: (Element | null)[];
  /** bodyPr elements, most specific first. */
  bodyPrs: (Element | null)[];
  /** `<p:style><a:fontRef>` of the shape: the text colour when runs set none. */
  fontRef: Element | null;
}

function lvlPPr(list: Element | null, lvl: number): Element | null {
  return kid(list, `lvl${lvl}pPr`);
}

function firstAttr(els: (Element | null)[], attr: string): string | undefined {
  for (const e of els) {
    const v = e?.getAttribute(attr);
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}
function firstKid(els: (Element | null)[], name: string): Element | null {
  for (const e of els) {
    const k = kid(e, name);
    if (k) return k;
  }
  return null;
}

/** A paragraph's text; `a:br` becomes `br` ("\n" for notes and table
 *  cells, "\v" — a line break inside the paragraph — for text boxes). */
function paraText(p: Element, br = "\n"): string {
  let s = "";
  for (const c of Array.from(p.children)) {
    if (c.localName === "r" || c.localName === "fld")
      s += kid(c, "t")?.textContent ?? "";
    else if (c.localName === "br") s += br;
  }
  return s;
}

function txBodyText(txBody: Element | null): string {
  return kids(txBody, "p").map((p) => paraText(p)).join("\n");
}

/**
 * External hyperlink target for a relationship id. Only absolute web and
 * mail links are kept: relative targets are files next to the original deck,
 * and `unsafe`/`invalid` targets (lib/urlType) are dropped.
 */
async function linkFor(
  rid: string | null | undefined,
  pc: PartCtx,
): Promise<string | undefined> {
  if (!rid) return undefined;
  const rel = (await pc.pkg.relsOf(pc.part)).get(rid);
  if (!rel || !rel.external || !rel.type.endsWith("/hyperlink"))
    return undefined;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(rel.target)) return undefined;
  const t = getUrlType(rel.target);
  return t === "http" || t === "email" ? rel.target : undefined;
}

/**
 * A text hyperlink (`a:hlinkClick`): an external web/mail target, or a
 * slide jump (`ppaction://hlinkshowjump?jump=…`, or `hlinksldjump` to the
 * slide its relationship names) as a Grown `#slide:` link.
 */
async function hlinkFor(h: Element | null, pc: PartCtx): Promise<string | undefined> {
  if (!h) return undefined;
  const action = h.getAttribute("action");
  if (action && /^ppaction:/i.test(action)) {
    let target: string | undefined;
    if (/hlinksldjump/i.test(action)) {
      const rel = (await pc.pkg.relsOf(pc.part)).get(rid(h, "id") || "");
      if (rel && !rel.external) target = pc.slideIds?.get(rel.target);
    }
    return fromPpAction(action, target) ?? undefined;
  }
  return linkFor(rid(h, "id"), pc);
}

interface TextProps {
  text: string;
  runs?: TextRun[];
  paras?: ParaProps[];
  baseline?: "super" | "sub";
  bulletStyle?: string;
  spaceBefore?: number;
  spaceAfter?: number;
  insets?: TextInsets;
  autofit?: "shrink";
  rtl?: boolean;
  vert?: "vert" | "vert270";
  fontSize: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  align?: TextAlign;
  valign?: "top" | "middle" | "bottom";
  list?: "bullet" | "number";
  lineSpacing?: number;
  url?: string;
  /** Theme colour / font the element-wide style came from. */
  colorRef?: string;
  fontRef?: "major" | "minor";
}

const ALGN: Record<string, TextAlign> = { ctr: "center", r: "right", just: "justify", dist: "justify" };

async function readText(
  txBody: Element,
  chain: TextChain,
  pc: PartCtx,
  scale: number,
  allowEmpty = false,
): Promise<TextProps | null> {
  const paras = kids(txBody, "p");
  const text = paras.map((q) => paraText(q, "\v")).join("\n");
  const empty = !text.replace(/\v/g, "").trim();
  if (empty && !allowEmpty) return null;
  const shapeList = kid(txBody, "lstStyle");
  const fontScale =
    (num(path(txBody, "bodyPr", "normAutofit"), "fontScale") ?? 100000) /
    100000;

  /** The pPr chain of a paragraph (its own, then the list styles at its level). */
  const pPrChain = (p: Element) => {
    const pPr = kid(p, "pPr");
    const lvl = (num(pPr, "lvl") ?? 0) + 1;
    return [pPr, ...[shapeList, ...chain.lists].map((l) => lvlPPr(l, lvl))];
  };
  /** Full effective character style of a run (or `a:br`/endParaRPr). */
  const runStyle = async (run: Element | null, lvlPPrs: (Element | null)[]): Promise<RunStyle> => {
    const rPr = kid(run, "rPr") ?? (run?.localName === "endParaRPr" ? run : null);
    const rPrs = [rPr, ...lvlPPrs.map((e) => kid(e, "defRPr"))];
    const sz = Number(firstAttr(rPrs, "sz") ?? 1800);
    let fontFamily = firstKid(rPrs, "latin")?.getAttribute("typeface") || undefined;
    if (fontFamily === "+mj-lt") fontFamily = pc.color.theme.majorFont;
    else if (fontFamily === "+mn-lt") fontFamily = pc.color.theme.minorFont;
    // Keep the name; Calibri & co. render with the bundled fallback (CC7).
    if (fontFamily) fontFamily = resolveImportedFont(fontFamily) || undefined;
    const url = await hlinkFor(kid(rPr, "hlinkClick"), pc);
    const u = firstAttr(rPrs, "u");
    const strike = firstAttr(rPrs, "strike");
    const bl = Number(firstAttr(rPrs, "baseline") ?? 0);
    // Run → paragraph → shape → layout/master placeholder, then the shape
    // style's fontRef, then the master text styles and presentation defaults.
    const colorFill = firstKid(rPrs.slice(0, 5), "solidFill");
    const fallbackFill = firstKid(rPrs.slice(5), "solidFill");
    const b = firstAttr(rPrs, "b");
    const i = firstAttr(rPrs, "i");
    const st: RunStyle = {
      fontSize: r2((sz / 100) * EMU_PER_PT * scale * fontScale),
      bold: b === "1" || b === "true",
      italic: i === "1" || i === "true",
      // A linked run is underlined by PowerPoint's hyperlink style; don't bake that in.
      underline: !url && !!u && u !== "none",
      strike: !!strike && strike !== "noStrike",
      color:
        readColor(colorFill, pc.color) ??
        readColor(chain.fontRef, pc.color) ??
        readColor(fallbackFill, pc.color) ??
        "#000000",
    };
    if (fontFamily) st.fontFamily = fontFamily;
    if (bl > 0) st.baseline = "super";
    else if (bl < 0) st.baseline = "sub";
    if (url) st.url = url;
    return st;
  };

  // Element-wide style comes from the first paragraph with text, and its
  // first run (an empty placeholder: its end-of-paragraph properties).
  const p0 = paras.find((q) => paraText(q).trim()) ?? paras[0] ?? null;
  const lvlPPrs = p0 ? pPrChain(p0) : [null, ...[shapeList, ...chain.lists].map((l) => lvlPPr(l, 1))];
  const run0 =
    (p0 &&
      Array.from(p0.children).find(
        (c) =>
          (c.localName === "r" || c.localName === "fld") &&
          (kid(c, "t")?.textContent ?? "") !== "",
      )) ??
    (empty ? kid(p0, "endParaRPr") : null);
  const base = await runStyle(run0, lvlPPrs);
  // Theme refs of the element-wide colour and font (same precedence as runStyle).
  const refs = (() => {
    const rPr = kid(run0, "rPr") ?? (run0?.localName === "endParaRPr" ? run0 : null);
    const rPrs = [rPr, ...lvlPPrs.map((e) => kid(e, "defRPr"))];
    const colorEl = firstKid(rPrs.slice(0, 5), "solidFill") ?? chain.fontRef ?? firstKid(rPrs.slice(5), "solidFill");
    const face = firstKid(rPrs, "latin")?.getAttribute("typeface");
    return {
      colorRef: schemeRefOf(colorEl),
      fontRef: face === "+mj-lt" ? ("major" as const) : face === "+mn-lt" ? ("minor" as const) : undefined,
    };
  })();
  const algn = firstAttr(lvlPPrs, "algn");
  const align: TextAlign = ALGN[algn ?? ""] ?? "left";
  const anchor = firstAttr(chain.bodyPrs, "anchor");
  if (empty) {
    const bodyPr0 = chain.bodyPrs;
    const ins0 = (a: string, def: number) => r2((num(bodyPr0.find((b) => b?.hasAttribute(a)) ?? null, a) ?? def) * scale);
    const insets0: TextInsets = { l: ins0("lIns", 91440), t: ins0("tIns", 45720), r: ins0("rIns", 91440), b: ins0("bIns", 45720) };
    return {
      text: "",
      fontSize: base.fontSize!,
      fontFamily: base.fontFamily,
      bold: base.bold,
      italic: base.italic,
      color: base.color,
      align,
      valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
      insets: Object.values(insets0).every((v) => Math.abs(v - DEFAULT_INSET) < 0.01) ? undefined : insets0,
      ...refs,
    };
  }
  const lnSpcPct = num(path(firstKid(lvlPPrs, "lnSpc"), "spcPct"), "val");
  const spc = (name: string) => {
    const pts = num(path(firstKid(lvlPPrs, name), "spcPts"), "val");
    return pts ? r2((pts / 100) * EMU_PER_PT * scale) : undefined;
  };

  // Bullets: the first level in the chain that says anything about them decides.
  let list: TextProps["list"];
  let bulletStyle: string | undefined;
  for (const e of lvlPPrs) {
    if (!e) continue;
    if (kid(e, "buNone")) break;
    const auto = kid(e, "buAutoNum");
    if (auto) {
      list = "number";
      const t = auto.getAttribute("type") || "arabicPeriod";
      if (t !== "arabicPeriod") bulletStyle = t;
      break;
    }
    const ch = kid(e, "buChar");
    if (ch || kid(e, "buBlip")) {
      list = "bullet";
      const c = ch?.getAttribute("char");
      if (c && c !== "•") bulletStyle = c;
      break;
    }
  }

  // Runs and paragraphs (F1): every run's effective style, normalised
  // against the element style by withRuns.
  const runs: TextRun[] = [];
  const paraProps: ParaProps[] = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi];
    const chainP = pPrChain(p);
    const pPr = kid(p, "pPr");
    const props: ParaProps = {};
    const lvl = num(pPr, "lvl") ?? 0;
    if (lvl) props.level = Math.min(8, lvl);
    const pa = ALGN[firstAttr(chainP, "algn") ?? ""] ?? "left";
    if (pa !== align) props.align = pa;
    paraProps.push(props);
    let last: RunStyle = base;
    for (const c of Array.from(p.children)) {
      if (c.localName === "r" || c.localName === "fld") {
        const t = kid(c, "t")?.textContent ?? "";
        if (!t) continue;
        last = await runStyle(c, chainP);
        runs.push({ ...last, text: t });
      } else if (c.localName === "br") runs.push({ ...last, text: "\v" });
    }
    if (pi < paras.length - 1) runs.push({ ...last, text: "\n" });
  }

  // Body: insets (spec defaults 0.1 in / 0.05 in), autofit, vertical text.
  const bodyPr = chain.bodyPrs;
  const ins = (a: string, def: number) => r2((num(bodyPr.find((b) => b?.hasAttribute(a)) ?? null, a) ?? def) * scale);
  const insets: TextInsets = { l: ins("lIns", 91440), t: ins("tIns", 45720), r: ins("rIns", 91440), b: ins("bIns", 45720) };
  const vertAttr = firstAttr(bodyPr, "vert");
  const vert = vertAttr === "vert" || vertAttr === "eaVert" ? "vert" : vertAttr === "vert270" ? "vert270" : undefined;
  const autofit = bodyPr.some((b) => kid(b, "normAutofit")) && !kid(bodyPr[0], "noAutofit") ? "shrink" : undefined;

  const shaped = withRuns(
    {
      id: "",
      type: "text",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      text,
      fontSize: base.fontSize,
      ...(base.fontFamily ? { fontFamily: base.fontFamily } : {}),
      ...(base.bold ? { bold: true } : {}),
      ...(base.italic ? { italic: true } : {}),
      ...(base.underline ? { underline: true } : {}),
      ...(base.strike ? { strike: true } : {}),
      ...(base.baseline ? { baseline: base.baseline } : {}),
      ...(base.color ? { color: base.color } : {}),
    },
    runs,
    paraProps,
  );
  // One link over the whole text is the element's link.
  let url: string | undefined;
  let outRuns = shaped.runs;
  const linked = outRuns?.filter((r) => r.text.replace(/[\n\v]/g, ""));
  if (outRuns && linked?.length && linked.every((r) => r.url && r.url === linked[0].url)) {
    url = linked[0].url;
    const reshaped = withRuns({ ...shaped, runs: undefined }, outRuns.map((r) => ({ ...r, url: undefined })), shaped.paras);
    outRuns = reshaped.runs;
    Object.assign(shaped, reshaped);
  }

  const out: TextProps = {
    text: shaped.text || "",
    fontSize: shaped.fontSize ?? base.fontSize!,
    fontFamily: shaped.fontFamily,
    bold: shaped.bold,
    italic: shaped.italic,
    underline: shaped.underline,
    strike: shaped.strike,
    baseline: shaped.baseline,
    color: shaped.color,
    align,
    valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    list,
    bulletStyle,
    lineSpacing: lnSpcPct !== undefined ? r2(lnSpcPct / 100000) : undefined,
    spaceBefore: spc("spcBef"),
    spaceAfter: spc("spcAft"),
    url,
    runs: outRuns,
    paras: shaped.paras,
    insets: Object.values(insets).every((v) => Math.abs(v - DEFAULT_INSET) < 0.01) ? undefined : insets,
    autofit,
    rtl: firstAttr(lvlPPrs, "rtl") === "1" || undefined,
    vert,
    // The refs hold only while the element-wide value is the base run's.
    ...(refs.colorRef && shaped.color === base.color ? { colorRef: refs.colorRef } : {}),
    ...(refs.fontRef && shaped.fontFamily === base.fontFamily ? { fontRef: refs.fontRef } : {}),
  };
  return out;
}

const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function rid(el: Element | null, name: string): string | null {
  return (
    el?.getAttributeNS(R_NS, name) ?? el?.getAttribute(`r:${name}`) ?? null
  );
}

// ------------------------------------------------------------ placeholders

interface PhInfo {
  type: string;
  idx?: string;
}
function phOf(nvPr: Element | null): PhInfo | null {
  const ph = kid(nvPr, "ph");
  if (!ph) return null;
  return {
    type: ph.getAttribute("type") || "obj",
    idx: ph.getAttribute("idx") ?? undefined,
  };
}
function spPh(sp: Element): PhInfo | null {
  const nv = Array.from(sp.children).find((c) => c.localName.startsWith("nv"));
  return phOf(kid(nv ?? null, "nvPr"));
}
const TITLE_TYPES = new Set(["title", "ctrTitle"]);
function phFamily(t: string): string {
  return TITLE_TYPES.has(t)
    ? "title"
    : t === "subTitle" || t === "obj"
      ? "body"
      : t;
}
/** Find the placeholder in a layout/master that `ph` inherits from. */
function findPh(
  tree: Element | null,
  ph: PhInfo,
  byIdx: boolean,
): Element | null {
  if (!tree) return null;
  const sps = desc(tree, "sp");
  if (byIdx && ph.idx !== undefined) {
    const m = sps.find((s) => spPh(s)?.idx === ph.idx);
    if (m) return m;
  }
  const fam = phFamily(ph.type);
  return (
    sps.find((s) => spPh(s)?.type === ph.type) ??
    sps.find((s) => {
      const q = spPh(s);
      return q ? phFamily(q.type) === fam : false;
    }) ??
    null
  );
}

// ------------------------------------------------------------ slides

interface SlideCtx {
  pc: PartCtx;
  scale: number;
  ox: number;
  oy: number;
  layoutTree: Element | null;
  masterTree: Element | null;
  masterTxStyles: Element | null;
  defaultTextStyle: Element | null;
  warnings: Set<string>;
  /** Preset names drawn as a rectangle (or dropped, for open freeforms). */
  unsupported: Set<string>;
  /** Per shape tree: `cNvPr@id` → Grown element id, and connectors whose
   *  `stCxn`/`endCxn` still name a cNvPr id (resolved by resolveGlue). */
  glue?: GlueCtx;
  /** Reading a layout: placeholders are kept empty (their text is a prompt). */
  layoutMode?: boolean;
  /** The slide's date/footer/number placeholders (header & footer). */
  hf?: SlideHFRead;
  /** Slide tree only: `cNvPr@id` → the Grown elements read from that
   *  shape (animation targets). */
  spids?: Map<string, string[]>;
}

interface SlideHFRead {
  dt?: { text: string; auto: boolean };
  ftr?: string;
  sldNum?: boolean;
}

const PH_TYPES = new Set<PlaceholderType>(["title", "ctrTitle", "subTitle", "body", "obj", "pic", "dt", "ftr", "sldNum"]);
const HF_PH = new Set(["dt", "ftr", "sldNum"]);

/** A Grown placeholder tag for a pptx `p:ph` (unknown types → obj). */
function placeholderOf(ph: PhInfo): Placeholder {
  const type = (PH_TYPES.has(ph.type as PlaceholderType) ? ph.type : "obj") as PlaceholderType;
  const idx = ph.idx !== undefined && /^\d+$/.test(ph.idx) ? Number(ph.idx) : undefined;
  return { type, ...(idx !== undefined && idx < 2 ** 31 ? { idx } : {}) };
}

interface GlueCtx {
  ids: Map<string, string>;
  pending: { el: SlideElement; st?: [string, number]; end?: [string, number] }[];
}

/** Read one shape tree, then resolve connector glue within it. */
async function readTreeGlued(
  tree: Element,
  sc: SlideCtx,
  out: SlideElement[],
  skipPh: boolean,
) {
  const glue: GlueCtx = { ids: new Map(), pending: [] };
  await readTree(tree, identity, { ...sc, glue }, out, skipPh);
  for (const p of glue.pending) {
    const st = p.st && glue.ids.get(p.st[0]);
    const end = p.end && glue.ids.get(p.end[0]);
    if (st) p.el.stCxn = { id: st, idx: p.st![1] };
    if (end) p.el.endCxn = { id: end, idx: p.end![1] };
  }
}

/**
 * A custom geometry that is a single straight segment (moveTo + one lnTo),
 * as box fractions; null otherwise. PowerPoint and ODF converters write
 * many connectors this way.
 */
function straightSegment(
  cust: Element | null,
): [number, number, number, number] | null {
  const paths = kids(kid(cust, "pathLst"), "path");
  if (paths.length !== 1) return null;
  const p = paths[0];
  const cmds = Array.from(p.children);
  if (
    cmds.length !== 2 ||
    cmds[0].localName !== "moveTo" ||
    cmds[1].localName !== "lnTo"
  )
    return null;
  const pt = (c: Element) => kid(c, "pt");
  const w = num(p, "w") || 1;
  const h = num(p, "h") || 1;
  const a = pt(cmds[0]);
  const b = pt(cmds[1]);
  const n = (v: number | undefined, d: number) => (d ? (v ?? 0) / d : 0);
  return [
    n(num(a, "x"), w),
    n(num(a, "y"), h),
    n(num(b, "x"), w),
    n(num(b, "y"), h),
  ];
}

function toPx(b: Box, sc: SlideCtx) {
  return {
    x: r2(sc.ox + b.x * sc.scale),
    y: r2(sc.oy + b.y * sc.scale),
    w: r2(b.w * sc.scale),
    h: r2(b.h * sc.scale),
  };
}
function orient(b: Box) {
  const rot = (((Math.round(b.rot * 100) / 100) % 360) + 360) % 360;
  return {
    ...(rot ? { rotation: rot } : {}),
    ...(b.flipH ? { flipH: true } : {}),
    ...(b.flipV ? { flipV: true } : {}),
  };
}

/**
 * A Grown line (a horizontal segment rotated about its centre) from a segment
 * of a shape box, given as box fractions (default: the top-left → bottom-right
 * diagonal, which is how preset lines and connectors are drawn).
 */
function lineFromBox(
  b: Box,
  sc: SlideCtx,
  seg: [number, number, number, number] = [0, 0, 1, 1],
) {
  let [u1, v1, u2, v2] = seg;
  if (b.flipH) [u1, u2] = [1 - u1, 1 - u2];
  if (b.flipV) [v1, v2] = [1 - v1, 1 - v2];
  const x1 = b.x + u1 * b.w,
    y1 = b.y + v1 * b.h,
    x2 = b.x + u2 * b.w,
    y2 = b.y + v2 * b.h;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const a = (b.rot * Math.PI) / 180;
  const rotp = (x: number, y: number) => [
    cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  ];
  const [p1x, p1y] = rotp(x1, y1);
  const [p2x, p2y] = rotp(x2, y2);
  const len = Math.hypot(p2x - p1x, p2y - p1y);
  const deg =
    ((((Math.atan2(p2y - p1y, p2x - p1x) * 180) / Math.PI) % 360) + 360) % 360;
  const mx = (p1x + p2x) / 2;
  const my = (p1y + p2y) / 2;
  const rot = Math.round(deg * 100) / 100;
  return {
    x: r2(sc.ox + (mx - len / 2) * sc.scale),
    y: r2(sc.oy + my * sc.scale),
    w: r2(len * sc.scale),
    h: 0,
    ...(rot && rot !== 360 ? { rotation: rot } : {}),
  };
}

async function readSp(
  sp: Element,
  tf: Tf,
  sc: SlideCtx,
  out: SlideElement[],
  isCxn: boolean,
) {
  const { pc } = sc;
  const ph = spPh(sp);
  // Slide date/footer/number placeholders become header & footer settings.
  if (ph && HF_PH.has(ph.type) && !sc.layoutMode) {
    if (sc.hf) {
      const body = kid(sp, "txBody");
      const t = txBodyText(body).trim();
      if (ph.type === "sldNum") sc.hf.sldNum = true;
      else if (ph.type === "ftr") sc.hf.ftr = t;
      else {
        const auto = desc(body, "fld").some((f) => (f.getAttribute("type") || "").startsWith("datetime"));
        sc.hf.dt = { text: t, auto };
      }
    }
    return;
  }
  const layoutPh = ph ? findPh(sc.layoutTree, ph, true) : null;
  const masterPh = ph ? findPh(sc.masterTree, ph, false) : null;
  const spPr = kid(sp, "spPr");
  const rawBox =
    readXfrm(kid(spPr, "xfrm")) ??
    readXfrm(path(layoutPh, "spPr", "xfrm")) ??
    readXfrm(path(masterPh, "spPr", "xfrm"));
  if (!rawBox) return;
  const box = tf(rawBox);
  const prstEl = kid(spPr, "prstGeom");
  const prst =
    prstEl?.getAttribute("prst") ?? (kid(spPr, "custGeom") ? "custom" : "rect");
  const style = kid(sp, "style");
  const nvSpPr =
    Array.from(sp.children).find((c) => c.localName.startsWith("nv")) ?? null;
  const cNvPr = kid(nvSpPr, "cNvPr");
  const shapeUrl = await linkFor(rid(kid(cNvPr, "hlinkClick"), "id"), pc);

  const fill =
    readFill(spPr, pc.color) ??
    (num(kid(style, "fillRef"), "idx")
      ? readColor(kid(style, "fillRef"), pc.color)
      : undefined);
  const lineSpec = readLine(spPr, pc.color);
  const line: Stroke | undefined =
    lineSpec === "none"
      ? undefined
      : (lineSpec ??
        (num(kid(style, "lnRef"), "idx")
          ? (() => {
              const c = readColor(kid(style, "lnRef"), pc.color);
              return c ? { color: c, width: 1 } : undefined;
            })()
          : undefined));

  // Theme refs of the fill and outline (M7).
  const fillRef =
    readFill(spPr, pc.color) !== undefined
      ? schemeRefOf(kid(spPr, "solidFill"))
      : num(kid(style, "fillRef"), "idx")
        ? schemeRefOf(kid(style, "fillRef"))
        : undefined;
  const lnEl = kid(spPr, "ln");
  const strokeRef =
    lineSpec && lineSpec !== "none"
      ? schemeRefOf(kid(lnEl, "solidFill"))
      : lineSpec === undefined && num(kid(style, "lnRef"), "idx")
        ? schemeRefOf(kid(style, "lnRef"))
        : undefined;
  const seg = prst === "custom" ? straightSegment(kid(spPr, "custGeom")) : null;
  const adj = readAdjust(prstEl);
  const lineStyle = readLineStyle(spPr);
  const cNvPrId = cNvPr?.getAttribute("id") ?? undefined;
  const nvCxn = kid(nvSpPr, "cNvCxnSpPr");
  const glueRef = (n: string): [string, number] | undefined => {
    const e = kid(nvCxn, n);
    const id = e?.getAttribute("id");
    return id ? [id, Number(e!.getAttribute("idx")) || 0] : undefined;
  };
  const st = glueRef("stCxn");
  const end = glueRef("endCxn");
  // Line presets become Grown connectors (arrowheads, dash, elbows, curves,
  // glue); a plain straight line stays a legacy line.
  if ((isCxn || isConnectorPreset(prst)) && hasPreset(prst)) {
    const plain =
      (prst === "line" || prst === "straightConnector1") &&
      !lineStyle.dash &&
      !lineStyle.headEnd &&
      !lineStyle.tailEnd &&
      !st &&
      !end;
    if (!plain) {
      if (!line) return;
      const el: SlideElement = {
        id: uid(),
        type: "connector",
        preset: prst,
        ...toPx(box, sc),
        ...orient(box),
        ...(adj ? { adj } : {}),
        stroke: line.color,
        strokeWidth: line.width,
        ...lineStyle,
        ...(shapeUrl ? { url: shapeUrl } : {}),
      };
      out.push(el);
      if (cNvPrId) sc.glue?.ids.set(cNvPrId, el.id);
      if (st || end) sc.glue?.pending.push({ el, st, end });
      return;
    }
  }
  const kind = isCxn || seg ? "line" : mapPreset(prst);
  if (kind === "line") {
    if (!line) return;
    out.push({
      id: uid(),
      type: "line",
      ...lineFromBox(box, sc, seg ?? undefined),
      stroke: line.color,
      strokeWidth: line.width,
      ...(shapeUrl ? { url: shapeUrl } : {}),
    });
    return;
  }

  const hasFill = !!fill && fill !== "none";
  if (prst === "custom" && !hasFill && line) {
    sc.unsupported.add("freeform");
    return;
  }
  const visible = hasFill || !!line;
  if (visible) {
    const legacy = lineStyle.dash ? null : legacyShape(prst, adj);
    const preset = !legacy && hasPreset(prst);
    let type: ElementType = legacy ?? (preset ? "shape" : (kind ?? "rect"));
    if (!legacy && !preset && !kind) sc.unsupported.add(prst === "custom" ? "freeform" : prst);
    if (type === "text") type = "rect";
    const el: SlideElement = {
      id: uid(),
      type,
      ...(preset ? { preset: prst } : {}),
      ...toPx(box, sc),
      ...orient(box),
      ...(preset && adj ? { adj } : {}),
      fill: hasFill ? fill : "none",
      stroke: line ? line.color : "none",
      strokeWidth: line ? line.width : 0,
      ...(preset && lineStyle.dash ? { dash: lineStyle.dash } : {}),
      ...(shapeUrl ? { url: shapeUrl } : {}),
    };
    const refs: ThemeRefs = {};
    if (hasFill && fillRef) refs.fill = fillRef;
    if (line && strokeRef) refs.stroke = strokeRef;
    if (Object.keys(refs).length) el.themeRefs = refs;
    out.push(el);
    if (cNvPrId) sc.glue?.ids.set(cNvPrId, el.id);
  }

  const txBody = kid(sp, "txBody");
  if (!txBody) return;
  const fam = ph ? phFamily(ph.type) : null;
  const txStyle =
    fam === "title"
      ? kid(sc.masterTxStyles, "titleStyle")
      : ph
        ? kid(sc.masterTxStyles, "bodyStyle")
        : kid(sc.masterTxStyles, "otherStyle");
  const chain: TextChain = {
    lists: [
      path(layoutPh, "txBody", "lstStyle"),
      path(masterPh, "txBody", "lstStyle"),
      txStyle,
      sc.defaultTextStyle,
    ],
    bodyPrs: [
      kid(txBody, "bodyPr"),
      path(layoutPh, "txBody", "bodyPr"),
      path(masterPh, "txBody", "bodyPr"),
    ],
    fontRef: kid(style, "fontRef"),
  };
  const t = await readText(txBody, chain, pc, sc.scale, !!ph);
  if (!t) return;
  if (sc.layoutMode && ph) {
    // A layout's placeholder text is its prompt.
    t.text = "";
    t.runs = undefined;
    t.paras = undefined;
    t.url = undefined;
  }
  const el: SlideElement = {
    id: uid(),
    type: "text",
    ...toPx(box, sc),
    ...orient(box),
    text: t.text,
    fontSize: t.fontSize,
    ...(t.fontFamily ? { fontFamily: t.fontFamily } : {}),
    ...(t.bold ? { bold: true } : {}),
    ...(t.italic ? { italic: true } : {}),
    ...(t.underline ? { underline: true } : {}),
    ...(t.strike ? { strike: true } : {}),
    ...(t.baseline ? { baseline: t.baseline } : {}),
    color: t.color ?? "#000000",
    align: t.align,
    valign: t.valign,
    ...(t.list ? { list: t.list } : {}),
    ...(t.bulletStyle ? { bulletStyle: t.bulletStyle } : {}),
    ...(t.lineSpacing !== undefined ? { lineSpacing: t.lineSpacing } : {}),
    ...(t.spaceBefore ? { spaceBefore: t.spaceBefore } : {}),
    ...(t.spaceAfter ? { spaceAfter: t.spaceAfter } : {}),
    ...(t.runs ? { runs: t.runs } : {}),
    ...(t.paras ? { paras: t.paras } : {}),
    ...(t.insets ? { insets: t.insets } : {}),
    ...(t.autofit ? { autofit: t.autofit } : {}),
    ...(t.rtl ? { rtl: true } : {}),
    ...(t.vert ? { vert: t.vert } : {}),
    ...((t.url ?? (visible ? undefined : shapeUrl))
      ? { url: t.url ?? shapeUrl }
      : {}),
    ...(ph ? { placeholder: placeholderOf(ph) } : {}),
  };
  if (t.colorRef || t.fontRef)
    el.themeRefs = { ...(t.colorRef ? { color: t.colorRef } : {}), ...(t.fontRef ? { font: t.fontRef } : {}) };
  // Word art (M11): run outline/gradient/effects and the body's warp.
  const art = readWordArt(txBody, (c) => (c ? readColor(c, pc.color) : undefined));
  if (art) {
    el.wordArt = art;
    if (art.gradient && !t.color) el.color = art.gradient.from;
  }
  out.push(el);
  if (!visible && cNvPrId) sc.glue?.ids.set(cNvPrId, el.id);
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
};

async function mediaDataUrl(
  pc: PartCtx,
  rId: string | null,
  sc: SlideCtx,
): Promise<string | undefined> {
  if (!rId) return undefined;
  const rel = (await pc.pkg.relsOf(pc.part)).get(rId);
  if (!rel || rel.external) return rel?.target;
  const ext = rel.target.split(".").pop()?.toLowerCase() || "";
  const mime = IMAGE_MIME[ext];
  const f = pc.pkg.zip.file(rel.target);
  if (!f) return undefined;
  if (!mime) {
    sc.warnings.add(
      `Image format .${ext} is not supported by browsers and was skipped`,
    );
    return undefined;
  }
  return `data:${mime};base64,${await f.async("base64")}`;
}

async function readPic(
  pic: Element,
  tf: Tf,
  sc: SlideCtx,
  out: SlideElement[],
) {
  const spPr = kid(pic, "spPr");
  const raw = readXfrm(kid(spPr, "xfrm"));
  if (!raw) return;
  const box = tf(raw);
  const nvPr = path(pic, "nvPicPr", "nvPr");
  if (kid(nvPr, "videoFile") || kid(nvPr, "audioFile")) {
    await readMedia(pic, nvPr!, box, sc, out);
    return;
  }
  const src = await mediaDataUrl(
    sc.pc,
    rid(path(pic, "blipFill", "blip"), "embed"),
    sc,
  );
  if (!src) return;
  const url = await linkFor(
    rid(path(pic, "nvPicPr", "cNvPr", "hlinkClick"), "id"),
    sc.pc,
  );
  out.push({
    id: uid(),
    type: "image",
    ...toPx(box, sc),
    ...orient(box),
    src,
    ...(url ? { url } : {}),
    ...readPictureProps(pic, sc),
  });
}

/** Largest embedded clip imported (bigger ones are skipped with a warning). */
const MAX_IMPORT_MEDIA = 100 << 20;

/** A video/audio `p:pic` (M11): the embedded file (p14:media) or the linked
 *  URL (a:videoFile/a:audioFile r:link), its poster picture, and Grown's
 *  playback options. */
async function readMedia(pic: Element, nvPr: Element, box: Box, sc: SlideCtx, out: SlideElement[]) {
  const pc = sc.pc;
  const rels = await pc.pkg.relsOf(pc.part);
  const fileEl = kid(nvPr, "videoFile") ?? kid(nvPr, "audioFile")!;
  const ext = readMediaExt(nvPr);
  const kind = ext.kind ?? (fileEl.localName === "audioFile" ? "audio" : "video");
  const embedId = rid(desc(nvPr, "media")[0] ?? null, "embed");
  const linkRel = rels.get(rid(fileEl, "link") ?? "");
  let src: string | undefined;
  let mime: string | undefined;
  const embedRel = embedId ? rels.get(embedId) : undefined;
  const internal = embedRel && !embedRel.external ? embedRel : linkRel && !linkRel.external ? linkRel : undefined;
  if (internal) {
    const e = internal.target.split(".").pop()?.toLowerCase() ?? "";
    mime = mediaMimeOf(e);
    const f = pc.pkg.zip.file(internal.target);
    if (!mime) sc.warnings.add(`Media format .${e} can't be played in a browser and was skipped`);
    else if (f) {
      const bytes = await f.async("uint8array");
      if (bytes.length > MAX_IMPORT_MEDIA) sc.warnings.add("A media clip larger than 100 MB was skipped");
      else src = `data:${mime};base64,${await f.async("base64")}`;
    }
  } else if (linkRel?.external) {
    src = linkRel.target;
  }
  if (!src) return;
  const poster = await mediaDataUrl(pc, rid(path(pic, "blipFill", "blip"), "embed"), sc);
  const media: SlideElement["media"] = { kind, src, ...(mime ? { mime } : {}) };
  if (!internal) {
    const p = parseMediaUrl(src);
    if (p?.embed) media.embed = p.embed;
    else if (p?.mime) media.mime = p.mime;
  }
  if (ext.embed) media.embed = ext.embed;
  if (poster && !poster.startsWith("data:image/svg")) media.poster = poster;
  for (const k of ["autoplay", "loop", "muted"] as const) if (ext[k]) media[k] = true;
  const descr = path(pic, "nvPicPr", "cNvPr")?.getAttribute("descr");
  out.push({
    id: uid(),
    type: "media",
    ...toPx(box, sc),
    ...orient(box),
    media,
    ...(descr ? { alt: descr } : {}),
  });
}

/** Crop (`a:srcRect`), opacity, crop shape, border, shadow and alt text of
 *  a `p:pic`. */
function readPictureProps(pic: Element, sc: SlideCtx): Partial<SlideElement> {
  const out: Partial<SlideElement> = {};
  const src = path(pic, "blipFill", "srcRect");
  if (src) {
    const f = (a: string) => (num(src, a) ?? 0) / 100000;
    const crop = { l: f("l"), t: f("t"), r: f("r"), b: f("b") };
    // Negative values (a picture smaller than its frame) aren't kept.
    if (Object.values(crop).some((v) => v > 0))
      out.crop = {
        l: Math.max(0, crop.l),
        t: Math.max(0, crop.t),
        r: Math.max(0, crop.r),
        b: Math.max(0, crop.b),
      };
  }
  const amt = num(path(pic, "blipFill", "blip", "alphaModFix"), "amt");
  if (amt !== undefined && amt < 100000) out.opacity = r2(amt / 100000);
  const spPr = kid(pic, "spPr");
  const prst = kid(spPr, "prstGeom")?.getAttribute("prst");
  if (prst && prst !== "rect" && hasPreset(prst)) out.cropShape = prst;
  const line = readLine(spPr, sc.pc.color);
  if (line && line !== "none") {
    out.stroke = line.color;
    out.strokeWidth = line.width;
    const dash = readLineStyle(spPr).dash;
    if (dash) out.dash = dash;
  }
  if (path(spPr, "effectLst", "outerShdw")) out.shadow = true;
  const descr = path(pic, "nvPicPr", "cNvPr")?.getAttribute("descr");
  if (descr) out.alt = descr;
  return out;
}

async function readGraphicFrame(
  gf: Element,
  tf: Tf,
  sc: SlideCtx,
  out: SlideElement[],
) {
  const tbl = desc(gf, "tbl")[0];
  const raw = readXfrm(kid(gf, "xfrm"));
  if (!raw) return;
  if (!tbl) {
    const uri = desc(gf, "graphicData")[0]?.getAttribute("uri") || "";
    if (uri.endsWith("/chart")) {
      if (await readChartFrame(gf, tf(raw), sc, out)) return;
    } else if (uri.endsWith("/diagram")) {
      if (await readDiagramFrame(gf, raw, tf, sc, out)) return;
    }
    sc.warnings.add(
      uri.includes("chart")
        ? "A chart could not be read and was skipped"
        : uri.includes("diagram")
          ? "A SmartArt diagram without a cached drawing was skipped"
          : "An embedded object was skipped",
    );
    return;
  }
  const box = tf({ ...raw, h: Math.max(raw.h, kids(tbl, "tr").reduce((s, r) => s + (num(r, "h") ?? 0), 0)) });
  const cNvPr = path(gf, "nvGraphicFramePr", "cNvPr");
  const el = await readTable(tbl, sc);
  if (!el) return;
  const descr = cNvPr?.getAttribute("descr");
  out.push({ ...el, ...toPx(box, sc), ...(descr ? { alt: descr } : {}) });
}

/** A chart graphic frame (M11): the chart part → a Grown chart element. */
async function readChartFrame(gf: Element, box: Box, sc: SlideCtx, out: SlideElement[]): Promise<boolean> {
  const pc = sc.pc;
  const r = rid(desc(gf, "chart")[0] ?? null, "id");
  const rel = r ? (await pc.pkg.relsOf(pc.part)).get(r) : undefined;
  if (!rel || rel.external) return false;
  const doc = await pc.pkg.xml(rel.target);
  if (!doc) return false;
  const chart = readSlideChart(doc);
  if (!chart) return false;
  const descr = path(gf, "nvGraphicFramePr", "cNvPr")?.getAttribute("descr");
  out.push({ id: uid(), type: "chart", ...toPx(box, sc), ...orient(box), chart, ...(descr ? { alt: descr } : {}) });
  return true;
}

const REL_DIAGRAM_DRAWING = "diagramDrawing";

/**
 * A SmartArt graphic frame (M11): its cached drawing (`dsp:drawing`, which
 * PowerPoint keeps beside the diagram data) is read like a shape tree, in
 * the frame's coordinates, and becomes a group. The diagram data itself is
 * not kept (flagged exception F6).
 */
async function readDiagramFrame(gf: Element, raw: Box, tf: Tf, sc: SlideCtx, out: SlideElement[]): Promise<boolean> {
  const pc = sc.pc;
  const rels = await pc.pkg.relsOf(pc.part);
  let target: string | undefined;
  // The data part names its drawing (dsp:dataModelExt@relId, a slide rel).
  const dm = rid(desc(gf, "relIds")[0] ?? null, "dm");
  const dataRel = dm ? rels.get(dm) : undefined;
  if (dataRel && !dataRel.external) {
    const data = await pc.pkg.xml(dataRel.target);
    const relId = desc(data, "dataModelExt")[0]?.getAttribute("relId");
    const dr = relId ? rels.get(relId) : undefined;
    if (dr && !dr.external) target = dr.target;
  }
  if (!target) {
    const drawings = [...rels.values()].filter((r) => r.type.endsWith("/" + REL_DIAGRAM_DRAWING));
    if (drawings.length === 1) target = drawings[0].target;
  }
  if (!target) return false;
  const doc = await pc.pkg.xml(target);
  const tree = desc(doc, "spTree")[0];
  if (!tree) return false;
  // Drawing shapes are positioned relative to the frame.
  const inner: Tf = (b) => tf({ ...b, x: b.x + raw.x, y: b.y + raw.y });
  const members: SlideElement[] = [];
  await readTree(tree, inner, sc, members, false);
  if (!members.length) return false;
  const box = tf(raw);
  out.push({ id: uid(), type: "group", ...toPx(box, sc), ...orient(box), name: "Diagram", children: members });
  return true;
}

/** A cell border line: undefined = not specified, width 0 = no line. */
function readCellLine(ln: Element | null, ctx: ColorCtx): CellBorder | undefined {
  if (!ln) return undefined;
  if (kid(ln, "noFill")) return { color: "#000000", width: 0 };
  const color = readFill(ln, ctx);
  if (!color || color === "none") return color === "none" ? { color: "#000000", width: 0 } : undefined;
  const w = num(ln, "w");
  const dash = kid(ln, "prstDash")?.getAttribute("val") as DashStyle | null;
  return {
    color,
    width: w === undefined ? 1 : r2(w / EMU_PER_PT),
    ...(dash && dash !== "solid" ? { dash } : {}),
  };
}

const SIDE_TAGS: [CellSide, string][] = [
  ["l", "lnL"],
  ["r", "lnR"],
  ["t", "lnT"],
  ["b", "lnB"],
];
const sameLine = (a: CellBorder | undefined, b: CellBorder | undefined) =>
  (a?.width ?? 0) === (b?.width ?? 0) && (!(a?.width ?? 0) || (a!.color === b!.color && (a!.dash ?? "solid") === (b!.dash ?? "solid")));

/**
 * An `a:tbl` → a Grown table (box set by the caller): grid widths, row
 * heights, merges, the style id and options, per-cell fills and borders and
 * rich cell text. A table without a style whose cells all share one fill
 * and one border becomes a legacy Grown table (element fill/stroke).
 */
async function readTable(tbl: Element, sc: SlideCtx): Promise<SlideElement | null> {
  const trs = kids(tbl, "tr");
  const grid = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => num(g, "w") ?? 0);
  const cols = grid.length || Math.max(0, ...trs.map((r) => kids(r, "tc").length));
  const rows = trs.length;
  if (!rows || !cols) return null;
  const tblPr = kid(tbl, "tblPr");
  const styleId = kid(tblPr, "tableStyleId")?.textContent?.trim() || undefined;
  const look: TableLook = {};
  for (const [k, attr] of [
    ["header", "firstRow"],
    ["banded", "bandRow"],
    ["lastRow", "lastRow"],
    ["firstCol", "firstCol"],
    ["lastCol", "lastCol"],
    ["bandedCols", "bandCol"],
  ] as const)
    if (boolAttr(tblPr, attr)) look[k] = true;

  const merges: CellMerge[] = [];
  const props: (CellProps | null)[][] = [];
  const texts: (TextProps | null)[][] = [];
  const anchors: [number, number][] = [];
  const chain: TextChain = {
    lists: [kid(sc.masterTxStyles, "otherStyle"), sc.defaultTextStyle],
    bodyPrs: [],
    fontRef: null,
  };
  for (let r = 0; r < rows; r++) {
    const tcs = kids(trs[r], "tc");
    props.push([]);
    texts.push([]);
    for (let c = 0; c < cols; c++) {
      const tc = tcs[c];
      const covered = !!tc && (boolAttr(tc, "hMerge") || boolAttr(tc, "vMerge"));
      const tcPr = kid(tc, "tcPr");
      const p: CellProps = {};
      if (tc && !covered) {
        anchors.push([r, c]);
        const cs = num(tc, "gridSpan") ?? 1;
        const rs = num(tc, "rowSpan") ?? 1;
        if (cs > 1 || rs > 1) merges.push({ r, c, rs: Math.min(rs, rows - r), cs: Math.min(cs, cols - c) });
        const fill = readFill(tcPr, sc.pc.color);
        if (fill) p.fill = fill;
        for (const [side, tag] of SIDE_TAGS) {
          const b = readCellLine(kid(tcPr, tag), sc.pc.color);
          if (b) p.borders = { ...(p.borders ?? {}), [side]: b };
        }
        const anchor = tcPr?.getAttribute("anchor");
        if (anchor === "ctr") p.valign = "middle";
        else if (anchor === "b") p.valign = "bottom";
      }
      props[r].push(Object.keys(p).length ? p : null);
      const body = kid(tc, "txBody");
      texts[r].push(body && !covered ? await readText(body, chain, sc.pc, sc.scale) : null);
    }
  }

  // Legacy (unstyled, uniform) or explicit cell formatting.
  let legacy: { fill: string; line: CellBorder | undefined } | null = null;
  if (!styleId) {
    const fills = anchors.map(([r, c]) => props[r][c]?.fill ?? "none");
    const lines = anchors.flatMap(([r, c]) => SIDE_TAGS.map(([s]) => props[r][c]?.borders?.[s]));
    if (fills.every((f) => f === fills[0]) && lines.every((l) => sameLine(l, lines[0])))
      legacy = { fill: fills[0], line: lines[0] };
  }
  let style = styleId;
  if (styleId && !findTableTemplate(styleId)) {
    sc.warnings.add("A table style Grown doesn't have was drawn without its colours");
    style = NO_STYLE_NO_GRID;
  }
  if (!styleId && !legacy) style = NO_STYLE_NO_GRID;

  const first = anchors.map(([r, c]) => texts[r][c]).find(Boolean) ?? null;
  const toRel = (vs: number[]) => {
    const px = vs.map((v) => r2(v * sc.scale));
    return px.length && px.every((v) => Math.abs(v - px[0]) < 0.5) ? undefined : px;
  };
  const table: TableData = {
    rows,
    cols,
    cells: Array.from({ length: rows }, () => Array(cols).fill("")),
  };
  const colW = grid.length === cols ? toRel(grid) : undefined;
  const rowH = toRel(trs.map((tr) => num(tr, "h") ?? 0));
  if (colW && colW.every((v) => v > 0)) table.colW = colW;
  if (rowH && rowH.every((v) => v > 0)) table.rowH = rowH;
  if (merges.length) table.merges = merges;
  if (style) {
    table.style = style;
    if (Object.keys(look).length) table.look = look;
  }
  if (!legacy && props.some((row) => row.some(Boolean))) table.props = props.map((row) => row.map((p) => p && ({ ...p })));
  else if (legacy) {
    const va = props.map((row) => row.map((p) => (p?.valign ? { valign: p.valign } : null)));
    if (va.some((row) => row.some(Boolean))) table.props = va;
  }
  let el: SlideElement = {
    id: uid(),
    type: "table",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    table,
    fill: legacy ? legacy.fill : "none",
    stroke: legacy?.line && legacy.line.width ? legacy.line.color : "none",
    strokeWidth: legacy?.line && legacy.line.width ? legacy.line.width : 0,
    fontSize: first?.fontSize ?? r2(18 * EMU_PER_PT * sc.scale),
    ...(first?.fontFamily ? { fontFamily: first.fontFamily } : {}),
    color: first?.color ?? "#000000",
  };
  for (const [r, c] of anchors) {
    const tp = texts[r][c];
    if (!tp) continue;
    const base = cellTextEl(el, r, c);
    const runs = (tp.runs ?? [{ text: tp.text }]).map((x) => (tp.url ? { ...x, url: tp.url } : x));
    const te = withRuns(
      {
        ...base,
        fontSize: tp.fontSize,
        fontFamily: tp.fontFamily,
        bold: tp.bold || undefined,
        italic: tp.italic || undefined,
        underline: tp.underline || undefined,
        strike: tp.strike || undefined,
        baseline: tp.baseline,
        color: tp.color,
        align: tp.align,
        runs: undefined,
        paras: undefined,
        text: "",
      },
      runs,
      tp.paras,
    );
    el = setCellText(el, r, c, te);
  }
  return el;
}

/** A `p:grpSp` becomes a Grown group holding its members; a group with no
 *  transform is flattened, and an empty one is dropped. */
async function readGroup(
  grp: Element,
  tf: Tf,
  sc: SlideCtx,
  out: SlideElement[],
  skipPh: boolean,
) {
  const grpSpPr = kid(grp, "grpSpPr");
  const kids: SlideElement[] = [];
  await readTree(grp, groupTf(grpSpPr, tf), sc, kids, skipPh);
  if (!kids.length) return;
  const raw = readXfrm(kid(grpSpPr, "xfrm"));
  if (!raw) {
    out.push(...kids);
    return;
  }
  const box = tf(raw);
  out.push({
    id: uid(),
    type: "group",
    ...toPx(box, sc),
    ...orient(box),
    children: kids,
  });
}

async function readTree(
  tree: Element,
  tf: Tf,
  sc: SlideCtx,
  out: SlideElement[],
  skipPh: boolean,
) {
  for (const c of contentKids(tree)) {
    if (skipPh && (c.localName === "sp" || c.localName === "pic") && spPh(c))
      continue;
    const before = out.length;
    const spid = sc.spids ? c.getElementsByTagNameNS("*", "cNvPr")[0]?.getAttribute("id") : null;
    switch (c.localName) {
      case "sp":
        await readSp(c, tf, sc, out, false);
        break;
      case "cxnSp":
        await readSp(c, tf, sc, out, true);
        break;
      case "pic":
        await readPic(c, tf, sc, out);
        break;
      case "graphicFrame":
        await readGraphicFrame(c, tf, sc, out);
        break;
      case "grpSp":
        await readGroup(c, tf, sc, out, skipPh);
        break;
      case "contentPart":
        sc.warnings.add("Ink was skipped");
        break;
    }
    if (spid && out.length > before) sc.spids!.set(spid, out.slice(before).map((e) => e.id));
  }
}

/** Map a `<p:transition>` to Grown's transition type (see motionXml). */
export function mapTransition(tr: Element | null): TransitionType | undefined {
  return readTransitionEl(tr).transition;
}

async function readBackground(
  cSlds: (Element | null)[],
  sc: SlideCtx,
  pcs: PartCtx[],
): Promise<{ color?: string; ref?: string; fill?: SlideFill }> {
  for (let i = 0; i < cSlds.length; i++) {
    const bg = kid(cSlds[i], "bg");
    if (!bg) continue;
    const bgPr = kid(bg, "bgPr");
    if (bgPr) {
      const blip = path(bgPr, "blipFill", "blip");
      if (blip) {
        const src = await mediaDataUrl(pcs[i], rid(blip, "embed"), sc);
        if (src) return { color: "#ffffff", fill: { kind: "image", src } };
      }
      const grad = kid(bgPr, "gradFill");
      const g = grad ? readGradient(grad, sc.pc.color) : null;
      if (g) return { color: g.stops[0].color, fill: g };
      const f = readFill(bgPr, sc.pc.color);
      if (f && f !== "none") return { color: f, ref: schemeRefOf(kid(bgPr, "solidFill")) };
    }
    const ref = kid(bg, "bgRef");
    if (ref) {
      const c = readColor(ref, sc.pc.color);
      if (c) return { color: c, ref: schemeRefOf(ref) };
    }
  }
  return {};
}

// ------------------------------------------------------------ entry point

/** Built-in layout ids a pptx layout type maps to (Grown's ids are the types). */
const LAYOUT_IDS = new Set(["title", "obj", "secHead", "twoObj", "twoTxTwoObj", "titleOnly", "objTx", "blank"]);

/** Read a .pptx (bytes or Blob) into a Grown deck. */
export async function readPptx(
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<PptxImport> {
  const zip = await JSZip.loadAsync(data);
  const pkg = new Pkg(zip);
  const warnings = new Set<string>();
  const unsupported = new Set<string>();

  const presPath =
    (await pkg.relOfType("", "officeDocument").catch(() => undefined)) ||
    "ppt/presentation.xml";
  const pres = await pkg.xml(presPath);
  if (!pres) throw new Error("Not a PowerPoint file (no presentation part)");
  const presEl = pres.documentElement;
  const sldSz = kid(presEl, "sldSz");
  const cx = num(sldSz, "cx") || 9144000;
  const cy = num(sldSz, "cy") || 5143500;
  // The slide is 960 logical px wide; its height follows the aspect ratio.
  const scale = CANVAS_W / cx;
  const H = Math.round(cy * scale);
  const ox = 0;
  const oy = 0;
  const defaultTextStyle = kid(presEl, "defaultTextStyle");

  const presRels = await pkg.relsOf(presPath);
  const slidePaths = kids(kid(presEl, "sldIdLst"), "sldId")
    .map((s) => presRels.get(rid(s, "id") || "")?.target)
    .filter((p): p is string => !!p);

  // Ids up front, so slide-jump links can name slides not yet read.
  const slideIds = new Map(slidePaths.map((p) => [p, uid()]));

  /** Master/theme context of a layout part. */
  const partsOf = async (layoutPath: string | undefined) => {
    const masterPath = layoutPath ? await pkg.relOfType(layoutPath, "slideMaster") : undefined;
    const themePath = masterPath ? await pkg.relOfType(masterPath, "theme") : undefined;
    const layout = layoutPath ? await pkg.xml(layoutPath) : null;
    const master = masterPath ? await pkg.xml(masterPath) : null;
    const theme = readTheme(themePath ? await pkg.xml(themePath) : null);
    const clrMap: Record<string, string> = {};
    const mapEl = master ? kid(master.documentElement, "clrMap") : null;
    for (const a of Array.from(mapEl?.attributes ?? [])) clrMap[a.name] = a.value;
    return { masterPath, layout, master, theme, clrMap };
  };

  // Layouts (M7): each layout a slide uses becomes a Grown layout.
  let deckTheme: DeckTheme | undefined;
  const layouts: SlideLayout[] = [];
  const layoutIdOf = new Map<string, string | null>();
  const readLayout = async (layoutPath: string): Promise<string | null> => {
    if (layoutIdOf.has(layoutPath)) return layoutIdOf.get(layoutPath)!;
    const { masterPath, layout, master, theme, clrMap } = await partsOf(layoutPath);
    deckTheme ??= deckThemeOf(theme, clrMap);
    const root = layout?.documentElement;
    const cSld = root ? kid(root, "cSld") : null;
    const tree = kid(cSld, "spTree");
    const type = root?.getAttribute("type") || undefined;
    // An empty, untyped layout (pptxgenjs's default) carries nothing.
    if (!root || (!type && !contentKids(tree ?? root).some((c) => c.localName !== "nvGrpSpPr" && c.localName !== "grpSpPr"))) {
      layoutIdOf.set(layoutPath, null);
      return null;
    }
    const color: ColorCtx = { theme, clrMap };
    const pcLayout: PartCtx = { pkg, part: layoutPath, color, slideIds };
    const pcMaster: PartCtx = { pkg, part: masterPath || "", color, slideIds };
    const masterCSld = master ? kid(master.documentElement, "cSld") : null;
    const sc: SlideCtx = {
      pc: pcLayout,
      scale,
      ox,
      oy,
      layoutTree: tree,
      masterTree: kid(masterCSld, "spTree"),
      masterTxStyles: master ? kid(master.documentElement, "txStyles") : null,
      defaultTextStyle,
      warnings,
      unsupported,
      layoutMode: true,
    };
    const elements: SlideElement[] = [];
    if (root.getAttribute("showMasterSp") !== "0" && sc.masterTree)
      await readTreeGlued(sc.masterTree, { ...sc, pc: pcMaster }, elements, true);
    if (tree) await readTreeGlued(tree, sc, elements, false);
    const bg = await readBackground([cSld, masterCSld], sc, [pcLayout, pcMaster]);
    let id = type && LAYOUT_IDS.has(type) && !layouts.some((l) => l.id === type) ? type : `layout${layouts.length + 1}`;
    while (layouts.some((l) => l.id === id)) id += "x";
    layouts.push({
      id,
      name: cSld?.getAttribute("name") || type || "Layout",
      ...(type ? { type } : {}),
      elements,
      background: bg.color ?? "#ffffff",
      ...(bg.ref ? { bgRef: bg.ref } : {}),
      ...(bg.fill ? { bgFill: bg.fill } : {}),
    });
    layoutIdOf.set(layoutPath, id);
    return id;
  };

  // Every layout of every master, in the masters' order.
  for (const m of kids(kid(presEl, "sldMasterIdLst"), "sldMasterId")) {
    const masterPath = presRels.get(rid(m, "id") || "")?.target;
    const master = masterPath ? await pkg.xml(masterPath) : null;
    if (!masterPath || !master) continue;
    const rels = await pkg.relsOf(masterPath);
    for (const l of kids(kid(master.documentElement, "sldLayoutIdLst"), "sldLayoutId")) {
      const lp = rels.get(rid(l, "id") || "")?.target;
      if (lp) await readLayout(lp);
    }
  }

  const slides: Slide[] = [];
  const hfs: SlideHFRead[] = [];
  for (const slidePath of slidePaths) {
    const sld = await pkg.xml(slidePath);
    if (!sld) continue;
    const layoutPath = await pkg.relOfType(slidePath, "slideLayout");
    const { masterPath, layout, master, theme, clrMap } = await partsOf(layoutPath);
    deckTheme ??= deckThemeOf(theme, clrMap);
    const layoutId = layoutPath ? await readLayout(layoutPath) : null;

    const ovr = path(sld.documentElement, "clrMapOvr", "overrideClrMapping");
    for (const a of Array.from(ovr?.attributes ?? [])) clrMap[a.name] = a.value;
    const color: ColorCtx = { theme, clrMap };

    const slideCSld = kid(sld.documentElement, "cSld");
    const layoutCSld = layout ? kid(layout.documentElement, "cSld") : null;
    const masterCSld = master ? kid(master.documentElement, "cSld") : null;
    const pcSlide: PartCtx = { pkg, part: slidePath, color, slideIds };
    const pcLayout: PartCtx = { pkg, part: layoutPath || "", color, slideIds };
    const pcMaster: PartCtx = { pkg, part: masterPath || "", color, slideIds };
    const hf: SlideHFRead = {};
    const sc: SlideCtx = {
      pc: pcSlide,
      scale,
      ox,
      oy,
      layoutTree: kid(layoutCSld, "spTree"),
      masterTree: kid(masterCSld, "spTree"),
      masterTxStyles: master ? kid(master.documentElement, "txStyles") : null,
      defaultTextStyle,
      warnings,
      unsupported,
      hf,
    };

    const elements: SlideElement[] = [];
    const bg = await readBackground([slideCSld, layoutCSld, masterCSld], sc, [
      pcSlide,
      pcLayout,
      pcMaster,
    ]);

    // Master and layout decorations (non-placeholder shapes) sit under the slide's own.
    const showMaster = sld.documentElement.getAttribute("showMasterSp") !== "0";
    const layoutShowsMaster =
      layout?.documentElement.getAttribute("showMasterSp") !== "0";
    if (showMaster && layoutShowsMaster && sc.masterTree)
      await readTreeGlued(sc.masterTree, { ...sc, pc: pcMaster }, elements, true);
    if (showMaster && sc.layoutTree)
      await readTreeGlued(sc.layoutTree, { ...sc, pc: pcLayout }, elements, true);
    const tree = kid(slideCSld, "spTree");
    const spids = new Map<string, string[]>();
    if (tree) await readTreeGlued(tree, { ...sc, spids }, elements, false);

    let notes: string | undefined;
    const notesPath = await pkg.relOfType(slidePath, "notesSlide");
    if (notesPath) {
      const nd = await pkg.xml(notesPath);
      const body = desc(nd, "sp").find((s) => spPh(s)?.type === "body");
      const t = txBodyText(kid(body ?? null, "txBody"));
      if (t.trim()) notes = t;
    }

    const trans = readTransitionEl(findTransitionEl(sld.documentElement));
    const timing = readTiming(sld.documentElement, spids, uid);
    if (timing.simplified) warnings.add("Some animations were simplified (motion paths and triggers are not supported)");
    const slide: Slide = {
      id: slideIds.get(slidePath) ?? uid(),
      background: bg.color ?? "#ffffff",
      ...(bg.ref ? { bgRef: bg.ref } : {}),
      ...(bg.fill ? { bgFill: bg.fill } : {}),
      elements,
      ...(notes ? { notes } : {}),
      ...trans,
      ...(timing.anims.length ? { anims: timing.anims } : {}),
      ...(layoutId ? { layout: layoutId } : {}),
      ...(sld.documentElement.getAttribute("show") === "0" ? { hidden: true } : {}),
    };
    slides.push(slide);
    hfs.push(hf);
  }

  if (!slides.length) throw new Error("The presentation has no slides");
  if (unsupported.size)
    warnings.add(
      `Shapes Grown can't draw yet were simplified: ${[...unsupported].sort().join(", ")}`,
    );

  const core = await pkg.xml("docProps/core.xml");
  const title = desc(core, "title")[0]?.textContent?.trim() || undefined;

  const deck: DeckDoc = { slides };
  // Comment threads (M10).
  const comments = await readCommentParts(
    zip,
    presPath,
    slidePaths.map((p) => ({ path: p, id: slideIds.get(p)! })).filter((x) => slides.some((s) => s.id === x.id)),
    cx / 914400,
  ).catch(() => []);
  if (comments.length) deck.comments = anchorImported(comments, slides);
  if (deckTheme) deck.theme = deckTheme;
  if (layouts.length) deck.layouts = layouts;
  if (H !== DEFAULT_CANVAS_H) deck.size = { w: CANVAS_W, h: H };
  const hf = headerFooterOf(slides, hfs, layouts);
  if (hf) deck.hf = hf;
  return { deck, title, warnings: [...warnings] };
}

/** Deck header & footer settings from the slides' dt/ftr/sldNum
 *  placeholders: a part is on for the deck when any slide shows it, and
 *  slides that differ get a per-slide override (title slides that all
 *  lack them give "don't show on title slide"). */
function headerFooterOf(slides: Slide[], hfs: SlideHFRead[], layouts: SlideLayout[]): DeckHF | null {
  const keys = ["dt", "ftr", "sldNum"] as const;
  const on = (h: SlideHFRead, k: (typeof keys)[number]) => (k === "sldNum" ? !!h.sldNum : h[k] !== undefined);
  const any = keys.filter((k) => hfs.some((h) => on(h, k)));
  if (!any.length) return null;
  const hf: DeckHF = {};
  for (const k of any) hf[k] = true;
  const ftr = hfs.find((h) => h.ftr !== undefined)?.ftr;
  if (ftr !== undefined) hf.footerText = ftr;
  const dt = hfs.find((h) => h.dt)?.dt;
  if (dt && !dt.auto) hf.dateText = dt.text;
  const isTitle = (s: Slide) => layouts.find((l) => l.id === s.layout)?.type === "title";
  const titles = slides.filter(isTitle);
  if (titles.length && titles.every((s) => keys.every((k) => !on(hfs[slides.indexOf(s)], k)))) hf.notOnTitle = true;
  slides.forEach((s, i) => {
    if (hf.notOnTitle && isTitle(s)) return;
    const o: SlideHF = {};
    for (const k of any) if (!on(hfs[i], k)) o[k] = false;
    if (Object.keys(o).length) s.hf = o;
  });
  return hf;
}
