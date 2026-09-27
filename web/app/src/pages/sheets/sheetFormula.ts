// A small formula evaluator for conditional-format and data-validation
// formulas (cfOps.ts, validationOps.ts). The grid the user sees is painted
// from FortuneSheet's cell values (the server engine's results are written back
// into those cells after /recalc, see formulaRefs.ts), so rule formulas are
// evaluated here, synchronously, against the same values at paint time.
//
// It covers what rule formulas typically use: references with relative/absolute
// parts (shifted per cell like Excel does), whole rows/columns, other sheets,
// the arithmetic/text/comparison operators, and ~60 common functions. Anything
// else evaluates to #NAME?, which a rule treats as "no match".

import {
  cellScalar,
  err,
  isError,
  lettersToCol,
  parseInput,
  partsToSerial,
  serialToParts,
  dateToSerial,
  type ErrorValue,
  type Grid,
  type Scalar,
} from "./cellValue";

export interface RangeRef {
  kind: "range";
  sheet?: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
export type Value = Scalar | RangeRef | Value[][];

export interface EvalContext {
  /** The sheet the formula lives on. */
  grid: Grid;
  /** Other sheets by name (case-insensitive lookup). */
  sheets?: Record<string, Grid>;
  /** Named ranges → reference text (e.g. "Sheet1!$A$1:$A$9"). */
  names?: Record<string, string>;
  /** Row/column offset of the evaluated cell from the formula's base cell. */
  dr?: number;
  dc?: number;
  /** Cell the formula is evaluated for (ROW()/COLUMN() without arguments). */
  row?: number;
  col?: number;
  /** Clock for TODAY()/NOW(). */
  now?: Date;
}

// ---- tokenizer ----------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; v: RefTok }
  | { t: "name"; v: string }
  | { t: "func"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v: string }
  | { t: ")"; v: string }
  | { t: "sep"; v: string };

interface RefPart {
  row?: number;
  col?: number;
  rowAbs: boolean;
  colAbs: boolean;
}
interface RefTok {
  sheet?: string;
  a: RefPart;
  b?: RefPart;
}

const ERRS = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"];

function tokenize(src: string): Tok[] {
  const s = src.replace(/^=/, "");
  const out: Tok[] = [];
  let i = 0;
  const cellRe = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += s[j++];
      }
      out.push({ t: "str", v });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const e = ERRS.find((x) => s.slice(i, i + x.length).toUpperCase() === x);
      if (e) {
        out.push({ t: "err", v: e });
        i += e.length;
        continue;
      }
    }
    if (/[0-9.]/.test(ch)) {
      // A row range like 1:3 is a reference, not a number.
      const rr = s.slice(i).match(/^(\$?)(\d+):(\$?)(\d+)/);
      if (rr && !/^\d+:\d+\s*[A-Za-z]/.test(rr[0])) {
        out.push({
          t: "ref",
          v: {
            a: { row: Number(rr[2]) - 1, rowAbs: !!rr[1], colAbs: true },
            b: { row: Number(rr[4]) - 1, rowAbs: !!rr[3], colAbs: true },
          },
        });
        i += rr[0].length;
        continue;
      }
      const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
      if (m) {
        out.push({ t: "num", v: Number(m[0]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "$" && /^\$\d+:/.test(s.slice(i))) {
      const rr = s.slice(i).match(/^(\$?)(\d+):(\$?)(\d+)/);
      if (rr) {
        out.push({
          t: "ref",
          v: {
            a: { row: Number(rr[2]) - 1, rowAbs: !!rr[1], colAbs: true },
            b: { row: Number(rr[4]) - 1, rowAbs: !!rr[3], colAbs: true },
          },
        });
        i += rr[0].length;
        continue;
      }
    }
    // Sheet prefix: 'My sheet'!  or  Sheet1!
    let sheet: string | undefined;
    let j = i;
    if (ch === "'") {
      let k = i + 1;
      let name = "";
      while (k < s.length) {
        if (s[k] === "'") {
          if (s[k + 1] === "'") {
            name += "'";
            k += 2;
            continue;
          }
          break;
        }
        name += s[k++];
      }
      if (s[k + 1] === "!") {
        sheet = name;
        j = k + 2;
      }
    } else {
      const sm = s.slice(i).match(/^([A-Za-z_À-￿][\w.À-￿]*)!/);
      if (sm) {
        sheet = sm[1];
        j = i + sm[0].length;
      }
    }
    const rest = s.slice(j);
    if (/[A-Za-z$]/.test(rest[0] ?? "")) {
      const cm = rest.match(cellRe);
      const after = cm ? rest[cm[0].length] : undefined;
      if (cm && !(after && /[A-Za-z0-9_(.]/.test(after))) {
        const a: RefPart = {
          col: lettersToCol(cm[2]),
          row: Number(cm[4]) - 1,
          colAbs: !!cm[1],
          rowAbs: !!cm[3],
        };
        let len = cm[0].length;
        let b: RefPart | undefined;
        const tail = rest.slice(len).match(/^:(\$?)([A-Za-z]{1,3})(\$?)(\d+)/);
        if (tail) {
          b = { col: lettersToCol(tail[2]), row: Number(tail[4]) - 1, colAbs: !!tail[1], rowAbs: !!tail[3] };
          len += tail[0].length;
        }
        out.push({ t: "ref", v: { sheet, a, b } });
        i = j + len;
        continue;
      }
      const cc = rest.match(/^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(])/);
      if (cc) {
        out.push({
          t: "ref",
          v: {
            sheet,
            a: { col: lettersToCol(cc[2]), colAbs: !!cc[1], rowAbs: true },
            b: { col: lettersToCol(cc[4]), colAbs: !!cc[3], rowAbs: true },
          },
        });
        i = j + cc[0].length;
        continue;
      }
    }
    if (/[A-Za-z_\\]/.test(ch)) {
      const m = s.slice(i).match(/^[A-Za-z_\\][\w.]*/)!;
      const word = m[0];
      let k = i + word.length;
      while (s[k] === " ") k++;
      if (s[k] === "(") {
        out.push({ t: "func", v: word.toUpperCase() });
        i = k;
        continue;
      }
      if (/^(true|false)$/i.test(word)) out.push({ t: "bool", v: /^true$/i.test(word) });
      else out.push({ t: "name", v: word });
      i += word.length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ t: "(", v: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ t: ")", v: ch });
      i++;
      continue;
    }
    if (ch === "," || ch === ";") {
      out.push({ t: "sep", v: ch });
      i++;
      continue;
    }
    throw new SyntaxError(`Unexpected '${ch}'`);
  }
  return out;
}

