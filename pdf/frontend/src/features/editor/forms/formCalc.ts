// CC3 — PDF form field actions: calculations + formats, evaluated SAFELY.
//
// PDF forms carry JavaScript in field additional-actions (`/AA`): `/C`
// (calculate), `/F` (format), `/K` (keystroke), `/V` (validate), and the
// document calculation order lives in `/AcroForm /CO`. We never execute that
// JavaScript. Instead this module recognises the common patterns Acrobat
// itself writes and a small arithmetic subset, and interprets them over an AST:
//
//   calculate: AFSimple_Calculate("SUM"|"PRD"|"AVG"|"MIN"|"MAX", fields)
//              /** BVCALC <simplified field notation> EVCALC **/ …
//              event.value = <expr>;  getField("x").value (+|-|*|/)?= <expr>;
//              var t = <expr>;       (locals, used by later statements)
//   format:    AFNumber_Format / AFPercent_Format / AFDate_Format(Ex)
//   keystroke: AFNumber_Keystroke / AFPercent_Keystroke / AFDate_Keystroke(Ex)
//
// Anything else (loops, functions, app.alert, …) is ignored statement by
// statement. <expr> is + - * / %, unary -, parentheses, number/string
// literals, field values, locals, AFMakeNumber/Number/parseFloat and a few
// Math functions. Semantics follow Acrobat (field values that look numeric
// read as numbers; `+` concatenates when either side is a string).
//
// Pure module: no React, no pdf-lib — unit-tested by e2e/forms-calc.unit.spec.ts.

// ---------------------------------------------------------------------------
// Field model (the subset the evaluator needs)
// ---------------------------------------------------------------------------

export type CalcFieldType = "text" | "checkbox" | "radio" | "dropdown" | "listbox" | "button";

/** Raw JavaScript for each supported trigger, exactly as stored in `/AA`. */
export interface FieldActions {
  C?: string; // calculate
  F?: string; // format
  K?: string; // keystroke
  V?: string; // validate (kept for round-trip; not evaluated)
}

export interface CalcField {
  fieldType: CalcFieldType;
  name: string;
  value: string | boolean;
  selected?: string[]; // listbox selection
  groupName?: string; // radio group export name
  exportValue?: string; // checkbox on-state value (defaults to "Yes")
  actions?: FieldActions;
  calcOrder?: number;
}

type Val = number | string | string[];

// ---------------------------------------------------------------------------
// Tokenizer (shared by the JS subset and the AF* call parser)
// ---------------------------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "p"; v: string };

const PUNCT = ["+=", "-=", "*=", "/=", "(", ")", "[", "]", ",", ";", ".", "=", "+", "-", "*", "/", "%"];

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\" && i + 1 < src.length) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        out += src[i++];
      }
      if (i < src.length) out += src[i++];
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      out += " ";
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function tokenize(src: string): Tok[] | null {
  const s = stripComments(src);
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) return null;
      toks.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i))!;
      toks.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let v = "";
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === "\\" && i + 1 < s.length) {
          const n = s[i + 1];
          v += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
          i += 2;
          continue;
        }
        v += s[i++];
      }
      if (i >= s.length) return null; // unterminated
      i++;
      toks.push({ t: "str", v });
      continue;
    }
    const p = PUNCT.find((x) => s.startsWith(x, i));
    if (p) {
      toks.push({ t: "p", v: p });
      i += p.length;
      continue;
    }
    // Any other character (braces, operators we don't support, …) is kept as
    // punctuation so the statement containing it fails to parse and is skipped.
    toks.push({ t: "p", v: c });
    i++;
  }
  return toks;
}

// Split tokens into top-level statements on `;` (and on `{`/`}` so block
// constructs become unparseable fragments that are skipped).
function splitStatements(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const tk of toks) {
    if (tk.t === "p" && (tk.v === "(" || tk.v === "[")) depth++;
    if (tk.t === "p" && (tk.v === ")" || tk.v === "]")) depth = Math.max(0, depth - 1);
    if (tk.t === "p" && depth === 0 && (tk.v === ";" || tk.v === "{" || tk.v === "}")) {
      if (cur.length) out.push(cur);
      cur = [];
      if (tk.v !== ";") out.push([tk]); // lone brace → unparseable, skipped
      continue;
    }
    cur.push(tk);
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "arr"; items: Expr[] }
  | { k: "field"; name: string; asString?: boolean }
  | { k: "event" }
  | { k: "local"; name: string }
  | { k: "neg"; e: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "call"; fn: string; args: Expr[] };

type Stmt =
  | { k: "var"; name: string; e: Expr }
  | { k: "assign"; target: { k: "event" } | { k: "field"; name: string } | { k: "local"; name: string }; op: string; e: Expr }
  | { k: "simple"; op: string; fields: Expr }
  | { k: "sfn"; e: Expr };

class ParseError extends Error {}

const MATH_FNS = new Set(["min", "max", "round", "abs", "floor", "ceil", "sqrt", "pow"]);

