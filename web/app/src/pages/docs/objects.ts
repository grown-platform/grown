// Floating objects in documents (Docs M7): pictures, preset shapes, text
// boxes and charts. This module is pure: the attribute set every object node
// shares, the CSS each wrapping style renders as, crop / resize / rotate
// arithmetic, z-order ("arrange"), names, and small builders the DOCX reader
// and the scripting-style tests use. The nodes and their views live in
// objectNodes.ts.
//
// Model (additive, flat scalar attributes so they ride y-prosemirror):
//   * `wrap` is Word's wrapping style: inline (in the text line, wp:inline),
//     square / tight / through (a CSS float beside the text; tight and
//     through follow a picture's alpha outline with shape-outside), top and
//     bottom (its own line), behind / in front (absolutely positioned, no
//     effect on the text). Everything but inline is a wp:anchor in DOCX.
//   * Position (wp:positionH / wp:positionV): `hRel` / `vRel` is what it is
//     relative to (column, margin, page, character / paragraph, line,
//     margin, page, …) with either an alignment (`hAlign` / `vAlign`) or an
//     offset in px (`hOffset` / `vOffset`) or a percentage (`hPct` / `vPct`,
//     wp14:pctPosHOffset).
//   * Size: `width` / `height` in px (the existing image attributes), with
//     an optional relative size (`relW` % of `relWFrom`, wp14:sizeRelH).
//   * Picture: `crop{L,T,R,B}` as fractions of the source (a:srcRect),
//     `rotate` in degrees, `flipH` / `flipV`, `alt`, `name`, `z` (Word's
//     relativeHeight: larger is nearer the reader).

export type WrapType = "inline" | "square" | "tight" | "through" | "topBottom" | "behind" | "inFront";

export const WRAP_TYPES: { value: WrapType; label: string }[] = [
  { value: "inline", label: "In line with text" },
  { value: "square", label: "Square" },
  { value: "tight", label: "Tight" },
  { value: "through", label: "Through" },
  { value: "topBottom", label: "Top and bottom" },
  { value: "behind", label: "Behind text" },
  { value: "inFront", label: "In front of text" },
];

/** Horizontal "relative to" values (ST_RelFromH). */
export const H_RELS = ["column", "margin", "page", "character", "leftMargin", "rightMargin", "insideMargin", "outsideMargin"] as const;
/** Vertical "relative to" values (ST_RelFromV). */
export const V_RELS = ["paragraph", "line", "margin", "page", "topMargin", "bottomMargin", "insideMargin", "outsideMargin"] as const;
export const H_ALIGNS = ["left", "center", "right", "inside", "outside"] as const;
export const V_ALIGNS = ["top", "center", "bottom", "inside", "outside"] as const;

/** Node types that are floating objects. `image` is the pre-M7 block
 *  picture; the rest are inline (anchored in a paragraph, like Word). */
export const OBJECT_NODE_TYPES = ["image", "inlineImage", "shape", "textBox", "chart"] as const;
export type ObjectNodeType = (typeof OBJECT_NODE_TYPES)[number];

export function isObjectType(name: string | undefined | null): name is ObjectNodeType {
  return !!name && (OBJECT_NODE_TYPES as readonly string[]).includes(name);
}

/** The attributes every object node has, with their defaults. */
export const OBJECT_ATTR_DEFAULTS = {
  wrap: "inline" as WrapType,
  /** Which side text flows on for square/tight/through (w:wrapText). */
  wrapSide: "bothSides",
  /** Distance from the text (px) for floats; null = Word's 0.125in. */
  dist: null as number | null,
  hRel: "column",
  hAlign: null as string | null,
  hOffset: 0,
  hPct: null as number | null,
  vRel: "paragraph",
  vAlign: null as string | null,
  vOffset: 0,
  vPct: null as number | null,
  relW: null as number | null,
  relWFrom: null as string | null,
  relH: null as number | null,
  relHFrom: null as string | null,
  z: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  name: null as string | null,
  lockAspect: true,
  cropL: 0,
  cropT: 0,
  cropR: 0,
  cropB: 0,
};
export type ObjectAttrs = typeof OBJECT_ATTR_DEFAULTS & {
  width?: number | null;
  height?: number | null;
  src?: string | null;
  alt?: string | null;
  [k: string]: unknown;
};

