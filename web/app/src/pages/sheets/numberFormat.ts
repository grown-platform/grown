// Number formats for the Sheets editor: rendering spreadsheet format codes
// ("#,##0.00", "0%", "m/d/yyyy", "[h]:mm", "_($* #,##0_)" …) and parsing
// typed input ("1,234", "12%", "$5", "(3)", "1 1/2", "Jan 15, 2023", "14:30").
//
// Pure functions, no DOM and no FortuneSheet. The Go engine carries a port of
// the same code (internal/sheets/numfmt.go) for TEXT() and the display text of
// computed cells; both are tested from the same fixtures in
// internal/sheets/testdata/numfmt/. Keep the two in step.
//
// Behaviour follows Excel's format-code rules, checked against the behaviour
// recorded in the OnlyOffice suites (see docs/plans/onlyoffice-parity/sheets.md
// §M6). Serial numbers use the 1900 date system by default, including its
// fictitious 1900-02-29 (serial 60); the 1904 system is an option.

// ---------------------------------------------------------------------------
// Calendar and serial numbers

export interface DateOptions {
  /** Workbook uses the 1904 date system (serial 0 = 1904-01-01). */
  date1904?: boolean;
}

const DAY_MS = 86400000;
const EPOCH_1900 = Date.UTC(1899, 11, 30); // serial 0 for dates after 1900-02-28
const EPOCH_1904 = Date.UTC(1904, 0, 1);
/** The largest serial Excel displays: 9999-12-31 23:59:59.999. */
export const MAX_SERIAL = 2958465.99999999;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days in month `m0` (0-based) of year `y`. */
export function daysInMonth(y: number, m0: number): number {
  return m0 === 1 && isLeapYear(y) ? 29 : MONTH_DAYS[m0];
}

/** isValidDay reports whether day `d` exists in month `m0` (0-based) of `y`. */
export function isValidDay(y: number, m0: number, d: number): boolean {
  if (m0 < 0 || m0 > 11 || !Number.isInteger(d)) return false;
  return d >= 1 && d <= daysInMonth(y, m0);
}

/**
 * isValidDate reports whether a date can be a spreadsheet serial: 1900-01-01
 * to 9999-12-31, plus 1899-12-31 (serial 0) and the fictitious 1900-02-29
 * that the 1900 date system inherited from Lotus 1-2-3.
 */
export function isValidDate(y: number, m0: number, d: number): boolean {
  if (y === 1899 && m0 === 11 && d === 31) return true;
  if (y === 1900 && m0 === 1 && d === 29) return true;
  if (y < 1900 || y > 9999) return false;
  return isValidDay(y, m0, d);
}

/** isValidDatePDF is isValidDate without the 1900 floor (PDF form fields). */
export function isValidDatePDF(y: number, m0: number, d: number): boolean {
  if (y < 1 || y > 9999) return false;
  return isValidDay(y, m0, d);
}

/** Serial number of a calendar date (no time). */
export function dateToSerial(y: number, m0: number, d: number, opts: DateOptions = {}): number {
  const ms = utc(y, m0, d);
  if (opts.date1904) return Math.round((ms - EPOCH_1904) / DAY_MS);
  if (y === 1900 && m0 === 1 && d === 29) return 60;
  const serial = Math.round((ms - EPOCH_1900) / DAY_MS);
  // Before 1900-03-01 the 1900 system is one day behind the real calendar.
  return serial <= 60 ? serial - 1 : serial;
}

/** Date.UTC for any year (Date.UTC maps years 0-99 to 1900-1999). */
function utc(y: number, m0: number, d: number): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, m0, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getTime();
}

export interface DateParts {
  y: number;
  /** 1-12 */
  m: number;
  /** 0-31; 0 only for serial 0 in the 1900 system ("1900-01-00"). */
  d: number;
  /** Day of week, 0 = Sunday. */
  wd: number;
}

/** Calendar date of the whole-day part of a serial number. */
export function serialToDate(serial: number, opts: DateOptions = {}): DateParts {
  const n = Math.floor(serial);
  if (opts.date1904) {
    const dt = new Date(EPOCH_1904 + n * DAY_MS);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
  }
  // 1900 system: serial 1 is 1900-01-01 (a "Sunday"), 60 is 1900-02-29.
  const wd = (((n + 6) % 7) + 7) % 7;
  if (n === 0) return { y: 1900, m: 1, d: 0, wd };
  if (n === 60) return { y: 1900, m: 2, d: 29, wd };
  const dt = new Date(EPOCH_1900 + (n < 60 ? n + 1 : n) * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ---------------------------------------------------------------------------
// Decimal helpers. Numbers are rendered from their 15-significant-digit
// decimal form, like Excel, so 0.575 rounds to 0.58 and 1E+187 prints all its
// zeros.

interface Dec {
  /** Significant digits, no leading or trailing zeros ("" for 0). */
  ds: string;
  /** Position of the decimal point: value = 0.ds × 10^pt. */
  pt: number;
}

function toDec(a: number): Dec {
  if (a === 0 || !Number.isFinite(a)) return { ds: "", pt: 0 };
  const s = Math.abs(a).toExponential(14); // d.dddddddddddddde±x
  const e = s.indexOf("e");
  let ds = s[0] + s.slice(2, e);
  const exp = parseInt(s.slice(e + 1), 10);
  ds = ds.replace(/0+$/, "");
  return { ds, pt: exp + 1 };
}

/**
 * Round a decimal to `decimals` places (half away from zero) and split it into
 * integer digits (no leading zeros, "" for zero) and exactly `decimals`
 * fraction digits.
 */
function roundDec(x: Dec, decimals: number): { int: string; frac: string } {
  const keep = x.pt + decimals; // digits of ds kept
  let digits: string;
  let pt = x.pt;
  if (x.ds === "" || keep < 0) {
    digits = "";
    pt = 0;
  } else {
    digits = x.ds.slice(0, keep).padEnd(keep, "0");
    if (x.ds.length > keep && x.ds.charCodeAt(keep) >= 53 /* '5' */) {
      // increment
      const arr = digits.split("");
      let i = arr.length - 1;
      for (; i >= 0; i--) {
        if (arr[i] === "9") arr[i] = "0";
        else {
          arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1);
          break;
        }
      }
      digits = arr.join("");
      if (i < 0) {
        digits = "1" + digits;
        pt += 1;
      }
    }
  }
  // digits now covers places from 10^(pt-1) down to 10^-decimals.
  const intLen = pt;
  let int: string;
  let frac: string;
  if (intLen <= 0) {
    int = "";
    frac = "0".repeat(Math.min(-intLen, decimals)) + digits;
  } else {
    int = digits.slice(0, intLen).padEnd(intLen, "0");
    frac = digits.slice(intLen);
  }
  frac = frac.padEnd(decimals, "0").slice(0, decimals);
  int = int.replace(/^0+/, "");
  return { int, frac };
}

/** Clean a float to 15 significant digits (0.1 + 0.2 → 0.3). */
function clean15(a: number): number {
  if (a === 0 || !Number.isFinite(a)) return a;
  return Number(a.toPrecision(15));
}

// ---------------------------------------------------------------------------
// General format

/**
 * Excel's General number format: up to 11 characters (sign not counted),
 * switching to scientific notation (1.23457E+11, 1.23457E-05) for numbers
 * that do not fit.
 */
export function formatGeneral(v: number): string {
  if (!Number.isFinite(v)) return "#NUM!";
  if (v === 0) return "0";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const x = toDec(a);
  const e10 = x.pt - 1; // exponent of the leading digit
  if (e10 >= -4 && e10 <= 10) {
    const decimals = a >= 1 ? Math.max(0, 10 - x.pt) : 9;
    const r = roundDec(x, decimals);
    const int = r.int || "0";
    if (int.length <= 11) {
      const frac = r.frac.replace(/0+$/, "");
      return sign + (frac ? `${int}.${frac}` : int);
    }
  }
  return sign + sci(x, 5);
}

/** d.ddddE±xx with at most `decimals` mantissa decimals, trailing zeros stripped. */
function sci(x: Dec, decimals: number): string {
  let exp = x.pt - 1;
  const r = roundDec({ ds: x.ds, pt: 1 }, decimals);
  let int = r.int || "0";
  if (int.length > 1) {
    // 9.999995 → 10.0000
    int = int.slice(0, 1);
    exp += 1;
  }
  const frac = r.frac.replace(/0+$/, "");
  const e = Math.abs(exp).toString().padStart(2, "0");
  return `${int}${frac ? "." + frac : ""}E${exp < 0 ? "-" : "+"}${e}`;
}

// ---------------------------------------------------------------------------
// Format code parsing

type DigitChar = "0" | "#" | "?";

export type Tok =
  | { t: "lit"; s: string }
  | { t: "skip"; s: string } // _x: a space as wide as x
  | { t: "fill"; s: string } // *x: repeat x to fill the cell
  | { t: "dig"; c: DigitChar }
  | { t: "dot" }
  | { t: "comma" }
  | { t: "pct" }
  | { t: "exp"; s: string }
  | { t: "expsign"; plus: boolean }
  | { t: "escE"; s: string } // an "E" that becomes the exponent if a sign follows
  | { t: "pm"; s: string } // a bare "+" or "-" (text, or an exponent sign)
  | { t: "slash" }
  | { t: "at" }
  | { t: "gen" }
  | { t: "date"; k: "y" | "m" | "d" | "h" | "s" | "M" | "a"; n: number }
  | { t: "elapsed"; k: "h" | "m" | "s"; n: number }
  | { t: "ampm"; s: string }
  | { t: "sub"; n: number };

export interface Condition {
  op: "<" | ">" | "=" | "<=" | ">=" | "<>";
  v: number;
}

export interface Section {
  toks: Tok[];
  color?: string;
  cond?: Condition;
  kind: "num" | "date" | "text" | "empty";
}

const COLORS = new Set(["black", "blue", "cyan", "green", "magenta", "red", "white", "yellow"]);

const cache = new Map<string, Section[]>();

/** Parse a format code into its sections (cached). */
export function parseFormat(code: string): Section[] {
  let s = cache.get(code);
  if (!s) {
    s = splitSections(code).map(parseSection);
    if (cache.size > 500) cache.clear();
    cache.set(code, s);
  }
  return s;
}

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      const j = code.indexOf('"', i + 1);
      const end = j < 0 ? code.length : j;
      cur += code.slice(i, end + 1);
      i = end;
    } else if (c === "\\" || c === "_" || c === "*") {
      cur += code.slice(i, i + 2);
      i++;
    } else if (c === "[") {
      const j = code.indexOf("]", i);
      const end = j < 0 ? code.length : j;
      cur += code.slice(i, end + 1);
      i = end;
    } else if (c === ";") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const COND_RE = /^(<=|>=|<>|<|>|=)\s*(-?\d*\.?\d+(?:[eE][+-]?\d+)?)$/;

