// The AutoFilter model: one filter range per sheet (header row + data rows)
// and a criterion per column. Pure functions compute which rows the filter
// hides; sheetDataTools.ts applies that to FortuneSheet's hidden rows and
// persists the model on the sheet as `grownFilter`.
//
// Criteria kinds (Excel/OnlyOffice semantics):
//   values  – a checklist of visible display values, blanks, and date groups
//             (year → second granularity)
//   custom  – one or two conditions (=, ≠, >, ≥, <, ≤, begins/ends/contains
//             and their negations), joined by AND or OR
//   top10   – top/bottom N items or N percent
//   dynamic – above/below average and relative date periods
//   color   – cell fill or font colour

import { sortGridRows, type CellGrid } from "./sheetOps";
import {
  cellDisplay,
  cellScalar,
  dateToSerial,
  isDateCell,
  isError,
  normColor,
  parseInput,
  serialToParts,
  partsToSerial,
  type Cell,
  type Grid,
} from "./cellValue";
import { wildcardRegex } from "./sheetFormula";

export interface FilterRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export type CustomOp =
  | "equals"
  | "doesNotEqual"
  | "isGreaterThan"
  | "isGreaterThanOrEqualTo"
  | "isLessThan"
  | "isLessThanOrEqualTo"
  | "beginsWith"
  | "doesNotBeginWith"
  | "endsWith"
  | "doesNotEndWith"
  | "contains"
  | "doesNotContain";

export interface CustomCondition {
  op: CustomOp;
  val: string;
}

export type DynamicType =
  | "aboveAverage"
  | "belowAverage"
  | "today"
  | "yesterday"
  | "tomorrow"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek"
  | "thisMonth"
  | "lastMonth"
  | "nextMonth"
  | "thisQuarter"
  | "lastQuarter"
  | "nextQuarter"
  | "thisYear"
  | "lastYear"
  | "nextYear"
  | "yearToDate"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "m1"
  | "m2"
  | "m3"
  | "m4"
  | "m5"
  | "m6"
  | "m7"
  | "m8"
  | "m9"
  | "m10"
  | "m11"
  | "m12";

export type DateGrouping = "year" | "month" | "day" | "hour" | "minute" | "second";

export interface DateGroupItem {
  y: number;
  m?: number; // 1..12
  d?: number;
  hh?: number;
  mm?: number;
  ss?: number;
  grouping: DateGrouping;
}

export type ColumnFilter =
  | { type: "values"; values: string[]; blank?: boolean; dates?: DateGroupItem[] }
  | { type: "custom"; and: boolean; conditions: CustomCondition[] }
  | { type: "top10"; top: boolean; percent: boolean; val: number }
  | { type: "dynamic"; dynamic: DynamicType }
  | { type: "color"; cellColor?: string | null; fontColor?: string | null };

export interface FilterSort {
  colId: number;
  desc: boolean;
}

export interface FilterState {
  range: FilterRange;
  /** Criteria keyed by column offset within the range (0 = first column). */
  columns: Record<string, ColumnFilter>;
  sort?: FilterSort;
  /** Set when the filter is an Excel table's header buttons (its range follows the table). */
  table?: string;
}

export interface FilterOptions {
  /** Clock for relative date filters. */
  now?: Date;
}

// ---- range discovery ------------------------------------------------------------

function nonEmpty(grid: Grid, r: number, c: number): boolean {
  if (r < 0 || c < 0) return false;
  return cellScalar(grid[r]?.[c]) !== null;
}

/**
 * Excel's "current region": the rectangle around (r, c) bounded by empty rows
 * and columns. Returns null when the cell and its neighbours are all empty.
 */
