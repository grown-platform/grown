/**
 * vsdx.ts — a view-first Visio (.vsdx) reader for the whiteboard.
 *
 * Written from the MS-VSDX spec (Open Packaging Conventions + the Visio
 * ShapeSheet XML). It produces Excalidraw *element skeletons* (the input of
 * `convertToExcalidrawElements`), so this module stays pure and testable
 * without loading Excalidraw itself.
 *
 * What is read:
 *  - pages (visio/pages/pages.xml → page*.xml), page size, background pages skipped
 *  - shapes: PinX/PinY, Width/Height, LocPinX/LocPinY, Angle, FlipX/FlipY,
 *    group shapes (nested <Shapes>, child coordinates in the group's frame)
 *  - Geometry sections: MoveTo/LineTo/ArcTo/EllipticalArcTo/Ellipse/
 *    NURBSTo/PolylineTo/Spline*, Rel* variants (curves are sampled into polylines)
 *  - recognised primitives: rectangle, ellipse, diamond; everything else
 *    (triangles, polygons, curves, open paths) becomes a line polyline
 *  - fill/line: FillForegnd, FillPattern, LineColor, LineWeight, LinePattern,
 *    Rounding, BeginArrow/EndArrow, section NoFill/NoLine/NoShow
 *  - text with basic formatting (Character Size/Color, Paragraph HorzAlign,
 *    VerticalAlign), as container labels or free text
 *  - connectors: 1-D shapes (BeginX/EndX) glued via <Connects> become arrows
 *    bound to their shapes
 *  - master inheritance (masters/*.xml, Master/MasterShape attributes, row
 *    and section Del) and style-sheet fallback (LineStyle/FillStyle/TextStyle)
 *  - bitmap foreign shapes (png/jpeg/gif/svg) as images
 *
 * Units: Visio internal units are inches with Y pointing up; the whiteboard
 * uses 96 px per inch with Y pointing down.
 */
import JSZip from "jszip";

export const PX_PER_INCH = 96;

type Pt = [number, number];

/** A loose Excalidraw element skeleton (see ExcalidrawElementSkeleton). */
export type VsdxSkeleton = {
  type: string;
  id: string;
  x: number;
  y: number;
  [k: string]: unknown;
};

export interface VsdxFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export interface VsdxPage {
  name: string;
  /** Page size in px. */
  width: number;
  height: number;
  /** Elements in page coordinates (page top-left is 0,0). */
  elements: VsdxSkeleton[];
}

export interface VsdxDocument {
  pages: VsdxPage[];
  files: Record<string, VsdxFile>;
  warnings: string[];
}

// ---------------------------------------------------------------- XML model

interface RawRow {
  t: string;
  ix?: string;
  del: boolean;
  cells: Map<string, string>;
}
interface RawSection {
  n: string;
  ix?: string;
  del: boolean;
  cells: Map<string, string>;
  rows: RawRow[];
}
interface RawShape {
  id: string;
  name: string;
  type: string;
  master?: string;
  masterShape?: string;
  lineStyle?: string;
  fillStyle?: string;
  textStyle?: string;
  cells: Map<string, string>;
  sections: RawSection[];
  text?: string;
  children: RawShape[];
  /** Resolved package path of a foreign (image) part. */
  foreignPath?: string;
  del?: boolean;
}
interface StyleSheet {
  lineStyle?: string;
  fillStyle?: string;
  textStyle?: string;
  cells: Map<string, string>;
  sections: RawSection[];
}
interface MasterDef {
  shapes: RawShape[];
}

const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseXml(s: string): Document {
  const doc = new DOMParser().parseFromString(s, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("vsdx: malformed XML part");
  return doc;
}
function kids(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling)
    if (!name || c.localName === name) out.push(c);
  return out;
}
function kid(el: Element, name: string): Element | undefined {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling)
    if (c.localName === name) return c;
  return undefined;
}
function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === null ? undefined : v;
}
function relId(el: Element): string | undefined {
  return (
    el.getAttributeNS(REL_NS, "id") || el.getAttribute("r:id") || undefined
  );
}

/** readCells collects <Cell N V> children; "Themed" values fall through. */
function readCells(el: Element): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of kids(el, "Cell")) {
    const n = attr(c, "N");
    const v = attr(c, "V");
    if (!n || v === undefined || v === "Themed") continue;
    m.set(n, v);
  }
  return m;
}
function readSections(el: Element): RawSection[] {
  return kids(el, "Section").map((s) => ({
    n: attr(s, "N") || "",
    ix: attr(s, "IX"),
    del: attr(s, "Del") === "1",
    cells: readCells(s),
    rows: kids(s, "Row").map((r) => ({
      t: attr(r, "T") || "",
      ix: attr(r, "IX") ?? attr(r, "N"),
      del: attr(r, "Del") === "1",
      cells: readCells(r),
    })),
  }));
}

function readText(el: Element): string {
  let out = "";
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 || c.nodeType === 4) out += c.nodeValue ?? "";
      else if (c.nodeType === 1 && (c as Element).localName === "fld")
        out += c.textContent ?? "";
    }
  };
  walk(el);
  return out
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\s+$/, "");
}

function readShape(
  el: Element,
  resolveRel: (rid: string) => string | undefined,
): RawShape {
  const textEl = kid(el, "Text");
  const shapesEl = kid(el, "Shapes");
  const fd = kid(el, "ForeignData");
  let foreignPath: string | undefined;
  if (fd) {
    const rel = kid(fd, "Rel");
    const rid = rel && relId(rel);
    if (rid) foreignPath = resolveRel(rid);
  }
  return {
    id: attr(el, "ID") || "",
    name: attr(el, "NameU") || attr(el, "Name") || "",
    type: attr(el, "Type") || "Shape",
    master: attr(el, "Master"),
    masterShape: attr(el, "MasterShape"),
    lineStyle: attr(el, "LineStyle"),
    fillStyle: attr(el, "FillStyle"),
    textStyle: attr(el, "TextStyle"),
    del: attr(el, "Del") === "1",
    cells: readCells(el),
    sections: readSections(el),
    text: textEl ? readText(textEl) : undefined,
    children: shapesEl
      ? kids(shapesEl, "Shape").map((c) => readShape(c, resolveRel))
      : [],
    foreignPath,
  };
}

