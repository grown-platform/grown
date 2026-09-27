// Pivot report engine: filters, item trees, aggregation, show-values-as and
// the Excel report layout (see pivotModel.ts for the configuration).
//
// The report is a grid of cells: an optional page-field block, a blank row,
// then the table (column header rows, row labels, values). Row labels follow
// each field's form: compact fields share a column and put an item on its
// own line above its children, outline fields do the same in their own
// column, tabular fields put an item on the line of its first child. Column
// items always sit above their children with subtotals to the right.

import { err, isError, type Scalar } from "./cellValue";
import { formatGeneral, formatKind, formatValue } from "./numberFormat";
import {
  AGG_LABEL,
  BLANK_LABEL,
  VALUES,
  cellItemKey,
  compareItemKeys,
  dataFieldNames,
  fieldName,
  fieldSourceName,
  groupCell,
  isCalculatedField,
  normalizeConfig,
  type Agg,
  type FieldFilter,
  type LabelOp,
  type PivotConfig,
  type PivotEdit,
  type PivotEntry,
  type PivotSource,
  type SrcCell,
} from "./pivotModel";
import { evalCalculated } from "./pivotCalc";

export type CellValue = string | number | boolean | { error: string } | null;

export type GridCellKind =
  | "caption"
  | "rowLabel"
  | "colLabel"
  | "value"
  | "subtotal"
  | "grand"
  | "pageName"
  | "pageValue";

export interface GridCell {
  v: CellValue;
  kind: GridCellKind;
  /** Explicit number format (data field format, item format). */
  fmt?: string;
  /** Format implied by show-values-as (percentages); used when fmt is unset. */
  autoFmt?: string;
  bold?: boolean;
  /** The field a label or caption belongs to. */
  field?: number;
  /** What typing into this cell renames. */
  edit?: PivotEdit;
}

export interface PivotReport {
  /** rows × cols; null is an empty cell inside the report range. */
  cells: (GridCell | null)[][];
  rows: number;
  cols: number;
  /** Row of the table's first header row (page fields sit above). */
  tableRow: number;
  /** Size of the header area of the table. */
  headerRows: number;
  rowLabelCols: number;
  dataNames: string[];
  /** Data fields as GETPIVOTDATA names them: caption and source field. */
  dataFields: { name: string; field: string }[];
  /** Page fields and the caption of their one selected item ("" otherwise). */
  pages: { field: string; item: string }[];
  entries: PivotEntry[];
  /** Source record indexes behind a value cell (null for other cells). */
  details(r: number, c: number): number[] | null;
  source: PivotSource;
  /** Records with group fields appended (index = field). */
  records: SrcCell[][];
  empty: boolean;
}

interface AxisNode {
  field: number;
  key: string;
  label: string;
  depth: number;
  recsV: number[];
  recsA: number[];
  children: AxisNode[];
  dataIndex: number | null;
  parent: AxisNode | null;
  /** Shown only because of "show items with no data": expand all below. */
  expandAll: boolean;
  /** Path of (field, key) pairs from the root, the Values level excluded. */
  path: [number, string][];
}

type LineKind = "data" | "header" | "sub" | "grand" | "blank";

interface Line {
  kind: LineKind;
  node: AxisNode | null;
  recs: number[];
  di: number | null;
  func: Agg | null;
  /** (position, text, field, item key): item captions carry their field and key. */
  labels: [number, string, number?, string?][];
  path: [number, string][];
  hasValues: boolean;
}

// ---------------------------------------------------------------------------
// Aggregation

function isBlank(s: Scalar): boolean {
  return s === null || s === "";
}

/** aggregate applies a summary function; undefined means "no data" (a blank cell). */
export function aggregate(values: Scalar[], agg: Agg): Scalar | undefined {
  const present = values.filter((v) => !isBlank(v));
  if (present.length === 0) return undefined;
  if (agg === "count") return present.length;
  const nums = present.filter((v): v is number => typeof v === "number");
  if (agg === "countNums") return nums.length;
  const e = present.find((v) => isError(v));
  if (e) return e;
  const n = nums.length;
  const sum = () => nums.reduce((a, b) => a + b, 0);
  switch (agg) {
    case "sum":
      return sum();
    case "min":
      return n ? Math.min(...nums) : 0;
    case "max":
      return n ? Math.max(...nums) : 0;
    case "average":
      return n ? sum() / n : err("#DIV/0!");
    case "product":
      return n ? nums.reduce((a, b) => a * b, 1) : 0;
    case "stdDev":
    case "var":
    case "stdDevP":
    case "varP": {
      const sample = agg === "stdDev" || agg === "var";
      if (n < (sample ? 2 : 1)) return err("#DIV/0!");
      const mean = sum() / n;
      const ss = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0);
      const v = ss / (sample ? n - 1 : n);
      return agg.startsWith("std") ? Math.sqrt(v) : v;
    }
  }
  return undefined;
}

