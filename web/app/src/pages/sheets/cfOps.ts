/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet rule objects are loosely typed. */

// Conditional formatting: the rule model, the Excel-style evaluator and the
// bridge to FortuneSheet. Rules live on each sheet as `grownCF` (CfRule[]).
// evaluateCF() gives, per cell, the winning fill/font colour plus any colour
// scale, data bar and icon. Font colours are handed to FortuneSheet as derived
// `luckysheet_conditionformat_save` entries (it paints those natively); fills,
// scales, bars and icons are painted by sheetDataTools.ts through the grid's
// render hooks.
//
// Priority: 1 is the highest. For each cell, rules run in priority order; a
// higher-priority rule's properties win over lower ones, and a matching rule
// with stopIfTrue ends the evaluation for that cell (Excel semantics).

import type { CellRect } from "./cellRange";
import { rectIntersection, rectsSubtract } from "./cellRange";
import {
  cellDisplay,
  cellScalar,
  colToLetters,
  dateToSerial,
  isError,
  mixColor,
  normColor,
  serialToParts,
  partsToSerial,
  type Cell,
  type Grid,
  type Scalar,
} from "./cellValue";
import {
  compareScalars,
  evaluateFormula,
  formulaIsTrue,
  percentileInc,
  toText,
  type EvalContext,
} from "./sheetFormula";

export type CfType =
  | "cellIs"
  | "containsText"
  | "notContainsText"
  | "beginsWith"
  | "endsWith"
  | "timePeriod"
  | "containsBlanks"
  | "notContainsBlanks"
  | "containsErrors"
  | "notContainsErrors"
  | "duplicateValues"
  | "uniqueValues"
  | "top10"
  | "aboveAverage"
  | "expression"
  | "colorScale"
  | "dataBar"
  | "iconSet";

export type CellIsOp =
  | "between"
  | "notBetween"
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual";

export type TimePeriod =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "last7Days"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek"
  | "thisMonth"
  | "lastMonth"
  | "nextMonth";

export type CfvoType = "min" | "max" | "autoMin" | "autoMax" | "num" | "percent" | "percentile" | "formula";

/** A threshold ("conditional format value object"). */
export interface Cfvo {
  type: CfvoType;
  value?: string;
  /** Icon sets: true for ≥ (default), false for >. */
  gte?: boolean;
}

