// pptx writer: Grown DeckDoc → PowerPoint bytes.
//
// pptxgenjs builds the package; anything it cannot express (slide
// transitions) is patched into its output zip afterwards with jszip. The
// patch helpers work on XML strings so each one is unit-testable.

import JSZip from "jszip";
import type PptxGenJSType from "pptxgenjs";
import {
  CANVAS_W,
  type DeckDoc,
  type Slide,
  type SlideElement,
  type TransitionType,
} from "../model";
import { textBodyXml, type LinkRef, type LinkResolver } from "./textXml";
import { toPpAction } from "../links";

/** Slide size written to every pptx: 10 in × 5.625 in (16:9). */
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

/**
 * The `<p:transition>` element for a Grown transition, or "" for none.
 * Directions follow PowerPoint: "Push from right" moves the old slide left
 * (`dir="l"`).
 */
export function transitionXml(t: TransitionType | undefined): string {
  switch (t) {
    case "fade":
      return `<p:transition spd="med"><p:fade/></p:transition>`;
    case "slide-left":
      return `<p:transition spd="med"><p:push dir="l"/></p:transition>`;
    case "slide-right":
      return `<p:transition spd="med"><p:push dir="r"/></p:transition>`;
    case "slide-up":
      return `<p:transition spd="med"><p:push dir="u"/></p:transition>`;
    default:
      return "";
  }
}

/**
 * Insert a transition into a slide part. ECMA-376 orders the children of
 * `<p:sld>` as cSld, clrMapOvr, transition, timing, extLst, so it goes right
 * after clrMapOvr (or cSld when there is no colour-map override). An existing
 * transition is replaced.
 */
export function insertTransition(slideXml: string, xml: string): string {
  const s = slideXml.replace(
    /<p:transition\b(?:[^>]*\/>|[\s\S]*?<\/p:transition>)/,
    "",
  );
  if (!xml) return s;
  for (const anchor of ["</p:clrMapOvr>", "</p:cSld>"]) {
    const i = s.indexOf(anchor);
    if (i >= 0) {
      const at = i + anchor.length;
      return s.slice(0, at) + xml + s.slice(at);
    }
  }
  return s;
}

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
  const mod = await import("pptxgenjs");
  const PptxGenJS = mod.default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "GROWN16x9",
    width: SLIDE_W_IN,
    height: SLIDE_H_IN,
  });
  pptx.layout = "GROWN16x9";
  pptx.title = title;
  const slideGroups: Map<string, SlideElement>[] = [];
  const slideEls: ElementMark[][] = [];
  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    s.background = { color: hex6(slide.background || "#ffffff") };
    const groups = new Map<string, SlideElement>();
    // Slides with preset shapes/connectors mark every element, so adjust
    // values, connectors and glue targets can be found after pptxgenjs.
    const marks: ElementMark[] = [];
    const mark = needsElementPatch(slide.elements);
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
        marks.push({ el, path });
      }
      try {
        if (el.type === "shape" || el.type === "connector") {
          if (el.preset) addPreset(s, el, extra);
        } else if (el.type === "text") addText(s, el, extra);
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
  return patchPptx(raw, deck, slideGroups, slideEls);
}

/** Apply the XML patches pptxgenjs cannot express: transitions, and the
 *  `p:grpSp` wrappers for groups (see wrapGroups). */
export async function patchPptx(
  raw: Uint8Array,
  deck: DeckDoc,
  slideGroups: Map<string, SlideElement>[] = [],
  slideEls: ElementMark[][] = [],
): Promise<Uint8Array> {
  const hasTransitions = deck.slides.some(
    (s) => s.transition && s.transition !== "none",
  );
  const hasGroups = slideGroups.some((g) => g.size > 0);
  const hasMarks = slideEls.some((m) => m.length > 0);
  if (!hasTransitions && !hasGroups && !hasMarks) return raw;
  const zip = await JSZip.loadAsync(raw);
  for (let i = 0; i < deck.slides.length; i++) {
    const xml = transitionXml(deck.slides[i].transition);
    const groups = slideGroups[i];
    const marks = slideEls[i];
    if (!xml && !groups?.size && !marks?.length) continue;
    const path = `ppt/slides/slide${i + 1}.xml`;
    const f = zip.file(path);
    if (!f) continue;
    let out = await f.async("string");
    if (marks?.length) {
      const relsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
      const relsFile = zip.file(relsPath);
      const rels = relsFile ? new SlideRels(await relsFile.async("string")) : null;
      out = patchElements(out, marks, rels ? linkResolver(rels, deck.slides) : undefined);
      if (rels?.changed) zip.file(relsPath, rels.xml());
    }
    if (groups?.size) out = wrapGroups(out, groups);
    if (xml) out = insertTransition(out, xml);
    zip.file(path, out);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
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
export function patchElements(slideXml: string, marks: ElementMark[], link?: LinkResolver): string {
  const doc = new DOMParser().parseFromString(slideXml, "application/xml");
  const idOf = new Map<string, string>();
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
    if (el.type === "text") {
      replaceTxBody(doc, node, textBodyXml(el, link ?? (() => null)));
      continue;
    }
    if ((el.type !== "shape" && el.type !== "connector") || !el.preset) continue;
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