// ----------------------------------------------------------- inheritance

function sectionKey(s: RawSection): string {
  return `${s.n}|${s.ix ?? ""}`;
}
function mergeRows(base: RawRow[], local: RawRow[]): RawRow[] {
  const out = base.map((r) => ({ ...r, cells: new Map(r.cells) }));
  local.forEach((r, i) => {
    const key = r.ix ?? String(i);
    const idx = out.findIndex((b, j) => (b.ix ?? String(j)) === key);
    if (r.del) {
      if (idx >= 0) out.splice(idx, 1);
      return;
    }
    if (idx >= 0) {
      const b = out[idx];
      out[idx] = {
        t: r.t || b.t,
        ix: r.ix ?? b.ix,
        del: false,
        cells: new Map([...b.cells, ...r.cells]),
      };
    } else out.push({ ...r, cells: new Map(r.cells) });
  });
  return out;
}
function mergeSections(base: RawSection[], local: RawSection[]): RawSection[] {
  const out = base.map((s) => ({ ...s }));
  for (const s of local) {
    const idx = out.findIndex((b) => sectionKey(b) === sectionKey(s));
    if (s.del) {
      if (idx >= 0) out.splice(idx, 1);
      continue;
    }
    if (idx >= 0) {
      const b = out[idx];
      out[idx] = {
        n: s.n,
        ix: s.ix,
        del: false,
        cells: new Map([...b.cells, ...s.cells]),
        rows: mergeRows(b.rows, s.rows),
      };
    } else out.push(s);
  }
  return out;
}
function findShape(list: RawShape[], id: string): RawShape | undefined {
  for (const s of list) {
    if (s.id === id) return s;
    const f = findShape(s.children, id);
    if (f) return f;
  }
  return undefined;
}

/** resolveShape applies master inheritance (recursively for group children). */
function resolveShape(
  local: RawShape,
  masters: Map<string, MasterDef>,
  inheritedMaster: RawShape[] | undefined,
  depth = 0,
): RawShape {
  let base: RawShape | undefined;
  let masterTree = inheritedMaster;
  if (local.master && masters.has(local.master) && depth < 8) {
    const m = masters.get(local.master)!;
    masterTree = m.shapes;
    base = local.masterShape
      ? findShape(m.shapes, local.masterShape)
      : m.shapes.length === 1
        ? m.shapes[0]
        : undefined;
    if (!base && m.shapes.length > 1)
      // A multi-shape master behaves like a group of its shapes.
      base = {
        id: "",
        name: "",
        type: "Group",
        cells: new Map(),
        sections: [],
        children: m.shapes,
      };
  } else if (local.masterShape && inheritedMaster) {
    base = findShape(inheritedMaster, local.masterShape);
  }
  if (!base) {
    return {
      ...local,
      children: local.children
        .filter((c) => !c.del)
        .map((c) => resolveShape(c, masters, masterTree, depth + 1)),
    };
  }
  const childTree = masterTree;
  const children = local.children.length
    ? local.children
        .filter((c) => !c.del)
        .map((c) => resolveShape(c, masters, childTree, depth + 1))
    : base.children.map((c) => resolveShape(c, masters, undefined, depth + 1));
  return {
    id: local.id,
    name: local.name || base.name,
    type: local.type !== "Shape" ? local.type : base.type,
    lineStyle: local.lineStyle ?? base.lineStyle,
    fillStyle: local.fillStyle ?? base.fillStyle,
    textStyle: local.textStyle ?? base.textStyle,
    cells: new Map([...base.cells, ...local.cells]),
    sections: mergeSections(base.sections, local.sections),
    text: local.text !== undefined ? local.text : base.text,
    children,
    foreignPath: local.foreignPath ?? base.foreignPath,
  };
}

// ------------------------------------------------------------ cell access

class ShapeView {
  constructor(
    readonly s: RawShape,
    private styles: Map<string, StyleSheet>,
  ) {}

  private styleChain(kind: "line" | "fill" | "text"): StyleSheet[] {
    const out: StyleSheet[] = [];
    let id =
      kind === "line"
        ? this.s.lineStyle
        : kind === "fill"
          ? this.s.fillStyle
          : this.s.textStyle;
    const seen = new Set<string>();
    while (id !== undefined && !seen.has(id) && out.length < 16) {
      seen.add(id);
      const st = this.styles.get(id);
      if (!st) break;
      out.push(st);
      id =
        kind === "line"
          ? st.lineStyle
          : kind === "fill"
            ? st.fillStyle
            : st.textStyle;
    }
    return out;
  }
  private kindOf(name: string): "line" | "fill" | "text" {
    if (/^(Line|BeginArrow|EndArrow|Rounding)/.test(name)) return "line";
    if (/^(Fill|Shdw)/.test(name)) return "fill";
    return "text";
  }
  raw(name: string): string | undefined {
    const v = this.s.cells.get(name);
    if (v !== undefined) return v;
    for (const st of this.styleChain(this.kindOf(name))) {
      const sv = st.cells.get(name);
      if (sv !== undefined) return sv;
    }
    return undefined;
  }
  num(name: string, def: number): number {
    const v = this.raw(name);
    const n = v === undefined ? NaN : parseFloat(v);
    return Number.isFinite(n) ? n : def;
  }
  has(name: string): boolean {
    return this.s.cells.has(name);
  }
  /** First row cell of a section (e.g. Character/Paragraph row 0). */
  rowCell(section: string, name: string): string | undefined {
    const sec = this.s.sections.find((x) => x.n === section);
    const v = sec?.rows[0]?.cells.get(name);
    if (v !== undefined) return v;
    for (const st of this.styleChain("text")) {
      const ss = st.sections.find((x) => x.n === section);
      const sv = ss?.rows[0]?.cells.get(name);
      if (sv !== undefined) return sv;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------- colors

const VISIO_PALETTE = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
  "#800000",
  "#008000",
  "#000080",
  "#808000",
  "#800080",
  "#008080",
  "#c0c0c0",
  "#e6e6e6",
  "#cdcdcd",
  "#b3b3b3",
  "#9a9a9a",
  "#808080",
  "#666666",
  "#4d4d4d",
  "#333333",
  "#1a1a1a",
];

export function visioColor(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s))
    return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  const rgb = /^RGB\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s);
  if (rgb)
    return (
      "#" +
      [rgb[1], rgb[2], rgb[3]]
        .map((x) => Math.min(255, +x).toString(16).padStart(2, "0"))
        .join("")
    );
  if (/^\d+$/.test(s)) return VISIO_PALETTE[+s];
  return undefined;
}

