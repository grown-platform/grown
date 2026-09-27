/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cell model is loosely typed. */

// Cell-value helpers shared by the filter, conditional-format and validation
// models (filterOps.ts, cfOps.ts, validationOps.ts, sheetFormula.ts). They read
// FortuneSheet cell objects ({ v, m, ct, bg, fc, f, … } | null) and deal with
// Excel's 1900 date serials. Number *formatting* belongs to numberFormat.ts;
// this file only parses the handful of typed forms the data tools need.

export type Cell = Record<string, any> | null | undefined;
export type Grid = Cell[][];

export interface ErrorValue {
  error: string;
}
/** A cell or formula value. `null` is an empty cell. */
export type Scalar = number | string | boolean | ErrorValue | null;

export const ERROR_CODES = [
  "#NULL!",
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  "#N/A",
  "#SPILL!",
  "#CALC!",
  "#CIRC!",
  "#GETTING_DATA",
];

export function isError(v: unknown): v is ErrorValue {
  return typeof v === "object" && v !== null && typeof (v as ErrorValue).error === "string";
}
export function err(code: string): ErrorValue {
  return { error: code };
}

/** The value a cell holds, typed: number, text, boolean, error or null (empty). */
export function cellScalar(cell: Cell): Scalar {
  if (cell == null) return null;
  if (typeof cell !== "object") return primitive(cell);
  if (cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) {
    const s = cell.ct.s.map((p: any) => p?.v ?? "").join("");
    return s === "" ? null : s;
  }
  const v = cell.v;
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  if (s === "") return cell.f ? "" : null;
  if (ERROR_CODES.includes(s)) return err(s);
  const t = cell.ct?.t;
  if ((t === "n" || t === "d") && s.trim() !== "" && Number.isFinite(Number(s))) return Number(s);
  if (t === "b" && /^(true|false)$/i.test(s)) return /^true$/i.test(s);
  return s;
}

function primitive(v: any): Scalar {
  if (v == null || v === "") return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** The text a cell shows (its display string), "" when empty. */
export function cellDisplay(cell: Cell): string {
  if (cell == null) return "";
  if (typeof cell !== "object") return String(cell);
  if (cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) {
    return cell.ct.s.map((p: any) => p?.v ?? "").join("");
  }
  const m = cell.m ?? cell.v;
  if (m == null) return "";
  if (typeof m === "boolean") return m ? "TRUE" : "FALSE";
  return String(m);
}

/** True when the cell carries a date/time number format. */
export function isDateCell(cell: Cell): boolean {
  if (!cell || typeof cell !== "object") return false;
  if (cell.ct?.t === "d") return true;
  const fa: string = cell.ct?.fa ?? "";
  if (!fa || fa === "General" || fa === "@") return false;
  const stripped = fa.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dyhs]/i.test(stripped) || /(^|[^0#])m/i.test(stripped);
}

export function cellNumber(cell: Cell): number | null {
  const v = cellScalar(cell);
  return typeof v === "number" ? v : null;
}

export function gridCell(grid: Grid, r: number, c: number): Cell {
  return grid[r]?.[c] ?? null;
}

/** Last row/column that holds a value (−1 when the grid is empty). */
export function gridExtent(grid: Grid): { rows: number; cols: number } {
  let rows = -1;
  let cols = -1;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (cellScalar(row[c]) !== null) {
        if (r > rows) rows = r;
        if (c > cols) cols = c;
      }
    }
  }
  return { rows, cols };
}

// ---- 1900 date system -------------------------------------------------------

const DAY_MS = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);

export interface DateParts {
  y: number;
  m: number; // 1..12
  d: number;
  hh: number;
  mm: number;
  ss: number;
  /** 0 = Sunday */
  dow: number;
}

/** Excel serial → calendar parts (keeps the 1900 leap-year bug: serial 60 is 29 Feb 1900). */
export function serialToParts(serial: number): DateParts {
  let day = Math.floor(serial);
  let frac = serial - day;
  // Round to the nearest second so 0.1 days does not become 2:23:59.
  let secs = Math.round(frac * 86400);
  if (secs >= 86400) {
    day += 1;
    secs -= 86400;
  }
  frac = secs;
  const hh = Math.floor(frac / 3600);
  const mm = Math.floor((frac % 3600) / 60);
  const ss = frac % 60;
  const dow = ((day - 1) % 7 + 7) % 7;
  if (day === 60) return { y: 1900, m: 2, d: 29, hh, mm, ss, dow };
  const ms = day < 60 ? Date.UTC(1899, 11, 31) + day * DAY_MS : EPOCH + day * DAY_MS;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh, mm, ss, dow };
}