function parseSection(src: string): Section {
  const toks: Tok[] = [];
  const sec: Section = { toks, kind: "num" };
  const lit = (s: string) => {
    const last = toks[toks.length - 1];
    if (last && last.t === "lit") last.s += s;
    else toks.push({ t: "lit", s });
  };
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const lc = c.toLowerCase();
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      const end = j < 0 ? src.length : j;
      if (end > i + 1) lit(src.slice(i + 1, end));
      i = end + 1;
    } else if (c === "\\") {
      if (src[i + 1] === "E" || src[i + 1] === "e") toks.push({ t: "escE", s: src[i + 1] });
      else if (i + 1 < src.length) lit(src[i + 1]);
      i += 2;
    } else if (c === "_") {
      if (i + 1 < src.length) toks.push({ t: "skip", s: src[i + 1] });
      i += 2;
    } else if (c === "*") {
      if (i + 1 < src.length) toks.push({ t: "fill", s: src[i + 1] });
      i += 2;
    } else if (c === "[") {
      const j = src.indexOf("]", i);
      const end = j < 0 ? src.length : j;
      const body = src.slice(i + 1, end);
      i = end + 1;
      const lb = body.toLowerCase();
      const cm = COND_RE.exec(body.trim());
      if (cm) sec.cond = { op: cm[1] as Condition["op"], v: parseFloat(cm[2]) };
      else if (COLORS.has(lb) || /^color\s*\d+$/.test(lb)) sec.color = body;
      else if (/^(h+|m+|s+)$/.test(lb)) toks.push({ t: "elapsed", k: lb[0] as "h" | "m" | "s", n: lb.length });
      else if (body.startsWith("$")) {
        const sym = body.slice(1).split("-")[0];
        if (sym) lit(sym);
      }
      // other bracket codes ([DBNum1], [natnum], …) are ignored
    } else if (src.slice(i, i + 7).toLowerCase() === "general") {
      toks.push({ t: "gen" });
      i += 7;
    } else if (c === "0" || c === "#" || c === "?") {
      toks.push({ t: "dig", c });
      i++;
    } else if (c === ".") {
      toks.push({ t: "dot" });
      i++;
    } else if (c === ",") {
      toks.push({ t: "comma" });
      i++;
    } else if (c === "%") {
      toks.push({ t: "pct" });
      i++;
    } else if ((c === "E" || c === "e") && (src[i + 1] === "+" || src[i + 1] === "-")) {
      toks.push({ t: "exp", s: c }, { t: "expsign", plus: src[i + 1] === "+" });
      i += 2;
    } else if (c === "E" || c === "e") {
      toks.push({ t: "escE", s: c });
      i++;
    } else if (c === "+" || c === "-") {
      toks.push({ t: "pm", s: c });
      i++;
    } else if (c === "/") {
      toks.push({ t: "slash" });
      i++;
    } else if (c === "@") {
      toks.push({ t: "at" });
      i++;
    } else if (src.slice(i, i + 5).toLowerCase() === "am/pm") {
      toks.push({ t: "ampm", s: src.slice(i, i + 5) });
      i += 5;
    } else if (src.slice(i, i + 3).toLowerCase() === "a/p") {
      toks.push({ t: "ampm", s: src.slice(i, i + 3) });
      i += 3;
    } else if ("ymdhs".includes(lc) || (lc === "a" && /^aaa/i.test(src.slice(i)))) {
      let j = i;
      while (j < src.length && src[j].toLowerCase() === lc) j++;
      toks.push({ t: "date", k: lc as "y" | "m" | "d" | "h" | "s" | "a", n: j - i });
      i = j;
    } else {
      lit(c);
      i++;
    }
  }
  classify(sec);
  return sec;
}

function classify(sec: Section) {
  const toks = sec.toks;
  const isDate = toks.some((t) => t.t === "date" || t.t === "elapsed" || t.t === "ampm");
  if (isDate) {
    sec.kind = "date";
    // A "." followed by zeros after seconds is a fraction of a second; any
    // other "." or digit is literal text in a date section.
    const out: Tok[] = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === "dot") {
        let n = 0;
        while (toks[i + 1 + n]?.t === "dig" && (toks[i + 1 + n] as { c: string }).c === "0") n++;
        if (n > 0) {
          out.push({ t: "sub", n });
          i += n;
          continue;
        }
        out.push({ t: "lit", s: "." });
      } else if (t.t === "dig") out.push({ t: "lit", s: t.c });
      else if (t.t === "comma") out.push({ t: "lit", s: "," });
      else if (t.t === "pct") out.push({ t: "lit", s: "%" });
      else if (t.t === "slash") out.push({ t: "lit", s: "/" });
      else if (t.t === "exp" || t.t === "escE" || t.t === "pm") out.push({ t: "lit", s: t.s });
      else if (t.t === "expsign") out.push({ t: "lit", s: t.plus ? "+" : "-" });
      else out.push(t);
    }
    sec.toks = out;
    resolveMinutes(out);
    return;
  }
  sec.toks = markExponent(toks);
  const hasDigits = toks.some((t) => t.t === "dig" || t.t === "gen");
  if (!hasDigits && toks.some((t) => t.t === "at")) sec.kind = "text";
  else if (!hasDigits && toks.length === 0) sec.kind = "empty";
  else sec.kind = "num";
  // Date letters never appear here; a lone unquoted letter in a number
  // section is literal text (tokenised as such already).
}