export interface CfStyle {
  fill?: string | null;
  color?: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export type IconSetName =
  | "3Arrows"
  | "3ArrowsGray"
  | "3Flags"
  | "3TrafficLights1"
  | "3TrafficLights2"
  | "3Signs"
  | "3Symbols"
  | "3Symbols2"
  | "3Stars"
  | "3Triangles"
  | "4Arrows"
  | "4ArrowsGray"
  | "4RedToBlack"
  | "4Rating"
  | "4TrafficLights"
  | "5Arrows"
  | "5ArrowsGray"
  | "5Rating"
  | "5Quarters"
  | "5Boxes";

export interface DataBarOptions {
  min: Cfvo;
  max: Cfvo;
  color: string;
  borderColor?: string | null;
  negativeColor: string;
  negativeBorderColor?: string | null;
  axisPosition: "automatic" | "middle" | "none";
  axisColor: string;
  direction: "context" | "leftToRight" | "rightToLeft";
  showValue: boolean;
  gradient: boolean;
  /** Shortest/longest bar as a percentage of the cell width. */
  minLength: number;
  maxLength: number;
}

export interface CfRule {
  id: string;
  type: CfType;
  /** Applies-to ranges. */
  ranges: CellRect[];
  /** 1 = highest. */
  priority: number;
  stopIfTrue?: boolean;
  style?: CfStyle;
  /** Cell relative references are anchored to (default: top-left of the first range). */
  base?: { r: number; c: number };
  // cellIs / expression
  operator?: CellIsOp;
  formula1?: string;
  formula2?: string;
  // text rules: literal text, or a formula when it starts with "="
  text?: string;
  // timePeriod
  period?: TimePeriod;
  // top10
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  // aboveAverage
  above?: boolean;
  equalAverage?: boolean;
  stdDev?: number;
  // colorScale
  cfvos?: Cfvo[];
  colors?: string[];
  // dataBar
  bar?: DataBarOptions;
  // iconSet (thresholds in cfvos; cfvos[0] is the lowest bucket and is ignored)
  iconSet?: IconSetName;
  reverse?: boolean;
  showValue?: boolean;
}

export interface CfBar {
  /** Bar start/end as fractions of the cell width (0 = left edge). */
  x0: number;
  x1: number;
  negative: boolean;
  /** Axis position (fraction of width) when drawn. */
  axis: number | null;
  color: string;
  border: string | null;
  axisColor: string;
  gradient: boolean;
}

export interface CfIcon {
  set: IconSetName;
  index: number;
}

export interface CfCellResult {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  bar?: CfBar;
  icon?: CfIcon;
  /** Data bar / icon set with "show bar/icon only". */
  hideValue?: boolean;
}

export interface CfOptions {
  now?: Date;
  sheets?: Record<string, Grid>;
  names?: Record<string, string>;
}

// ---- defaults & model helpers ---------------------------------------------------------

export const ICON_COUNTS: Record<IconSetName, number> = {
  "3Arrows": 3,
  "3ArrowsGray": 3,
  "3Flags": 3,
  "3TrafficLights1": 3,
  "3TrafficLights2": 3,
  "3Signs": 3,
  "3Symbols": 3,
  "3Symbols2": 3,
  "3Stars": 3,
  "3Triangles": 3,
  "4Arrows": 4,
  "4ArrowsGray": 4,
  "4RedToBlack": 4,
  "4Rating": 4,
  "4TrafficLights": 4,
  "5Arrows": 5,
  "5ArrowsGray": 5,
  "5Rating": 5,
  "5Quarters": 5,
  "5Boxes": 5,
};

let idSeq = 0;
export function newRuleId(): string {
  idSeq += 1;
  return `cf-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/** Evenly spaced percent thresholds for an icon set (3 → 0, 33, 67). */
export function iconSetCfvos(set: IconSetName): Cfvo[] {
  const n = ICON_COUNTS[set];
  return Array.from({ length: n }, (_, i) => ({ type: "percent" as const, value: String(Math.round((100 * i) / n)), gte: true }));
}

export function defaultDataBar(): DataBarOptions {
  return {
    min: { type: "autoMin" },
    max: { type: "autoMax" },
    color: "#638ec6",
    borderColor: null,
    negativeColor: "#ff0000",
    negativeBorderColor: null,
    axisPosition: "automatic",
    axisColor: "#000000",
    direction: "context",
    showValue: true,
    gradient: true,
    minLength: 0,
    maxLength: 100,
  };
}

/** A new rule of a type with Excel's defaults. */
export function newRule(type: CfType, ranges: CellRect[], init: Partial<CfRule> = {}): CfRule {
  const r: CfRule = { id: newRuleId(), type, ranges, priority: 1 };
  switch (type) {
    case "cellIs":
      r.operator = "greaterThan";
      r.formula1 = "0";
      r.style = { fill: "#ffc7ce", color: "#9c0006" };
      break;
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith":
      r.text = "";
      r.style = { fill: "#ffc7ce", color: "#9c0006" };
      break;
    case "timePeriod":
      r.period = "today";
      r.style = { fill: "#ffc7ce", color: "#9c0006" };
      break;
    case "top10":
      r.rank = 10;
      r.percent = false;
      r.bottom = false;
      r.style = { fill: "#ffc7ce", color: "#9c0006" };
      break;
    case "aboveAverage":
      r.above = true;
      r.equalAverage = false;
      r.stdDev = 0;
      r.style = { fill: "#ffc7ce", color: "#9c0006" };
      break;
    case "colorScale":
      r.cfvos = [{ type: "min" }, { type: "max" }];
      r.colors = ["#f8696b", "#63be7b"];
      break;
    case "dataBar":
      r.bar = defaultDataBar();
      break;
    case "iconSet":
      r.iconSet = "3TrafficLights1";
      r.cfvos = iconSetCfvos("3TrafficLights1");
      r.reverse = false;
      r.showValue = true;
      break;
    default:
      r.style = { fill: "#ffc7ce", color: "#9c0006" };
  }
  return { ...r, ...init };
}

/** A 2- or 3-colour scale with Excel's default stops (min, 50th percentile, max). */
export function colorScaleRule(ranges: CellRect[], stops: 2 | 3): CfRule {
  if (stops === 2) return newRule("colorScale", ranges);
  return newRule("colorScale", ranges, {
    cfvos: [{ type: "min" }, { type: "percentile", value: "50" }, { type: "max" }],
    colors: ["#f8696b", "#ffeb84", "#63be7b"],
  });
}

/** Switches the icon set, regenerating thresholds when the icon count changes. */
export function setIconSet(rule: CfRule, set: IconSetName): CfRule {
  const same = rule.cfvos && rule.cfvos.length === ICON_COUNTS[set];
  return { ...rule, iconSet: set, cfvos: same ? rule.cfvos : iconSetCfvos(set) };
}

/** Appends a rule with the next (lowest) priority. */
export function addRule(rules: CfRule[], rule: CfRule): CfRule[] {
  const max = rules.reduce((m, r) => Math.max(m, r.priority), 0);
  return [...rules, { ...rule, priority: max + 1 }];
}

export function sortByPriority(rules: CfRule[]): CfRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority);
}

/** Renumbers priorities 1..n keeping the current order. */
export function normalizePriorities(rules: CfRule[]): CfRule[] {
  const order = sortByPriority(rules).map((r) => r.id);
  return rules.map((r) => ({ ...r, priority: order.indexOf(r.id) + 1 }));
}

export function setFirstPriority(rules: CfRule[], id: string): CfRule[] {
  const rest = sortByPriority(rules).filter((r) => r.id !== id);
  const target = rules.find((r) => r.id === id);
  if (!target) return rules;
  return [target, ...rest].map((r, i) => ({ ...r, priority: i + 1 }));
}

export function setLastPriority(rules: CfRule[], id: string): CfRule[] {
  const rest = sortByPriority(rules).filter((r) => r.id !== id);
  const target = rules.find((r) => r.id === id);
  if (!target) return rules;
  return [...rest, target].map((r, i) => ({ ...r, priority: i + 1 }));
}

/** Sets an explicit priority; rules already at or below it move down by one. */
export function setPriority(rules: CfRule[], id: string, priority: number): CfRule[] {
  const clash = rules.some((r) => r.id !== id && r.priority === priority);
  return rules.map((r) => {
    if (r.id === id) return { ...r, priority };
    if (clash && r.priority >= priority) return { ...r, priority: r.priority + 1 };
    return r;
  });
}

/** Moves a rule one step up (-1) or down (+1) in priority order. */
export function moveRule(rules: CfRule[], id: string, dir: -1 | 1): CfRule[] {
  const sorted = sortByPriority(rules);
  const i = sorted.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return rules;
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.map((r, k) => ({ ...r, priority: k + 1 }));
}

/** Rules whose applies-to ranges intersect `rect`. */
export function rulesInRange(rules: CfRule[], rect: CellRect): CfRule[] {
  return rules.filter((r) => r.ranges.some((x) => rectIntersection(x, rect)));
}

/** Clears rules from a range: ranges are trimmed and emptied rules are dropped. */
export function clearRulesInRange(rules: CfRule[], rect: CellRect): CfRule[] {
  return rules
    .map((r) => ({ ...r, ranges: rectsSubtract(r.ranges, rect) }))
    .filter((r) => r.ranges.length > 0);
}

export function deleteRule(rules: CfRule[], id: string): CfRule[] {
  return rules.filter((r) => r.id !== id);
}

function topLeft(rule: CfRule): { r: number; c: number } {
  if (rule.base) return rule.base;
  const first = rule.ranges[0] ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
  return { r: Math.min(first.r1, first.r2), c: Math.min(first.c1, first.c2) };
}

function quoteText(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** The formula Excel stores for a text rule, e.g. NOT(ISERROR(SEARCH("x",A1))). */
export function textRuleFormula(rule: CfRule): string {
  const tl = topLeft(rule);
  const ref = `${colToLetters(tl.c)}${tl.r + 1}`;
  const t = rule.text ?? "";
  const arg = t.startsWith("=") ? t.slice(1) : quoteText(t);
  switch (rule.type) {
    case "containsText":
      return `NOT(ISERROR(SEARCH(${arg},${ref})))`;
    case "notContainsText":
      return `ISERROR(SEARCH(${arg},${ref}))`;
    case "beginsWith":
      return `LEFT(${ref},LEN(${arg}))=${arg}`;
    case "endsWith":
      return `RIGHT(${ref},LEN(${arg}))=${arg}`;
    default:
      return rule.formula1 ?? "";
  }
}

// ---- evaluation -------------------------------------------------------------------------

interface CellPos {
  r: number;
  c: number;
}

function ruleCells(rule: CfRule, grid: Grid): CellPos[] {
  const rows = grid.length;
  const cols = grid.reduce((m, row) => Math.max(m, row ? row.length : 0), 0);
  const seen = new Set<string>();
  const out: CellPos[] = [];
  for (const rg of rule.ranges) {
    const r1 = Math.max(0, Math.min(rg.r1, rg.r2));
    const r2 = Math.min(rows - 1, Math.max(rg.r1, rg.r2));
    const c1 = Math.max(0, Math.min(rg.c1, rg.c2));
    const c2 = Math.min(cols - 1, Math.max(rg.c1, rg.c2));
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const k = `${r}_${c}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ r, c });
      }
    }
  }
  return out;
}

