/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */

// Sheet structure operations (M7): insert / delete / move whole rows or
// columns, insert / delete cells with a shift, and the formula-reference
// arithmetic they need.
//
// - translateFormula: relative refs move with the formula (fill, paste, sort).
// - shiftFormula: refs keep pointing at the same cells after a structure op
//   (absolute refs included, as in Excel); refs to deleted cells → #REF!.
// - applyStructureOp: the whole-workbook rewrite (cells, merges, row/column
//   sizes, hidden flags, borders, grownCF / grownDV / grownFilter, named
//   ranges). structureFormulaEdits / structureModelPatches are the pieces the
//   editor needs when FortuneSheet already moved the cells itself.
//
// internal/sheets/structure.go is the Go twin (same rules, same fixture:
// internal/sheets/testdata/structure/shift.json). Keep them in step.

import type { CellRect } from "./cellRange";

export type StructureOp =
  | { kind: "insert"; axis: "row" | "col"; sheet: string; index: number; count: number }
  | { kind: "delete"; axis: "row" | "col"; sheet: string; index: number; count: number }
  | { kind: "move"; axis: "row" | "col"; sheet: string; index: number; count: number; to: number }
  | { kind: "insertCells"; sheet: string; rect: CellRect; shift: "down" | "right" }
  | { kind: "deleteCells"; sheet: string; rect: CellRect; shift: "up" | "left" };

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

const IDENT_CHAR = /[\p{L}\p{M}\p{N}_.]/u;
const isIdent = (ch: string | undefined) => ch !== undefined && IDENT_CHAR.test(ch);

// ---- A1 helpers ------------------------------------------------------------------------

