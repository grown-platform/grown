// DrawingML objects in WordprocessingML (Docs M7), both ways: wp:inline and
// wp:anchor (wrap types, positions, distances, z-order, relative sizes),
// picture crop (a:srcRect), rotation and flips (a:xfrm), alt text and names
// (wp:docPr), wps shapes and text boxes (wps:wsp, preset geometry, fill,
// outline, text anchoring), and c:chart parts (the Sheets chart writer /
// reader, as Slides M11 uses it). Written from ECMA-376 Part 1 §20.4
// (DrawingML - WordprocessingML Drawing), §20.1 (DrawingML main) and
// §21.2 (charts), plus the Word 2010 wp14 / wps extensions ([MS-ODRAWXML]).
//
// VML text boxes (v:textbox, the pre-2010 fallback) are read, never written.

import { attr, descendants, el, EMU_PER_PX, esc, kid, kids, nameOf, num, path } from "./xml";
import { DEFAULT_DIST, isAbsolute, isFloat, type WrapType } from "../objects";

export const NS_WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
export const NS_WP14 = "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing";
export const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
export const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
export const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
export const REL_PACKAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
export const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
export const CT_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const emu = (px: number) => Math.round(px * EMU_PER_PX);
const fromEmu = (v: string | null | undefined) => {
  const n = num(v);
  return n == null ? null : Math.round((n / EMU_PER_PX) * 100) / 100;
};

// --- reading ------------------------------------------------------------------------------

/** The branch of an mc:AlternateContent to read (Choice, else Fallback). */
function alt(e: Element): Element | null {
  return kid(e, "Choice") ?? kid(e, "Fallback");
}

/** Children of `e`, looking through mc:AlternateContent. */
function flatKids(e: Element | null): Element[] {
  const out: Element[] = [];
  for (const c of kids(e)) {
    if (nameOf(c) === "AlternateContent") {
      const b = alt(c);
      if (b) out.push(...kids(b));
    } else out.push(c);
  }
  return out;
}

const WRAP_EL: Record<string, WrapType> = {
  wrapSquare: "square",
  wrapTight: "tight",
  wrapThrough: "through",
  wrapTopAndBottom: "topBottom",
};

/** Object attributes from a wp:inline / wp:anchor box. */
export function readDrawingBox(box: Element): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ext = kid(box, "extent");
  const cx = fromEmu(attr(ext, "cx"));
  const cy = fromEmu(attr(ext, "cy"));
  if (cx) out.width = Math.max(1, Math.round(cx));
  if (cy) out.height = Math.max(1, Math.round(cy));
  const docPr = kid(box, "docPr");
  const name = attr(docPr, "name");
  if (name) out.name = name;
  const descr = attr(docPr, "descr") || attr(docPr, "title");
  if (descr) out.alt = descr;
  if (nameOf(box) !== "anchor") {
    out.wrap = "inline";
    return out;
  }
  const behind = /^(1|true)$/.test(attr(box, "behindDoc") ?? "");
  let wrap: WrapType = behind ? "behind" : "inFront";
  let side: string | null = null;
  const kidsAll = flatKids(box);
  for (const c of kidsAll) {
    const w = WRAP_EL[nameOf(c)];
    if (w) {
      wrap = w;
      side = attr(c, "wrapText");
    }
  }
  out.wrap = wrap;
  if (side && side !== "bothSides") out.wrapSide = side;
  // Word's default (0.125in) is the model's null.
  const distL = fromEmu(attr(box, "distL"));
  if (distL != null && isFloat(wrap) && Math.round(distL) !== DEFAULT_DIST) out.dist = Math.round(distL);
  else if (wrap === "topBottom") {
    const t = fromEmu(attr(box, "distT"));
    if (t != null && Math.round(t) !== DEFAULT_DIST) out.dist = Math.round(t);
  }
  const rh = num(attr(box, "relativeHeight"));
  if (rh != null) out.z = rh;
  for (const c of kidsAll) {
    const n = nameOf(c);
    if (n === "positionH" || n === "positionV") {
      const h = n === "positionH";
      const rel = attr(c, "relativeFrom");
      if (rel) out[h ? "hRel" : "vRel"] = rel;
      for (const p of flatKids(c)) {
        const pn = nameOf(p);
        if (pn === "align") out[h ? "hAlign" : "vAlign"] = (p.textContent ?? "").trim() || null;
        else if (pn === "posOffset") out[h ? "hOffset" : "vOffset"] = fromEmu(p.textContent) ?? 0;
        else if (pn === "pctPosHOffset" || pn === "pctPosVOffset") out[h ? "hPct" : "vPct"] = (num(p.textContent) ?? 0) / 1000;
      }
    } else if (n === "sizeRelH" || n === "sizeRelV") {
      const h = n === "sizeRelH";
      const pct = num(textOfKid(c, h ? "pctWidth" : "pctHeight"));
      if (pct != null) {
        out[h ? "relW" : "relH"] = pct / 1000;
        out[h ? "relWFrom" : "relHFrom"] = attr(c, "relativeFrom") ?? "page";
      }
    }
  }
  return out;
}

