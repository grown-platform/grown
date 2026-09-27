// pptx writer: Grown DeckDoc → PowerPoint bytes.
//
// pptxgenjs builds the package; anything it cannot express (slide
// transitions) is patched into its output zip afterwards with jszip. The
// patch helpers work on XML strings so each one is unit-testable.

import JSZip from "jszip";
import { addCommentParts } from "./commentsXml";
import type PptxGenJSType from "pptxgenjs";
import {
  CANVAS_W,
  type DeckDoc,
  type Slide,
  type SlideElement,
  type SlideLayout,
} from "../model";
import { textBodyXml, type LinkRef, type LinkResolver } from "./textXml";
import { tableXml } from "./tableXml";
import { inlineImages } from "../assets";
import { toPpAction } from "../links";
import { deckSize } from "../slideProps";
import { findLayout, layoutsOf, withFooters } from "../layouts";
import { themeOf } from "../theme";
import { insertTiming, insertTransition, timingXml, transitionXml } from "./motionXml";
import { effectsOf } from "../animOps";
import { bgXml, gradFillXml, patchClrMap, patchLayoutXml, patchThemeXml, replaceBg, setPh, setSchemeFill, toField } from "./designXml";
import {
  CT_CHART,
  CT_XLSX,
  REL_AUDIO,
  REL_CHART,
  REL_PACKAGE,
  chartFrameXml,
  chartWorkbook,
  mediaExt,
  mediaExtXml,
  slideChartXml,
} from "./objectsXml";

/** Slide width written to every pptx: 10 in; the height follows the
 *  deck's size (5.625 in for 16:9). */
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

// Transitions and animations live in motionXml.ts (M8).
export { transitionXml, insertTransition } from "./motionXml";

// ------------------------------------------------------------ build

type Pptx = PptxGenJSType;
/** Extra pptxgenjs options (the group marker name). */
type Extra = { objectName?: string };
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

/** A text box. pptxgenjs only lays down the shape; its text body is
 *  replaced by textBodyXml in patchElements (runs, levels, links…). */
function addText(s: PSlide, el: SlideElement, extra: Extra) {
  s.addText((el.text || "").replace(/\v/g, "\n") || " ", {
    ...geomOpts(el),
    ...textRunOpts(el),
    ...extra,
  });
}

function addShape(s: PSlide, el: SlideElement, extra: Extra) {
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
    ...extra,
  });
}

/** A preset-geometry shape or connector. The preset name goes straight into
 *  `a:prstGeom@prst`; adjust values, connector conversion (`p:cxnSp`) and
 *  glue are patched in afterwards (patchElements). */
function addPreset(s: PSlide, el: SlideElement, extra: Extra) {
  const conn = el.type === "connector";
  const noFill =
    conn || !el.fill || el.fill === "none" || el.fill === "transparent";
  const stroked = !!el.stroke && el.stroke !== "none" && (el.strokeWidth ?? 1) > 0;
  const line = stroked
    ? {
        color: hex6(el.stroke),
        width: el.strokeWidth || 1,
        ...(el.dash && el.dash !== "solid" ? { dashType: el.dash } : {}),
        ...(conn && el.headEnd && el.headEnd !== "none" ? { beginArrowType: el.headEnd } : {}),
        ...(conn && el.tailEnd && el.tailEnd !== "none" ? { endArrowType: el.tailEnd } : {}),
      }
    : undefined;
  s.addShape(el.preset as Parameters<PSlide["addShape"]>[0], {
    ...geomOpts(el),
    ...(conn ? { h: pxToInch(el.h) } : {}),
    fill: noFill
      ? { type: "none" }
      : {
          color: hex6(el.fill),
          ...(transparencyOf(el.fill)
            ? { transparency: transparencyOf(el.fill) }
            : {}),
        },
    ...(line ? { line } : {}),
    ...linkOpt(el),
    ...extra,
  } as Parameters<PSlide["addShape"]>[1]);
}

/** A clip (M11): an uploaded (inlined) file is embedded; a YouTube/Vimeo
 *  page or a direct URL is linked (pptxgenjs "online"). The poster frame is
 *  the cover picture. Audio's a:audioFile and the playback options are
 *  patched in afterwards (patchElements). */