/**
 * An "E" (escaped or not) followed by a sign before the next digit placeholder
 * starts an exponent, as in "0\\E!-0". Other "E"s are literal text.
 */
function markExponent(toks: Tok[]): Tok[] {
  const lit = (t: Tok): Tok => (t.t === "escE" || t.t === "pm" ? { t: "lit", s: t.s } : t);
  if (toks.some((t) => t.t === "exp")) return mergeLits(toks.map(lit));
  const i = toks.findIndex((t) => t.t === "escE");
  if (i < 0) return mergeLits(toks.map(lit));
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (t.t === "dig") break;
    if (t.t !== "pm") continue;
    const e = toks[i] as { s: string };
    return mergeLits([
      ...toks.slice(0, i).map(lit),
      { t: "exp", s: e.s },
      ...toks.slice(i + 1, j).map(lit),
      { t: "expsign", plus: t.s === "+" },
      ...toks.slice(j + 1).map(lit),
    ]);
  }
  return mergeLits(toks.map(lit));
}

function mergeLits(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const t of toks) {
    const last = out[out.length - 1];
    if (t.t === "lit" && last?.t === "lit") out[out.length - 1] = { t: "lit", s: last.s + t.s };
    else out.push(t);
  }
  return out;
}

/**
 * Decide which "m"/"mm" tokens are minutes: one right after an hour (or an
 * unpaired seconds) token, or one followed by seconds. Everything else is a
 * month.
 */
