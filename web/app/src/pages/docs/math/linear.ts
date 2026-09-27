// Linear format for Docs equations: a UnicodeMath reader ("build up": text
// -> model) and writer ("linear view": model -> text), as typed in Word and
// OnlyOffice. The reader works on *cells* (characters or already-built math
// objects), so the autocorrect engine (autocorrect.ts) can re-read part of an
// equation that already contains objects.
//
// Precedence, loosest first: sequence (operators and spaces stay text) ->
// fraction  a/b (right-associative; ¦ ∕ ⁄ are the other fraction kinds) ->
// above/below  a┴b a┬b (right-associative) -> scripts  a^b a_b (a chain of
// the same script is right-associative, ^ after _ makes a sub-superscript) ->
// prefix operators (√ ∛ ∜ □ ▭ ▁ ¯ ⏞ ⏟ ■( █( n-ary) -> atoms (letter/digit
// runs, bracket groups, objects).
import {
  type Content,
  type FracType,
  type MNode,
  type MObj,
  type MRun,
  isObj,
  isRun,
  normalize,
  run,
} from "./model";
import {
  BARS,
  BOXES,
  FRACTION_OPS,
  FUNC_NAMES,
  GROUP_CHARS,
  LIMIT_FUNCS,
  NARY_INTEGRALS,
  PRIMES,
  RADICALS,
  inStr,
  isAlnum,
  isClose,
  isCombining,
  isLR,
  isNary,
  isOpen,
  isOperator,
  isSpace,
} from "./symbols";

/** A cell: one character (with the style of its run) or a built object. */
export type Cell = { ch: string; tpl?: MRun } | { obj: MObj };
export const isCharCell = (c: Cell | undefined): c is { ch: string; tpl?: MRun } => !!c && "ch" in c;
export const cellCh = (c: Cell | undefined): string => (c && "ch" in c ? c.ch : "");

/** cellsOf flattens a content into cells (runs split per code point). */
export function cellsOf(c: Content): Cell[] {
  const out: Cell[] = [];
  for (const n of c) {
    if (isRun(n)) {
      const tpl = n.sty || n.nor || n.color || n.bg ? n : undefined;
      for (const ch of n.text) out.push(tpl ? { ch, tpl } : { ch });
    } else out.push({ obj: n });
  }
  return out;
}

/** cellsToContent turns cells back into (normalized) content. */
export function cellsToContent(cells: Cell[]): Content {
  const out: Content = [];
  for (const c of cells) out.push("obj" in c ? c.obj : charRun(c));
  return normalize(out);
}

function charRun(c: { ch: string; tpl?: MRun }): MRun {
  if (!c.tpl) return run(c.ch);
  const { t: _t, text: _x, ...style } = c.tpl;
  void _t;
  void _x;
  return run(c.ch, style);
}

const LEFT_WORDS: Record<string, string> = { "\\left": "├", "\\open": "├", "\\right": "┤", "\\close": "┤" };

/** textCells: cells for a plain string (\left( … \right) become ├( … ┤)). */
export function textCells(text: string): Cell[] {
  const chars = [...text];
  const out: Cell[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\\") {
      const m = /^\\(left|right|open|close)/.exec(chars.slice(i, i + 7).join(""));
      if (m) {
        const after = chars[i + m[0].length];
        if (after && (isOpen(after) || isClose(after) || isLR(after) || after === ".")) {
          out.push({ ch: LEFT_WORDS[m[0]] });
          i += m[0].length - 1;
          continue;
        }
      }
    }
    out.push({ ch: chars[i] });
  }
  return out;
}

/** parseLinear builds up a UnicodeMath string into model content. */
export function parseLinear(text: string): Content {
  return parseCells(textCells(text));
}

/** parseCells builds up a cell sequence (the whole of it). */
export function parseCells(cells: Cell[]): Content {
  const p = new Parser(cells);
  return normalize(p.seq(() => false));
}

const FRAC_TYPE: Record<string, FracType> = { "/": "bar", "∕": "lin", "⁄": "skw", "¦": "noBar" };
const isPrefix = (c: string) =>
  inStr(RADICALS, c) || inStr(BOXES, c) || inStr(BARS, c) || inStr(GROUP_CHARS, c) || isNary(c);