function textOfKid(e: Element, name: string): string | null {
  const k = kid(e, name);
  return k ? (k.textContent ?? "") : null;
}

/** Crop, rotation and flips of a pic:pic / wps:wsp (its spPr xfrm and the
 *  blipFill srcRect). */
export function readXfrm(shape: Element | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!shape) return out;
  const xfrm = path(shape, "spPr", "xfrm");
  const rot = num(attr(xfrm, "rot"));
  if (rot) out.rotate = Math.round((((rot / 60000) % 360) + 360) % 360);
  if (/^(1|true)$/.test(attr(xfrm, "flipH") ?? "")) out.flipH = true;
  if (/^(1|true)$/.test(attr(xfrm, "flipV") ?? "")) out.flipV = true;
  const src = path(shape, "blipFill", "srcRect");
  if (src)
    for (const [k, a] of [
      ["cropL", "l"],
      ["cropT", "t"],
      ["cropR", "r"],
      ["cropB", "b"],
    ] as const) {
      const v = num(attr(src, a));
      if (v) out[k] = Math.round((v / 100000) * 10000) / 10000;
    }
  return out;
}

function colorOf(fillParent: Element | null): string | null | undefined {
  if (!fillParent) return undefined;
  if (kid(fillParent, "noFill")) return "none";
  const solid = kid(fillParent, "solidFill");
  if (!solid) return undefined;
  const srgb = kid(solid, "srgbClr");
  if (srgb) return `#${(attr(srgb, "val") ?? "000000").toLowerCase()}`;
  const scheme = kid(solid, "schemeClr");
  if (scheme) return SCHEME[attr(scheme, "val") ?? ""] ?? "#4472c4";
  const sys = kid(solid, "sysClr");
  if (sys) return `#${(attr(sys, "lastClr") ?? "000000").toLowerCase()}`;
  return undefined;
}

/** Office theme defaults for scheme colours (there's no theme model). */
const SCHEME: Record<string, string> = {
  accent1: "#4472c4",
  accent2: "#ed7d31",
  accent3: "#a5a5a5",
  accent4: "#ffc000",
  accent5: "#5b9bd5",
  accent6: "#70ad47",
  dk1: "#000000",
  lt1: "#ffffff",
  dk2: "#44546a",
  lt2: "#e7e6e6",
  tx1: "#000000",
  bg1: "#ffffff",
  tx2: "#44546a",
  bg2: "#e7e6e6",
};

/** Shape attributes of a wps:wsp: preset, adjust values, fill, outline,
 *  text anchoring; `textBox` when it is a text box (cNvSpPr txBox). */
