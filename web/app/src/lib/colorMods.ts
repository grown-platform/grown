/**
 * DrawingML colour transforms (ECMA-376 Part 1, §20.1.2.3 "Color Transformations").
 *
 * A DrawingML colour is a base colour (sRGB hex, HSL, a theme/scheme slot, …)
 * followed by an ordered list of transforms such as
 * `<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>`.
 * This module applies those transforms. It is written from the spec's
 * definitions and is shared by every editor (Slides/Sheets/Docs import).
 *
 * Units follow the XML attributes:
 * - percentages are in 1/1000ths of a percent (100000 = 100%),
 * - angles are in 1/60000ths of a degree (21600000 = 360°).
 *
 * Channels are 0–255 integers (alpha 255 = opaque).
 */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  /** Alpha 0–255 (255 = opaque). */
  a: number;
}

/** The 28 transform elements of ECMA-376 §20.1.2.3. */
export const COLOR_MOD_NAMES = [
  "alpha", "alphaMod", "alphaOff",
  "red", "redMod", "redOff",
  "green", "greenMod", "greenOff",
  "blue", "blueMod", "blueOff",
  "hue", "hueMod", "hueOff",
  "sat", "satMod", "satOff",
  "lum", "lumMod", "lumOff",
  "tint", "shade", "comp", "inv", "gray", "gamma", "invGamma",
] as const;

export type ColorModName = (typeof COLOR_MOD_NAMES)[number];

export interface ColorMod {
  name: ColorModName;
  /** Attribute value; ignored by comp/inv/gray/gamma/invGamma. */
  val?: number;
}

/** 100% in ST_Percentage units. */
export const PCT = 100000;
/** 360° in ST_Angle units. */
export const DEG360 = 21600000;

export function isColorModName(s: string): s is ColorModName {
  return (COLOR_MOD_NAMES as readonly string[]).includes(s);
}

// ------------------------------------------------------------ colour spaces

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp255 = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : x);

/** sRGB transfer function: encoded 0–1 → linear-light 0–1 (IEC 61966-2-1). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB transfer function: linear-light 0–1 → encoded 0–1. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export interface HSL {
  /** Hue in degrees [0, 360). */
  h: number;
  /** Saturation 0–1. */
  s: number;
  /** Luminance 0–1. */
  l: number;
}

/** RGB channels 0–1 → HSL (hexcone model). */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** HSL → RGB channels 0–1. */
export function hslToRgb({ h, s, l }: HSL): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const ch = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(hk + 1 / 3), ch(hk), ch(hk - 1 / 3)];
}

// ------------------------------------------------------------ transforms

/**
 * Working colour while a transform list is applied: encoded sRGB 0–1 floats
 * plus alpha 0–1. Channels are only rounded once, at the end.
 */
