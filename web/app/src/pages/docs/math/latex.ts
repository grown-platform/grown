// LaTeX for Docs equations: a reader (LaTeX -> model), the "LaTeX linear
// view" writer (model -> LaTeX in the compact form Word/OnlyOffice show,
// e.g. \sum_{x}^{2}4, {\frac{1}{2}}^2) and a KaTeX writer (model ->
// standard LaTeX that KaTeX renders).
import { type Content, type MNode, type MObj, type MRun, isObj, isRun, normalize, run } from "./model";
import { MATH_WORDS, NARY_INTEGRALS, isClose, isLR, isOpen, isOperator, isSpace, mathAlpha, plainAlpha } from "./symbols";

// --- symbols -------------------------------------------------------------------

/** LaTeX command -> character, beyond the math autocorrect words. */
const LATEX_SYMBOLS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MATH_WORDS).filter(([, v]) => [...v].length === 1)),
  to: "→", rightarrow: "→", gets: "←", leftarrow: "←", vert: "|", lvert: "|", rvert: "|", Vert: "‖",
  lVert: "‖", rVert: "‖", lbrace: "{", rbrace: "}", langle: "⟨", rangle: "⟩", colon: ":", cdot: "⋅",
  quad: " ", qquad: "  ", ",": " ", ":": " ", ";": " ", "!": "", " ": " ",
  "{": "{", "}": "}", "|": "‖", "#": "#", "%": "%", "&": "&", _: "_", $: "$", lnot: "¬", land: "∧",
  lor: "∨", ne: "≠", mid: "∣", epsilon: "ϵ", varepsilon: "ε", phi: "ϕ", varphi: "φ", hbar: "ℏ",
  dagger: "†", ddagger: "‡", prime: "′", nabla: "∇", Box: "□",
};
// structural words must not become plain symbols
for (const k of ["above", "below", "atop", "begin", "end", "box", "rect", "sqrt", "cbrt", "qdrt", "root", "matrix", "eqarray", "of", "naryand", "funcapply", "open", "close", "left", "right", "over", "overbar", "underbar", "overbrace", "underbrace", "overparen", "underparen", "overbracket", "underbracket", "hat", "tilde", "bar", "Bar", "vec", "dot", "ddot", "dddot", "check", "breve", "acute", "grave", "phantom"])
  delete LATEX_SYMBOLS[k];

/** character -> LaTeX command, for the writers. */
const SYMBOL_NAMES: Record<string, string> = {};
for (const [name, ch] of Object.entries(LATEX_SYMBOLS)) if (/^[A-Za-z]+$/.test(name) && !SYMBOL_NAMES[ch]) SYMBOL_NAMES[ch] = name;
Object.assign(SYMBOL_NAMES, {
  "→": "to", "←": "gets", "≤": "le", "≥": "ge", "≠": "ne", "∈": "in", "∋": "ni", "ϵ": "epsilon",
  "ϕ": "phi", "∣": "mid", "∓": "mp", "⋅": "cdot", "…": "ldots", "⋯": "cdots", " ": "quad",
  "∞": "infty", "′": "prime", "∂": "partial", "∀": "forall", "∃": "exists", "¬": "neg", "∧": "wedge",
  "∨": "vee", "∩": "cap", "∪": "cup", "×": "times", "÷": "div", "±": "pm", "∘": "circ",
});
delete SYMBOL_NAMES["{"];
delete SYMBOL_NAMES["}"];
delete SYMBOL_NAMES["|"];
delete SYMBOL_NAMES["‖"];
delete SYMBOL_NAMES["#"];
delete SYMBOL_NAMES["&"];
for (const c of "()[]<>+-=,.;:!/*'\"") delete SYMBOL_NAMES[c];

const LATEX_NARY: Record<string, string> = {
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", iiiint: "⨌", oint: "∮", oiint: "∯",
  oiiint: "∰", bigcap: "⋂", bigcup: "⋃", bigodot: "⨀", bigoplus: "⨁", bigotimes: "⨂", bigsqcup: "⨆",
  biguplus: "⨄", bigvee: "⋁", bigwedge: "⋀",
};
const NARY_NAMES: Record<string, string> = Object.fromEntries(Object.entries(LATEX_NARY).map(([k, v]) => [v, k]));

const LATEX_ACCENTS: Record<string, string> = {
  dot: "̇", ddot: "̈", dddot: "⃛", acute: "́", grave: "̀", check: "̌",
  breve: "̆", tilde: "̃", widetilde: "̃", bar: "̅", hat: "̂", widehat: "̂",
  vec: "⃗", overrightarrow: "⃗", overleftarrow: "⃖", mathring: "̊",
};
const ACCENT_NAMES: Record<string, string> = {
  "̇": "dot", "̈": "ddot", "⃛": "dddot", "́": "acute", "̀": "grave",
  "̌": "check", "̆": "breve", "̃": "tilde", "̅": "bar", "̂": "hat",
  "⃗": "vec", "⃖": "lvec", "⃑": "hvec", "⃐": "lhvec", "⃡": "overleftrightarrow",
};

const GROUP_CMDS: Record<string, [string, "top" | "bot"]> = {
  overbrace: ["⏞", "top"], underbrace: ["⏟", "bot"], overparen: ["⏜", "top"], underparen: ["⏝", "bot"],
  overbracket: ["⎴", "top"], underbracket: ["⎵", "bot"],
};
const GROUP_NAMES: Record<string, string> = Object.fromEntries(Object.entries(GROUP_CMDS).map(([k, [c]]) => [c, k]));