export function currentRegion(grid: Grid, r: number, c: number): FilterRange | null {
  let rect = { r1: r, c1: c, r2: r, c2: c };
  for (let guard = 0; guard < 10000; guard++) {
    let grew = false;
    const { r1, c1, r2, c2 } = rect;
    const any = (rs: number, re: number, cs: number, ce: number) => {
      for (let i = rs; i <= re; i++) for (let j = cs; j <= ce; j++) if (nonEmpty(grid, i, j)) return true;
      return false;
    };
    if (r1 > 0 && any(r1 - 1, r1 - 1, Math.max(0, c1 - 1), c2 + 1)) {
      rect.r1--;
      grew = true;
    }
    if (any(r2 + 1, r2 + 1, Math.max(0, c1 - 1), c2 + 1) && r2 + 1 < grid.length) {
      rect.r2++;
      grew = true;
    }
    if (c1 > 0 && any(Math.max(0, r1 - 1), r2 + 1, c1 - 1, c1 - 1)) {
      rect.c1--;
      grew = true;
    }
    if (any(Math.max(0, r1 - 1), r2 + 1, c2 + 1, c2 + 1)) {
      rect.c2++;
      grew = true;
    }
    if (!grew) break;
    rect = { ...rect };
  }
  if (rect.r1 === rect.r2 && rect.c1 === rect.c2 && !nonEmpty(grid, r, c)) return null;
  return rect;
}

/**
 * Creates a filter for a selection. A single cell expands to its current
 * region; a multi-cell selection is used as-is. Null when there is no data.
 */
export function createFilter(grid: Grid, sel: FilterRange): FilterState | null {
  const single = sel.r1 === sel.r2 && sel.c1 === sel.c2;
  const range = single ? currentRegion(grid, sel.r1, sel.c1) : normRange(sel);
  if (!range) return null;
  return { range, columns: {} };
}

function normRange(r: FilterRange): FilterRange {
  return {
    r1: Math.min(r.r1, r.r2),
    c1: Math.min(r.c1, r.c2),
    r2: Math.max(r.r1, r.r2),
    c2: Math.max(r.c1, r.c2),
  };
}

// ---- value list (the checklist in the filter menu) -------------------------------------

export interface ValueItem {
  /** Display text ("" for blanks). */
  text: string;
  visible: boolean;
  isDate: boolean;
  /** Date parts for date cells. */
  date?: { y: number; m: number; d: number; hh: number; mm: number; ss: number };
  /** Grouping to apply when this item is part of a date checklist. */
  grouping?: DateGrouping;
  /** Sort key. */
  num?: number;
}

/**
 * The distinct values of a column among rows the *other* columns' filters
 * leave visible, sorted numbers → text → blanks. Each item carries whether the
 * column's current criterion shows it.
 */
export function columnValues(grid: Grid, state: FilterState, colId: number, opts: FilterOptions = {}): ValueItem[] {
  const col = state.range.c1 + colId;
  const others: FilterState = { ...state, columns: { ...state.columns } };
  delete others.columns[String(colId)];
  const hiddenByOthers = hiddenRows(grid, others, opts);
  const own = state.columns[String(colId)];
  const ctx = own ? columnContext(grid, state, colId, opts) : null;
  const seen = new Map<string, ValueItem>();
  for (let r = state.range.r1 + 1; r <= state.range.r2; r++) {
    if (hiddenByOthers.has(r)) continue;
    const cell = grid[r]?.[col] ?? null;
    const text = cellDisplay(cell);
    const date = isDateCell(cell) && typeof cellScalar(cell) === "number";
    const key = (date ? "d:" : "t:") + text.toLowerCase();
    if (seen.has(key)) continue;
    const v = cellScalar(cell);
    const item: ValueItem = {
      text,
      isDate: date,
      visible: own ? cellMatches(cell, own, ctx!) : true,
      num: typeof v === "number" ? v : undefined,
    };
    if (date) {
      const p = serialToParts(v as number);
      item.date = { y: p.y, m: p.m, d: p.d, hh: p.hh, mm: p.mm, ss: p.ss };
      item.grouping = "day";
    }
    seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.text === "" || b.text === "") return a.text === "" ? (b.text === "" ? 0 : 1) : -1;
    const an = a.num !== undefined;
    const bn = b.num !== undefined;
    if (an && bn) return a.num! - b.num!;
    if (an !== bn) return an ? -1 : 1;
    return a.text.localeCompare(b.text, undefined, { sensitivity: "base", numeric: true });
  });
}

/**
 * Builds a values criterion from checklist items. Returns null when every item
 * is visible (no filtering needed).
 */
export function valuesFilterFromItems(items: ValueItem[]): ColumnFilter | null {
  if (items.every((i) => i.visible)) return null;
  const values: string[] = [];
  const dates: DateGroupItem[] = [];
  let blank = false;
  for (const it of items) {
    if (!it.visible) continue;
    if (it.text === "") {
      blank = true;
    } else if (it.isDate && it.date) {
      dates.push(dateItem(it.date, it.grouping ?? "day"));
    } else {
      values.push(it.text);
    }
  }
  return { type: "values", values, blank, dates };
}