function numericValues(cells: CellPos[], grid: Grid): number[] {
  const out: number[] = [];
  for (const p of cells) {
    const v = cellScalar(grid[p.r]?.[p.c]);
    if (typeof v === "number") out.push(v);
  }
  return out;
}

function evalCtx(rule: CfRule, grid: Grid, p: CellPos, opts: CfOptions): EvalContext {
  const tl = topLeft(rule);
  return { grid, sheets: opts.sheets, names: opts.names, dr: p.r - tl.r, dc: p.c - tl.c, row: p.r, col: p.c, now: opts.now };
}

/** A constant or formula operand (cellIs values, thresholds). */
function operand(src: string | undefined, ctx: EvalContext): Scalar {
  const s = (src ?? "").trim();
  if (s === "") return null;
  if (s.startsWith("=")) return evaluateFormula(s, ctx);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  // A bare reference or expression (Excel stores "A1", "$B$2*2").
  if (/^[$A-Za-z(]/.test(s) && /[A-Za-z]+\$?\d|\(/.test(s) && !/^"/.test(s)) {
    const v = evaluateFormula("=" + s, ctx);
    if (!(isError(v) && v.error === "#NAME?")) return v;
  }
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/""/g, '"');
  return s;
}

function periodMatch(period: TimePeriod, v: number, today: number): boolean {
  const d = Math.floor(v);
  const p = serialToParts(today);
  switch (period) {
    case "today":
      return d === today;
    case "yesterday":
      return d === today - 1;
    case "tomorrow":
      return d === today + 1;
    case "last7Days":
      return d >= today - 6 && d <= today;
    case "thisWeek":
    case "lastWeek":
    case "nextWeek": {
      const start = today - p.dow + (period === "lastWeek" ? -7 : period === "nextWeek" ? 7 : 0);
      return d >= start && d < start + 7;
    }
    case "thisMonth":
    case "lastMonth":
    case "nextMonth": {
      const off = period === "lastMonth" ? -1 : period === "nextMonth" ? 1 : 0;
      return d >= partsToSerial(p.y, p.m + off, 1) && d < partsToSerial(p.y, p.m + off + 1, 1);
    }
  }
}

interface RuleStats {
  values: number[];
  min: number;
  max: number;
  avg: number;
  sd: number;
  counts?: Map<string, number>;
  cut?: number;
}

function stats(rule: CfRule, cells: CellPos[], grid: Grid): RuleStats {
  const values = numericValues(cells, grid);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const sd =
    values.length > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - avg) ** 2, 0) / (values.length - 1)) : 0;
  const st: RuleStats = { values, min, max, avg, sd };
  if (rule.type === "duplicateValues" || rule.type === "uniqueValues") {
    const counts = new Map<string, number>();
    for (const p of cells) {
      const k = dupKey(grid[p.r]?.[p.c]);
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    st.counts = counts;
  }
  if (rule.type === "top10" && values.length) {
    const sorted = [...values].sort((a, b) => (rule.bottom ? a - b : b - a));
    const rank = Math.max(1, Number(rule.rank ?? 10));
    let n = rule.percent ? Math.floor((values.length * rank) / 100) : Math.floor(rank);
    n = Math.max(1, Math.min(values.length, n));
    st.cut = sorted[n - 1];
  }
  return st;
}