export const LATEX_FUNCS = [
  "sin", "cos", "tan", "csc", "sec", "cot", "sinh", "cosh", "tanh", "coth", "sech", "csch", "arcsin",
  "arccos", "arctan", "arccot", "arcsec", "arccsc", "exp", "ln", "log", "lg", "lim", "min", "max", "sup",
  "inf", "det", "dim", "gcd", "deg", "arg", "ker", "hom", "Pr", "liminf", "limsup",
];

const FONT_CMDS: Record<string, string> = {
  mathcal: "script", mathscr: "script", mathsf: "sans", sf: "sans", mathit: "italic", mathfrak: "fraktur",
  frak: "fraktur", mathbf: "bold", bf: "bold", mathbb: "double", double: "double", Bbb: "double",
  mathtt: "mono", tt: "mono",
};
/** Alphabet of a mathematical alphanumeric character (for \mathbb{…} etc.). */
function alphabetOf(ch: string): string | null {
  const c = ch.codePointAt(0)!;
  const holes: Record<string, string> = {
    "ℬ": "script", "ℰ": "script", "ℱ": "script", "ℋ": "script", "ℐ": "script", "ℒ": "script", "ℳ": "script",
    "ℛ": "script", "ℯ": "script", "ℊ": "script", "ℴ": "script", "ℭ": "fraktur", "ℌ": "fraktur",
    "ℑ": "fraktur", "ℜ": "fraktur", "ℨ": "fraktur", "ℂ": "double", "ℍ": "double", "ℕ": "double",
    "ℙ": "double", "ℚ": "double", "ℝ": "double", "ℤ": "double", "ℎ": "italic",
  };
  if (holes[ch]) return holes[ch];
  const ranges: Array<[number, string]> = [
    [0x1d400, "bold"], [0x1d434, "italic"], [0x1d468, "bolditalic"], [0x1d49c, "script"],
    [0x1d4d0, "boldscript"], [0x1d504, "fraktur"], [0x1d538, "double"], [0x1d56c, "boldfraktur"],
    [0x1d5a0, "sans"], [0x1d5d4, "sansbold"], [0x1d608, "sansitalic"], [0x1d63c, "sansbolditalic"],
    [0x1d670, "mono"],
  ];
  for (const [start, name] of ranges) if (c >= start && c < start + 52) return name;
  if (c >= 0x1d7ce && c <= 0x1d7d7) return "bold";
  if (c >= 0x1d7d8 && c <= 0x1d7e1) return "double";
  if (c >= 0x1d6e2 && c <= 0x1d71b) return "italic";
  return null;
}
const FONT_OUT: Record<string, string> = {
  script: "mathcal", sans: "mathsf", fraktur: "mathfrak", bold: "mathbf", double: "mathbb", mono: "mathtt",
};

// --- reader --------------------------------------------------------------------

type Tok = { k: "cmd"; v: string } | { k: "ch"; v: string } | { k: "sp" };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "\\") {
      let j = i + 1;
      if (j < chars.length && /[A-Za-z]/.test(chars[j])) {
        while (j < chars.length && /[A-Za-z]/.test(chars[j])) j++;
        let word = chars.slice(i + 1, j).join("");
        if (!knownCommand(word)) {
          // "\lei" is \le followed by "i"
          for (let n = word.length - 1; n > 0; n--)
            if (knownCommand(word.slice(0, n))) {
              j = i + 1 + n;
              word = word.slice(0, n);
              break;
            }
        }
        out.push({ k: "cmd", v: word });
        i = j - 1;
      } else if (j < chars.length) {
        out.push({ k: "cmd", v: chars[j] });
        i = j;
      }
      continue;
    }
    if (/\s/.test(c)) {
      out.push({ k: "sp" });
      continue;
    }
    out.push({ k: "ch", v: c });
  }
  return out;
}

const STRUCT_CMDS = new Set([
  "frac", "dfrac", "tfrac", "cfrac", "sfrac", "binom", "dbinom", "tbinom", "sqrt", "left", "right", "middle",
  "begin", "end", "text", "mathrm", "operatorname", "atop", "above", "below", "underline", "overline",
  "limits", "nolimits", "displaystyle", "textstyle", "boxed", "rect", "phantom", "stackrel", "overset",
  "underset", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr",
]);
function knownCommand(w: string): boolean {
  return (
    STRUCT_CMDS.has(w) ||
    w in LATEX_SYMBOLS ||
    w in LATEX_NARY ||
    w in LATEX_ACCENTS ||
    w in GROUP_CMDS ||
    w in FONT_CMDS ||
    LATEX_FUNCS.includes(w)
  );
}

/** parseLatex reads LaTeX math into model content. */
export function parseLatex(src: string): Content {
  const p = new LatexParser(tokenize(src));
  return normalize(p.seq(new Set()));
}