/** Calendar parts → Excel serial. Month may overflow (13 → January next year). */
export function partsToSerial(y: number, m: number, d: number, hh = 0, mi = 0, ss = 0): number {
  const frac = (hh * 3600 + mi * 60 + ss) / 86400;
  if (y === 1900 && m === 2 && d === 29) return 60 + frac;
  const t = Date.UTC(y, m - 1, d);
  let day = Math.round((t - EPOCH) / DAY_MS);
  // Dates before 1 March 1900 sit one lower (Excel counts a fake 29 Feb 1900).
  if (day < 61) day -= 1;
  return day + frac;
}

/** Today's serial (midnight) for a JS Date. */
export function dateToSerial(dt: Date): number {
  return partsToSerial(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// ---- typed input ------------------------------------------------------------

export interface ParsedInput {
  v: number | string | boolean | null;
  /** FortuneSheet cell type: n number, d date/time, b boolean, s text, g empty. */
  t: "n" | "d" | "b" | "s" | "g";
  fa?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parses text the way a cell parses typed input (en-US): numbers (with
 * thousands separators, %, leading $), TRUE/FALSE, m/d/yyyy dates with an
 * optional time, yyyy-mm-dd, d-mmm-yyyy, and h:mm[:ss] [AM|PM] times.
 */
export function parseInput(text: string): ParsedInput {
  const s = text.trim();
  if (s === "") return { v: null, t: "g" };
  if (/^(true|false)$/i.test(s)) return { v: /^true$/i.test(s), t: "b" };
  const num = parseNumberText(s);
  if (num !== null) return { v: num.v, t: "n", fa: num.fa };
  const dt = parseDateTimeText(s);
  if (dt !== null) return { v: dt.serial, t: "d", fa: dt.fa };
  return { v: s, t: "s" };
}

export function parseNumberText(s: string): { v: number; fa: string } | null {
  let t = s.trim();
  let fa = "General";
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.startsWith("$")) {
    t = t.slice(1);
    fa = "$#,##0.00";
  }
  let pct = false;
  if (t.endsWith("%")) {
    pct = true;
    t = t.slice(0, -1);
    fa = "0%";
  }
  if (/^[+-]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][+-]?\d+)?$/.test(t) && /\d/.test(t)) {
    let n = Number(t.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    if (pct) n /= 100;
    if (neg) n = -n;
    return { v: n, fa };
  }
  return null;
}

export function parseTimeText(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(am|pm|a|p)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  if (m[4]) {
    const pm = /^p/i.test(m[4]);
    if (h > 12) return null;
    if (h === 12) h = 0;
    if (pm) h += 12;
  }
  if (mi > 59 || sec >= 60) return null;
  return (h * 3600 + mi * 60 + sec) / 86400;
}

export function parseDateTimeText(s: string): { serial: number; fa: string } | null {
  const t = s.trim();
  const time = parseTimeText(t);
  if (time !== null) return { serial: time, fa: "h:mm" };
  // Split an optional trailing time.
  const sp = t.match(/^(\S+(?:\s+\S+\s+\S+)?)\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m?)?)$/i);
  let datePart = t;
  let timeFrac = 0;
  let fa = "m/d/yyyy";
  if (sp) {
    const tf = parseTimeText(sp[2]);
    if (tf !== null) {
      datePart = sp[1];
      timeFrac = tf;
      fa = "m/d/yyyy h:mm";
    }
  }
  let y: number, mo: number, d: number;
  let mt = datePart.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (mt) {
    mo = Number(mt[1]);
    d = Number(mt[2]);
    y = Number(mt[3]);
    if (mt[3].length === 2) y += y < 30 ? 2000 : 1900;
  } else if ((mt = datePart.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/))) {
    y = Number(mt[1]);
    mo = Number(mt[2]);
    d = Number(mt[3]);
  } else if ((mt = datePart.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s,]*(\d{4})$/))) {
    d = Number(mt[1]);
    mo = MONTHS.indexOf(mt[2].slice(0, 3).toLowerCase()) + 1;
    y = Number(mt[3]);
  } else if ((mt = datePart.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/))) {
    mo = MONTHS.indexOf(mt[1].slice(0, 3).toLowerCase()) + 1;
    d = Number(mt[2]);
    y = Number(mt[3]);
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 9999) return null;
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > dim && !(y === 1900 && mo === 2 && d === 29)) return null;
  return { serial: partsToSerial(y, mo, d) + timeFrac, fa };
}