function dateItem(
  p: { y: number; m: number; d: number; hh: number; mm: number; ss: number },
  grouping: DateGrouping,
): DateGroupItem {
  const out: DateGroupItem = { y: p.y, grouping };
  const order: DateGrouping[] = ["year", "month", "day", "hour", "minute", "second"];
  const lvl = order.indexOf(grouping);
  if (lvl >= 1) out.m = p.m;
  if (lvl >= 2) out.d = p.d;
  if (lvl >= 3) out.hh = p.hh;
  if (lvl >= 4) out.mm = p.mm;
  if (lvl >= 5) out.ss = p.ss;
  return out;
}

// ---- matching -----------------------------------------------------------------------

interface ColumnContext {
  now: number;
  average?: number;
  threshold?: { cut: number; top: boolean };
}

function columnContext(grid: Grid, state: FilterState, colId: number, opts: FilterOptions): ColumnContext {
  const f = state.columns[String(colId)];
  const ctx: ColumnContext = { now: dateToSerial(opts.now ?? new Date()) };
  if (!f) return ctx;
  const col = state.range.c1 + colId;
  const nums: number[] = [];
  if ((f.type === "dynamic" && (f.dynamic === "aboveAverage" || f.dynamic === "belowAverage")) || f.type === "top10") {
    for (let r = state.range.r1 + 1; r <= state.range.r2; r++) {
      const v = cellScalar(grid[r]?.[col]);
      if (typeof v === "number") nums.push(v);
    }
  }
  if (f.type === "dynamic" && nums.length) ctx.average = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (f.type === "top10" && nums.length) {
    const sorted = [...nums].sort((a, b) => (f.top ? b - a : a - b));
    let n = f.percent ? Math.floor((sorted.length * f.val) / 100) : Math.floor(f.val);
    n = Math.max(1, Math.min(sorted.length, n));
    ctx.threshold = { cut: sorted[n - 1], top: f.top };
  }
  return ctx;
}

function dayOf(serial: number): number {
  return Math.floor(serial);
}

function periodBounds(type: DynamicType, now: number): [number, number] | null {
  const p = serialToParts(now);
  const quarterStart = (y: number, q: number) => partsToSerial(y, q * 3 + 1, 1);
  const q = Math.floor((p.m - 1) / 3);
  switch (type) {
    case "today":
      return [now, now + 1];
    case "yesterday":
      return [now - 1, now];
    case "tomorrow":
      return [now + 1, now + 2];
    case "thisWeek":
    case "lastWeek":
    case "nextWeek": {
      const start = now - p.dow + (type === "lastWeek" ? -7 : type === "nextWeek" ? 7 : 0);
      return [start, start + 7];
    }
    case "thisMonth":
    case "lastMonth":
    case "nextMonth": {
      const off = type === "lastMonth" ? -1 : type === "nextMonth" ? 1 : 0;
      return [partsToSerial(p.y, p.m + off, 1), partsToSerial(p.y, p.m + off + 1, 1)];
    }
    case "thisQuarter":
    case "lastQuarter":
    case "nextQuarter": {
      const off = type === "lastQuarter" ? -1 : type === "nextQuarter" ? 1 : 0;
      const qq = q + off;
      const y = p.y + Math.floor(qq / 4);
      const qn = ((qq % 4) + 4) % 4;
      return [quarterStart(y, qn), partsToSerial(y, qn * 3 + 4, 1)];
    }
    case "thisYear":
      return [partsToSerial(p.y, 1, 1), partsToSerial(p.y + 1, 1, 1)];
    case "lastYear":
      return [partsToSerial(p.y - 1, 1, 1), partsToSerial(p.y, 1, 1)];
    case "nextYear":
      return [partsToSerial(p.y + 1, 1, 1), partsToSerial(p.y + 2, 1, 1)];
    case "yearToDate":
      return [partsToSerial(p.y, 1, 1), now + 1];
    default:
      return null;
  }
}

/** Parses a criterion value as a number (numbers, dates, times); null for text. */
function critNumber(val: string): number | null {
  const p = parseInput(val);
  return p.t === "n" || p.t === "d" ? (p.v as number) : null;
}