function colLetters(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function lettersCol(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- reference scanner -----------------------------------------------------------------

interface Coord {
  abs: boolean;
  n: number; // 0-based
}

/** A parsed reference: a cell, a cell range, whole columns (A:C) or whole rows (1:3). */
interface Ref {
  kind: "cell" | "range" | "cols" | "rows";
  r1: Coord;
  c1: Coord;
  r2: Coord;
  c2: Coord;
}

const RE_RANGE = /(\$?)([A-Za-z]{1,3})(\$?)([0-9]+):(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)/y;
const RE_CELL = /(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)/y;
const RE_COLS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/y;
const RE_ROWS = /(\$?)([0-9]+):(\$?)([0-9]+)/y;

const col = (abs: string, s: string): Coord | null => {
  const n = lettersCol(s);
  return n >= 0 && n < MAX_COLS ? { abs: abs === "$", n } : null;
};
const row = (abs: string, s: string): Coord | null => {
  const n = Number(s);
  return n >= 1 && n <= MAX_ROWS ? { abs: abs === "$", n: n - 1 } : null;
};
const NONE: Coord = { abs: false, n: 0 };

function exec(re: RegExp, s: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(s);
}

/** Parses a reference starting exactly at `at`; returns it with its end offset. */
function matchRef(s: string, at: number): { ref: Ref; end: number } | null {
  const ok = (end: number) => {
    const ch = s[end];
    return !(isIdent(ch) || ch === "(" || ch === "!" || ch === "$");
  };
  let m = exec(RE_RANGE, s, at);
  if (m) {
    const c1 = col(m[1], m[2]);
    const r1 = row(m[3], m[4]);
    const c2 = col(m[5], m[6]);
    const r2 = row(m[7], m[8]);
    const end = at + m[0].length;
    if (c1 && r1 && c2 && r2 && ok(end)) return { ref: { kind: "range", c1, r1, c2, r2 }, end };
  }
  m = exec(RE_CELL, s, at);
  if (m) {
    const c1 = col(m[1], m[2]);
    const r1 = row(m[3], m[4]);
    const end = at + m[0].length;
    if (c1 && r1 && ok(end)) return { ref: { kind: "cell", c1, r1, c2: c1, r2: r1 }, end };
  }
  m = exec(RE_COLS, s, at);
  if (m) {
    const c1 = col(m[1], m[2]);
    const c2 = col(m[3], m[4]);
    const end = at + m[0].length;
    if (c1 && c2 && ok(end)) return { ref: { kind: "cols", c1, c2, r1: NONE, r2: NONE }, end };
  }
  m = exec(RE_ROWS, s, at);
  if (m) {
    const r1 = row(m[1], m[2]);
    const r2 = row(m[3], m[4]);
    const end = at + m[0].length;
    if (r1 && r2 && ok(end)) return { ref: { kind: "rows", r1, r2, c1: NONE, c2: NONE }, end };
  }
  return null;
}

const cStr = (c: Coord) => (c.abs ? "$" : "") + colLetters(c.n);
const rStr = (r: Coord) => (r.abs ? "$" : "") + String(r.n + 1);

function renderRef(ref: Ref): string {
  switch (ref.kind) {
    case "cell":
      return cStr(ref.c1) + rStr(ref.r1);
    case "range":
      return `${cStr(ref.c1)}${rStr(ref.r1)}:${cStr(ref.c2)}${rStr(ref.r2)}`;
    case "cols":
      return `${cStr(ref.c1)}:${cStr(ref.c2)}`;
    case "rows":
      return `${rStr(ref.r1)}:${rStr(ref.r2)}`;
  }
}

const sameRef = (a: Ref, b: Ref) =>
  a.kind === b.kind && a.r1.n === b.r1.n && a.r2.n === b.r2.n && a.c1.n === b.c1.n && a.c2.n === b.c2.n;

/**
 * Visits every reference in a formula (outside string literals and [...]
 * structured-reference brackets). `visit` gets the sheet qualifier (unquoted,
 * or null) and returns the replacement: a Ref, null for #REF!, or undefined to
 * keep the original text.
 */
function rewriteRefs(formula: string, visit: (sheet: string | null, ref: Ref) => Ref | null | undefined): string {
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "[") {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (formula[j] === "[") depth++;
        else if (formula[j] === "]" && --depth === 0) break;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const boundary = i === 0 || !(isIdent(formula[i - 1]) || formula[i - 1] === "$");
    if (!boundary) {
      out += ch;
      i++;
      continue;
    }
    let sheet: string | null = null;
    let j = i;
    let wordEnd = -1;
    if (ch === "'") {
      let k = i + 1;
      let name = "";
      while (k < n) {
        if (formula[k] === "'") {
          if (formula[k + 1] === "'") {
            name += "'";
            k += 2;
            continue;
          }
          break;
        }
        name += formula[k];
        k++;
      }
      if (formula[k + 1] !== "!") {
        out += formula.slice(i, k + 1);
        i = k + 1;
        continue;
      }
      sheet = name;
      j = k + 2;
    } else if (isIdent(ch)) {
      let k = i;
      while (k < n && isIdent(formula[k])) k++;
      wordEnd = k;
      if (formula[k] === "!") {
        sheet = formula.slice(i, k);
        j = k + 1;
      }
    }
    const m = matchRef(formula, j);
    if (m) {
      const next = visit(sheet, m.ref);
      if (next === undefined || (next !== null && sameRef(next, m.ref))) out += formula.slice(i, m.end);
      else if (next === null) out += "#REF!";
      else out += formula.slice(i, j) + renderRef(next);
      i = m.end;
      continue;
    }
    if (sheet !== null) {
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    if (wordEnd > i) {
      out += formula.slice(i, wordEnd);
      i = wordEnd;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---- translate (fill / paste / sort) ---------------------------------------------------

/** Relative refs move by (dr, dc), $-absolute parts stay; refs pushed off the sheet become #REF!. Used by fill, paste and sort. */
export function translateFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  return rewriteRefs(formula, (_sheet, ref) => {
    const mv = (c: Coord, d: number, max: number): Coord | null => {
      const n = c.abs ? c.n : c.n + d;
      return n < 0 || n >= max ? null : { abs: c.abs, n };
    };
    const next: Ref = { ...ref };
    if (ref.kind !== "rows") {
      const c1 = mv(ref.c1, dc, MAX_COLS);
      const c2 = mv(ref.c2, dc, MAX_COLS);
      if (!c1 || !c2) return null;
      next.c1 = c1;
      next.c2 = c2;
    }
    if (ref.kind !== "cols") {
      const r1 = mv(ref.r1, dr, MAX_ROWS);
      const r2 = mv(ref.r2, dr, MAX_ROWS);
      if (!r1 || !r2) return null;
      next.r1 = r1;
      next.r2 = r2;
    }
    return next;
  });
}

// ---- 1-D position arithmetic -----------------------------------------------------------

interface AxisOp {
  kind: "insert" | "delete" | "move";
  index: number;
  count: number;
  to: number;
}

/** New position of one row/column index, or null when it is deleted. */
function mapPos(x: number, op: AxisOp): number | null {
  const { index: i, count: n, to } = op;
  if (n <= 0) return x;
  switch (op.kind) {
    case "insert":
      return x >= i ? x + n : x;
    case "delete":
      if (x < i) return x;
      return x >= i + n ? x - n : null;
    case "move":
      if (to >= i && to <= i + n) return x;
      if (to > i + n) {
        if (x >= i && x < i + n) return x + (to - i - n);
        if (x >= i + n && x < to) return x - n;
        return x;
      }
      if (x >= i && x < i + n) return x - (i - to);
      if (x >= to && x < i) return x + n;
      return x;
  }
}

/** New [a, b] interval, or null when every index in it is deleted. */
function mapInterval(a: number, b: number, op: AxisOp): [number, number] | null {
  if (op.kind === "delete") {
    const end = op.index + op.count;
    if (op.count <= 0) return [a, b];
    if (a >= op.index && b < end) return null;
    const na = a < op.index ? a : a >= end ? a - op.count : op.index;
    const nb = b < op.index ? b : b >= end ? b - op.count : op.index - 1;
    return [na, nb];
  }
  const na = mapPos(a, op) as number;
  const nb = mapPos(b, op) as number;
  return na <= nb ? [na, nb] : [nb, na];
}

interface Area {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/**
 * Area after op (the area is on op's sheet). `span` says which axes the area
 * really has: whole-column refs ignore row ops, whole-row refs ignore column
 * ops, and neither is touched by cell shifts. null = deleted.
 */
function shiftArea(a: Area, span: "area" | "cols" | "rows", op: StructureOp): Area | null {
  if (op.kind === "insertCells" || op.kind === "deleteCells") {
    if (span !== "area") return a;
    const r = op.rect;
    const kind = op.kind === "insertCells" ? "insert" : "delete";
    const vertical = op.kind === "insertCells" ? op.shift === "down" : op.shift === "up";
    if (vertical) {
      if (a.c1 < r.c1 || a.c2 > r.c2) return a;
      const iv = mapInterval(a.r1, a.r2, { kind, index: r.r1, count: r.r2 - r.r1 + 1, to: 0 });
      return iv && { ...a, r1: iv[0], r2: iv[1] };
    }
    if (a.r1 < r.r1 || a.r2 > r.r2) return a;
    const iv = mapInterval(a.c1, a.c2, { kind, index: r.c1, count: r.c2 - r.c1 + 1, to: 0 });
    return iv && { ...a, c1: iv[0], c2: iv[1] };
  }
  const axisOp: AxisOp = { kind: op.kind, index: op.index, count: op.count, to: op.kind === "move" ? op.to : 0 };
  if (op.axis === "row") {
    if (span === "cols") return a;
    const iv = mapInterval(a.r1, a.r2, axisOp);
    return iv && { ...a, r1: iv[0], r2: iv[1] };
  }
  if (span === "rows") return a;
  const iv = mapInterval(a.c1, a.c2, axisOp);
  return iv && { ...a, c1: iv[0], c2: iv[1] };
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Rewrites refs in a formula living on sheet `hostSheet` after `op` (unqualified refs belong to hostSheet; qualified refs to their sheet). Absolute refs shift too (Excel). Refs entirely inside a deleted block → #REF!; ranges partially deleted shrink; inserting inside a range grows it. */
export function shiftFormula(formula: string, hostSheet: string, op: StructureOp): string {
  return rewriteRefs(formula, (sheet, ref) => {
    if (!sameName(sheet ?? hostSheet, op.sheet)) return undefined;
    const span = ref.kind === "cols" ? "cols" : ref.kind === "rows" ? "rows" : "area";
    const a = shiftArea({ r1: ref.r1.n, c1: ref.c1.n, r2: ref.r2.n, c2: ref.c2.n }, span, op);
    if (!a) return null;
    if (a.r2 >= MAX_ROWS || a.c2 >= MAX_COLS) return null;
    return {
      kind: ref.kind,
      r1: { abs: ref.r1.abs, n: a.r1 },
      r2: { abs: ref.r2.abs, n: a.r2 },
      c1: { abs: ref.c1.abs, n: a.c1 },
      c2: { abs: ref.c2.abs, n: a.c2 },
    };
  });
}

/** Rect after op, or null when deleted. The rect is taken to be on op's sheet. */
export function shiftRect(rect: CellRect, op: StructureOp): CellRect | null {
  const a = shiftArea(
    {
      r1: Math.min(rect.r1, rect.r2),
      c1: Math.min(rect.c1, rect.c2),
      r2: Math.max(rect.r1, rect.r2),
      c2: Math.max(rect.c1, rect.c2),
    },
    "area",
    op,
  );
  if (!a) return null;
  return { c1: a.c1, r1: a.r1, c2: Math.min(a.c2, MAX_COLS - 1), r2: Math.min(a.r2, MAX_ROWS - 1) };
}

/** Where cell (r, c) of op's sheet ends up, or null when it is deleted. */
function mapCell(r: number, c: number, op: StructureOp): [number, number] | null {
  const a = shiftArea({ r1: r, c1: c, r2: r, c2: c }, "area", op);
  return a ? [a.r1, a.c1] : null;
}

/** Old → new index for one axis (row sizes, hidden flags); null when not affected. */
function axisMapper(op: StructureOp, axis: "row" | "col"): ((x: number) => number | null) | null {
  if (op.kind === "insertCells" || op.kind === "deleteCells" || op.axis !== axis) return null;
  const axisOp: AxisOp = { kind: op.kind, index: op.index, count: op.count, to: op.kind === "move" ? op.to : 0 };
  return (x) => mapPos(x, axisOp);
}

// ---- workbook ------------------------------------------------------------------------------

function findTarget(sheets: any[], sheet: string): number {
  const byId = sheets.findIndex((s) => s && s.id !== undefined && String(s.id) === sheet);
  if (byId >= 0) return byId;
  return sheets.findIndex((s) => typeof s?.name === "string" && sameName(s.name, sheet));
}

/** op with `sheet` resolved to the target sheet's name (callers may pass an id). */
function resolveOp(sheets: any[], op: StructureOp): { op: StructureOp; target: number } | null {
  if (!Array.isArray(sheets)) return null;
  const target = findTarget(sheets, op.sheet);
  if (target < 0) return null;
  return { op: { ...op, sheet: String(sheets[target].name ?? op.sheet) } as StructureOp, target };
}

const isFormula = (f: unknown): f is string => typeof f === "string" && f.startsWith("=");

function shiftIfFormula(v: unknown, host: string, op: StructureOp): unknown {
  return isFormula(v) ? shiftFormula(v, host, op) : v;
}

/** grownCF after op: formula fields everywhere; ranges/base only on the target sheet. */
function shiftCF(rules: any, host: string, op: StructureOp, onTarget: boolean): any {
  if (!Array.isArray(rules)) return rules;
  const out: any[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") {
      out.push(rule);
      continue;
    }
    const next: any = { ...rule };
    for (const k of ["formula1", "formula2", "text"]) if (k in next) next[k] = shiftIfFormula(next[k], host, op);
    if (Array.isArray(next.cfvos)) {
      next.cfvos = next.cfvos.map((v: any) =>
        v && v.type === "formula" && typeof v.value === "string"
          ? { ...v, value: shiftFormula(v.value, host, op) }
          : v,
      );
    }
    if (onTarget) {
      if (Array.isArray(next.ranges)) {
        next.ranges = next.ranges.map((r: CellRect) => shiftRect(r, op)).filter(Boolean);
        if (next.ranges.length === 0) continue;
      }
      if (next.base && typeof next.base === "object") {
        const p = mapCell(next.base.r, next.base.c, op);
        if (p) next.base = { r: p[0], c: p[1] };
        else {
          const f = next.ranges?.[0];
          next.base = f ? { r: f.r1, c: f.c1 } : next.base;
        }
      }
    }
    out.push(next);
  }
  return out;
}

function shiftDV(rules: any, host: string, op: StructureOp, onTarget: boolean): any {
  if (!Array.isArray(rules)) return rules;
  const out: any[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") {
      out.push(rule);
      continue;
    }
    const next: any = { ...rule };
    for (const k of ["formula1", "formula2"]) if (k in next) next[k] = shiftIfFormula(next[k], host, op);
    if (onTarget && Array.isArray(next.ranges)) {
      next.ranges = next.ranges.map((r: CellRect) => shiftRect(r, op)).filter(Boolean);
      if (next.ranges.length === 0) continue;
    }
    out.push(next);
  }
  return out;
}

function shiftFilter(state: any, op: StructureOp): any {
  if (!state || typeof state !== "object" || !state.range) return state;
  const old = state.range;
  const range = shiftRect(old, op);
  if (!range) return null;
  const colMap = (off: number): number | null => {
    const p = mapCell(old.r1, old.c1 + off, op);
    if (!p) return null;
    const k = p[1] - range.c1;
    return k >= 0 && k <= range.c2 - range.c1 ? k : null;
  };
  const next: any = { ...state, range: { ...old, ...range } };
  if (state.columns && typeof state.columns === "object") {
    const cols: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.columns)) {
      const nk = colMap(Number(k));
      if (nk !== null) cols[String(nk)] = v;
    }
    next.columns = cols;
  }
  if (state.sort && typeof state.sort === "object") {
    const nk = colMap(Number(state.sort.colId));
    if (nk === null) delete next.sort;
    else next.sort = { ...state.sort, colId: nk };
  }
  return next;
}

function namedRangeHost(sheets: any[], nr: any): string {
  if (nr?.sheetId !== undefined && nr.sheetId !== "") {
    const s = sheets.find((x) => x && String(x.id) === String(nr.sheetId));
    if (s?.name !== undefined) return String(s.name);
  }
  if (typeof nr?.sheetName === "string" && nr.sheetName) return nr.sheetName;
  return String(sheets[0]?.name ?? "");
}

function shiftNamedRanges(list: any, sheets: any[], op: StructureOp): any {
  if (!Array.isArray(list)) return list;
  return list.map((nr: any) => {
    if (!nr || typeof nr.range !== "string") return nr;
    const range = shiftFormula(nr.range, namedRangeHost(sheets, nr), op);
    return range === nr.range ? nr : { ...nr, range };
  });
}

/** The grown* model fields (and _namedRanges on sheet 0) a sheet has after op. */
function modelFields(sheets: any[], i: number, op: StructureOp, target: number): Record<string, unknown> {
  const sheet = sheets[i];
  const host = String(sheet?.name ?? "");
  const out: Record<string, unknown> = {};
  if ("grownCF" in (sheet ?? {})) out.grownCF = shiftCF(sheet.grownCF, host, op, i === target);
  if ("grownDV" in (sheet ?? {})) out.grownDV = shiftDV(sheet.grownDV, host, op, i === target);
  if (i === target && "grownFilter" in (sheet ?? {})) out.grownFilter = shiftFilter(sheet.grownFilter, op);
  if (i === 0 && "_namedRanges" in (sheet ?? {})) out._namedRanges = shiftNamedRanges(sheet._namedRanges, sheets, op);
  return out;
}

/** Visit each cell (dense data or celldata). */
function forEachCell(sheet: any, fn: (r: number, c: number, cell: any) => void) {
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((rowArr: any[], r: number) =>
      rowArr?.forEach?.((cell: any, c: number) => {
        if (cell !== null && cell !== undefined) fn(r, c, cell);
      }),
    );
    return;
  }
  for (const cd of Array.isArray(sheet?.celldata) ? sheet.celldata : []) {
    if (cd && cd.v !== null && cd.v !== undefined) fn(cd.r, cd.c, cd.v);
  }
}

const rcKey = (r: number, c: number) => `${r}_${c}`;

function remapRcMap(map: any, op: StructureOp): any {
  if (!map || typeof map !== "object" || Array.isArray(map)) return map;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    const m = /^(\d+)_(\d+)$/.exec(k);
    if (!m) {
      out[k] = v;
      continue;
    }
    const p = mapCell(Number(m[1]), Number(m[2]), op);
    if (p) out[rcKey(p[0], p[1])] = v;
  }
  return out;
}