class Parser {
  private i = 0;
  private toks: Tok[];
  private locals: Set<string>;
  constructor(toks: Tok[], locals: Set<string>) {
    this.toks = toks;
    this.locals = locals;
  }
  private peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  private isP(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.t === "p" && t.v === v;
  }
  private isId(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.t === "id" && t.v === v;
  }
  private eatP(v: string): void {
    if (!this.isP(v)) throw new ParseError(`expected ${v}`);
    this.i++;
  }
  private eatId(v: string): void {
    if (!this.isId(v)) throw new ParseError(`expected ${v}`);
    this.i++;
  }
  private eatStr(): string {
    const t = this.peek();
    if (!t || t.t !== "str") throw new ParseError("expected string");
    this.i++;
    return t.v;
  }
  done(): boolean {
    return this.i >= this.toks.length;
  }

  statement(): Stmt {
    let s: Stmt;
    if (this.isId("var") || this.isId("let") || this.isId("const")) {
      this.i++;
      const t = this.peek();
      if (!t || t.t !== "id") throw new ParseError("expected identifier");
      this.i++;
      this.eatP("=");
      const e = this.expr();
      this.locals.add(t.v);
      s = { k: "var", name: t.v, e };
    } else if (this.isId("AFSimple_Calculate")) {
      this.i++;
      this.eatP("(");
      const op = this.eatStr().toUpperCase();
      this.eatP(",");
      const fields = this.expr();
      this.eatP(")");
      s = { k: "simple", op, fields };
    } else {
      const target = this.lvalue();
      const t = this.peek();
      if (!t || t.t !== "p" || !["=", "+=", "-=", "*=", "/="].includes(t.v)) throw new ParseError("expected assignment");
      this.i++;
      s = { k: "assign", target, op: t.v, e: this.expr() };
    }
    if (!this.done()) throw new ParseError("trailing tokens");
    return s;
  }

  private fieldRef(): string | null {
    // this.getField("x") | getField("x")
    const save = this.i;
    if (this.isId("this") && this.isP(".", 1)) this.i += 2;
    if (this.isId("getField") && this.isP("(", 1)) {
      this.i += 2;
      const name = this.eatStr();
      this.eatP(")");
      return name;
    }
    this.i = save;
    return null;
  }

  private lvalue(): { k: "event" } | { k: "field"; name: string } | { k: "local"; name: string } {
    if (this.isId("event") && this.isP(".", 1) && this.isId("value", 2)) {
      this.i += 3;
      return { k: "event" };
    }
    const name = this.fieldRef();
    if (name !== null) {
      this.eatP(".");
      this.eatId("value");
      return { k: "field", name };
    }
    const t = this.peek();
    if (t && t.t === "id" && this.locals.has(t.v)) {
      this.i++;
      return { k: "local", name: t.v };
    }
    throw new ParseError("unsupported assignment target");
  }

  expr(): Expr {
    let a = this.term();
    while (this.isP("+") || this.isP("-")) {
      const op = (this.peek() as Tok).v as string;
      this.i++;
      a = { k: "bin", op, a, b: this.term() };
    }
    return a;
  }
  private term(): Expr {
    let a = this.unary();
    while (this.isP("*") || this.isP("/") || this.isP("%")) {
      const op = (this.peek() as Tok).v as string;
      this.i++;
      a = { k: "bin", op, a, b: this.unary() };
    }
    return a;
  }
  private unary(): Expr {
    if (this.isP("-")) {
      this.i++;
      return { k: "neg", e: this.unary() };
    }
    if (this.isP("+")) {
      this.i++;
      return { k: "call", fn: "Number", args: [this.unary()] };
    }
    return this.primary();
  }
  private args(): Expr[] {
    this.eatP("(");
    const out: Expr[] = [];
    if (!this.isP(")")) {
      out.push(this.expr());
      while (this.isP(",")) {
        this.i++;
        out.push(this.expr());
      }
    }
    this.eatP(")");
    return out;
  }
  private primary(): Expr {
    const t = this.peek();
    if (!t) throw new ParseError("unexpected end");
    if (t.t === "num") {
      this.i++;
      return { k: "num", v: t.v };
    }
    if (t.t === "str") {
      this.i++;
      return { k: "str", v: t.v };
    }
    if (t.t === "p" && t.v === "(") {
      this.i++;
      const e = this.expr();
      this.eatP(")");
      return e;
    }
    if (t.t === "p" && t.v === "[") {
      this.i++;
      const items: Expr[] = [];
      if (!this.isP("]")) {
        items.push(this.expr());
        while (this.isP(",")) {
          this.i++;
          items.push(this.expr());
        }
      }
      this.eatP("]");
      return { k: "arr", items };
    }
    if (t.t === "id") {
      if (t.v === "new" && this.isId("Array", 1)) {
        this.i += 2;
        return { k: "arr", items: this.args() };
      }
      if (t.v === "event" && this.isP(".", 1) && this.isId("value", 2)) {
        this.i += 3;
        return { k: "event" };
      }
      const name = this.fieldRef();
      if (name !== null) {
        this.eatP(".");
        const prop = this.peek();
        if (prop && prop.t === "id" && (prop.v === "value" || prop.v === "valueAsString")) {
          this.i++;
          return { k: "field", name, asString: prop.v === "valueAsString" };
        }
        throw new ParseError("unsupported field property");
      }
      if (t.v === "Math" && this.isP(".", 1)) {
        const fn = this.peek(2);
        if (fn && fn.t === "id" && MATH_FNS.has(fn.v)) {
          this.i += 3;
          return { k: "call", fn: `Math.${fn.v}`, args: this.args() };
        }
        throw new ParseError("unsupported Math function");
      }
      if (["AFMakeNumber", "Number", "parseFloat", "parseInt"].includes(t.v) && this.isP("(", 1)) {
        this.i++;
        return { k: "call", fn: t.v, args: this.args() };
      }
      if (this.locals.has(t.v)) {
        this.i++;
        return { k: "local", name: t.v };
      }
    }
    throw new ParseError("unsupported expression");
  }
}