/** Builds a cell object as if `input` had been typed into it. */
export function typedCell(input: unknown): Cell {
  if (input == null || input === "") return null;
  if (typeof input === "number") return { v: input, m: String(input), ct: { fa: "General", t: "n" } };
  if (typeof input === "boolean") return { v: input, m: input ? "TRUE" : "FALSE", ct: { fa: "General", t: "b" } };
  const s = String(input);
  if (s.startsWith("=")) return { f: s, v: "", m: "" };
  const p = parseInput(s);
  if (p.t === "n") return { v: p.v, m: s, ct: { fa: p.fa ?? "General", t: "n" } };
  if (p.t === "d") return { v: p.v, m: s, ct: { fa: p.fa ?? "m/d/yyyy", t: "d" } };
  if (p.t === "b") return { v: p.v, m: s.toUpperCase(), ct: { fa: "General", t: "b" } };
  return { v: s, m: s, ct: { fa: "General", t: "g" } };
}

/** Builds a grid from rows of typed input (strings, numbers, booleans, null). */
export function gridFromRows(rows: unknown[][]): Grid {
  return rows.map((row) => row.map((x) => typedCell(x)));
}

// ---- colours ----------------------------------------------------------------

/** Normalises "#abc", "#aabbcc", "rgb(r,g,b)" to lower-case "#rrggbb" (null when unparseable). */
export function normColor(c: unknown): string | null {
  if (typeof c !== "string" || !c) return null;
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return "#" + m[1].split("").map((x) => x + x).join("");
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return "#" + m[1];
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  m = s.match(/^([0-9a-f]{6})$/);
  if (m) return "#" + m[1];
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = normColor(hex) ?? "#000000";
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}

/** Linear blend of two colours; t = 0 gives a, t = 1 gives b. */
export function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

// ---- A1 addresses -------------------------------------------------------------

export function colToLetters(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function lettersToCol(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface A1Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** Parses "A1", "$A$1:$C$3", "B:B", "2:4" into a 0-based rectangle (whole rows/cols span the sheet max). */
export function parseA1Range(ref: string, maxRow = 1048575, maxCol = 16383): A1Rect | null {
  const s = ref.trim().replace(/^=/, "").replace(/^.*!/, "").replace(/\$/g, "").toUpperCase();
  let m = s.match(/^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/);
  if (m) {
    const c1 = lettersToCol(m[1]);
    const r1 = Number(m[2]) - 1;
    const c2 = m[3] ? lettersToCol(m[3]) : c1;
    const r2 = m[4] ? Number(m[4]) - 1 : r1;
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  }
  m = s.match(/^([A-Z]{1,3}):([A-Z]{1,3})$/);
  if (m) {
    const a = lettersToCol(m[1]);
    const b = lettersToCol(m[2]);
    return { r1: 0, c1: Math.min(a, b), r2: maxRow, c2: Math.max(a, b) };
  }
  m = s.match(/^(\d+):(\d+)$/);
  if (m) {
    const a = Number(m[1]) - 1;
    const b = Number(m[2]) - 1;
    return { r1: Math.min(a, b), c1: 0, r2: Math.max(a, b), c2: maxCol };
  }
  return null;
}

/** "A1" / "A1:C3" for a rectangle; `abs` adds $ signs. */
export function rectToA1(r: A1Rect, abs = false): string {
  const d = abs ? "$" : "";
  const a = `${d}${colToLetters(r.c1)}${d}${r.r1 + 1}`;
  if (r.r1 === r.r2 && r.c1 === r.c2) return a;
  return `${a}:${d}${colToLetters(r.c2)}${d}${r.r2 + 1}`;
}
