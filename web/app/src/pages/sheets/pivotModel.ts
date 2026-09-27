// Pivot table model: configuration, source data and item keys.
//
// A pivot reads a source range (header row + records) and arranges the
// records by row, column and page (report filter) fields, aggregating one or
// more data fields. The layout follows Excel: compact, outline and tabular
// forms, subtotals at the top or bottom, grand totals, blank rows, the
// "Values" pseudo-field and page-field blocks. pivotEngine.ts computes the
// report; this file holds the shapes it works on.

import { cellDisplay, cellScalar, isError, type Cell, type Scalar } from "./cellValue";
import { formatGeneral, formatValue, serialToDate, MONTH_NAMES } from "./numberFormat";

/** Excel's data-field summary functions. */
export type Agg =
  | "sum"
  | "count"
  | "average"
  | "max"
  | "min"
  | "product"
  | "countNums"
  | "stdDev"
  | "stdDevP"
  | "var"
  | "varP";

export const AGGS: Agg[] = [
  "sum",
  "count",
  "average",
  "max",
  "min",
  "product",
  "countNums",
  "stdDev",
  "stdDevP",
  "var",
  "varP",
];

/** Caption prefix of a data field ("Sum of Price"). */
export const AGG_LABEL: Record<Agg, string> = {
  sum: "Sum",
  count: "Count",
  average: "Average",
  max: "Max",
  min: "Min",
  product: "Product",
  countNums: "Count",
  stdDev: "StdDev",
  stdDevP: "StdDevp",
  var: "Var",
  varP: "Varp",
};

/** Longer names for menus. */
export const AGG_TITLE: Record<Agg, string> = {
  sum: "Sum",
  count: "Count (all values)",
  average: "Average",
  max: "Max",
  min: "Min",
  product: "Product",
  countNums: "Count numbers",
  stdDev: "StdDev (sample)",
  stdDevP: "StdDevp (population)",
  var: "Var (sample)",
  varP: "Varp (population)",
};

/** "Show values as" calculations. */
export type ShowAs =
  | "normal"
  | "percentOfTotal"
  | "percentOfRow"
  | "percentOfCol"
  | "percentOfParentRow"
  | "percentOfParentCol"
  | "percentOfParent"
  | "difference"
  | "percent"
  | "percentDiff"
  | "runTotal"
  | "percentOfRunningTotal"
  | "rankAscending"
  | "rankDescending"
  | "index";

export const SHOW_AS_TITLE: Record<ShowAs, string> = {
  normal: "No calculation",
  percentOfTotal: "% of grand total",
  percentOfCol: "% of column total",
  percentOfRow: "% of row total",
  percentOfParentRow: "% of parent row total",
  percentOfParentCol: "% of parent column total",
  percentOfParent: "% of parent total",
  percent: "% of",
  difference: "Difference from",
  percentDiff: "% difference from",
  runTotal: "Running total in",
  percentOfRunningTotal: "% running total in",
  rankAscending: "Rank smallest to largest",
  rankDescending: "Rank largest to smallest",
  index: "Index",
};

/** Show-as kinds that need a base field (and some a base item). */
export const SHOW_AS_NEEDS_FIELD: ShowAs[] = [
  "percentOfParent",
  "difference",
  "percent",
  "percentDiff",
  "runTotal",
  "percentOfRunningTotal",
  "rankAscending",
  "rankDescending",
];
export const SHOW_AS_NEEDS_ITEM: ShowAs[] = ["difference", "percent", "percentDiff"];

/** The "Σ Values" pseudo-field placed on an axis when there are 2+ data fields. */
export const VALUES = -2;

export interface PivotRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export interface PivotDataField {
  /** Field index (a source field, a group field or a calculated field). */
  field: number;
  agg: Agg;
  /** Custom caption (default "Sum of <field>"). */
  name?: string;
  showAs?: ShowAs;
  baseField?: number;
  /** Item index in the base field, or the previous/next item. */
  baseItem?: number | "prev" | "next";
  /** Number format code of the values (numberFormat.ts). */
  numFmt?: string;
}