interface Work {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Wrap an angle into [0, 360) (hueOff: rotation is cyclic). */
const wrapDeg = (h: number) => ((h % 360) + 360) % 360;
/** hue/hueMod produce an ST_PositiveFixedAngle: negatives floor at 0°, then wrap. */
const positiveDeg = (h: number) => (h < 0 ? 0 : h % 360);
/**
 * Attributes whose schema type is bounded (e.g. ST_PositiveFixedPercentage)
 * are invalid outside that range; an invalid value acts as 0%.
 */
const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

function withHsl(w: Work, f: (c: HSL) => HSL): void {
  const [r, g, b] = hslToRgb(f(rgbToHsl(w.r, w.g, w.b)));
  w.r = r;
  w.g = g;
  w.b = b;
}

type Channel = "r" | "g" | "b";

/** Apply `f` to one channel in linear-light space (ECMA-376 red/green/blue family). */
function withLinear(w: Work, ch: Channel, f: (lin: number) => number): void {
  w[ch] = linearToSrgb(clamp01(f(srgbToLinear(w[ch]))));
}

function forEachLinear(w: Work, f: (lin: number) => number): void {
  for (const ch of ["r", "g", "b"] as const) withLinear(w, ch, f);
}

function applyOne(w: Work, mod: ColorMod): void {
  const v = mod.val ?? 0;
  const p = v / PCT; // fraction for percentage-typed values
  switch (mod.name) {
    // --- alpha (opacity), a plain 0–1 scale
    case "alpha": // ST_PositiveFixedPercentage
      w.a = inRange(v, 0, PCT) ? p : 0;
      break;
    case "alphaMod": // ST_PositivePercentage (unbounded above)
      w.a = clamp01(w.a * p);
      break;
    case "alphaOff": // ST_FixedPercentage
      w.a = inRange(v, -PCT, PCT) ? clamp01(w.a + p) : 0;
      break;

    // --- individual channels, in linear-light RGB
    case "red":
      withLinear(w, "r", () => p);
      break;
    case "redMod":
      withLinear(w, "r", (c) => c * p);
      break;
    case "redOff":
      withLinear(w, "r", (c) => c + p);
      break;
    case "green":
      withLinear(w, "g", () => p);
      break;
    case "greenMod":
      withLinear(w, "g", (c) => c * p);
      break;
    case "greenOff":
      withLinear(w, "g", (c) => c + p);
      break;
    case "blue":
      withLinear(w, "b", () => p);
      break;
    case "blueMod":
      withLinear(w, "b", (c) => c * p);
      break;
    case "blueOff":
      withLinear(w, "b", (c) => c + p);
      break;

    // --- HSL
    case "hue":
      withHsl(w, (c) => ({ ...c, h: positiveDeg((v / DEG360) * 360) }));
      break;
    case "hueMod":
      withHsl(w, (c) => ({ ...c, h: positiveDeg(c.h * p) }));
      break;
    case "hueOff":
      withHsl(w, (c) => ({ ...c, h: wrapDeg(c.h + (v / DEG360) * 360) }));
      break;
    case "sat":
      withHsl(w, (c) => ({ ...c, s: p }));
      break;
    case "satMod":
      withHsl(w, (c) => ({ ...c, s: c.s * p }));
      break;
    case "satOff":
      withHsl(w, (c) => ({ ...c, s: c.s + p }));
      break;
    case "lum":
      withHsl(w, (c) => ({ ...c, l: clamp01(p) }));
      break;
    case "lumMod":
      withHsl(w, (c) => ({ ...c, l: clamp01(c.l * p) }));
      break;
    case "lumOff":
      withHsl(w, (c) => ({ ...c, l: clamp01(c.l + p) }));
      break;

    // --- mixes with white/black, in linear-light RGB
    case "tint": { // p of the colour + (1 - p) of white; ST_PositiveFixedPercentage
      const t = inRange(v, 0, PCT) ? p : 0;
      forEachLinear(w, (c) => c * t + (1 - t));
      break;
    }
    case "shade": { // p of the colour + (1 - p) of black; ST_PositiveFixedPercentage
      const t = inRange(v, 0, PCT) ? p : 0;
      forEachLinear(w, (c) => c * t);
      break;
    }

    // --- value-less transforms
    case "comp":
      withHsl(w, (c) => ({ ...c, h: wrapDeg(c.h + 180) }));
      break;
    case "inv": // inverse, in linear-light RGB
      forEachLinear(w, (c) => 1 - c);
      break;
    case "gray": { // luma with Rec. 709 weights
      const y = 0.2126 * w.r + 0.7152 * w.g + 0.0722 * w.b;
      w.r = w.g = w.b = y;
      break;
    }
    case "gamma": // treat the channels as linear and gamma-encode them
      w.r = linearToSrgb(clamp01(w.r));
      w.g = linearToSrgb(clamp01(w.g));
      w.b = linearToSrgb(clamp01(w.b));
      break;
    case "invGamma": // inverse of gamma
      w.r = srgbToLinear(clamp01(w.r));
      w.g = srgbToLinear(clamp01(w.g));
      w.b = srgbToLinear(clamp01(w.b));
      break;
  }
}

/** Apply `mods` in document order to `color`; returns a new colour. */
export function applyColorMods(color: RGBA, mods: readonly ColorMod[]): RGBA {
  const w: Work = { r: color.r / 255, g: color.g / 255, b: color.b / 255, a: color.a / 255 };
  for (const m of mods) applyOne(w, m);
  return {
    r: Math.round(clamp255(w.r * 255)),
    g: Math.round(clamp255(w.g * 255)),
    b: Math.round(clamp255(w.b * 255)),
    a: Math.round(clamp255(w.a * 255)),
  };
}

// ------------------------------------------------------------ base colours

/** Parse `RRGGBB` or `#RRGGBB`, optionally followed by an `AA` alpha byte. */
export function parseHex(hex: string): RGBA | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
    a: m[2] ? parseInt(m[2], 16) : 255,
  };
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** `#rrggbb`, or `#rrggbbaa` when not fully opaque. */
export function toHex(c: RGBA): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a === 255 ? base : base + hex2(c.a);
}