export function readWsp(wsp: Element): Record<string, unknown> & { textBox: boolean } {
  const out: Record<string, unknown> & { textBox: boolean } = { textBox: false };
  out.textBox = /^(1|true)$/.test(attr(kid(wsp, "cNvSpPr"), "txBox") ?? "");
  const spPr = kid(wsp, "spPr");
  const geom = kid(spPr, "prstGeom");
  out.prst = attr(geom, "prst") ?? "rect";
  const gds = kids(kid(geom, "avLst"), "gd");
  if (gds.length) {
    const adj: Record<string, number> = {};
    for (const g of gds) {
      const m = /^val\s+(-?\d+)/.exec(attr(g, "fmla") ?? "");
      const n = attr(g, "name");
      if (m && n) adj[n] = Number(m[1]);
    }
    if (Object.keys(adj).length) out.adj = JSON.stringify(adj);
  }
  // Theme-styled shapes (wps:style) take accent1 fill and a darker line.
  const style = kid(wsp, "style");
  const styleFill = style ? SCHEME[attr(descendants(kid(style, "fillRef"), "schemeClr")[0], "val") ?? ""] : undefined;
  const styleLine = style ? SCHEME[attr(descendants(kid(style, "lnRef"), "schemeClr")[0], "val") ?? ""] : undefined;
  const font = kid(style, "fontRef");
  const fontRgb = attr(kid(font, "srgbClr"), "val");
  const fontScheme = SCHEME[attr(kid(font, "schemeClr"), "val") ?? ""];
  if (fontRgb) out.textColor = `#${fontRgb.toLowerCase()}`;
  else if (fontScheme) out.textColor = fontScheme;
  const fill = colorOf(spPr);
  out.fill = fill ?? styleFill ?? (out.textBox ? "#ffffff" : "none");
  const ln = kid(spPr, "ln");
  const lc = colorOf(ln);
  out.stroke = lc ?? (ln && kid(ln, "noFill") ? "none" : styleLine ?? (out.textBox ? "#000000" : "none"));
  const w = fromEmu(attr(ln, "w"));
  if (w != null) out.strokeWidth = Math.round(w * 100) / 100;
  const dash = attr(kid(ln, "prstDash"), "val");
  if (dash && dash !== "solid") out.dash = dash;
  const he = attr(kid(ln, "headEnd"), "type");
  const te = attr(kid(ln, "tailEnd"), "type");
  if (he && he !== "none") out.headEnd = he;
  if (te && te !== "none") out.tailEnd = te;
  const body = kid(wsp, "bodyPr");
  const anchor = attr(body, "anchor");
  if (anchor === "t" || anchor === "ctr" || anchor === "b") out.textAnchor = anchor;
  else out.textAnchor = out.textBox ? "t" : "t";
  Object.assign(out, readXfrm(wsp));
  return out;
}

/** The w:txbxContent of a wps:wsp (or a VML v:textbox). */
export function textBoxContent(e: Element): Element | null {
  return descendants(e, "txbxContent")[0] ?? null;
}

/** Size and position of a VML shape from its style attribute
 *  ("position:absolute;margin-left:10pt;width:120pt;height:60pt"). */
export function readVmlStyle(style: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!style) return out;
  const map: Record<string, string> = {};
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) map[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  const len = (v: string | undefined) => {
    if (!v) return null;
    const t = num(v); // twips for units, raw for bare numbers
    if (t == null) return null;
    return /[a-z]$/i.test(v) ? Math.round(t / 15) : Math.round(t);
  };
  const w = len(map.width);
  const h = len(map.height);
  if (w) out.width = w;
  if (h) out.height = h;
  if (map.position === "absolute") {
    out.wrap = "square";
    const ml = len(map["margin-left"]);
    const mt = len(map["margin-top"]);
    if (ml) out.hOffset = ml;
    if (mt) out.vOffset = mt;
  }
  if (map.rotation) out.rotate = Math.round(parseFloat(map.rotation) || 0);
  return out;
}

// --- writing --------------------------------------------------------------------------------

export interface DrawingBoxInput {
  attrs: Record<string, unknown>;
  cx: number;
  cy: number;
  id: number;
  name: string;
  descr?: string;
  graphic: string;
  /** Aspect-ratio lock for pictures. */
  picture?: boolean;
}

