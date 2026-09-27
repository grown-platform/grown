// Small helpers for reading and writing SpreadsheetML (ECMA-376 Part 1, §18)
// parts: XML escaping and DOM access by local name, A1 references and sqref
// lists, colours (ARGB, theme + tint, the indexed palette) and the unit
// conversions between FortuneSheet pixels and Excel's character widths/points.
// Written from the spec; shared by xlsxRead.ts and xlsxWrite.ts.

import type { CellRect } from "../cellRange";
import { colToLetters, lettersToCol } from "../cellValue";

export const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
export const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Escapes text for element content and attribute values. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most C0 controls; Excel writes them as _xHHHH_.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (ch) => `_x${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}_`);
}

/** Reverses the _xHHHH_ escapes of ST_Xstring. */
export function unescapeXstring(s: string): string {
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Builds `name="value"` pairs, skipping undefined/null/false-y-by-intent values. */
export function attrs(a: Record<string, string | number | boolean | null | undefined>): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    out += ` ${k}="${esc(s)}"`;
  }
  return out;
}

export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

/** Direct children with the given local name (namespace-agnostic). */
export function kids(el: Element | Document | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from((el as ParentNode).children ?? []).filter((n) => n.localName === name);
}

export function kid(el: Element | Document | null | undefined, name: string): Element | null {
  return kids(el, name)[0] ?? null;
}

/** Descendants with the given local name. */
export function all(el: Element | Document | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS("*", name));
}

export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  if (el.hasAttribute(name)) return el.getAttribute(name);
  // Prefixed attributes (r:id) by local name.
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}

export function numAttr(el: Element | null | undefined, name: string): number | null {
  const v = attr(el, name);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** ST_Boolean: "1"/"true" → true, "0"/"false" → false, absent → fallback. */
export function boolAttr(el: Element | null | undefined, name: string, fallback = false): boolean {
  const v = attr(el, name);
  if (v === null) return fallback;
  return v === "1" || v === "true";
}

/** Text content with ST_Xstring escapes undone. */
export function text(el: Element | null | undefined): string {
  return el ? unescapeXstring(el.textContent ?? "") : "";
}

// ---- references ------------------------------------------------------------------------

export function cellRef(r: number, c: number, abs = false): string {
  const d = abs ? "$" : "";
  return `${d}${colToLetters(c)}${d}${r + 1}`;
}

export function rectRef(rect: CellRect, abs = false): string {
  const r1 = Math.min(rect.r1, rect.r2);
  const r2 = Math.max(rect.r1, rect.r2);
  const c1 = Math.min(rect.c1, rect.c2);
  const c2 = Math.max(rect.c1, rect.c2);
  const a = cellRef(r1, c1, abs);
  return r1 === r2 && c1 === c2 ? a : `${a}:${cellRef(r2, c2, abs)}`;
}

/** "B3" → {r: 2, c: 1}; null when not a plain cell reference. */
export function parseCellRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (!m) return null;
  return { r: Number(m[2]) - 1, c: lettersToCol(m[1]) };
}

export const MAX_ROW = 1048575;
export const MAX_COL = 16383;

/** "A1:B2", "C3", "A:A", "1:3" → rectangle (0-based). */
export function parseRef(ref: string): CellRect | null {
  const s = ref.trim().replace(/^.*!/, "").replace(/\$/g, "");
  const parts = s.split(":");
  if (parts.length === 1) {
    const p = parseCellRef(parts[0]);
    return p ? { r1: p.r, c1: p.c, r2: p.r, c2: p.c } : null;
  }
  if (parts.length !== 2) return null;
  const a = parseCellRef(parts[0]);
  const b = parseCellRef(parts[1]);
  if (a && b) return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  if (/^[A-Za-z]{1,3}$/.test(parts[0]) && /^[A-Za-z]{1,3}$/.test(parts[1])) {
    const x = lettersToCol(parts[0]);
    const y = lettersToCol(parts[1]);
    return { r1: 0, c1: Math.min(x, y), r2: MAX_ROW, c2: Math.max(x, y) };
  }
  if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    const x = Number(parts[0]) - 1;
    const y = Number(parts[1]) - 1;
    return { r1: Math.min(x, y), c1: 0, r2: Math.max(x, y), c2: MAX_COL };
  }
  return null;
}