// ---- parser (to an AST) ----------------------------------------------------------

type Node =
  | { k: "lit"; v: Scalar }
  | { k: "ref"; v: RefTok }
  | { k: "name"; v: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "pct"; a: Node }
  | { k: "call"; f: string; args: (Node | null)[] };

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  parse(): Node {
    const n = this.cmp();
    if (this.p < this.toks.length) throw new SyntaxError("Unexpected token");
    return n;
  }
  private peek(): Tok | undefined {
    return this.toks[this.p];
  }
  private isOp(...ops: string[]): string | null {
    const t = this.peek();
    return t && t.t === "op" && ops.includes(t.v) ? t.v : null;
  }
  private cmp(): Node {
    let a = this.cat();
    for (let op = this.isOp("=", "<>", "<", ">", "<=", ">="); op; op = this.isOp("=", "<>", "<", ">", "<=", ">=")) {
      this.p++;
      a = { k: "bin", op, a, b: this.cat() };
    }
    return a;
  }
  private cat(): Node {
    let a = this.add();
    while (this.isOp("&")) {
      this.p++;
      a = { k: "bin", op: "&", a, b: this.add() };
    }
    return a;
  }
  private add(): Node {
    let a = this.mul();
    for (let op = this.isOp("+", "-"); op; op = this.isOp("+", "-")) {
      this.p++;
      a = { k: "bin", op, a, b: this.mul() };
    }
    return a;
  }
  private mul(): Node {
    let a = this.pow();
    for (let op = this.isOp("*", "/"); op; op = this.isOp("*", "/")) {
      this.p++;
      a = { k: "bin", op, a, b: this.pow() };
    }
    return a;
  }
  private pow(): Node {
    let a = this.unary();
    while (this.isOp("^")) {
      this.p++;
      a = { k: "bin", op: "^", a, b: this.unary() };
    }
    return a;
  }
  private unary(): Node {
    const op = this.isOp("+", "-");
    if (op) {
      this.p++;
      return { k: "un", op, a: this.unary() };
    }
    let a = this.primary();
    while (this.isOp("%")) {
      this.p++;
      a = { k: "pct", a };
    }
    return a;
  }
  private primary(): Node {
    const t = this.toks[this.p++];
    if (!t) throw new SyntaxError("Unexpected end");
    switch (t.t) {
      case "num":
        return { k: "lit", v: t.v };
      case "str":
        return { k: "lit", v: t.v };
      case "bool":
        return { k: "lit", v: t.v };
      case "err":
        return { k: "lit", v: err(t.v) };
      case "ref":
        return { k: "ref", v: t.v };
      case "name":
        return { k: "name", v: t.v };
      case "(": {
        const n = this.cmp();
        if (this.peek()?.t !== ")") throw new SyntaxError("Missing )");
        this.p++;
        return n;
      }
      case "func": {
        if (this.peek()?.t !== "(") throw new SyntaxError("Missing (");
        this.p++;
        const args: (Node | null)[] = [];
        if (this.peek()?.t === ")") {
          this.p++;
          return { k: "call", f: t.v, args };
        }
        for (;;) {
          const nt = this.peek();
          if (nt?.t === "sep" || nt?.t === ")") args.push(null);
          else args.push(this.cmp());
          const sep = this.toks[this.p++];
          if (!sep) throw new SyntaxError("Missing )");
          if (sep.t === ")") break;
          if (sep.t !== "sep") throw new SyntaxError("Expected ,");
        }
        return { k: "call", f: t.v, args };
      }
      default:
        throw new SyntaxError("Unexpected token");
    }
  }
}