/** a:xfrm attributes (rotation in 60000ths of a degree, flips). */
export function xfrmAttrs(a: Record<string, unknown>): Record<string, string | number | undefined> {
  const rot = Math.round(Number(a.rotate) || 0) % 360;
  return {
    rot: rot ? rot * 60000 : undefined,
    flipH: a.flipH ? "1" : undefined,
    flipV: a.flipV ? "1" : undefined,
  };
}

/** a:srcRect for a picture's crop (empty when uncropped). */
export function srcRectXml(a: Record<string, unknown>): string {
  const v = (k: string) => {
    const n = Math.round((Number(a[k]) || 0) * 100000);
    return n ? n : undefined;
  };
  const attrs = { l: v("cropL"), t: v("cropT"), r: v("cropR"), b: v("cropB") };
  return Object.values(attrs).some((x) => x != null) ? el("a:srcRect", attrs) : "";
}

function positionXml(tag: "wp:positionH" | "wp:positionV", rel: string, align: unknown, offset: unknown, pct: unknown): string {
  const inner = align ? `<wp:align>${esc(String(align))}</wp:align>` : `<wp:posOffset>${emu(Number(offset) || 0)}</wp:posOffset>`;
  if (pct != null && !align) {
    const p = Math.round(Number(pct) * 1000);
    const pctTag = tag === "wp:positionH" ? "wp14:pctPosHOffset" : "wp14:pctPosVOffset";
    return (
      `<mc:AlternateContent><mc:Choice Requires="wp14">${el(tag, { relativeFrom: rel }, `<${pctTag}>${p}</${pctTag}>`)}</mc:Choice>` +
      `<mc:Fallback>${el(tag, { relativeFrom: rel }, inner)}</mc:Fallback></mc:AlternateContent>`
    );
  }
  return el(tag, { relativeFrom: rel }, inner);
}

const RECT_POLYGON =
  '<wp:wrapPolygon edited="0"><wp:start x="0" y="0"/><wp:lineTo x="0" y="21600"/><wp:lineTo x="21600" y="21600"/><wp:lineTo x="21600" y="0"/><wp:lineTo x="0" y="0"/></wp:wrapPolygon>';

/** A wp:inline or wp:anchor around `graphic`, per the object's wrap. */
export function drawingBoxXml(b: DrawingBoxInput): string {
  const a = b.attrs;
  const wrap = String(a.wrap ?? "inline") as WrapType;
  const docPr = el("wp:docPr", { id: b.id, name: b.name, descr: b.descr || undefined });
  const frame = b.picture ? `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` : "<wp:cNvGraphicFramePr/>";
  const extent = el("wp:extent", { cx: b.cx, cy: b.cy }) + el("wp:effectExtent", { l: 0, t: 0, r: 0, b: 0 });
  if (wrap === "inline") return `<wp:inline distT="0" distB="0" distL="0" distR="0">${extent}${docPr}${frame}${b.graphic}</wp:inline>`;
  const d = a.dist != null ? emu(Number(a.dist)) : 114300;
  const side = String(a.wrapSide || "bothSides");
  const float = isFloat(wrap);
  const dist = {
    distT: wrap === "topBottom" ? d : 0,
    distB: wrap === "topBottom" ? d : 0,
    distL: float ? d : 114300,
    distR: float ? d : 114300,
  };
  let wrapXml: string;
  if (isAbsolute(wrap)) wrapXml = "<wp:wrapNone/>";
  else if (wrap === "topBottom") wrapXml = "<wp:wrapTopAndBottom/>";
  else if (wrap === "square") wrapXml = el("wp:wrapSquare", { wrapText: side });
  else wrapXml = el(wrap === "tight" ? "wp:wrapTight" : "wp:wrapThrough", { wrapText: side }, RECT_POLYGON);
  const sizeRel =
    (a.relW != null ? `<wp14:sizeRelH relativeFrom="${esc(String(a.relWFrom ?? "page"))}"><wp14:pctWidth>${Math.round(Number(a.relW) * 1000)}</wp14:pctWidth></wp14:sizeRelH>` : "") +
    (a.relH != null ? `<wp14:sizeRelV relativeFrom="${esc(String(a.relHFrom ?? "page"))}"><wp14:pctHeight>${Math.round(Number(a.relH) * 1000)}</wp14:pctHeight></wp14:sizeRelV>` : "");
  return (
    el(
      "wp:anchor",
      {
        ...dist,
        simplePos: "0",
        relativeHeight: Math.max(0, Math.round(Number(a.z) || 0)),
        behindDoc: wrap === "behind" ? "1" : "0",
        locked: "0",
        layoutInCell: "1",
        allowOverlap: "1",
      },
      '<wp:simplePos x="0" y="0"/>' +
        positionXml("wp:positionH", String(a.hRel || "column"), a.hAlign, a.hOffset, a.hPct) +
        positionXml("wp:positionV", String(a.vRel || "paragraph"), a.vAlign, a.vOffset, a.vPct) +
        extent +
        wrapXml +
        docPr +
        frame +
        b.graphic +
        sizeRel,
    )
  );
}

