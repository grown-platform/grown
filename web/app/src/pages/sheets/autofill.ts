// Autofill and series fills for the Sheets editor: the fill-handle drag (and
// its right-click options), Edit ▸ Fill ▸ Series and the toolbar/Ctrl+D fills.
//
// Pure functions over FortuneSheet cell objects; the caller reads cells with
// `get(r, c)` and applies the returned writes. Behaviour follows Excel as
// recorded in the OnlyOffice suites (SerialTests.js, SheetStructureTests.js);
// the parity tests live in __parity__/autofill.parity.test.ts.
//
// Dates are serial numbers in the 1900 system (with its fictitious
// 1900-02-29), recognised by a date number format on the cell.

import type { CellRect } from "./cellRange";
import { cellScalar } from "./cellValue";
import {
  DAY_NAMES,
  MONTH_NAMES,
  dateToSerial,
  daysInMonth,
  formatValue,
  parseFormat,
  serialToDate,
} from "./numberFormat";

export type FillCell = Record<string, any> | null;
export type FillDirection = "down" | "up" | "right" | "left";
/** Translates a formula copied by (dr, dc) cells. The lead passes the real one; default = identity. */
export type TranslateFn = (formula: string, dr: number, dc: number) => string;
export interface CellWrite {
  r: number;
  c: number;
  cell: FillCell;
}
type Getter = (r: number, c: number) => FillCell;

/**
 * What a fill-handle drag produces. "auto" is a plain drag; the others are
 * the options of the menu shown after the drag (Copy cells, Fill series,
 * Fill days/weekdays/months/years, Linear trend, Growth trend).
 */
export type FillMode =
  | "auto"
  | "copy"
  | "series"
  | "days"
  | "weekdays"
  | "months"
  | "years"
  | "linearTrend"
  | "growthTrend";

export type SeriesType = "linear" | "growth" | "date" | "autofill";
export type DateUnit = "day" | "weekday" | "month" | "year";
export interface SeriesSettings {
  seriesIn: "rows" | "columns";
  type: SeriesType;
  dateUnit: DateUnit;
  step: number;
  stop: number | null;
  trend: boolean;
}

const MAX_ROW = 1048575;
const MAX_COL = 16383;
const identity: TranslateFn = (f) => f;

// ---------------------------------------------------------------------------
// Numbers

function decimals(x: number): number {
  const s = String(x);
  if (s.includes("e")) return 0;
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/** Rounds to `dec` decimals so repeated steps like 1 − 0.2·5 land on 0. */
function roundTo(x: number, dec: number): number {
  return dec > 0 ? Number(x.toFixed(Math.min(dec, 15))) : x;
}

/**
 * Drops binary noise such as 0.30000000000000004 or 1.2000000000000002: a
 * long fraction with a run of five 0s or 9s is cut where the run starts.
 */
export function trimFloatNoise(x: number): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return x;
  const s = String(x);
  if (s.includes("e")) return x;
  const frac = s.slice(s.indexOf(".") + 1);
  if (frac.length < 15) return x;
  const m = /0{5,}|9{5,}/.exec(frac);
  if (!m || (m.index === 0 && m[0][0] === "0")) return x;
  return Number(x.toFixed(m.index));
}

/** Least-squares line through (x, y); null when it is undefined. */
function fitLine(pts: [number, number][]): { slope: number; intercept: number } | null {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const xa = sx / pts.length;
  const ya = sy / pts.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - xa) * (y - ya);
    den += Math.pow(x - xa, 2);
  }
  const slope = num / den;
  const intercept = ya - slope * xa;
  return Number.isNaN(slope) || Number.isNaN(intercept) ? null : { slope, intercept };
}