const cache = new Map<string, Node | SyntaxError>();

/** Parses a formula (with or without the leading "="); throws SyntaxError. */
export function parseFormula(src: string): Node {
  const hit = cache.get(src);
  if (hit instanceof SyntaxError) throw hit;
  if (hit) return hit;
  try {
    const n = new Parser(tokenize(src)).parse();
    if (cache.size > 2000) cache.clear();
    cache.set(src, n);
    return n;
  } catch (e) {
    const se = e instanceof SyntaxError ? e : new SyntaxError(String(e));
    cache.set(src, se);
    throw se;
  }
}

export function isValidFormula(src: string): boolean {
  try {
    parseFormula(src);
    return true;
  } catch {
    return false;
  }
}

// ---- evaluation --------------------------------------------------------------------

const MAX_ROW = 1048575;
const MAX_COL = 16383;

function gridOf(ctx: EvalContext, sheet?: string): Grid | null {
  if (!sheet) return ctx.grid;
  const sheets = ctx.sheets ?? {};
  const key = Object.keys(sheets).find((k) => k.toLowerCase() === sheet.toLowerCase());
  return key ? sheets[key] : null;
}

function resolveRef(ref: RefTok, ctx: EvalContext): RangeRef | ErrorValue {
  const dr = ctx.dr ?? 0;
  const dc = ctx.dc ?? 0;
  const pt = (p: RefPart) => ({
    row: p.row === undefined ? undefined : p.row + (p.rowAbs ? 0 : dr),
    col: p.col === undefined ? undefined : p.col + (p.colAbs ? 0 : dc),
  });
  const a = pt(ref.a);
  const b = ref.b ? pt(ref.b) : a;
  const r1 = a.row ?? 0;
  const r2 = b.row ?? MAX_ROW;
  const c1 = a.col ?? 0;
  const c2 = b.col ?? MAX_COL;
  if (Math.min(r1, r2, c1, c2) < 0 || Math.max(r1, r2) > MAX_ROW || Math.max(c1, c2) > MAX_COL) return err("#REF!");
  if (ref.sheet && !gridOf(ctx, ref.sheet)) return err("#REF!");
  return {
    kind: "range",
    sheet: ref.sheet,
    r1: Math.min(r1, r2),
    c1: Math.min(c1, c2),
    r2: Math.max(r1, r2),
    c2: Math.max(c1, c2),
  };
}

function isRange(v: unknown): v is RangeRef {
  return typeof v === "object" && v !== null && (v as RangeRef).kind === "range";
}

/** The cells of a range, clipped to the used part of its grid, row by row. */
function rangeCells(r: RangeRef, ctx: EvalContext): Scalar[] {
  const g = gridOf(ctx, r.sheet) ?? [];
  const out: Scalar[] = [];
  const r2 = Math.min(r.r2, g.length - 1);
  for (let i = r.r1; i <= r2; i++) {
    const row = g[i] ?? [];
    const c2 = Math.min(r.c2, row.length - 1);
    for (let j = r.c1; j <= c2; j++) out.push(cellScalar(row[j]));
  }
  return out;
}

function rangeSize(r: RangeRef): number {
  return (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
}

/** Collapses a value to a scalar (a range reads its implicit-intersection / top-left cell). */
function scalar(v: Value, ctx: EvalContext): Scalar {
  if (Array.isArray(v)) return (v[0]?.[0] as Scalar) ?? null;
  if (!isRange(v)) return v;
  let r = v.r1;
  let c = v.c1;
  if (rangeSize(v) > 1) {
    // Implicit intersection with the evaluated cell's row/column.
    const row = ctx.row ?? 0;
    const col = ctx.col ?? 0;
    if (v.r1 === v.r2 && col >= v.c1 && col <= v.c2) c = col;
    else if (v.c1 === v.c2 && row >= v.r1 && row <= v.r2) r = row;
    else if (v.r1 !== v.r2 || v.c1 !== v.c2) return err("#VALUE!");
  }
  const g = gridOf(ctx, v.sheet) ?? [];
  return cellScalar(g[r]?.[c]);
}

export function toNumber(v: Scalar): number | ErrorValue {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isError(v)) return v;
  const p = parseInput(v);
  if (p.t === "n" || p.t === "d") return p.v as number;
  return err("#VALUE!");
}