export type LabelOp =
  | "equal"
  | "notEqual"
  | "greater"
  | "greaterOrEqual"
  | "less"
  | "lessOrEqual"
  | "beginsWith"
  | "notBeginsWith"
  | "endsWith"
  | "notEndsWith"
  | "contains"
  | "notContains"
  | "between"
  | "notBetween";

/**
 * A field filter. Label filters test the item caption, value filters and
 * top-10 filters test an aggregate of a data field within each parent item.
 * Filters apply in list order, each on what the earlier ones left.
 */
export type FieldFilter =
  | { field: number; type: "items"; hidden: string[] }
  | { field: number; type: "label"; op: LabelOp; value: string; value2?: string; op2?: LabelOp; value3?: string; and?: boolean }
  | { field: number; type: "value"; dataField: number; op: LabelOp; value: number; value2?: number }
  | { field: number; type: "top10"; dataField: number; top: boolean; count: number; by: "items" | "percent" | "sum" };

export interface PivotFieldSettings {
  /** Custom caption of the field (header cells, subtotal names). */
  name?: string;
  /** Subtotal functions: undefined = automatic (the data field's own), "none", or a list. */
  subtotals?: Agg[] | "none";
  subtotalTop?: boolean;
  compact?: boolean;
  outline?: boolean;
  insertBlankRow?: boolean;
  /** Show items with no data. */
  showAll?: boolean;
  /** Sort order, optionally by a data field's values (index into values). */
  sort?: { order: "asc" | "desc"; dataField?: number };
  /** Item order kept across refreshes (item keys); new items go last. */
  order?: string[];
  /** Captions given to items (item key → caption). */
  itemNames?: Record<string, string>;
}

export type GroupBy = "years" | "quarters" | "months" | "days" | "hours" | "minutes" | "seconds";

/** A field derived from a source field by grouping its values. */
export type PivotGroup =
  | { source: number; name: string; type: "date"; by: GroupBy }
  | { source: number; name: string; type: "number"; start: number; end: number; interval: number }
  | { source: number; name: string; type: "items"; items: { name: string; keys: string[] }[] };

/** A calculated field: a formula over other fields' sums ("=Price*Units"). */
export interface PivotCalculated {
  name: string;
  formula: string;
}

export type PivotLayout = "compact" | "outline" | "tabular";

export interface PivotConfig {
  id: string;
  title: string;
  /** Source range (header row first). */
  range: PivotRange;
  /** Sheet the source range is on (defaults to the sheet the pivot was made on). */
  sourceSheetId?: string;
  rows?: number[];
  cols?: number[];
  values?: PivotDataField[];
  /** Page (report) filter fields; `selected` lists item keys (all items when absent). */
  pages?: { field: number; selected?: string[] }[];
  fieldFilters?: FieldFilter[];
  fields?: Record<number, PivotFieldSettings>;
  groups?: PivotGroup[];
  calculated?: PivotCalculated[];
  /**
   * Calculated items: an item of a row/column field computed from the other
   * items of that field ("=East-West", "=Region[East]*2"), solved in list
   * order at the report's level of detail; totals include them.
   */
  calculatedItems?: {
    field: number;
    name: string;
    formula: string;
    /** A different formula for single cells: other fields' item captions → formula. */
    cells?: { items: Record<string, string>; formula: string }[];
  }[];
  /** Caption of the Values pseudo-field (default "Values"). */
  dataCaption?: string;
  /** Captions for "Row Labels", "Column Labels" and "Grand Total". */
  rowHeaderCaption?: string;
  colHeaderCaption?: string;
  grandTotalCaption?: string;
  layout?: PivotLayout;
  /** Pivot-level defaults for the field settings. */
  subtotalTop?: boolean;
  defaultSubtotal?: boolean;
  insertBlankRow?: boolean;
  /** The grand total row (below the rows) and column (right of the columns). */
  grandTotalRow?: boolean;
  grandTotalCol?: boolean;
  showHeaders?: boolean;
  gridDropZones?: boolean;
  /** Where the Values pseudo-field sits with 2+ data fields. */
  valuesAxis?: "rows" | "cols";
  valuesPos?: number;
  pageWrap?: number;
  pageOverThenDown?: boolean;
  /** Top-left cell of the report on the grid (page fields sit above it). */
  anchor?: { sheetId: string; r: number; c: number };
  /** Last written report, for GETPIVOTDATA and edit protection. */
  output?: PivotOutput;
  // ---- legacy (single-field) shape, still read ----
  rowField?: number;
  colField?: number | null;
  valueField?: number;
  agg?: Agg;
}

