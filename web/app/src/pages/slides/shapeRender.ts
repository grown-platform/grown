// Rendering data for preset-geometry elements ("shape" / "connector"): SVG
// layers (fill, shading, outline, dash, arrowheads) computed from the
// geometry engine. Pure: SlideView/SlideCanvas turn the layers into JSX and
// export.ts into SVG markup, so the editor, thumbnails and exports agree.

import type { ArrowHead, DashStyle, GradientFill, SlideElement } from "./model";
import {
  evaluatePreset,
  pathEnds,
  segsToD,
  type Geometry,
  type PathFill,
  type Seg,
} from "./presetGeometry";

/** The preset that draws an element: its own, or the preset equivalent of a
 *  legacy shape type (for connection sites). */
export function elementPreset(el: SlideElement): string | undefined {
  if (el.type === "shape" || el.type === "connector") return el.preset;
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "triangle":
    case "diamond":
    case "rightArrow":
      return el.type;
    case "roundRect":
      return "roundRect";
    default:
      return undefined;
  }
}

/** Geometry of a preset element at its own size (null if not a preset). */
export function elementGeometry(el: SlideElement): Geometry | null {
  const prst = elementPreset(el);
  if (!prst) return null;
  const adj = el.type === "roundRect" ? { adj: 18000 } : el.adj;
  return evaluatePreset(prst, Math.max(el.w, 0), Math.max(el.h, 0), adj);
}

/** SVG stroke-dasharray for a pptx dash preset (multiples of the width). */
export function dashArray(dash: DashStyle | undefined, sw: number): string | undefined {
  const u = Math.max(sw, 1);
  const pat: Record<DashStyle, number[]> = {
    solid: [],
    dash: [4, 3],
    dashDot: [4, 3, 1, 3],
    lgDash: [8, 3],
    lgDashDot: [8, 3, 1, 3],
    lgDashDotDot: [8, 3, 1, 3, 1, 3],
    sysDash: [3, 1],
    sysDot: [1, 1],
  };
  const p = dash ? pat[dash] : undefined;
  return p && p.length ? p.map((n) => n * u).join(" ") : undefined;
}

/** Arrowhead length/width for a line of width `sw` (PowerPoint "medium"). */
export function arrowSize(sw: number): number {
  return 3.5 * Math.max(sw, 2);
}