function resolveMinutes(toks: Tok[]) {
  const idx: number[] = [];
  toks.forEach((t, i) => {
    if (t.t === "date" || t.t === "elapsed") idx.push(i);
  });
  let pending = false; // an hour/seconds token waits for its minutes
  let prevMinute = false;
  for (let j = 0; j < idx.length; j++) {
    const t = toks[idx[j]] as Extract<Tok, { t: "date" } | { t: "elapsed" }>;
    if (t.t === "elapsed") {
      if (t.k === "h") pending = true;
      prevMinute = false;
      continue;
    }
    if (t.k === "h") {
      pending = true;
      prevMinute = false;
    } else if (t.k === "s") {
      if (!prevMinute) pending = true;
      prevMinute = false;
    } else if (t.k === "m" && t.n <= 2) {
      const next = idx[j + 1] !== undefined ? (toks[idx[j + 1]] as { t: string; k: string }) : null;
      const nextIsSec = !!next && next.t === "date" && next.k === "s";
      if (pending || nextIsSec) {
        (t as { k: string }).k = "M";
        prevMinute = true;
      } else prevMinute = false;
      pending = false;
    } else {
      prevMinute = false;
      if (t.k === "m") pending = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering

export interface Run {
  text: string;
  /** "skip": `_x`, a space as wide as the text. "fill": `*x`, repeat to fill. */
  kind?: "skip" | "fill";
}

export interface Rendered {
  runs: Run[];
  color?: string;
}

/** Sections that format numbers (a trailing text-only section is excluded). */
function numberSections(secs: Section[]): Section[] {
  const out = secs.slice(0, 3);
  while (out.length > 1 && out[out.length - 1].kind === "text") out.pop();
  return out;
}

function testCond(c: Condition, v: number): boolean {
  switch (c.op) {
    case "<":
      return v < c.v;
    case ">":
      return v > c.v;
    case "=":
      return v === c.v;
    case "<=":
      return v <= c.v;
    case ">=":
      return v >= c.v;
    case "<>":
      return v !== c.v;
  }
}

/** A condition that only negative numbers meet prints them without a sign. */
function condIsNegative(c: Condition): boolean {
  return ((c.op === "<" || c.op === "<=") && c.v <= 0) || (c.op === "=" && c.v < 0);
}

/**
 * Pick the section for a number. Returns the section and whether a minus sign
 * must be printed for a negative value, or null when no section applies.
 */
function pickSection(secs: Section[], v: number): { sec: Section; minus: boolean } | null {
  const nums = numberSections(secs);
  if (!nums.some((s) => s.cond)) {
    if (nums.length === 1 || v > 0 || (v === 0 && nums.length === 2)) return { sec: nums[0], minus: v < 0 };
    if (v < 0) return { sec: nums[1], minus: false };
    return { sec: nums[2] ?? nums[0], minus: false };
  }
  // Conditional sections: explicit conditions are tested in order; a section
  // without one takes the usual role (>0 / <0 / everything else).
  const n = nums.length;
  for (let i = 0; i < n; i++) {
    const s = nums[i];
    let cond = s.cond;
    let implicitNeg = false;
    if (!cond) {
      if (i === 0) cond = n >= 3 ? { op: ">", v: 0 } : { op: ">=", v: 0 };
      else if (i === 1 && n >= 3) {
        cond = { op: "<", v: 0 };
        implicitNeg = true;
      } else if (i === 1 && !nums[0].cond) {
        cond = { op: "<", v: 0 };
        implicitNeg = true;
      } else return { sec: s, minus: v < 0 };
    }
    if (testCond(cond, v)) {
      if (implicitNeg) return { sec: s, minus: false };
      return { sec: s, minus: v < 0 && !(s.cond && condIsNegative(s.cond)) };
    }
  }
  return null;
}

/** Render a value (number or text) with a format code into text runs. */
export function formatRuns(value: number | string | boolean, code: string, opts: DateOptions = {}): Rendered {
  const secs = parseFormat(code || "General");
  if (typeof value === "boolean") return { runs: [{ text: value ? "TRUE" : "FALSE" }] };
  if (typeof value === "string") {
    const textSec = secs.length >= 4 ? secs[3] : secs.find((s) => s.kind === "text");
    if (!textSec) return { runs: [{ text: value }] };
    return { runs: renderText(textSec, value), color: textSec.color };
  }
  if (!Number.isFinite(value)) return { runs: [{ text: "#NUM!" }] };
  const pick = pickSection(secs, value);
  if (!pick) return { runs: [{ text: "#" }] };
  const { sec, minus } = pick;
  const a = Math.abs(value);
  let runs: Run[];
  if (sec.kind === "date") runs = renderDate(sec, value, opts);
  else if (sec.kind === "text") runs = renderText(sec, formatGeneral(value));
  else runs = renderNumber(sec, a, minus && value < 0);
  return { runs, color: sec.color };
}

/**
 * Display text of a value under a format code: `_x` becomes a space and `*x`
 * fill characters are dropped (a cell's text has no width to fill).
 */
export function formatValue(value: number | string | boolean, code: string, opts: DateOptions = {}): string {
  return formatRuns(value, code, opts)
    .runs.map((r) => (r.kind === "skip" ? " " : r.kind === "fill" ? "" : r.text))
    .join("");
}

/** The runs joined as written (skip and fill characters included once). */
export function runsText(r: Rendered): string {
  return r.runs.map((x) => x.text).join("");
}

function renderText(sec: Section, s: string): Run[] {
  const out: Run[] = [];
  for (const t of sec.toks) {
    if (t.t === "at") out.push({ text: s });
    else if (t.t === "lit") out.push({ text: t.s });
    else if (t.t === "skip") out.push({ text: t.s, kind: "skip" });
    else if (t.t === "fill") out.push({ text: t.s, kind: "fill" });
    else if (t.t === "gen") out.push({ text: s });
  }
  return out;
}

// ---- numbers --------------------------------------------------------------

function renderNumber(sec: Section, a: number, neg: boolean): Run[] {
  const toks = sec.toks;
  if (toks.some((t) => t.t === "gen")) {
    const out: Run[] = neg ? [{ text: "-" }] : [];
    for (const t of toks) {
      if (t.t === "gen") out.push({ text: formatGeneral(a) });
      else pushLiteral(out, t);
    }
    return out;
  }
  const expAt = toks.findIndex((t) => t.t === "exp");
  // "%" multiplies by 100, except in scientific formats where it is text.
  if (expAt >= 0) return renderScientific(toks, expAt, a, neg);
  const pct = toks.filter((t) => t.t === "pct").length;
  let v = a;
  for (let i = 0; i < pct; i++) v *= 100;
  if (pct) v = clean15(v);
  const slash = findFraction(toks);
  if (slash >= 0) return renderFraction(toks, slash, v, neg);
  return renderFixed(toks, v, neg);
}

function pushLiteral(out: Run[], t: Tok) {
  if (t.t === "lit") out.push({ text: t.s });
  else if (t.t === "skip") out.push({ text: t.s, kind: "skip" });
  else if (t.t === "fill") out.push({ text: t.s, kind: "fill" });
  else if (t.t === "pct") out.push({ text: "%" });
  else if (t.t === "at") out.push({ text: "" });
}

const isDig = (t: Tok | undefined): t is { t: "dig"; c: DigitChar } => !!t && t.t === "dig";

/** Fill digit slots right to left; extra digits go to the leftmost slot. */
function fillInt(slots: DigitChar[], digits: string, group: boolean): string[] {
  const out: string[] = new Array(slots.length).fill("");
  if (slots.length === 0) return out;
  // Pad with zeros for "0" slots (and spaces for "?") counted from the right.
  const chars: string[] = [];
  const n = Math.max(digits.length, 0);
  for (let k = 0; k < slots.length; k++) {
    const slot = slots[slots.length - 1 - k];
    if (k < n) chars[k] = digits[digits.length - 1 - k];
    else chars[k] = slot === "0" ? "0" : slot === "?" ? " " : "";
  }
  // Positions of real digit characters (for grouping) are counted from the right.
  const sepAfter = (p: number) => group && p > 0 && p % 3 === 0;
  let pos = 0;
  for (let k = 0; k < slots.length; k++) {
    const idx = slots.length - 1 - k;
    const ch = chars[k];
    let text = ch;
    if (ch !== "" && ch !== " ") {
      if (sepAfter(pos)) text = ch + ",";
      pos++;
    } else if (ch === " ") pos++;
    out[idx] = text;
  }
  if (n > slots.length) {
    let extra = "";
    for (let k = slots.length; k < n; k++) {
      const ch = digits[digits.length - 1 - k];
      extra = ch + (sepAfter(pos) ? "," : "") + extra;
      pos++;
    }
    out[0] = extra + out[0];
  }
  return out;
}

/** Fraction-part digits: trailing zeros vanish for "#", become spaces for "?". */
function fillFrac(slots: DigitChar[], digits: string): string[] {
  const out: string[] = [];
  let trailing = true;
  for (let i = slots.length - 1; i >= 0; i--) {
    const d = digits[i] ?? "0";
    const slot = slots[i];
    if (trailing && d === "0" && slot !== "0") out[i] = slot === "?" ? " " : "";
    else {
      out[i] = d;
      trailing = false;
    }
  }
  return out;
}

function renderFixed(toks: Tok[], v: number, neg: boolean): Run[] {
  // Split digit placeholders at the first decimal point.
  const dotAt = toks.findIndex((t) => t.t === "dot");
  const intEnd = dotAt < 0 ? toks.length : dotAt;
  const intSlots: DigitChar[] = [];
  const fracSlots: DigitChar[] = [];
  toks.forEach((t, i) => {
    if (t.t === "dig") (i < intEnd ? intSlots : fracSlots).push(t.c);
  });
  // Commas: between integer digits → grouping; after the last digit (or just
  // before the decimal point) → divide by 1000 each.
  let group = false;
  let scale = 0;
  const commaRole = new Map<number, "group" | "scale" | "drop" | "lit">();
  const lastDig = toks.reduce((m, t, i) => (t.t === "dig" ? i : m), -1);
  const firstDig = toks.findIndex((t) => t.t === "dig");
  toks.forEach((t, i) => {
    if (t.t !== "comma") return;
    if (firstDig < 0 || i < firstDig) {
      commaRole.set(i, "lit");
      return;
    }
    if (i > lastDig) {
      commaRole.set(i, "scale");
      scale++;
      return;
    }
    if (i < intEnd) {
      // integer part: is there an integer digit after it?
      let digAfter = false;
      for (let j = i + 1; j < intEnd; j++) if (toks[j].t === "dig") digAfter = true;
      if (digAfter) {
        commaRole.set(i, "group");
        group = true;
      } else {
        // run of commas right before the decimal point
        commaRole.set(i, "scale");
        scale++;
      }
      return;
    }
    commaRole.set(i, "drop");
  });
  let x = v;
  for (let i = 0; i < scale; i++) x /= 1000;
  if (scale) x = clean15(x);
  const r = roundDec(toDec(x), fracSlots.length);
  const isZero = r.int === "" && !/[1-9]/.test(r.frac);
  const intCells = fillInt(intSlots, r.int, group);
  const fracCells = fillFrac(fracSlots, r.frac);
  const out: Run[] = neg && !isZero ? [{ text: "-" }] : [];
  let ii = 0;
  let fi = 0;
  toks.forEach((t, i) => {
    if (t.t === "dig") out.push({ text: i < intEnd ? intCells[ii++] : fracCells[fi++] });
    else if (t.t === "dot") {
      // No integer placeholders: the integer digits still print, before the point.
      if (i === dotAt && intSlots.length === 0 && r.int) out.push({ text: groupDigits(r.int, group) });
      out.push({ text: "." });
    }
    else if (t.t === "comma") {
      if (commaRole.get(i) === "lit") out.push({ text: "," });
    } else if (t.t === "exp" || t.t === "slash") out.push({ text: t.t === "slash" ? "/" : t.s });
    else pushLiteral(out, t);
  });
  return out;
}

function groupDigits(d: string, group: boolean): string {
  if (!group) return d;
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function renderScientific(toks: Tok[], expAt: number, v: number, neg: boolean): Run[] {
  const dotAt = toks.findIndex((t, i) => t.t === "dot" && i < expAt);
  const mEnd = dotAt < 0 ? expAt : dotAt;
  // Exponent digits: placeholders after the "E" up to a ".", which (with any
  // placeholders after it) is printed as text.
  const signAt = toks.findIndex((t, i) => t.t === "expsign" && i > expAt);
  const expDot = toks.findIndex((t, i) => t.t === "dot" && i > Math.max(expAt, signAt));
  const expEnd = expDot < 0 ? toks.length : expDot;
  const intSlots: DigitChar[] = [];
  const fracSlots: DigitChar[] = [];
  const expSlots: DigitChar[] = [];
  toks.forEach((t, i) => {
    if (t.t !== "dig") return;
    if (i < mEnd) intSlots.push(t.c);
    else if (i < expAt) fracSlots.push(t.c);
    else if (i < expEnd) expSlots.push(t.c);
  });
  const firstDig = toks.findIndex((t) => t.t === "dig");
  let group = false;
  toks.forEach((t, i) => {
    if (t.t !== "comma" || i >= mEnd || i < firstDig) return;
    for (let j = i + 1; j < mEnd; j++) if (toks[j].t === "dig") group = true;
  });
  const N = intSlots.length;
  const x = toDec(v);
  let exp = 0;
  let mant = { int: "", frac: "0".repeat(fracSlots.length) };
  if (x.ds !== "") {
    const e10 = x.pt - 1;
    exp = N >= 1 ? Math.floor(e10 / N) * N : e10 + 1;
    mant = roundDec({ ds: x.ds, pt: x.pt - exp }, fracSlots.length);
    if (mant.int.length > N) {
      exp += N >= 1 ? N : 1;
      mant = roundDec({ ds: x.ds, pt: x.pt - exp }, fracSlots.length);
    }
  }
  const isZero = mant.int === "" && !/[1-9]/.test(mant.frac);
  const intDigits = mant.int === "" && N >= 1 ? "0" : mant.int;
  // Zero shows every integer placeholder as 0 ("#,#00E+0" → 0,000E+0).
  const intCells = fillInt(x.ds === "" ? intSlots.map(() => "0" as DigitChar) : intSlots, intDigits, group);
  const fracCells = fillFrac(fracSlots, mant.frac);
  const expPad = expSlots.filter((c) => c === "0").length;
  const expStr = String(Math.abs(exp)).padStart(Math.max(expPad, 1), "0");
  const expCells = fillInt(expSlots, expStr, false);
  const minus = exp < 0 ? "-" : "";
  const out: Run[] = neg && !isZero ? [{ text: "-" }] : [];
  let ii = 0;
  let fi = 0;
  let ei = 0;
  let expDone = false;
  const emitExp = () => {
    if (!expDone) out.push({ text: minus + expStr });
    expDone = true;
  };
  toks.forEach((t, i) => {
    if (i < expAt) {
      if (t.t === "dig") out.push({ text: i < mEnd ? intCells[ii++] : fracCells[fi++] });
      else if (t.t === "dot") {
        if (i === dotAt && N === 0 && intDigits) out.push({ text: intDigits });
        out.push({ text: "." });
      } else if (t.t === "comma") {
        if (i < firstDig) out.push({ text: "," });
      } else if (t.t === "pct") out.push({ text: "%" });
      else if (t.t === "slash") out.push({ text: "/" });
      else pushLiteral(out, t);
      return;
    }
    if (t.t === "exp") out.push({ text: t.s });
    else if (t.t === "expsign") {
      if (t.plus && exp >= 0) out.push({ text: "+" });
      if (!expSlots.length && expDot < 0) emitExp();
    } else if (t.t === "dig") {
      if (i < expEnd) {
        if (!expDone) {
          out.push({ text: minus + expCells[ei++] });
          expDone = true;
        } else out.push({ text: expCells[ei++] });
      } else out.push({ text: t.c === "0" ? "0" : t.c === "?" ? " " : "" });
    } else if (t.t === "dot") {
      if (i === expDot) emitExp();
      out.push({ text: "." });
    } else if (t.t === "comma") out.push({ text: "," });
    else if (t.t === "pct") out.push({ text: "%" });
    else if (t.t === "slash") out.push({ text: "/" });
    else pushLiteral(out, t);
  });
  emitExp();
  return out;
}

/** Index of the "/" that makes this a fraction format, or -1. */
function findFraction(toks: Tok[]): number {
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t !== "slash") continue;
    const before = isDig(toks[i - 1]);
    const next = toks[i + 1];
    const after = isDig(next) || (next?.t === "lit" && /^[1-9]\d*/.test(next.s));
    if (before && after) return i;
  }
  return -1;
}

/**
 * Best fraction n/d ≤ maxDen for x in [0, ∞): continued-fraction convergents,
 * plus the last semiconvergent when it is more than halfway along.
 */
export function approxFraction(x: number, maxDen: number): [number, number] {
  let p0 = 0,
    q0 = 1,
    p1 = 1,
    q1 = 0;
  let y = x;
  for (let iter = 0; iter < 64; iter++) {
    const a = Math.floor(y + 1e-9);
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (q2 > maxDen) {
      if (q1 === 0) return [Math.round(x), 1];
      const k = Math.floor((maxDen - q0) / q1);
      if (2 * k > a) return [k * p1 + p0, k * q1 + q0];
      return [p1, q1];
    }
    p0 = p1;
    q0 = q1;
    p1 = p2;
    q1 = q2;
    const f = y - a;
    if (f < 1e-9 || Math.abs(x - p1 / q1) < 1e-12) break;
    y = 1 / f;
  }
  return [p1, q1];
}

function renderFraction(toks: Tok[], slash: number, v: number, neg: boolean): Run[] {
  // numerator: the digit run right before "/"; integer part: digits before that.
  let ns = slash - 1;
  while (ns > 0 && isDig(toks[ns - 1])) ns--;
  const numSlots = toks.slice(ns, slash).map((t) => (t as { c: DigitChar }).c);
  const intIdx: number[] = [];
  for (let i = 0; i < ns; i++) if (toks[i].t === "dig") intIdx.push(i);
  const intSlots = intIdx.map((i) => (toks[i] as { c: DigitChar }).c);
  let de = slash + 1;
  let fixedDen = 0;
  const denSlots: DigitChar[] = [];
  const next = toks[slash + 1];
  let fixedRest = "";
  if (next && next.t === "lit") {
    const m = /^([1-9]\d*)(.*)$/s.exec(next.s)!;
    let den = m[1];
    fixedRest = m[2];
    de = slash + 2;
    // "?/1000": the zeros after the literal "1" are placeholders in the code.
    if (!fixedRest) {
      while (toks[de]?.t === "dig" && (toks[de] as { c: string }).c === "0") {
        den += "0";
        de++;
      }
    }
    fixedDen = parseInt(den, 10);
  } else {
    while (isDig(toks[de])) denSlots.push((toks[de++] as { c: DigitChar }).c);
  }
  const hasInt = intSlots.length > 0;
  const dec = roundDec(toDec(v), 12);
  let whole = hasInt ? parseInt(dec.int || "0", 10) : 0;
  const frac = hasInt ? Number("0." + dec.frac) : v;
  let n: number;
  let d: number;
  if (fixedDen) {
    n = Math.round(clean15(frac * fixedDen));
    d = fixedDen;
  } else {
    const maxDen = Math.pow(10, denSlots.length) - 1;
    [n, d] = approxFraction(frac, maxDen);
  }
  if (hasInt && n === d && d > 0) {
    whole += 1;
    n = 0;
  }
  const isZero = whole === 0 && n === 0;
  const out: Run[] = neg && !isZero ? [{ text: "-" }] : [];
  if (hasInt && n === 0) {
    // No fraction to show: the integer part and the text before the numerator.
    const cells = fillInt(intSlots, whole === 0 ? "0" : String(whole), false);
    let ii = 0;
    for (let i = 0; i < ns; i++) {
      const t = toks[i];
      if (t.t === "dig") out.push({ text: cells[ii++] });
      else if (whole !== 0) {
        if (t.t === "comma") continue;
        pushLiteral(out, t);
      }
    }
    return out;
  }
  const intCells = fillInt(intSlots, whole === 0 ? "" : String(whole), toks.slice(0, ns).some((t) => t.t === "comma"));
  const numCells = fillInt(numSlots, String(n), false);
  const denStr = String(d);
  const denCells: string[] = [];
  for (let k = 0; k < denSlots.length; k++) {
    if (k < denStr.length) denCells.push(denStr[k]);
    else denCells.push(denSlots[k] === "0" ? "0" : denSlots[k] === "?" ? " " : "");
  }
  if (denStr.length > denSlots.length && denSlots.length) {
    denCells[denSlots.length - 1] += denStr.slice(denSlots.length);
  }
  let ii = 0;
  let ni = 0;
  toks.forEach((t, i) => {
    if (i < ns) {
      if (t.t === "dig") out.push({ text: intCells[ii++] });
      else if (t.t !== "comma") pushLiteral(out, t);
    } else if (i < slash) out.push({ text: numCells[ni++] });
    else if (i === slash) out.push({ text: "/" });
    else if (i < de) {
      if (fixedDen) {
        if (i === slash + 1) out.push({ text: String(fixedDen) + fixedRest });
      }
      else out.push({ text: denCells[i - slash - 1] });
    } else if (t.t === "dig") out.push({ text: "" });
    else if (t.t !== "comma") pushLiteral(out, t);
  });
  return out;
}

// ---- dates and times ------------------------------------------------------

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;

function renderDate(sec: Section, v: number, opts: DateOptions): Run[] {
  if (v < 0 || v > MAX_SERIAL) return [{ text: "#" }];
  const toks = sec.toks;
  const p = toks.reduce((m, t) => (t.t === "sub" ? Math.max(m, Math.min(t.n, 3)) : m), 0);
  const unit = Math.pow(10, p);
  const total = Math.round(clean15(v * 86400 * unit)); // in 10^-p seconds
  const perDay = 86400 * unit;
  const days = Math.floor(total / perDay);
  const rem = total - days * perDay;
  const secs = Math.floor(rem / unit);
  const sub = rem - secs * unit;
  const h = Math.floor(secs / 3600);
  const mi = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const date = serialToDate(days, opts);
  const ampm = toks.some((t) => t.t === "ampm");
  const out: Run[] = [];
  for (const t of toks) {
    switch (t.t) {
      case "date": {
        let text = "";
        switch (t.k) {
          case "y":
            text = t.n <= 2 ? pad2(date.y % 100) : String(date.y).padStart(4, "0");
            break;
          case "m":
            text =
              t.n === 1
                ? String(date.m)
                : t.n === 2
                  ? pad2(date.m)
                  : t.n === 3
                    ? MONTH_NAMES[date.m - 1].slice(0, 3)
                    : t.n === 5
                      ? MONTH_NAMES[date.m - 1][0]
                      : MONTH_NAMES[date.m - 1];
            break;
          case "d":
            text =
              t.n === 1
                ? String(date.d)
                : t.n === 2
                  ? pad2(date.d)
                  : t.n === 3
                    ? DAY_NAMES[date.wd].slice(0, 3)
                    : DAY_NAMES[date.wd];
            break;
          case "a":
            text = t.n === 3 ? DAY_NAMES[date.wd].slice(0, 3) : DAY_NAMES[date.wd];
            break;
          case "h": {
            const hh = ampm ? ((h + 11) % 12) + 1 : h;
            text = t.n === 1 ? String(hh) : pad2(hh);
            break;
          }
          case "M":
            text = t.n === 1 ? String(mi) : pad2(mi);
            break;
          case "s":
            text = t.n === 1 ? String(s) : pad2(s);
            break;
        }
        out.push({ text });
        break;
      }
      case "elapsed": {
        const base = t.k === "h" ? 3600 * unit : t.k === "m" ? 60 * unit : unit;
        const val = Math.floor(total / base);
        out.push({ text: String(val).padStart(t.n, "0") });
        break;
      }
      case "ampm": {
        const pm = h >= 12;
        const short = t.s.length === 3;
        const lower = t.s[0] === t.s[0].toLowerCase() && short;
        let text = short ? (pm ? "P" : "A") : pm ? "PM" : "AM";
        if (lower) text = text.toLowerCase();
        out.push({ text });
        break;
      }
      case "sub": {
        const digits = String(sub).padStart(p, "0").slice(0, t.n).padEnd(t.n, "0");
        out.push({ text: "." + digits });
        break;
      }
      default:
        pushLiteral(out, t);
        if (t.t === "dot") out.push({ text: "." });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Format classification (used by the input parser and the UI)

export type FormatKind =
  | "general"
  | "number"
  | "scientific"
  | "currency"
  | "percent"
  | "fraction"
  | "date"
  | "time"
  | "text";

/** Broad category of a format code. */
export function formatKind(code: string | undefined | null): FormatKind {
  if (!code || /^general$/i.test(code.trim())) return "general";
  const secs = parseFormat(code);
  const s = secs[0];
  if (s.kind === "text") return "text";
  if (s.kind === "date") {
    const dateTok = s.toks.some((t) => t.t === "date" && (t.k === "y" || t.k === "m" || t.k === "d" || t.k === "a"));
    return dateTok ? "date" : "time";
  }
  if (s.toks.some((t) => t.t === "gen")) return "general";
  if (s.toks.some((t) => t.t === "pct")) return "percent";
  if (s.toks.some((t) => t.t === "exp")) return "scientific";
  if (findFraction(s.toks) >= 0) return "fraction";
  if (s.toks.some((t) => (t.t === "lit" && /[$€£¥₽₹]|р\./.test(t.s)) || t.t === "fill")) return "currency";
  return "number";
}

// Built-in formats (Excel ids 0–49) that typed input may replace when it
// clearly means something else (a date typed into a percent cell …).
const REPLACEABLE = new Set([
  "general",
  "0.00e+00",
  "##0.0e+0",
  "0%",
  "0.00%",
  "# ?/?",
  "# ??/??",
  "m/d/yyyy",
  "d-mmm-yy",
  "d-mmm",
  "mmm-yy",
  "h:mm am/pm",
  "h:mm:ss am/pm",
  "h:mm",
  "h:mm:ss",
  "m/d/yyyy h:mm",
  "mm:ss",
  "[h]:mm:ss",
  "mm:ss.0",
]);

// ---------------------------------------------------------------------------
// Typed input

export interface Culture {
  decimal: string;
  group: string;
}

export const EN_US: Culture = { decimal: ".", group: "," };

export interface ParseOptions extends DateOptions {
  /** The cell's current number format; typed input may keep it. */
  cellFormat?: string | null;
  culture?: Culture | null;
  /** Year for dates typed without one (default: the current year). */
  year?: number;
  /** Allow dates before 1900 (PDF form fields). */
  pdf?: boolean;
}

export interface Parsed {
  value: number;
  /** Number format the cell should get (the cell's own when it fits). */
  format: string;
  percent?: boolean;
  currency?: boolean;
  date?: boolean;
  time?: boolean;
}

export const FMT = {
  thousands: "#,##0",
  thousands2: "#,##0.00",
  currency: "\\$#,##0_);[Red](\\$#,##0)",
  currency2: "\\$#,##0.00_);[Red](\\$#,##0.00)",
  percent: "0%",
  percent2: "0.00%",
  fraction1: "# ?/?",
  fraction2: "# ??/??",
  dateShort: "m/d/yyyy",
  dateMedium: "d-mmm",
  dateMonthYear: "mmm-yy",
  dateLong: "d-mmm-yy",
  dateTime: "m/d/yyyy h:mm",
  time: "h:mm",
  timeSec: "h:mm:ss",
  time12: "h:mm AM/PM",
  time12Sec: "h:mm:ss AM/PM",
  elapsed: "[h]:mm:ss",
  scientific: "0.00E+00",
} as const;

const CURRENCY_PREFIX = ["$", "€", "£", "¥", "₽", "₹", "₩", "₪", "₫", "₺", "₴", "¢"];
const CURRENCY_SUFFIX = ["р.", "руб.", "₽", "€", "zł", "kr", "Kč", "Ft", "₴", "лв"];

/** isLocaleNumber: plain decimal number text in the culture ("-123.45"). */
export function isLocaleNumber(s: string, culture?: Culture | null): boolean {
  const c = culture ?? EN_US;
  const re = new RegExp(`^[+-]?(\\d+(${escapeRe(c.decimal)}\\d*)?|${escapeRe(c.decimal)}\\d+)$`);
  return re.test(s);
}

export function parseLocaleNumber(s: string, culture?: Culture | null): number {
  const c = culture ?? EN_US;
  return Number(s.split(c.decimal).join("."));
}

/** strcmp: does `a` contain `b` (from index `bStart`) at `start` for `len` chars? */
export function strcmp(a: string, b: string, start: number, len: number, bStart = 0): boolean {
  if (len <= 0) return false;
  for (let i = 0; i < len; i++) {
    if (a[start + i] === undefined || a[start + i] !== b[bStart + i]) return false;
  }
  return true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse text typed into a cell. Returns null when the text stays text.
 * The result carries the number, the format the cell should use (keeping a
 * compatible existing format) and what kind of value was recognised.
 */
export function parseInput(text: string, opts: ParseOptions = {}): Parsed | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const cellFormat = opts.cellFormat ?? "General";
  if (cellFormat.trim() === "@") return null;
  const cellKind = formatKind(cellFormat);
  const culture = opts.culture ?? EN_US;

  const num = parseNumberText(text, culture);
  if (num) return withFormat(num, cellFormat, cellKind);

  const frac = parseFractionText(text, culture, cellKind);
  if (frac === "text") return null;
  if (frac) return withFormat(frac, cellFormat, cellKind);

  const dt = parseDateTime(text, opts);
  if (dt) return withFormat(dt, cellFormat, cellKind);
  return null;
}

interface Recognised {
  value: number;
  kind: "plain" | "grouped" | "currency" | "percent" | "fraction" | "date" | "time" | "scientific";
  format: string;
  percent?: boolean;
  currency?: boolean;
}

function withFormat(r: Recognised, cellFormat: string, cellKind: FormatKind): Parsed {
  const out: Parsed = { value: r.value, format: cellFormat };
  if (r.percent) out.percent = true;
  if (r.currency) out.currency = true;
  if (r.kind === "date") out.date = true;
  if (r.kind === "time") {
    out.date = true;
    out.time = true;
  }
  const replaceable = REPLACEABLE.has(cellFormat.trim().toLowerCase());
  switch (r.kind) {
    case "plain":
      break;
    case "grouped":
      if (cellKind === "general") out.format = r.format;
      break;
    default: {
      const same =
        (r.kind === "percent" && cellKind === "percent") ||
        (r.kind === "currency" && cellKind === "currency") ||
        (r.kind === "fraction" && cellKind === "fraction") ||
        (r.kind === "scientific" && cellKind === "scientific") ||
        (r.kind === "date" && cellKind === "date") ||
        (r.kind === "time" && cellKind === "time");
      if (!same && replaceable) out.format = r.format;
    }
  }
  return out;
}

/** Split sign, parentheses, currency symbol and percent off a number text. */
function parseNumberText(raw: string, c: Culture): Recognised | null {
  let s = raw.trim();
  let neg = false;
  let paren = false;
  let currency: string | null = null;
  let pct = 0;
  const takeCurrency = (): boolean => {
    for (const sym of CURRENCY_PREFIX) {
      if (s.startsWith(sym)) {
        if (currency) return false;
        currency = sym;
        s = s.slice(sym.length).trim();
        return true;
      }
    }
    return true;
  };
  const takeSign = (): boolean => {
    if (s[0] === "-" || s[0] === "+") {
      if (s[1] === "-" || s[1] === "+") return false;
      if (s[0] === "-") neg = !neg;
      s = s.slice(1).trim();
    }
    return true;
  };
  if (!takeSign()) return null;
  if (!takeCurrency()) return null;
  if (s.startsWith("(")) {
    if (!s.endsWith(")")) return null;
    paren = true;
    s = s.slice(1, -1).trim();
  } else if (s.endsWith(")")) return null;
  if (paren) {
    if (!takeSign()) return null;
    if (!takeCurrency()) return null;
  }
  if (!takeSign()) return null;
  if (s.startsWith("%")) {
    pct++;
    s = s.slice(1).trim();
  }
  for (const sym of CURRENCY_SUFFIX) {
    if (s.endsWith(sym) && s.length > sym.length) {
      if (currency) return null;
      currency = sym;
      s = s.slice(0, -sym.length).trim();
      break;
    }
  }
  if (!currency) {
    for (const sym of CURRENCY_PREFIX) {
      if (s.endsWith(sym)) return null;
    }
  }
  while (s.endsWith("%")) {
    pct++;
    s = s.slice(0, -1).trim();
  }
  if (pct > 1) return null;
  if (/[$€£¥₽]/.test(s)) return null;
  if (paren && neg) return null;
  if (paren) neg = true;
  // Digits with optional grouping, decimal part and exponent.
  const g = escapeRe(c.group);
  const d = escapeRe(c.decimal);
  const re = new RegExp(`^(\\d+(?:${g}\\d+)*)?(?:${d}(\\d*))?(?:[eE]([+-]?\\d+))?$`);
  const m = re.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  if (m[1] === undefined && (m[2] === undefined || m[2] === "")) return null;
  const intPart = (m[1] ?? "").split(c.group).join("");
  const grouped = !!m[1] && m[1].includes(c.group);
  const fracPart = m[2] ?? "";
  const expPart = m[3];
  let value = Number(`${intPart || "0"}.${fracPart || "0"}e${(expPart ? parseInt(expPart, 10) : 0) - pct * 2}`);
  if (neg) value = -value;
  if (!Number.isFinite(value)) return null;
  const hasDecimals = fracPart.replace(/0+$/, "") !== "" || (fracPart !== "" && grouped);
  if (pct) {
    return {
      value,
      kind: "percent",
      percent: true,
      format: fracPart !== "" ? FMT.percent2 : FMT.percent,
      ...(currency ? { currency: true } : {}),
    };
  }
  if (currency) {
    const cur = currency as string;
    const nonInt = !Number.isInteger(Math.round(value * 1e9) / 1e9);
    let format: string;
    if (cur === "$") format = nonInt ? FMT.currency2 : FMT.currency;
    else if (CURRENCY_SUFFIX.includes(cur)) format = `#,##0${nonInt ? ".00" : ""}"${cur}"`;
    else format = `"${cur}"#,##0${nonInt ? ".00" : ""}`;
    return { value, kind: "currency", currency: true, format };
  }
  if (expPart !== undefined) return { value, kind: "scientific", format: FMT.scientific };
  if (grouped) return { value, kind: "grouped", format: hasDecimals || fracPart ? FMT.thousands2 : FMT.thousands };
  return { value, kind: "plain", format: "General" };
}

/**
 * Fractions: "1 1/2", "-$2 3/4", "(100 1/2)", "25 50/100 %". A bare "a/b" is a
 * date in General and date cells ("1/2" → Jan 2) and a fraction in numeric
 * cells; in General it stays text when it is not a date ("15/20").
 * Returns "text" when the input must stay text.
 */
function parseFractionText(raw: string, c: Culture, cellKind: FormatKind): Recognised | "text" | null {
  if (!raw.includes("/")) return null;
  const g = escapeRe(c.group);
  const mixed = new RegExp(`^([+-]?)(\\(?)\\s*([$€£¥₽]?)\\s*(\\d+(?:${g}\\d{3})*)\\s+(\\d+)/(\\d+)\\s*(\\)?)\\s*(%?)$`).exec(raw.trim());
  if (mixed) {
    const [, sign, open, cur, wholeTxt, numTxt, denTxt, close, pctTxt] = mixed;
    if (!!open !== !!close) return "text";
    if (raw !== raw.trimStart() && !raw.trimStart().match(/^\d/)) return "text";
    const den = parseInt(denTxt, 10);
    if (den === 0) return "text";
    const whole = parseInt(wholeTxt.split(c.group).join(""), 10);
    let value = whole + parseInt(numTxt, 10) / den;
    if (sign === "-" || open) value = -value;
    if (pctTxt) {
      value = value / 100;
      return { value, kind: "percent", percent: true, format: FMT.percent2 };
    }
    void cur;
    return { value, kind: "fraction", format: denTxt.length > 1 ? FMT.fraction2 : FMT.fraction1 };
  }
  const simple = /^([+-]?)(\d+)\/(\d+)$/.exec(raw);
  if (!simple) return null;
  const numeric = cellKind !== "general" && cellKind !== "date" && cellKind !== "time" && cellKind !== "text";
  if (!numeric) {
    if (simple[1]) return "text";
    return null; // General/date cells: try it as a date ("1/2" → Jan 2)
  }
  const n = parseInt(simple[2], 10);
  const d = parseInt(simple[3], 10);
  if (d === 0) return "text";
  let value = n / d;
  if (simple[1] === "-") value = -value;
  return { value, kind: "fraction", format: simple[3].length > 1 ? FMT.fraction2 : FMT.fraction1 };
}

const MONTHS_LC = MONTH_NAMES.map((m) => m.toLowerCase());

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  const i = MONTHS_LC.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w) && (w.length === 3 || m === w)));
  if (i >= 0) return i;
  if (w === "sept") return 8;
  return -1;
}

function fullYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length <= 2) return n < 30 ? 2000 + n : 1900 + n;
  return n;
}