class LatexParser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  skipSp() {
    while (this.peek()?.k === "sp") this.i++;
  }
  isCh(v: string, t = this.peek()) {
    return !!t && t.k === "ch" && t.v === v;
  }
  isCmd(v: string, t = this.peek()) {
    return !!t && t.k === "cmd" && t.v === v;
  }

  /** seq: until "}" / \right / & / \\ / \end (and the given stops). */
  seq(stops: Set<string>): Content {
    const out: Content = [];
    for (;;) {
      this.skipSp();
      const t = this.peek();
      if (!t) break;
      if (t.k === "ch" && (t.v === "}" || stops.has(t.v))) break;
      if (t.k === "cmd" && (t.v === "right" || t.v === "end" || t.v === "\\" || t.v === "middle" || stops.has("\\" + t.v))) break;
      if (t.k === "cmd" && t.v === "atop") {
        // {a \atop b}
        this.i++;
        const den = this.seq(stops);
        return [{ t: "f", type: "noBar", num: normalize(out), den: normalize(den) }];
      }
      out.push(...this.scripted());
    }
    return out;
  }

  /** An atom with its scripts / \below / \above. */
  scripted(): Content {
    let base = this.atom();
    for (;;) {
      const save = this.i;
      this.skipSp();
      const t = this.peek();
      if (t && t.k === "ch" && (t.v === "^" || t.v === "_")) {
        this.i++;
        const first = this.arg();
        this.skipSp();
        const other = t.v === "^" ? "_" : "^";
        let second: Content | null = null;
        if (this.isCh(other)) {
          this.i++;
          second = this.arg();
        }
        const only = base.filter((n) => !(isRun(n) && n.text === ""));
        if (only.length === 1 && isObj(only[0]) && (only[0].t === "groupChr" || only[0].t === "bar") && !second) {
          base = [{ t: t.v === "^" ? "limUpp" : "limLow", base: normalize(only), lim: first }];
          continue;
        }
        if (only.length === 1 && isObj(only[0]) && only[0].t === "nary" && !only[0].sub && !only[0].sup) {
          const nary = only[0];
          if (t.v === "_") nary.sub = first;
          else nary.sup = first;
          if (second) {
            if (other === "_") nary.sub = second;
            else nary.sup = second;
          }
          base = [nary];
          continue;
        }
        if (second) {
          const sub = t.v === "_" ? first : second;
          const sup = t.v === "^" ? first : second;
          base = [{ t: "sSubSup", base: normalize(base), sub, sup }];
        } else base = [t.v === "^" ? { t: "sSup", base: normalize(base), sup: first } : { t: "sSub", base: normalize(base), sub: first }];
        continue;
      }
      if (t && t.k === "cmd" && (t.v === "below" || t.v === "above")) {
        this.i++;
        const lim = this.arg();
        base = [{ t: t.v === "below" ? "limLow" : "limUpp", base: normalize(base), lim }];
        continue;
      }
      if (t && t.k === "ch" && t.v === "'") {
        this.i++;
        base = [{ t: "sSup", base: normalize(base), sup: [run("′")] }];
        continue;
      }
      this.i = save;
      break;
    }
    return base;
  }

  /** arg: a braced group, a command with its arguments or one character. */
  arg(): Content {
    this.skipSp();
    const t = this.peek();
    if (!t) return [run()];
    if (this.isCh("{")) {
      this.i++;
      const c = this.seq(new Set());
      if (this.isCh("}")) this.i++;
      return normalize(c);
    }
    if (t.k === "ch") {
      if (isOpen(t.v) || isLR(t.v)) {
        const d = this.bareDelimiter();
        if (d) return d;
      }
      this.i++;
      return [run(t.v)];
    }
    return normalize(this.atom());
  }

  group(): Content {
    this.i++; // {
    this.skipSp();
    // pre-scripts {_a^b}Y
    if (this.isCh("_") || this.isCh("^")) {
      const save = this.i;
      const first = this.peek() as { v: string };
      this.i++;
      const a = this.arg();
      this.skipSp();
      let b: Content = [run()];
      const other = first.v === "_" ? "^" : "_";
      if (this.isCh(other)) {
        this.i++;
        b = this.arg();
      }
      this.skipSp();
      if (this.isCh("}")) {
        this.i++;
        const base = this.scripted();
        return [{ t: "sPre", sub: first.v === "_" ? a : b, sup: first.v === "_" ? b : a, base: normalize(base) }];
      }
      this.i = save;
    }
    // {\gets\below{…}} and {\rightarrow\above{…}}: arrows over/under text
    const t = this.peek();
    if (t && t.k === "cmd" && (LATEX_SYMBOLS[t.v] === "←" || LATEX_SYMBOLS[t.v] === "→" || LATEX_SYMBOLS[t.v] === "↔")) {
      const save = this.i;
      this.i++;
      this.skipSp();
      const pos = this.peek();
      if (pos && pos.k === "cmd" && (pos.v === "below" || pos.v === "above")) {
        this.i++;
        const base = this.arg();
        this.skipSp();
        if (this.isCh("}")) {
          this.i++;
          return [{ t: "groupChr", chr: LATEX_SYMBOLS[t.v], pos: pos.v === "below" ? "bot" : "top", base }];
        }
      }
      this.i = save;
    }
    const c = this.seq(new Set());
    if (this.isCh("}")) this.i++;
    return c;
  }

  atom(): Content {
    this.skipSp();
    const t = this.peek();
    if (!t) return [];
    if (t.k === "sp") {
      this.i++;
      return [];
    }
    if (t.k === "ch") {
      if (t.v === "{") return this.group();
      if (isOpen(t.v) || isLR(t.v)) {
        const d = this.bareDelimiter();
        if (d) return d;
      }
      this.i++;
      if (/[0-9]/.test(t.v)) {
        // a number is one operand (10^m)
        let num = t.v;
        while (this.peek()?.k === "ch" && /[0-9.]/.test((this.peek() as { v: string }).v)) num += (this.toks[this.i++] as { v: string }).v;
        return [run(num)];
      }
      return [run(t.v)];
    }
    if (t.v === "{") {
      const d = this.bareDelimiter();
      if (d) return d;
    }
    const v = t.v;
    this.i++;
    if (v === "frac" || v === "dfrac" || v === "tfrac" || v === "cfrac" || v === "sfrac") {
      const num = this.arg();
      const den = this.arg();
      return [{ t: "f", type: v === "sfrac" ? "skw" : "bar", num, den }];
    }
    if (v === "binom" || v === "dbinom" || v === "tbinom") {
      const num = this.arg();
      const den = this.arg();
      return [{ t: "d", beg: "(", end: ")", sep: "∣", items: [normalize([{ t: "f", type: "noBar", num, den }])] }];
    }
    if (v === "sqrt") {
      let deg: Content = [run()];
      this.skipSp();
      if (this.isCh("[")) {
        this.i++;
        deg = normalize(this.seq(new Set(["]"])));
        if (this.isCh("]")) this.i++;
      }
      this.skipSp();
      const base = this.peek() ? this.arg() : [run()];
      return [{ t: "rad", deg, base }];
    }
    if (v in LATEX_ACCENTS) return [{ t: "acc", chr: LATEX_ACCENTS[v], base: this.arg() }];
    if (v === "overline") return [{ t: "bar", pos: "top", base: this.arg() }];
    if (v === "underline") return [{ t: "bar", pos: "bot", base: this.arg() }];
    if (v in GROUP_CMDS) {
      const [chr, pos] = GROUP_CMDS[v];
      return [{ t: "groupChr", chr, pos, base: this.arg() }];
    }
    if (v === "boxed" || v === "rect") return [{ t: "borderBox", base: this.arg() }];
    if (v === "phantom") return [{ t: "phant", base: this.arg() }];
    if (v === "overset" || v === "stackrel") {
      const lim = this.arg();
      return [{ t: "limUpp", base: this.arg(), lim }];
    }
    if (v === "underset") {
      const lim = this.arg();
      return [{ t: "limLow", base: this.arg(), lim }];
    }
    if (v === "text" || v === "mbox" || v === "textrm") return [run(this.rawGroup(), { nor: true, sty: "p" })];
    if (v === "mathrm") return this.styled((ch) => ch, "p");
    if (v in FONT_CMDS) return this.styled((ch) => mathAlpha(FONT_CMDS[v], ch));
    if (v === "operatorname") {
      const name = this.rawGroup();
      return this.func([run(name, { sty: "p" })], false);
    }
    if (LATEX_FUNCS.includes(v)) return this.func([run(v, { sty: "p" })], true);
    if (v in LATEX_NARY) {
      const chr = LATEX_NARY[v];
      let sub: Content | null = null;
      let sup: Content | null = null;
      for (let k = 0; k < 2; k++) {
        this.skipSp();
        if (this.isCmd("limits") || this.isCmd("nolimits")) this.i++;
        if (this.isCh("_") && !sub) {
          this.i++;
          sub = this.arg();
        } else if (this.isCh("^") && !sup) {
          this.i++;
          sup = this.arg();
        }
      }
      this.skipSp();
      const base = this.peek() && !this.isCh("}") && !this.isCmd("right") ? this.scripted() : [];
      return [{ t: "nary", chr, limLoc: NARY_INTEGRALS.includes(chr) ? "subSup" : "undOvr", sub, sup, base: normalize(base) }];
    }
    if (v === "left") return this.leftRight();
    if (v === "begin") return this.environment();
    if (v in LATEX_SYMBOLS) return [run(LATEX_SYMBOLS[v])];
    if (["displaystyle", "textstyle", "limits", "nolimits", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr"].includes(v)) return [];
    return [run("\\" + v)];
  }

  /** The raw text of a {…} argument (for \text, \operatorname). */
  rawGroup(): string {
    this.skipSp();
    if (!this.isCh("{")) {
      const t = this.peek();
      this.i++;
      return t && t.k === "ch" ? t.v : "";
    }
    this.i++;
    let s = "";
    let depth = 0;
    while (this.peek()) {
      const t = this.peek()!;
      if (t.k === "ch" && t.v === "}" && depth === 0) break;
      if (t.k === "ch" && t.v === "{") depth++;
      if (t.k === "ch" && t.v === "}") depth--;
      s += t.k === "sp" ? " " : t.k === "ch" ? t.v : "\\" + t.v;
      this.i++;
    }
    this.i++;
    return s;
  }

  styled(map: (ch: string) => string, sty?: MRun["sty"]): Content {
    const text = [...this.rawGroup().replace(/\s+/g, "")].map(map).join("");
    return [sty ? run(text, { sty }) : run(text)];
  }

  func(name: Content, _known: boolean): Content {
    void _known;
    let nm = name;
    for (;;) {
      this.skipSp();
      const t = this.peek();
      if (t && t.k === "ch" && (t.v === "_" || t.v === "^")) {
        this.i++;
        const a = this.arg();
        this.skipSp();
        const other = t.v === "_" ? "^" : "_";
        if (this.isCh(other)) {
          this.i++;
          const b = this.arg();
          nm = [{ t: "sSubSup", base: normalize(nm), sub: t.v === "_" ? a : b, sup: t.v === "_" ? b : a }];
        } else nm = [t.v === "_" ? { t: "sSub", base: normalize(nm), sub: a } : { t: "sSup", base: normalize(nm), sup: a }];
        continue;
      }
      if (t && t.k === "cmd" && (t.v === "below" || t.v === "above" || t.v === "limits" || t.v === "nolimits")) {
        this.i++;
        if (t.v === "limits" || t.v === "nolimits") continue;
        const lim = this.arg();
        nm = [{ t: t.v === "below" ? "limLow" : "limUpp", base: normalize(nm), lim }];
        continue;
      }
      break;
    }
    this.skipSp();
    let arg: Content = [];
    const t = this.peek();
    if (t && !(t.k === "ch" && (t.v === "}" || t.v === "&" || isOperator(t.v))) && !(t.k === "cmd" && (t.v === "right" || t.v === "\\" || t.v === "end")))
      arg = this.scripted();
    return [{ t: "func", name: normalize(nm), arg: normalize(arg) }];
  }

  /** delimiterChar reads the bracket after \left or \right. */
  delimiterChar(): string {
    this.skipSp();
    const t = this.peek();
    if (!t) return "";
    this.i++;
    if (t.k === "ch") return t.v === "." ? "" : t.v;
    const map: Record<string, string> = {
      "{": "{", "}": "}", "|": "‖", vert: "|", lvert: "|", rvert: "|", Vert: "‖", lVert: "‖", rVert: "‖",
      langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋", lbrace: "{",
      rbrace: "}", lbrack: "[", rbrack: "]",
    };
    return t.k === "cmd" ? map[t.v] ?? "" : "";
  }

  leftRight(): Content {
    const beg = this.delimiterChar();
    const items: Content[] = [];
    let cur: Content = [];
    for (;;) {
      cur.push(...this.seq(new Set()));
      if (this.isCmd("middle")) {
        this.i++;
        this.delimiterChar();
        items.push(normalize(cur));
        cur = [];
        continue;
      }
      break;
    }
    items.push(normalize(cur));
    let end = "";
    if (this.isCmd("right")) {
      this.i++;
      end = this.delimiterChar();
    }
    return [{ t: "d", beg, end, sep: "∣", items }];
  }

  /** bare brackets pair up like in the linear format: (…), […], |…|, \{…\}. */
  bareDelimiter(): Content | null {
    const start = this.i;
    const open = (this.peek() as { v: string }).v;
    const isBr = (t: Tok, f: (c: string) => boolean) => (t.k === "ch" && t.v !== "{" && t.v !== "}" && f(t.v)) || (t.k === "cmd" && (t.v === "{" || t.v === "}") && f(t.v));
    // find the matching closer at the same brace depth
    let depth = 0;
    let j = start + 1;
    let nest = 0;
    for (; j < this.toks.length; j++) {
      const t = this.toks[j];
      if (t.k === "ch" && t.v === "{") depth++;
      else if (t.k === "ch" && t.v === "}") {
        if (depth === 0) return null;
        depth--;
      } else if (depth === 0 && (t.k === "ch" || (t.k === "cmd" && (t.v === "{" || t.v === "}")))) {
        if (isBr(t, isOpen) && !isLR(open)) nest++;
        else if (isBr(t, isClose) || isBr(t, isLR)) {
          if (nest > 0 && isBr(t, isClose)) nest--;
          else break;
        }
      } else if (t.k === "cmd" && (t.v === "left")) depth++;
      else if (t.k === "cmd" && t.v === "right") depth--;
    }
    if (j >= this.toks.length) return null;
    const inner = new LatexParser(this.toks.slice(start + 1, j));
    const c = inner.seq(new Set());
    this.i = j + 1;
    return [{ t: "d", beg: open, end: (this.toks[j] as { v: string }).v, sep: "∣", items: [normalize(c)] }];
  }

  environment(): Content {
    const name = this.rawGroup();
    if (name === "array") this.rawGroup(); // column spec
    const rows: Content[][] = [];
    let row: Content[] = [];
    for (;;) {
      const cell = normalize(this.seq(new Set(["&"])));
      row.push(cell);
      if (this.isCh("&")) {
        this.i++;
        continue;
      }
      if (this.isCmd("\\")) {
        this.i++;
        rows.push(row);
        row = [];
        this.skipSp();
        if (this.isCmd("end")) break;
        continue;
      }
      break;
    }
    if (row.length > 1 || (row.length === 1 && row[0].some((n) => !isRun(n) || n.text))) rows.push(row);
    if (this.isCmd("end")) {
      this.i++;
      this.rawGroup();
    }
    const cols = Math.max(1, ...rows.map((r) => r.length));
    for (const r of rows) while (r.length < cols) r.push([run()]);
    const m: MObj = { t: "m", rows: rows.length ? rows : [[[run()]]] };
    const wrap: Record<string, [string, string]> = {
      pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"],
      cases: ["{", ""],
    };
    if (wrap[name]) return [{ t: "d", beg: wrap[name][0], end: wrap[name][1], sep: "∣", items: [normalize([m])] }];
    return [m];
  }
}

// --- writer (LaTeX linear view) ------------------------------------------------

const FUNC_OBJS = new Set(["f", "sSup", "sSub", "sSubSup", "limLow", "limUpp", "func"]);
function mixedL(c: Content): boolean {
  let op = 0;
  let normal = 0;
  let sp = 0;
  for (const n of c) {
    if (isRun(n)) {
      if ([...n.text].some((x) => isOperator(x))) op = 1;
      if ([...n.text].some((x) => !isOperator(x))) normal = 1;
      if ([...n.text].some((x) => isSpace(x))) sp = 1;
    } else {
      if (n.t === "d") return false;
      if (FUNC_OBJS.has(n.t)) return true;
    }
    if (op + normal + sp > 1) return true;
  }
  return false;
}

/** wrap: 0 none, 1 when mixed or longer than one character, 2 always. */
function argL(c: Content, wrap: 0 | 1 | 2, notWrap = false): string {
  const s = latexContent(c);
  if (!s) return wrap === 2 ? "{}" : "";
  if (wrap === 2) return `{${s}}`;
  if (wrap === 1 && (mixedL(c) || (!notWrap && [...s].length > 1))) return `{${s}}`;
  return s;
}

let inFuncName = 0;
function runLatex(r: MRun): string {
  if (r.nor) return `\\text{${r.text}}`;
  if (r.sty === "p" && r.text && /^[A-Za-z]+$/.test(r.text) && !inFuncName) return `\\mathrm{${r.text}}`;
  let s = "";
  let font: string | null = null;
  let buf = "";
  const flush = () => {
    if (buf) s += font && FONT_OUT[font] ? `\\${FONT_OUT[font]}{${buf}}` : buf;
    buf = "";
  };
  for (const ch of r.text) {
    const a = alphabetOf(ch);
    const f = a && a !== "italic" ? a : null;
    if (f !== font) {
      flush();
      font = f;
    }
    if (f) {
      buf += plainAlpha(ch);
      continue;
    }
    if (ch === " ") buf += "\\ ";
    else if (ch === "{" || ch === "}") buf += "\\" + ch;
    else if (SYMBOL_NAMES[ch]) buf += "\\" + SYMBOL_NAMES[ch];
    else buf += ch;
  }
  flush();
  return s;
}

function bracketL(ch: string, open: boolean): string {
  if (!ch) return ".";
  if (ch === "{" || ch === "}") return "\\" + ch;
  const names: Record<string, string> = { "⟨": "\\langle", "⟩": "\\rangle", "⌈": "\\lceil", "⌉": "\\rceil", "⌊": "\\lfloor", "⌋": "\\rfloor", "‖": "\\|" };
  void open;
  return names[ch] ?? ch;
}

function funcNameL(name: Content): string {
  inFuncName++;
  let s: string;
  try {
    s = latexContent(name);
  } finally {
    inFuncName--;
  }
  const bare = s.split("_")[0].split("^")[0].split("\\below")[0].split("\\above")[0];
  return LATEX_FUNCS.includes(bare) ? "\\" + s : s;
}

/** latexOf: the LaTeX linear text of one run or object. */
export function latexOf(n: MNode, onlyChild = false): string {
  if (isRun(n)) return runLatex(n);
  switch (n.t) {
    case "f":
      if (n.type === "noBar" && !onlyChild) return `{${argL(n.num, 1)}\\atop${argL(n.den, 1)}}`;
      return (n.type === "noBar" ? "\\binom" : n.type === "bar" ? "\\frac" : "\\sfrac") + argL(n.num, 2) + argL(n.den, 2);
    case "sSup":
      return argL(n.base, 1, true) + "^" + argL(n.sup, 1);
    case "sSub":
      return argL(n.base, 1, true) + "_" + argL(n.sub, 1);
    case "sSubSup":
      return argL(n.base, 1, true) + "_" + argL(n.sub, 1) + "^" + argL(n.sup, 1);
    case "sPre":
      return "{_" + latexContent(n.sub) + "^" + latexContent(n.sup) + "}" + latexContent(n.base);
    case "rad": {
      const deg = latexContent(n.deg);
      const base = latexContent(n.base);
      return "\\sqrt" + (deg ? `[${deg}]` : "") + (base.trim() ? argL(n.base, 1) : "");
    }
    case "nary": {
      let s = "\\" + (NARY_NAMES[n.chr] ?? "int");
      if (n.sub) s += "_" + argL(n.sub, 2);
      if (n.sup) s += "^" + argL(n.sup, 2);
      return s + argL(n.base, 1);
    }
    case "d": {
      const only = n.items.length === 1 ? n.items[0].filter((x) => !(isRun(x) && x.text === "")) : [];
      if (n.beg === "(" && n.end === ")" && only.length === 1 && isObj(only[0]) && only[0].t === "f" && only[0].type === "noBar")
        return latexOf(only[0], true);
      return "\\left" + bracketL(n.beg, true) + n.items.map((it) => latexContent(it)).join("\\mid") + "\\right" + bracketL(n.end, false);
    }
    case "func":
      return funcNameL(n.name) + argL(n.arg, 2);
    case "limLow":
      return latexContent(n.base) + "\\below" + argL(n.lim, 2);
    case "limUpp":
      return latexContent(n.base) + "\\above" + argL(n.lim, 2);
    case "acc":
      return "\\" + (ACCENT_NAMES[n.chr] ?? "hat") + argL(n.base, 2);
    case "bar":
      return (n.pos === "bot" ? "\\underline" : "\\overline") + argL(n.base, 2);
    case "box":
      return argL(n.base, 2);
    case "borderBox":
      return "\\rect" + argL(n.base, 1);
    case "groupChr": {
      if (GROUP_NAMES[n.chr]) return "\\" + GROUP_NAMES[n.chr] + argL(n.base, 2);
      const arrow = n.chr === "←" ? "\\gets" : n.chr === "→" ? "\\rightarrow" : "\\" + (SYMBOL_NAMES[n.chr] ?? "rightarrow");
      return "{" + arrow + (n.pos === "top" ? "\\above" : "\\below") + argL(n.base, 1) + "}";
    }
    case "m":
      return "\\begin{matrix}" + n.rows.map((r) => r.map(latexContent).join("&") + "\\\\").join("") + "\\end{matrix}";
    case "eqArr":
      return "\\begin{array}{c}" + n.rows.map((r) => latexContent(r) + "\\\\").join("") + "\\end{array}";
    case "phant":
      return "\\phantom" + argL(n.base, 2);
  }
}

/** latexContent: LaTeX linear text of a content. */
export function latexContent(c: Content): string {
  return c.map((n) => latexOf(n)).join("");
}

// --- KaTeX writer ----------------------------------------------------------------

const KATEX_BRACKETS: Record<string, string> = {
  "(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "|", "‖": "\\Vert", "⟨": "\\langle",
  "⟩": "\\rangle", "⌈": "\\lceil", "⌉": "\\rceil", "⌊": "\\lfloor", "⌋": "\\rfloor", "⟦": "[\\![",
  "⟧": "]\\!]", "〖": ".", "〗": ".", "": ".",
};
const KATEX_ACCENTS: Record<string, string> = {
  "̇": "dot", "̈": "ddot", "⃛": "dddot", "́": "acute", "̀": "grave", "̌": "check",
  "̆": "breve", "̃": "tilde", "̅": "overline", "̿": "overline", "̂": "hat",
  "⃗": "vec", "⃖": "overleftarrow", "⃑": "overrightharpoon", "⃐": "overleftharpoon",
  "⃡": "overleftrightarrow", "̲": "underline", "̳": "underline", "̊": "mathring",
};
/** LaTeX names KaTeX knows, for the characters that have one. */
const KATEX_NAMES = new Set(
  (
    "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega " +
    "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega pm mp times div cdot le ge ne approx equiv sim simeq cong propto infty partial nabla forall exists neg " +
    "wedge vee cap cup subset supset subseteq supseteq in notin ni to gets leftarrow rightarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto uparrow downarrow " +
    "updownarrow Uparrow Downarrow longrightarrow longleftarrow Longrightarrow Longleftarrow ldots cdots vdots ddots circ ast star bullet oplus ominus otimes odot oslash " +
    "perp parallel mid angle emptyset aleph beth gimel hbar ell Re Im wp langle rangle lceil rceil lfloor rfloor setminus because therefore models vdash dashv top bot " +
    "prec succ preceq succeq ll gg asymp doteq sqcap sqcup sqsubseteq sqsupseteq uplus amalg diamond triangle nearrow searrow swarrow nwarrow hookleftarrow hookrightarrow " +
    "leftharpoonup leftharpoondown rightharpoonup rightharpoondown smile frown clubsuit diamondsuit heartsuit spadesuit imath jmath coprod bigcap bigcup bigodot bigoplus bigotimes bigsqcup biguplus bigvee bigwedge"
  ).split(" "),
);
const KATEX_SYMBOLS: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_NAMES)
    .filter(([, v]) => KATEX_NAMES.has(v))
    .map(([k, v]) => [k, "\\" + v + " "]),
);
Object.assign(KATEX_SYMBOLS, {
  "∣": "\\mid ", "¦": "\\,", "▒": "", "⁡": "", "⁢": "", "⁣": "", "⁤": "", "​": "",
  "#": "\\#", "%": "\\%", "&": "\\&", $: "\\$", _: "\\_", "\\": "\\backslash ", "^": "\\hat{}", "~": "\\sim ",
  "{": "\\{", "}": "\\}", " ": "\\ ", " ": "~", " ": "\\quad ", " ": "\\enspace ",
  " ": "\\;", " ": "\\:", " ": "\\,", " ": "\\,", " ": "\\,", "\t": "\\quad ",
  "′": "'", "″": "''", "‴": "'''", "−": "-", "□": "\\square ", "▭": "\\boxed{}", "■": "\\blacksquare ",
  "┴": "", "┬": "", "├": "", "┤": "", "〖": "", "〗": "",
});