/** An arrowhead with its tip at `tip`, pointing away from `from`. */
export function arrowHeadPath(
  kind: ArrowHead,
  tip: [number, number],
  from: [number, number],
  sw: number,
): { d: string; filled: boolean } | null {
  if (kind === "none") return null;
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const L = arrowSize(sw);
  const W = L;
  const P = (a: number, b: number): string =>
    `${r2(tip[0] + a * ux + b * nx)} ${r2(tip[1] + a * uy + b * ny)}`;
  switch (kind) {
    case "triangle":
      return { d: `M${P(0, 0)} L${P(-L, W / 2)} L${P(-L, -W / 2)} Z`, filled: true };
    case "stealth":
      return {
        d: `M${P(0, 0)} L${P(-L, W / 2)} L${P(-0.6 * L, 0)} L${P(-L, -W / 2)} Z`,
        filled: true,
      };
    case "diamond":
      return {
        d: `M${P(L / 2, 0)} L${P(0, W / 2)} L${P(-L / 2, 0)} L${P(0, -W / 2)} Z`,
        filled: true,
      };
    case "oval": {
      const r = L / 2;
      return {
        d: `M${P(-r, 0)} A${r2(r)} ${r2(r)} 0 1 0 ${P(r, 0)} A${r2(r)} ${r2(r)} 0 1 0 ${P(-r, 0)} Z`,
        filled: true,
      };
    }
    case "arrow":
      return { d: `M${P(-L, W / 2)} L${P(0, 0)} L${P(-L, -W / 2)}`, filled: false };
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pull a straight end segment back by `by` so a filled arrowhead covers the
 *  line's butt end. Curved ends are left alone. */
function trimEnds(segs: Seg[], start: number, end: number): Seg[] {
  const out = segs.map((s) => ({ ...s, ...("p" in s ? { p: [...s.p] } : {}) })) as Seg[];
  const draw = out.filter((s) => s.c !== "Z");
  if (draw.length < 2) return out;
  const pull = (a: number[], b: number[], by: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= by * 1.5 || by <= 0) return;
    b[0] -= ((b[0] - a[0]) / len) * by;
    b[1] -= ((b[1] - a[1]) / len) * by;
  };
  const m = draw[0] as { c: "M"; p: number[] };
  const n1 = draw[1];
  if (start > 0 && n1.c === "L") pull(n1.p, m.p, start);
  const last = draw[draw.length - 1];
  const prev = draw[draw.length - 2] as { p: number[] };
  if (end > 0 && last.c === "L") {
    const pp = prev.p.slice(-2);
    pull(pp, last.p, end);
  }
  return out;
}

export interface ShapeLayer {
  d: string;
  fill?: string;
  /** The fill is this gradient (painted via an SVG gradient; `fill` is its
   *  first stop, the fallback colour). */
  gradient?: GradientFill;
  /** Semi-transparent shading drawn over the fill (darken/lighten paths). */
  shade?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: string;
  lineJoin?: "round" | "miter";
}

const SHADE: Partial<Record<PathFill, string>> = {
  darken: "rgba(0,0,0,0.4)",
  darkenLess: "rgba(0,0,0,0.2)",
  lighten: "rgba(255,255,255,0.4)",
  lightenLess: "rgba(255,255,255,0.2)",
};

const has = (c?: string) => !!c && c !== "none" && c !== "transparent";

/**
 * The SVG layers that draw a "shape" or "connector" element in its own box
 * coordinates (0,0 = top-left, before rotation/flip). Empty for an unknown
 * preset.
 */
export function shapeLayers(el: SlideElement): ShapeLayer[] {
  const g = elementGeometry(el);
  if (!g) return [];
  const sw = el.strokeWidth ?? 1;
  const stroked = has(el.stroke) && sw > 0;
  const dash = dashArray(el.dash, sw);
  const out: ShapeLayer[] = [];
  const isLine = el.type === "connector";
  const grad = el.gradFill && el.gradFill.stops.length >= 2 ? el.gradFill : undefined;
  // Fills first (all paths), then outlines, as PowerPoint paints them.
  if (!isLine && has(el.fill))
    for (const p of g.paths) {
      if (p.fill === "none") continue;
      out.push({
        d: p.d,
        fill: el.fill,
        ...(grad ? { gradient: grad } : {}),
        ...(SHADE[p.fill] ? { shade: SHADE[p.fill] } : {}),
      });
    }
  if (!stroked) return out;
  const head = el.headEnd && el.headEnd !== "none" ? el.headEnd : null;
  const tail = el.tailEnd && el.tailEnd !== "none" ? el.tailEnd : null;
  const L = arrowSize(sw);
  const trimFor = (k: ArrowHead | null) =>
    k === "triangle" || k === "stealth" ? L * 0.5 : 0;
  g.paths.forEach((p, i) => {
    if (!p.stroke) return;
    const segs = i === 0 && isLine ? trimEnds(p.segs, trimFor(head), trimFor(tail)) : p.segs;
    out.push({
      d: segsToD(segs),
      stroke: el.stroke,
      strokeWidth: sw,
      ...(dash ? { dash } : {}),
      lineJoin: isLine ? "round" : "miter",
    });
  });
  if (isLine && (head || tail) && g.paths[0]) {
    const ends = pathEnds(g.paths[0].segs);
    if (ends) {
      for (const [kind, tip, from] of [
        [head, ends.start, ends.startFrom],
        [tail, ends.end, ends.endFrom],
      ] as const) {
        if (!kind) continue;
        const a = arrowHeadPath(kind, tip, from, sw);
        if (!a) continue;
        out.push(
          a.filled
            ? { d: a.d, fill: el.stroke }
            : { d: a.d, stroke: el.stroke, strokeWidth: sw, lineJoin: "round" },
        );
      }
    }
  }
  return out;
}

/** The first path of a connector (for a wide invisible hit target). */
export function connectorHitPath(el: SlideElement): string | undefined {
  return elementGeometry(el)?.paths[0]?.d;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** SVG gradient geometry in the shape's bounding box: a radial gradient
 *  from the centre, or a linear one along `angle` (DrawingML: 0° = left →
 *  right, clockwise). */
export function gradientGeometry(g: GradientFill): { radial: true } | { radial: false; x1: number; y1: number; x2: number; y2: number } {
  if (g.radial) return { radial: true };
  const a = ((g.angle ?? 90) * Math.PI) / 180;
  const dx = Math.cos(a) / 2;
  const dy = Math.sin(a) / 2;
  return { radial: false, x1: r2(0.5 - dx), y1: r2(0.5 - dy), x2: r2(0.5 + dx), y2: r2(0.5 + dy) };
}

/** An SVG `<linearGradient>`/`<radialGradient>` element with id `id`. */
export function gradientDefMarkup(g: GradientFill, id: string): string {
  const stops = g.stops
    .map((st) => `<stop offset="${r2(st.pos * 100)}%" stop-color="${esc(st.color.slice(0, 7))}"${st.color.length === 9 ? ` stop-opacity="${r2(parseInt(st.color.slice(7), 16) / 255)}"` : ""}/>`)
    .join("");
  const geo = gradientGeometry(g);
  return geo.radial
    ? `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">${stops}</radialGradient>`
    : `<linearGradient id="${id}" x1="${geo.x1}" y1="${geo.y1}" x2="${geo.x2}" y2="${geo.y2}">${stops}</linearGradient>`;
}

/** SVG markup (no <svg> wrapper) for an element's layers. `idPrefix` keeps
 *  gradient ids unique when the same element is drawn more than once. */
export function shapeLayersMarkup(el: SlideElement, idPrefix = "g"): string {
  const gid = `${idPrefix}-grad-${el.id}`.replace(/[^A-Za-z0-9_-]/g, "_");
  let defs = "";
  return shapeLayers(el)
    .map((l) => {
      const parts: string[] = [];
      if (l.gradient && !defs) {
        defs = `<defs>${gradientDefMarkup(l.gradient, gid)}</defs>`;
        parts.push(defs);
      }
      if (l.fill) parts.push(`<path d="${l.d}" fill="${l.gradient ? `url(#${gid})` : esc(l.fill)}" fill-rule="evenodd"/>`);
      if (l.shade) parts.push(`<path d="${l.d}" fill="${l.shade}" fill-rule="evenodd"/>`);
      if (l.stroke)
        parts.push(
          `<path d="${l.d}" fill="none" stroke="${esc(l.stroke)}" stroke-width="${l.strokeWidth}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} stroke-linejoin="${l.lineJoin ?? "miter"}"/>`,
        );
      return parts.join("");
    })
    .join("");
}

/** CSS/SVG transform for rotation + flips about the box centre. */
export function svgTransform(el: SlideElement): string {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const parts = [`translate(${r2(cx)} ${r2(cy)})`];
  if (el.rotation) parts.push(`rotate(${el.rotation})`);
  if (el.flipH || el.flipV) parts.push(`scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1})`);
  parts.push(`translate(${r2(-el.w / 2)} ${r2(-el.h / 2)})`);
  return parts.join(" ");
}

/** A standalone `<g>` for the SVG export. */
export function shapeSvgGroup(el: SlideElement): string {
  return `<g transform="${svgTransform(el)}">${shapeLayersMarkup(el)}</g>`;
}
