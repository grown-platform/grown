// DrawingML preset geometry evaluator (ECMA-376 Part 1, §20.1.9 "Shape
// Definitions and Attributes").
//
// A preset shape is a list of adjust values (avLst), guides (gdLst: one
// formula each, evaluated in order), adjust handles (ahLst), connection sites
// (cxnLst), a text rectangle and one or more paths. This module evaluates a
// definition from presetDefs.ts for a concrete box (w × h) and adjust values
// and returns SVG path data, handle positions, connection sites and the text
// rectangle. Everything here is pure; the renderer (shapeRender.ts) and the
// pptx reader/writer build on it.
//
// Units follow the spec: lengths are in the caller's units (logical px),
// angles are in 60,000ths of a degree, adjust values are the raw avLst
// integers (usually 1/100,000ths of the short side or of w/h).

import { PRESET_DEFS } from "./presetDefs";

export type PathFill =
  | "norm"
  | "none"
  | "darken"
  | "darkenLess"
  | "lighten"
  | "lightenLess";

/** One `<a:path>`: commands in a tiny DSL (see parsePathCmds). */
export interface PathDef {
  /** Path coordinate space (the spec's `w`/`h`); omitted = shape space. */
  w?: number;
  h?: number;
  fill?: PathFill;
  /** false = `stroke="0"`. */
  stroke?: boolean;
  /**
   * `M x y` moveTo, `L x y` lnTo, `A wR hR stAng swAng` arcTo,
   * `Q x1 y1 x y` quadBezTo, `C x1 y1 x2 y2 x y` cubicBezTo, `Z` close.
   * Every argument is a guide name or a number.
   */
  d: string;
}

export interface XYHandleDef {
  kind?: "xy";
  gdRefX?: string;
  minX?: string;
  maxX?: string;
  gdRefY?: string;
  minY?: string;
  maxY?: string;
  pos: [string, string];
}
export interface PolarHandleDef {
  kind: "polar";
  gdRefR?: string;
  minR?: string;
  maxR?: string;
  gdRefAng?: string;
  minAng?: string;
  maxAng?: string;
  pos: [string, string];
}
export type HandleDef = XYHandleDef | PolarHandleDef;

export interface PresetDef {
  /** avLst: adjust names → default values, in spec order. */
  av?: Record<string, number>;
  /** gdLst: "name op arg…" per guide, evaluated in order. */
  gd?: string[];
  ah?: HandleDef[];
  /** cxnLst: [ang, x, y]. */
  cxn?: [string, string, string][];
  /** Text rectangle [l, t, r, b]; defaults to the shape box. */
  rect?: [string, string, string, string];
  paths: PathDef[];
}

/** An absolute path segment (arcs are converted to cubic Béziers). */
export type Seg =
  | { c: "M" | "L"; p: [number, number] }
  | { c: "Q"; p: [number, number, number, number] }
  | { c: "C"; p: [number, number, number, number, number, number] }
  | { c: "Z" };

export interface GeomPath {
  d: string;
  fill: PathFill;
  stroke: boolean;
  segs: Seg[];
}

export interface ConnectionSite {
  x: number;
  y: number;
  /** Direction a connector leaves the site, in degrees (0 = +x, 90 = +y). */
  ang: number;
}

export interface HandlePos {
  x: number;
  y: number;
  def: HandleDef;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geometry {
  paths: GeomPath[];
  textRect: Rect;
  cxn: ConnectionSite[];
  handles: HandlePos[];
}

export type Guides = Record<string, number>;

const ANG = 60000; // units per degree
const DEG = Math.PI / 180;
const toRad = (a: number) => (a / ANG) * DEG;
const fromRad = (r: number) => (r / DEG) * ANG;

/** Is this a preset we can draw? */
export function hasPreset(prst: string | undefined): prst is string {
  return !!prst && Object.prototype.hasOwnProperty.call(PRESET_DEFS, prst);
}

export function presetDef(prst: string): PresetDef | undefined {
  return hasPreset(prst) ? PRESET_DEFS[prst] : undefined;
}

/** Default adjust values of a preset (a copy). */
export function defaultAdjust(prst: string): Record<string, number> {
  return { ...(presetDef(prst)?.av ?? {}) };
}

/** The spec's built-in guides for a w × h box (§20.1.9.11 / Table L.1). */
export function builtinGuides(w: number, h: number): Guides {
  const ss = Math.min(w, h);
  const g: Guides = {
    l: 0,
    t: 0,
    r: w,
    b: h,
    w,
    h,
    hc: w / 2,
    vc: h / 2,
    ss,
    ls: Math.max(w, h),
    cd2: 10800000,
    cd4: 5400000,
    cd8: 2700000,
    "3cd4": 16200000,
    "3cd8": 8100000,
    "5cd8": 13500000,
    "7cd8": 18900000,
  };
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    g[`wd${n}`] = w / n;
    g[`hd${n}`] = h / n;
    g[`ssd${n}`] = ss / n;
  }
  return g;
}