// Simplified field notation (Acrobat "BVCALC … EVCALC"): field names are bare
// identifiers (backslash escapes any character, dots allowed), numbers, the
// four operators and parentheses. Field values read through AFMakeNumber.
function parseSfn(src: string): Expr {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)/.exec(src.slice(i))!;
      toks.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ("+-*/()".includes(c)) {
      toks.push({ t: "p", v: c });
      i++;
      continue;
    }
    let name = "";
    while (i < src.length) {
      const d = src[i];
      if (d === "\\" && i + 1 < src.length) {
        name += src[i + 1];
        i += 2;
        continue;
      }
      if (/\s/.test(d) || "+-*/()".includes(d)) break;
      name += d;
      i++;
    }
    toks.push({ t: "str", v: name });
  }
  let p = 0;
  const peekP = (v: string) => toks[p] && toks[p].t === "p" && toks[p].v === v;
  const expr = (): Expr => {
    let a = term();
    while (peekP("+") || peekP("-")) {
      const op = toks[p++].v as string;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Expr => {
    let a = unary();
    while (peekP("*") || peekP("/")) {
      const op = toks[p++].v as string;
      a = { k: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr => {
    if (peekP("-")) {
      p++;
      return { k: "neg", e: unary() };
    }
    const t = toks[p++];
    if (!t) throw new ParseError("unexpected end");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "call", fn: "AFMakeNumber", args: [{ k: "field", name: t.v }] };
    if (t.t === "p" && t.v === "(") {
      const e = expr();
      if (!peekP(")")) throw new ParseError("expected )");
      p++;
      return e;
    }
    throw new ParseError("unexpected token");
  };
  const e = expr();
  if (p !== toks.length) throw new ParseError("trailing tokens");
  return e;
}

const SFN_RE = /BVCALC([\s\S]*?)EVCALC/;

/** Parse a calculate script into the statements we can evaluate safely. */
export function parseCalcScript(js: string): Stmt[] {
  if (!js || !js.trim()) return [];
  const sfn = SFN_RE.exec(js);
  if (sfn) {
    try {
      return [{ k: "sfn", e: parseSfn(sfn[1]) }];
    } catch {
      // fall through to the JS translation Acrobat writes after the comment
    }
  }
  const toks = tokenize(js);
  if (!toks) return [];
  const locals = new Set<string>();
  const out: Stmt[] = [];
  for (const st of splitStatements(toks)) {
    try {
      out.push(new Parser(st, locals).statement());
    } catch {
      // Unsupported statement → ignored (never executed).
    }
  }
  return out;
}

/** True when the calculate script has at least one statement we evaluate. */
export function isSupportedCalc(js: string | undefined): boolean {
  return !!js && parseCalcScript(js).length > 0;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Acrobat's AFMakeNumber: numeric-looking string → number, else null. */
export function AFMakeNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  // Acrobat also accepts a comma decimal separator here.
  const n = Number(s.replace(/^\+/, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toNum(v: Val): number {
  if (Array.isArray(v)) return v.length === 1 ? toNum(v[0]) : NaN;
  if (typeof v === "number") return v;
  const s = v.trim();
  return s === "" ? 0 : Number(s);
}

// A field's JS-visible value: numeric-looking strings read as numbers (so
// `getField("a").value + 1` adds rather than concatenates, as in Acrobat).
function readValue(raw: string | string[]): Val {
  if (Array.isArray(raw)) return raw.length === 1 ? readValue(raw[0]) : raw;
  const n = raw.trim() === "" ? null : Number(raw);
  return n !== null && Number.isFinite(n) ? n : raw;
}

function valToString(v: Val): string {
  if (Array.isArray(v)) return v.join(",");
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? "" : String(v);
    // Trim binary float noise (0.1 + 0.2) without changing real precision.
    return String(Number(v.toPrecision(15)));
  }
  return v;
}

/** The raw value of a field as the evaluator sees it. */
export function fieldRawValue(f: CalcField): string | string[] {
  switch (f.fieldType) {
    case "checkbox":
      return f.value === true ? f.exportValue || "Yes" : "Off";
    case "listbox":
      return f.selected ?? [];
    case "button":
      return "";
    default:
      return typeof f.value === "string" ? f.value : "";
  }
}

// Name → value view over the whole form. Radios are addressed by group name.
class FormView {
  private fields: CalcField[];
  vals = new Map<string, string | string[]>();
  constructor(fields: CalcField[]) {
    this.fields = fields;
    for (const f of fields) {
      if (f.fieldType === "radio") {
        const g = f.groupName || f.name;
        const cur = this.vals.get(g);
        if (typeof f.value === "string" && f.value) this.vals.set(g, f.value);
        else if (cur === undefined) this.vals.set(g, "Off");
      } else if (f.fieldType !== "button") {
        if (!this.vals.has(f.name)) this.vals.set(f.name, fieldRawValue(f));
      }
    }
  }
  has(name: string): boolean {
    return this.vals.has(name) || this.fields.some((f) => f.name === name && f.fieldType === "button");
  }
  get(name: string): string | string[] | undefined {
    return this.vals.get(name);
  }
  // Hierarchical expansion: "item" also matches "item.1", "item.2", ….
  expand(name: string): string[] {
    if (this.vals.has(name)) return [name];
    const pre = name + ".";
    return [...this.vals.keys()].filter((k) => k.startsWith(pre));
  }
}

class Abort extends Error {}

function evalExpr(e: Expr, view: FormView, locals: Map<string, Val>, eventValue: Val): Val {
  switch (e.k) {
    case "num":
      return e.v;
    case "str":
      return e.v;
    case "arr":
      return e.items.map((x) => valToString(evalExpr(x, view, locals, eventValue)));
    case "event":
      return eventValue;
    case "local":
      return locals.get(e.name) ?? "";
    case "field": {
      const v = view.get(e.name);
      if (v === undefined) throw new Abort(); // getField() → null → TypeError in Acrobat
      return e.asString ? (Array.isArray(v) ? v.join(",") : v) : readValue(v);
    }
    case "neg":
      return -toNum(evalExpr(e.e, view, locals, eventValue));
    case "bin": {
      const a = evalExpr(e.a, view, locals, eventValue);
      const b = evalExpr(e.b, view, locals, eventValue);
      if (e.op === "+") {
        if (typeof a === "string" || typeof b === "string" || Array.isArray(a) || Array.isArray(b)) {
          return valToString(a) + valToString(b);
        }
        return a + b;
      }
      const x = toNum(a);
      const y = toNum(b);
      return e.op === "-" ? x - y : e.op === "*" ? x * y : e.op === "/" ? x / y : x % y;
    }
    case "call": {
      const args = e.args.map((x) => evalExpr(x, view, locals, eventValue));
      const n = (i: number) => toNum(args[i] ?? NaN);
      switch (e.fn) {
        case "AFMakeNumber": {
          const r = AFMakeNumber(Array.isArray(args[0]) ? valToString(args[0]) : args[0]);
          return r === null ? 0 : r; // null behaves as 0 in arithmetic
        }
        case "Number":
          return n(0);
        case "parseFloat":
          return parseFloat(valToString(args[0] ?? ""));
        case "parseInt":
          return parseInt(valToString(args[0] ?? ""), 10);
        case "Math.min":
          return Math.min(...args.map((_, i) => n(i)));
        case "Math.max":
          return Math.max(...args.map((_, i) => n(i)));
        case "Math.round":
          return Math.round(n(0));
        case "Math.abs":
          return Math.abs(n(0));
        case "Math.floor":
          return Math.floor(n(0));
        case "Math.ceil":
          return Math.ceil(n(0));
        case "Math.sqrt":
          return Math.sqrt(n(0));
        case "Math.pow":
          return Math.pow(n(0), n(1));
      }
      throw new Abort();
    }
  }
}

export type SimpleOp = "SUM" | "PRD" | "AVG" | "MIN" | "MAX";
export const SIMPLE_OPS: SimpleOp[] = ["SUM", "PRD", "AVG", "MIN", "MAX"];

/** AFSimple_Calculate over already-resolved numeric operands. */
export function simpleCalculate(op: string, nums: number[]): number {
  if (!nums.length) return 0;
  switch (op.toUpperCase()) {
    case "SUM":
      return nums.reduce((s, x) => s + x, 0);
    case "PRD":
      return nums.reduce((s, x) => s * x, 1);
    case "AVG":
      return nums.reduce((s, x) => s + x, 0) / nums.length;
    case "MIN":
      return Math.min(...nums);
    case "MAX":
      return Math.max(...nums);
  }
  return NaN;
}

// Split Acrobat's "a, b, c" field-list string (AFMakeArrayFromList).
function listNames(v: Val): string[] {
  if (Array.isArray(v)) return v;
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function runStatements(stmts: Stmt[], view: FormView, selfName: string, write: (name: string, v: string) => void): void {
  const locals = new Map<string, Val>();
  const self = (): Val => {
    const v = view.get(selfName);
    return v === undefined ? "" : readValue(v);
  };
  try {
    for (const s of stmts) {
      switch (s.k) {
        case "var":
          locals.set(s.name, evalExpr(s.e, view, locals, self()));
          break;
        case "assign": {
          const cur =
            s.target.k === "event" ? self() : s.target.k === "local" ? (locals.get(s.target.name) ?? "") : undefined;
          let before: Val;
          if (s.target.k === "field") {
            const v = view.get(s.target.name);
            if (v === undefined) throw new Abort();
            before = readValue(v);
          } else before = cur as Val;
          const rhs = evalExpr(s.e, view, locals, self());
          let next: Val;
          if (s.op === "=") next = rhs;
          else if (s.op === "+=")
            next =
              typeof before === "string" || typeof rhs === "string" || Array.isArray(before) || Array.isArray(rhs)
                ? valToString(before) + valToString(rhs)
                : before + rhs;
          else {
            const x = toNum(before);
            const y = toNum(rhs);
            next = s.op === "-=" ? x - y : s.op === "*=" ? x * y : x / y;
          }
          if (s.target.k === "local") locals.set(s.target.name, next);
          else write(s.target.k === "event" ? selfName : s.target.name, valToString(next));
          break;
        }
        case "simple": {
          const names = listNames(evalExpr(s.fields, view, locals, self()));
          const nums: number[] = [];
          for (const nm of names) {
            for (const full of view.expand(nm)) {
              const v = view.get(full) ?? "";
              const items = Array.isArray(v) ? v : [v];
              for (const it of items) nums.push(AFMakeNumber(it) ?? 0);
              if (!items.length) nums.push(0);
            }
          }
          write(selfName, valToString(simpleCalculate(s.op, nums)));
          break;
        }
        case "sfn":
          write(selfName, valToString(evalExpr(s.e, view, locals, self())));
          break;
      }
    }
  } catch (err) {
    if (!(err instanceof Abort)) throw err;
    // A runtime error stops the rest of this script, as in Acrobat.
  }
}

/** The document calculation order: fields with a calculate action, sorted by
 *  `calcOrder` (the imported/edited `/CO` position), then document order. */
export function calculationOrder<T extends CalcField>(fields: T[]): T[] {
  return fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !!f.actions?.C && f.fieldType !== "button")
    .sort((a, b) => (a.f.calcOrder ?? Infinity) - (b.f.calcOrder ?? Infinity) || a.i - b.i)
    .map(({ f }) => f);
}

/**
 * Run every calculate action once, in calculation order, after `source`
 * committed a value (null = recalc everything, e.g. after editing a script).
 * Writes to the committing field are ignored so a user's entry is never
 * overwritten by the recalc it triggers; a calc-driven change does not
 * re-trigger calculation (single pass). Returns a new array (unchanged
 * objects are reused) with updated text/dropdown/radio values.
 */
export function runCalculations<T extends CalcField>(fields: T[], source: string | null): T[] {
  const ordered = calculationOrder(fields);
  if (!ordered.length) return fields;
  const view = new FormView(fields);
  const changed = new Map<string, string>();
  for (const f of ordered) {
    const stmts = parseCalcScript(f.actions!.C!);
    if (!stmts.length) continue;
    runStatements(stmts, view, fieldKey(f), (name, v) => {
      if (source !== null && name === source) return;
      if (!view.vals.has(name)) return;
      const cur = view.vals.get(name);
      if (Array.isArray(cur)) return; // listbox values aren't calc targets
      view.vals.set(name, v);
      changed.set(name, v);
    });
  }
  if (!changed.size) return fields;
  return fields.map((f) => {
    const key = fieldKey(f);
    if (!changed.has(key)) return f;
    const v = changed.get(key)!;
    if (f.fieldType === "text" || f.fieldType === "dropdown") return f.value === v ? f : { ...f, value: v };
    if (f.fieldType === "radio") {
      const opt = f.value === v || (f as { options?: string[] }).options?.includes(v) ? v : "";
      return f.value === opt ? f : { ...f, value: opt };
    }
    if (f.fieldType === "checkbox") {
      const on = v !== "Off" && v !== "" && v !== "0" && v !== "false";
      return f.value === on ? f : { ...f, value: on };
    }
    return f;
  });
}

/** The name the evaluator addresses a field by (radios: their group). */
export function fieldKey(f: CalcField): string {
  return f.fieldType === "radio" ? f.groupName || f.name : f.name;
}

// ---------------------------------------------------------------------------
// Formats (AFNumber_* / AFPercent_* / AFDate_*)
// ---------------------------------------------------------------------------

export type FieldFormat =
  | {
      kind: "number";
      decimals: number;
      sepStyle: number; // 0 "1,234.56" · 1 "1234.56" · 2 "1.234,56" · 3 "1234,56" · 4 "1'234.56"
      negStyle: number; // 0 minus · 1 red · 2 parens · 3 red parens · 4 red minus
      currency: string;
      currencyPrepend: boolean;
    }
  | { kind: "percent"; decimals: number; sepStyle: number; percentPrepend?: boolean }
  | { kind: "date"; pattern: string };

/** Acrobat's AFDate_Format(psf) presets, by index. */
export const DATE_PRESETS = [
  "m/d",
  "m/d/yy",
  "mm/dd/yy",
  "mm/yy",
  "d-mmm",
  "d-mmm-yy",
  "dd-mmm-yy",
  "yy-mm-dd",
  "mmm-yy",
  "mmmm-yy",
  "mmm d, yyyy",
  "mmmm d, yyyy",
  "m/d/yy h:MM tt",
  "m/d/yy HH:MM",
];

type Lit = string | number | boolean;

// Find the first call to one of `names` and return its literal arguments.
function findAfCall(js: string, names: string[]): { name: string; args: Lit[] } | null {
  const toks = tokenize(js);
  if (!toks) return null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id" || !names.includes(t.v)) continue;
    const open = toks[i + 1];
    if (!open || open.t !== "p" || open.v !== "(") continue;
    const args: Lit[] = [];
    let j = i + 2;
    let ok = true;
    while (j < toks.length && !(toks[j].t === "p" && toks[j].v === ")")) {
      let neg = false;
      if (toks[j].t === "p" && toks[j].v === "-") {
        neg = true;
        j++;
      }
      const a = toks[j];
      if (!a) {
        ok = false;
        break;
      }
      if (a.t === "num") args.push(neg ? -a.v : a.v);
      else if (a.t === "str") args.push(a.v);
      else if (a.t === "id" && (a.v === "true" || a.v === "false")) args.push(a.v === "true");
      else {
        ok = false;
        break;
      }
      j++;
      if (toks[j] && toks[j].t === "p" && toks[j].v === ",") j++;
    }
    if (ok) return { name: t.v, args };
  }
  return null;
}

const int = (v: Lit | undefined, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

/** Recognise a format (`/AA /F`) or keystroke (`/AA /K`) script. */
export function parseFormatScript(js: string | undefined): FieldFormat | null {
  if (!js) return null;
  const c = findAfCall(js, [
    "AFNumber_Format",
    "AFNumber_Keystroke",
    "AFPercent_Format",
    "AFPercent_Keystroke",
    "AFDate_FormatEx",
    "AFDate_KeystrokeEx",
    "AFDate_Format",
    "AFDate_Keystroke",
  ]);
  if (!c) return null;
  const a = c.args;
  if (c.name.startsWith("AFNumber")) {
    return {
      kind: "number",
      decimals: Math.max(0, Math.min(10, int(a[0], 2))),
      sepStyle: int(a[1], 0),
      negStyle: int(a[2], 0),
      currency: typeof a[4] === "string" ? a[4] : "",
      currencyPrepend: a[5] === undefined ? true : a[5] === true || a[5] === 1 || a[5] === "true",
    };
  }
  if (c.name.startsWith("AFPercent")) {
    return {
      kind: "percent",
      decimals: Math.max(0, Math.min(10, int(a[0], 2))),
      sepStyle: int(a[1], 0),
      percentPrepend: a[2] === true || a[2] === 1,
    };
  }
  if (c.name.endsWith("Ex")) return typeof a[0] === "string" && a[0] ? { kind: "date", pattern: a[0] } : null;
  const idx = int(a[0], 0);
  return { kind: "date", pattern: DATE_PRESETS[idx] ?? DATE_PRESETS[0] };
}

const q = (s: string) => JSON.stringify(s);

/** Build the `/AA /F` + `/AA /K` scripts for a format (what Acrobat writes). */
export function buildFormatScripts(fmt: FieldFormat): { F: string; K: string } {
  if (fmt.kind === "number") {
    const args = `${fmt.decimals}, ${fmt.sepStyle}, ${fmt.negStyle}, 0, ${q(fmt.currency)}, ${fmt.currencyPrepend}`;
    return { F: `AFNumber_Format(${args});`, K: `AFNumber_Keystroke(${args});` };
  }
  if (fmt.kind === "percent") {
    const args = `${fmt.decimals}, ${fmt.sepStyle}${fmt.percentPrepend ? ", 1" : ""}`;
    return { F: `AFPercent_Format(${args});`, K: `AFPercent_Keystroke(${args});` };
  }
  return { F: `AFDate_FormatEx(${q(fmt.pattern)});`, K: `AFDate_KeystrokeEx(${q(fmt.pattern)});` };
}

const SEPS: Record<number, { group: string; dec: string }> = {
  0: { group: ",", dec: "." },
  1: { group: "", dec: "." },
  2: { group: ".", dec: "," },
  3: { group: "", dec: "," },
  4: { group: "'", dec: "." },
};

function roundTo(x: number, d: number): number {
  return Number(Math.round(Number(`${x}e${d}`)) + `e-${d}`);
}

function groupDigits(abs: number, decimals: number, sepStyle: number): string {
  const { group, dec } = SEPS[sepStyle] ?? SEPS[0];
  const fixed = roundTo(abs, decimals).toFixed(decimals);
  const [ip, fp] = fixed.split(".");
  const grouped = group ? ip.replace(/\B(?=(\d{3})+(?!\d))/g, group) : ip;
  return fp !== undefined ? `${grouped}${dec}${fp}` : grouped;
}

export interface Formatted {
  text: string;
  red?: boolean;
}

/**
 * Display text for a raw value under a format (AF*_Format on blur). Returns
 * null when the value can't be formatted (non-numeric / unparseable date), in
 * which case callers show the raw text.
 */
export function formatValue(fmt: FieldFormat | null, raw: string): Formatted | null {
  if (!fmt) return null;
  if (raw.trim() === "") return { text: "" };
  if (fmt.kind === "date") {
    const d = parseDate(raw, fmt.pattern);
    return d ? { text: formatDate(d, fmt.pattern) } : null;
  }
  const n = AFMakeNumber(raw);
  if (n === null) return null;
  if (fmt.kind === "percent") {
    const body = groupDigits(Math.abs(n * 100), fmt.decimals, fmt.sepStyle);
    const neg = roundTo(Math.abs(n * 100), fmt.decimals) !== 0 && n < 0;
    const s = fmt.percentPrepend ? `%${body}` : `${body}%`;
    return { text: neg ? `-${s}` : s };
  }
  const body = groupDigits(Math.abs(n), fmt.decimals, fmt.sepStyle);
  const withCur = fmt.currency ? (fmt.currencyPrepend ? fmt.currency + body : body + fmt.currency) : body;
  const neg = n < 0 && roundTo(Math.abs(n), fmt.decimals) !== 0;
  if (!neg) return { text: withCur };
  switch (fmt.negStyle) {
    case 1:
      return { text: withCur, red: true };
    case 2:
      return { text: `(${withCur})` };
    case 3:
      return { text: `(${withCur})`, red: true };
    case 4:
      return { text: `-${withCur}`, red: true };
    default:
      return { text: `-${withCur}` };
  }
}

/**
 * Keystroke filter (AF*_Keystroke while typing): whether `text` is an
 * acceptable in-progress entry. Dates accept anything (validated on commit).
 */
export function keystrokeAccepts(fmt: FieldFormat | null, text: string): boolean {
  if (!fmt || fmt.kind === "date") return true;
  const cur = fmt.kind === "number" ? fmt.currency.trim() : "";
  let s = text;
  if (cur) s = s.split(cur).join("");
  if (fmt.kind === "percent") s = s.replace(/%/g, "");
  return /^\s*[-+]?[\d\s.,']*\s*$/.test(s);
}

export interface Committed {
  value: string;
  valid: boolean;
}

/**
 * Commit-time normalisation (AF*_Keystroke with willCommit): number/percent
 * text → canonical numeric string ("1,234.50" → "1234.5"); dates → the value
 * reformatted with the field's pattern (Acrobat stores the formatted date).
 */
export function normalizeInput(fmt: FieldFormat | null, text: string): Committed {
  const t = text.trim();
  if (!fmt || t === "") return { value: fmt ? t : text, valid: true };
  if (fmt.kind === "date") {
    const d = parseDate(t, fmt.pattern);
    return d ? { value: formatDate(d, fmt.pattern), valid: true } : { value: text, valid: false };
  }
  let s = t;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  let pct = false;
  if (fmt.kind === "percent" && s.includes("%")) {
    pct = true;
    s = s.replace(/%/g, "");
  }
  if (fmt.kind === "number" && fmt.currency.trim()) s = s.split(fmt.currency.trim()).join("");
  const { dec } = SEPS[fmt.sepStyle] ?? SEPS[0];
  s = s.replace(/[\s']/g, "");
  if (dec === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { value: text, valid: false };
  let n = Number(s);
  if (neg) n = -Math.abs(n);
  if (pct) n = n / 100;
  return { value: valToString(n), valid: true };
}

// ---- dates ----------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type DateTok = { tok: string } | { lit: string };

function tokenizeDatePattern(p: string): DateTok[] {
  const out: DateTok[] = [];
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if ("ymdHhMst".includes(c)) {
      let j = i;
      while (j < p.length && p[j] === c) j++;
      out.push({ tok: p.slice(i, j) });
      i = j;
    } else if (c === "\\" && i + 1 < p.length) {
      out.push({ lit: p[i + 1] });
      i += 2;
    } else {
      out.push({ lit: c });
      i++;
    }
  }
  return out;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatDate(d: Date, pattern: string): string {
  let out = "";
  for (const t of tokenizeDatePattern(pattern)) {
    if ("lit" in t) {
      out += t.lit;
      continue;
    }
    const h = d.getHours();
    switch (t.tok) {
      case "yyyy":
        out += pad(d.getFullYear(), 4);
        break;
      case "yy":
        out += pad(d.getFullYear() % 100);
        break;
      case "mmmm":
        out += MONTHS[d.getMonth()];
        break;
      case "mmm":
        out += MONTHS[d.getMonth()].slice(0, 3);
        break;
      case "mm":
        out += pad(d.getMonth() + 1);
        break;
      case "m":
        out += String(d.getMonth() + 1);
        break;
      case "dddd":
        out += DAYS[d.getDay()];
        break;
      case "ddd":
        out += DAYS[d.getDay()].slice(0, 3);
        break;
      case "dd":
        out += pad(d.getDate());
        break;
      case "d":
        out += String(d.getDate());
        break;
      case "HH":
        out += pad(h);
        break;
      case "H":
        out += String(h);
        break;
      case "hh":
        out += pad(h % 12 || 12);
        break;
      case "h":
        out += String(h % 12 || 12);
        break;
      case "MM":
        out += pad(d.getMinutes());
        break;
      case "M":
        out += String(d.getMinutes());
        break;
      case "ss":
        out += pad(d.getSeconds());
        break;
      case "s":
        out += String(d.getSeconds());
        break;
      case "tt":
        out += h < 12 ? "am" : "pm";
        break;
      case "t":
        out += h < 12 ? "a" : "p";
        break;
      default:
        out += t.tok; // unknown run (e.g. "yyy") passes through
    }
  }
  return out;
}

function makeDate(y: number, m: number, d: number, hh = 0, mi = 0, ss = 0): Date | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && hh >= 0 && hh < 24 && mi >= 0 && mi < 60 && ss >= 0 && ss < 60)) return null;
  const dt = new Date(y, m - 1, d, hh, mi, ss);
  dt.setFullYear(y); // years < 100 aren't remapped to 19xx
  return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

const fullYear = (y: number, digits: number) => (digits <= 2 ? (y < 50 ? 2000 + y : 1900 + y) : y);

/**
 * Parse user date input the way AFParseDateEx does: numbers are assigned to
 * the pattern's day/month/year slots in pattern order (month names anywhere
 * win the month slot), ISO "yyyy-mm-dd" is always accepted, missing year →
 * this year, missing day → 1. Returns null when no valid date results.
 */
export function parseDate(input: string, pattern: string, now: Date = new Date()): Date | null {
  const s = input.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (iso) return makeDate(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));

  const toks = tokenizeDatePattern(pattern).filter((t): t is { tok: string } => "tok" in t);
  const order = toks.map((t) => t.tok[0]).filter((c, i, a) => a.indexOf(c) === i && "ymd".includes(c));
  const timeToks = toks.map((t) => t.tok[0]).filter((c) => "HhMs".includes(c));

  let monthFromName: number | null = null;
  const lower = s.toLowerCase();
  MONTHS.forEach((mn, i) => {
    if (monthFromName === null && new RegExp(`\\b${mn.slice(0, 3).toLowerCase()}[a-z]*\\b`).test(lower)) monthFromName = i + 1;
  });
  const pm = /\bp\.?m?\.?\b/i.test(s) && timeToks.length > 0;
  const am = /\ba\.?m?\.?\b/i.test(s) && timeToks.length > 0;
  const nums = [...s.matchAll(/\d+/g)].map((m) => ({ v: +m[0], len: m[0].length }));

  const slots = monthFromName !== null ? order.filter((c) => c !== "m") : order.length ? order : ["m", "d", "y"];
  let y: number | null = null;
  let m: number | null = monthFromName;
  let d: number | null = null;
  let k = 0;
  for (const slot of slots) {
    const n = nums[k];
    if (!n) break;
    k++;
    if (slot === "y") y = fullYear(n.v, n.len);
    else if (slot === "m") m = n.v;
    else d = n.v;
  }
  // A lone 4-digit number left over (e.g. "Mar 7 2026" against "mmm d") is the year.
  if (y === null && nums[k] && nums[k].len === 4) y = nums[k++].v;
  let hh = 0;
  let mi = 0;
  let ss = 0;
  if (timeToks.length) {
    const rest = nums.slice(k);
    hh = rest[0]?.v ?? 0;
    mi = rest[1]?.v ?? 0;
    ss = rest[2]?.v ?? 0;
    if (pm && hh < 12) hh += 12;
    if (am && hh === 12) hh = 0;
  }
  if (m === null && d === null) return null;
  return makeDate(y ?? now.getFullYear(), m ?? 1, d ?? 1, hh, mi, ss);
}

// ---------------------------------------------------------------------------
// Calculate-script builders + description (for the properties panel)
// ---------------------------------------------------------------------------

/** AFSimple_Calculate("SUM", new Array("a", "b")); */
export function buildSimpleCalcScript(op: SimpleOp, names: string[]): string {
  return `AFSimple_Calculate(${q(op)}, new Array(${names.map(q).join(", ")}));`;
}

function sfnToJs(e: Expr): string {
  switch (e.k) {
    case "num":
      return String(e.v);
    case "neg":
      return `-(${sfnToJs(e.e)})`;
    case "bin":
      return `(${sfnToJs(e.a)} ${e.op} ${sfnToJs(e.b)})`;
    case "call":
      if (e.fn === "AFMakeNumber" && e.args[0]?.k === "field") return `AFMakeNumber(getField(${q(e.args[0].name)}).value)`;
      break;
  }
  throw new ParseError("not SFN");
}

/**
 * Simplified-field-notation script, as Acrobat stores it: the SFN source in a
 * BVCALC comment plus an equivalent JS translation for other viewers. Returns
 * null when `expr` isn't valid SFN.
 */
export function buildSfnScript(expr: string): string | null {
  try {
    const e = parseSfn(expr);
    const body = sfnToJs(e).replace(/^\((.*)\)$/, "$1");
    // "*/" can't appear in SFN (only names could carry it) — escape defensively.
    return `/** BVCALC ${expr.trim().replace(/\*\//g, "*\\/")} EVCALC **/ event.value = ${body};`;
  } catch {
    return null;
  }
}

export type CalcDescription =
  | { mode: "none" }
  | { mode: "simple"; op: SimpleOp; fields: string[] }
  | { mode: "sfn"; expr: string }
  | { mode: "custom"; supported: boolean };

/** Classify a calculate script for the properties-panel editor. */
export function describeCalc(js: string | undefined): CalcDescription {
  if (!js || !js.trim()) return { mode: "none" };
  const sfn = SFN_RE.exec(js);
  if (sfn) {
    try {
      parseSfn(sfn[1]);
      return { mode: "sfn", expr: sfn[1].trim() };
    } catch {
      /* fall through */
    }
  }
  const stmts = parseCalcScript(js);
  const toks = tokenize(js) ?? [];
  const stmtCount = splitStatements(toks).length;
  if (stmts.length === 1 && stmtCount === 1 && stmts[0].k === "simple" && (SIMPLE_OPS as string[]).includes(stmts[0].op)) {
    const f = stmts[0].fields;
    let names: string[] | null = null;
    if (f.k === "arr" && f.items.every((x) => x.k === "str")) names = f.items.map((x) => (x as { v: string }).v);
    else if (f.k === "str") names = listNames(f.v);
    if (names) return { mode: "simple", op: stmts[0].op as SimpleOp, fields: names };
  }
  return { mode: "custom", supported: stmts.length > 0 };
}