function addMedia(s: PSlide, el: SlideElement, extra: Extra) {
  const m = el.media;
  if (!m || !m.src) return;
  const cover = m.poster?.startsWith("data:image/") ? { cover: m.poster } : {};
  const geom = { x: pxToInch(el.x), y: pxToInch(el.y), w: pxToInch(el.w), h: pxToInch(Math.max(el.h, 1)) };
  if (m.src.startsWith("data:")) {
    s.addMedia({ ...geom, type: m.kind, data: m.src, extn: mediaExt(m.mime ?? /^data:([^;,]+)/.exec(m.src)?.[1], m.kind), ...cover, ...extra });
    return;
  }
  let link = m.src;
  try {
    link = new URL(m.src, typeof location !== "undefined" ? location.origin : "https://localhost").toString();
  } catch {
    /* keep as is */
  }
  s.addMedia({ ...geom, type: "online", link, ...cover, ...extra });
}

function addTable(s: PSlide, el: SlideElement, extra: Extra) {
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
    ...extra,
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
  // Pictures in the deck's asset store travel inside the package.
  deck = await inlineImages(deck);
  const mod = await import("pptxgenjs");
  const PptxGenJS = mod.default;
  const pptx = new PptxGenJS();
  const size = deckSize(deck);
  pptx.defineLayout({
    name: "GROWN",
    width: SLIDE_W_IN,
    height: Math.round(((SLIDE_W_IN * size.h) / CANVAS_W) * 10000) / 10000,
  });
  pptx.layout = "GROWN";
  pptx.title = title;
  const theme = themeOf(deck);
  pptx.theme = { headFontFace: theme.fonts.major, bodyFontFace: theme.fonts.minor };
  // Layouts (M7): each becomes a pptx slide layout (pptxgenjs "master"),
  // written only when some slide uses one.
  const layouts = deck.slides.some((s) => findLayout(deck, s.layout)) ? layoutsOf(deck) : [];
  const layoutNames = new Map<string, string>();
  for (const l of layouts) {
    let name = l.name || l.id;
    while ([...layoutNames.values()].includes(name)) name += " (2)";
    layoutNames.set(l.id, name);
    pptx.defineSlideMaster({ title: name, objects: [] });
  }
  const slideGroups: Map<string, SlideElement>[] = [];
  const slideEls: ElementMark[][] = [];
  const autoDate = deck.hf?.dateText === undefined;
  for (let si = 0; si < deck.slides.length; si++) {
    // Header/footer boxes are written as the slide's dt/ftr/sldNum placeholders.
    const slide = withFooters(deck, si);
    const masterName = slide.layout ? layoutNames.get(slide.layout) : undefined;
    const s = masterName ? pptx.addSlide({ masterName }) : pptx.addSlide();
    if (slide.hidden) s.hidden = true;
    if (slide.bgFill?.kind === "image")
      s.background = slide.bgFill.src.startsWith("data:") ? { data: slide.bgFill.src } : { path: slide.bgFill.src };
    else s.background = { color: hex6(slide.background || "#ffffff") };
    const groups = new Map<string, SlideElement>();
    // Slides with preset shapes/connectors mark every element, so adjust
    // values, connectors and glue targets can be found after pptxgenjs.
    const marks: ElementMark[] = [];
    const mark = needsElementPatch(slide.elements) || effectsOf(slide).length > 0;
    const emit = (el: SlideElement, path: string[]) => {
      if (el.type === "group") {
        const key = `g${groups.size + 1}`;
        groups.set(key, el);
        for (const c of el.children || []) emit(c, [...path, key]);
        return;
      }
      let extra: Extra = path.length ? { objectName: groupMarker(path) } : {};
      if (mark) {
        extra = { objectName: `${ELEMENT_MARKER}${marks.length}` };
        const field =
          el.placeholder?.type === "sldNum" ? "slidenum" : el.placeholder?.type === "dt" && autoDate ? "datetime1" : undefined;
        marks.push({ el, path, ...(field ? { field } : {}) });
      }
      try {
        if (el.type === "shape" || el.type === "connector") {
          if (el.preset) addPreset(s, el, extra);
        } else if (el.type === "chart") {
          // A stand-in the patch swaps for a p:graphicFrame + chart part.
          if (el.chart) s.addShape("rect", { ...geomOpts(el), fill: { type: "none" }, ...extra });
        } else if (el.type === "media") addMedia(s, el, extra);
        else if (el.type === "text") addText(s, el, extra);
        else if (el.type === "table") addTable(s, el, extra);
        else if (el.type === "line") {
          s.addShape("line", {
            ...geomOpts({ ...el, h: 0 }),
            h: 0,
            line: { color: hex6(el.stroke), width: el.strokeWidth || 2 },
            ...linkOpt(el),
            ...extra,
          });
        } else if (el.type === "image") {
          if (!el.src) return;
          const src = el.src.startsWith("data:")
            ? { data: el.src }
            : { path: el.src };
          s.addImage({ ...geomOpts(el), ...src, ...linkOpt(el), ...extra });
        } else addShape(s, el, extra);
      } catch {
        /* skip an element pptxgenjs rejects rather than failing the export */
      }
    };
    for (const el of slide.elements) emit(el, []);
    slideGroups.push(groups);
    slideEls.push(marks);
    if (slide.notes && slide.notes.trim()) s.addNotes(slide.notes);
  }
  const raw = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return patchPptx(raw, deck, slideGroups, slideEls, layouts.map((l) => ({ layout: l, name: layoutNames.get(l.id)! })));
}