function customMatches(cell: Cell, cond: CustomCondition): boolean {
  const v = cellScalar(cell);
  const display = cellDisplay(cell);
  const isText = typeof v === "string";
  const val = cond.val ?? "";
  switch (cond.op) {
    case "equals": {
      if (val === "") return v === null || display === "";
      if (wildcardRegex(val).test(display)) return true;
      const n = critNumber(val);
      return typeof v === "number" && !isDateCell(cell) && n !== null && Math.abs(v - n) < 1e-9;
    }
    case "doesNotEqual": {
      if (val === "") return !(v === null || display === "");
      if (wildcardRegex(val).test(display)) return false;
      const n = critNumber(val);
      return !(typeof v === "number" && n !== null && Math.abs(v - n) < 1e-9);
    }
    case "isGreaterThan":
    case "isGreaterThanOrEqualTo":
    case "isLessThan":
    case "isLessThanOrEqualTo": {
      if (v === null || isError(v)) return false;
      const n = critNumber(val);
      let c: number;
      if (n !== null) {
        if (typeof v !== "number") return false;
        c = v === n ? 0 : v < n ? -1 : 1;
      } else {
        if (!isText) return false;
        const a = display.toLowerCase();
        const b = val.toLowerCase();
        c = a === b ? 0 : a < b ? -1 : 1;
      }
      if (cond.op === "isGreaterThan") return c > 0;
      if (cond.op === "isGreaterThanOrEqualTo") return c >= 0;
      if (cond.op === "isLessThan") return c < 0;
      return c <= 0;
    }
    case "beginsWith":
      return isText && wildcardRegex(val + "*").test(display);
    case "endsWith":
      return isText && wildcardRegex("*" + val).test(display);
    case "contains":
      return isText && wildcardRegex("*" + val + "*").test(display);
    case "doesNotBeginWith":
      return !(isText && wildcardRegex(val + "*").test(display));
    case "doesNotEndWith":
      return !(isText && wildcardRegex("*" + val).test(display));
    case "doesNotContain":
      return !(isText && wildcardRegex("*" + val + "*").test(display));
  }
}

function dateGroupMatches(serial: number, item: DateGroupItem): boolean {
  const p = serialToParts(serial);
  if (p.y !== item.y) return false;
  const order: DateGrouping[] = ["year", "month", "day", "hour", "minute", "second"];
  const lvl = order.indexOf(item.grouping);
  if (lvl >= 1 && p.m !== item.m) return false;
  if (lvl >= 2 && p.d !== item.d) return false;
  if (lvl >= 3 && p.hh !== item.hh) return false;
  if (lvl >= 4 && p.mm !== item.mm) return false;
  if (lvl >= 5 && p.ss !== item.ss) return false;
  return true;
}

function cellMatches(cell: Cell, f: ColumnFilter, ctx: ColumnContext): boolean {
  const v = cellScalar(cell);
  switch (f.type) {
    case "values": {
      const text = cellDisplay(cell);
      if (v === null || text === "") return !!f.blank;
      if (isDateCell(cell) && typeof v === "number" && f.dates && f.dates.length) {
        if (f.dates.some((d) => dateGroupMatches(v, d))) return true;
      }
      const lower = text.toLowerCase();
      return f.values.some((x) => x.toLowerCase() === lower);
    }
    case "custom": {
      const conds = f.conditions.filter(Boolean);
      if (!conds.length) return true;
      const res = conds.map((c) => customMatches(cell, c));
      return f.and ? res.every(Boolean) : res.some(Boolean);
    }
    case "top10": {
      if (typeof v !== "number" || !ctx.threshold) return false;
      return ctx.threshold.top ? v >= ctx.threshold.cut : v <= ctx.threshold.cut;
    }
    case "dynamic": {
      if (f.dynamic === "aboveAverage" || f.dynamic === "belowAverage") {
        if (typeof v !== "number" || ctx.average === undefined) return false;
        return f.dynamic === "aboveAverage" ? v > ctx.average : v < ctx.average;
      }
      if (typeof v !== "number") return false;
      const mq = f.dynamic.match(/^([mq])(\d+)$/);
      if (mq) {
        const p = serialToParts(v);
        const n = Number(mq[2]);
        return mq[1] === "m" ? p.m === n : Math.floor((p.m - 1) / 3) + 1 === n;
      }
      const b = periodBounds(f.dynamic, ctx.now);
      if (!b) return false;
      const d = dayOf(v);
      return d >= b[0] && d < b[1];
    }
    case "color": {
      if (f.cellColor !== undefined) {
        const bg = normColor(cell && typeof cell === "object" ? cell.bg : null);
        const want = f.cellColor === null ? null : normColor(f.cellColor);
        if (bg !== want) return false;
      }
      if (f.fontColor !== undefined) {
        const fc = normColor(cell && typeof cell === "object" ? cell.fc : null) ?? (f.fontColor === null ? null : "#000000");
        const want = f.fontColor === null ? null : normColor(f.fontColor);
        if (fc !== want) return false;
      }
      return true;
    }
  }
}