function dupKey(cell: Cell): string | null {
  const v = cellScalar(cell);
  if (v === null || v === "") return null;
  if (isError(v)) return "e:" + v.error;
  if (typeof v === "number") return "n:" + v;
  if (typeof v === "boolean") return "b:" + v;
  return "s:" + v.toLowerCase();
}

/** Resolves a threshold to a number over the rule's numeric values. */
export function cfvoNumber(cfvo: Cfvo, st: RuleStats, ctx: EvalContext): number | null {
  const n = (s?: string) => {
    const v = operand(s, ctx);
    return typeof v === "number" ? v : null;
  };
  switch (cfvo.type) {
    case "min":
      return st.min;
    case "max":
      return st.max;
    case "autoMin":
      return Math.min(0, st.min);
    case "autoMax":
      return Math.max(0, st.max);
    case "num":
    case "formula":
      return n(cfvo.value);
    case "percent": {
      const p = n(cfvo.value);
      return p === null ? null : st.min + ((st.max - st.min) * p) / 100;
    }
    case "percentile": {
      const p = n(cfvo.value);
      if (p === null || !st.values.length) return null;
      return percentileInc(st.values, Math.max(0, Math.min(1, p / 100)));
    }
  }
}

/** Whether a formatting rule matches a cell (scales, bars and icons use their own paths). */
function matches(rule: CfRule, grid: Grid, p: CellPos, st: RuleStats, opts: CfOptions): boolean {
  const cell = grid[p.r]?.[p.c] ?? null;
  const v = cellScalar(cell);
  const ctx = evalCtx(rule, grid, p, opts);
  switch (rule.type) {
    case "cellIs": {
      if (isError(v)) return false;
      const a = operand(rule.formula1, ctx);
      if (isError(a)) return false;
      const cmp = (x: Scalar) => compareScalars(v, x);
      switch (rule.operator ?? "equal") {
        case "equal":
          return cmp(a) === 0;
        case "notEqual":
          return cmp(a) !== 0;
        case "greaterThan":
          return cmp(a) > 0;
        case "lessThan":
          return cmp(a) < 0;
        case "greaterThanOrEqual":
          return cmp(a) >= 0;
        case "lessThanOrEqual":
          return cmp(a) <= 0;
        case "between":
        case "notBetween": {
          const b = operand(rule.formula2, ctx);
          if (isError(b)) return false;
          const lo = compareScalars(a, b) <= 0 ? a : b;
          const hi = lo === a ? b : a;
          const inside = cmp(lo) >= 0 && cmp(hi) <= 0;
          return rule.operator === "between" ? inside : !inside;
        }
      }
      return false;
    }
    case "containsText":
    case "notContainsText":
    case "beginsWith":
    case "endsWith": {
      const t = rule.text ?? "";
      let needle: Scalar = t;
      if (t.startsWith("=")) needle = evaluateFormula(t, ctx);
      if (isError(needle)) return false;
      if (isError(v)) return false;
      const hay = (toText(v) as string).toLowerCase();
      const nd = (toText(needle) as string).toLowerCase();
      if (rule.type === "containsText") return hay.includes(nd);
      if (rule.type === "notContainsText") return !hay.includes(nd);
      if (rule.type === "beginsWith") return hay.startsWith(nd);
      return hay.endsWith(nd);
    }
    case "timePeriod": {
      if (typeof v !== "number") return false;
      return periodMatch(rule.period ?? "today", v, dateToSerial(opts.now ?? new Date()));
    }
    case "containsBlanks":
      return v === null || cellDisplay(cell).trim() === "";
    case "notContainsBlanks":
      return !(v === null || cellDisplay(cell).trim() === "");
    case "containsErrors":
      return isError(v);
    case "notContainsErrors":
      return !isError(v);
    case "duplicateValues":
    case "uniqueValues": {
      const k = dupKey(cell);
      if (k === null) return false;
      const n = st.counts?.get(k) ?? 0;
      return rule.type === "duplicateValues" ? n > 1 : n === 1;
    }
    case "top10": {
      if (typeof v !== "number" || st.cut === undefined) return false;
      return rule.bottom ? v <= st.cut : v >= st.cut;
    }
    case "aboveAverage": {
      if (typeof v !== "number" || !st.values.length) return false;
      const k = rule.stdDev ?? 0;
      const above = rule.above !== false;
      if (k > 0) return above ? v > st.avg + k * st.sd : v < st.avg - k * st.sd;
      if (rule.equalAverage) return above ? v >= st.avg : v <= st.avg;
      return above ? v > st.avg : v < st.avg;
    }
    case "expression":
      return formulaIsTrue(rule.formula1 ?? "", ctx);
    default:
      return false;
  }
}