/** Apply the XML patches pptxgenjs cannot express: transitions, and the
 *  `p:grpSp` wrappers for groups (see wrapGroups). */
export async function patchPptx(
  raw: Uint8Array,
  deck: DeckDoc,
  slideGroups: Map<string, SlideElement>[] = [],
  slideEls: ElementMark[][] = [],
  layouts: { layout: SlideLayout; name: string }[] = [],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(raw);
  // Theme (M7): colour scheme + name; a dark theme's colour map.
  const theme = themeOf(deck);
  for (const f of zip.file(/^ppt\/theme\/theme\d+\.xml$/))
    zip.file(f.name, patchThemeXml(await f.async("string"), theme));
  if (theme.dark)
    for (const f of zip.file(/^ppt\/slideMasters\/slideMaster\d+\.xml$/))
      zip.file(f.name, patchClrMap(await f.async("string"), true));
  // Layouts: found by the name pptxgenjs gave them.
  if (layouts.length) {
    const byName = new Map(layouts.map((l) => [l.name, l.layout]));
    for (const f of zip.file(/^ppt\/slideLayouts\/slideLayout\d+\.xml$/)) {
      const xml = await f.async("string");
      const name = /<p:cSld\b[^>]*\bname="([^"]*)"/.exec(xml)?.[1];
      const l = name !== undefined ? byName.get(unescapeXml(name)) : undefined;
      if (l) zip.file(f.name, patchLayoutXml(xml, l));
    }
  }
  // Charts (M11): parts collected while patching slides, written after.
  const charts: SlideElement[] = [];
  for (let i = 0; i < deck.slides.length; i++) {
    const xml = transitionXml(deck.slides[i]);
    const animated = effectsOf(deck.slides[i]).length > 0;
    const groups = slideGroups[i];
    const marks = slideEls[i];
    const bg = bgXml(deck.slides[i]);
    if (!xml && !groups?.size && !marks?.length && !bg && !animated) continue;
    const path = `ppt/slides/slide${i + 1}.xml`;
    const f = zip.file(path);
    if (!f) continue;
    let out = await f.async("string");
    if (marks?.length) {
      const relsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
      const relsFile = zip.file(relsPath);
      const rels = relsFile ? new SlideRels(await relsFile.async("string")) : null;
      const spids = new Map<string, string>();
      const objects: ObjectSink | undefined = rels
        ? {
            chart: (el) => {
              charts.push(el);
              return rels.add(REL_CHART, `../charts/chart${charts.length}.xml`, false);
            },
            rel: (type, target, external) => rels.add(type, target, external),
          }
        : undefined;
      out = patchElements(out, marks, rels ? linkResolver(rels, deck.slides) : undefined, spids, objects);
      if (animated) {
        // Only top-level elements carry effects (group members are wrapped later).
        for (const m of marks) if (m.path.length) spids.delete(m.el.id);
        out = insertTiming(out, timingXml(deck.slides[i], spids));
      }
      if (rels?.changed) zip.file(relsPath, rels.xml());
    }
    if (groups?.size) out = wrapGroups(out, groups);
    if (xml) out = insertTransition(out, xml);
    if (bg) out = replaceBg(out, bg);
    zip.file(path, out);
  }
  if (charts.length) await addChartParts(zip, charts, theme);
  // Comment threads (M10).
  await addCommentParts(zip, deck, SLIDE_W_IN);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Write chart parts (and their embedded workbooks) and register them. */