/** What the grid holds for a pivot after it was written. */
export interface PivotOutput {
  sheetId: string;
  r0: number;
  c0: number;
  rows: number;
  cols: number;
  /** Data fields by caption and source field name. */
  dataFields: { name: string; field: string }[];
  /** Value cells: data field index, fixed (field, item) pairs, value. */
  entries: PivotEntry[];
  /** Page fields and their selected item caption ("" for all). */
  pages?: { field: string; item: string }[];
}

export interface PivotEntry {
  r: number;
  c: number;
  d: number;
  /**
   * [field caption, item caption, item number (numbers, dates, group
   * numbers) or null, item type: "d" date, "b" logical, "e" error, "z" blank]
   */
  f: ([string, string] | [string, string, number | null] | [string, string, number | null, string])[];
  v: number | string | boolean | { error: string } | null;
}

// ---------------------------------------------------------------------------
// Source data

export interface SrcCell {
  s: Scalar;
  text: string;
  fmt?: string;
}

export interface PivotSource {
  /** Unique field names (header text; duplicates get a numeric suffix). */
  names: string[];
  records: SrcCell[][];
}

const EMPTY: SrcCell = { s: null, text: "" };

export function srcCell(cell: Cell): SrcCell {
  const s = cellScalar(cell);
  if (s === null) return EMPTY;
  const fmt = cell && typeof cell === "object" ? cell.ct?.fa : undefined;
  let text = cellDisplay(cell);
  if (typeof s === "number" && (text === "" || text === String(cell && typeof cell === "object" ? cell.v : ""))) {
    text = fmt && fmt !== "General" ? formatValue(s, fmt) : formatGeneral(s);
  }
  return { s, text, fmt: fmt && fmt !== "General" ? fmt : undefined };
}

/**
 * sourceFromGrid reads a header row and the records below it. Fully empty
 * rows are skipped; empty headers become "Column N".
 */
export function sourceFromGrid(grid: Cell[][]): PivotSource {
  const header = grid[0] ?? [];
  const width = Math.max(header.length, ...grid.map((r) => r?.length ?? 0));
  const names: string[] = [];
  const seen = new Set<string>();
  for (let c = 0; c < width; c++) {
    let n = cellDisplay(header[c] ?? null).trim() || `Column ${c + 1}`;
    if (seen.has(n.toLowerCase())) {
      let i = 2;
      while (seen.has(`${n}${i}`.toLowerCase())) i++;
      n = `${n}${i}`;
    }
    seen.add(n.toLowerCase());
    names.push(n);
  }
  const records: SrcCell[][] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const rec: SrcCell[] = [];
    let any = false;
    for (let c = 0; c < width; c++) {
      const sc = srcCell(row[c] ?? null);
      if (sc.s !== null) any = true;
      rec.push(sc);
    }
    if (any) records.push(rec);
  }
  return { names, records };
}

// ---------------------------------------------------------------------------
// Items

/** Stable key of an item value: numbers, text (case-insensitive), booleans, errors, blank. */
export function itemKey(s: Scalar): string {
  if (s === null || s === "") return "z";
  if (typeof s === "number") return "n" + String(s);
  if (typeof s === "boolean") return s ? "b1" : "b0";
  if (isError(s)) return "e" + s.error;
  return "s" + String(s).toLowerCase();
}