/** The data rows (absolute indices) the filter hides. The header row is never hidden. */
export function hiddenRows(grid: Grid, state: FilterState | null, opts: FilterOptions = {}): Set<number> {
  const out = new Set<number>();
  if (!state) return out;
  const { range } = state;
  for (const [key, f] of Object.entries(state.columns)) {
    if (!f) continue;
    const colId = Number(key);
    const col = range.c1 + colId;
    if (col > range.c2) continue;
    const ctx = columnContext(grid, state, colId, opts);
    for (let r = range.r1 + 1; r <= range.r2; r++) {
      if (out.has(r)) continue;
      if (!cellMatches(grid[r]?.[col] ?? null, f, ctx)) out.add(r);
    }
  }
  return out;
}

/** True when any column carries a criterion. */
export function isFiltering(state: FilterState | null): boolean {
  return !!state && Object.values(state.columns).some(Boolean);
}

export function setColumnFilter(state: FilterState, colId: number, f: ColumnFilter | null): FilterState {
  const columns = { ...state.columns };
  if (f) columns[String(colId)] = f;
  else delete columns[String(colId)];
  return { ...state, columns };
}

/** Clears every criterion but keeps the filter (Excel "Show all data" / Sheets "Clear"). */
export function showAllData(state: FilterState): FilterState {
  return { ...state, columns: {} };
}

// ---- sorting from the filter menu ------------------------------------------------------

/**
 * Sorts the filter's data rows (header excluded) by a column. Returns the new
 * row block (cells of range columns only) and the updated state.
 */
export function sortByColumn(
  grid: Grid,
  state: FilterState,
  colId: number,
  desc: boolean,
): { rows: CellGrid; r1: number; c1: number; state: FilterState } {
  const { r1, c1, r2, c2 } = state.range;
  const block: CellGrid = [];
  for (let r = r1 + 1; r <= r2; r++) {
    const row = [];
    for (let c = c1; c <= c2; c++) row.push((grid[r]?.[c] ?? null) as Record<string, unknown> | null);
    block.push(row);
  }
  return {
    rows: sortGridRows(block, colId, !desc),
    r1: r1 + 1,
    c1,
    state: { ...state, sort: { colId, desc } },
  };
}

// ---- Excel-API view (Range.AutoFilter / AutoFilter.Filters) ----------------------------------

export type XlOperator =
  | "xlAnd"
  | "xlOr"
  | "xlFilterValues"
  | "xlTop10Items"
  | "xlBottom10Items"
  | "xlTop10Percent"
  | "xlBottom10Percent"
  | "xlFilterDynamic"
  | "xlFilterCellColor"
  | "xlFilterFontColor";

export interface XlFilter {
  Criteria1: string | string[] | number | null;
  Criteria2: string | null;
  Operator: XlOperator | null;
  On: boolean;
}

const OP_SIGNS: [string, CustomOp][] = [
  ["<>", "doesNotEqual"],
  [">=", "isGreaterThanOrEqualTo"],
  ["<=", "isLessThanOrEqualTo"],
  [">", "isGreaterThan"],
  ["<", "isLessThan"],
  ["=", "equals"],
];

/** "=5", ">3", "<>x", "abc*" → a custom condition (text patterns become begins/ends/contains). */
export function conditionFromCriteria(c: string): CustomCondition {
  const s = String(c);
  for (const [sign, op] of OP_SIGNS) {
    if (s.startsWith(sign)) return textPattern(op, s.slice(sign.length));
  }
  return textPattern("equals", s);
}