export function toText(v: Scalar): string | ErrorValue {
  if (v === null) return "";
  if (isError(v)) return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numText(v);
  return v;
}

function numText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function toBool(v: Scalar): boolean | ErrorValue {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isError(v)) return v;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return err("#VALUE!");
}

/** Excel ordering: numbers < text < booleans; text compares case-insensitively. */
export function compareScalars(a: Scalar, b: Scalar): number {
  const rank = (x: Scalar) => (typeof x === "number" ? 0 : typeof x === "string" ? 1 : typeof x === "boolean" ? 2 : 0);
  let x = a;
  let y = b;
  if (x === null) x = typeof y === "string" ? "" : typeof y === "boolean" ? false : 0;
  if (y === null) y = typeof x === "string" ? "" : typeof x === "boolean" ? false : 0;
  const rx = rank(x);
  const ry = rank(y);
  if (rx !== ry) return rx - ry;
  if (typeof x === "number" && typeof y === "number") return x === y ? 0 : x < y ? -1 : 1;
  if (typeof x === "boolean" && typeof y === "boolean") return Number(x) - Number(y);
  const sx = String(x).toLowerCase();
  const sy = String(y).toLowerCase();
  return sx === sy ? 0 : sx < sy ? -1 : 1;
}

function evalNode(n: Node, ctx: EvalContext): Value {
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref":
      return resolveRef(n.v, ctx);
    case "name": {
      const names = ctx.names ?? {};
      const key = Object.keys(names).find((k) => k.toLowerCase() === n.v.toLowerCase());
      if (!key) return err("#NAME?");
      try {
        return evalNode(parseFormula(names[key]), { ...ctx, dr: 0, dc: 0 });
      } catch {
        return err("#NAME?");
      }
    }
    case "un": {
      const v = toNumber(scalar(evalNode(n.a, ctx), ctx));
      if (isError(v)) return v;
      return n.op === "-" ? -v : v;
    }
    case "pct": {
      const v = toNumber(scalar(evalNode(n.a, ctx), ctx));
      return isError(v) ? v : v / 100;
    }
    case "bin": {
      const a = scalar(evalNode(n.a, ctx), ctx);
      const b = scalar(evalNode(n.b, ctx), ctx);
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (n.op === "&") {
        return (toText(a) as string) + (toText(b) as string);
      }
      if (["=", "<>", "<", ">", "<=", ">="].includes(n.op)) {
        const c = compareScalars(a, b);
        switch (n.op) {
          case "=":
            return c === 0;
          case "<>":
            return c !== 0;
          case "<":
            return c < 0;
          case ">":
            return c > 0;
          case "<=":
            return c <= 0;
          default:
            return c >= 0;
        }
      }
      const x = toNumber(a);
      const y = toNumber(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      switch (n.op) {
        case "+":
          return x + y;
        case "-":
          return x - y;
        case "*":
          return x * y;
        case "/":
          return y === 0 ? err("#DIV/0!") : x / y;
        default: {
          const p = Math.pow(x, y);
          return Number.isFinite(p) ? p : err("#NUM!");
        }
      }
    }
    case "call":
      return callFn(n.f, n.args, ctx);
  }
}

/** Evaluates a formula to a scalar. Syntax errors give #NAME?. */
export function evaluateFormula(src: string, ctx: EvalContext): Scalar {
  let node: Node;
  try {
    node = parseFormula(src);
  } catch {
    return err("#NAME?");
  }
  try {
    return scalar(evalNode(node, ctx), ctx);
  } catch {
    return err("#VALUE!");
  }
}

/** Evaluates a formula keeping a range result (list sources, AVERAGE stops, …). */
export function evaluateToValues(src: string, ctx: EvalContext): Scalar[] {
  let node: Node;
  try {
    node = parseFormula(src);
  } catch {
    return [err("#NAME?")];
  }
  try {
    const v = evalNode(node, ctx);
    if (isRange(v)) return rangeCells(v, ctx);
    if (Array.isArray(v)) return v.flat() as Scalar[];
    return [v];
  } catch {
    return [err("#VALUE!")];
  }
}