/** Numeric attributes (parsed as numbers from HTML). */
const NUMERIC = new Set(["dist", "hOffset", "hPct", "vOffset", "vPct", "relW", "relH", "z", "rotate", "cropL", "cropT", "cropR", "cropB"]);
const BOOLEAN = new Set(["flipH", "flipV", "lockAspect"]);

/** HTML attribute name for an object attribute (data-o-*). */
export const htmlAttrName = (k: string) => `data-o-${k.toLowerCase()}`;

/** TipTap attribute specs for the shared object attributes: each is kept
 *  in HTML as data-o-<name> so copy/paste and snapshots keep it. */
export function objectAttributeSpecs(): Record<string, { default: unknown; parseHTML: (el: HTMLElement) => unknown; renderHTML: (a: Record<string, unknown>) => Record<string, string> }> {
  const out: Record<string, { default: unknown; parseHTML: (el: HTMLElement) => unknown; renderHTML: (a: Record<string, unknown>) => Record<string, string> }> = {};
  for (const [k, def] of Object.entries(OBJECT_ATTR_DEFAULTS)) {
    const h = htmlAttrName(k);
    out[k] = {
      default: def,
      parseHTML: (el) => {
        const v = el.getAttribute(h);
        if (v == null) return def;
        if (NUMERIC.has(k)) {
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : def;
        }
        if (BOOLEAN.has(k)) return v === "1" || v === "true";
        return v;
      },
      renderHTML: (a) => {
        const v = a[k];
        if (v == null || v === def) return {};
        return { [h]: typeof v === "boolean" ? (v ? "1" : "0") : String(v) };
      },
    };
  }
  return out;
}

// --- geometry ------------------------------------------------------------------------

export const PX_PER_INCH = 96;
/** Word's default distance between a floating object and the text. */
export const DEFAULT_DIST = 12; // 0.125in

export const isFloat = (w: string | undefined | null) => w === "square" || w === "tight" || w === "through";
export const isAbsolute = (w: string | undefined | null) => w === "behind" || w === "inFront";

/** The crop fractions, clamped so at least 1% of the source stays. */
export function cropOf(a: Partial<ObjectAttrs>): { l: number; t: number; r: number; b: number } {
  const c = (v: unknown) => Math.max(-0.99, Math.min(0.99, Number(v) || 0));
  let l = c(a.cropL);
  let r = c(a.cropR);
  let t = c(a.cropT);
  let b = c(a.cropB);
  if (l + r > 0.99) r = 0.99 - l;
  if (t + b > 0.99) b = 0.99 - t;
  return { l, t, r, b };
}

/** Where the whole (uncropped) picture sits inside a w × h cropped frame. */
export function cropImageBox(w: number, h: number, a: Partial<ObjectAttrs>): { left: number; top: number; width: number; height: number } {
  const { l, t, r, b } = cropOf(a);
  const width = w / (1 - l - r);
  const height = h / (1 - t - b);
  return { left: -l * width, top: -t * height, width, height };
}

/** Changing the crop keeps the picture's scale: the frame grows or shrinks
 *  by the change in the visible fraction. */