/** Sort rank of an item kind (Excel: numbers, text, logicals, errors, blanks). */
function kindRank(key: string): number {
  switch (key[0]) {
    case "n":
      return 0;
    case "s":
      return 1;
    case "b":
      return 2;
    case "e":
      return 3;
    case "g":
      return 0;
    case "c":
      return 5;
    default:
      return 4;
  }
}

export function compareItemKeys(a: string, b: string): number {
  const ka = kindRank(a);
  const kb = kindRank(b);
  if (ka !== kb) return ka - kb;
  if (a[0] === "n" || a[0] === "g") return parseFloat(a.slice(1)) - parseFloat(b.slice(1));
  if (a[0] === "s") return a.slice(1).localeCompare(b.slice(1), undefined, { sensitivity: "base", numeric: false });
  return a < b ? -1 : a > b ? 1 : 0;
}

export const BLANK_LABEL = "(blank)";

// ---------------------------------------------------------------------------
// Grouping

const QUARTERS = ["Qtr1", "Qtr2", "Qtr3", "Qtr4"];
const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

/** groupCell maps a source value to its group item (key "g<sort>" keeps order). */
export function groupCell(g: PivotGroup, c: SrcCell): SrcCell {
  const s = c.s;
  if (g.type === "items") {
    const k = cellItemKey(c);
    const hit = g.items.find((it) => it.keys.includes(k));
    return hit ? { s: hit.name, text: hit.name } : c;
  }
  if (typeof s !== "number") return c;
  if (g.type === "number") {
    const { start, end, interval } = g;
    if (!(interval > 0)) return c;
    const ints = [start, end, interval].every((x) => Number.isInteger(x));
    if (s < start) return { s: "<" + fmtNum(start), text: "<" + fmtNum(start), fmt: undefined, ...{ gk: -1 } } as SrcCell;
    if (s > end) return { s: ">" + fmtNum(end), text: ">" + fmtNum(end), ...{ gk: 1e15 } } as SrcCell;
    const i = Math.floor((s - start) / interval);
    const lo = start + i * interval;
    const hi = ints ? Math.min(lo + interval - 1, end) : Math.min(lo + interval, end);
    const text = `${fmtNum(lo)}-${fmtNum(hi)}`;
    return { s: text, text, ...{ gk: lo } } as SrcCell;
  }
  const d = serialToDate(s);
  const frac = s - Math.floor(s);
  const secs = Math.round(frac * 86400);
  let text: string;
  let gk: number;
  switch (g.by) {
    case "years":
      text = String(d.y);
      gk = d.y;
      break;
    case "quarters":
      gk = Math.floor((d.m - 1) / 3);
      text = QUARTERS[gk];
      break;
    case "months":
      gk = d.m - 1;
      text = SHORT_MONTHS[gk];
      break;
    case "days":
      gk = d.m * 100 + d.d;
      text = `${d.d}-${SHORT_MONTHS[d.m - 1]}`;
      break;
    case "hours":
      gk = Math.floor(secs / 3600) % 24;
      text = `${gk}`;
      break;
    case "minutes":
      gk = Math.floor(secs / 60) % 60;
      text = `:${String(gk).padStart(2, "0")}`;
      break;
    default:
      gk = secs % 60;
      text = `:${String(gk).padStart(2, "0")}`;
  }
  return { s: text, text, ...{ gk } } as SrcCell;
}

function fmtNum(n: number): string {
  return formatGeneral(n);
}

/** Item key of a (possibly grouped) cell: grouped items sort by group order. */
export function cellItemKey(c: SrcCell): string {
  if ((c as SrcCell & { ci?: boolean }).ci) return "c" + String(c.s).toLowerCase();
  const gk = (c as SrcCell & { gk?: number }).gk;
  if (gk !== undefined) return "g" + String(gk);
  return itemKey(c.s);
}

// ---------------------------------------------------------------------------
// Config helpers