function remapAxisMap(map: any, fn: ((x: number) => number | null) | null): any {
  if (!fn || !map || typeof map !== "object" || Array.isArray(map)) return map;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!/^\d+$/.test(k)) {
      out[k] = v;
      continue;
    }
    const n = fn(Number(k));
    if (n !== null) out[String(n)] = v;
  }
  return out;
}

/** FortuneSheet {row:[r1,r2], column:[c1,c2]} → shifted, or null when deleted. */
function shiftFsRange(rg: any, op: StructureOp): any {
  if (!rg || !Array.isArray(rg.row) || !Array.isArray(rg.column)) return rg;
  const r = shiftRect({ r1: rg.row[0], r2: rg.row[1], c1: rg.column[0], c2: rg.column[1] }, op);
  return r && { ...rg, row: [r.r1, r.r2], column: [r.c1, r.c2] };
}

function shiftBorders(list: any, op: StructureOp): any {
  if (!Array.isArray(list)) return list;
  const out: any[] = [];
  for (const b of list) {
    if (b?.rangeType === "cell" && b.value && typeof b.value === "object") {
      const p = mapCell(b.value.row_index, b.value.col_index, op);
      if (p) out.push({ ...b, value: { ...b.value, row_index: p[0], col_index: p[1] } });
      continue;
    }
    if (Array.isArray(b?.range)) {
      const range = b.range.map((rg: any) => shiftFsRange(rg, op)).filter(Boolean);
      if (range.length) out.push({ ...b, range });
      continue;
    }
    out.push(b);
  }
  return out;
}