/** Common difference of a sequence, or null when the steps differ. */
function commonStep(vs: number[]): number | null {
  const d = vs[1] - vs[0];
  for (let i = 2; i < vs.length; i++) {
    if (Math.abs(vs[i] - vs[i - 1] - d) > 1e-9 * Math.max(1, Math.abs(d))) return null;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Dates

interface FmtInfo {
  date: boolean;
  time: boolean;
}
const fmtCache = new Map<string, FmtInfo>();

function fmtInfo(fa: string | undefined): FmtInfo {
  if (!fa || /^general$/i.test(fa)) return { date: false, time: false };
  let info = fmtCache.get(fa);
  if (!info) {
    const toks = parseFormat(fa)[0]?.toks ?? [];
    info = {
      date: toks.some((t) => t.t === "date" && (t.k === "y" || t.k === "m" || t.k === "d" || t.k === "a")),
      time: toks.some((t) => (t.t === "date" && (t.k === "h" || t.k === "M" || t.k === "s")) || t.t === "elapsed"),
    };
    fmtCache.set(fa, info);
  }
  return info;
}

function isWeekday(serial: number): boolean {
  const wd = serialToDate(Math.floor(serial)).wd;
  return wd >= 1 && wd <= 5;
}

/** Moves `n` working days (Mon–Fri) from `serial`; weekends are skipped. */
function addWeekdays(serial: number, n: number): number {
  const dir = Math.sign(n);
  let left = Math.abs(n);
  let cur = serial;
  const step = () => {
    do cur += dir;
    while (!isWeekday(cur));
    left--;
  };
  if (left > 0) step();
  // From a weekday, five working days are exactly one calendar week.
  const weeks = Math.floor(left / 5);
  cur += weeks * 7 * dir;
  left -= weeks * 5;
  while (left > 0) step();
  return cur;
}

/** Adds whole months, keeping the day (clamped to the month's length) and time; NaN before 1900. */
function addMonths(serial: number, n: number): number {
  const day = Math.floor(serial);
  const frac = serial - day;
  const d = serialToDate(day);
  const total = d.y * 12 + (d.m - 1) + n;
  const y = Math.floor(total / 12);
  const m0 = total - y * 12;
  if (y < 1900 || y > 9999) return NaN;
  const out = dateToSerial(y, m0, Math.min(d.d, daysInMonth(y, m0)));
  return out < 0 ? NaN : out + frac;
}

function monthIndex(serial: number): number {
  const d = serialToDate(Math.floor(serial));
  return d.y * 12 + d.m - 1;
}

// ---------------------------------------------------------------------------
// Cells

function fa(cell: FillCell): string {
  return cell?.ct?.fa ?? "General";
}

function isBlank(cell: FillCell): boolean {
  return cell == null || (cellScalar(cell) == null && !cell.f);
}

function numberOf(cell: FillCell): number | null {
  if (!cell || cell.f) return null;
  const v = cellScalar(cell);
  return typeof v === "number" ? v : null;
}

function isDateFmt(cell: FillCell): boolean {
  return cell?.ct?.t === "d" || fmtInfo(fa(cell)).date;
}

function withoutFormula(template: FillCell): Record<string, any> {
  const out: Record<string, any> = template ? { ...template } : {};
  delete out.f;
  if (out.ct?.t === "inlineStr") out.ct = { fa: out.ct.fa ?? "General", t: "g" };
  return out;
}

/** A number cell styled like `template`, with its display text. */
function numberCell(template: FillCell, v: number): FillCell {
  const out = withoutFormula(template);
  const code = fa(template);
  out.v = v;
  out.m = formatValue(v, code);
  if (!out.ct) out.ct = { fa: "General", t: "n" };
  else if (out.ct.t === "s" || out.ct.t === "g" || out.ct.t === "e") out.ct = { ...out.ct, t: "n" };
  return out;
}

function textCell(template: FillCell, s: string): FillCell {
  const out = withoutFormula(template);
  out.v = s;
  out.m = s;
  if (!out.ct) out.ct = { fa: "General", t: "g" };
  return out;
}

function errorCell(template: FillCell, code: string): FillCell {
  const out = withoutFormula(template);
  out.v = code;
  out.m = code;
  out.ct = { ...(out.ct ?? { fa: "General" }), t: "e" };
  return out;
}

/** A copy of `cell` moved by (dr, dc): formulas are translated. */
function moved(cell: FillCell, dr: number, dc: number, translate: TranslateFn): FillCell {
  if (cell == null) return null;
  const out = { ...cell };
  if (typeof out.f === "string" && out.f) out.f = translate(out.f, dr, dc);
  return out;
}

// ---------------------------------------------------------------------------
// Pattern analysis for the fill handle

type Case = "cap" | "upper" | "lower";
const FULL = 1;
const SHORT = 2;

interface NameInfo {
  list: string[];
  idx: number;
  forms: number;
  cas: Case;
}

/** Day and month names, full or 3-letter, any case, with surrounding spaces or a trailing ".". */
function parseName(text: string): NameInfo | null {
  let s = text.trim();
  if (s.endsWith(".")) s = s.slice(0, -1);
  if (!/^[A-Za-z]{3,}$/.test(s)) return null;
  const lower = s.toLowerCase();
  const cas: Case = s[0] === s[0].toLowerCase() ? "lower" : s[1] === s[1].toUpperCase() ? "upper" : "cap";
  for (const list of [DAY_NAMES, MONTH_NAMES]) {
    let forms = 0;
    let idx = -1;
    list.forEach((n, i) => {
      if (n.toLowerCase() === lower) {
        forms |= FULL;
        idx = i;
      }
      if (n.slice(0, 3).toLowerCase() === lower) {
        forms |= SHORT;
        idx = i;
      }
    });
    if (forms) return { list, idx, forms, cas };
  }
  return null;
}

function nameText(list: string[], idx: number, form: number, cas: Case): string {
  const full = list[((idx % list.length) + list.length) % list.length];
  const s = form === SHORT ? full.slice(0, 3) : full;
  return cas === "upper" ? s.toUpperCase() : cas === "lower" ? s.toLowerCase() : s;
}

interface TextNum {
  pre: string;
  suf: string;
  n: number;
  width: number;
}

/** Text with a number in it ("Item 1", "Q04", "1st"): the last digit group counts. */
function parseTextNum(text: string): TextNum | null {
  const m = /^(.*?)(\d+)(\D*)$/.exec(text);
  if (!m || m[2].length > 15) return null;
  return { pre: m[1], suf: m[3], n: Number(m[2]), width: m[2].length > 1 && m[2][0] === "0" ? m[2].length : 0 };
}

type Kind = "empty" | "formula" | "num" | "time" | "date" | "textnum" | "name" | "other";

interface Item {
  kind: Kind;
  cell: FillCell;
  v?: number;
  dateOnly?: boolean;
  tn?: TextNum;
  nm?: NameInfo;
}

function classify(cell: FillCell): Item {
  if (isBlank(cell)) return { kind: "empty", cell };
  if (cell!.f) return { kind: "formula", cell };
  const v = cellScalar(cell);
  if (typeof v === "number") {
    const info = fmtInfo(fa(cell));
    if (cell!.ct?.t === "d" || info.date) return { kind: "date", cell, v, dateOnly: !info.time };
    if (info.time) return { kind: "time", cell, v };
    return { kind: "num", cell, v };
  }
  if (typeof v === "string") {
    const nm = parseName(v);
    if (nm) return { kind: "name", cell, nm };
    const tn = parseTextNum(v);
    if (tn) return { kind: "textnum", cell, tn };
  }
  return { kind: "other", cell };
}

function joins(a: Item, next: Item, forms: { v: number }): boolean {
  if (a.kind !== next.kind) return false;
  switch (a.kind) {
    case "num":
    case "time":
    case "date":
      return true;
    case "textnum":
      return a.tn!.pre === next.tn!.pre && a.tn!.suf === next.tn!.suf;
    case "name":
      if (a.nm!.list !== next.nm!.list || !(forms.v & next.nm!.forms)) return false;
      forms.v &= next.nm!.forms;
      return true;
    default:
      return false;
  }
}

/**
 * Value of a pattern cell `k` periods away (k < 0 before the source): `i` is
 * its index in its run, `j = k·m + i` its place in the run's series. Returns
 * undefined to fall back to a plain copy of the source cell.
 */
type RunFn = (i: number, k: number) => FillCell | undefined;

function planRun(run: Item[], mode: FillMode, patternLen: number, forward: boolean): RunFn | null {
  const m = run.length;
  const first = run[0];
  const tpl = (i: number) => run[i].cell;
  switch (first.kind) {
    case "num": {
      const vs = run.map((x) => x.v!);
      if (m === 1) {
        if (patternLen === 1 && mode === "auto") return null;
        return (i, k) => numberCell(tpl(i), roundTo(vs[0] + k, decimals(vs[0])));
      }
      const d = commonStep(vs);
      if (d != null) {
        const dec = Math.max(...vs.map(decimals));
        return (i, k) => numberCell(tpl(i), roundTo(vs[0] + (k * m + i) * d, dec));
      }
      const fit = fitLine(vs.map((y, x) => [x, y]))!;
      return (i, k) => numberCell(tpl(i), trimFloatNoise(fit.intercept + fit.slope * (k * m + i)));
    }
    case "time": {
      const vs = run.map((x) => x.v!);
      if (m === 1) return (i, k) => numberCell(tpl(i), vs[0] + k / 24);
      const d = commonStep(vs);
      if (d != null) return (i, k) => numberCell(tpl(i), vs[0] + (k * m + i) * d);
      const fit = fitLine(vs.map((y, x) => [x, y]))!;
      return (i, k) => numberCell(tpl(i), fit.intercept + fit.slope * (k * m + i));
    }
    case "date":
      return planDateRun(run, mode, forward);
    case "textnum": {
      const ns = run.map((x) => x.tn!.n);
      const d = m > 1 ? commonStep(ns) : 1;
      return (i, k) => {
        const tn = run[i].tn!;
        const n = Math.abs(d == null ? ns[i] + k : ns[0] + (k * m + i) * d);
        return textCell(tpl(i), tn.pre + String(n).padStart(tn.width, "0") + tn.suf);
      };
    }
    case "name": {
      const len = first.nm!.list.length;
      const idx = run.map((x) => x.nm!.idx);
      let d: number | null = 1;
      if (m > 1) {
        d = (((idx[1] - idx[0]) % len) + len) % len;
        for (let i = 2; i < m && d != null; i++) if ((((idx[i] - idx[i - 1]) % len) + len) % len !== d) d = null;
      }
      if (d == null) return null;
      // "May" is both a full and a short month name: it takes the run's form.
      const runForm = run.map((x) => x.nm!.forms).find((f) => f !== (FULL | SHORT)) ?? FULL;
      return (i, k) => {
        const nm = run[i].nm!;
        const form = nm.forms === (FULL | SHORT) ? runForm : nm.forms;
        return textCell(tpl(i), nameText(nm.list, idx[0] + (k * m + i) * d!, form, nm.cas));
      };
    }
    default:
      return null;
  }
}

function planDateRun(run: Item[], mode: FillMode, forward: boolean): RunFn | null {
  const m = run.length;
  const tpl = (i: number) => run[i].cell;
  const dateOnly = run.every((x) => x.dateOnly);
  const raw = run.map((x) => x.v!);
  const vs = dateOnly ? raw.map(Math.floor) : raw;
  const days = raw.map(Math.floor);
  // An impossible date (before 1900) falls back to copying the source cell.
  const out = (i: number, v: number) => (Number.isNaN(v) || v < 0 ? undefined : numberCell(tpl(i), v));

  if (mode === "weekdays") {
    const step = m === 1 ? 1 : commonStep(days);
    if (step == null) return null;
    // Counted from the edge cell next to the new ones.
    const anchor = forward ? m - 1 : 0;
    return (i, k) => {
      const v = addWeekdays(days[anchor], (k * m + i - anchor) * step);
      return v < 1 ? undefined : out(i, v);
    };
  }
  if (mode === "months" || mode === "years") {
    const unit = mode === "months" ? 1 : 12;
    if (m === 1) return (i, k) => out(i, addMonths(days[0], k * unit));
    const us = days.map((s) => (mode === "months" ? monthIndex(s) : serialToDate(s).y));
    const du = commonStep(us);
    if (du == null) return null;
    if (du !== 0) return (i, k) => out(i, addMonths(days[0], (k * m + i) * du * unit));
    // All in one month (year): each cell moves on by a month (year) per period.
    if (commonStep(raw) == null) return null;
    return (i, k) => out(i, addMonths(days[i], k * unit));
  }
  if (m === 1) return (i, k) => out(i, vs[0] + k);
  if (mode !== "days") {
    // Same day of the month (and time), different months: step by months.
    const d0 = serialToDate(days[0]).d;
    const sameDay = days.every((day, i) => serialToDate(day).d === d0 && raw[i] - day === raw[0] - days[0]);
    const dm = sameDay ? commonStep(days.map(monthIndex)) : null;
    if (dm) return (i, k) => out(i, addMonths(raw[0], (k * m + i) * dm));
  }
  const d = commonStep(vs);
  if (d == null) return null;
  return (i, k) => out(i, vs[0] + (k * m + i) * d);
}

/** Cell at pattern offset `t` (0 = first new cell) past the source, forward or backward. */
type LinePlan = (t: number) => { p: number; cell: FillCell | undefined };

function planLine(src: FillCell[], mode: FillMode, forward: boolean): LinePlan {
  const L = src.length;
  const items = src.map(classify);
  const runOf: { fn: RunFn | null; start: number }[] = new Array(L);
  if (mode !== "copy") {
    for (let i = 0; i < L; ) {
      const forms = { v: items[i].nm?.forms ?? 0 };
      let j = i + 1;
      if (["num", "time", "date", "textnum", "name"].includes(items[i].kind)) {
        while (j < L && joins(items[i], items[j], forms)) j++;
      }
      const fn = j > i && items[i].kind !== "empty" ? planRun(items.slice(i, j), mode, L, forward) : null;
      for (let x = i; x < j; x++) runOf[x] = { fn, start: i };
      i = j;
    }
  }
  return (t) => {
    const cyc = t % L;
    const p = forward ? cyc : L - 1 - cyc;
    const k = forward ? Math.floor(t / L) + 1 : -(Math.floor(t / L) + 1);
    const run = runOf[p];
    return { p, cell: run?.fn ? run.fn(p - run.start, k) : undefined };
  };
}

// ---------------------------------------------------------------------------
// Fill handle

interface Axis {
  vertical: boolean;
  forward: boolean;
}

function axisOf(direction: FillDirection): Axis {
  return { vertical: direction === "down" || direction === "up", forward: direction === "down" || direction === "right" };
}

/**
 * Fill-handle drag: `src` is the selected source block, `dest` the whole block
 * after dragging (contains src, extends it in `direction`). Returns writes for
 * the new cells only (dest minus src).
 *
 * A single number is copied (with `series` or mode "series" it counts up),
 * 2+ numbers extend their trend, dates step by day or by the detected
 * month/year step (irregular dates are copied), day and month names cycle
 * keeping their case and form, "Item 1" counts, other text is copied
 * cyclically and formulas are translated by their offset. `mode` selects one
 * of the options of the menu shown after a drag.
 */
export function autofillRange(
  get: Getter,
  src: CellRect,
  dest: CellRect,
  direction: FillDirection,
  opts: { translate?: TranslateFn; series?: boolean; mode?: FillMode } = {},
): CellWrite[] {
  const translate = opts.translate ?? identity;
  const mode: FillMode = opts.mode ?? (opts.series ? "series" : "auto");
  const ax = axisOf(direction);
  const [a0, a1] = ax.vertical ? [src.r1, src.r2] : [src.c1, src.c2];
  const [d0, d1] = ax.vertical ? [dest.r1, dest.r2] : [dest.c1, dest.c2];
  const [l0, l1] = ax.vertical ? [src.c1, src.c2] : [src.r1, src.r2];
  const at = (line: number, i: number) => (ax.vertical ? get(i, line) : get(line, i));
  const rc = (line: number, i: number) => (ax.vertical ? { r: i, c: line } : { r: line, c: i });
  const targets: number[] = [];
  if (ax.forward) for (let i = a1 + 1; i <= d1; i++) targets.push(i);
  else for (let i = a0 - 1; i >= d0; i--) targets.push(i);

  const writes: CellWrite[] = [];
  for (let line = l0; line <= l1; line++) {
    if (mode === "linearTrend" || mode === "growthTrend") {
      writes.push(...trendExtend(at, rc, line, a0, a1, targets, mode === "growthTrend"));
      continue;
    }
    const cells: FillCell[] = [];
    for (let i = a0; i <= a1; i++) cells.push(at(line, i));
    const plan = planLine(cells, mode, ax.forward);
    targets.forEach((pos, t) => {
      const { p, cell } = plan(t);
      const delta = pos - (a0 + p);
      const out = cell !== undefined ? cell : moved(cells[p], ax.vertical ? delta : 0, ax.vertical ? 0 : delta, translate);
      writes.push({ ...rc(line, pos), cell: out });
    });
  }
  return writes;
}

/** Linear/Growth trend of the drag menu: fits the source numbers and extends the fit only. */
function trendExtend(
  at: (line: number, i: number) => FillCell,
  rc: (line: number, i: number) => { r: number; c: number },
  line: number,
  a0: number,
  a1: number,
  targets: number[],
  growth: boolean,
): CellWrite[] {
  let firstIdx = -1;
  const pts: [number, number][] = [];
  for (let i = a0; i <= a1; i++) {
    const v = numberOf(at(line, i));
    if (v == null) continue;
    if (firstIdx < 0) firstIdx = i;
    pts.push([i, growth ? Math.log(v) : v]);
  }
  if (firstIdx < 0) return [];
  const tpl = at(line, firstIdx);
  // A growth trend starting at 0 or a negative number has no fit: fill zeros.
  if (growth && !Number.isFinite(pts[0][1])) return targets.map((pos) => ({ ...rc(line, pos), cell: numberCell(tpl, 0) }));
  const fit = pts.length > 1 ? fitLine(pts) : { slope: growth ? 0 : 1, intercept: pts[0][1] - (growth ? 0 : 1) * pts[0][0] };
  if (!fit) return [];
  return targets.map((pos) => {
    const y = fit.intercept + fit.slope * pos;
    return { ...rc(line, pos), cell: numberCell(tpl, growth ? Math.exp(y) : y) };
  });
}

// ---------------------------------------------------------------------------
// Edit ▸ Fill ▸ Series

export type FillMenuOption =
  | "copyCells"
  | "fillSeries"
  | "fillFormattingOnly"
  | "fillWithoutFormatting"
  | "fillDays"
  | "fillWeekdays"
  | "fillMonths"
  | "fillYears"
  | "linearTrend"
  | "growthTrend"
  | "flashFill"
  | "series";

/** Which fill-handle menu options apply: true/false, null = not offered at all. */
export type FillMenuOptions = Record<FillMenuOption, boolean | null>;

export interface FillHandleInfo {
  /** The block after the drag (contains the selection). */
  dest: CellRect;
  direction: FillDirection;
}

/**
 * Series dialog defaults and fill-handle menu options for the selection `sel`
 * (with `fillHandle`, `sel` is the dragged source). The first row (Rows) or
 * column (Columns) decides: a date format gives type Date; the step comes
 * from the first two dates (days, or months/years when the day of month
 * repeats), else from the least-squares slope of the numbers when the line
 * ends in empty cells to fill; 1 otherwise.
 */
export function prepareSeries(
  get: Getter,
  sel: CellRect,
  fillHandle?: FillHandleInfo,
): { settings: SeriesSettings; menu: FillMenuOptions } {
  const menu: FillMenuOptions = {
    copyCells: true,
    fillSeries: false,
    fillFormattingOnly: null,
    fillWithoutFormatting: null,
    fillDays: false,
    fillWeekdays: false,
    fillMonths: false,
    fillYears: false,
    linearTrend: false,
    growthTrend: false,
    flashFill: null,
    series: false,
  };
  const seriesIn: SeriesSettings["seriesIn"] = fillHandle
    ? fillHandle.direction === "left" || fillHandle.direction === "right"
      ? "rows"
      : "columns"
    : sel.c2 - sel.c1 >= sel.r2 - sel.r1
      ? "rows"
      : "columns";
  const vertical = seriesIn === "columns";
  const len = vertical ? sel.r2 - sel.r1 + 1 : sel.c2 - sel.c1 + 1;
  const line: FillCell[] = [];
  for (let i = 0; i < len; i++) line.push(vertical ? get(sel.r1 + i, sel.c1) : get(sel.r1, sel.c1 + i));

  const settings: SeriesSettings = { seriesIn, type: "linear", dateUnit: "day", step: 1, stop: null, trend: false };
  const lead = line.findIndex((c) => !isBlank(c));
  let last = -1;
  line.forEach((c, i) => {
    if (!isBlank(c)) last = i;
  });
  const isDate = lead >= 0 && !line[lead]!.f && isDateFmt(line[lead]);
  if (isDate) {
    settings.type = "date";
    menu.fillDays = menu.fillWeekdays = menu.fillMonths = menu.fillYears = true;
  }
  const firstValue = lead >= 0 ? numberOf(line[lead]) : null;

  if (lead >= 0 && !line[lead]!.f && firstValue == null) {
    // Text: "Item 1" can count up, other text only copies.
    menu.fillSeries = /\d$/.test(String(cellScalar(line[lead]) ?? ""));
  } else if (firstValue != null) {
    let step: number | null = null;
    for (let i = lead + 1; i <= last && step == null; i++) {
      const cell = line[i];
      if (isBlank(cell)) continue;
      if (cell!.f) {
        step = 1;
        break;
      }
      const v = numberOf(cell);
      if (v == null) {
        step = 1;
        menu.fillSeries = menu.series = true;
        break;
      }
      if (isDate) step = dateStep(settings, firstValue, v, i === lead + 1, i + 1 <= last ? numberOf(line[i + 1]) ?? 0 : 0);
    }
    if (step == null) {
      const pts: [number, number][] = [];
      for (let i = lead; i <= last; i++) {
        const v = numberOf(line[i]);
        if (v != null) pts.push([i, v]);
      }
      if (last === len - 1 || pts.length === 1 || lead !== 0) step = 1;
      else {
        const slope = trimFloatNoise(fitLine(pts)?.slope ?? 1);
        step = isDate && !Number.isInteger(slope) ? 1 : slope;
      }
      menu.fillSeries = menu.series = true;
      if (pts.length > 1 && !isDate) menu.linearTrend = menu.growthTrend = true;
    }
    settings.step = step;
  }
  if (isDate) menu.fillSeries = menu.series = true;
  if (fillHandle && numberOf(line[0]) != null) menu.fillSeries = menu.series = true;
  return { settings, menu };
}

/** Step between the first date and a later one; sets the unit. Null when undecided. */
function dateStep(s: SeriesSettings, first: number, cur: number, adjacent: boolean, next: number): number | null {
  const a = serialToDate(Math.floor(first));
  const b = serialToDate(Math.floor(cur));
  const c = serialToDate(Math.floor(next));
  const sameDay = a.d === b.d && a.d === c.d;
  if (sameDay && first !== cur && first !== next && a.m !== b.m) {
    s.dateUnit = "month";
    return Math.round((cur - first) / 30);
  }
  if (sameDay && a.y !== b.y && a.y !== c.y) {
    s.dateUnit = "year";
    return b.y - a.y;
  }
  return adjacent ? cur - first : null;
}

/** Edit ▸ Fill ▸ Series dialog defaults for a selection. */
export function defaultSeriesSettings(get: Getter, sel: CellRect, fillHandle?: FillHandleInfo): SeriesSettings {
  return prepareSeries(get, sel, fillHandle).settings;
}

/** Menu options offered after a fill-handle drag of `src` (see prepareSeries). */
export function fillMenuOptions(get: Getter, src: CellRect, fillHandle?: FillHandleInfo): FillMenuOptions {
  return prepareSeries(get, src, fillHandle).menu;
}

/**
 * Series settings behind a fill-handle menu choice: the trends switch the
 * type and turn trend on; the date options set the unit and take the step
 * from the first two source dates (negated when dragging up or left).
 */
export function seriesSettingsForMenu(
  get: Getter,
  src: CellRect,
  fillHandle: FillHandleInfo,
  choice: "linearTrend" | "growthTrend" | "fillDays" | "fillWeekdays" | "fillMonths" | "fillYears",
): SeriesSettings {
  const s = defaultSeriesSettings(get, src, fillHandle);
  if (choice === "linearTrend" || choice === "growthTrend") {
    return { ...s, type: choice === "linearTrend" ? "linear" : "growth", trend: true };
  }
  const unit: DateUnit =
    choice === "fillDays" ? "day" : choice === "fillWeekdays" ? "weekday" : choice === "fillMonths" ? "month" : "year";
  const out: SeriesSettings = { ...s, type: "date", dateUnit: unit };
  const vertical = s.seriesIn === "columns";
  if (src.r1 === src.r2 && src.c1 === src.c2) out.step = 1;
  else {
    const va = numberOf(get(src.r1, src.c1));
    const vb = numberOf(vertical ? get(src.r1 + 1, src.c1) : get(src.r1, src.c1 + 1));
    if (va != null && vb != null) {
      const u = (v: number) =>
        unit === "month" ? monthIndex(v) : unit === "year" ? serialToDate(Math.floor(v)).y : v;
      out.step = u(vb) - u(va);
    }
  }
  if (fillHandle.direction === "up" || fillHandle.direction === "left") out.step = -out.step;
  return out;
}

/**
 * Fill ▸ Series over the selection `sel`: each row (Rows) or column
 * (Columns) starts from its first cell. Honours the stop value (a one-cell
 * line runs on past the selection up to it; a stop before the start writes
 * nothing), trend (least-squares line / exponential fit through the line's
 * numbers, rewriting the whole line) and date units, including weekdays
 * that skip weekends and months clamped to the month's last day.
 */
export function fillSeries(get: Getter, sel: CellRect, settings: SeriesSettings, opts: { translate?: TranslateFn } = {}): CellWrite[] {
  const vertical = settings.seriesIn === "columns";
  const [l0, l1] = vertical ? [sel.c1, sel.c2] : [sel.r1, sel.r2];
  const [a0, a1] = vertical ? [sel.r1, sel.r2] : [sel.c1, sel.c2];
  const at = (line: number, i: number) => (vertical ? get(i, line) : get(line, i));
  const rc = (line: number, i: number) => (vertical ? { r: i, c: line } : { r: line, c: i });
  const writes: CellWrite[] = [];

  for (let line = l0; line <= l1; line++) {
    if (settings.type === "autofill") {
      let last = -1;
      for (let i = a0; i <= a1; i++) if (!isBlank(at(line, i))) last = i;
      if (last < 0 || last === a1) continue;
      const src = vertical ? { r1: a0, r2: last, c1: line, c2: line } : { r1: line, r2: line, c1: a0, c2: last };
      const dest = vertical ? { ...src, r2: a1 } : { ...src, c2: a1 };
      writes.push(...autofillRange(get, src, dest, vertical ? "down" : "right", { translate: opts.translate }));
    } else if (settings.trend) {
      writes.push(...trendLine(at, rc, line, a0, a1, settings.type === "growth"));
    } else {
      writes.push(...stepLine(at, rc, line, a0, a1, settings, vertical));
    }
  }
  return writes;
}

/** Trend in the Series dialog: fits the line's numbers and rewrites the whole line. */
function trendLine(
  at: (line: number, i: number) => FillCell,
  rc: (line: number, i: number) => { r: number; c: number },
  line: number,
  a0: number,
  a1: number,
  growth: boolean,
): CellWrite[] {
  let first = -1;
  let last = -1;
  for (let i = a0; i <= a1; i++) {
    if (isBlank(at(line, i))) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0 || numberOf(at(line, first)) == null) return [];
  const pts: [number, number][] = [];
  for (let i = first; i <= last; i++) {
    const v = numberOf(at(line, i));
    if (v != null) pts.push([i, growth ? Math.log(v) : v]);
  }
  const fit = pts.length > 1 ? fitLine(pts) : { slope: growth ? 0 : 1, intercept: pts[0][1] - (growth ? 0 : 1) * pts[0][0] };
  if (!fit || !Number.isFinite(fit.intercept) || !Number.isFinite(fit.slope)) return [];
  const tpl = at(line, first);
  const out: CellWrite[] = [];
  for (let i = a0; i <= a1; i++) {
    const y = fit.intercept + fit.slope * i;
    out.push({ ...rc(line, i), cell: numberCell(tpl, growth ? Math.exp(y) : y) });
  }
  return out;
}

/** Linear, growth or date steps from the line's first cell. */
function stepLine(
  at: (line: number, i: number) => FillCell,
  rc: (line: number, i: number) => { r: number; c: number },
  line: number,
  a0: number,
  a1: number,
  s: SeriesSettings,
  vertical: boolean,
): CellWrite[] {
  const tpl = at(line, a0);
  const start = numberOf(tpl);
  if (start == null) return [];
  const { step, stop } = s;
  if (stop != null) {
    const bad = s.type === "growth" ? step <= 0 || step === 1 || stop <= 0 : step < 0 ? start <= stop : start >= stop;
    if (bad) return [];
  }
  const next = seriesStepper(s, start);
  // A one-cell line with a stop value runs on until the stop value.
  const end = stop != null && a0 === a1 && step !== 0 ? (vertical ? MAX_ROW : MAX_COL) : a1;
  const out: CellWrite[] = [];
  for (let i = a0 + 1; i <= end; i++) {
    const v = next();
    if (stop != null) {
      const beyond =
        Number.isNaN(v) ||
        (s.type === "growth"
          ? step > 1 ? v > stop : v < stop
          : s.type === "date" && s.dateUnit === "weekday"
            ? v <= 0 || (step > 0 ? v > stop : v < stop)
            : step > 0 ? v > stop : v < stop);
      if (beyond) break;
    }
    out.push({ ...rc(line, i), cell: Number.isNaN(v) ? errorCell(tpl, "#NUM!") : numberCell(tpl, v) });
  }
  return out;
}

/** Returns a generator of the series values after `start`. */
function seriesStepper(s: SeriesSettings, start: number): () => number {
  const { step } = s;
  const dec = Math.max(decimals(step), decimals(start));
  let prev = start;
  let k = 0;
  if (s.type === "growth") return () => (prev = prev * step);
  if (s.type !== "date" || s.dateUnit === "day") {
    const bounce = s.type === "date";
    return () => {
      let v = roundTo(prev + step, dec);
      // A fractional negative day step bounces off serial 0 rather than going negative.
      if (bounce && step > -1 && step < 0 && v < 0) v += 1;
      return (prev = v);
    };
  }
  if (s.dateUnit === "weekday") {
    const whole = Math.floor(step);
    const unit = Math.sign(whole) + roundTo(step - whole, decimals(step));
    return () => {
      let i = 0;
      do {
        if (unit !== 0) prev = roundTo(prev + unit, dec);
        while (!isWeekday(prev)) prev += Math.sign(step);
        i++;
      } while (i < Math.abs(whole));
      return prev < 0 ? prev : Math.floor(prev);
    };
  }
  const months = s.dateUnit === "month" ? 1 : 12;
  return () => {
    k++;
    // Only whole months (years) count; going backwards is not supported.
    if (step < 0) return NaN;
    return addMonths(start, Math.trunc(roundTo(k * step, decimals(step))) * months);
  };
}

// ---------------------------------------------------------------------------
// Toolbar Fill down/up/right/left, Ctrl+D / Ctrl+R

/**
 * Copies the edge row/column of `sel` over the rest of it (Fill down copies
 * the top row, Fill up the bottom row …), translating formulas. With a
 * single-row (single-column) selection the row above (column to the left, …)
 * is copied into it, as Excel's Ctrl+D does.
 */
export function fillEdge(get: Getter, sel: CellRect, direction: FillDirection, opts: { translate?: TranslateFn } = {}): CellWrite[] {
  const translate = opts.translate ?? identity;
  const ax = axisOf(direction);
  const [a0, a1] = ax.vertical ? [sel.r1, sel.r2] : [sel.c1, sel.c2];
  const [l0, l1] = ax.vertical ? [sel.c1, sel.c2] : [sel.r1, sel.r2];
  let from: number;
  let targets: number[] = [];
  if (a0 === a1) {
    from = ax.forward ? a0 - 1 : a0 + 1;
    if (from < 0 || from > (ax.vertical ? MAX_ROW : MAX_COL)) return [];
    targets = [a0];
  } else {
    from = ax.forward ? a0 : a1;
    for (let i = a0; i <= a1; i++) if (i !== from) targets.push(i);
  }
  const writes: CellWrite[] = [];
  for (let line = l0; line <= l1; line++) {
    const cell = ax.vertical ? get(from, line) : get(line, from);
    for (const pos of targets) {
      const d = pos - from;
      writes.push({
        r: ax.vertical ? pos : line,
        c: ax.vertical ? line : pos,
        cell: moved(cell, ax.vertical ? d : 0, ax.vertical ? 0 : d, translate),
      });
    }
  }
  return writes;
}
