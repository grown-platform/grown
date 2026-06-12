/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet ref API is loosely typed. */

import { colName } from "./chartData";

export interface PivotRange {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export type Agg = "sum" | "count" | "average" | "min" | "max";

export interface PivotConfig {
  id: string;
  title: string;
  range: PivotRange;
  /** column indexes RELATIVE to the range (0 = first column of the range). */
  rowField: number;
  colField: number | null;
  valueField: number;
  agg: Agg;
}

export interface PivotResult {
  rowFieldName: string;
  colFieldName: string | null;
  colKeys: string[];
  rows: { key: string; values: number[]; total: number }[];
  colTotals: number[];
  grandTotal: number;
  valueLabel: string;
}

interface RC {
  text: string;
  num: number;
}

// readRange reads the live cell values over a range into a {text,num} grid.
function readRange(wb: any, range: PivotRange): RC[][] {
  const map = new Map<string, any>();
  try {
    const curId = wb.getSheet?.()?.id;
    const all: any[] = wb.getAllSheets?.() ?? [];
    const sheet = all.find((s) => s.id === curId) ?? all[0];
    (sheet?.celldata ?? []).forEach((cd: any) => {
      if (cd && cd.v != null) map.set(`${cd.r}_${cd.c}`, cd.v);
    });
  } catch {
    /* ignore */
  }
  const grid: RC[][] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row: RC[] = [];
    for (let c = range.c0; c <= range.c1; c++) {
      const v = map.get(`${r}_${c}`);
      const raw = v != null && typeof v === "object" ? (v.v ?? v.m) : v;
      const text = v != null && typeof v === "object" ? (v.m ?? v.v ?? "").toString() : (v ?? "").toString();
      const num = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/[, $%]/g, ""));
      row.push({ text, num: isFinite(num) ? num : NaN });
    }
    grid.push(row);
  }
  return grid;
}

/** readHeaders returns the field names (first row of the range). */
export function readHeaders(wb: any, range: PivotRange): string[] {
  const grid = readRange(wb, { ...range, r1: range.r0 });
  return (grid[0] ?? []).map((c, i) => c.text || `Column ${colName(range.c0 + i)}`);
}

const AGG_LABEL: Record<Agg, string> = {
  sum: "Sum",
  count: "Count",
  average: "Average",
  min: "Min",
  max: "Max",
};

function aggregate(values: number[], agg: Agg): number {
  const nums = values.filter((v) => isFinite(v));
  if (agg === "count") return values.length; // count of records in the bucket
  if (nums.length === 0) return 0;
  switch (agg) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "average":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
  return 0;
}

/**
 * buildPivot groups the range's data rows by the row field (and optional column
 * field) and aggregates the value field within each bucket, with row/column
 * grand totals.
 */
export function buildPivot(wb: any, cfg: PivotConfig): PivotResult {
  const grid = readRange(wb, cfg.range);
  const headers = grid[0] ?? [];
  const dataRows = grid.slice(1);

  const rowFieldName = headers[cfg.rowField]?.text || "Row";
  const colFieldName = cfg.colField != null ? headers[cfg.colField]?.text || "Column" : null;
  const valueLabel = `${AGG_LABEL[cfg.agg]} of ${headers[cfg.valueField]?.text || "Value"}`;

  // Distinct keys (insertion order preserved).
  const rowKeys: string[] = [];
  const colKeys: string[] = [];
  const seenRow = new Set<string>();
  const seenCol = new Set<string>();
  // buckets[rowKey][colKey] = number[]
  const buckets = new Map<string, Map<string, number[]>>();

  for (const dr of dataRows) {
    const rk = dr[cfg.rowField]?.text ?? "";
    if (rk === "" && dr.every((c) => c.text === "")) continue; // skip fully-empty rows
    const ck = cfg.colField != null ? (dr[cfg.colField]?.text ?? "") : "__all__";
    const val = dr[cfg.valueField]?.num ?? NaN;

    if (!seenRow.has(rk)) {
      seenRow.add(rk);
      rowKeys.push(rk);
    }
    if (cfg.colField != null && !seenCol.has(ck)) {
      seenCol.add(ck);
      colKeys.push(ck);
    }
    if (!buckets.has(rk)) buckets.set(rk, new Map());
    const m = buckets.get(rk)!;
    if (!m.has(ck)) m.set(ck, []);
    m.get(ck)!.push(val);
  }

  const effectiveCols = cfg.colField != null ? colKeys : ["__all__"];

  const rows = rowKeys.map((rk) => {
    const m = buckets.get(rk)!;
    const values = effectiveCols.map((ck) => (m.has(ck) ? aggregate(m.get(ck)!, cfg.agg) : 0));
    const allVals = effectiveCols.flatMap((ck) => (m.has(ck) ? m.get(ck)! : []));
    const total = aggregate(allVals, cfg.agg);
    return { key: rk || "(blank)", values, total };
  });

  const colTotals = effectiveCols.map((ck) => {
    const all = rowKeys.flatMap((rk) => {
      const m = buckets.get(rk)!;
      return m.has(ck) ? m.get(ck)! : [];
    });
    return aggregate(all, cfg.agg);
  });

  const grandAll = dataRows
    .filter((dr) => !(dr.every((c) => c.text === "")))
    .map((dr) => dr[cfg.valueField]?.num ?? NaN);
  const grandTotal = aggregate(grandAll, cfg.agg);

  return {
    rowFieldName,
    colFieldName,
    colKeys: cfg.colField != null ? colKeys.map((c) => c || "(blank)") : [],
    rows,
    colTotals,
    grandTotal,
    valueLabel,
  };
}

export { AGG_LABEL };