class Parser {
  i = 0;
  /** Delimiters built from plain ( ) that an operand position may strip. */
  parens = new WeakSet<MObj>();
  constructor(readonly cells: Cell[]) {}

  peek(k = 0): Cell | undefined {
    return this.cells[this.i + k];
  }
  ch(k = 0): string {
    return cellCh(this.peek(k));
  }

  // --- bracket matching ----------------------------------------------------
  /** findClose: index of the cell closing the group opened at `start`, or -1.
   *  A "|" inside a group first tries to open a nested |…| pair (closed only
   *  by another bar); if that fails it closes the enclosing group. */
  findClose(start: number, inner = false): number {
    const cells = this.cells;
    const open = cellCh(cells[start]);
    let j = start + 1;
    if (open === "├") j++; // the bracket character after ├
    while (j < cells.length) {
      const c = cellCh(cells[j]);
      if (open === "├") {
        if (c === "┤") return j;
      } else if (c === "┤") return inner ? -1 : j;
      if (c === "├" || isOpen(c)) {
        const k = this.findClose(j);
        if (k < 0) {
          j++;
          continue;
        }
        j = k + (cellCh(cells[k]) === "┤" ? 2 : 1);
        continue;
      }
      if (open !== "├" && isClose(c)) return inner ? -1 : j;
      if (isLR(c)) {
        if (open !== "├") {
          const k = this.findClose(j, true);
          if (k >= 0) {
            j = k + 1;
            continue;
          }
          return j;
        }
        const k = this.findClose(j, true);
        j = k >= 0 ? k + 1 : j + 1;
        continue;
      }
      j++;
    }
    return -1;
  }

  /** Split cells [from, to) at top-level separator characters. */
  splitTop(from: number, to: number, seps: string): Array<[number, number]> {
    const parts: Array<[number, number]> = [];
    let s = from;
    let j = from;
    while (j < to) {
      const c = cellCh(this.cells[j]);
      if (c === "├" || isOpen(c) || isLR(c)) {
        const k = this.findClose(j, isLR(c));
        if (k >= 0 && k < to) {
          j = k + (cellCh(this.cells[k]) === "┤" ? 2 : 1);
          continue;
        }
      }
      if (inStr(seps, c)) {
        parts.push([s, j]);
        s = j + 1;
      }
      j++;
    }
    parts.push([s, to]);
    return parts;
  }

  /** Parse cells [from, to) with a fresh sub-parser. */
  sub(from: number, to: number): Content {
    const p = new Parser(this.cells.slice(from, to));
    p.parens = this.parens;
    return normalize(p.seq(() => false));
  }

  // --- grammar ---------------------------------------------------------------
  startsTerm(k = 0): boolean {
    const c = this.peek(k);
    if (!c) return false;
    if ("obj" in c) return true;
    const ch = c.ch;
    if (isAlnum(ch)) return true;
    if (ch === "├" || isOpen(ch) || isLR(ch)) return this.findClose(this.i + k) >= 0;
    if (isPrefix(ch)) return true;
    if ((ch === "■" || ch === "█") && this.ch(k + 1) === "(") return this.findClose(this.i + k + 1) >= 0;
    if (ch === "^" || ch === "_") return true;
    if (inStr(FRACTION_OPS, ch) && k === 0) return false;
    return false;
  }

  seq(stop: (c: Cell) => boolean): Content {
    const out: Content = [];
    while (this.i < this.cells.length) {
      const c = this.cells[this.i];
      if (stop(c)) break;
      if (this.startsTerm()) {
        const at = this.i;
        const t = this.fracLevel();
        if (this.i === at) {
          out.push(charRun(c as { ch: string; tpl?: MRun }));
          this.i++;
          continue;
        }
        out.push(...t);
        if (t.some(isObj) && isSpace(this.ch()) && this.i < this.cells.length - 1) this.i++;
        continue;
      }
      if (inStr(FRACTION_OPS, cellCh(c))) {
        // a fraction with an empty numerator ("/2")
        const t = this.fracLevel(true);
        out.push(...t);
        continue;
      }
      out.push(charRun(c as { ch: string; tpl?: MRun }));
      this.i++;
    }
    return out;
  }