function textPattern(op: CustomOp, val: string): CustomCondition {
  if (op !== "equals" && op !== "doesNotEqual") return { op, val };
  const neg = op === "doesNotEqual";
  const inner = val.slice(1, -1);
  if (val.length > 2 && val.startsWith("*") && val.endsWith("*") && !/[*?]/.test(inner))
    return { op: neg ? "doesNotContain" : "contains", val: inner };
  if (val.length > 1 && val.endsWith("*") && !/[*?]/.test(val.slice(0, -1)))
    return { op: neg ? "doesNotBeginWith" : "beginsWith", val: val.slice(0, -1) };
  if (val.length > 1 && val.startsWith("*") && !/[*?]/.test(val.slice(1)))
    return { op: neg ? "doesNotEndWith" : "endsWith", val: val.slice(1) };
  return { op, val };
}

export function criteriaFromCondition(c: CustomCondition): string {
  switch (c.op) {
    case "equals":
      return "=" + c.val;
    case "doesNotEqual":
      return "<>" + c.val;
    case "isGreaterThan":
      return ">" + c.val;
    case "isGreaterThanOrEqualTo":
      return ">=" + c.val;
    case "isLessThan":
      return "<" + c.val;
    case "isLessThanOrEqualTo":
      return "<=" + c.val;
    case "beginsWith":
      return "=" + c.val + "*";
    case "endsWith":
      return "=*" + c.val;
    case "contains":
      return "=*" + c.val + "*";
    case "doesNotBeginWith":
      return "<>" + c.val + "*";
    case "doesNotEndWith":
      return "<>*" + c.val;
    case "doesNotContain":
      return "<>*" + c.val + "*";
  }
}

const DYNAMIC_XL: Record<string, DynamicType> = {
  xlFilterAboveAverage: "aboveAverage",
  xlFilterBelowAverage: "belowAverage",
  xlFilterToday: "today",
  xlFilterYesterday: "yesterday",
  xlFilterTomorrow: "tomorrow",
  xlFilterThisWeek: "thisWeek",
  xlFilterLastWeek: "lastWeek",
  xlFilterNextWeek: "nextWeek",
  xlFilterThisMonth: "thisMonth",
  xlFilterLastMonth: "lastMonth",
  xlFilterNextMonth: "nextMonth",
  xlFilterThisQuarter: "thisQuarter",
  xlFilterLastQuarter: "lastQuarter",
  xlFilterNextQuarter: "nextQuarter",
  xlFilterThisYear: "thisYear",
  xlFilterLastYear: "lastYear",
  xlFilterNextYear: "nextYear",
  xlFilterYearToDate: "yearToDate",
};

export class FilterApiError extends Error {}

/**
 * Range.AutoFilter(Field, Criteria1, Operator, Criteria2) semantics:
 * field null removes the filter; criteria null clears the column; an invalid
 * or out-of-range field throws and leaves the sheet unchanged.
 */
export function setAutoFilter(
  grid: Grid,
  current: FilterState | null,
  sel: FilterRange,
  field?: number | string | null,
  criteria1?: unknown,
  operator?: XlOperator | null,
  criteria2?: unknown,
): FilterState | null {
  if (field === null) return null;
  const base = current ?? createFilter(grid, sel);
  if (field === undefined) return base;
  const f = typeof field === "number" ? field : Number.NaN;
  if (!Number.isInteger(f) || f < 1) throw new FilterApiError("Invalid field");
  if (!base) return null;
  if (f > base.range.c2 - base.range.c1 + 1) throw new FilterApiError("Field out of range");
  const colId = f - 1;
  if (criteria1 === null && operator == null) return setColumnFilter(base, colId, null);
  let cf: ColumnFilter;
  switch (operator) {
    case "xlFilterValues": {
      const list = (Array.isArray(criteria1) ? criteria1 : [criteria1]).map((x) => String(x));
      if (list.length <= 2) {
        cf = { type: "custom", and: false, conditions: list.map((x) => ({ op: "equals" as const, val: x })) };
      } else {
        cf = { type: "values", values: list };
      }
      break;
    }
    case "xlTop10Items":
    case "xlBottom10Items":
    case "xlTop10Percent":
    case "xlBottom10Percent":
      cf = {
        type: "top10",
        top: operator.startsWith("xlTop"),
        percent: operator.endsWith("Percent"),
        val: Number(criteria1),
      };
      break;
    case "xlFilterDynamic": {
      const d = DYNAMIC_XL[String(criteria1)];
      if (!d) throw new FilterApiError("Unknown dynamic filter");
      cf = { type: "dynamic", dynamic: d };
      break;
    }
    case "xlFilterCellColor":
      cf = { type: "color", cellColor: colorArg(criteria1) };
      break;
    case "xlFilterFontColor":
      cf = { type: "color", fontColor: colorArg(criteria1) };
      break;
    default: {
      const conds = [conditionFromCriteria(String(criteria1))];
      if (criteria2 !== undefined && criteria2 !== null) conds.push(conditionFromCriteria(String(criteria2)));
      cf = { type: "custom", and: operator === "xlAnd", conditions: conds };
    }
  }
  return setColumnFilter(base, colId, cf);
}