function scaleColor(rule: CfRule, v: number, st: RuleStats, ctx: EvalContext): string | null {
  const cfvos = rule.cfvos ?? [];
  const colors = rule.colors ?? [];
  if (cfvos.length < 2 || colors.length < cfvos.length) return null;
  const stops: { x: number; c: string }[] = [];
  for (let i = 0; i < cfvos.length; i++) {
    const x = cfvoNumber(cfvos[i], st, ctx);
    if (x === null) return null;
    stops.push({ x, c: normColor(colors[i]) ?? "#ffffff" });
  }
  if (v <= stops[0].x) return stops[0].c;
  const last = stops[stops.length - 1];
  if (v >= last.x) return last.c;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (v >= a.x && v <= b.x) {
      const span = b.x - a.x;
      return span === 0 ? b.c : mixColor(a.c, b.c, (v - a.x) / span);
    }
  }
  return last.c;
}

function barFor(rule: CfRule, v: number, st: RuleStats, ctx: EvalContext): CfBar | null {
  const o = rule.bar ?? defaultDataBar();
  let lo = cfvoNumber(o.min, st, ctx);
  let hi = cfvoNumber(o.max, st, ctx);
  if (lo === null || hi === null) return null;
  if (lo > hi) [lo, hi] = [hi, lo];
  const minL = Math.max(0, Math.min(100, o.minLength)) / 100;
  const maxL = Math.max(0, Math.min(100, o.maxLength)) / 100;
  const rtl = o.direction === "rightToLeft";
  const flip = (a: number, b: number): [number, number] => (rtl ? [1 - b, 1 - a] : [a, b]);
  const clamp = (x: number) => Math.max(lo!, Math.min(hi!, x));
  const x = clamp(v);
  const hasNeg = lo < 0 && o.axisPosition !== "none";
  if (!hasNeg) {
    const span = hi - lo;
    const t = span === 0 ? 1 : (x - lo) / span;
    const len = minL + (maxL - minL) * t;
    const [x0, x1] = flip(0, len);
    return { x0, x1, negative: v < 0, axis: null, color: v < 0 && o.axisPosition === "none" ? o.color : o.color, border: o.borderColor ?? null, axisColor: o.axisColor, gradient: o.gradient };
  }
  // With an axis: negative bars grow left of it, positive bars right of it.
  let axis: number;
  let negSpan: number;
  let posSpan: number;
  if (o.axisPosition === "middle") {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    axis = 0.5;
    negSpan = m;
    posSpan = m;
  } else {
    const total = Math.max(0, hi) - lo;
    axis = total === 0 ? 0.5 : -lo / total;
    negSpan = -lo;
    posSpan = Math.max(0, hi);
  }
  let x0: number;
  let x1: number;
  if (x < 0) {
    const t = negSpan === 0 ? 0 : -x / negSpan;
    x0 = axis - axis * t;
    x1 = axis;
  } else {
    const t = posSpan === 0 ? 0 : x / posSpan;
    x0 = axis;
    x1 = axis + (1 - axis) * t;
  }
  [x0, x1] = flip(x0, x1);
  return {
    x0,
    x1,
    negative: x < 0,
    axis: rtl ? 1 - axis : axis,
    color: x < 0 ? o.negativeColor : o.color,
    border: (x < 0 ? o.negativeBorderColor : o.borderColor) ?? null,
    axisColor: o.axisColor,
    gradient: o.gradient,
  };
}