/** CSS colour string (`#rrggbb` or `rgba(…)`). */
export function toCss(c: RGBA): string {
  if (c.a === 255) return toHex(c);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${+(c.a / 255).toFixed(3)})`;
}

/**
 * A DrawingML colour: one base colour choice plus its transforms.
 * - `srgb`: `<a:srgbClr val="RRGGBB">`
 * - `hsl`: `<a:hslClr hue sat lum>` in ST_Angle / ST_Percentage units
 * - `scheme`: `<a:schemeClr val="accent1">`, resolved through a theme lookup
 */
export type ColorSpec =
  | { srgb: string; mods?: readonly ColorMod[] }
  | { hsl: { hue: number; sat: number; lum: number }; mods?: readonly ColorMod[] }
  | { scheme: string; mods?: readonly ColorMod[] };

/**
 * Theme lookup for scheme colours: returns a hex string (`RRGGBB`) for a
 * slot name such as `accent1`, `dk1`, `lt2`, `hlink`, or undefined.
 */
export type SchemeLookup = (name: string) => string | undefined;

/** Default colour-map aliases (`<p:clrMap>` defaults: bg1→lt1, tx1→dk1, …). */
const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
};

/**
 * Resolve a DrawingML colour to RGBA. Unknown scheme slots and malformed hex
 * resolve to opaque black, which is what an unresolved reference renders as.
 */
export function resolveColor(spec: ColorSpec, scheme?: SchemeLookup): RGBA {
  let base: RGBA | null = null;
  if ("srgb" in spec) {
    base = parseHex(spec.srgb);
  } else if ("hsl" in spec) {
    const [r, g, b] = hslToRgb({
      h: positiveDeg((spec.hsl.hue / DEG360) * 360),
      s: clamp01(spec.hsl.sat / PCT),
      l: clamp01(spec.hsl.lum / PCT),
    });
    base = { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: 255 };
  } else {
    const hex = scheme?.(spec.scheme) ?? scheme?.(DEFAULT_CLR_MAP[spec.scheme] ?? "");
    base = hex ? parseHex(hex) : null;
  }
  return applyColorMods(base ?? { r: 0, g: 0, b: 0, a: 255 }, spec.mods ?? []);
}

/**
 * Read the transform children of a DrawingML colour element (e.g. the
 * `<a:schemeClr>` node) in document order. Unknown children are ignored.
 */
export function readColorMods(el: Element): ColorMod[] {
  const out: ColorMod[] = [];
  for (const child of Array.from(el.children)) {
    const name = child.localName;
    if (!isColorModName(name)) continue;
    const raw = child.getAttribute("val");
    const val = raw === null ? undefined : Number(raw);
    out.push(val === undefined || Number.isNaN(val) ? { name } : { name, val });
  }
  return out;
}