// ----------------------------------------------------------------- theme

interface Theme {
  scheme: Map<string, string>;
  /** First variation colour scheme (varColor1..7). */
  variation: string[];
}
const EMPTY_THEME: Theme = { scheme: new Map(), variation: [] };

function colorOf(el: Element | undefined): string | undefined {
  if (!el) return undefined;
  for (const c of kids(el)) {
    if (c.localName === "srgbClr")
      return `#${(attr(c, "val") ?? "").toLowerCase()}`;
    if (c.localName === "sysClr") {
      const v = attr(c, "lastClr");
      if (v) return `#${v.toLowerCase()}`;
    }
  }
  return undefined;
}

function readTheme(doc: Document): Theme {
  const scheme = new Map<string, string>();
  const all = Array.from(doc.getElementsByTagName("*"));
  const cs = all.find((e) => e.localName === "clrScheme");
  if (cs)
    for (const c of kids(cs)) {
      const col = colorOf(c);
      if (col) scheme.set(c.localName, col);
    }
  const vs = all.find((e) => e.localName === "variationClrScheme");
  const variation = vs
    ? kids(vs)
        .map((c) => colorOf(c))
        .filter((c): c is string => !!c)
    : [];
  return { scheme, variation };
}

/** quickColor maps a QuickStyle*Color index to a theme colour:
 *  0 dk1, 1 lt1, 2–7 accent1–6, 100–106 variation colours 1–7. */
function quickColor(theme: Theme, v: string | undefined): string | undefined {
  if (v === undefined || !theme.scheme.size) return undefined;
  const n = parseInt(v, 10);
  if (n === 0) return theme.scheme.get("dk1");
  if (n === 1) return theme.scheme.get("lt1");
  if (n >= 2 && n <= 7) return theme.scheme.get(`accent${n - 1}`);
  if (n >= 100 && n <= 106)
    return (
      theme.variation[n - 100] ??
      theme.scheme.get(`accent${Math.min(6, n - 99)}`)
    );
  return undefined;
}

// -------------------------------------------------------------- geometry

/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
/** Local→parent transform: T(pin)·R(angle)·S(flip)·T(-locPin). */
function localMatrix(v: ShapeView, w: number, h: number): Mat {
  const pinX = v.num("PinX", w / 2);
  const pinY = v.num("PinY", h / 2);
  const lx = v.num("LocPinX", w / 2);
  const ly = v.num("LocPinY", h / 2);
  const ang = v.num("Angle", 0);
  const fx = v.num("FlipX", 0) ? -1 : 1;
  const fy = v.num("FlipY", 0) ? -1 : 1;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  let m: Mat = [1, 0, 0, 1, pinX, pinY];
  m = mul(m, [cos, sin, -sin, cos, 0, 0]);
  m = mul(m, [fx, 0, 0, fy, 0, 0]);
  m = mul(m, [1, 0, 0, 1, -lx, -ly]);
  return m;
}

interface SubPath {
  pts: Pt[];
  closed: boolean;
  noFill: boolean;
  noLine: boolean;
  /** Set when the section is a single Ellipse row. */
  ellipse?: { c: Pt; a: Pt; b: Pt };
}

const ARC_SEGMENTS = 16;

/** Sample the circular arc through p0 → mid → p1. */
function arc3(p0: Pt, mid: Pt, p1: Pt): Pt[] {
  const [ax, ay] = p0;
  const [bx, by] = mid;
  const [cx, cy] = p1;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return [p1];
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const t0 = Math.atan2(ay - uy, ax - ux);
  const tm = Math.atan2(by - uy, bx - ux);
  const t1 = Math.atan2(cy - uy, cx - ux);
  const norm = (t: number) =>
    ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Counter-clockwise sweep from t0 to t1; flip if mid isn't on it.
  let sweep = norm(t1 - t0);
  if (norm(tm - t0) > sweep) sweep = sweep - 2 * Math.PI;
  const n = Math.max(4, Math.ceil((ARC_SEGMENTS * Math.abs(sweep)) / Math.PI));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t0 + (sweep * i) / n;
    out.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]);
  }
  out[out.length - 1] = p1;
  return out;
}

/** EllipticalArcTo: arc from p0 to p1 through ctrl on an ellipse whose major
 *  axis is at angle c with major/minor ratio d. */
function ellipticalArc(p0: Pt, ctrl: Pt, p1: Pt, c: number, d: number): Pt[] {
  const ratio = d > 1e-9 ? d : 1;
  const cos = Math.cos(-c);
  const sin = Math.sin(-c);
  const to = (p: Pt): Pt => [
    (p[0] * cos - p[1] * sin) / ratio,
    p[0] * sin + p[1] * cos,
  ];
  const cb = Math.cos(c);
  const sb = Math.sin(c);
  const back = (p: Pt): Pt => {
    const x = p[0] * ratio;
    return [x * cb - p[1] * sb, x * sb + p[1] * cb];
  };
  return arc3(to(p0), to(ctrl), to(p1)).map(back);
}