async function addChartParts(zip: JSZip, charts: SlideElement[], theme: ReturnType<typeof themeOf>) {
  const ctPath = "[Content_Types].xml";
  let ct = (await zip.file(ctPath)?.async("string")) ?? "";
  for (let n = 1; n <= charts.length; n++) {
    const chart = charts[n - 1].chart!;
    const book = `Microsoft_Excel_Worksheet${n}.xlsx`;
    let rid: string | undefined;
    try {
      zip.file(`ppt/embeddings/${book}`, await chartWorkbook(chart));
      rid = "rId1";
      zip.file(
        `ppt/charts/_rels/chart${n}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${REL_PACKAGE}" Target="../embeddings/${book}"/></Relationships>`,
      );
    } catch {
      /* cached values only */
    }
    zip.file(`ppt/charts/chart${n}.xml`, slideChartXml(chart, theme, rid));
    if (!ct.includes(`PartName="/ppt/charts/chart${n}.xml"`))
      ct = ct.replace("</Types>", `<Override PartName="/ppt/charts/chart${n}.xml" ContentType="${CT_CHART}"/></Types>`);
  }
  if (!/Extension="xlsx"/i.test(ct)) ct = ct.replace("</Types>", `<Default Extension="xlsx" ContentType="${CT_XLSX}"/></Types>`);
  zip.file(ctPath, ct);
}

function unescapeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ------------------------------------------------------------ groups

/**
 * pptxgenjs has no group shapes, so group members are written flat in
 * z-order with a marker `cNvPr@name` naming their group path; wrapGroups
 * then nests them into `p:grpSp` elements. Grown stores members in absolute
 * coordinates, so each group's child frame equals its own frame
 * (chOff = off, chExt = ext).
 */
export const GROUP_MARKER = "grown-grp:";

/** The marker object name for a member of the (nested) groups `path`. */
export function groupMarker(path: string[]): string {
  return `${GROUP_MARKER}${path.join("/")}`;
}

const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const EMU_PER_IN = 914400;
const emu = (px: number) => String(Math.round(pxToInch(px) * EMU_PER_IN));