/** Icon bucket for a value: the highest threshold it reaches (0 = lowest icon). */
export function iconIndex(rule: CfRule, v: number, st: RuleStats, ctx: EvalContext): number | null {
  const set = rule.iconSet ?? "3TrafficLights1";
  const n = ICON_COUNTS[set];
  const cfvos = rule.cfvos && rule.cfvos.length === n ? rule.cfvos : iconSetCfvos(set);
  let idx = 0;
  for (let i = 1; i < n; i++) {
    const t = cfvoNumber(cfvos[i], st, ctx);
    if (t === null) return null;
    const gte = cfvos[i].gte !== false;
    if (gte ? v >= t : v > t) idx = i;
  }
  return rule.reverse ? n - 1 - idx : idx;
}

/**
 * Evaluates every rule over the grid. The result maps "r_c" to the cell's
 * conditional look (only cells with something to show are present).
 */
export function evaluateCF(rules: CfRule[], grid: Grid, opts: CfOptions = {}): Map<string, CfCellResult> {
  const out = new Map<string, CfCellResult>();
  const stopped = new Set<string>();
  // Style properties already claimed by a higher-priority rule.
  for (const rule of sortByPriority(rules)) {
    const cells = ruleCells(rule, grid);
    if (!cells.length) continue;
    const st = stats(rule, cells, grid);
    for (const p of cells) {
      const key = `${p.r}_${p.c}`;
      if (stopped.has(key)) continue;
      const cur = out.get(key) ?? {};
      let hit = false;
      if (rule.type === "colorScale" || rule.type === "dataBar" || rule.type === "iconSet") {
        const v = cellScalar(grid[p.r]?.[p.c]);
        if (typeof v !== "number") continue;
        const ctx = evalCtx(rule, grid, p, opts);
        if (rule.type === "colorScale") {
          const c = scaleColor(rule, v, st, ctx);
          if (c && cur.fill === undefined) {
            cur.fill = c;
            hit = true;
          }
        } else if (rule.type === "dataBar") {
          const b = barFor(rule, v, st, ctx);
          if (b && !cur.bar) {
            cur.bar = b;
            if (rule.bar && !rule.bar.showValue) cur.hideValue = true;
            hit = true;
          }
        } else {
          const i = iconIndex(rule, v, st, ctx);
          if (i !== null && !cur.icon) {
            cur.icon = { set: rule.iconSet ?? "3TrafficLights1", index: i };
            if (rule.showValue === false) cur.hideValue = true;
            hit = true;
          }
        }
      } else if (matches(rule, grid, p, st, opts)) {
        hit = true;
        const s = rule.style ?? {};
        if (s.fill && cur.fill === undefined) cur.fill = normColor(s.fill) ?? s.fill;
        if (s.color && cur.color === undefined) cur.color = normColor(s.color) ?? s.color;
        if (s.bold !== undefined && cur.bold === undefined) cur.bold = s.bold;
        if (s.italic !== undefined && cur.italic === undefined) cur.italic = s.italic;
        if (s.underline !== undefined && cur.underline === undefined) cur.underline = s.underline;
        if (s.strike !== undefined && cur.strike === undefined) cur.strike = s.strike;
      }
      if (hit) {
        out.set(key, cur);
        if (rule.stopIfTrue) stopped.add(key);
      }
    }
  }
  return out;
}

// ---- FortuneSheet bridge -----------------------------------------------------------------

type FsRange = { row: [number, number]; column: [number, number] };

function fsToRect(x: FsRange): CellRect {
  return { r1: x.row[0], r2: x.row[1], c1: x.column[0], c2: x.column[1] };
}

function rgbToHexLoose(c: unknown): string | null {
  return normColor(c);
}

/**
 * Converts FortuneSheet's own rules (legacy Grown dialog, or the grid toolbar)
 * into Grown rules. Derived entries written by toFortuneRules() are skipped.
 */
export function fromFortuneRules(list: any[]): CfRule[] {
  const out: CfRule[] = [];
  let prio = 1;
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || f.grownDerived) continue;
    const ranges = (Array.isArray(f.cellrange) ? f.cellrange : []).map(fsToRect);
    if (!ranges.length) continue;
    const style: CfStyle = {
      fill: rgbToHexLoose(f.format?.cellColor),
      color: rgbToHexLoose(f.format?.textColor),
    };
    const cv = Array.isArray(f.conditionValue) ? f.conditionValue.map((x: unknown) => String(x ?? "")) : [];
    let rule: CfRule | null = null;
    if (f.type === "colorGradation") {
      const colors = (Array.isArray(f.format) ? f.format : []).map((x: unknown) => normColor(x) ?? "#ffffff");
      rule = colors.length >= 3 ? colorScaleRule(ranges, 3) : colorScaleRule(ranges, 2);
      rule.colors = colors.length >= 3 ? colors.slice(0, 3) : colors.slice(0, 2);
    } else if (f.type === "dataBar") {
      const colors = (Array.isArray(f.format) ? f.format : []).map((x: unknown) => normColor(x));
      rule = newRule("dataBar", ranges);
      rule.bar = { ...defaultDataBar(), color: colors[colors.length - 1] ?? "#638ec6" };
    } else {
      switch (f.conditionName) {
        case "greaterThan":
        case "lessThan":
        case "equal":
          rule = newRule("cellIs", ranges, { operator: f.conditionName, formula1: cv[0] ?? "", style });
          break;
        case "between":
          rule = newRule("cellIs", ranges, { operator: "between", formula1: cv[0] ?? "", formula2: cv[1] ?? "", style });
          break;
        case "textContains":
          rule = newRule("containsText", ranges, { text: cv[0] ?? "", style });
          break;
        case "duplicateValue":
          rule = newRule(cv[0] === "1" ? "uniqueValues" : "duplicateValues", ranges, { style });
          break;
        case "top10":
        case "top10_percent":
        case "last10":
        case "last10_percent":
          rule = newRule("top10", ranges, {
            rank: Number(cv[0] ?? 10),
            percent: f.conditionName.endsWith("percent"),
            bottom: f.conditionName.startsWith("last"),
            style,
          });
          break;
        case "aboveAverage":
        case "belowAverage":
          rule = newRule("aboveAverage", ranges, { above: f.conditionName === "aboveAverage", style });
          break;
        case "formula":
          rule = newRule("expression", ranges, { formula1: cv[0]?.startsWith("=") ? cv[0] : "=" + (cv[0] ?? ""), style });
          break;
        case "occurrenceDate":
          rule = newRule("timePeriod", ranges, { period: "today", style });
          break;
        default:
          rule = null;
      }
    }
    if (rule) {
      rule.priority = prio++;
      out.push(rule);
    }
  }
  return out;
}