function bezier(p: Pt[], n = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    let pts = p;
    while (pts.length > 1) {
      const next: Pt[] = [];
      for (let k = 0; k < pts.length - 1; k++)
        next.push([
          pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t,
          pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t,
        ]);
      pts = next;
    }
    out.push(pts[0]);
  }
  return out;
}

/** Parse the numeric args of POLYLINE(...)/NURBS(...) formulas. */
function formulaArgs(f: string | undefined, fn: string): number[] | undefined {
  if (!f) return undefined;
  const m = new RegExp(`${fn}\\s*\\(([^)]*)\\)`, "i").exec(f);
  if (!m) return undefined;
  return m[1].split(",").map((x) => parseFloat(x));
}

function buildPaths(v: ShapeView, w: number, h: number): SubPath[] {
  const secs = v.s.sections
    .filter((s) => s.n === "Geometry")
    .sort((a, b) => +(a.ix ?? 0) - +(b.ix ?? 0));
  const out: SubPath[] = [];
  for (const sec of secs) {
    if (sec.cells.get("NoShow") === "1") continue;
    const noFill = sec.cells.get("NoFill") === "1";
    const noLine = sec.cells.get("NoLine") === "1";
    const rows = sec.rows
      .filter((r) => !r.del)
      .sort((a, b) => +(a.ix ?? 0) - +(b.ix ?? 0));
    let cur: Pt = [0, 0];
    let path: Pt[] | null = null;
    const flush = () => {
      if (path && path.length > 1) {
        const a = path[0];
        const b = path[path.length - 1];
        const closed =
          Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
        out.push({ pts: path, closed, noFill, noLine });
      }
      path = null;
    };
    const n = (r: RawRow, k: string, d = 0) => {
      const x = parseFloat(r.cells.get(k) ?? "");
      return Number.isFinite(x) ? x : d;
    };
    const lineTo = (p: Pt[]) => {
      if (!path) path = [cur];
      path.push(...p);
      cur = p[p.length - 1];
    };
    for (const r of rows) {
      switch (r.t) {
        case "MoveTo":
        case "RelMoveTo": {
          flush();
          const rel = r.t === "RelMoveTo";
          cur = [n(r, "X") * (rel ? w : 1), n(r, "Y") * (rel ? h : 1)];
          path = [cur];
          break;
        }
        case "LineTo":
        case "RelLineTo": {
          const rel = r.t === "RelLineTo";
          lineTo([[n(r, "X") * (rel ? w : 1), n(r, "Y") * (rel ? h : 1)]]);
          break;
        }
        case "ArcTo": {
          const p1: Pt = [n(r, "X"), n(r, "Y")];
          const a = n(r, "A");
          const dx = p1[0] - cur[0];
          const dy = p1[1] - cur[1];
          const len = Math.hypot(dx, dy);
          if (Math.abs(a) < 1e-9 || len < 1e-9) lineTo([p1]);
          else {
            // Bow A is measured perpendicular clockwise from the chord.
            const mid: Pt = [
              cur[0] + dx / 2 + (a * dy) / len,
              cur[1] + dy / 2 - (a * dx) / len,
            ];
            lineTo(arc3(cur, mid, p1));
          }
          break;
        }
        case "EllipticalArcTo":
        case "RelEllipticalArcTo": {
          const rel = r.t === "RelEllipticalArcTo";
          const sx = rel ? w : 1;
          const sy = rel ? h : 1;
          const p1: Pt = [n(r, "X") * sx, n(r, "Y") * sy];
          const ctrl: Pt = [n(r, "A") * sx, n(r, "B") * sy];
          lineTo(ellipticalArc(cur, ctrl, p1, n(r, "C"), n(r, "D", 1)));
          break;
        }
        case "RelCubBezTo":
          lineTo(
            bezier([
              cur,
              [n(r, "A") * w, n(r, "B") * h],
              [n(r, "C") * w, n(r, "D") * h],
              [n(r, "X") * w, n(r, "Y") * h],
            ]),
          );
          break;
        case "RelQuadBezTo":
          lineTo(
            bezier([
              cur,
              [n(r, "A") * w, n(r, "B") * h],
              [n(r, "X") * w, n(r, "Y") * h],
            ]),
          );
          break;
        case "Ellipse": {
          flush();
          const c: Pt = [n(r, "X"), n(r, "Y")];
          const a: Pt = [n(r, "A"), n(r, "B")];
          const b: Pt = [n(r, "C"), n(r, "D")];
          const pts: Pt[] = [];
          for (let i = 0; i <= 48; i++) {
            const t = (i / 48) * 2 * Math.PI;
            pts.push([
              c[0] + Math.cos(t) * (a[0] - c[0]) + Math.sin(t) * (b[0] - c[0]),
              c[1] + Math.cos(t) * (a[1] - c[1]) + Math.sin(t) * (b[1] - c[1]),
            ]);
          }
          pts[48] = pts[0];
          out.push({
            pts,
            closed: true,
            noFill,
            noLine,
            ellipse: rows.length === 1 ? { c, a, b } : undefined,
          });
          break;
        }
        case "PolylineTo":
        case "NURBSTo": {
          const end: Pt = [n(r, "X"), n(r, "Y")];
          const isPoly = r.t === "PolylineTo";
          const args = formulaArgs(
            r.cells.get(isPoly ? "A" : "E"),
            isPoly ? "POLYLINE" : "NURBS",
          );
          const mid: Pt[] = [];
          if (args) {
            // POLYLINE(xType, yType, x1, y1, …); NURBS(knotLast, degree,
            // xType, yType, x1, y1, knot1, weight1, …). Type 0 = relative.
            const off = isPoly ? 2 : 4;
            const step = isPoly ? 2 : 4;
            const xt = args[off - 2];
            const yt = args[off - 1];
            for (let i = off; i + 1 < args.length; i += step)
              mid.push([
                args[i] * (xt === 0 ? w : 1),
                args[i + 1] * (yt === 0 ? h : 1),
              ]);
          }
          // NURBS control points approximated as a smoothed polyline.
          lineTo(
            isPoly || mid.length < 1
              ? [...mid, end]
              : bezier([cur, ...mid, end], 24),
          );
          break;
        }
        case "SplineStart":
        case "SplineKnot":
          lineTo([[n(r, "X"), n(r, "Y")]]);
          break;
        default:
          break; // InfiniteLine and unknown rows are ignored
      }
    }
    flush();
  }
  return out;
}