/** sqref ("A1:B2 D4") → rectangles. */
export function parseSqref(sqref: string | null | undefined): CellRect[] {
  return (sqref ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(parseRef)
    .filter((r): r is CellRect => r !== null);
}

export function sqref(ranges: CellRect[]): string {
  return ranges.map((r) => rectRef(r)).join(" ");
}

/** Quotes a sheet name for a formula when needed ('My sheet'!A1). */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// ---- colours ---------------------------------------------------------------------------

/** "#RRGGBB" / "#RGB" / "rgb(r,g,b)" → "FFRRGGBB"; null when not a colour. */
export function toArgb(color: unknown): string | null {
  if (typeof color !== "string") return null;
  const s = color.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return ("FF" + m[1]).toUpperCase();
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return ("FF" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^#?([0-9a-f]{8})$/i.exec(s);
  if (m && s.startsWith("#")) return (m[1].slice(6) + m[1].slice(0, 6)).toUpperCase(); // #RRGGBBAA
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) return "FF" + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return null;
}

/** "FFRRGGBB" → "#rrggbb" (alpha dropped). */
export function fromArgb(argb: string): string {
  const s = argb.replace(/^#/, "");
  const rgb = s.length === 8 ? s.slice(2) : s.padStart(6, "0").slice(-6);
  return "#" + rgb.toLowerCase();
}

// Default Office theme colours, indexed the way SpreadsheetML refers to them
// (0 lt1, 1 dk1, 2 lt2, 3 dk2, 4–9 accent1–6, 10 hlink, 11 folHlink).
export const DEFAULT_THEME = [
  "FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72",
];

/** Theme colours from xl/theme/theme1.xml, in SpreadsheetML index order. */
export function readTheme(doc: Document | null): string[] {
  if (!doc) return DEFAULT_THEME.slice();
  const scheme = all(doc, "clrScheme")[0];
  if (!scheme) return DEFAULT_THEME.slice();
  const pick = (name: string, i: number) => {
    const el = kid(scheme, name);
    const srgb = kid(el, "srgbClr");
    if (srgb) return (attr(srgb, "val") ?? DEFAULT_THEME[i]).toUpperCase();
    const sys = kid(el, "sysClr");
    if (sys) return (attr(sys, "lastClr") ?? DEFAULT_THEME[i]).toUpperCase();
    return DEFAULT_THEME[i];
  };
  // The scheme lists dk1, lt1, dk2, lt2; cell styles index lt1 first.
  return [
    pick("lt1", 0), pick("dk1", 1), pick("lt2", 2), pick("dk2", 3),
    pick("accent1", 4), pick("accent2", 5), pick("accent3", 6), pick("accent4", 7), pick("accent5", 8), pick("accent6", 9),
    pick("hlink", 10), pick("folHlink", 11),
  ];
}

// The legacy indexed palette (§18.8.27), 0–63; 64 is the system foreground.
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
  "000000", "FFFFFF",
];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/** Applies a tint (−1…1) to an RRGGBB colour, as §18.8.19 describes (HLS luminance). */
export function applyTint(rgb: string, tint: number): string {
  if (!tint) return rgb.toUpperCase();
  const n = parseInt(rgb, 16);
  const [h, s, l] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hslToRgb(h, s, Math.max(0, Math.min(1, l2)))
    .map((x) => Math.round(x).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** A CT_Color element → "#rrggbb", or null (auto / missing). */
export function readColor(el: Element | null | undefined, theme: string[], auto: string | null = null): string | null {
  if (!el) return null;
  if (boolAttr(el, "auto")) return auto;
  const tint = numAttr(el, "tint") ?? 0;
  const rgb = attr(el, "rgb");
  if (rgb) return fromArgb(applyTint(rgb.replace(/^#/, "").slice(-6), tint));
  const th = numAttr(el, "theme");
  if (th !== null) return fromArgb(applyTint(theme[th] ?? "000000", tint));
  const ix = numAttr(el, "indexed");
  if (ix !== null) {
    if (ix === 64) return auto;
    return INDEXED[ix] ? fromArgb(applyTint(INDEXED[ix], tint)) : null;
  }
  return null;
}

// ---- units -----------------------------------------------------------------------------

/** Maximum digit width of the default font (Calibri 11 / Arial 10), in pixels. */
const MDW = 7;

/** Excel column width (characters) → pixels, per §18.3.1.13. */
export function widthToPx(w: number): number {
  return Math.max(0, Math.trunc(((256 * w + Math.trunc(128 / MDW)) / 256) * MDW));
}

/** Pixels → Excel column width (characters), rounded to 1/256. */
export function pxToWidth(px: number): number {
  if (px <= 0) return 0;
  const w = Math.trunc(((px - 5) / MDW) * 100 + 0.5) / 100;
  return Math.max(0, Math.round((w + 5 / MDW) * 256) / 256);
}

/** Points → pixels at 96 dpi. */
export function ptToPx(pt: number): number {
  return Math.round((pt * 96) / 72);
}

export function pxToPt(px: number): number {
  return Math.round(((px * 72) / 96) * 100) / 100;
}

/** Joins package paths ("xl/worksheets", "../comments1.xml" → "xl/comments1.xml"). */
export function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

/** Directory of a part path ("xl/worksheets/sheet1.xml" → "xl/worksheets"). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** The .rels part that belongs to a part. */
export function relsPathFor(path: string): string {
  const d = dirOf(path);
  const f = path.slice(d.length ? d.length + 1 : 0);
  return `${d ? d + "/" : ""}_rels/${f}.rels`;
}

export interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

export function readRels(doc: Document | null): Rel[] {
  if (!doc) return [];
  return all(doc, "Relationship").map((el) => ({
    id: attr(el, "Id") ?? "",
    type: attr(el, "Type") ?? "",
    target: attr(el, "Target") ?? "",
    external: attr(el, "TargetMode") === "External",
  }));
}