/**
 * FortuneSheet entries for what it can paint itself: font colours, grouped per
 * colour into rules that match every non-empty cell listed. Marked
 * `grownDerived` so they are never read back as user rules.
 */
export function toFortuneRules(result: Map<string, CfCellResult>): any[] {
  const groups = new Map<string, FsRange[]>();
  for (const [key, res] of result) {
    if (!res.color) continue;
    const [r, c] = key.split("_").map(Number);
    const list = groups.get(res.color) ?? [];
    list.push({ row: [r, r], column: [c, c] });
    groups.set(res.color, list);
  }
  const out: any[] = [];
  for (const [color, cellrange] of groups) {
    out.push({
      type: "default",
      grownDerived: true,
      cellrange: mergeRuns(cellrange),
      format: { textColor: color, cellColor: null },
      conditionName: "textContains",
      conditionRange: [],
      conditionValue: [""],
    });
  }
  return out;
}

/** Merges vertically adjacent single cells of a column into runs. */
function mergeRuns(cells: FsRange[]): FsRange[] {
  const sorted = [...cells].sort((a, b) => a.column[0] - b.column[0] || a.row[0] - b.row[0]);
  const out: FsRange[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && last.column[0] === x.column[0] && last.row[1] + 1 === x.row[0]) last.row[1] = x.row[0];
    else out.push({ row: [x.row[0], x.row[1]], column: [x.column[0], x.column[1]] });
  }
  return out;
}

// ---- icon glyphs (for the renderer and the dialog preview) ---------------------------------

export type IconShape =
  | "arrowUp"
  | "arrowDown"
  | "arrowRight"
  | "arrowUpRight"
  | "arrowDownRight"
  | "circle"
  | "flag"
  | "star"
  | "starHalf"
  | "starEmpty"
  | "triUp"
  | "triDown"
  | "dash"
  | "check"
  | "cross"
  | "excl"
  | "diamond"
  | "triangle"
  | "quarter"
  | "bars"
  | "box";

export interface IconGlyph {
  shape: IconShape;
  color: string;
  /** Fill level 0..4 for quarters/bars/boxes. */
  level?: number;
}

const G = (shape: IconShape, color: string, level?: number): IconGlyph => ({ shape, color, level });
const RED = "#e0463c";
const YEL = "#f2c037";
const GRN = "#4caf50";
const GRY = "#7f7f7f";
const BLK = "#303030";
const BLU = "#4a78c2";

