// Calculated pivot fields: "=Price*Units - Cost". Field names are bare words
// or quoted ('Ship date'); each evaluates to the sum of that field over the
// records behind a pivot cell (Excel's calculated-field rule). Operators:
// + - * / ^ %, unary minus, parentheses, numbers.

import { err, isError, type Scalar } from "./cellValue";

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | null {
  const s = src.trim().replace(/^=/, "");
  const out: Tok[] = [];
  let i = 0;
  // 'quoted name' with '' for a quote; i is on the opening quote.
  const quoted = (): string | null => {
    let j = i + 1;
    let name = "";
    while (j < s.length) {
      if (s[j] === "'") {
        if (s[j + 1] === "'") {
          name += "'";
          j += 2;
          continue;
        }
        i = j + 1;
        return name;
      }
      name += s[j++];
    }
    return null;
  };
  // Field[Item] / Field['It''em']: the item in brackets after a field name
  // (undefined when there is none, null when it is malformed).
  const bracket = (): string | undefined | null => {
    if (s[i] !== "[") return undefined;
    i++;
    while (s[i] === " ") i++;
    let item: string | null;
    if (s[i] === "'") item = quoted();
    else {
      const close = s.indexOf("]", i);
      if (close < 0) return null;
      item = s.slice(i, close).trim();
      i = close;
    }
    if (item === null) return null;
    while (s[i] === " ") i++;
    if (s[i] !== "]") return null;
    i++;
    return item;
  };
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(s.slice(i));
      if (!m) return null;
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === "'") {
      const name = quoted();
      if (name === null) return null;
      const item = bracket();
      if (item === null) return null;
      out.push({ t: "name", v: item ?? name });
      continue;
    }
    if ("+-*/^%()".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    const m = /^[A-Za-z_À-￯][\wÀ-￯.]*/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const item = bracket();
    if (item === null) return null;
    out.push({ t: "name", v: item ?? m[0] });
  }
  return out;
}

/** Field names a calculated-field formula refers to. */
export function calcFieldRefs(formula: string): string[] {
  return (tokenize(formula) ?? []).filter((t) => t.t === "name").map((t) => t.v);
}

/** True when the formula parses. */
export function isValidCalc(formula: string): boolean {
  const toks = tokenize(formula);
  if (!toks || !toks.length) return false;
  try {
    const p = new Parser(toks, () => 1);
    p.expr();
    return p.pos === toks.length;
  } catch {
    return false;
  }
}

class Parser {
  pos = 0;
  constructor(
    private toks: Tok[],
    private resolve: (name: string) => Scalar | undefined,
  ) {}
  peek(): Tok | undefined {
    return this.toks[this.pos];
  }
  eat(v: string): boolean {
    const t = this.peek();
    if (t && t.t === "op" && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }
  expr(): Scalar {
    let a = this.term();
    for (;;) {
      if (this.eat("+")) a = bin(a, this.term(), (x, y) => x + y);
      else if (this.eat("-")) a = bin(a, this.term(), (x, y) => x - y);
      else return a;
    }
  }
  term(): Scalar {
    let a = this.power();
    for (;;) {
      if (this.eat("*")) a = bin(a, this.power(), (x, y) => x * y);
      else if (this.eat("/")) a = bin(a, this.power(), (x, y) => (y === 0 ? NaN : x / y));
      else return a;
    }
  }
  power(): Scalar {
    let a = this.unary();
    while (this.eat("^")) a = bin(a, this.unary(), (x, y) => Math.pow(x, y));
    return a;
  }
  unary(): Scalar {
    if (this.eat("-")) return bin(0, this.unary(), (x, y) => x - y);
    if (this.eat("+")) return this.unary();
    let v = this.atom();
    while (this.eat("%")) v = bin(v, 100, (x, y) => x / y);
    return v;
  }
  atom(): Scalar {
    const t = this.peek();
    if (!t) throw new Error("end");
    this.pos++;
    if (t.t === "num") return t.v;
    if (t.t === "name") {
      const v = this.resolve(t.v);
      if (v === undefined) return err("#NAME?");
      return v;
    }
    if (t.v === "(") {
      const v = this.expr();
      if (!this.eat(")")) throw new Error(")");
      return v;
    }
    throw new Error("unexpected");
  }
}

function bin(a: Scalar, b: Scalar, f: (x: number, y: number) => number): Scalar {
  if (isError(a)) return a;
  if (isError(b)) return b;
  const x = typeof a === "number" ? a : 0;
  const y = typeof b === "number" ? b : 0;
  const r = f(x, y);
  if (Number.isNaN(r)) return err("#DIV/0!");
  if (!Number.isFinite(r)) return err("#NUM!");
  return r;
}

/** evalCalculated evaluates a calculated-field formula; names resolve through `resolve`. */
export function evalCalculated(formula: string, resolve: (name: string) => Scalar | undefined): Scalar {
  const toks = tokenize(formula);
  if (!toks || !toks.length) return err("#NAME?");
  try {
    const p = new Parser(toks, resolve);
    const v = p.expr();
    if (p.pos !== toks.length) return err("#NAME?");
    return v;
  } catch {
    return err("#NAME?");
  }
}