function kArg(c: Content): string {
  return "{" + toKatex(c) + "}";
}

function kRun(r: MRun): string {
  if (r.nor) return `\\text{${r.text.replace(/[\\{}$&#%_^~]/g, (m) => "\\" + m)}}`;
  let s = "";
  for (const ch of r.text) {
    if (KATEX_SYMBOLS[ch] !== undefined) s += KATEX_SYMBOLS[ch];
    else if (isCombiningMark(ch)) s = `\\${KATEX_ACCENTS[ch] ?? "hat"}{${s}}`;
    else {
      const a = alphabetOf(ch);
      if (a && a !== "italic" && FONT_OUT[a]) s += `\\${FONT_OUT[a]}{${plainAlpha(ch)}}`;
      else if (a === "italic") s += plainAlpha(ch);
      else s += ch;
    }
  }
  return r.sty === "p" && /^[A-Za-z]+$/.test(r.text) ? `\\mathrm{${r.text}}` : s;
}
const isCombiningMark = (c: string) => {
  const p = c.codePointAt(0)!;
  return (p >= 0x300 && p <= 0x36f) || (p >= 0x20d0 && p <= 0x20ff);
};

function kNode(n: MNode): string {
  if (isRun(n)) return kRun(n);
  switch (n.t) {
    case "f":
      if (n.type === "bar") return `\\frac${kArg(n.num)}${kArg(n.den)}`;
      if (n.type === "noBar") return `\\genfrac{}{}{0pt}{}${kArg(n.num)}${kArg(n.den)}`;
      if (n.type === "skw") return `{}^{${toKatex(n.num)}}\\!/\\!{}_{${toKatex(n.den)}}`;
      return `${kArg(n.num)}/${kArg(n.den)}`;
    case "sSup":
      return `${kArg(n.base)}^${kArg(n.sup)}`;
    case "sSub":
      return `${kArg(n.base)}_${kArg(n.sub)}`;
    case "sSubSup":
      return `${kArg(n.base)}_${kArg(n.sub)}^${kArg(n.sup)}`;
    case "sPre":
      return `{}_${kArg(n.sub)}^${kArg(n.sup)}${kArg(n.base)}`;
    case "rad": {
      const deg = toKatex(n.deg);
      return `\\sqrt${deg ? `[{${deg}}]` : ""}${kArg(n.base)}`;
    }
    case "nary": {
      const name = NARY_NAMES[n.chr] ?? "int";
      let s = `\\${name}` + (n.limLoc === "undOvr" ? "\\limits" : "\\nolimits");
      if (n.sub) s += `_${kArg(n.sub)}`;
      if (n.sup) s += `^${kArg(n.sup)}`;
      return s + " " + toKatex(n.base);
    }
    case "d": {
      const beg = KATEX_BRACKETS[n.beg] ?? n.beg;
      const end = KATEX_BRACKETS[n.end] ?? n.end;
      return `\\left${beg}` + n.items.map(toKatex).join("\\mid ") + `\\right${end}`;
    }
    case "func": {
      const only = n.name.filter((x) => !(isRun(x) && x.text === ""));
      const plainName = only.length === 1 && isRun(only[0]) ? only[0].text : null;
      let name: string;
      if (plainName !== null) name = LATEX_FUNCS.includes(plainName) ? `\\${plainName}` : `\\operatorname{${plainName}}`;
      else if (only.length === 1 && isObj(only[0]) && (only[0].t === "limLow" || only[0].t === "limUpp")) {
        const o = only[0];
        const base = toLinearName(o.base);
        name = (LATEX_FUNCS.includes(base) ? `\\${base}` : `\\operatorname*{${base}}`) + `\\limits${o.t === "limLow" ? "_" : "^"}${kArg(o.lim)}`;
      } else name = toKatex(n.name);
      return `${name}{${toKatex(n.arg)}}`;
    }
    case "limLow":
      return `\\underset${kArg(n.lim)}${kArg(n.base)}`;
    case "limUpp":
      return `\\overset${kArg(n.lim)}${kArg(n.base)}`;
    case "acc":
      return `\\${KATEX_ACCENTS[n.chr] ?? "hat"}${kArg(n.base)}`;
    case "bar":
      return `\\${n.pos === "bot" ? "underline" : "overline"}${kArg(n.base)}`;
    case "box":
      return kArg(n.base);
    case "borderBox":
      return `\\boxed${kArg(n.base)}`;
    case "groupChr": {
      const brace: Record<string, string> = { "⏞": "overbrace", "⏟": "underbrace", "⏜": "overgroup", "⏝": "undergroup", "⎴": "overbrace", "⎵": "underbrace" };
      if (brace[n.chr]) return `\\${brace[n.chr]}${kArg(n.base)}`;
      const sym = KATEX_SYMBOLS[n.chr] ?? n.chr;
      return n.pos === "top" ? `\\overset${kArg(n.base)}{${sym}}` : `\\underset${kArg(n.base)}{${sym}}`;
    }
    case "m":
      return "\\begin{matrix}" + n.rows.map((r) => r.map(toKatex).join(" & ")).join(" \\\\ ") + "\\end{matrix}";
    case "eqArr":
      return "\\begin{array}{c}" + n.rows.map(toKatex).join(" \\\\ ") + "\\end{array}";
    case "phant":
      return `\\phantom${kArg(n.base)}`;
  }
}

function toLinearName(c: Content): string {
  return c.map((n) => (isRun(n) ? n.text : "")).join("");
}

/** toKatex: standard LaTeX for KaTeX. Limits of a limit-style function name
 *  (lim, max) sit under it; objects nest in braces. */
export function toKatex(c: Content): string {
  let s = "";
  for (const n of c) {
    const part = kNode(n);
    // keep a command name from running into the next letter
    if (/\\[A-Za-z]+$/.test(s) && /^[A-Za-z]/.test(part)) s += " ";
    s += part;
  }
  return s;
}

