// pptx reader: PowerPoint (PresentationML, ECMA-376 Part 1 §19) → Grown DeckDoc.
//
// Written from the spec with jszip + DOMParser. It maps what Grown's model can
// hold — slides, text boxes, the preset shapes Grown draws, lines, images,
// tables, speaker notes, backgrounds and transitions — and resolves theme
// colours (with their transforms) through lib/colorMods. Everything else is
// skipped and reported in `warnings`.
//
// Geometry: EMUs are scaled uniformly so the source slide fits the 960×540
// canvas (a 4:3 deck is pillar-boxed and centred horizontally).

import JSZip from "jszip";
import {
  CANVAS_H,
  CANVAS_W,
  uid,
  type ArrowHead,
  type DashStyle,
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
  DEFAULT_INSET,
} from "../model";
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
  return { scheme, majorFont: font("majorFont"), minorFont: font("minorFont") };
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
}

const ALGN: Record<string, TextAlign> = { ctr: "center", r: "right", just: "justify", dist: "justify" };

async function readText(
  txBody: Element,
  chain: TextChain,
  pc: PartCtx,
  scale: number,
): Promise<TextProps | null> {
  const paras = kids(txBody, "p");
  const text = paras.map((q) => paraText(q, "\v")).join("\n");
  if (!text.replace(/\v/g, "").trim()) return null;
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

  // Element-wide style comes from the first paragraph with text, and its first run.
  const p0 = paras.find((q) => paraText(q).trim()) ?? paras[0];
  const lvlPPrs = pPrChain(p0);
  const run0 =
    Array.from(p0.children).find(
      (c) =>
        (c.localName === "r" || c.localName === "fld") &&
        (kid(c, "t")?.textContent ?? "") !== "",
    ) ?? null;
  const base = await runStyle(run0, lvlPPrs);
  const algn = firstAttr(lvlPPrs, "algn");
  const align: TextAlign = ALGN[algn ?? ""] ?? "left";
  const anchor = firstAttr(chain.bodyPrs, "anchor");
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
  const t = await readText(txBody, chain, pc, sc.scale);
  if (!t) return;
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
  };
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
  });
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
    sc.warnings.add(
      uri.includes("chart")
        ? "Charts are not supported yet and were skipped"
        : uri.includes("diagram")
          ? "SmartArt diagrams are not supported yet and were skipped"
          : "An embedded object was skipped",
    );
    return;
  }
  const rows = kids(tbl, "tr");
  const cols =
    kids(kid(tbl, "tblGrid"), "gridCol").length ||
    Math.max(0, ...rows.map((r) => kids(r, "tc").length));
  if (!rows.length || !cols) return;
  const cells = rows.map((tr) => {
    const tcs = kids(tr, "tc");
    return Array.from({ length: cols }, (_, i) =>
      txBodyText(kid(tcs[i], "txBody")),
    );
  });
  const rowsH = rows.reduce((s, r) => s + (num(r, "h") ?? 0), 0);
  const box = tf({ ...raw, h: Math.max(raw.h, rowsH) });

  const tc0 = kid(rows[0], "tc");
  const tcPr = kid(tc0, "tcPr");
  const fill = readFill(tcPr, sc.pc.color);
  const lnL = kid(tcPr, "lnL") ?? kid(tcPr, "lnT");
  const bColor =
    lnL && !kid(lnL, "noFill") ? readFill(lnL, sc.pc.color) : undefined;
  const bw = num(lnL, "w");
  const run = desc(tc0, "r")[0];
  const rPr = kid(run, "rPr");
  const sz = num(rPr, "sz");
  out.push({
    id: uid(),
    type: "table",
    ...toPx(box, sc),
    table: { rows: rows.length, cols, cells },
    fill: fill && fill !== "none" ? fill : "none",
    stroke: bColor && bColor !== "none" ? bColor : "none",
    strokeWidth:
      bColor && bColor !== "none"
        ? bw === undefined
          ? 1
          : r2(bw / EMU_PER_PT)
        : 0,
    fontSize: sz
      ? r2((sz / 100) * EMU_PER_PT * sc.scale)
      : r2(18 * EMU_PER_PT * sc.scale),
    ...(kid(rPr, "latin")?.getAttribute("typeface")
      ? { fontFamily: kid(rPr, "latin")!.getAttribute("typeface")! }
      : {}),
    color: readColor(kid(rPr, "solidFill"), sc.pc.color) ?? "#000000",
  });
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
  }
}

/** Map a `<p:transition>` to Grown's closest transition. */
export function mapTransition(tr: Element | null): TransitionType | undefined {
  if (!tr) return undefined;
  const effect = tr.children[0];
  if (!effect) return undefined;
  const dir = effect.getAttribute("dir");
  switch (effect.localName) {
    case "fade":
    case "dissolve":
      return "fade";
    case "push":
    case "cover":
    case "pull":
    case "wipe":
      if (!dir || dir === "l") return "slide-left";
      if (dir === "r") return "slide-right";
      if (dir === "u") return "slide-up";
      return "fade";
    default:
      return "fade";
  }
}

function findTransition(root: Element): Element | null {
  for (const c of contentKids(root)) if (c.localName === "transition") return c;
  return null;
}