/** normalizeConfig fills defaults and converts the legacy one-field shape. */
export function normalizeConfig(cfg: PivotConfig): PivotConfig {
  const out: PivotConfig = { ...cfg };
  if (!out.rows && !out.cols && !out.values && cfg.rowField !== undefined) {
    out.rows = [cfg.rowField];
    out.cols = cfg.colField != null ? [cfg.colField] : [];
    out.values = cfg.valueField !== undefined ? [{ field: cfg.valueField, agg: cfg.agg ?? "sum" }] : [];
  }
  out.rows = out.rows ?? [];
  out.cols = out.cols ?? [];
  out.values = out.values ?? [];
  out.pages = out.pages ?? [];
  return out;
}

/** Number of fields: source, then group fields, then calculated fields. */
export function fieldCount(cfg: PivotConfig, src: PivotSource): number {
  return src.names.length + (cfg.groups?.length ?? 0) + (cfg.calculated?.length ?? 0);
}

/** Raw (source) name of a field. */
export function fieldSourceName(cfg: PivotConfig, src: PivotSource, f: number): string {
  if (f === VALUES) return "Values";
  const n = src.names.length;
  if (f < n) return src.names[f] ?? `Column ${f + 1}`;
  const g = cfg.groups ?? [];
  if (f < n + g.length) return g[f - n].name;
  return cfg.calculated?.[f - n - g.length]?.name ?? `Field ${f + 1}`;
}

/** Caption of a field (custom name or source name). */
export function fieldName(cfg: PivotConfig, src: PivotSource, f: number): string {
  if (f === VALUES) return cfg.dataCaption || "Values";
  return cfg.fields?.[f]?.name || fieldSourceName(cfg, src, f);
}

export function isCalculatedField(cfg: PivotConfig, src: PivotSource, f: number): boolean {
  return f >= src.names.length + (cfg.groups?.length ?? 0);
}

/** Default caption of a data field ("Sum of Price", "Sum of Price2", "Sum of 1_2"). */
export function dataFieldNames(cfg: PivotConfig, src: PivotSource): string[] {
  const names: string[] = [];
  const used = new Set<string>();
  for (const d of cfg.values ?? []) {
    let n = d.name;
    if (!n) {
      const base = `${AGG_LABEL[d.agg]} of ${fieldSourceName(cfg, src, d.field)}`;
      n = base;
      let i = 2;
      while (used.has(n.toLowerCase())) {
        n = /\d$/.test(base) ? `${base}_${i}` : `${base}${i}`;
        i++;
      }
    }
    used.add(n.toLowerCase());
    names.push(n);
  }
  return names;
}

/**
 * freezeItemOrder records the current item order of the pivot's fields, as
 * Excel's pivot cache does: after a refresh, known items keep their places
 * and new items follow in the order they appear in the data.
 */
export function freezeItemOrder(cfg: PivotConfig, src: PivotSource): PivotConfig {
  const c = normalizeConfig(cfg);
  const fields = { ...(c.fields ?? {}) };
  const used = new Set<number>([...(c.rows ?? []), ...(c.cols ?? []), ...(c.pages ?? []).map((p) => p.field)]);
  for (const f of used) {
    if (f < 0 || f >= src.names.length) continue;
    const keys = new Set<string>();
    for (const r of src.records) keys.add(cellItemKey(r[f] ?? { s: null, text: "" }));
    const prev = fields[f]?.order ?? [];
    const order = prev.length
      ? [...prev.filter((k) => keys.has(k)), ...[...keys].filter((k) => !prev.includes(k))]
      : [...keys].sort(compareItemKeys);
    fields[f] = { ...fields[f], order };
  }
  return { ...c, fields };
}

/**
 * remapFields follows the source columns by name after the source changed
 * (columns moved, added or removed): fields that are gone leave the layout.
 */