  /** unwrap: a plain (…) group used as an operand stands for its content. */
  unwrap(c: Content): Content {
    const items = c.filter((n) => !(isRun(n) && n.text === ""));
    if (items.length === 1 && isObj(items[0]) && items[0].t === "d" && this.parens.has(items[0]) && items[0].items.length === 1)
      return items[0].items[0];
    return c;
  }

  fracLevel(emptyNum = false): Content {
    const left = emptyNum ? [] : this.limitLevel();
    const op = this.ch();
    if (op && inStr(FRACTION_OPS, op)) {
      this.i++;
      const right = this.startsTerm() ? this.fracLevel() : [];
      const f: MObj = { t: "f", type: FRAC_TYPE[op], num: normalize(this.unwrap(left)), den: normalize(this.unwrap(right)) };
      return [f];
    }
    return left;
  }

  limitLevel(): Content {
    const left = this.scriptLevel();
    const op = this.ch();
    if (op === "┴" || op === "┬") {
      this.i++;
      const right = this.startsTerm() ? this.limitLevel() : [];
      return [
        {
          t: op === "┴" ? "limUpp" : "limLow",
          base: normalize(this.unwrap(left)),
          lim: normalize(this.unwrap(right)),
        },
      ];
    }
    return left;
  }

  scriptLevel(): Content {
    let base = this.prefixLevel();
    for (;;) {
      const c = this.ch();
      if (inStr(PRIMES, c) || c === "'") {
        if (c === "'" && !(base.length && base.some((n) => !isRun(n) || n.text))) break;
        if (c === "'") break;
        this.i++;
        base = [{ t: "sSup", base: normalize(this.unwrap(base)), sup: [run(c)] }];
        continue;
      }
      if (c === "^" || c === "_") {
        const only = base.filter((n) => !(isRun(n) && n.text === ""));
        if (only.length === 1 && isObj(only[0]) && only[0].t === "groupChr" && (only[0].chr === "⏞" || only[0].chr === "⏟")) {
          // a script on an over/under brace puts the limit above / below it
          this.i++;
          const lim = this.startsTerm() ? this.scriptLevel() : [];
          return [{ t: c === "^" ? "limUpp" : "limLow", base: normalize(only), lim: normalize(this.unwrap(lim)) }];
        }
        this.i++;
        const first = this.scriptArg(c);
        const other = c === "^" ? "_" : "^";
        if (this.ch() === other) {
          this.i++;
          const second = this.scriptArg(other);
          const sub = c === "_" ? first : second;
          const sup = c === "^" ? first : second;
          return [{ t: "sSubSup", base: normalize(this.unwrap(base)), sub, sup }];
        }
        base = [
          c === "^"
            ? { t: "sSup", base: normalize(this.unwrap(base)), sup: first }
            : { t: "sSub", base: normalize(this.unwrap(base)), sub: first },
        ];
        break;
      }
      break;
    }
    return base;
  }

  /** The operand of ^ or _ (a repeated script of the same kind nests). */
  scriptArg(kind: string): Content {
    let arg: Content;
    const c = this.peek();
    if (!c) return [];
    const ch = cellCh(c);
    if ((ch === "-" || ch === "+" || ch === "−") && this.startsTerm(1)) {
      this.i++;
      arg = [run(ch), ...this.scriptAtom()];
    } else if (ch === "'" || ch === '"') {
      this.i++;
      arg = [run(ch)];
    } else if ("obj" in c || isAlnum(ch) || isPrefix(ch) || ch === "├" || isOpen(ch) || isLR(ch) || ch === "■" || ch === "█") {
      if (!this.startsTerm()) return [];
      arg = this.scriptAtom();
    } else return [];
    if (this.ch() === kind) {
      this.i++;
      const inner = this.scriptArg(kind);
      arg = [
        kind === "^"
          ? { t: "sSup", base: normalize(this.unwrap(arg)), sup: inner }
          : { t: "sSub", base: normalize(this.unwrap(arg)), sub: inner },
      ];
    }
    return normalize(this.unwrap(arg));
  }