// ------------------------------------------------------------- emission

interface EmitCtx {
  pageH: number;
  out: VsdxSkeleton[];
  files: Record<string, VsdxFile>;
  media: Map<string, VsdxFile>;
  styles: Map<string, StyleSheet>;
  theme: Theme;
  /** Visio shape id → emitted bindable element id (rect/ellipse/diamond). */
  bindable: Map<string, string>;
  /** Visio shape id → the Excalidraw arrow skeleton for 1-D shapes. */
  connectors: Map<string, VsdxSkeleton>;
  /** Visio shape id → its parent shape id (for glue to group children). */
  parent: Map<string, string>;
  /** 1-D shapes referenced as FromSheet by <Connects>. */
  glued: Set<string>;
  prefix: string;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** classify recognises simple primitives in local (inch) coordinates. */
function classify(
  p: SubPath,
  w: number,
  h: number,
): "rectangle" | "ellipse" | "diamond" | undefined {
  const tol = Math.max(w, h) * 0.01 + 1e-6;
  if (p.ellipse) {
    const { c, a, b } = p.ellipse;
    const ra = [a[0] - c[0], a[1] - c[1]];
    const rb = [b[0] - c[0], b[1] - c[1]];
    const axisAligned =
      (near(ra[1], 0, tol) && near(rb[0], 0, tol)) ||
      (near(ra[0], 0, tol) && near(rb[1], 0, tol));
    const rx = Math.max(Math.abs(ra[0]), Math.abs(rb[0]));
    const ry = Math.max(Math.abs(ra[1]), Math.abs(rb[1]));
    if (
      axisAligned &&
      near(c[0], w / 2, tol) &&
      near(c[1], h / 2, tol) &&
      near(rx, w / 2, tol) &&
      near(ry, h / 2, tol)
    )
      return "ellipse";
    return undefined;
  }
  if (!p.closed || p.pts.length !== 5) return undefined;
  const pts = p.pts.slice(0, 4);
  const onCorner = (q: Pt) =>
    (near(q[0], 0, tol) || near(q[0], w, tol)) &&
    (near(q[1], 0, tol) || near(q[1], h, tol));
  const corners = new Set(
    pts.map(
      (q) => `${near(q[0], 0, tol) ? 0 : 1}${near(q[1], 0, tol) ? 0 : 1}`,
    ),
  );
  if (pts.every(onCorner) && corners.size === 4) return "rectangle";
  const mids: Pt[] = [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ];
  if (
    pts.every((q) =>
      mids.some((m) => near(q[0], m[0], tol) && near(q[1], m[1], tol)),
    ) &&
    new Set(
      pts.map((q) => `${Math.round(q[0] / tol)},${Math.round(q[1] / tol)}`),
    ).size === 4
  )
    return "diamond";
  return undefined;
}

function toPx(ctx: EmitCtx, p: Pt): Pt {
  return [p[0] * PX_PER_INCH, (ctx.pageH - p[1]) * PX_PER_INCH];
}

function strokeStyleOf(pattern: number): "solid" | "dashed" | "dotted" {
  if (pattern === 3 || pattern === 10 || pattern === 16) return "dotted";
  return pattern > 1 ? "dashed" : "solid";
}

interface TextStyleOut {
  fontSize: number;
  strokeColor: string;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  fontFamily: number;
}
function textStyle(v: ShapeView): TextStyleOut {
  const size = parseFloat(v.rowCell("Character", "Size") ?? "");
  const align = parseFloat(v.rowCell("Paragraph", "HorzAlign") ?? "1");
  const valign = v.num("VerticalAlign", 1);
  return {
    fontSize:
      Number.isFinite(size) && size > 0
        ? Math.max(6, Math.round(size * PX_PER_INCH * 10) / 10)
        : 16,
    strokeColor: visioColor(v.rowCell("Character", "Color")) ?? "#000000",
    textAlign: align === 0 ? "left" : align === 2 ? "right" : "center",
    verticalAlign: valign === 0 ? "top" : valign === 2 ? "bottom" : "middle",
    fontFamily: 2,
  };
}

function bboxOf(pts: Pt[]): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function linear(
  type: "line" | "arrow",
  id: string,
  pts: Pt[],
  extra: Record<string, unknown>,
): VsdxSkeleton {
  const [x0, y0, x1, y1] = bboxOf(pts);
  return {
    type,
    id,
    x: pts[0][0],
    y: pts[0][1],
    width: x1 - x0,
    height: y1 - y0,
    points: pts.map(([x, y]) => [x - pts[0][0], y - pts[0][1]]),
    roundness: null,
    roughness: 0,
    ...extra,
  };
}

function emitShape(
  raw: RawShape,
  parentM: Mat,
  ctx: EmitCtx,
  groupIds: string[],
  parentId?: string,
): void {
  const v = new ShapeView(raw, ctx.styles);
  if (parentId) ctx.parent.set(raw.id, parentId);
  const w = v.num("Width", 0);
  const h = v.num("Height", 0);
  const oneD = v.raw("BeginX") !== undefined && v.raw("EndX") !== undefined;
  const m = oneD ? parentM : mul(parentM, localMatrix(v, w, h));
  const id = `${ctx.prefix}s${raw.id}`;

  // Styling.
  const linePattern = v.num("LinePattern", 1);
  // Colour precedence: own/master cell → theme quick style → style sheet.
  const lineColor =
    visioColor(v.s.cells.get("LineColor")) ??
    quickColor(ctx.theme, v.s.cells.get("QuickStyleLineColor")) ??
    visioColor(v.raw("LineColor")) ??
    "#000000";
  const weightPx = v.num("LineWeight", 0.01) * PX_PER_INCH;
  const fillPattern = v.num("FillPattern", 1);
  const fillColor =
    visioColor(v.s.cells.get("FillForegnd")) ??
    quickColor(ctx.theme, v.s.cells.get("QuickStyleFillColor")) ??
    visioColor(v.raw("FillForegnd")) ??
    "#ffffff";
  const stroke = {
    strokeColor: linePattern === 0 ? "transparent" : lineColor,
    strokeWidth: Math.max(0.5, Math.round(weightPx * 2) / 2),
    strokeStyle: strokeStyleOf(linePattern),
    roughness: 0,
    groupIds,
  };
  const text = raw.text && raw.text.trim() ? raw.text : "";
  const ts = text ? textStyle(v) : undefined;

  if (oneD) {
    // 1-D shape: geometry is in its own local frame; fall back to Begin→End.
    const lm = localMatrix(v, w, h);
    const world = mul(parentM, lm);
    const paths = buildPaths(v, w, h).filter((p) => !p.noLine);
    let pts: Pt[];
    if (paths.length) pts = paths[0].pts.map((p) => toPx(ctx, apply(world, p)));
    else
      pts = [
        [v.num("BeginX", 0), v.num("BeginY", 0)],
        [v.num("EndX", 0), v.num("EndY", 0)],
      ].map((p) => toPx(ctx, apply(parentM, p as Pt)));
    const begin = v.num("BeginArrow", 0) > 0;
    const end = v.num("EndArrow", 0) > 0;
    const asArrow = begin || end || ctx.glued.has(raw.id);
    const el = linear(asArrow ? "arrow" : "line", id, pts, {
      ...stroke,
      ...(asArrow
        ? {
            startArrowhead: begin ? "arrow" : null,
            endArrowhead: end ? "arrow" : null,
            elbowed: false,
          }
        : {}),
      ...(ts && asArrow
        ? { label: { text, ...ts, verticalAlign: "middle" } }
        : {}),
    });
    ctx.out.push(el);
    if (asArrow) ctx.connectors.set(raw.id, el);
    if (ts && !asArrow) {
      const mid = pts[Math.floor(pts.length / 2)];
      ctx.out.push(freeText(`${id}t`, text, ts, mid, groupIds));
    }
    return;
  }

  // Image (foreign bitmap).
  if (raw.foreignPath && ctx.media.has(raw.foreignPath)) {
    const f = ctx.media.get(raw.foreignPath)!;
    ctx.files[f.id] = f;
    const c = toPx(ctx, apply(m, [w / 2, h / 2]));
    const wpx = w * PX_PER_INCH;
    const hpx = h * PX_PER_INCH;
    ctx.out.push({
      type: "image",
      id,
      x: c[0] - wpx / 2,
      y: c[1] - hpx / 2,
      width: wpx,
      height: hpx,
      angle: angleOf(m),
      fileId: f.id,
      status: "saved",
      groupIds,
    });
  }

  const paths = buildPaths(v, w, h);
  const visible = paths.filter((p) => !(p.noLine && (p.noFill || !p.closed)));
  let labelled = false;
  if (visible.length === 1 && w > 0 && h > 0) {
    const kind = classify(visible[0], w, h);
    if (kind) {
      const c = toPx(ctx, apply(m, [w / 2, h / 2]));
      const wpx = w * PX_PER_INCH;
      const hpx = h * PX_PER_INCH;
      const filled = fillPattern !== 0 && !visible[0].noFill;
      ctx.out.push({
        type: kind,
        id,
        x: c[0] - wpx / 2,
        y: c[1] - hpx / 2,
        width: wpx,
        height: hpx,
        angle: angleOf(m),
        ...stroke,
        strokeColor: visible[0].noLine ? "transparent" : stroke.strokeColor,
        backgroundColor: filled ? fillColor : "transparent",
        fillStyle: "solid",
        roundness:
          kind === "rectangle" && v.num("Rounding", 0) > 0
            ? { type: 3 }
            : kind === "diamond"
              ? { type: 2 }
              : null,
        ...(ts ? { label: { text, ...ts } } : {}),
      });
      ctx.bindable.set(raw.id, id);
      labelled = true;
    }
  }
  if (!labelled) {
    visible.forEach((p, i) => {
      const pts = p.pts.map((q) => toPx(ctx, apply(m, q)));
      const filled = p.closed && fillPattern !== 0 && !p.noFill;
      ctx.out.push(
        linear("line", i === 0 ? id : `${id}g${i}`, pts, {
          ...stroke,
          strokeColor: p.noLine ? "transparent" : stroke.strokeColor,
          backgroundColor: filled ? fillColor : "transparent",
          fillStyle: "solid",
        }),
      );
    });
  }

  // Group children, in the group's local frame.
  if (raw.children.length) {
    const gid = `${ctx.prefix}grp${raw.id}`;
    for (const c of raw.children)
      emitShape(c, m, ctx, [gid, ...groupIds], raw.id);
  }

  // Free text for shapes that aren't a labelled container.
  if (text && !labelled && ts) {
    let cx = w / 2;
    let cy = h / 2;
    if (v.has("TxtPinX") || v.has("TxtPinY")) {
      const tw = v.num("TxtWidth", w);
      const th = v.num("TxtHeight", h);
      cx = v.num("TxtPinX", w / 2) - v.num("TxtLocPinX", tw / 2) + tw / 2;
      cy = v.num("TxtPinY", h / 2) - v.num("TxtLocPinY", th / 2) + th / 2;
    }
    const c = toPx(ctx, apply(m, [cx, cy]));
    ctx.out.push(freeText(`${id}t`, text, ts, c, groupIds));
  }
}

/** freeText anchors a text element on c. Excalidraw's converter treats x/y
 *  as the anchor for the element's textAlign/verticalAlign ("center" x and
 *  "middle" y are the midpoint), so only left/right alignment needs a width
 *  estimate. */
function freeText(
  id: string,
  text: string,
  ts: TextStyleOut,
  c: Pt,
  groupIds: string[],
): VsdxSkeleton {
  const lines = text.split("\n");
  const halfW =
    (Math.max(...lines.map((l) => l.length)) * ts.fontSize * 0.55) / 2;
  const x =
    ts.textAlign === "left"
      ? c[0] - halfW
      : ts.textAlign === "right"
        ? c[0] + halfW
        : c[0];
  return {
    type: "text",
    id,
    x,
    y: c[1],
    text,
    fontSize: ts.fontSize,
    fontFamily: ts.fontFamily,
    strokeColor: ts.strokeColor,
    textAlign: ts.textAlign,
    verticalAlign: "middle",
    roughness: 0,
    groupIds,
  };
}

/** Excalidraw angle (clockwise, radians, [0, 2π)) from a Y-up matrix. */
function angleOf(m: Mat): number {
  const a = -Math.atan2(m[1], m[0]);
  const t = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.abs(t) < 1e-9 || Math.abs(t - 2 * Math.PI) < 1e-9 ? 0 : t;
}

// ----------------------------------------------------------------- package

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}
function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = (dirOf(base) + rel).split("/");
  const out: string[] = [];
  for (const s of parts) {
    if (s === "..") out.pop();
    else if (s !== "." && s !== "") out.push(s);
  }
  return out.join("/");
}
function relsPath(part: string): string {
  return `${dirOf(part)}_rels/${part.slice(dirOf(part).length)}.rels`;
}