interface TimeParts {
  seconds: number;
  hasSec: boolean;
  ampm: boolean;
  elapsed: boolean;
}

/** "11:34:56", "11:34", "11:", "2:30 PM", "55:34" (elapsed), "11:34:56.5". */
function parseTime(s: string, allowElapsed: boolean): TimeParts | null {
  const m = /^(\d{1,})\s*:\s*(\d{0,2})(?:\s*:\s*(\d{0,2}(?:\.\d+)?))?\s*(am|pm|a|p)?$/i.exec(s.trim());
  if (!m) {
    const h = /^(\d{1,2})\s*(am|pm|a|p)$/i.exec(s.trim());
    if (!h) return null;
    let hr = parseInt(h[1], 10);
    if (hr > 12) return null;
    const pm = h[2][0].toLowerCase() === "p";
    if (hr === 12) hr = 0;
    return { seconds: (hr + (pm ? 12 : 0)) * 3600, hasSec: false, ampm: true, elapsed: false };
  }
  let hr = parseInt(m[1], 10);
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  const hasSec = m[3] !== undefined && m[3] !== "";
  const se = hasSec ? parseFloat(m[3]) : 0;
  if (mi > 59 || se >= 60) return null;
  const ap = m[4]?.toLowerCase();
  if (ap) {
    if (hr > 12) return null;
    if (hr === 12) hr = 0;
    if (ap[0] === "p") hr += 12;
  }
  const elapsed = !ap && hr > 23;
  if (elapsed && !allowElapsed) return null;
  if (hr > 9999) return null;
  return { seconds: hr * 3600 + mi * 60 + se, hasSec, ampm: !!ap, elapsed };
}