  scriptAtom(): Content {
    const ch = this.ch();
    if (isPrefix(ch) || ch === "■" || ch === "█") return this.prefixLevel();
    return this.atom(true);
  }

  prefixLevel(): Content {
    const c = this.peek();
    if (!c || "obj" in c) return this.atom();
    const ch = c.ch;
    if (inStr(RADICALS, ch)) {
      this.i++;
      return [this.radical(ch)];
    }
    if (inStr(BOXES, ch) || inStr(BARS, ch) || inStr(GROUP_CHARS, ch)) {
      this.i++;
      // an over/under brace takes one operand; a script after it becomes a limit
      const brace = ch === "⏞" || ch === "⏟";
      const arg = normalize(this.unwrap(this.startsTerm() ? (brace ? this.atom() : this.limitLevel()) : []));
      if (ch === "□") return [{ t: "box", base: arg }];
      if (ch === "▭") return [{ t: "borderBox", base: arg }];
      if (ch === "▁") return [{ t: "bar", pos: "bot", base: arg }];
      if (ch === "¯") return [{ t: "bar", pos: "top", base: arg }];
      const top = inStr("⏞⏜⎴⏠", ch);
      return [{ t: "groupChr", chr: ch, pos: top ? "top" : "bot", base: arg }];
    }
    if ((ch === "■" || ch === "█") && this.ch(1) === "(") {
      const k = this.findClose(this.i + 1);
      if (k >= 0) {
        const from = this.i + 2;
        this.i = k + 1;
        if (ch === "█") return [{ t: "eqArr", rows: this.splitTop(from, k, "@").map(([a, b]) => this.sub(a, b)) }];
        const rows = this.splitTop(from, k, "@").map(([a, b]) => {
          const p = new Parser(this.cells.slice(a, b));
          p.parens = this.parens;
          return p.splitTop(0, b - a, "&").map(([x, y]) => p.sub(x, y));
        });
        const cols = Math.max(...rows.map((r) => r.length));
        for (const r of rows) while (r.length < cols) r.push([run()]);
        return [{ t: "m", rows }];
      }
    }
    if (isNary(ch)) return [this.nary(ch)];
    if (ch === "^" || ch === "_") return this.prescriptOrEmptyBase(ch);
    return this.atom();
  }

  radical(ch: string): MObj {
    let deg: Content = ch === "∛" ? [run("3")] : ch === "∜" ? [run("4")] : [run()];
    let base: Content;
    if (this.ch() === "(" && this.findClose(this.i) >= 0 && ch === "√") {
      const k = this.findClose(this.i);
      const parts = this.splitTop(this.i + 1, k, "&");
      if (parts.length >= 2) {
        deg = this.sub(parts[0][0], parts[0][1]);
        base = this.sub(parts[1][0], parts[parts.length - 1][1]);
        this.i = k + 1;
        return { t: "rad", deg: normalize(deg), base: normalize(base) };
      }
    }
    base = this.unwrap(this.startsTerm() ? this.limitLevel() : []);
    return { t: "rad", deg: normalize(deg), base: normalize(base) };
  }

  nary(chr: string): MObj {
    this.i++;
    let sub: Content | null = null;
    let sup: Content | null = null;
    for (let k = 0; k < 2; k++) {
      const c = this.ch();
      if (c === "_" && !sub) {
        this.i++;
        sub = this.scriptArg("_");
      } else if (c === "^" && !sup) {
        this.i++;
        sup = this.scriptArg("^");
      }
    }
    if (isSpace(this.ch()) && this.ch(1) === "▒") this.i++;
    let base: Content = [];
    if (this.ch() === "▒") {
      // the operand after ▒: terms (and the spaces between them) up to an operator
      this.i++;
      while (this.startsTerm() || (isSpace(this.ch()) && this.startsTerm(1))) {
        if (isSpace(this.ch())) {
          base.push(charRun(this.peek() as { ch: string }));
          this.i++;
          continue;
        }
        const t = this.fracLevel();
        base.push(...t);
        if (t.some(isObj) && isSpace(this.ch()) && this.startsTerm(1)) this.i++;
      }
    } else if (this.startsTerm()) base = this.fracLevel();
    return {
      t: "nary",
      chr,
      limLoc: inStr(NARY_INTEGRALS, chr) ? "subSup" : "undOvr",
      sub,
      sup,
      base: normalize(base),
    };
  }