interface Rel {
  id: string;
  type: string;
  target: string;
}

async function readRels(zip: JSZip, part: string): Promise<Rel[]> {
  const f = zip.file(relsPath(part));
  if (!f) return [];
  const doc = parseXml(await f.async("string"));
  return Array.from(doc.getElementsByTagName("*"))
    .filter((e) => e.localName === "Relationship")
    .map((e) => ({
      id: attr(e, "Id") || "",
      type: attr(e, "Type") || "",
      target: joinPath(part, attr(e, "Target") || ""),
    }));
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

let fileSeq = 0;

/** parseVsdx reads a .vsdx package into per-page element skeletons. */
export async function parseVsdx(
  data: ArrayBuffer | Uint8Array | Blob,
): Promise<VsdxDocument> {
  const zip = await JSZip.loadAsync(data);
  const warnings: string[] = [];

  const rootRels = await readRels(zip, "");
  const docPart =
    rootRels.find((r) => /\/document$/.test(r.type))?.target ??
    "visio/document.xml";
  if (!zip.file(docPart)) throw new Error("vsdx: missing visio/document.xml");
  const docRels = await readRels(zip, docPart);
  const pagesPart =
    docRels.find((r) => /\/pages$/.test(r.type))?.target ??
    "visio/pages/pages.xml";
  const mastersPart =
    docRels.find((r) => /\/masters$/.test(r.type))?.target ??
    "visio/masters/masters.xml";

  // Style sheets (document.xml).
  const styles = new Map<string, StyleSheet>();
  const docXml = parseXml(await zip.file(docPart)!.async("string"));
  for (const st of Array.from(docXml.getElementsByTagName("*")).filter(
    (e) => e.localName === "StyleSheet",
  )) {
    styles.set(attr(st, "ID") || "", {
      lineStyle: attr(st, "LineStyle"),
      fillStyle: attr(st, "FillStyle"),
      textStyle: attr(st, "TextStyle"),
      cells: readCells(st),
      sections: readSections(st),
    });
  }

  // Media referenced by foreign shapes, loaded lazily per path.
  const media = new Map<string, VsdxFile>();
  const wantMedia = new Set<string>();

  const loadShapes = async (part: string): Promise<RawShape[]> => {
    const f = zip.file(part);
    if (!f) return [];
    const rels = await readRels(zip, part);
    const resolve = (rid: string) => {
      const t = rels.find((r) => r.id === rid)?.target;
      if (t) wantMedia.add(t);
      return t;
    };
    const shapes = kid(
      parseXml(await f.async("string")).documentElement,
      "Shapes",
    );
    return shapes
      ? kids(shapes, "Shape").map((s) => readShape(s, resolve))
      : [];
  };

  // Theme colours (for "Themed" cells resolved through QuickStyle*Color).
  const themePart = docRels.find((r) => /\/theme$/.test(r.type))?.target;
  const tf = themePart ? zip.file(themePart) : null;
  const theme = tf
    ? readTheme(parseXml(await tf.async("string")))
    : EMPTY_THEME;

  // Masters.
  const masters = new Map<string, MasterDef>();
  const mf = zip.file(mastersPart);
  if (mf) {
    const mrels = await readRels(zip, mastersPart);
    const mdoc = parseXml(await mf.async("string"));
    for (const me of kids(mdoc.documentElement, "Master")) {
      const rel = kid(me, "Rel");
      const rid = rel && relId(rel);
      const target = mrels.find((r) => r.id === rid)?.target;
      if (!target) continue;
      masters.set(attr(me, "ID") || "", { shapes: await loadShapes(target) });
    }
  }

  // Pages.
  const pf = zip.file(pagesPart);
  if (!pf) throw new Error("vsdx: missing pages part");
  const prels = await readRels(zip, pagesPart);
  const pdoc = parseXml(await pf.async("string"));
  const allPages = kids(pdoc.documentElement, "Page");
  // Background pages are skipped unless there is nothing else to show.
  const fg = allPages.filter((pe) => attr(pe, "Background") !== "1");
  const pageDefs = fg.length ? fg : allPages;

  const pending: {
    name: string;
    w: number;
    h: number;
    shapes: RawShape[];
    connects: Element[];
    prefix: string;
  }[] = [];
  const pageRels = prels.filter((r) => /\/page$/.test(r.type));
  const used = new Set<string>();
  let pageNo = 0;
  for (const pe of pageDefs) {
    const rel = kid(pe, "Rel");
    const rid = rel && relId(rel);
    // A broken r:id falls back to the next unused page relationship.
    const target =
      prels.find((r) => r.id === rid)?.target ??
      pageRels.find((r) => !used.has(r.target))?.target;
    if (target) used.add(target);
    if (!target || !zip.file(target)) {
      warnings.push(`page ${attr(pe, "NameU") ?? pageNo}: missing part`);
      continue;
    }
    const sheet = kid(pe, "PageSheet");
    const cells = sheet ? readCells(sheet) : new Map<string, string>();
    const w = parseFloat(cells.get("PageWidth") ?? "8.5") || 8.5;
    const h = parseFloat(cells.get("PageHeight") ?? "11") || 11;
    const shapes = await loadShapes(target);
    const pageDoc = parseXml(await zip.file(target)!.async("string"));
    const connectsEl = kid(pageDoc.documentElement, "Connects");
    pending.push({
      name: attr(pe, "Name") || attr(pe, "NameU") || `Page-${pageNo + 1}`,
      w,
      h,
      shapes,
      connects: connectsEl ? kids(connectsEl, "Connect") : [],
      prefix: `vsdx${pageNo}-`,
    });
    pageNo++;
  }

  for (const path of wantMedia) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const mime = IMAGE_MIME[ext];
    const f = zip.file(path);
    if (!mime || !f) {
      if (!mime) warnings.push(`skipped unsupported media ${path}`);
      continue;
    }
    const b64 = await f.async("base64");
    media.set(path, {
      id: `vsdx-img-${Date.now().toString(36)}-${(fileSeq++).toString(36)}`,
      mimeType: mime,
      dataURL: `data:${mime};base64,${b64}`,
      created: Date.now(),
    });
  }

  const files: Record<string, VsdxFile> = {};
  const pages: VsdxPage[] = pending.map((p) => {
    const ctx: EmitCtx = {
      pageH: p.h,
      out: [],
      files,
      media,
      styles,
      theme,
      bindable: new Map(),
      connectors: new Map(),
      parent: new Map(),
      glued: new Set(
        p.connects
          .filter((c) => /^(BeginX|EndX)$/.test(attr(c, "FromCell") || ""))
          .map((c) => attr(c, "FromSheet") || ""),
      ),
      prefix: p.prefix,
    };
    for (const s of p.shapes) {
      if (s.del) continue;
      emitShape(resolveShape(s, masters, undefined), IDENTITY, ctx, []);
    }
    // Glue connectors to their shapes.
    for (const c of p.connects) {
      const from = attr(c, "FromSheet") || "";
      const cell = attr(c, "FromCell") || "";
      let to = attr(c, "ToSheet") || "";
      const arrow = ctx.connectors.get(from);
      if (!arrow || (cell !== "BeginX" && cell !== "EndX")) continue;
      let target = ctx.bindable.get(to);
      for (let i = 0; !target && i < 16 && ctx.parent.has(to); i++) {
        to = ctx.parent.get(to)!;
        target = ctx.bindable.get(to);
      }
      if (target) arrow[cell === "BeginX" ? "start" : "end"] = { id: target };
    }
    return {
      name: p.name,
      width: p.w * PX_PER_INCH,
      height: p.h * PX_PER_INCH,
      elements: ctx.out,
    };
  });

  return { pages, files, warnings };
}