function srgb(c: string): string {
  const h = c.replace("#", "");
  const six = (h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6)).padEnd(6, "0").toUpperCase();
  return `<a:srgbClr val="${six}"/>`;
}

const hasColor = (c: unknown) => typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c);

/** The a:graphic of a wps shape; `txbx` is its w:txbxContent body. */
export function wspGraphicXml(a: Record<string, unknown>, cx: number, cy: number, txbx: string, textBox: boolean): string {
  const prst = String(a.prst || "rect");
  let av = "";
  try {
    const adj = a.adj ? (JSON.parse(String(a.adj)) as Record<string, number>) : null;
    if (adj) av = Object.entries(adj).map(([k, v]) => el("a:gd", { name: k, fmla: `val ${Math.round(v)}` })).join("");
  } catch {
    av = "";
  }
  const fill = hasColor(a.fill) ? `<a:solidFill>${srgb(String(a.fill))}</a:solidFill>` : "<a:noFill/>";
  const sw = a.strokeWidth != null ? Number(a.strokeWidth) : 1;
  const lineFill = hasColor(a.stroke) && sw > 0 ? `<a:solidFill>${srgb(String(a.stroke))}</a:solidFill>` : "<a:noFill/>";
  const dash = a.dash && a.dash !== "solid" ? el("a:prstDash", { val: String(a.dash) }) : "";
  const ends = (a.headEnd ? el("a:headEnd", { type: String(a.headEnd) }) : "") + (a.tailEnd ? el("a:tailEnd", { type: String(a.tailEnd) }) : "");
  const anchor = String(a.textAnchor || (textBox ? "t" : "ctr"));
  return (
    `<a:graphic><a:graphicData uri="${NS_WPS}"><wps:wsp>` +
    el("wps:cNvSpPr", { txBox: textBox ? "1" : undefined }) +
    `<wps:spPr>${el("a:xfrm", xfrmAttrs(a), `<a:off x="0" y="0"/>${el("a:ext", { cx, cy })}`)}` +
    `<a:prstGeom prst="${esc(prst)}"><a:avLst>${av}</a:avLst></a:prstGeom>${fill}` +
    `<a:ln w="${emu(sw)}">${lineFill}${dash}${ends}</a:ln></wps:spPr>` +
    (hasColor(a.textColor)
      ? `<wps:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>` +
        `<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor">${srgb(String(a.textColor))}</a:fontRef></wps:style>`
      : "") +
    (txbx ? `<wps:txbx><w:txbxContent>${txbx}</w:txbxContent></wps:txbx>` : "") +
    el("wps:bodyPr", { rot: "0", vert: "horz", wrap: "square", lIns: 91440, tIns: 45720, rIns: 91440, bIns: 45720, anchor, anchorCtr: "0" }, "<a:noAutofit/>") +
    `</wps:wsp></a:graphicData></a:graphic>`
  );
}

/** The a:graphic of a chart relationship. */
export function chartGraphicXml(rid: string): string {
  return `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="${esc(rid)}"/></a:graphicData></a:graphic>`;
}