/** Nest marker-named members of a slide part into `p:grpSp` elements. */
export function wrapGroups(
  slideXml: string,
  groups: Map<string, SlideElement>,
): string {
  const doc = new DOMParser().parseFromString(slideXml, "application/xml");
  const spTree = doc.getElementsByTagNameNS(P_NS, "spTree")[0];
  if (!spTree) return slideXml;
  let nextId = 0;
  for (const c of Array.from(doc.getElementsByTagNameNS(P_NS, "cNvPr")))
    nextId = Math.max(nextId, Number(c.getAttribute("id")) || 0);
  let memberNo = 0;
  const p = (name: string) => doc.createElementNS(P_NS, `p:${name}`);
  const a = (name: string, attrs: Record<string, string>) => {
    const e = doc.createElementNS(A_NS, `a:${name}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const makeGroup = (key: string): Element => {
    const g = groups.get(key);
    const grp = p("grpSp");
    const nv = p("nvGrpSpPr");
    const cNvPr = p("cNvPr");
    cNvPr.setAttribute("id", String(++nextId));
    cNvPr.setAttribute("name", g?.name || `Group ${nextId}`);
    nv.append(cNvPr, p("cNvGrpSpPr"), p("nvPr"));
    const pr = p("grpSpPr");
    const xfrm = a("xfrm", {});
    if (g?.rotation) xfrm.setAttribute("rot", String(Math.round(g.rotation * 60000)));
    if (g?.flipH) xfrm.setAttribute("flipH", "1");
    if (g?.flipV) xfrm.setAttribute("flipV", "1");
    const x = emu(g?.x ?? 0);
    const y = emu(g?.y ?? 0);
    const cx = emu(g?.w ?? 0);
    const cy = emu(g?.h ?? 0);
    xfrm.append(
      a("off", { x, y }),
      a("ext", { cx, cy }),
      a("chOff", { x, y }),
      a("chExt", { cx, cy }),
    );
    pr.append(xfrm);
    grp.append(nv, pr);
    return grp;
  };
  const stack: { key: string; node: Element }[] = [];
  for (const k of Array.from(spTree.children)) {
    const cNvPr = k.getElementsByTagNameNS(P_NS, "cNvPr")[0];
    const name = cNvPr?.getAttribute("name") ?? "";
    const path = name.startsWith(GROUP_MARKER)
      ? name.slice(GROUP_MARKER.length).split("/")
      : [];
    if (path.length) cNvPr!.setAttribute("name", `Shape ${++memberNo}`);
    // Close groups this element is not in.
    while (
      stack.length &&
      (stack.length > path.length ||
        stack.some((s, i) => s.key !== path[i]))
    )
      stack.pop();
    // Open the groups it starts.
    for (let d = stack.length; d < path.length; d++) {
      const grp = makeGroup(path[d]);
      if (d === 0) spTree.insertBefore(grp, k);
      else stack[d - 1].node.appendChild(grp);
      stack.push({ key: path[d], node: grp });
    }
    if (stack.length) stack[stack.length - 1].node.appendChild(k);
  }
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>\s*/.exec(slideXml);
  if (decl && !out.startsWith("<?xml")) out = decl[0] + out;
  return out;
}

// ------------------------------------------------------------ presets

/** An element emitted on a marked slide, with its group path. */
export interface ElementMark {
  el: SlideElement;
  path: string[];
  /** Header/footer field the text is written as (slide number, date). */
  field?: "slidenum" | "datetime1";
}

export const ELEMENT_MARKER = "grown-el:";

/** Slides with preset shapes, connectors or text boxes are marked: presets
 *  get adjust values and glue, text boxes get their own text body. */
function needsElementPatch(els: readonly SlideElement[]): boolean {
  return els.some(
    (e) =>
      e.type === "shape" ||
      e.type === "connector" ||
      e.type === "text" ||
      e.type === "table" ||
      e.type === "image" ||
      e.type === "chart" ||
      e.type === "media" ||
      !!e.alt ||
      !!e.placeholder ||
      !!e.themeRefs ||
      (e.children ? needsElementPatch(e.children) : false),
  );
}

const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_HYPERLINK = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const REL_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A slide's relationships part, for adding hyperlink/slide targets. */
export class SlideRels {
  private doc: Document;
  private next = 1;
  changed = false;
  constructor(xml: string) {
    this.doc = new DOMParser().parseFromString(xml, "application/xml");
    for (const r of Array.from(this.doc.getElementsByTagNameNS(REL_NS, "Relationship"))) {
      const m = /^rId(\d+)$/.exec(r.getAttribute("Id") || "");
      if (m) this.next = Math.max(this.next, Number(m[1]) + 1);
    }
  }
  /** Add (or reuse) a relationship; returns its id. */
  add(type: string, target: string, external: boolean): string {
    for (const r of Array.from(this.doc.getElementsByTagNameNS(REL_NS, "Relationship")))
      if (
        r.getAttribute("Type") === type &&
        r.getAttribute("Target") === target &&
        (r.getAttribute("TargetMode") === "External") === external
      )
        return r.getAttribute("Id")!;
    const id = `rId${this.next++}`;
    const r = this.doc.createElementNS(REL_NS, "Relationship");
    r.setAttribute("Id", id);
    r.setAttribute("Type", type);
    r.setAttribute("Target", target);
    if (external) r.setAttribute("TargetMode", "External");
    this.doc.documentElement.appendChild(r);
    this.changed = true;
    return id;
  }
  xml(): string {
    const out = new XMLSerializer().serializeToString(this.doc);
    return out.startsWith("<?xml") ? out : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${out}`;
  }
}

/** Link resolver for textBodyXml: external URLs become hyperlink
 *  relationships, slide jumps `ppaction://` actions (plus a slide
 *  relationship for a specific slide). */
export function linkResolver(rels: SlideRels, slides: readonly Slide[]): LinkResolver {
  return (url: string): LinkRef | null => {
    const pp = toPpAction(url, slides);
    if (pp) {
      if (pp.slideIndex === undefined) return { rid: "", action: pp.action };
      return { rid: rels.add(REL_SLIDE, `slide${pp.slideIndex + 1}.xml`, false), action: pp.action };
    }
    if (url.startsWith("#")) return null;
    return { rid: rels.add(REL_HYPERLINK, url, true) };
  };
}

const TYPE_NAME: Partial<Record<SlideElement["type"], string>> = {
  text: "TextBox",
  image: "Picture",
  table: "Table",
  connector: "Connector",
  line: "Straight Connector",
};

/**
 * Finish the elements pptxgenjs wrote for a marked slide: write adjust
 * values into `a:avLst`, turn connectors into `p:cxnSp` with `a:stCxn` /
 * `a:endCxn` glue (ids of the target shapes), and replace the marker names
 * with the element's name (or a group marker for wrapGroups).
 */
/** Relationship helpers patchElements needs for charts and media (M11). */
export interface ObjectSink {
  /** Register a chart part for `el`; returns the slide relationship id. */
  chart: (el: SlideElement) => string;
  /** Add (or reuse) a slide relationship. */
  rel: (type: string, target: string, external: boolean) => string;
}

export function patchElements(
  slideXml: string,
  marks: ElementMark[],
  link?: LinkResolver,
  idOf: Map<string, string> = new Map(),
  objects?: ObjectSink,
): string {
  const doc = new DOMParser().parseFromString(slideXml, "application/xml");
  const found: { mark: ElementMark; node: Element; cNvPr: Element }[] = [];
  for (const cNvPr of Array.from(doc.getElementsByTagNameNS(P_NS, "cNvPr"))) {
    const name = cNvPr.getAttribute("name") ?? "";
    if (!name.startsWith(ELEMENT_MARKER)) continue;
    const mark = marks[Number(name.slice(ELEMENT_MARKER.length))];
    const node = cNvPr.parentNode?.parentNode as Element | null;
    if (!mark || !node) continue;
    idOf.set(mark.el.id, cNvPr.getAttribute("id") ?? "");
    found.push({ mark, node, cNvPr });
  }
  const a = (name: string, attrs: Record<string, string>) => {
    const e = doc.createElementNS(A_NS, `a:${name}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  for (const { mark, node, cNvPr } of found) {
    const { el, path } = mark;
    cNvPr.setAttribute(
      "name",
      path.length
        ? groupMarker(path)
        : el.name || `${TYPE_NAME[el.type] ?? "Shape"} ${cNvPr.getAttribute("id")}`,
    );
    if (el.alt) cNvPr.setAttribute("descr", el.alt);
    else cNvPr.removeAttribute("descr"); // pptxgenjs writes the image path/data here
    if (el.placeholder && !path.length) setPh(doc, node, el.placeholder);
    // Theme colours (M7): fill / outline as scheme references.
    const spPr = Array.from(node.children).find((c) => c.localName === "spPr");
    if (el.themeRefs?.fill && el.fill && el.fill !== "none") setSchemeFill(doc, spPr, el.themeRefs.fill);
    if (el.themeRefs?.stroke && el.stroke && el.stroke !== "none")
      setSchemeFill(doc, spPr ? Array.from(spPr.children).find((c) => c.localName === "ln") : undefined, el.themeRefs.stroke);
    if (el.type === "image") {
      patchPicture(doc, node, el);
      continue;
    }
    if (el.type === "chart") {
      if (el.chart && objects) replaceWithChart(doc, node, cNvPr, el, objects.chart(el));
      else node.parentNode?.removeChild(node);
      continue;
    }
    if (el.type === "media") {
      if (el.media) patchMedia(doc, node, el.media, objects);
      continue;
    }
    if (el.type === "text") {
      replaceTxBody(doc, node, textBodyXml(el, link ?? (() => null)));
      if (mark.field) toField(doc, node, mark.field);
      continue;
    }
    if (el.type === "table" && el.table) {
      replaceTable(doc, node, tableXml(el, link ?? (() => null)));
      continue;
    }
    if ((el.type !== "shape" && el.type !== "connector") || !el.preset) continue;
    if (el.type === "shape" && el.gradFill && spPr) setGradFill(doc, spPr, gradFillXml(el.gradFill));
    const geom = node.getElementsByTagNameNS(A_NS, "prstGeom")[0];
    if (geom) {
      geom.setAttribute("prst", el.preset);
      let av = geom.getElementsByTagNameNS(A_NS, "avLst")[0];
      if (!av) {
        av = a("avLst", {});
        geom.appendChild(av);
      }
      while (av.firstChild) av.removeChild(av.firstChild);
      for (const [k, v] of Object.entries(el.adj ?? {}))
        if (Number.isFinite(v)) av.appendChild(a("gd", { name: k, fmla: `val ${Math.round(v)}` }));
    }
    if (el.type === "connector" && node.localName === "sp") toCxnSp(doc, node, cNvPr, el, idOf);
  }
  let out = new XMLSerializer().serializeToString(doc);
  const decl = /^<\?xml[^>]*\?>\s*/.exec(slideXml);
  if (decl && !out.startsWith("<?xml")) out = decl[0] + out;
  return out;
}

/** Replace the fill of `spPr` with an `a:gradFill` (after the geometry, as
 *  CT_ShapeProperties orders it). */
function setGradFill(doc: Document, spPr: Element, xml: string) {
  const parsed = new DOMParser().parseFromString(`<w xmlns:a="${A_NS}">${xml}</w>`, "application/xml");
  const grad = parsed.documentElement.firstElementChild;
  if (!grad || parsed.getElementsByTagName("parsererror").length) return;
  const FILLS = new Set(["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"]);
  for (const c of Array.from(spPr.children)) if (FILLS.has(c.localName)) spPr.removeChild(c);
  const geom = Array.from(spPr.children).find((c) => c.localName === "prstGeom" || c.localName === "custGeom");
  const node = doc.importNode(grad, true);
  if (geom) spPr.insertBefore(node, geom.nextSibling);
  else spPr.appendChild(node);
}

/** Swap a chart's stand-in shape for a p:graphicFrame showing chart `rid`. */
function replaceWithChart(doc: Document, sp: Element, cNvPr: Element, el: SlideElement, rid: string) {
  const xml = chartFrameXml(cNvPr.getAttribute("id") ?? "0", cNvPr.getAttribute("name") ?? "Chart", el, rid);
  const parsed = new DOMParser().parseFromString(`<w xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">${xml}</w>`, "application/xml");
  const frame = parsed.documentElement.firstElementChild;
  if (!frame || parsed.getElementsByTagName("parsererror").length) return;
  sp.parentNode?.replaceChild(doc.importNode(frame, true), sp);
}

/** Finish a media `p:pic`: audio clips get `a:audioFile` (pptxgenjs writes
 *  a:videoFile for both; a linked clip also gets an audio relationship),
 *  and the playback options go into a Grown `p:nvPr` extension. */
function patchMedia(doc: Document, pic: Element, m: NonNullable<SlideElement["media"]>, objects?: ObjectSink) {
  const nvPr = pic.getElementsByTagNameNS(P_NS, "nvPr")[0];
  if (!nvPr) return;
  const vf = Array.from(nvPr.children).find((c) => c.localName === "videoFile");
  if (vf && m.kind === "audio") {
    const af = doc.createElementNS(A_NS, "a:audioFile");
    let rid = vf.getAttributeNS(R_NS, "link") ?? "";
    const linked = !m.src.startsWith("data:");
    if (linked && objects) {
      let target = m.src;
      try {
        target = new URL(m.src, typeof location !== "undefined" ? location.origin : "https://localhost").toString();
      } catch {
        /* keep */
      }
      rid = objects.rel(REL_AUDIO, target, true);
    }
    af.setAttributeNS(R_NS, "r:link", rid);
    nvPr.replaceChild(af, vf);
  }
  let extLst = Array.from(nvPr.children).find((c) => c.localName === "extLst");
  if (!extLst) {
    extLst = doc.createElementNS(P_NS, "p:extLst");
    nvPr.appendChild(extLst);
  }
  const parsed = new DOMParser().parseFromString(`<w xmlns:p="${P_NS}">${mediaExtXml(m)}</w>`, "application/xml");
  const ext = parsed.documentElement.firstElementChild;
  if (ext) extLst.appendChild(doc.importNode(ext, true));
}

/** Swap a shape's `p:txBody` for `xml` (from textBodyXml). */
function replaceTxBody(doc: Document, sp: Element, xml: string) {
  const parsed = new DOMParser().parseFromString(
    `<w xmlns:p="${P_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">${xml}</w>`,
    "application/xml",
  );
  const body = parsed.documentElement.firstElementChild;
  if (!body || parsed.getElementsByTagName("parsererror").length) return;
  const node = doc.importNode(body, true);
  const old = Array.from(sp.children).find((c) => c.localName === "txBody");
  if (old) sp.replaceChild(node, old);
  else sp.appendChild(node);
}

/**
 * Finish a `p:pic`: crop (`a:srcRect`, 1/100 000 of the picture per side),
 * opacity (`a:alphaModFix`), crop to shape (`a:prstGeom`), border (`a:ln`)
 * and shadow (`a:effectLst/a:outerShdw`).
 */
export function patchPicture(doc: Document, pic: Element, el: SlideElement) {
  const a = (name: string, attrs: Record<string, string> = {}) => {
    const e = doc.createElementNS(A_NS, `a:${name}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const kid = (p: Element | undefined | null, name: string) =>
    p ? Array.from(p.children).find((c) => c.localName === name) : undefined;
  const blipFill = kid(pic, "blipFill");
  const blip = kid(blipFill, "blip");
  if (blip) {
    for (const c of Array.from(blip.children)) if (c.localName === "alphaModFix") blip.removeChild(c);
    if (el.opacity !== undefined && el.opacity < 1)
      blip.insertBefore(a("alphaModFix", { amt: String(Math.round(el.opacity * 100000)) }), blip.firstChild);
  }
  if (blipFill) {
    for (const c of Array.from(blipFill.children)) if (c.localName === "srcRect") blipFill.removeChild(c);
    const c = el.crop;
    if (c && (c.l || c.t || c.r || c.b)) {
      const v = (x: number) => String(Math.round(x * 100000));
      const src = a("srcRect", {});
      if (c.l) src.setAttribute("l", v(c.l));
      if (c.t) src.setAttribute("t", v(c.t));
      if (c.r) src.setAttribute("r", v(c.r));
      if (c.b) src.setAttribute("b", v(c.b));
      blipFill.insertBefore(src, blip ? blip.nextSibling : blipFill.firstChild);
    }
  }
  const spPr = kid(pic, "spPr");
  if (!spPr) return;
  const geom = kid(spPr, "prstGeom");
  if (geom) geom.setAttribute("prst", el.cropShape || "rect");
  for (const c of Array.from(spPr.children)) if (c.localName === "ln" || c.localName === "effectLst") spPr.removeChild(c);
  if (el.stroke && el.stroke !== "none" && (el.strokeWidth ?? 0) > 0) {
    const ln = a("ln", { w: String(Math.round((el.strokeWidth || 1) * 12700)) });
    const fill = a("solidFill");
    fill.appendChild(a("srgbClr", { val: hex6(el.stroke) }));
    ln.append(fill, a("prstDash", { val: el.dash ?? "solid" }));
    spPr.appendChild(ln);
  }
  if (el.shadow) {
    const eff = a("effectLst");
    const sh = a("outerShdw", { blurRad: "50800", dist: "38100", dir: "2700000", algn: "tl", rotWithShape: "0" });
    const clr = a("prstClr", { val: "black" });
    clr.appendChild(a("alpha", { val: "45000" }));
    sh.appendChild(clr);
    eff.appendChild(sh);
    spPr.appendChild(eff);
  }
}

/** Swap a graphic frame's `a:tbl` for `xml` (from tableXml). */
function replaceTable(doc: Document, frame: Element, xml: string) {
  const parsed = new DOMParser().parseFromString(
    `<w xmlns:a="${A_NS}" xmlns:r="${R_NS}">${xml}</w>`,
    "application/xml",
  );
  const tbl = parsed.documentElement.firstElementChild;
  if (!tbl || parsed.getElementsByTagName("parsererror").length) return;
  const old = frame.getElementsByTagNameNS(A_NS, "tbl")[0];
  if (old) old.parentNode?.replaceChild(doc.importNode(tbl, true), old);
}

/** Rebuild a `p:sp` as a `p:cxnSp` (no text body), with glue references. */
function toCxnSp(
  doc: Document,
  sp: Element,
  cNvPr: Element,
  el: SlideElement,
  idOf: Map<string, string>,
) {
  const p = (name: string) => doc.createElementNS(P_NS, `p:${name}`);
  const cxn = p("cxnSp");
  const nv = p("nvCxnSpPr");
  const cNv = p("cNvCxnSpPr");
  for (const [tag, ref] of [
    ["stCxn", el.stCxn],
    ["endCxn", el.endCxn],
  ] as const) {
    const id = ref && idOf.get(ref.id);
    if (!ref || !id) continue;
    const e = doc.createElementNS(A_NS, `a:${tag}`);
    e.setAttribute("id", id);
    e.setAttribute("idx", String(ref.idx));
    cNv.appendChild(e);
  }
  const oldNv = cNvPr.parentNode as Element;
  const nvPr = Array.from(oldNv.children).find((c) => c.localName === "nvPr") ?? p("nvPr");
  nv.append(cNvPr, cNv, nvPr);
  cxn.appendChild(nv);
  const spPr = Array.from(sp.children).find((c) => c.localName === "spPr");
  if (spPr) cxn.appendChild(spPr);
  const style = Array.from(sp.children).find((c) => c.localName === "style");
  if (style) cxn.appendChild(style);
  sp.parentNode?.replaceChild(cxn, sp);
}