// ------------------------------------------------------------------ layout

export interface LayoutOptions {
  /** Top-left of the first page (default 100,100). */
  origin?: { x: number; y: number };
  /** Wrap pages in named frames: "auto" = only when there are several. */
  frames?: "auto" | "always" | "never";
  /** Page indices to include (default all). */
  pages?: number[];
  /** Horizontal gap between pages. */
  gap?: number;
}

/** Approximate extent of a skeleton (for frame sizing). */
function extent(e: VsdxSkeleton): [number, number, number, number] {
  const w = typeof e.width === "number" ? e.width : 0;
  const h = typeof e.height === "number" ? e.height : 0;
  if (Array.isArray(e.points)) {
    const [x0, y0, x1, y1] = bboxOf(e.points as Pt[]);
    return [e.x + x0, e.y + y0, e.x + x1, e.y + y1];
  }
  return [e.x, e.y, e.x + w, e.y + h];
}

/** layoutVsdxPages places pages side by side and returns one skeleton list. */
export function layoutVsdxPages(
  doc: VsdxDocument,
  opts: LayoutOptions = {},
): VsdxSkeleton[] {
  const origin = opts.origin ?? { x: 100, y: 100 };
  const gap = opts.gap ?? 120;
  const idx = opts.pages ?? doc.pages.map((_, i) => i);
  const chosen = idx.map((i) => doc.pages[i]).filter(Boolean);
  const frames =
    opts.frames === "always" || (opts.frames !== "never" && chosen.length > 1);
  const out: VsdxSkeleton[] = [];
  let x = origin.x;
  chosen.forEach((p, i) => {
    const moved = p.elements.map((e) => ({
      ...e,
      x: e.x + x,
      y: e.y + origin.y,
    }));
    out.push(...moved);
    let right = x + p.width;
    if (frames) {
      let [x0, y0, x1, y1] = [x, origin.y, x + p.width, origin.y + p.height];
      for (const e of moved) {
        const [a, b, c, d] = extent(e);
        x0 = Math.min(x0, a - 10);
        y0 = Math.min(y0, b - 10);
        x1 = Math.max(x1, c + 10);
        y1 = Math.max(y1, d + 10);
      }
      right = x1;
      out.push({
        type: "frame",
        id: `vsdx-frame-${i}`,
        // Excalidraw treats 0 as "unset", so nudge exact zeros.
        x: x0 || 0.01,
        y: y0 || 0.01,
        width: x1 - x0,
        height: y1 - y0,
        name: p.name,
        children: moved.map((e) => e.id),
      });
    }
    x = right + gap;
  });
  return out;
}