function arg(env: Guides, tok: string): number {
  if (Object.prototype.hasOwnProperty.call(env, tok)) return env[tok];
  const n = Number(tok);
  if (Number.isNaN(n)) throw new Error(`unknown guide "${tok}"`);
  return n;
}

/**
 * Evaluate one guide formula (§20.1.9.11, ST_GeomGuideFormula): the 17
 * operators `*​/ +- +/ ?: abs at2 cat2 cos max min mod pin sat2 sin sqrt tan
 * val`. Arguments are guide names or literals.
 */
export function evalFormula(fmla: string, env: Guides): number {
  const [op, ...rest] = fmla.trim().split(/\s+/);
  const [x, y, z] = rest.map((t) => arg(env, t));
  switch (op) {
    case "*/":
      return z === 0 ? 0 : (x * y) / z;
    case "+-":
      return x + y - z;
    case "+/":
      return z === 0 ? 0 : (x + y) / z;
    case "?:":
      return x > 0 ? y : z;
    case "abs":
      return Math.abs(x);
    case "at2":
      return fromRad(Math.atan2(y, x));
    case "cat2":
      return x * Math.cos(Math.atan2(z, y));
    case "cos":
      return x * Math.cos(toRad(y));
    case "max":
      return Math.max(x, y);
    case "min":
      return Math.min(x, y);
    case "mod":
      return Math.sqrt(x * x + y * y + z * z);
    case "pin":
      return y < x ? x : y > z ? z : y;
    case "sat2":
      return x * Math.sin(Math.atan2(z, y));
    case "sin":
      return x * Math.sin(toRad(y));
    case "sqrt":
      return Math.sqrt(Math.max(0, x));
    case "tan":
      return x * Math.tan(toRad(y));
    case "val":
      return x;
    default:
      throw new Error(`unknown formula operator "${op}"`);
  }
}

/** Built-ins + adjust values (defaults overridden by `adj`) + guides. */
export function evalGuides(
  def: PresetDef,
  w: number,
  h: number,
  adj?: Record<string, number>,
): Guides {
  const env = builtinGuides(w, h);
  for (const [k, v] of Object.entries(def.av ?? {}))
    env[k] = adj && Number.isFinite(adj[k]) ? adj[k] : v;
  for (const line of def.gd ?? []) {
    const i = line.indexOf(" ");
    env[line.slice(0, i)] = evalFormula(line.slice(i + 1), env);
  }
  return env;
}

// ------------------------------------------------------------ paths

const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Point on an ellipse (radii a, b) at *geometric* angle θ (radians):
 *  DrawingML arc angles are visual angles, not the parametric angle. */
function paramAngle(a: number, b: number, theta: number): number {
  return Math.atan2(a * Math.sin(theta), b * Math.cos(theta));
}

/**
 * arcTo from the current point (x0, y0): the point lies on an ellipse with
 * radii wR/hR at angle stAng; sweep swAng (positive = clockwise on screen).
 * Emits ≤90° cubic Bézier pieces; returns the end point.
 */
function arcSegs(
  x0: number,
  y0: number,
  a: number,
  b: number,
  stAng: number,
  swAng: number,
  out: Seg[],
): [number, number] {
  if (a <= 0 || b <= 0 || swAng === 0) return [x0, y0];
  const th1 = toRad(stAng);
  const sw = toRad(swAng);
  const p1 = paramAngle(a, b, th1);
  const cx = x0 - a * Math.cos(p1);
  const cy = y0 - b * Math.sin(p1);
  let p2 = paramAngle(a, b, th1 + sw);
  // Pick the turn count that keeps the parametric sweep closest to swAng.
  let d = p2 - p1;
  const k = Math.round((sw - d) / (2 * Math.PI));
  d += 2 * Math.PI * k;
  p2 = p1 + d;
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2) - 1e-9));
  const step = d / n;
  const kk = (4 / 3) * Math.tan(step / 4);
  let px = x0;
  let py = y0;
  for (let i = 0; i < n; i++) {
    const fa = p1 + step * i;
    const fb = fa + step;
    const ex = cx + a * Math.cos(fb);
    const ey = cy + b * Math.sin(fb);
    out.push({
      c: "C",
      p: [
        px - kk * a * Math.sin(fa),
        py + kk * b * Math.cos(fa),
        ex + kk * a * Math.sin(fb),
        ey - kk * b * Math.cos(fb),
        ex,
        ey,
      ],
    });
    px = ex;
    py = ey;
  }
  return [px, py];
}