function shiftMerges(merge: any, op: StructureOp): Record<string, any> | undefined {
  if (!merge || typeof merge !== "object") return merge;
  const out: Record<string, any> = {};
  for (const m of Object.values<any>(merge)) {
    if (!m || typeof m.r !== "number") continue;
    const r = shiftRect({ r1: m.r, c1: m.c, r2: m.r + (m.rs ?? 1) - 1, c2: m.c + (m.cs ?? 1) - 1 }, op);
    if (!r) continue;
    const rs = r.r2 - r.r1 + 1;
    const cs = r.c2 - r.c1 + 1;
    if (rs === 1 && cs === 1) continue;
    out[rcKey(r.r1, r.c1)] = { ...m, r: r.r1, c: r.c1, rs, cs };
  }
  return out;
}

function shiftConfig(config: any, op: StructureOp): any {
  if (!config || typeof config !== "object") return config;
  const rowFn = axisMapper(op, "row");
  const colFn = axisMapper(op, "col");
  const next: any = { ...config };
  if ("merge" in next) next.merge = shiftMerges(next.merge, op);
  if ("rowlen" in next) next.rowlen = remapAxisMap(next.rowlen, rowFn);
  if ("rowhidden" in next) next.rowhidden = remapAxisMap(next.rowhidden, rowFn);
  if ("columnlen" in next) next.columnlen = remapAxisMap(next.columnlen, colFn);
  if ("colhidden" in next) next.colhidden = remapAxisMap(next.colhidden, colFn);
  if ("customHeight" in next) next.customHeight = remapAxisMap(next.customHeight, rowFn);
  if ("customWidth" in next) next.customWidth = remapAxisMap(next.customWidth, colFn);
  if ("borderInfo" in next) next.borderInfo = shiftBorders(next.borderInfo, op);
  return next;
}