/** A formula's truth value for a rule: errors and non-boolean text are false. */
export function formulaIsTrue(src: string, ctx: EvalContext): boolean {
  const v = evaluateFormula(src, ctx);
  if (isError(v) || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (/^true$/i.test(v)) return true;
  return false;
}

// ---- functions ------------------------------------------------------------------------

type Fn = (args: Value[], ctx: EvalContext) => Value;

function flatScalars(args: Value[], ctx: EvalContext): Scalar[] {
  const out: Scalar[] = [];
  for (const a of args) {
    if (isRange(a)) out.push(...rangeCells(a, ctx));
    else if (Array.isArray(a)) out.push(...(a.flat() as Scalar[]));
    else out.push(a);
  }
  return out;
}

/** Numbers for aggregates: numbers in ranges, coerced direct arguments. */
function numbers(args: Value[], ctx: EvalContext): number[] | ErrorValue {
  const out: number[] = [];
  for (const a of args) {
    if (isRange(a) || Array.isArray(a)) {
      for (const v of isRange(a) ? rangeCells(a, ctx) : (a.flat() as Scalar[])) {
        if (isError(v)) return v;
        if (typeof v === "number") out.push(v);
      }
    } else {
      if (a === null) continue;
      const n = toNumber(a);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function num(v: Value, ctx: EvalContext): number | ErrorValue {
  return toNumber(scalar(v, ctx));
}
function txt(v: Value, ctx: EvalContext): string | ErrorValue {
  return toText(scalar(v, ctx));
}

/** COUNTIF-style criteria test ("<5", ">=x", "a*", 7, TRUE). */
export function matchesCriteria(value: Scalar, criteria: Scalar): boolean {
  let op = "=";
  let crit: Scalar = criteria;
  if (typeof criteria === "string") {
    const m = criteria.match(/^(<=|>=|<>|=|<|>)?(.*)$/s)!;
    op = m[1] ?? "=";
    const rest = m[2];
    const p = parseInput(rest);
    crit = rest === "" ? "" : p.t === "n" || p.t === "d" || p.t === "b" ? (p.v as Scalar) : rest;
  }
  if (isError(value)) return isError(crit) && crit.error === value.error && op === "=";
  if (typeof crit === "string") {
    if (crit === "") {
      const empty = value === null || value === "";
      return op === "<>" ? !empty : op === "=" ? empty : false;
    }
    if (typeof value !== "string") return op === "<>";
    if (op === "=" || op === "<>") {
      const re = wildcardRegex(crit);
      const hit = re.test(value);
      return op === "=" ? hit : !hit;
    }
    const c = compareScalars(value, crit);
    return op === "<" ? c < 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c >= 0;
  }
  if (value === null) return op === "<>";
  if (typeof crit === "number" && typeof value !== "number") return op === "<>";
  if (typeof crit === "boolean" && typeof value !== "boolean") return op === "<>";
  const c = compareScalars(value, crit);
  switch (op) {
    case "=":
      return c === 0;
    case "<>":
      return c !== 0;
    case "<":
      return c < 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    default:
      return c >= 0;
  }
}

export function wildcardRegex(pattern: string, anchored = true): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(anchored ? `^${re}$` : re, "is");
}

function today(ctx: EvalContext): number {
  return dateToSerial(ctx.now ?? new Date());
}

const FNS: Record<string, Fn> = {
  SUM: (a, c) => {
    const n = numbers(a, c);
    return isError(n) ? n : n.reduce((x, y) => x + y, 0);
  },
  AVERAGE: (a, c) => {
    const n = numbers(a, c);
    if (isError(n)) return n;
    return n.length ? n.reduce((x, y) => x + y, 0) / n.length : err("#DIV/0!");
  },
  MIN: (a, c) => {
    const n = numbers(a, c);
    return isError(n) ? n : n.length ? Math.min(...n) : 0;
  },
  MAX: (a, c) => {
    const n = numbers(a, c);
    return isError(n) ? n : n.length ? Math.max(...n) : 0;
  },
  COUNT: (a, c) => flatScalars(a, c).filter((v) => typeof v === "number").length,
  COUNTA: (a, c) => flatScalars(a, c).filter((v) => v !== null).length,
  COUNTBLANK: (a, c) => {
    const r = a[0];
    if (!isRange(r)) return err("#VALUE!");
    const vals = rangeCells(r, c);
    const blanks = vals.filter((v) => v === null || v === "").length;
    return blanks + (rangeSize(r) - vals.length);
  },
  COUNTIF: (a, c) => {
    const r = a[0];
    if (!isRange(r)) return err("#VALUE!");
    const crit = scalar(a[1] ?? null, c);
    const vals = rangeCells(r, c);
    let n = vals.filter((v) => matchesCriteria(v, crit)).length;
    // Cells beyond the used area are empty.
    if (matchesCriteria(null, crit)) n += rangeSize(r) - vals.length;
    return n;
  },
  SUMIF: (a, c) => {
    const r = a[0];
    if (!isRange(r)) return err("#VALUE!");
    const crit = scalar(a[1] ?? null, c);
    const sumR = isRange(a[2]) ? (a[2] as RangeRef) : r;
    const g = gridOf(c, r.sheet) ?? [];
    const gs = gridOf(c, sumR.sheet) ?? [];
    let s = 0;
    for (let i = r.r1; i <= Math.min(r.r2, g.length - 1); i++) {
      for (let j = r.c1; j <= r.c2; j++) {
        if (!matchesCriteria(cellScalar(g[i]?.[j]), crit)) continue;
        const v = cellScalar(gs[sumR.r1 + (i - r.r1)]?.[sumR.c1 + (j - r.c1)]);
        if (typeof v === "number") s += v;
      }
    }
    return s;
  },
  AND: (a, c) => {
    let any = false;
    for (const v of flatScalars(a, c)) {
      if (v === null || typeof v === "string") continue;
      const b = toBool(v);
      if (isError(b)) return b;
      any = true;
      if (!b) return false;
    }
    return any ? true : err("#VALUE!");
  },
  OR: (a, c) => {
    let any = false;
    for (const v of flatScalars(a, c)) {
      if (v === null || typeof v === "string") continue;
      const b = toBool(v);
      if (isError(b)) return b;
      any = true;
      if (b) return true;
    }
    return any ? false : err("#VALUE!");
  },
  XOR: (a, c) => {
    let n = 0;
    for (const v of flatScalars(a, c)) {
      if (v === null || typeof v === "string") continue;
      const b = toBool(v);
      if (isError(b)) return b;
      if (b) n++;
    }
    return n % 2 === 1;
  },
  NOT: (a, c) => {
    const b = toBool(scalar(a[0] ?? null, c));
    return isError(b) ? b : !b;
  },
  TRUE: () => true,
  FALSE: () => false,
  ISBLANK: (a, c) => scalar(a[0] ?? null, c) === null,
  ISNUMBER: (a, c) => typeof scalar(a[0] ?? null, c) === "number",
  ISTEXT: (a, c) => typeof scalar(a[0] ?? null, c) === "string",
  ISNONTEXT: (a, c) => typeof scalar(a[0] ?? null, c) !== "string",
  ISLOGICAL: (a, c) => typeof scalar(a[0] ?? null, c) === "boolean",
  ISERROR: (a, c) => isError(scalar(a[0] ?? null, c)),
  ISERR: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    return isError(v) && v.error !== "#N/A";
  },
  ISNA: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    return isError(v) && v.error === "#N/A";
  },
  ISEVEN: (a, c) => {
    const n = num(a[0] ?? null, c);
    return isError(n) ? n : Math.trunc(n) % 2 === 0;
  },
  ISODD: (a, c) => {
    const n = num(a[0] ?? null, c);
    return isError(n) ? n : Math.abs(Math.trunc(n)) % 2 === 1;
  },
  IF: (a, c) => {
    const b = toBool(scalar(a[0] ?? null, c));
    if (isError(b)) return b;
    if (b) return a.length > 1 ? (a[1] ?? 0) : true;
    return a.length > 2 ? (a[2] ?? 0) : false;
  },
  IFERROR: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    return isError(v) ? (a[1] ?? "") : (a[0] ?? null);
  },
  IFNA: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    return isError(v) && v.error === "#N/A" ? (a[1] ?? "") : (a[0] ?? null);
  },
  LEN: (a, c) => {
    const s = txt(a[0] ?? null, c);
    return isError(s) ? s : s.length;
  },
  LEFT: (a, c) => {
    const s = txt(a[0] ?? null, c);
    const n = a.length > 1 ? num(a[1], c) : 1;
    if (isError(s)) return s;
    if (isError(n)) return n;
    return n < 0 ? err("#VALUE!") : s.slice(0, Math.floor(n));
  },
  RIGHT: (a, c) => {
    const s = txt(a[0] ?? null, c);
    const n = a.length > 1 ? num(a[1], c) : 1;
    if (isError(s)) return s;
    if (isError(n)) return n;
    if (n < 0) return err("#VALUE!");
    const k = Math.floor(n);
    return k === 0 ? "" : s.slice(-k);
  },
  MID: (a, c) => {
    const s = txt(a[0] ?? null, c);
    const st = num(a[1] ?? null, c);
    const n = num(a[2] ?? null, c);
    if (isError(s)) return s;
    if (isError(st)) return st;
    if (isError(n)) return n;
    if (st < 1 || n < 0) return err("#VALUE!");
    return s.substr(Math.floor(st) - 1, Math.floor(n));
  },
  UPPER: (a, c) => {
    const s = txt(a[0] ?? null, c);
    return isError(s) ? s : s.toUpperCase();
  },
  LOWER: (a, c) => {
    const s = txt(a[0] ?? null, c);
    return isError(s) ? s : s.toLowerCase();
  },
  PROPER: (a, c) => {
    const s = txt(a[0] ?? null, c);
    return isError(s) ? s : s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, ch) => p + ch.toUpperCase());
  },
  TRIM: (a, c) => {
    const s = txt(a[0] ?? null, c);
    return isError(s) ? s : s.trim().replace(/ +/g, " ");
  },
  EXACT: (a, c) => {
    const x = txt(a[0] ?? null, c);
    const y = txt(a[1] ?? null, c);
    if (isError(x)) return x;
    if (isError(y)) return y;
    return x === y;
  },
  SEARCH: (a, c) => {
    const needle = txt(a[0] ?? null, c);
    const hay = txt(a[1] ?? null, c);
    const st = a.length > 2 ? num(a[2], c) : 1;
    if (isError(needle)) return needle;
    if (isError(hay)) return hay;
    if (isError(st)) return st;
    if (st < 1 || st > hay.length + 1) return err("#VALUE!");
    if (needle === "") return st;
    const re = wildcardRegex(needle, false);
    const sub = hay.slice(st - 1);
    const m = sub.match(re);
    return m && m.index !== undefined ? m.index + st : err("#VALUE!");
  },
  FIND: (a, c) => {
    const needle = txt(a[0] ?? null, c);
    const hay = txt(a[1] ?? null, c);
    const st = a.length > 2 ? num(a[2], c) : 1;
    if (isError(needle)) return needle;
    if (isError(hay)) return hay;
    if (isError(st)) return st;
    if (st < 1 || st > hay.length + 1) return err("#VALUE!");
    const i = hay.indexOf(needle, st - 1);
    return i < 0 ? err("#VALUE!") : i + 1;
  },
  CONCATENATE: (a, c) => {
    let s = "";
    for (const v of a) {
      const t = txt(v ?? null, c);
      if (isError(t)) return t;
      s += t;
    }
    return s;
  },
  CONCAT: (a, c) => {
    let s = "";
    for (const v of flatScalars(a, c)) {
      const t = toText(v);
      if (isError(t)) return t;
      s += t;
    }
    return s;
  },
  VALUE: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    if (typeof v === "number") return v;
    const p = parseInput(String(toText(v)));
    return p.t === "n" || p.t === "d" ? (p.v as number) : err("#VALUE!");
  },
  N: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : isError(v) ? v : 0;
  },
  T: (a, c) => {
    const v = scalar(a[0] ?? null, c);
    return typeof v === "string" ? v : isError(v) ? v : "";
  },
  ROW: (a, c) => {
    if (!a.length) return (c.row ?? 0) + 1;
    const r = a[0];
    return isRange(r) ? r.r1 + 1 : err("#VALUE!");
  },
  COLUMN: (a, c) => {
    if (!a.length) return (c.col ?? 0) + 1;
    const r = a[0];
    return isRange(r) ? r.c1 + 1 : err("#VALUE!");
  },
  ROWS: (a) => (isRange(a[0]) ? a[0].r2 - a[0].r1 + 1 : 1),
  COLUMNS: (a) => (isRange(a[0]) ? a[0].c2 - a[0].c1 + 1 : 1),
  MOD: (a, c) => {
    const x = num(a[0] ?? null, c);
    const y = num(a[1] ?? null, c);
    if (isError(x)) return x;
    if (isError(y)) return y;
    if (y === 0) return err("#DIV/0!");
    return x - y * Math.floor(x / y);
  },
  ABS: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : Math.abs(x);
  },
  INT: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : Math.floor(x);
  },
  ROUND: (a, c) => {
    const x = num(a[0] ?? null, c);
    const d = a.length > 1 ? num(a[1], c) : 0;
    if (isError(x)) return x;
    if (isError(d)) return d;
    const f = Math.pow(10, Math.trunc(d));
    return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
  },
  SQRT: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : x < 0 ? err("#NUM!") : Math.sqrt(x);
  },
  TODAY: (_a, c) => today(c),
  NOW: (_a, c) => {
    const d = c.now ?? new Date();
    return today(c) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
  },
  DATE: (a, c) => {
    const y = num(a[0] ?? null, c);
    const m = num(a[1] ?? null, c);
    const d = num(a[2] ?? null, c);
    if (isError(y)) return y;
    if (isError(m)) return m;
    if (isError(d)) return d;
    const yy = y < 1900 ? y + 1900 : y;
    return partsToSerial(Math.trunc(yy), Math.trunc(m), Math.trunc(d));
  },
  YEAR: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : serialToParts(x).y;
  },
  MONTH: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : serialToParts(x).m;
  },
  DAY: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : serialToParts(x).d;
  },
  HOUR: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : serialToParts(x).hh;
  },
  MINUTE: (a, c) => {
    const x = num(a[0] ?? null, c);
    return isError(x) ? x : serialToParts(x).mm;
  },
  WEEKDAY: (a, c) => {
    const x = num(a[0] ?? null, c);
    const t = a.length > 1 ? num(a[1], c) : 1;
    if (isError(x)) return x;
    if (isError(t)) return t;
    const dow = serialToParts(x).dow; // 0 = Sunday
    if (t === 2) return ((dow + 6) % 7) + 1;
    if (t === 3) return (dow + 6) % 7;
    return dow + 1;
  },
  MATCH: (a, c) => {
    const needle = scalar(a[0] ?? null, c);
    const r = a[1];
    if (!isRange(r)) return err("#N/A");
    const vals = rangeCells(r, c);
    const i = vals.findIndex((v) => matchesCriteria(v, typeof needle === "string" ? needle : needle));
    return i < 0 ? err("#N/A") : i + 1;
  },
  AVERAGEIF: (a, c) => {
    const r = a[0];
    if (!isRange(r)) return err("#VALUE!");
    const crit = scalar(a[1] ?? null, c);
    const vals = rangeCells(r, c).filter((v) => typeof v === "number" && matchesCriteria(v, crit)) as number[];
    return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : err("#DIV/0!");
  },
  LARGE: (a, c) => {
    const n = numbers([a[0] ?? null], c);
    const k = num(a[1] ?? null, c);
    if (isError(n)) return n;
    if (isError(k)) return k;
    const s = [...n].sort((x, y) => y - x);
    const i = Math.ceil(k) - 1;
    return i < 0 || i >= s.length ? err("#NUM!") : s[i];
  },
  SMALL: (a, c) => {
    const n = numbers([a[0] ?? null], c);
    const k = num(a[1] ?? null, c);
    if (isError(n)) return n;
    if (isError(k)) return k;
    const s = [...n].sort((x, y) => x - y);
    const i = Math.ceil(k) - 1;
    return i < 0 || i >= s.length ? err("#NUM!") : s[i];
  },
  PERCENTILE: (a, c) => {
    const n = numbers([a[0] ?? null], c);
    const k = num(a[1] ?? null, c);
    if (isError(n)) return n;
    if (isError(k)) return k;
    if (!n.length || k < 0 || k > 1) return err("#NUM!");
    return percentileInc(n, k);
  },
  STDEV: (a, c) => {
    const n = numbers(a, c);
    if (isError(n)) return n;
    if (n.length < 2) return err("#DIV/0!");
    const m = n.reduce((x, y) => x + y, 0) / n.length;
    return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1));
  },
};
FNS["PERCENTILE.INC"] = FNS.PERCENTILE;
FNS["STDEV.S"] = FNS.STDEV;