function buildPath(pd: PathDef, env: Guides, w: number, h: number): Seg[] {
  const sx = pd.w ? w / pd.w : 1;
  const sy = pd.h ? h / pd.h : 1;
  const toks = pd.d.trim().split(/\s+/);
  const out: Seg[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  const X = () => arg(env, toks[i++]) * sx;
  const Y = () => arg(env, toks[i++]) * sy;
  while (i < toks.length) {
    const c = toks[i++];
    switch (c) {
      case "M":
      case "L": {
        cx = X();
        cy = Y();
        out.push({ c, p: [cx, cy] });
        break;
      }
      case "A": {
        const a = X();
        const b = Y();
        const st = arg(env, toks[i++]);
        const sw = arg(env, toks[i++]);
        [cx, cy] = arcSegs(cx, cy, a, b, st, sw, out);
        break;
      }
      case "Q": {
        const p: [number, number, number, number] = [X(), Y(), X(), Y()];
        out.push({ c: "Q", p });
        [cx, cy] = [p[2], p[3]];
        break;
      }
      case "C": {
        const p: [number, number, number, number, number, number] = [
          X(),
          Y(),
          X(),
          Y(),
          X(),
          Y(),
        ];
        out.push({ c: "C", p });
        [cx, cy] = [p[4], p[5]];
        break;
      }
      case "Z":
        out.push({ c: "Z" });
        break;
      default:
        throw new Error(`bad path command "${c}"`);
    }
  }
  return out;
}

/** SVG path data for absolute segments (0.01 px precision). */
export function segsToD(segs: Seg[]): string {
  return segs
    .map((s) => (s.c === "Z" ? "Z" : `${s.c}${s.p.map(fmt).join(" ")}`))
    .join(" ");
}

function handlePositions(def: PresetDef, env: Guides): HandlePos[] {
  return (def.ah ?? []).map((hd) => ({
    x: arg(env, hd.pos[0]),
    y: arg(env, hd.pos[1]),
    def: hd,
  }));
}

/**
 * Evaluate a preset for a w × h box. Returns null for an unknown preset.
 * Adjust values missing from `adj` take the preset's defaults.
 */
export function evaluatePreset(
  prst: string,
  w: number,
  h: number,
  adj?: Record<string, number>,
): Geometry | null {
  const def = presetDef(prst);
  if (!def) return null;
  const env = evalGuides(def, w, h, adj);
  const paths = def.paths.map((pd) => {
    const segs = buildPath(pd, env, w, h);
    return {
      d: segsToD(segs),
      fill: pd.fill ?? "norm",
      stroke: pd.stroke !== false,
      segs,
    };
  });
  const [l, t, r, b] = (def.rect ?? ["l", "t", "r", "b"]).map((k) => arg(env, k));
  return {
    paths,
    textRect: { x: l, y: t, w: r - l, h: b - t },
    cxn: (def.cxn ?? []).map(([a, x, y]) => ({
      x: arg(env, x),
      y: arg(env, y),
      ang: arg(env, a) / ANG,
    })),
    handles: handlePositions(def, env),
  };
}

// ------------------------------------------------------------ sampling

/** Points along the segments (endpoints plus `n` samples per curve). */
export function samplePoints(segs: Seg[], n = 16): [number, number][] {
  const pts: [number, number][] = [];
  let cx = 0;
  let cy = 0;
  for (const s of segs) {
    if (s.c === "M" || s.c === "L") {
      [cx, cy] = s.p;
      pts.push([cx, cy]);
    } else if (s.c === "Q") {
      const [x1, y1, x, y] = s.p;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        pts.push([u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y]);
      }
      [cx, cy] = [x, y];
    } else if (s.c === "C") {
      const [x1, y1, x2, y2, x, y] = s.p;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        pts.push([a * cx + b * x1 + c * x2 + d * x, a * cy + b * y1 + c * y2 + d * y]);
      }
      [cx, cy] = [x, y];
    }
  }
  return pts;
}

/** Bounding box of a geometry's paths (sampled curves). */
export function geometryBounds(g: Geometry): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of g.paths)
    for (const [x, y] of samplePoints(p.segs, 32)) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Start and end of the first open path, each with the direction the line
 * arrives from (a point just "inside" the line), for drawing arrowheads.
 */