/** Moves the target sheet's cells, rewrites their formulas and rebuilds merge markers. */
function moveCells(sheet: any, op: StructureOp, merge: Record<string, any> | undefined): any {
  const host = String(sheet.name ?? "");
  const cells = new Map<string, { r: number; c: number; v: any }>();
  forEachCell(sheet, (r, c, cell) => {
    const p = mapCell(r, c, op);
    if (!p || p[0] >= MAX_ROWS || p[1] >= MAX_COLS) return;
    let v = cell;
    if (v && typeof v === "object") {
      if (isFormula(v.f)) {
        const f = shiftFormula(v.f, host, op);
        if (f !== v.f) v = { ...v, f };
      }
      if ("mc" in v) {
        v = { ...v };
        delete v.mc;
        if (Object.keys(v).length === 0) return;
      }
    }
    cells.set(rcKey(p[0], p[1]), { r: p[0], c: p[1], v });
  });
  for (const m of Object.values<any>(merge ?? {})) {
    for (let r = m.r; r < m.r + m.rs; r++) {
      for (let c = m.c; c < m.c + m.cs; c++) {
        const key = rcKey(r, c);
        const main = r === m.r && c === m.c;
        const mc = main ? { r: m.r, c: m.c, rs: m.rs, cs: m.cs } : { r: m.r, c: m.c };
        const cur = cells.get(key);
        const base = cur && cur.v && typeof cur.v === "object" ? cur.v : {};
        cells.set(key, { r, c, v: { ...base, mc } });
      }
    }
  }
  const list = [...cells.values()].sort((a, b) => a.r - b.r || a.c - b.c);
  if (Array.isArray(sheet.data)) {
    let rows = sheet.data.length;
    let cols = sheet.data.reduce((m: number, rw: any) => Math.max(m, Array.isArray(rw) ? rw.length : 0), 0);
    if (op.kind === "insert" || op.kind === "delete") {
      const d = op.kind === "insert" ? op.count : -op.count;
      if (op.axis === "row") rows = Math.max(1, rows + d);
      else cols = Math.max(1, cols + d);
    }
    for (const x of list) {
      rows = Math.max(rows, x.r + 1);
      cols = Math.max(cols, x.c + 1);
    }
    const data: any[][] = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (const x of list) data[x.r][x.c] = x.v;
    return { data };
  }
  return { celldata: list };
}