  prescriptOrEmptyBase(ch: string): Content {
    this.i++;
    const first = this.scriptArg(ch);
    const other = ch === "^" ? "_" : "^";
    if (this.ch() === other) {
      this.i++;
      const second = this.scriptArg(other);
      const sub = ch === "_" ? first : second;
      const sup = ch === "^" ? first : second;
      if (isSpace(this.ch()) && this.startsTerm(1)) {
        this.i++;
        const base = this.scriptLevel();
        return [{ t: "sPre", sub, sup, base: normalize(this.unwrap(base)) }];
      }
      return [{ t: "sSubSup", base: [run()], sub, sup }];
    }
    return [ch === "^" ? { t: "sSup", base: [run()], sup: first } : { t: "sSub", base: [run()], sub: first }];
  }

  /** atom: an object, a bracket group or a run of letters/digits (+ accents, functions). */
  atom(inScript = false): Content {
    const c = this.peek();
    if (!c) return [];
    if ("obj" in c) {
      this.i++;
      return [c.obj];
    }
    const ch = c.ch;
    if (ch === "├" || isOpen(ch) || isLR(ch)) return this.group();
    if (!isAlnum(ch)) {
      this.i++;
      return [charRun(c)];
    }
    // letters/digits
    const start = this.i;
    const out: Content = [];
    let text: Array<{ ch: string; tpl?: MRun }> = [];
    const flush = () => {
      for (const t of text) out.push(charRun(t));
      text = [];
    };
    while (this.i < this.cells.length && isAlnum(this.ch())) {
      const cell = this.peek() as { ch: string; tpl?: MRun };
      this.i++;
      if (isCombining(this.ch())) {
        flush();
        let node: MObj | MRun = charRun(cell);
        while (isCombining(this.ch())) {
          node = { t: "acc", chr: this.ch(), base: normalize([node]) };
          this.i++;
        }
        out.push(node);
        continue;
      }
      text.push(cell);
    }
    flush();
    // function application: name⁡argument (or name_lim⁡argument)
    if (!inScript) {
      const letters = this.cells.slice(start, this.i).map(cellCh).join("");
      const fn = this.funcAfter(letters);
      if (fn) return fn(out);
    }
    return out;
  }

  /** funcAfter: if a function application follows the letters just read, build it. */
  funcAfter(letters: string): ((name: Content) => Content) | null {
    let k = 0;
    let script: { kind: string; arg: Content } | null = null;
    const save = this.i;
    if ((this.ch() === "_" || this.ch() === "^") && FUNC_NAMES.includes(letters)) {
      // lim_x⁡… : peek for the ⁡ after the script
      const kind = this.ch();
      this.i++;
      const arg = this.scriptArg(kind);
      if (this.ch() !== "⁡") {
        this.i = save;
        return null;
      }
      script = { kind, arg };
    }
    if (this.ch(k) !== "⁡") return null;
    this.i++;
    // lim⁡_x … (OnlyOffice's autocorrect writes the script after the ⁡)
    if (!script && (this.ch() === "_" || this.ch() === "^")) {
      const kind = this.ch();
      this.i++;
      script = { kind, arg: this.scriptArg(kind) };
    }
    let arg: Content = [];
    if (this.startsTerm() && !isSpace(this.ch())) arg = this.fracLevel();
    return (nameNodes: Content) => {
      // the function name is the known name at the end of the letters
      const known = FUNC_NAMES.filter((f) => letters.endsWith(f)).sort((a, b) => b.length - a.length)[0] ?? letters;
      const pre = [...letters].slice(0, [...letters].length - [...known].length).join("");
      const plain = nameNodes.every(isRun);
      const nameRun = run(known, { sty: "p" });
      let name: Content = plain ? [nameRun] : nameNodes;
      if (script) {
        const lim = LIMIT_FUNCS.includes(known);
        name = lim
          ? [{ t: script.kind === "_" ? "limLow" : "limUpp", base: [nameRun], lim: script.arg }]
          : [script.kind === "_" ? { t: "sSub", base: [nameRun], sub: script.arg } : { t: "sSup", base: [nameRun], sup: script.arg }];
      }
      return [...(pre && plain ? [run(pre)] : []), { t: "func", name: normalize(name), arg: normalize(arg) }];
    };
  }