function intersect(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Label filters

function labelTest(op: LabelOp, label: string, value: string, value2?: string): boolean {
  const l = label.toLowerCase();
  const v = (value ?? "").toLowerCase();
  const ln = Number(label);
  const vn = Number(value);
  const numeric = label.trim() !== "" && Number.isFinite(ln) && (value ?? "").trim() !== "" && Number.isFinite(vn);
  const cmp = numeric ? ln - vn : l.localeCompare(v);
  const wild = (pat: string, anchoredStart: boolean, anchoredEnd: boolean) => {
    const re = pat
      .split("")
      .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("");
    return new RegExp(`${anchoredStart ? "^" : ""}${re}${anchoredEnd ? "$" : ""}`, "i").test(label);
  };
  switch (op) {
    case "equal":
      return numeric ? cmp === 0 : wild(value, true, true);
    case "notEqual":
      return numeric ? cmp !== 0 : !wild(value, true, true);
    case "greater":
      return cmp > 0;
    case "greaterOrEqual":
      return cmp >= 0;
    case "less":
      return cmp < 0;
    case "lessOrEqual":
      return cmp <= 0;
    case "beginsWith":
      return wild(value, true, false);
    case "notBeginsWith":
      return !wild(value, true, false);
    case "endsWith":
      return wild(value, false, true);
    case "notEndsWith":
      return !wild(value, false, true);
    case "contains":
      return wild(value, false, false);
    case "notContains":
      return !wild(value, false, false);
    case "between":
    case "notBetween": {
      const lo = value;
      const hi = value2 ?? value;
      const inside = labelTest("greaterOrEqual", label, lo) && labelTest("lessOrEqual", label, hi);
      return op === "between" ? inside : !inside;
    }
  }
  return true;
}

function numTest(op: LabelOp, x: number, v: number, v2?: number): boolean {
  switch (op) {
    case "equal":
      return x === v;
    case "notEqual":
      return x !== v;
    case "greater":
      return x > v;
    case "greaterOrEqual":
      return x >= v;
    case "less":
      return x < v;
    case "lessOrEqual":
      return x <= v;
    case "between":
      return x >= Math.min(v, v2 ?? v) && x <= Math.max(v, v2 ?? v);
    case "notBetween":
      return !(x >= Math.min(v, v2 ?? v) && x <= Math.max(v, v2 ?? v));
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// The report

const PLACEHOLDER_ROWS = 18;
const PLACEHOLDER_COLS = 3;

export function computeReport(input: PivotConfig, src: PivotSource): PivotReport {
  const cfg = normalizeConfig(input);
  const nSrc = src.names.length;
  const groups = cfg.groups ?? [];
  const nFields = nSrc + groups.length;
  const fieldOk = (f: number) => f === VALUES || (f >= 0 && f < nFields);
  const valueFieldOk = (f: number) => f >= 0 && f < nFields + (cfg.calculated?.length ?? 0);

  // Records with the group fields appended.
  const records: SrcCell[][] = src.records.map((rec) => {
    if (!groups.length) return rec;
    const out = rec.slice();
    for (const g of groups) out.push(groupCell(g, rec[g.source] ?? { s: null, text: "" }));
    return out;
  });
  const cellOf = (ri: number, f: number): SrcCell => records[ri][f] ?? { s: null, text: "" };
  const keyOf = (ri: number, f: number): string => cellItemKey(cellOf(ri, f));

  // Item labels and the full item list per field (first seen caption).
  const labelCache = new Map<number, Map<string, string>>();
  const fmtCache = new Map<number, string | undefined>();
  // A numeric item shows in its field's number format when every value of
  // the field is a number in that one format (Excel's cache-field rule).
  const uniformFmt = (f: number): string | undefined => {
    if (fmtCache.has(f)) return fmtCache.get(f);
    let fmt: string | undefined;
    let first = true;
    let ok = records.length > 0;
    for (let i = 0; i < records.length && ok; i++) {
      const c = cellOf(i, f);
      if (typeof c.s !== "number" || (c as SrcCell & { gk?: number }).gk !== undefined) ok = false;
      else if (first) {
        fmt = c.fmt;
        first = false;
      } else if (c.fmt !== fmt) ok = false;
    }
    const out = ok && fmt && fmt !== "General" ? fmt : undefined;
    fmtCache.set(f, out);
    return out;
  };
  const itemText = (f: number, k: string, c: SrcCell): string => {
    switch (k[0]) {
      case "z":
        return BLANK_LABEL;
      case "n": {
        const n = c.s as number;
        const fmt = uniformFmt(f);
        return fmt ? formatValue(n, fmt) : formatGeneral(n);
      }
      case "s":
        return String(c.s);
      case "b":
        return c.s ? "TRUE" : "FALSE";
      case "e":
        return k.slice(1);
      default:
        return c.text || BLANK_LABEL;
    }
  };
  const itemLabels = (f: number): Map<string, string> => {
    let m = labelCache.get(f);
    if (!m) {
      m = new Map();
      for (let i = 0; i < records.length; i++) {
        const c = cellOf(i, f);
        const k = cellItemKey(c);
        if (!m.has(k)) m.set(k, itemText(f, k, c));
      }
      labelCache.set(f, m);
    }
    return m;
  };
  const labelOf = (f: number, k: string) =>
    fieldSettings(f).itemNames?.[k] ?? itemLabels(f).get(k) ?? (k === "z" ? BLANK_LABEL : k.slice(1));
  const fieldSettings = (f: number) => cfg.fields?.[f] ?? {};
  const orderedKeys = (f: number, keys: string[]): string[] => {
    const set = new Set(keys);
    const explicit = fieldSettings(f).order;
    let out: string[];
    if (explicit?.length) {
      out = explicit.filter((k) => set.has(k));
      // Items the order does not know yet follow in data order.
      const known = new Set(explicit);
      const rest = [...itemLabels(f).keys()].filter((k) => set.has(k) && !known.has(k));
      out.push(...rest);
    } else out = keys.slice().sort(compareItemKeys);
    const sort = fieldSettings(f).sort;
    if (sort && sort.dataField === undefined && sort.order === "desc") out.reverse();
    return out;
  };
  const allKeys = (f: number): string[] => orderedKeys(f, [...itemLabels(f).keys()]);

  const values = (cfg.values ?? []).filter((d) => valueFieldOk(d.field));
  const dataNames = dataFieldNames({ ...cfg, values }, src);
  const nd = values.length;

  // Page filters.
  const pages = (cfg.pages ?? []).filter((p) => p.field >= 0 && p.field < nFields);
  const r0: number[] = [];
  for (let i = 0; i < records.length; i++) {
    let ok = true;
    for (const p of pages) {
      if (p.selected && !p.selected.includes(keyOf(i, p.field))) {
        ok = false;
        break;
      }
    }
    if (ok) r0.push(i);
  }

  // Axes, with the Values pseudo-field when there are 2+ data fields.
  const rowAxis = (cfg.rows ?? []).filter((f) => f !== VALUES && fieldOk(f));
  const colAxis = (cfg.cols ?? []).filter((f) => f !== VALUES && fieldOk(f));
  if (nd >= 2) {
    const axis = cfg.valuesAxis === "rows" ? rowAxis : colAxis;
    const pos = Math.max(0, Math.min(cfg.valuesPos ?? axis.length, axis.length));
    axis.splice(pos, 0, VALUES);
  }
  const rowReal = rowAxis.some((f) => f !== VALUES);
  const colReal = colAxis.some((f) => f !== VALUES);

  // Values of a data field over records.
  const dataValues = (di: number, recs: number[]): Scalar[] => {
    const f = values[di].field;
    return recs.map((i) => cellOf(i, f).s);
  };
  const aggOver = (di: number, recs: number[], func: Agg | null = null): Scalar | undefined => {
    const d = values[di];
    if (isCalculatedField(cfg, src, d.field)) {
      if (!recs.length) return undefined;
      const calc = cfg.calculated![d.field - nFields];
      return evalCalculated(calc.formula, (name) => {
        const f = src.names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
        if (f < 0) return undefined;
        const s = aggregate(
          recs.map((i) => cellOf(i, f).s),
          "sum",
        );
        return s === undefined ? 0 : s;
      });
    }
    return aggregate(dataValues(di, recs), func ?? d.agg);
  };

  // ---- field filters, in order -------------------------------------------
  const axisOf = (f: number): "rows" | "cols" | null =>
    rowAxis.includes(f) ? "rows" : colAxis.includes(f) ? "cols" : null;
  const parentFields = (axis: number[], f: number) => axis.slice(0, axis.indexOf(f)).filter((x) => x !== VALUES);
  const preds: { rows: ((i: number) => boolean)[]; cols: ((i: number) => boolean)[] } = { rows: [], cols: [] };
  // ---- calculated items ----------------------------------------------------
  // Solved in order: each adds one record per combination of the other
  // layout fields' items, whose data values are the formula over this
  // field's items there; later items see earlier ones.
  const layoutFields = [...new Set([...rowAxis, ...colAxis].filter((f) => f !== VALUES))];
  for (const ci of cfg.calculatedItems ?? []) {
    const F = ci.field;
    if (!layoutFields.includes(F) || !ci.name.trim()) continue;
    const others = layoutFields.filter((f) => f !== F);
    const tuples = new Map<string, { rep: number; byItem: Map<string, number[]> }>();
    for (const i of r0) {
      const tk = others.map((f) => keyOf(i, f)).join("\u0001");
      let t = tuples.get(tk);
      if (!t) tuples.set(tk, (t = { rep: i, byItem: new Map() }));
      const k = keyOf(i, F);
      let l = t.byItem.get(k);
      if (!l) t.byItem.set(k, (l = []));
      l.push(i);
    }
    // Item captions of F (current, renamed and calculated) → keys.
    const byCaption = new Map<string, string>();
    for (const i of r0) {
      const k = keyOf(i, F);
      byCaption.set(labelOf(F, k).toLowerCase(), k);
      const raw = cellOf(i, F);
      if (raw.s !== null) byCaption.set(String(raw.s).toLowerCase(), k);
    }
    labelCache.delete(F);
    for (const [, t] of tuples) {
      const rec: SrcCell[] = [];
      for (const f of others) rec[f] = cellOf(t.rep, f);
      rec[F] = { s: ci.name, text: ci.name, ...{ ci: true } } as SrcCell;
      const cell = ci.cells?.find((x) =>
        Object.entries(x.items).every(([f, cap]) => {
          const fi = Number(f);
          return others.includes(fi) && labelOf(fi, keyOf(t.rep, fi)).toLowerCase() === cap.toLowerCase();
        }),
      );
      for (let di = 0; di < nd; di++) {
        const v = evalCalculated(cell?.formula ?? ci.formula, (name) => {
          const k = byCaption.get(name.toLowerCase());
          if (k === undefined) return err("#REF!");
          const recs = t.byItem.get(k) ?? [];
          const x = recs.length ? aggOver(di, recs) : 0;
          return x === undefined ? 0 : x;
        });
        rec[values[di].field] = { s: isError(v) ? v : (v as Scalar), text: "" };
      }
      for (let f = 0; f < nFields; f++) if (!rec[f]) rec[f] = { s: null, text: "" };
      records.push(rec);
      r0.push(records.length - 1);
    }
  }

  let rCur = r0.slice();
  for (const flt of cfg.fieldFilters ?? []) {
    const ax = axisOf(flt.field);
    if (!ax) continue;
    const axis = ax === "rows" ? rowAxis : colAxis;
    const pred = makeFilterPredicate(flt, parentFields(axis, flt.field));
    if (!pred) continue;
    preds[ax].push(pred);
    rCur = rCur.filter(pred);
  }
  const recsV = rCur;
  const recsRows = r0.filter((i) => preds.rows.every((p) => p(i)));
  const recsCols = r0.filter((i) => preds.cols.every((p) => p(i)));

  function makeFilterPredicate(flt: FieldFilter, parents: number[]): ((i: number) => boolean) | null {
    const f = flt.field;
    if (flt.type === "items") {
      const hidden = new Set(flt.hidden);
      return (i) => !hidden.has(keyOf(i, f));
    }
    if (flt.type === "label") {
      const pass = new Map<string, boolean>();
      for (const k of itemLabels(f).keys()) {
        const lab = labelOf(f, k);
        const a = labelTest(flt.op, lab, flt.value, flt.value2);
        const ok = flt.op2 ? (flt.and === false ? a || labelTest(flt.op2, lab, flt.value3 ?? "") : a && labelTest(flt.op2, lab, flt.value3 ?? "")) : a;
        pass.set(k, ok);
      }
      return (i) => pass.get(keyOf(i, f)) ?? true;
    }
    const di = flt.dataField;
    if (di < 0 || di >= nd) return null;
    // Group the current records by parent path, then by item.
    const groupsBy = new Map<string, Map<string, number[]>>();
    for (const i of rCur) {
      const pk = parents.map((p) => keyOf(i, p)).join("\u0001");
      let g = groupsBy.get(pk);
      if (!g) groupsBy.set(pk, (g = new Map()));
      const k = keyOf(i, f);
      let l = g.get(k);
      if (!l) g.set(k, (l = []));
      l.push(i);
    }
    const passing = new Set<string>();
    for (const [pk, g] of groupsBy) {
      const items = [...g.entries()].map(([k, recs]) => {
        const v = aggOver(di, recs);
        return { k, v: typeof v === "number" ? v : null };
      });
      if (flt.type === "value") {
        for (const it of items) if (it.v !== null && numTest(flt.op, it.v, flt.value, flt.value2)) passing.add(pk + "\u0002" + it.k);
      } else {
        const sorted = items.filter((it) => it.v !== null).sort((a, b) => (flt.top ? b.v! - a.v! : a.v! - b.v!));
        let keep: typeof sorted;
        if (flt.by === "items") keep = sorted.slice(0, Math.max(0, Math.floor(flt.count)));
        else {
          const total = sorted.reduce((a, b) => a + b.v!, 0);
          const limit = flt.by === "percent" ? (total * flt.count) / 100 : flt.count;
          keep = [];
          let acc = 0;
          for (const it of sorted) {
            if (acc >= limit && keep.length) break;
            keep.push(it);
            acc += it.v!;
          }
        }
        for (const it of keep) passing.add(pk + "\u0002" + it.k);
      }
    }
    return (i) => passing.has(parents.map((p) => keyOf(i, p)).join("\u0001") + "\u0002" + keyOf(i, f));
  }

  // ---- item trees ---------------------------------------------------------
  const pathMaps = { rows: new Map<string, number[]>(), cols: new Map<string, number[]>() };
  const pathStr = (p: [number, string][]) => p.map(([f, k]) => `${f}=${k}`).join("\u0001");
  const siblingsCache = new Map<string, string[]>();

  function buildTree(axis: number[], recsA: number[], which: "rows" | "cols"): AxisNode {
    const root: AxisNode = {
      field: -1,
      key: "",
      label: "",
      depth: -1,
      recsV,
      recsA,
      children: [],
      dataIndex: null,
      parent: null,
      expandAll: false,
      path: [],
    };
    pathMaps[which].set("", recsV);
    const grow = (node: AxisNode, d: number) => {
      if (d >= axis.length) return;
      const f = axis[d];
      if (f === VALUES) {
        for (let di = 0; di < nd; di++) {
          const c: AxisNode = { ...node, field: VALUES, key: String(di), label: dataNames[di], depth: d, children: [], dataIndex: di, parent: node };
          node.children.push(c);
          grow(c, d + 1);
        }
        return;
      }
      const byKeyA = new Map<string, number[]>();
      for (const i of node.recsA) {
        const k = keyOf(i, f);
        let l = byKeyA.get(k);
        if (!l) byKeyA.set(k, (l = []));
        l.push(i);
      }
      const byKeyV = new Map<string, number[]>();
      for (const i of node.recsV) {
        const k = keyOf(i, f);
        let l = byKeyV.get(k);
        if (!l) byKeyV.set(k, (l = []));
        l.push(i);
      }
      const showAll = node.expandAll || fieldSettings(f).showAll;
      let keys = showAll ? allKeys(f) : orderedKeys(f, [...byKeyA.keys()]);
      const sort = fieldSettings(f).sort;
      if (sort && sort.dataField !== undefined && sort.dataField >= 0 && sort.dataField < nd) {
        const dfi = sort.dataField;
        const withV = keys.map((k, idx) => {
          const v = aggOver(dfi, byKeyV.get(k) ?? []);
          return { k, idx, v: typeof v === "number" ? v : null };
        });
        withV.sort((a, b) => {
          if (a.v === null && b.v === null) return a.idx - b.idx;
          if (a.v === null) return 1;
          if (b.v === null) return -1;
          if (a.v !== b.v) return sort.order === "desc" ? b.v - a.v : a.v - b.v;
          return a.idx - b.idx;
        });
        keys = withV.map((x) => x.k);
      }
      siblingsCache.set(`${which}|${pathStr(node.path)}|${f}`, keys);
      for (const k of keys) {
        const recsAk = byKeyA.get(k) ?? [];
        const c: AxisNode = {
          field: f,
          key: k,
          label: labelOf(f, k),
          depth: d,
          recsV: byKeyV.get(k) ?? [],
          recsA: recsAk,
          children: [],
          dataIndex: node.dataIndex,
          parent: node,
          expandAll: showAll ? recsAk.length === 0 || node.expandAll : false,
          path: [...node.path, [f, k]],
        };
        const ps = pathStr(c.path);
        if (!pathMaps[which].has(ps)) pathMaps[which].set(ps, c.recsV);
        node.children.push(c);
        grow(c, d + 1);
      }
    };
    grow(root, 0);
    return root;
  }

  const rowTree = buildTree(rowAxis, recsRows, "rows");
  const colTree = buildTree(colAxis, recsCols, "cols");

  // ---- field forms ----------------------------------------------------------
  const layout = cfg.layout ?? "compact";
  const pivotCompact = layout === "compact";
  const pivotOutline = layout !== "tabular";
  const isCompact = (f: number) =>
    f === VALUES ? pivotCompact && pivotOutline : (fieldSettings(f).compact ?? pivotCompact) && (fieldSettings(f).outline ?? pivotOutline);
  const formOf = (f: number): "compact" | "outline" | "tabular" => {
    const outline = f === VALUES ? pivotOutline : (fieldSettings(f).outline ?? pivotOutline);
    if (!outline) return "tabular";
    const compact = f === VALUES ? pivotCompact : (fieldSettings(f).compact ?? pivotCompact);
    return compact ? "compact" : "outline";
  };
  const subtotalFuncs = (f: number): ("auto" | Agg)[] => {
    const s = fieldSettings(f).subtotals;
    if (s === "none") return [];
    if (Array.isArray(s)) return s.length ? s : [];
    return cfg.defaultSubtotal === false ? [] : ["auto"];
  };
  const subtotalTop = (f: number) => fieldSettings(f).subtotalTop ?? cfg.subtotalTop ?? true;
  const blankAfter = (f: number) => fieldSettings(f).insertBlankRow ?? cfg.insertBlankRow ?? false;

  // Row label columns.
  const rowCol: number[] = [];
  for (let d = 0; d < rowAxis.length; d++) {
    rowCol.push(d === 0 ? 0 : rowCol[d - 1] + (isCompact(rowAxis[d - 1]) ? 0 : 1));
  }

  // ---- lines ----------------------------------------------------------------
  function emitRows(node: AxisNode, d: number, out: Line[]) {
    const f = rowAxis[d];
    const isLast = d === rowAxis.length - 1;
    const pos = rowCol[d];
    const form = formOf(f);
    const valuesBelow = rowAxis.indexOf(VALUES) > d;
    const realBelow = rowAxis.slice(d + 1).some((x) => x !== VALUES);
    const subs = f === VALUES || !realBelow ? [] : subtotalFuncs(f);
    const top = form !== "tabular" && subtotalTop(f) && subs.length === 1 && !valuesBelow;
    for (const c of node.children) {
      const di = c.dataIndex;
      if (isLast) {
        out.push({ kind: "data", node: c, recs: c.recsV, di, func: null, labels: [[pos, c.label, c.field, c.key]], path: c.path, hasValues: true });
        continue;
      }
      if (form === "tabular") {
        const start = out.length;
        emitRows(c, d + 1, out);
        if (out.length > start) out[start].labels.unshift([pos, c.label, c.field, c.key]);
        else out.push({ kind: "header", node: c, recs: c.recsV, di, func: null, labels: [[pos, c.label, c.field, c.key]], path: c.path, hasValues: false });
      } else {
        const fn = top && subs[0] !== "auto" ? (subs[0] as Agg) : null;
        out.push({
          kind: top ? "sub" : "header",
          node: c,
          recs: c.recsV,
          di,
          func: fn,
          labels: [[pos, c.label, c.field, c.key]],
          path: c.path,
          hasValues: top,
        });
        emitRows(c, d + 1, out);
      }
      if (subs.length && !top) {
        for (const s of subs) {
          const fn = s === "auto" ? null : s;
          const suffix = s === "auto" ? "Total" : AGG_LABEL[s];
          if (valuesBelow) {
            for (let i = 0; i < nd; i++) {
              const label = s === "auto" ? `${c.label} ${dataNames[i]}` : `${c.label} ${suffix} ${dataNames[i]}`;
              out.push({ kind: "sub", node: c, recs: c.recsV, di: i, func: fn, labels: [[pos, label]], path: c.path, hasValues: true });
            }
          } else {
            out.push({ kind: "sub", node: c, recs: c.recsV, di, func: fn, labels: [[pos, `${c.label} ${suffix}`]], path: c.path, hasValues: true });
          }
        }
      }
      if (f !== VALUES && blankAfter(f)) {
        out.push({ kind: "blank", node: null, recs: [], di: null, func: null, labels: [], path: [], hasValues: false });
      }
    }
  }

  function emitCols(node: AxisNode, d: number, out: Line[]) {
    const f = colAxis[d];
    const isLast = d === colAxis.length - 1;
    const valuesBelow = colAxis.indexOf(VALUES) > d;
    const realBelow = colAxis.slice(d + 1).some((x) => x !== VALUES);
    const subs = f === VALUES || !realBelow ? [] : subtotalFuncs(f);
    for (const c of node.children) {
      const di = c.dataIndex;
      if (isLast) {
        out.push({ kind: "data", node: c, recs: c.recsV, di, func: null, labels: [[d, c.label, c.field, c.key]], path: c.path, hasValues: true });
        continue;
      }
      const start = out.length;
      emitCols(c, d + 1, out);
      if (out.length > start) out[start].labels.unshift([d, c.label, c.field, c.key]);
      else out.push({ kind: "header", node: c, recs: c.recsV, di, func: null, labels: [[d, c.label, c.field, c.key]], path: c.path, hasValues: false });
      for (const s of subs) {
        const fn = s === "auto" ? null : s;
        const suffix = s === "auto" ? "Total" : AGG_LABEL[s];
        if (valuesBelow) {
          for (let i = 0; i < nd; i++) {
            const label = s === "auto" ? `${c.label} ${dataNames[i]}` : `${c.label} ${suffix} ${dataNames[i]}`;
            out.push({ kind: "sub", node: c, recs: c.recsV, di: i, func: fn, labels: [[d, label]], path: c.path, hasValues: true });
          }
        } else out.push({ kind: "sub", node: c, recs: c.recsV, di, func: fn, labels: [[d, `${c.label} ${suffix}`]], path: c.path, hasValues: true });
      }
    }
  }

  const grandRow = cfg.grandTotalRow ?? true;
  const grandCaption = cfg.grandTotalCaption || "Grand Total";
  const grandCol = cfg.grandTotalCol ?? true;

  const rowLines: Line[] = [];
  let rowLabelCols = 0;
  if (rowAxis.length) {
    emitRows(rowTree, 0, rowLines);
    rowLabelCols = Math.max(...rowCol) + 1;
    if (rowReal && grandRow) {
      if (rowAxis.includes(VALUES)) {
        for (let i = 0; i < nd; i++) rowLines.push({ kind: "grand", node: null, recs: recsV, di: i, func: null, labels: [[0, `Total ${dataNames[i]}`]], path: [], hasValues: true });
      } else rowLines.push({ kind: "grand", node: null, recs: recsV, di: null, func: null, labels: [[0, grandCaption, undefined, "#grand"]], path: [], hasValues: true });
    }
  } else if (nd >= 1) {
    const label = cfg.gridDropZones ? "Total" : nd === 1 && colReal ? dataNames[0] : null;
    rowLines.push({ kind: "grand", node: null, recs: recsV, di: null, func: null, labels: label ? [[0, label]] : [], path: [], hasValues: true });
    rowLabelCols = label ? 1 : 0;
  }

  const colLines: Line[] = [];
  if (colAxis.length) {
    emitCols(colTree, 0, colLines);
    if (colReal && grandCol) {
      if (colAxis.includes(VALUES)) {
        for (let i = 0; i < nd; i++) colLines.push({ kind: "grand", node: null, recs: recsV, di: i, func: null, labels: [[0, `Total ${dataNames[i]}`]], path: [], hasValues: true });
      } else colLines.push({ kind: "grand", node: null, recs: recsV, di: null, func: null, labels: [[0, grandCaption, undefined, "#grand"]], path: [], hasValues: true });
    }
  } else if (nd >= 1) {
    colLines.push({ kind: "grand", node: null, recs: recsV, di: null, func: null, labels: [], path: [], hasValues: true });
  }

  // ---- values -----------------------------------------------------------------
  const valCache = new Map<string, Scalar | undefined>();
  const rawVal = (rp: [number, string][], cp: [number, string][], di: number): Scalar | undefined | "missing" => {
    const rk = pathStr(rp);
    const ck = pathStr(cp);
    const rr = pathMaps.rows.get(rk);
    const cr = pathMaps.cols.get(ck);
    if (!rr || !cr) return "missing";
    const key = `${rk}\u0003${ck}\u0003${di}`;
    if (valCache.has(key)) return valCache.get(key);
    const v = aggOver(di, intersect(rr, cr));
    valCache.set(key, v);
    return v;
  };

  const showAsValue = (rl: Line, cl: Line, di: number, v: Scalar | undefined): Scalar | undefined => {
    const d = values[di];
    const kind = d.showAs ?? "normal";
    if (kind === "normal") return v;
    const num = (x: Scalar | undefined | "missing"): number | Scalar | undefined => (x === "missing" ? undefined : x);
    const rp = rl.kind === "grand" ? [] : rl.path;
    const cp = cl.kind === "grand" ? [] : cl.path;
    const div = (a: Scalar | undefined, b: Scalar | undefined | "missing"): Scalar | undefined => {
      if (b === "missing" || b === undefined || b === null) return undefined;
      if (isError(a)) return a;
      if (isError(b)) return b;
      const x = typeof a === "number" ? a : 0;
      if (typeof b !== "number") return undefined;
      if (b === 0) return err("#DIV/0!");
      return x / b;
    };
    switch (kind) {
      case "percentOfTotal":
        return div(v, rawVal([], [], di));
      case "percentOfRow":
        return div(v, rawVal(rp, [], di));
      case "percentOfCol":
        return div(v, rawVal([], cp, di));
      case "index": {
        const gt = rawVal([], [], di);
        const rt = rawVal(rp, [], di);
        const ct = rawVal([], cp, di);
        if (isError(v)) return v;
        const nums = [gt, rt, ct].map((x) => num(x));
        if (nums.some((x) => typeof x !== "number")) return undefined;
        const [g, r, c] = nums as number[];
        if (r * c === 0) return err("#DIV/0!");
        return ((typeof v === "number" ? v : 0) * g) / (r * c);
      }
      case "percentOfParentRow":
        return div(v, rawVal(rp.length ? rp.slice(0, -1) : [], cp, di));
      case "percentOfParentCol":
        return div(v, rawVal(rp, cp.length ? cp.slice(0, -1) : [], di));
    }
    const base = d.baseField ?? -1;
    const inRows = rowAxis.includes(base);
    const inCols = colAxis.includes(base);
    if (!inRows && !inCols) return v;
    const which = inRows ? "rows" : "cols";
    const p = inRows ? rp : cp;
    const other = inRows ? cp : rp;
    const idx = p.findIndex(([f]) => f === base);
    if (idx < 0) return undefined;
    const withItem = (k: string): [number, string][] => p.map((e, i) => (i === idx ? [e[0], k] : e));
    const at = (k: string) => (inRows ? rawVal(withItem(k), other, di) : rawVal(other, withItem(k), di));
    const exists = (k: string) => pathMaps[which].has(pathStr(withItem(k)));
    const sibs = siblingsCache.get(`${which}|${pathStr(p.slice(0, idx))}|${base}`) ?? [];
    const cur = p[idx][1];
    if (kind === "percentOfParent") {
      const parentPath = p.slice(0, idx + 1);
      return div(v, inRows ? rawVal(parentPath, other, di) : rawVal(other, parentPath, di));
    }
    if (kind === "runTotal" || kind === "percentOfRunningTotal") {
      let acc = 0;
      let e: Scalar | null = null;
      for (const k of sibs) {
        const x = exists(k) ? at(k) : undefined;
        if (isError(x)) e = e ?? x;
        else if (typeof x === "number") acc += x;
        if (k === cur) break;
      }
      if (kind === "runTotal") return e ?? acc;
      if (e) return e;
      const deeper = p.slice(idx + 1);
      if (deeper.length) {
        // Below the base field the whole is the running total's end.
        let end = 0;
        for (const k of sibs) {
          const x = exists(k) ? at(k) : undefined;
          if (isError(x)) return x;
          if (typeof x === "number") end += x;
        }
        if (end === 0) return acc === 0 ? undefined : err("#DIV/0!");
        return acc / end;
      }
      // At the base field the whole is the total over all its items.
      const prefix = pathMaps[which].get(pathStr(p.slice(0, idx))) ?? [];
      const otherRecs = pathMaps[inRows ? "cols" : "rows"].get(pathStr(other)) ?? [];
      const recs = intersect(prefix, otherRecs);
      const total = aggOver(di, recs);
      if (isError(total)) return total;
      if (typeof total !== "number") return undefined;
      if (total === 0) return acc === 0 ? undefined : err("#DIV/0!");
      return acc / total;
    }
    if (kind === "rankAscending" || kind === "rankDescending") {
      if (typeof v !== "number") return undefined;
      const vals: number[] = [];
      for (const k of sibs) {
        const x = exists(k) ? at(k) : undefined;
        if (typeof x === "number") vals.push(x);
      }
      const better = vals.filter((x) => (kind === "rankAscending" ? x < v : x > v));
      return new Set(better).size + 1;
    }
    // difference / percent / percentDiff
    let baseKey: string | null = null;
    const bi = d.baseItem ?? "prev";
    if (bi === "prev" || bi === "next") {
      const i0 = sibs.indexOf(cur);
      const step = bi === "next" ? 1 : -1;
      for (let i = i0 + step; i >= 0 && i < sibs.length; i += step) {
        if (exists(sibs[i])) {
          baseKey = sibs[i];
          break;
        }
      }
      if (baseKey === null) baseKey = cur;
    } else {
      const all = allKeys(base);
      const k = all[bi];
      if (k === undefined) return err("#N/A");
      if (k !== cur && !exists(k)) return err("#N/A");
      baseKey = k;
    }
    if (baseKey === cur) {
      if (kind === "percent") return typeof v === "number" ? 1 : undefined;
      return undefined;
    }
    const b = at(baseKey);
    const bv = b === "missing" ? undefined : b;
    if (kind === "difference") {
      if (isError(v)) return v;
      if (isError(bv)) return bv;
      return (typeof v === "number" ? v : 0) - (typeof bv === "number" ? bv : 0);
    }
    if (v === undefined || v === null) return err("#NULL!");
    if (isError(v)) return v;
    if (typeof bv !== "number" || bv === 0) return undefined;
    const x = v as number;
    return kind === "percent" ? x / bv : (x - bv) / bv;
  };

  // ---- grid assembly ------------------------------------------------------------
  const gd = !!cfg.gridDropZones;
  const empty = rowAxis.length === 0 && colAxis.length === 0 && nd === 0 && !gd;
  if (gd) rowLabelCols = Math.max(rowLabelCols, 1);
  const pageBlock = layoutPages();
  const cells: (GridCell | null)[][] = [];
  const entries: PivotEntry[] = [];
  const detailMap = new Map<string, number[]>();

  const put = (r: number, c: number, cell: GridCell) => {
    while (cells.length <= r) cells.push([]);
    cells[r][c] = cell;
  };

  let tableRow = 0;
  let headerRows = 0;
  if (pageBlock.rows > 0) {
    for (const [r, c, cell] of pageBlock.cells) put(r, c, cell);
    tableRow = pageBlock.rows + 1;
  }

  let width = pageBlock.cols;
  let height = pageBlock.rows;
  if (empty) {
    if (pageBlock.rows === 0) {
      width = PLACEHOLDER_COLS;
      height = PLACEHOLDER_ROWS;
    }
  } else {
    const T = tableRow;
    const W = rowLabelCols;
    const headers = cfg.showHeaders !== false;
    const dataCaption = W > 0 && nd === 1 && (rowReal || gd);
    // Without field headers, empty header rows are left out; the classic
    // (drop zone) layout always has the caption row.
    const captionRow = gd
      ? colAxis.length || (rowAxis.length && !rowAxis.includes(VALUES))
        ? 1
        : 0
      : colReal && (headers || dataCaption)
        ? 1
        : 0;
    headerRows = captionRow + (colAxis.length ? colAxis.length : headers || nd === 1 ? 1 : 0);
    const lastHeader = T + headerRows - 1;
    const text = (v: string, kind: GridCellKind, bold = false): GridCell => ({ v, kind, bold });
    // Numeric items are written as numbers in their field's format.
    const itemCell = (lab: string, kind: GridCellKind, bold: boolean, f?: number, k?: string): GridCell => {
      if (k === "#grand") return { v: lab, kind, bold, edit: { kind: "grandTotal" } };
      if (f === VALUES) return { v: lab, kind, bold, field: VALUES, edit: { kind: "dataName", di: Number(k) } };
      const meta = f !== undefined && k !== undefined ? { field: f, edit: { kind: "item" as const, field: f, key: k } } : {};
      if (f !== undefined && k && k[0] === "n" && !cfg.fields?.[f]?.itemNames?.[k]) {
        const fmt = uniformFmt(f);
        return { v: Number(k.slice(1)), kind, bold, ...(fmt ? { fmt } : {}), ...meta };
      }
      return { ...text(lab, kind, bold), ...meta };
    };
    const firstReal = (axis: number[]) => axis.find((f) => f !== VALUES);
    const captionCell = (v: string, f: number | undefined, edit: PivotEdit): GridCell => ({
      v,
      kind: "caption",
      bold: false,
      ...(f !== undefined ? { field: f } : {}),
      edit,
    });
    // Caption row.
    if (colReal || gd) {
      if (dataCaption) put(T, 0, captionCell(dataNames[0], undefined, { kind: "dataName", di: 0 }));
      if (!headers) {
        /* no field captions */
      } else if (pivotCompact) put(T, W, captionCell(cfg.colHeaderCaption || "Column Labels", firstReal(colAxis), { kind: "colCaption" }));
      else
        colAxis.forEach((f, i) =>
          put(T, W + i, captionCell(fieldName(cfg, src, f), f, f === VALUES ? { kind: "valuesCaption" } : { kind: "field", field: f })),
        );
    }
    // Row captions.
    if (rowAxis.length && headers) {
      const seen = new Set<number>();
      rowAxis.forEach((f, d) => {
        const c = rowCol[d];
        if (seen.has(c)) return;
        seen.add(c);
        if (c === 0 && pivotCompact && rowReal) {
          put(lastHeader, c, captionCell(cfg.rowHeaderCaption || "Row Labels", firstReal(rowAxis), { kind: "rowCaption" }));
        } else put(lastHeader, c, captionCell(fieldName(cfg, src, f), f, f === VALUES ? { kind: "valuesCaption" } : { kind: "field", field: f }));
      });
    }
    // Column item labels and data headers.
    colLines.forEach((cl, j) => {
      for (const [lvl, lab, lf, lk] of cl.labels) put(T + captionRow + lvl, W + j, itemCell(lab, "colLabel", cl.kind !== "data", lf, lk));
      if (!colAxis.length && cl.kind === "grand") {
        const h = gd ? "Total" : nd === 1 ? dataNames[0] : "";
        if (h) put(lastHeader, W + j, gd || nd !== 1 ? text(h, "caption") : captionCell(h, undefined, { kind: "dataName", di: 0 }));
      }
    });
    // Rows.
    const dataRow0 = T + headerRows;
    rowLines.forEach((rl, i) => {
      const r = dataRow0 + i;
      for (const [pos, lab, lf, lk] of rl.labels) put(r, pos, itemCell(lab, "rowLabel", rl.kind === "sub" || rl.kind === "grand" || rl.kind === "header", lf, lk));
      if (!rl.hasValues) return;
      colLines.forEach((cl, j) => {
        if (!cl.hasValues) return;
        const di = rl.di ?? cl.di ?? (nd ? 0 : null);
        if (di === null) return;
        const recs = rl.kind === "grand" ? cl.recs : cl.kind === "grand" ? rl.recs : intersect(rl.recs, cl.recs);
        const func = rl.func ?? cl.func ?? null;
        let v: Scalar | undefined = aggOver(di, recs, func);
        if (!func) v = showAsValue(rl, cl, di, v);
        const c = W + j;
        detailMap.set(`${r - dataRow0},${j}`, recs);
        const kind: GridCellKind = rl.kind === "grand" || cl.kind === "grand" ? "grand" : rl.kind === "sub" || cl.kind === "sub" ? "subtotal" : "value";
        const d = values[di];
        const autoFmt = d.showAs && d.showAs !== "normal" && d.showAs.toLowerCase().includes("percent") ? "0.00%" : undefined;
        if (v !== undefined) {
          const cell: GridCell = { v: isError(v) ? { error: v.error } : (v as CellValue), kind, fmt: d.numFmt, autoFmt, bold: kind !== "value" };
          put(r, c, cell);
        }
        const f: PivotEntry["f"] = [];
        // Items in field order, as Excel lists them in GETPIVOTDATA.
        const pairs = [...(rl.kind === "grand" ? [] : rl.path), ...(cl.kind === "grand" ? [] : cl.path)].sort((a, b) => a[0] - b[0]);
        for (const [pf, pk] of pairs) {
          const lab = labelOf(pf, pk);
          const outside = pk[0] === "g" && /^[<>]/.test(lab);
          const cellNum = pk[0] === "n" ? Number(pk.slice(1)) : pk[0] === "g" && !outside ? groupNumber(pf, Number(pk.slice(1))) : undefined;
          const type = outside
            ? "r"
            : pk[0] === "n" && isDateFormat(uniformFmt(pf))
              ? "d"
              : pk[0] === "b" || pk[0] === "e" || pk[0] === "z"
                ? pk[0]
                : undefined;
          const name = fieldName(cfg, src, pf);
          f.push(type ? [name, lab, cellNum ?? null, type] : cellNum !== undefined ? [name, lab, cellNum] : [name, lab]);
        }
        if (!func) entries.push({ r, c, d: di, f, v: v === undefined ? null : isError(v) ? { error: v.error } : (v as number | string | boolean) });
      });
    });
    height = Math.max(height, dataRow0 + rowLines.length);
    if (gd && nd === 0) {
      // Empty drop zones for the data area.
      if (!rowAxis.length) height = Math.max(height, dataRow0 + 13);
      if (!colAxis.length) width = Math.max(width, W + 6);
    }
    width = Math.max(width, W + colLines.length, W, colReal && !pivotCompact ? W + colAxis.length : 0, colReal ? W + 1 : 0);
    // Row captions may extend past the label columns (Values caption etc.).
    for (const row of cells) width = Math.max(width, row.length);
    height = Math.max(height, cells.length);
  }

  // Normalise to a rectangle.
  const grid: (GridCell | null)[][] = [];
  for (let r = 0; r < height; r++) {
    const row: (GridCell | null)[] = [];
    for (let c = 0; c < width; c++) row.push(cells[r]?.[c] ?? null);
    grid.push(row);
  }

  const dataRowStart = tableRow + headerRows;
  return {
    cells: grid,
    rows: height,
    cols: width,
    tableRow,
    headerRows,
    rowLabelCols,
    dataNames,
    dataFields: values.map((d, i) => ({ name: dataNames[i], field: fieldSourceName(cfg, src, d.field) })),
    pages: pages.map((p) => ({ field: fieldName(cfg, src, p.field), item: p.selected?.length === 1 ? labelOf(p.field, p.selected[0]) : "" })),
    entries,
    details: (r, c) => detailMap.get(`${r - dataRowStart},${c - rowLabelCols}`) ?? null,
    source: src,
    records,
    empty,
  };

  // GETPIVOTDATA addresses group items by number: the year, quarter (1-4),
  // month (1-12), day of the year, or a number bucket's start.
  function groupNumber(f: number, gk: number): number | undefined {
    const g = groups[f - nSrc];
    if (!g || g.type === "items" || !Number.isFinite(gk)) return undefined;
    if (g.type === "number") return gk;
    switch (g.by) {
      case "quarters":
      case "months":
        return gk + 1;
      case "days": {
        const m = Math.floor(gk / 100);
        const d = gk % 100;
        const cum = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
        return (cum[m - 1] ?? 0) + d;
      }
      default:
        return gk;
    }
  }

  function layoutPages(): { rows: number; cols: number; cells: [number, number, GridCell][] } {
    const out: [number, number, GridCell][] = [];
    if (!pages.length) return { rows: 0, cols: 0, cells: out };
    const n = pages.length;
    const wrap = cfg.pageWrap && cfg.pageWrap > 0 ? cfg.pageWrap : n;
    let rows = 0;
    let cols = 0;
    pages.forEach((p, i) => {
      const major = Math.floor(i / wrap);
      const minor = i % wrap;
      const r = cfg.pageOverThenDown ? major : minor;
      const g = cfg.pageOverThenDown ? minor : major;
      const c = g * 3;
      let value = "(All)";
      if (p.selected) {
        if (p.selected.length === 1) value = labelOf(p.field, p.selected[0]);
        else value = "(Multiple Items)";
      }
      out.push([r, c, { v: fieldName(cfg, src, p.field), kind: "pageName", bold: true, field: p.field, edit: { kind: "field", field: p.field } }]);
      const sel = p.selected?.length === 1 ? p.selected[0] : null;
      const fmt = sel && sel[0] === "n" ? pageFormat(p.field, sel) : undefined;
      out.push([r, c + 1, { v: fmt ? Number(sel!.slice(1)) : value, kind: "pageValue", fmt }]);
      rows = Math.max(rows, r + 1);
      cols = Math.max(cols, c + 2);
    });
    return { rows, cols, cells: out };
  }

  function pageFormat(f: number, key: string): string | undefined {
    for (let i = 0; i < records.length; i++) {
      const c = cellOf(i, f);
      if (cellItemKey(c) === key) return c.fmt ?? "General";
    }
    return undefined;
  }
}

function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const k = formatKind(fmt);
  return k === "date" || k === "time";
}

/** Display text of a report cell (format applied). */
export function cellText(cell: GridCell | null, useAuto = true): string {
  if (!cell || cell.v === null) return "";
  const v = cell.v;
  if (typeof v === "object") return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    const fmt = cell.fmt ?? (useAuto ? cell.autoFmt : undefined);
    return fmt && fmt !== "General" ? formatValue(v, fmt) : formatGeneral(v);
  }
  return v;
}

/** The report as text rows (formats applied). */
export function reportText(rep: PivotReport, useAuto = true): string[][] {
  return rep.cells.map((row) => row.map((c) => cellText(c, useAuto)));
}

/**
 * detailTable is "Show details" for a value cell: the source header and the
 * records behind the cell (one empty row when there are none), as values.
 */
export function detailRecords(rep: PivotReport, r: number, c: number): { header: string[]; rows: SrcCell[][] } | null {
  const recs = rep.details(r, c);
  if (!recs) return null;
  const n = rep.source.names.length;
  return { header: rep.source.names.slice(), rows: recs.map((i) => rep.source.records[i].slice(0, n)) };
}

export function detailTable(rep: PivotReport, r: number, c: number): string[][] | null {
  const d = detailRecords(rep, r, c);
  if (!d) return null;
  const rows = d.rows.map((rec) => rec.map((x) => x.text));
  return [d.header, ...(rows.length ? rows : [d.header.map(() => "")])];
}