/** Icons of each set from the lowest bucket to the highest. */
export const ICON_SETS: Record<IconSetName, IconGlyph[]> = {
  "3Arrows": [G("arrowDown", RED), G("arrowRight", YEL), G("arrowUp", GRN)],
  "3ArrowsGray": [G("arrowDown", GRY), G("arrowRight", GRY), G("arrowUp", GRY)],
  "3Flags": [G("flag", RED), G("flag", YEL), G("flag", GRN)],
  "3TrafficLights1": [G("circle", RED), G("circle", YEL), G("circle", GRN)],
  "3TrafficLights2": [G("circle", RED), G("circle", YEL), G("circle", GRN)],
  "3Signs": [G("diamond", RED), G("triangle", YEL), G("circle", GRN)],
  "3Symbols": [G("cross", RED), G("excl", YEL), G("check", GRN)],
  "3Symbols2": [G("cross", RED), G("excl", YEL), G("check", GRN)],
  "3Stars": [G("starEmpty", YEL), G("starHalf", YEL), G("star", YEL)],
  "3Triangles": [G("triDown", RED), G("dash", YEL), G("triUp", GRN)],
  "4Arrows": [G("arrowDown", RED), G("arrowDownRight", YEL), G("arrowUpRight", YEL), G("arrowUp", GRN)],
  "4ArrowsGray": [G("arrowDown", GRY), G("arrowDownRight", GRY), G("arrowUpRight", GRY), G("arrowUp", GRY)],
  "4RedToBlack": [G("circle", BLK), G("circle", GRY), G("circle", "#f4a0a0"), G("circle", RED)],
  "4Rating": [G("bars", BLU, 1), G("bars", BLU, 2), G("bars", BLU, 3), G("bars", BLU, 4)],
  "4TrafficLights": [G("circle", BLK), G("circle", RED), G("circle", YEL), G("circle", GRN)],
  "5Arrows": [
    G("arrowDown", RED),
    G("arrowDownRight", YEL),
    G("arrowRight", YEL),
    G("arrowUpRight", YEL),
    G("arrowUp", GRN),
  ],
  "5ArrowsGray": [
    G("arrowDown", GRY),
    G("arrowDownRight", GRY),
    G("arrowRight", GRY),
    G("arrowUpRight", GRY),
    G("arrowUp", GRY),
  ],
  "5Rating": [G("bars", BLU, 0), G("bars", BLU, 1), G("bars", BLU, 2), G("bars", BLU, 3), G("bars", BLU, 4)],
  "5Quarters": [G("quarter", BLK, 0), G("quarter", BLK, 1), G("quarter", BLK, 2), G("quarter", BLK, 3), G("quarter", BLK, 4)],
  "5Boxes": [G("box", BLU, 0), G("box", BLU, 1), G("box", BLU, 2), G("box", BLU, 3), G("box", BLU, 4)],
};

export const ICON_SET_LABELS: Record<IconSetName, string> = {
  "3Arrows": "3 arrows (coloured)",
  "3ArrowsGray": "3 arrows (grey)",
  "3Flags": "3 flags",
  "3TrafficLights1": "3 traffic lights",
  "3TrafficLights2": "3 traffic lights (rimmed)",
  "3Signs": "3 signs",
  "3Symbols": "3 symbols (circled)",
  "3Symbols2": "3 symbols",
  "3Stars": "3 stars",
  "3Triangles": "3 triangles",
  "4Arrows": "4 arrows (coloured)",
  "4ArrowsGray": "4 arrows (grey)",
  "4RedToBlack": "Red to black",
  "4Rating": "4 ratings",
  "4TrafficLights": "4 traffic lights",
  "5Arrows": "5 arrows (coloured)",
  "5ArrowsGray": "5 arrows (grey)",
  "5Rating": "5 ratings",
  "5Quarters": "5 quarters",
  "5Boxes": "5 boxes",
};

/** Short human description of a rule for the rule list. */
export function describeRule(rule: CfRule): string {
  const op: Record<CellIsOp, string> = {
    between: "between",
    notBetween: "not between",
    equal: "=",
    notEqual: "≠",
    greaterThan: ">",
    lessThan: "<",
    greaterThanOrEqual: "≥",
    lessThanOrEqual: "≤",
  };
  switch (rule.type) {
    case "cellIs":
      return rule.operator === "between" || rule.operator === "notBetween"
        ? `Cell value ${op[rule.operator]} ${rule.formula1} and ${rule.formula2}`
        : `Cell value ${op[rule.operator ?? "equal"]} ${rule.formula1}`;
    case "containsText":
      return `Text contains "${rule.text}"`;
    case "notContainsText":
      return `Text does not contain "${rule.text}"`;
    case "beginsWith":
      return `Text begins with "${rule.text}"`;
    case "endsWith":
      return `Text ends with "${rule.text}"`;
    case "timePeriod":
      return `Date is ${rule.period}`;
    case "containsBlanks":
      return "Cell is empty";
    case "notContainsBlanks":
      return "Cell is not empty";
    case "containsErrors":
      return "Cell has an error";
    case "notContainsErrors":
      return "Cell has no error";
    case "duplicateValues":
      return "Duplicate values";
    case "uniqueValues":
      return "Unique values";
    case "top10":
      return `${rule.bottom ? "Bottom" : "Top"} ${rule.rank}${rule.percent ? "%" : ""}`;
    case "aboveAverage":
      return `${rule.above === false ? "Below" : "Above"} average${rule.stdDev ? ` (${rule.stdDev} std dev)` : ""}`;
    case "expression":
      return `Formula ${rule.formula1}`;
    case "colorScale":
      return `${rule.cfvos?.length ?? 2}-colour scale`;
    case "dataBar":
      return "Data bar";
    case "iconSet":
      return `Icon set: ${ICON_SET_LABELS[rule.iconSet ?? "3TrafficLights1"]}${rule.reverse ? " (reversed)" : ""}`;
  }
}

/** "A1:B3, D4" for a rule's ranges. */
export function rangesText(ranges: CellRect[]): string {
  return ranges
    .map((r) => {
      const a = `${colToLetters(Math.min(r.c1, r.c2))}${Math.min(r.r1, r.r2) + 1}`;
      const b = `${colToLetters(Math.max(r.c1, r.c2))}${Math.max(r.r1, r.r2) + 1}`;
      return a === b ? a : `${a}:${b}`;
    })
    .join(", ");
}