interface DateHit {
  y: number;
  m0: number;
  d: number;
  format: string;
}

function parseDatePart(s: string, opts: ParseOptions): DateHit | null {
  const year = opts.year ?? new Date().getFullYear();
  const t = s.trim();
  let m: RegExpExecArray | null;
  // m/d/yyyy, m/d/yy, m-d-yyyy
  if ((m = /^(\d{1,2})([/-])(\d{1,2})\2(\d{1,4})$/.exec(t))) {
    return { y: fullYear(m[4]), m0: +m[1] - 1, d: +m[3], format: FMT.dateShort };
  }
  // yyyy-mm-dd, yyyy/mm/dd
  if ((m = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/.exec(t))) {
    return { y: +m[1], m0: +m[3] - 1, d: +m[4], format: FMT.dateShort };
  }
  // m/d (current year) — "1/2" → Jan 2
  if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(t))) {
    return { y: year, m0: +m[1] - 1, d: +m[2], format: FMT.dateMedium };
  }
  const W = "([A-Za-z]+\\.?)";
  // 15-Jan-2023, 15 January 2023, 15-Jan, 15 Jan
  if ((m = new RegExp(`^(\\d{1,2})[\\s-]+${W}(?:[\\s,-]+(\\d{2,4}))?$`).exec(t))) {
    const mi = monthIndex(m[2]);
    if (mi < 0) return null;
    return m[3]
      ? { y: fullYear(m[3]), m0: mi, d: +m[1], format: FMT.dateLong }
      : { y: year, m0: mi, d: +m[1], format: FMT.dateMedium };
  }
  // January 15, 2023 / Jan 15 2023 / Jan 15 / Mar-15-2011
  if ((m = new RegExp(`^${W}[\\s-]+(\\d{1,2})(?:(?:,\\s*|[\\s-]+)(\\d{4}|\\d{2}))?$`).exec(t))) {
    const mi = monthIndex(m[1]);
    if (mi < 0) return null;
    return m[3]
      ? { y: fullYear(m[3]), m0: mi, d: +m[2], format: FMT.dateLong }
      : { y: year, m0: mi, d: +m[2], format: FMT.dateMedium };
  }
  // Jan-2023, January 2023
  if ((m = new RegExp(`^${W}[\\s-]+(\\d{4})$`).exec(t))) {
    const mi = monthIndex(m[1]);
    if (mi < 0) return null;
    return { y: +m[2], m0: mi, d: 1, format: FMT.dateMonthYear };
  }
  return null;
}