export function recrop(a: Partial<ObjectAttrs> & { width?: number | null; height?: number | null }, next: { l?: number; t?: number; r?: number; b?: number }): Partial<ObjectAttrs> {
  const cur = cropOf(a);
  const n = cropOf({ cropL: next.l ?? cur.l, cropT: next.t ?? cur.t, cropR: next.r ?? cur.r, cropB: next.b ?? cur.b });
  const w = Number(a.width) || 0;
  const h = Number(a.height) || 0;
  const out: Partial<ObjectAttrs> = { cropL: r4(n.l), cropT: r4(n.t), cropR: r4(n.r), cropB: r4(n.b) };
  if (w) out.width = Math.max(1, Math.round((w * (1 - n.l - n.r)) / (1 - cur.l - cur.r)));
  if (h) out.height = Math.max(1, Math.round((h * (1 - n.t - n.b)) / (1 - cur.t - cur.b)));
  return out;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * The size after dragging `handle` by (dx, dy) px from `start`. Corner
 * handles keep the aspect ratio when `lock` is set (pictures by default);
 * edge handles change one side. Never below `min` px.
 */
export function resizeBy(start: { w: number; h: number }, handle: Handle, dx: number, dy: number, lock: boolean, min = 8): { w: number; h: number } {
  const sx = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const sy = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  let w = start.w + sx * dx;
  let h = start.h + sy * dy;
  if (lock && sx && sy && start.w > 0 && start.h > 0) {
    const k = Math.max(w / start.w, h / start.h);
    w = start.w * k;
    h = start.h * k;
  }
  if (!sx) w = start.w;
  if (!sy) h = start.h;
  const ratio = start.h > 0 ? start.w / start.h : 1;
  if (w < min) {
    w = min;
    if (lock && sx && sy) h = min / ratio;
  }
  if (h < min) {
    h = min;
    if (lock && sx && sy) w = min * ratio;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Rotation (degrees, 0–359) of a drag from the centre, snapped to 15°
 *  steps with `snap`. */
export function angleFrom(cx: number, cy: number, x: number, y: number, snap = false): number {
  let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
  if (snap) a = Math.round(a / 15) * 15;
  return ((Math.round(a) % 360) + 360) % 360;
}

/** A picture's display size for its natural size: at most `maxW` wide. */
export function fitSize(natural: { width: number; height: number }, maxW: number): { width: number; height: number } {
  const w = Math.max(1, natural.width || 1);
  const h = Math.max(1, natural.height || 1);
  if (w <= maxW) return { width: Math.round(w), height: Math.round(h) };
  return { width: Math.round(maxW), height: Math.max(1, Math.round((h * maxW) / w)) };
}

/** "Actual size": the natural size of the visible (cropped) part. */
export function actualSize(natural: { width: number; height: number }, a: Partial<ObjectAttrs>): { width: number; height: number } {
  const { l, t, r, b } = cropOf(a);
  return { width: Math.max(1, Math.round(natural.width * (1 - l - r))), height: Math.max(1, Math.round(natural.height * (1 - t - b))) };
}

// --- CSS ---------------------------------------------------------------------------

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * CSS for an object's outer box. `block` is the pre-M7 top-level image
 * node (its own line). Page-relative horizontal offsets use the page's left
 * margin from the `--doc-ml` custom property the page sets (1in when unset).
 */
export function outerStyle(a: Partial<ObjectAttrs>, block = false): Record<string, string> {
  const wrap = (a.wrap ?? "inline") as WrapType;
  const w = Number(a.width) || 0;
  const h = Number(a.height) || 0;
  const d = a.dist != null ? Number(a.dist) : DEFAULT_DIST;
  const s: Record<string, string> = {};
  if (w) s.width = px(w);
  if (h) s.height = px(h);
  const hOff = hOffsetCss(a);
  if (wrap === "inline") {
    s.display = block ? "block" : "inline-block";
    if (block) Object.assign(s, alignMargins(a.hAlign ?? null));
    else s["vertical-align"] = "bottom";
  } else if (isFloat(wrap)) {
    const right = a.hAlign === "right" || a.hAlign === "outside";
    s.float = right ? "right" : "left";
    s.margin = `0 ${right ? "0" : px(d)} ${px(d)} ${right ? px(d) : "0"}`;
    if (a.hAlign === "center" && w) s["margin-left"] = `calc(50% - ${px(w / 2)})`;
    else if (!a.hAlign && hOff) s["margin-left"] = hOff;
    if (!a.vAlign && Number(a.vOffset) > 0 && (a.vRel === "paragraph" || a.vRel === "line")) s["margin-top"] = px(Number(a.vOffset));
  } else if (wrap === "topBottom") {
    s.display = "block";
    s.margin = `${px(d)} 0`;
    Object.assign(s, alignMargins(a.hAlign ?? null));
    if (!a.hAlign && hOff) s["margin-left"] = hOff;
  } else {
    s.position = "absolute";
    s["z-index"] = String(wrap === "behind" ? -1 : 5 + Math.max(0, Math.min(1000, Math.round(Number(a.z) || 0) % 1000)));
    if (a.hAlign === "center") s.left = w ? `calc(50% - ${px(w / 2)})` : "0";
    else if (a.hAlign === "right" || a.hAlign === "outside") s.right = "0";
    else if (a.hAlign) s.left = "0";
    else s.left = hOff || "0";
    const vOff = Number(a.vOffset) || 0;
    s.top = a.vPct != null ? `${Number(a.vPct)}%` : px(vOff);
  }
  return s;
}

function alignMargins(align: string | null): Record<string, string> {
  if (align === "center") return { "margin-left": "auto", "margin-right": "auto" };
  if (align === "right" || align === "outside") return { "margin-left": "auto", "margin-right": "0" };
  return {};
}

/** The horizontal offset as CSS (relative to the text column). */
function hOffsetCss(a: Partial<ObjectAttrs>): string {
  if (a.hPct != null) return `${Number(a.hPct)}%`;
  const off = Number(a.hOffset) || 0;
  const pageLike = a.hRel === "page" || a.hRel === "leftMargin" || a.hRel === "insideMargin";
  if (pageLike) return `calc(${px(off)} - var(--doc-ml, ${PX_PER_INCH}px))`;
  return off ? px(off) : "";
}

/** CSS transform for rotation and flips (about the centre). */
export function transformOf(a: Partial<ObjectAttrs>): string {
  const parts: string[] = [];
  const rot = Number(a.rotate) || 0;
  if (rot) parts.push(`rotate(${rot}deg)`);
  if (a.flipH || a.flipV) parts.push(`scale(${a.flipH ? -1 : 1}, ${a.flipV ? -1 : 1})`);
  return parts.join(" ");
}

/** Style text for an element from a style map. */
export function styleText(s: Record<string, string>): string {
  return Object.entries(s)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

// --- names ---------------------------------------------------------------------------

const KIND_NAME: Record<string, string> = {
  image: "Picture",
  inlineImage: "Picture",
  shape: "Shape",
  textBox: "Text Box",
  chart: "Chart",
};

/** The next free default name ("Picture 3") among `taken`. */
export function defaultName(type: string, taken: Iterable<string>): string {
  const base = KIND_NAME[type] ?? "Object";
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A name is a non-empty string. */
export function validName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0;
}

// --- z-order ---------------------------------------------------------------------------

export type ArrangeOp = "front" | "back" | "forward" | "backward";

/**
 * New z values after arranging object `target` among `objs` (z = Word's
 * relativeHeight, larger is on top): to front / to back, or one step past
 * the next object above / below it. Ties keep document order.
 */
export function arrange(objs: { id: number; z: number }[], target: number, op: ArrangeOp): Map<number, number> {
  const order = [...objs].sort((a, b) => a.z - b.z || a.id - b.id).map((o) => o.id);
  const i = order.indexOf(target);
  const out = new Map<number, number>();
  if (i < 0) return out;
  order.splice(i, 1);
  const j = op === "front" ? order.length : op === "back" ? 0 : op === "forward" ? Math.min(order.length, i + 1) : Math.max(0, i - 1);
  order.splice(j, 0, target);
  order.forEach((id, k) => out.set(id, k + 1));
  return out;
}

// --- strokes (OnlyOffice api-drawing CreateStroke) --------------------------------------

export const DASH_STYLES = ["solid", "dash", "dashDot", "lgDash", "lgDashDot", "lgDashDotDot", "sysDash", "sysDot"] as const;
export type DashStyle = (typeof DASH_STYLES)[number];

export interface Stroke {
  /** px; 0 = no line. */
  width: number;
  /** CSS colour, or null for no fill (an invisible line). */
  color: string | null;
  dash: DashStyle;
}

/** A shape outline from a width in EMUs, a colour (null = no fill) and a
 *  preset dash name (ST_PresetLineDashVal; unknown names are solid). */
export function createStroke(widthEmu: number, color: string | null, dash?: string): Stroke {
  const d = (DASH_STYLES as readonly string[]).includes(dash ?? "") ? (dash as DashStyle) : "solid";
  return { width: Math.max(0, Math.round((widthEmu / 9525) * 100) / 100), color, dash: d };
}

// --- shapes ------------------------------------------------------------------------------

/** Default look of a new shape and a new text box. */
export const SHAPE_DEFAULTS = { fill: "#4472c4", stroke: "#2f528f", strokeWidth: 1, textColor: "#ffffff" };
export const TEXTBOX_DEFAULTS = { fill: "#ffffff", stroke: "#000000", strokeWidth: 0.75, textColor: "" };

/** Vertical text anchoring in a shape (a:bodyPr anchor). */
export const TEXT_ANCHORS = ["t", "ctr", "b"] as const;

// --- position / size patches (OnlyOffice api-drawing SetHorPosition, …) -------------

/** A position change: `value` is EMUs, or a percentage with `percent`. */
export function positionPatch(axis: "h" | "v", rel: string, value: number, percent = false): Record<string, unknown> {
  const k = axis === "h" ? "h" : "v";
  return percent
    ? { [`${k}Rel`]: rel, [`${k}Pct`]: value, [`${k}Align`]: null, [`${k}Offset`]: 0 }
    : { [`${k}Rel`]: rel, [`${k}Offset`]: Math.round((value / 9525) * 100) / 100, [`${k}Pct`]: null, [`${k}Align`]: null };
}

/** A relative size change (wp14:sizeRelH / sizeRelV): `pct` % of `rel`. */
export function relSizePatch(axis: "w" | "h", rel: string, pct: number): Record<string, unknown> {
  return axis === "w" ? { relW: pct, relWFrom: rel } : { relH: pct, relHFrom: rel };
}

/** The drawing's anchor properties in DrawingML terms (positions in EMUs,
 *  percentages as given), as OnlyOffice's ToJSON reports them. */
export function drawingJson(a: Partial<ObjectAttrs>): Record<string, unknown> {
  const pos = (rel: unknown, align: unknown, off: unknown, pct: unknown) =>
    pct != null
      ? { relativeFrom: rel, posOffset: Number(pct), percent: true }
      : align
        ? { relativeFrom: rel, align }
        : { relativeFrom: rel, posOffset: Math.round((Number(off) || 0) * 9525), percent: false };
  const out: Record<string, unknown> = {
    name: a.name ?? null,
    wrap: a.wrap ?? "inline",
    positionH: pos(a.hRel ?? "column", a.hAlign, a.hOffset, a.hPct),
    positionV: pos(a.vRel ?? "paragraph", a.vAlign, a.vOffset, a.vPct),
    flipH: !!a.flipH,
    flipV: !!a.flipV,
  };
  if (a.relW != null) out.sizeRelH = { relativeFrom: a.relWFrom ?? "page", "wp14:pctWidth": a.relW };
  if (a.relH != null) out.sizeRelV = { relativeFrom: a.relHFrom ?? "page", "wp14:pctHeight": a.relH };
  return out;
}