export function remapFields(cfg: PivotConfig, oldNames: string[], newNames: string[]): PivotConfig {
  const c = normalizeConfig(cfg);
  const nOld = oldNames.length;
  const map = (f: number): number => {
    if (f === VALUES) return VALUES;
    if (f >= nOld) return f - nOld + newNames.length;
    const i = newNames.findIndex((n) => n.toLowerCase() === (oldNames[f] ?? "").toLowerCase());
    return i;
  };
  const keep = (f: number) => map(f) !== -1;
  const fields: Record<number, PivotFieldSettings> = {};
  for (const [k, v] of Object.entries(c.fields ?? {})) {
    const m = map(Number(k));
    if (m >= 0) fields[m] = v;
  }
  const values = (c.values ?? []).filter((d) => keep(d.field)).map((d) => ({ ...d, field: map(d.field), baseField: d.baseField === undefined ? undefined : map(d.baseField) }));
  return {
    ...c,
    rows: (c.rows ?? []).filter(keep).map(map),
    cols: (c.cols ?? []).filter(keep).map(map),
    pages: (c.pages ?? []).filter((p) => keep(p.field)).map((p) => ({ ...p, field: map(p.field) })),
    values,
    fields,
    fieldFilters: (c.fieldFilters ?? []).filter((f) => keep(f.field)).map((f) => ({ ...f, field: map(f.field) })),
    groups: (c.groups ?? []).filter((g) => keep(g.source)).map((g) => ({ ...g, source: map(g.source) })),
  };
}

/** What typing into a report cell renames (Excel lets you retype captions). */
export type PivotEdit =
  | { kind: "dataName"; di: number }
  | { kind: "item"; field: number; key: string }
  | { kind: "field"; field: number }
  | { kind: "rowCaption" }
  | { kind: "colCaption" }
  | { kind: "valuesCaption" }
  | { kind: "grandTotal" };

/** applyPivotEdit renames what a report cell shows. */
export function applyPivotEdit(cfg: PivotConfig, edit: PivotEdit, text: string): PivotConfig {
  const t = text.trim();
  const c = normalizeConfig(cfg);
  const field = (f: number, patch: Partial<PivotFieldSettings>) => ({ ...(c.fields ?? {}), [f]: { ...(c.fields?.[f] ?? {}), ...patch } });
  switch (edit.kind) {
    case "dataName":
      return { ...c, values: (c.values ?? []).map((d, i) => (i === edit.di ? { ...d, name: t || undefined } : d)) };
    case "item": {
      const names = { ...(c.fields?.[edit.field]?.itemNames ?? {}) };
      if (t) names[edit.key] = t;
      else delete names[edit.key];
      return { ...c, fields: field(edit.field, { itemNames: names }) };
    }
    case "field":
      return { ...c, fields: field(edit.field, { name: t || undefined }) };
    case "rowCaption":
      return { ...c, rowHeaderCaption: t || undefined };
    case "colCaption":
      return { ...c, colHeaderCaption: t || undefined };
    case "valuesCaption":
      return { ...c, dataCaption: t || undefined };
    case "grandTotal":
      return { ...c, grandTotalCaption: t || undefined };
  }
}

/**
 * Why a calculated item can't be added to a field, or null. Pivots over the
 * same source share their items, so a field one of them sums or counts
 * ("notUniqueField") or filters by page ("pageField") can't get one.
 */
export function calculatedItemError(sharing: PivotConfig[], field: number): "notUniqueField" | "pageField" | null {
  for (const p of sharing) {
    const c = normalizeConfig(p);
    if ((c.values ?? []).some((d) => d.field === field)) return "notUniqueField";
  }
  for (const p of sharing) {
    const c = normalizeConfig(p);
    if ((c.pages ?? []).some((x) => x.field === field)) return "pageField";
  }
  return null;
}

/** Whether a name is free for a new calculated item of a field (no item or caption has it). */
export function canAddCalculatedItemName(cfg: PivotConfig, src: PivotSource, field: number, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  const taken = new Set<string>();
  for (const r of src.records) {
    const c = r[field];
    if (c && c.s !== null) taken.add(String(c.s).toLowerCase());
  }
  for (const v of Object.values(cfg.fields?.[field]?.itemNames ?? {})) taken.add(v.toLowerCase());
  for (const ci of cfg.calculatedItems ?? []) if (ci.field === field) taken.add(ci.name.toLowerCase());
  return !taken.has(n);
}

/** A new pivot id. */
export function newPivotId(): string {
  return `pivot_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