export function pathEnds(
  segs: Seg[],
): { start: [number, number]; startFrom: [number, number]; end: [number, number]; endFrom: [number, number] } | null {
  const draw = segs.filter((s) => s.c !== "Z");
  if (draw.length < 2 || draw[0].c !== "M") return null;
  const start = draw[0].p as [number, number];
  const first = draw[1];
  const pick = (cands: [number, number][], ref: [number, number]) =>
    cands.find((q) => Math.hypot(q[0] - ref[0], q[1] - ref[1]) > 1e-6) ?? cands[cands.length - 1];
  const firstPts: [number, number][] =
    first.c === "C"
      ? [[first.p[0], first.p[1]], [first.p[2], first.p[3]], [first.p[4], first.p[5]]]
      : first.c === "Q"
        ? [[first.p[0], first.p[1]], [first.p[2], first.p[3]]]
        : [first.p as [number, number]];
  const last = draw[draw.length - 1];
  let end: [number, number];
  let backPts: [number, number][];
  const prevEnd = (s: Seg): [number, number] =>
    s.c === "C" ? [s.p[4], s.p[5]] : s.c === "Q" ? [s.p[2], s.p[3]] : (s as { p: [number, number] }).p;
  const before = prevEnd(draw[draw.length - 2]);
  if (last.c === "C") {
    end = [last.p[4], last.p[5]];
    backPts = [[last.p[2], last.p[3]], [last.p[0], last.p[1]], before];
  } else if (last.c === "Q") {
    end = [last.p[2], last.p[3]];
    backPts = [[last.p[0], last.p[1]], before];
  } else {
    end = prevEnd(last);
    backPts = [before];
  }
  return {
    start,
    startFrom: pick(firstPts, start),
    end,
    endFrom: pick(backPts, end),
  };
}

// ------------------------------------------------------------ handles

function handleRefs(hd: HandleDef): { ref: string; min?: string; max?: string }[] {
  if (hd.kind === "polar")
    return [
      ...(hd.gdRefR ? [{ ref: hd.gdRefR, min: hd.minR, max: hd.maxR }] : []),
      ...(hd.gdRefAng ? [{ ref: hd.gdRefAng, min: hd.minAng, max: hd.maxAng }] : []),
    ];
  return [
    ...(hd.gdRefX ? [{ ref: hd.gdRefX, min: hd.minX, max: hd.maxX }] : []),
    ...(hd.gdRefY ? [{ ref: hd.gdRefY, min: hd.minY, max: hd.maxY }] : []),
  ];
}

/** Adjust range used when solving an "unbounded" handle (callout tails). */
const SOLVE_LIMIT = 5_000_000;

/**
 * Solve an adjust handle drag: the adjust values (a full map) that put
 * handle `index` closest to the local point (px, py), each value clamped to
 * the handle's min/max (themselves guides, evaluated with the current
 * values). Works for any formula: a coarse scan then a golden-section refine
 * per referenced adjust value, repeated for two-axis handles.
 */
export function solveHandle(
  prst: string,
  w: number,
  h: number,
  adj: Record<string, number> | undefined,
  index: number,
  px: number,
  py: number,
): Record<string, number> {
  const def = presetDef(prst);
  const cur = { ...defaultAdjust(prst), ...(adj ?? {}) };
  const hd = def?.ah?.[index];
  if (!def || !hd) return cur;
  const refs = handleRefs(hd);
  const cost = (vals: Record<string, number>) => {
    const env = evalGuides(def, w, h, vals);
    const x = arg(env, hd.pos[0]);
    const y = arg(env, hd.pos[1]);
    return Math.hypot(x - px, y - py);
  };
  for (let iter = 0; iter < (refs.length > 1 ? 3 : 1); iter++) {
    for (const { ref, min, max } of refs) {
      const env = evalGuides(def, w, h, cur);
      let lo = min !== undefined ? arg(env, min) : -SOLVE_LIMIT;
      let hi = max !== undefined ? arg(env, max) : SOLVE_LIMIT;
      // ±2147483647 means "unbounded" in the spec: search a sane window.
      if (lo <= -2147483647) lo = -SOLVE_LIMIT;
      if (hi >= 2147483647) hi = SOLVE_LIMIT;
      if (hi < lo) [lo, hi] = [hi, lo];
      const f = (v: number) => cost({ ...cur, [ref]: v });
      const N = 64;
      let best = lo;
      let bestC = Infinity;
      for (let i = 0; i <= N; i++) {
        const v = lo + ((hi - lo) * i) / N;
        const c = f(v);
        if (c < bestC) {
          bestC = c;
          best = v;
        }
      }
      const step = (hi - lo) / N;
      let a = Math.max(lo, best - step);
      let b = Math.min(hi, best + step);
      const gr = (Math.sqrt(5) - 1) / 2;
      for (let i = 0; i < 40 && b - a > 0.5; i++) {
        const c = b - gr * (b - a);
        const d = a + gr * (b - a);
        if (f(c) < f(d)) b = d;
        else a = c;
      }
      const v = Math.round((a + b) / 2);
      cur[ref] = f(v) <= bestC ? v : Math.round(best);
    }
  }
  return cur;
}