function rewriteSheetFormulas(sheet: any, op: StructureOp): any {
  const host = String(sheet.name ?? "");
  if (Array.isArray(sheet.data)) {
    let changed = false;
    const data = sheet.data.map((rowArr: any[]) => {
      if (!Array.isArray(rowArr)) return rowArr;
      let rowChanged = false;
      const out = rowArr.map((cell) => {
        if (!cell || !isFormula(cell.f)) return cell;
        const f = shiftFormula(cell.f, host, op);
        if (f === cell.f) return cell;
        rowChanged = true;
        return { ...cell, f };
      });
      if (rowChanged) changed = true;
      return rowChanged ? out : rowArr;
    });
    return changed ? { data } : {};
  }
  if (!Array.isArray(sheet.celldata)) return {};
  let changed = false;
  const celldata = sheet.celldata.map((cd: any) => {
    if (!cd?.v || !isFormula(cd.v.f)) return cd;
    const f = shiftFormula(cd.v.f, host, op);
    if (f === cd.v.f) return cd;
    changed = true;
    return { ...cd, v: { ...cd.v, f } };
  });
  return changed ? { celldata } : {};
}

/** Workbook-level plan for a structure op on FortuneSheet sheets (objects with id, name, data (dense matrix) or celldata, config, grownCF, grownDV, grownFilter, _namedRanges on sheet[0]). Pure: does not mutate input. Returns the full new sheets array (cells moved on the target sheet, formulas rewritten on every sheet, config.merge/rowlen/columnlen/rowhidden/colhidden, grownCF/grownDV/grownFilter ranges + their formula fields, _namedRanges shifted). */
export function applyStructureOp(sheets: any[], op: StructureOp): any[] {
  const res = resolveOp(sheets, op);
  if (!res) return Array.isArray(sheets) ? [...sheets] : sheets;
  const { op: o, target } = res;
  return sheets.map((sheet, i) => {
    if (!sheet || typeof sheet !== "object") return sheet;
    const next: any = { ...sheet, ...modelFields(sheets, i, o, target) };
    if (i !== target) return { ...next, ...rewriteSheetFormulas(sheet, o) };
    const config = shiftConfig(sheet.config, o);
    if (config !== undefined) next.config = config;
    Object.assign(next, moveCells(sheet, o, config?.merge));
    if (o.kind === "insert" || o.kind === "delete") {
      const key = o.axis === "row" ? "row" : "column";
      if (typeof next[key] === "number" && next[key] > 0) {
        next[key] = Math.max(1, next[key] + (o.kind === "insert" ? o.count : -o.count));
      }
    }
    if ("dataVerification" in next) next.dataVerification = remapRcMap(next.dataVerification, o);
    if ("hyperlink" in next) next.hyperlink = remapRcMap(next.hyperlink, o);
    if (Array.isArray(next.luckysheet_conditionformat_save)) {
      next.luckysheet_conditionformat_save = next.luckysheet_conditionformat_save
        .map((cf: any) => {
          if (!Array.isArray(cf?.cellrange)) return cf;
          const cellrange = cf.cellrange.map((rg: any) => shiftFsRange(rg, o)).filter(Boolean);
          return cellrange.length ? { ...cf, cellrange } : null;
        })
        .filter(Boolean);
    }
    if (next.filter_select && typeof next.filter_select === "object") {
      next.filter_select = shiftFsRange(next.filter_select, o);
    }
    if (Array.isArray(next.calcChain)) {
      next.calcChain = next.calcChain
        .map((e: any) => {
          if (!e || typeof e.r !== "number" || (e.id !== undefined && String(e.id) !== String(sheet.id))) return e;
          const p = mapCell(e.r, e.c, o);
          return p ? { ...e, r: p[0], c: p[1] } : null;
        })
        .filter(Boolean);
    }
    return next;
  });
}