function colorArg(x: unknown): string | null {
  if (x == null) return null;
  if (typeof x === "string") return normColor(x);
  const o = x as { r?: number; g?: number; b?: number };
  if (typeof o.r === "number") return normColor(`rgb(${o.r},${o.g ?? 0},${o.b ?? 0})`);
  return null;
}

/** AutoFilter.Filters: one entry per column of the range. */
export function apiFilters(state: FilterState | null): XlFilter[] {
  if (!state) return [];
  const out: XlFilter[] = [];
  for (let i = 0; i <= state.range.c2 - state.range.c1; i++) {
    const f = state.columns[String(i)];
    out.push(apiFilter(f));
  }
  return out;
}

function apiFilter(f: ColumnFilter | undefined): XlFilter {
  if (!f) return { Criteria1: null, Criteria2: null, Operator: null, On: false };
  switch (f.type) {
    case "values":
      return { Criteria1: [...f.values], Criteria2: null, Operator: "xlFilterValues", On: true };
    case "custom":
      return {
        Criteria1: f.conditions[0] ? criteriaFromCondition(f.conditions[0]) : null,
        Criteria2: f.conditions[1] ? criteriaFromCondition(f.conditions[1]) : null,
        Operator: f.and ? "xlAnd" : "xlOr",
        On: true,
      };
    case "top10":
      return {
        Criteria1: f.val,
        Criteria2: null,
        Operator: `xl${f.top ? "Top" : "Bottom"}10${f.percent ? "Percent" : "Items"}` as XlOperator,
        On: true,
      };
    case "dynamic": {
      const name = Object.keys(DYNAMIC_XL).find((k) => DYNAMIC_XL[k] === f.dynamic) ?? f.dynamic;
      return { Criteria1: name, Criteria2: null, Operator: "xlFilterDynamic", On: true };
    }
    case "color":
      return {
        Criteria1: null,
        Criteria2: null,
        Operator: f.fontColor !== undefined ? "xlFilterFontColor" : "xlFilterCellColor",
        On: true,
      };
  }
}

// ---- which column's menu opens from the keyboard (Alt+Down) ---------------------------------

export interface FilterHost {
  /** null for the sheet AutoFilter, the table index for a table's filter. */
  id: number | null;
  range: FilterRange;
  isTable?: boolean;
  /** Tables only: whether the header row is shown. */
  headerRow?: boolean;
  /** Tables only: per-column button visibility (default all shown). */
  buttons?: boolean[];
}

export interface Merge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/**
 * The filter column whose menu opens for the active cell: the active cell (or
 * the merged block it sits in) must be a header cell of a filter range. Table
 * filters respect hidden buttons and a hidden header row.
 */
export function filterColumnAt(
  hosts: FilterHost[],
  active: { r: number; c: number },
  merges: Merge[] = [],
): { id: number | null; colId: number } | null {
  const m = merges.find((x) => active.r >= x.r1 && active.r <= x.r2 && active.c >= x.c1 && active.c <= x.c2);
  const r = m ? m.r1 : active.r;
  const c = m ? m.c1 : active.c;
  for (const h of hosts) {
    if (h.isTable && h.headerRow === false) continue;
    if (r !== h.range.r1) continue;
    if (m && m.r2 !== m.r1) continue;
    if (c < h.range.c1 || c > h.range.c2) continue;
    const colId = c - h.range.c1;
    if (h.isTable && h.buttons && h.buttons[colId] === false) return null;
    return { id: h.id, colId };
  }
  return null;
}