  group(): Content {
    const start = this.i;
    const open = this.ch();
    const k = this.findClose(start);
    if (k < 0) {
      this.i++;
      return [charRun(this.peek(-1) as { ch: string })];
    }
    let beg = open;
    let from = start + 1;
    if (open === "├") {
      beg = this.ch(1);
      from = start + 2;
      if (beg === ".") beg = "";
    }
    let end = cellCh(this.cells[k]);
    let next = k + 1;
    if (end === "┤") {
      end = cellCh(this.cells[k + 1]);
      next = k + 2;
      if (end === ".") end = "";
    }
    // pre-scripts: (_a^b)base
    if (beg === "(" && end === ")" && (this.ch(1) === "_" || this.ch(1) === "^")) {
      const p = new Parser(this.cells.slice(from, k));
      p.parens = this.parens;
      const first = p.ch();
      p.i++;
      const a = p.scriptArg(first);
      let b: Content = [run()];
      if (p.ch() === (first === "_" ? "^" : "_")) {
        p.i++;
        b = p.scriptArg(p.ch(-1));
      }
      if (p.i >= p.cells.length) {
        this.i = next;
        const base = this.startsTerm() ? this.scriptLevel() : [];
        const sub = first === "_" ? a : b;
        const sup = first === "_" ? b : a;
        return [{ t: "sPre", sub: normalize(sub), sup: normalize(sup), base: normalize(this.unwrap(base)) }];
      }
    }
    this.i = next;
    const parts = this.splitTop(from, k, "∣");
    const items = parts.map(([a, b]) => this.sub(a, b));
    if (beg === "〖" && end === "〗" && items.length === 1) return items[0];
    const d: MObj = { t: "d", beg, end, sep: "∣", items };
    if (beg === "(" && end === ")") this.parens.add(d);
    return [d];
  }
}

// --- writer ------------------------------------------------------------------

const LIN_OPERATORS = new Set([..."+-−=<>±∓×÷⋅∗∘∙≤≥≠≈≡∼≃≅≍≺≻≼≽⊂⊃⊆⊇⊑⊒∈∋∉∧∨¬⇒⇔→←↔⊕⊗⊖⊙∩∪⊥⊤⊢⊣∣∥∝∖*,;:!/&@"]);
const hasOp = (s: string) => [...s].some((c) => LIN_OPERATORS.has(c) || isOperator(c));
const hasNonOp = (s: string) => [...s].some((c) => !(LIN_OPERATORS.has(c) || isOperator(c)));
const hasSpace = (s: string) => [...s].some(isSpace);
const isOpOrBracket = (c: string) =>
  LIN_OPERATORS.has(c) || isOperator(c) || isOpen(c) || isClose(c) || isLR(c) || isSpace(c);
/** notOpOrBracket mirrors the writer's spacing test (true for undefined). */
const notOpOrBracket = (s: string | undefined) => !s || [...s].every((c) => !isOpOrBracket(c));

/** mixed: whether an argument needs brackets in the linear form. */
export function mixed(c: Content): boolean {
  let op = 0;
  let normal = 0;
  let sp = 0;
  let objs = 0;
  for (const n of c) {
    if (isRun(n)) {
      if (hasOp(n.text)) op = 1;
      if (hasNonOp(n.text)) normal = 1;
      if (hasSpace(n.text)) sp = 1;
    } else {
      objs++;
      if (["f", "sSup", "sSub", "sSubSup", "sPre", "limLow", "limUpp", "func"].includes(n.t)) return true;
    }
    if (op + normal + sp > 1 || objs > 1) return true;
  }
  return false;
}

const onlyBracket = (c: Content) => {
  const items = c.filter((n) => !(isRun(n) && n.text === ""));
  return items.length === 1 && isObj(items[0]) && items[0].t === "d";
};

type Wrap = "none" | "special" | "paren" | "default";

