/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cell objects are loosely typed. */

// Edit ▸ Paste special (Excel semantics), pure.
//
// The editor remembers the block the user last copied (cells plus the
// top-left address it came from); pasteSpecial works out the writes for a
// paste of that block at a target cell:
//   what       all | formulas | values | formats
//   operation  none | add | subtract | multiply | divide (target ∘ source)
//   skipBlanks empty source cells leave the target alone
//   transpose  rows become columns
// "values" and "formulas" keep the target's formatting; "formats" keeps the
// target's value. Formulas move with the paste (relative references shift).

import { formatValue } from "./numberFormat";

export type Cell = Record<string, any> | null;
export type PasteWhat = "all" | "formulas" | "values" | "formats";
export type PasteOperation = "none" | "add" | "subtract" | "multiply" | "divide";

export interface CopiedBlock {
  cells: Cell[][];
  /** Sheet address of cells[0][0]. */
  r: number;
  c: number;
}

export interface PasteSpecialOptions {
  what: PasteWhat;
  operation?: PasteOperation;
  skipBlanks?: boolean;
  transpose?: boolean;
  /** Moves a formula by (dr, dc); default leaves it unchanged. */
  translate?: (formula: string, dr: number, dc: number) => string;
}

export interface PasteWrite {
  r: number;
  c: number;
  cell: Cell;
}

const VALUE_KEYS = new Set(["v", "m", "f", "ct", "grownSpill", "spl"]);

function isBlank(cell: Cell): boolean {
  return !cell || ((cell.v === undefined || cell.v === null || cell.v === "") && !cell.f);
}

/** Style fields of a cell (everything that is not its value), with the number format kept apart. */
function styleOf(cell: Cell): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(cell ?? {})) if (!VALUE_KEYS.has(k)) out[k] = v;
  return out;
}

function withDisplay(cell: Record<string, any>): Record<string, any> {
  const v = cell.v;
  if (v === undefined || v === null) return cell;
  const fa = cell.ct?.fa ?? "General";
  let m: string;
  try {
    m = typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? formatValue(v, fa) : String(v);
  } catch {
    m = String(v);
  }
  return { ...cell, m };
}

/** Number used by paste operations: blanks count as 0, numeric text does not. */
function opNumber(cell: Cell): number | null {
  if (isBlank(cell)) return 0;
  return typeof cell!.v === "number" ? cell!.v : null;
}

function operate(op: PasteOperation, a: number, b: number): number | string {
  switch (op) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      return b === 0 ? "#DIV/0!" : a / b;
    default:
      return b;
  }
}

const OP_SIGN: Record<Exclude<PasteOperation, "none">, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
};

/** Formula text of a cell used as an operand in a combined formula. */
function operand(cell: Cell): string {
  if (cell?.f) return `(${String(cell.f).replace(/^=/, "")})`;
  const n = opNumber(cell);
  return String(n ?? 0);
}

/** Tidies float noise from a paste operation (0.1+0.2 → 0.3) the way Excel displays it. */
function clean(x: number): number {
  return Number.isFinite(x) ? Number(x.toPrecision(15)) : x;
}

/**
 * pasteSpecial returns the writes for pasting `block` with its top-left at
 * (r, c). `get` reads the current target cells.
 */
export function pasteSpecial(
  block: CopiedBlock,
  r: number,
  c: number,
  get: (r: number, c: number) => Cell,
  opts: PasteSpecialOptions,
): PasteWrite[] {
  const op = opts.operation ?? "none";
  const translate = opts.translate ?? ((f: string) => f);
  const writes: PasteWrite[] = [];
  const rows = block.cells.length;
  const cols = Math.max(0, ...block.cells.map((row) => row?.length ?? 0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const src = block.cells[i]?.[j] ?? null;
      const [di, dj] = opts.transpose ? [j, i] : [i, j];
      const tr = r + di;
      const tc = c + dj;
      if (opts.skipBlanks && isBlank(src)) continue;
      const dst = get(tr, tc);
      // The source cell's own offset: formulas move from (block.r+i, block.c+j) to (tr, tc).
      const f = src?.f ? translate(String(src.f), tr - (block.r + i), tc - (block.c + j)) : undefined;
      const cell = combine(src, dst, f, opts.what, op);
      writes.push({ r: tr, c: tc, cell });
    }
  }
  return writes;
}

function combine(src: Cell, dst: Cell, f: string | undefined, what: PasteWhat, op: PasteOperation): Cell {
  if (what === "formats") {
    if (!src && !dst) return null;
    const out: Record<string, any> = { ...styleOf(src) };
    for (const k of VALUE_KEYS) if (dst && dst[k] !== undefined) out[k] = dst[k];
    if (src?.ct?.fa !== undefined) out.ct = { ...(dst?.ct ?? {}), fa: src.ct.fa, t: src.ct.t ?? dst?.ct?.t };
    return withDisplay(out);
  }
  // The value (or formula) the paste brings.
  let value: Record<string, any>;
  if (what === "values") {
    value = src && !isBlank(src) ? { v: src.v, ct: src.ct } : {};
  } else {
    value = src && !isBlank(src) ? { v: src.v, ct: src.ct, ...(f ? { f } : {}) } : {};
  }
  if (op !== "none") {
    const srcFormula = what !== "values" ? f : undefined;
    const a = dst?.f ? 0 : opNumber(dst);
    const b = srcFormula ? 0 : opNumber(src);
    // Text on either side: Excel leaves the target unchanged.
    if (a === null || b === null) return dst;
    const style = what === "all" ? { ...styleOf(dst), ...styleOf(src) } : styleOf(dst);
    if (srcFormula || dst?.f) {
      // A formula on either side: combine as a formula so it stays live
      // (the next recalculation fills in its value).
      const right = srcFormula ? `(${srcFormula.replace(/^=/, "")})` : operand(src);
      const combined = `=${operand(dst)}${OP_SIGN[op]}${right}`;
      return { ...style, f: combined, v: dst?.v ?? 0, ct: dst?.ct ?? src?.ct, m: dst?.m ?? "" };
    }
    const res = operate(op, a, b);
    const v = typeof res === "number" ? clean(res) : res;
    const ct = dst?.ct ?? src?.ct ?? { fa: "General", t: "n" };
    return withDisplay({ ...style, v, ct: typeof v === "string" ? { fa: "General", t: "e" } : ct });
  }
  if (what === "all") {
    if (!src) return null;
    const out: Record<string, any> = { ...src };
    if (f) out.f = f;
    delete out.grownSpill;
    return out;
  }
  // values / formulas: keep the target's style and number format.
  const style = styleOf(dst);
  if (!("v" in value)) {
    const empty = { ...style };
    return Object.keys(empty).length ? empty : null;
  }
  const ct = dst?.ct?.fa && dst.ct.fa !== "General" ? dst.ct : (value.ct ?? dst?.ct);
  const out: Record<string, any> = { ...style, v: value.v, ...(ct ? { ct } : {}) };
  if (value.f) out.f = value.f;
  return withDisplay(out);
}

/** Size of the pasted area, for selecting it after the paste. */
export function pastedSize(block: CopiedBlock, transpose = false): { rows: number; cols: number } {
  const rows = block.cells.length;
  const cols = Math.max(0, ...block.cells.map((row) => row?.length ?? 0));
  return transpose ? { rows: cols, cols: rows } : { rows, cols };
}