/** Only the formula-text edits for every sheet (for when the grid itself already moved the cells): list of {sheetId, r, c, f} at POST-op positions. `before` = pre-op sheets. */
export function structureFormulaEdits(
  before: any[],
  op: StructureOp,
): { sheetId: string; r: number; c: number; f: string }[] {
  const res = resolveOp(before, op);
  if (!res) return [];
  const { op: o, target } = res;
  const edits: { sheetId: string; r: number; c: number; f: string }[] = [];
  before.forEach((sheet, i) => {
    const host = String(sheet?.name ?? "");
    forEachCell(sheet, (r, c, cell) => {
      if (!cell || !isFormula(cell.f)) return;
      const f = shiftFormula(cell.f, host, o);
      if (f === cell.f) return;
      const p = i === target ? mapCell(r, c, o) : [r, c];
      if (!p) return;
      edits.push({ sheetId: sheet.id, r: p[0], c: p[1], f });
    });
  });
  return edits;
}

/** Shifted model fields for every sheet (grownCF, grownDV, grownFilter, and _namedRanges on sheet 0), only for sheets whose fields change: {sheetId, fields}. */
export function structureModelPatches(
  before: any[],
  op: StructureOp,
): { sheetId: string; fields: Record<string, unknown> }[] {
  const res = resolveOp(before, op);
  if (!res) return [];
  const { op: o, target } = res;
  const out: { sheetId: string; fields: Record<string, unknown> }[] = [];
  before.forEach((sheet, i) => {
    if (!sheet || typeof sheet !== "object") return;
    const fields = modelFields(before, i, o, target);
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (JSON.stringify(v) !== JSON.stringify(sheet[k])) changed[k] = v;
    }
    if (Object.keys(changed).length) out.push({ sheetId: sheet.id, fields: changed });
  });
  return out;
}