function arg(c: Content, wrap: Wrap = "default", inDelim = false): string {
  const s = toLinear(c);
  if (!s) return s;
  switch (wrap) {
    case "none":
      return s;
    case "special":
      return mixed(c) && !onlyBracket(c) ? `〖${s}〗` : s;
    case "paren": {
      const simple = c.length === 1 && isRun(c[0]) && !hasOp(c[0].text) && !hasSpace(c[0].text);
      return simple ? s : `(${s})`;
    }
    default:
      return !inDelim && mixed(c) && !onlyBracket(c) ? `(${s})` : s;
  }
}

const FRAC_SYM: Record<FracType, string> = { bar: "/", skw: "⁄", lin: "∕", noBar: "¦" };

/** linearOf: the linear text of one run or object. */
export function linearOf(n: MNode): string {
  if (isRun(n)) return n.text;
  switch (n.t) {
    case "f":
      return arg(n.num) + FRAC_SYM[n.type] + arg(n.den);
    case "sSup":
      return arg(n.base) + "^" + arg(n.sup);
    case "sSub":
      return arg(n.base) + "_" + arg(n.sub);
    case "sSubSup":
      return arg(n.base, "special") + "_" + arg(n.sub) + "^" + arg(n.sup);
    case "sPre":
      return "(_" + arg(n.sub) + "^" + arg(n.sup) + ")" + arg(n.base);
    case "rad": {
      const deg = toLinear(n.deg);
      if (!deg.trim()) {
        const b = toLinear(n.base);
        return b.length <= 1 || !b.trim() ? "√" + b : `√(${b})`;
      }
      if (deg === "3" || deg === "4") return (deg === "3" ? "∛" : "∜") + arg(n.base);
      return `√(${deg}&${arg(n.base, "none")})`;
    }
    case "nary": {
      let s = n.chr;
      if (n.sub) s += "_" + arg(n.sub);
      if (n.sup) s += "^" + arg(n.sup);
      const b = toLinear(n.base);
      if (b) s += "▒" + arg(n.base, "special");
      return s;
    }
    case "d": {
      const openOk = n.beg && (isOpen(n.beg) || isLR(n.beg));
      const closeOk = n.end && (isClose(n.end) || isLR(n.end));
      const beg = openOk ? n.beg : "├" + n.beg;
      const end = closeOk ? n.end : "┤" + n.end;
      return beg + n.items.map((it) => arg(it, "default", true)).join("∣") + end;
    }
    case "func":
      return arg(n.name, "none") + "⁡" + arg(n.arg, "special");
    case "limLow":
      return arg(n.base) + "┬" + arg(n.lim);
    case "limUpp":
      return arg(n.base) + "┴" + arg(n.lim);
    case "acc":
      return arg(n.base) + n.chr;
    case "bar":
      return (n.pos === "bot" ? "▁" : "¯") + arg(n.base);
    case "box":
      return "□" + arg(n.base, "paren");
    case "borderBox":
      return "▭" + arg(n.base, "paren");
    case "groupChr":
      return n.chr + (n.chr === "⏞" || n.chr === "⏟" ? "" : n.pos === "top" ? "┴" : "┬") + arg(n.base);
    case "m":
      return "■(" + n.rows.map((r) => r.map((c) => toLinear(c)).join("&")).join("@") + ")";
    case "eqArr":
      return "█(" + n.rows.map((r) => toLinear(r)).join("@") + ")";
    case "phant":
      return "⟡" + arg(n.base, "paren");
  }
}

/** toLinear: the linear (UnicodeMath) text of a content. */
export function toLinear(c: Content): string {
  let s = "";
  for (let i = 0; i < c.length; i++) {
    const n = c[i];
    s += linearOf(n);
    const next = c[i + 1];
    if (isObj(n)) {
      if (isObj(next)) s += " ";
      else if (isRun(next) && isObj(c[i + 2])) {
        if (notOpOrBracket([...next.text][0])) s += " ";
      } else if (isRun(next) && n.t !== "d") {
        if (next.text && notOpOrBracket([...next.text][0])) s += " ";
      }
    } else if (isObj(next) && !["d", "func", "eqArr"].includes(next.t)) {
      if (n.text && notOpOrBracket(n.text)) s += " ";
    }
  }
  return s;
}