/** Excel PERCENTILE.INC over unsorted numbers; k in [0, 1]. */
export function percentileInc(values: number[], k: number): number {
  const s = [...values].sort((x, y) => x - y);
  if (s.length === 1) return s[0];
  const pos = k * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function callFn(name: string, argNodes: (Node | null)[], ctx: EvalContext): Value {
  const f = FNS[name.replace(/^_xlfn\./i, "")];
  if (!f) return err("#NAME?");
  const lazy = name === "IF" || name === "IFERROR" || name === "IFNA";
  if (lazy) {
    // Evaluate only the branch that is taken.
    const first = argNodes[0] ? evalNode(argNodes[0], ctx) : null;
    if (name === "IF") {
      const b = toBool(scalar(first, ctx));
      if (isError(b)) return b;
      const idx = b ? 1 : 2;
      if (argNodes.length <= idx) return b ? true : false;
      const n = argNodes[idx];
      return n ? evalNode(n, ctx) : 0;
    }
    const v = scalar(first, ctx);
    const hit = isError(v) && (name === "IFERROR" || v.error === "#N/A");
    if (!hit) return first;
    const n = argNodes[1];
    return n ? evalNode(n, ctx) : "";
  }
  const args = argNodes.map((n) => (n ? evalNode(n, ctx) : null));
  for (const a of args) {
    // A bad reference argument poisons most functions.
    if (isError(a) && a.error === "#REF!") return a;
  }
  return f(args, ctx);
}

export const SUPPORTED_FUNCTIONS = Object.keys(FNS).sort();