function parseDateTime(raw: string, opts: ParseOptions): Recognised | null {
  if (raw !== raw.trimStart() && /^\s*\d+\/\d+$/.test(raw)) return null;
  const s = raw.trim();
  const valid = opts.pdf ? isValidDatePDF : isValidDate;
  // time only
  if (/^\d+\s*:/.test(s) || /^\d{1,2}\s*(am|pm)$/i.test(s)) {
    const tm = parseTime(s, true);
    if (!tm) return null;
    const value = tm.seconds / 86400;
    const format = tm.elapsed
      ? FMT.elapsed
      : tm.ampm
        ? tm.hasSec
          ? FMT.time12Sec
          : FMT.time12
        : tm.hasSec
          ? FMT.timeSec
          : FMT.time;
    return { value, kind: "time", format };
  }
  // date, optionally followed by a time
  const split = /^(.*?[^\s:])\s+(\d+\s*:.*|\d{1,2}\s*(?:am|pm))$/i.exec(s);
  const datePart = split ? split[1] : s;
  const timePart = split ? split[2] : null;
  const dh = parseDatePart(datePart, opts);
  if (!dh) return null;
  if (!valid(dh.y, dh.m0, dh.d)) return null;
  let value = opts.pdf ? pdfSerial(dh) : dateToSerial(dh.y, dh.m0, dh.d, opts);
  let format = dh.format;
  if (timePart) {
    const tm = parseTime(timePart, true);
    if (!tm) return null;
    value += tm.seconds / 86400;
    format = tm.elapsed ? "General" : FMT.dateTime;
    if (tm.elapsed) return { value, kind: "plain", format };
  }
  return { value, kind: "date", format };
}

function pdfSerial(dh: DateHit): number {
  return Math.round((utc(dh.y, dh.m0, dh.d) - EPOCH_1900) / DAY_MS);
}

/** parseDatePDF: a date (and time) for PDF form fields; years before 1900 allowed. */
export function parseDatePDF(text: string, opts: ParseOptions = {}): { value: number; date: boolean; time: boolean } | null {
  const s = text.trim();
  const split = /^(.*?[^\s:])\s+(\d+\s*:.*)$/.exec(s);
  const dh = parseDatePart(split ? split[1] : s, opts);
  if (!dh || !isValidDatePDF(dh.y, dh.m0, dh.d)) return null;
  let value = pdfSerial(dh);
  let time = false;
  if (split) {
    const tm = parseTime(split[2], false);
    if (!tm) return null;
    value += tm.seconds / 86400;
    time = true;
  }
  return { value, date: true, time };
}