async function readBackground(
  cSlds: (Element | null)[],
  sc: SlideCtx,
  pcs: PartCtx[],
): Promise<{ color?: string; image?: SlideElement }> {
  for (let i = 0; i < cSlds.length; i++) {
    const bg = kid(cSlds[i], "bg");
    if (!bg) continue;
    const bgPr = kid(bg, "bgPr");
    if (bgPr) {
      const blip = path(bgPr, "blipFill", "blip");
      if (blip) {
        const src = await mediaDataUrl(pcs[i], rid(blip, "embed"), sc);
        if (src)
          return {
            color: "#ffffff",
            image: {
              id: uid(),
              type: "image",
              x: 0,
              y: 0,
              w: CANVAS_W,
              h: CANVAS_H,
              src,
            },
          };
      }
      const f = readFill(bgPr, sc.pc.color);
      if (f && f !== "none") return { color: f };
    }
    const ref = kid(bg, "bgRef");
    if (ref) {
      const c = readColor(ref, sc.pc.color);
      if (c) return { color: c };
    }
  }
  return {};
}

// ------------------------------------------------------------ entry point

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
  const scale = Math.min(CANVAS_W / cx, CANVAS_H / cy);
  const ox = r2((CANVAS_W - cx * scale) / 2);
  const oy = r2((CANVAS_H - cy * scale) / 2);
  if (Math.abs(cx / cy - CANVAS_W / CANVAS_H) > 0.01)
    warnings.add("The slide size isn't 16:9; slides were scaled to fit");
  const defaultTextStyle = kid(presEl, "defaultTextStyle");

  const presRels = await pkg.relsOf(presPath);
  const slidePaths = kids(kid(presEl, "sldIdLst"), "sldId")
    .map((s) => presRels.get(rid(s, "id") || "")?.target)
    .filter((p): p is string => !!p);

  // Ids up front, so slide-jump links can name slides not yet read.
  const slideIds = new Map(slidePaths.map((p) => [p, uid()]));
  const slides: Slide[] = [];
  for (const slidePath of slidePaths) {
    const sld = await pkg.xml(slidePath);
    if (!sld) continue;
    const layoutPath = await pkg.relOfType(slidePath, "slideLayout");
    const masterPath = layoutPath
      ? await pkg.relOfType(layoutPath, "slideMaster")
      : undefined;
    const themePath = masterPath
      ? await pkg.relOfType(masterPath, "theme")
      : undefined;
    const layout = layoutPath ? await pkg.xml(layoutPath) : null;
    const master = masterPath ? await pkg.xml(masterPath) : null;
    const theme = readTheme(themePath ? await pkg.xml(themePath) : null);

    const clrMap: Record<string, string> = {};
    const mapEl = master ? kid(master.documentElement, "clrMap") : null;
    for (const a of Array.from(mapEl?.attributes ?? []))
      clrMap[a.name] = a.value;
    const ovr = path(sld.documentElement, "clrMapOvr", "overrideClrMapping");
    for (const a of Array.from(ovr?.attributes ?? [])) clrMap[a.name] = a.value;
    const color: ColorCtx = { theme, clrMap };

    const slideCSld = kid(sld.documentElement, "cSld");
    const layoutCSld = layout ? kid(layout.documentElement, "cSld") : null;
    const masterCSld = master ? kid(master.documentElement, "cSld") : null;
    const pcSlide: PartCtx = { pkg, part: slidePath, color, slideIds };
    const pcLayout: PartCtx = { pkg, part: layoutPath || "", color, slideIds };
    const pcMaster: PartCtx = { pkg, part: masterPath || "", color, slideIds };
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
    };

    const elements: SlideElement[] = [];
    const bg = await readBackground([slideCSld, layoutCSld, masterCSld], sc, [
      pcSlide,
      pcLayout,
      pcMaster,
    ]);
    if (bg.image) elements.push(bg.image);

    // Master and layout decorations (non-placeholder shapes) sit under the slide's own.
    const showMaster = sld.documentElement.getAttribute("showMasterSp") !== "0";
    const layoutShowsMaster =
      layout?.documentElement.getAttribute("showMasterSp") !== "0";
    if (showMaster && layoutShowsMaster && sc.masterTree)
      await readTreeGlued(sc.masterTree, { ...sc, pc: pcMaster }, elements, true);
    if (showMaster && sc.layoutTree)
      await readTreeGlued(sc.layoutTree, { ...sc, pc: pcLayout }, elements, true);
    const tree = kid(slideCSld, "spTree");
    if (tree) await readTreeGlued(tree, sc, elements, false);

    let notes: string | undefined;
    const notesPath = await pkg.relOfType(slidePath, "notesSlide");
    if (notesPath) {
      const nd = await pkg.xml(notesPath);
      const body = desc(nd, "sp").find((s) => spPh(s)?.type === "body");
      const t = txBodyText(kid(body ?? null, "txBody"));
      if (t.trim()) notes = t;
    }

    const transition = mapTransition(findTransition(sld.documentElement));
    const slide: Slide = {
      id: slideIds.get(slidePath) ?? uid(),
      background: bg.color ?? "#ffffff",
      elements,
      ...(notes ? { notes } : {}),
      ...(transition ? { transition } : {}),
    };
    if (desc(sld, "timing").length && desc(sld, "timing")[0].children.length)
      warnings.add("Animations were not imported");
    slides.push(slide);
  }

  if (!slides.length) throw new Error("The presentation has no slides");
  if (unsupported.size)
    warnings.add(
      `Shapes Grown can't draw yet were simplified: ${[...unsupported].sort().join(", ")}`,
    );

  const core = await pkg.xml("docProps/core.xml");
  const title = desc(core, "title")[0]?.textContent?.trim() || undefined;

  return { deck: { slides }, title, warnings: [...warnings] };
}
