// Character classes and the math autocorrect word list used by the linear
// format (UnicodeMath, as typed in Word) and the LaTeX reader/writer.
// The word -> symbol pairs are Unicode facts (Word's default "Math
// AutoCorrect" list uses the same names).

/** \word -> replacement typed in an equation (Unicode linear input). */
export const MATH_WORDS: Record<string, string> = {
  // Greek
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", o: "ο",
  pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ",
  phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ", Eta: "Η", Theta: "Θ",
  Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ", Nu: "Ν", Xi: "Ξ", O: "Ο", Pi: "Π", Rho: "Ρ",
  Sigma: "Σ", Tau: "Τ", Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
  // structure
  above: "┴", below: "┬", atop: "¦", begin: "〖", end: "〗", box: "□", rect: "▭", sqrt: "√",
  cbrt: "∛", qdrt: "∜", root: "⒭", matrix: "■", eqarray: "█", of: "▒", naryand: "▒", funcapply: "⁡",
  open: "├", close: "┤", left: "├", right: "┤", over: "/", sdiv: "⁄", sdivide: "⁄", ldiv: "∕",
  ldivide: "∕", ndiv: "⊘", mid: "∣", overbar: "¯", underbar: "▁", overbrace: "⏞", underbrace: "⏟",
  overparen: "⏜", underparen: "⏝", overbracket: "⎴", underbracket: "⎵", overshell: "⏠",
  undershell: "⏡", phantom: "⟡", hphantom: "⬄", vphantom: "⇳", smash: "⬍", asmash: "⬆",
  dsmash: "⬇", hsmash: "⬌", eqno: "#", pmatrix: "⒨", vmatrix: "⒱", Vmatrix: "⒩", bmatrix: "ⓢ",
  // accents (combining)
  acute: "́", grave: "̀", hat: "̂", tilde: "̃", bar: "̅", Bar: "̿",
  breve: "̆", dot: "̇", ddot: "̈", dddot: "⃛", ddddot: "⃜", check: "̌",
  ubar: "̲", Ubar: "̳", vec: "⃗", hvec: "⃑", lhvec: "⃐", rhvec: "⃑",
  lvec: "⃖", tvec: "⃡",
  prime: "′", pprime: "″", ppprime: "‴", pppprime: "⁗",
  // big operators
  sum: "∑", prod: "∏", coprod: "∐", amalg: "∐", int: "∫", iint: "∬", iiint: "∭", iiiint: "⨌",
  oint: "∮", oiint: "∯", oiiint: "∰", coint: "∲", aoint: "∳", bigcap: "⋂", bigcup: "⋃",
  bigodot: "⨀", bigoplus: "⨁", bigotimes: "⨂", bigsqcup: "⨆", biguplus: "⨄", bigvee: "⋁",
  bigwedge: "⋀",
  // relations and operators
  approx: "≈", asymp: "≍", ast: "∗", because: "∵", therefore: "∴", bot: "⊥", top: "⊤", bowtie: "⋈",
  boxdot: "⊡", boxminus: "⊟", boxplus: "⊞", bullet: "∙", cap: "∩", cup: "∪", cdot: "⋅", cdots: "⋯",
  circ: "∘", cong: "≅", contain: "∋", ni: "∋", dashv: "⊣", ddots: "⋱", rddots: "⋰", vdots: "⋮",
  dots: "…", ldots: "…", defeq: "≝", diamond: "⋄", div: "÷", doteq: "≐", equiv: "≡", ge: "≥",
  geq: "≥", gets: "←", gg: "≫", ll: "≪", in: "∈", notin: "∉", notelement: "∉", le: "≤", leq: "≤",
  mp: "∓", pm: "±", models: "⊨", ne: "≠", neq: "≠", neg: "¬", odot: "⊙", ominus: "⊖", oplus: "⊕",
  oslash: "⊘", otimes: "⊗", parallel: "∥", perp: "⊥", prec: "≺", preceq: "⪯", preccurlyeq: "≼",
  prcue: "≼", propto: "∝", ratio: "∶", setminus: "∖", sim: "∼", simeq: "≃", smile: "⌣",
  frown: "⌢", sqcap: "⊓", sqcup: "⊔", sqsubseteq: "⊑", sqsuperseteq: "⊒", sqsupseteq: "⊒",
  star: "⋆", subset: "⊂", subseteq: "⊆", succ: "≻", succeq: "⪰", superset: "⊃", supset: "⊃",
  superseteq: "⊇", supseteq: "⊇", times: "×", uplus: "⊎", vdash: "⊢", vee: "∨", wedge: "∧",
  wr: "≀", exists: "∃", forall: "∀", nabla: "∇", partial: "∂", infty: "∞", emptyset: "∅",
  angle: "∠", degree: "°", degc: "℃", degf: "℉", inc: "∆", norm: "‖", vert: "|", Vert: "‖",
  vbar: "│",
  // arrows
  to: "→", rightarrow: "→", leftarrow: "←", uparrow: "↑", downarrow: "↓", leftrightarrow: "↔",
  updownarrow: "↕", Rightarrow: "⇒", Leftarrow: "⇐", Uparrow: "⇑", Downarrow: "⇓",
  Leftrightarrow: "⇔", Updownarrow: "⇕", longrightarrow: "⟶", longleftarrow: "⟵",
  longleftrightarrow: "⟷", Longrightarrow: "⟹", Longleftarrow: "⟸", Longleftrightarrow: "⟺",
  mapsto: "↦", nearrow: "↗", nwarrow: "↖", searrow: "↘", swarrow: "↙", hookleftarrow: "↩",
  hookrightarrow: "↪", leftharpoonup: "↼", leftharpoondown: "↽", rightharpoonup: "⇀",
  rightharpoondown: "⇁", lrhar: "⇋", rlhar: "⇌",
  // brackets
  langle: "⟨", rangle: "⟩", bra: "⟨", ket: "⟩", lbrace: "{", rbrace: "}", lbrack: "[", rbrack: "]",
  lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋", lbbrack: "⟦", Rbrack: "⟧", rbbrack: "⟧",
  lmoust: "⎰", rmoust: "⎱",
  // letters
  aleph: "ℵ", beth: "ℶ", gimel: "ℷ", daleth: "ℸ", hbar: "ℏ", ell: "ℓ", wp: "℘", Re: "ℜ", Im: "ℑ",
  imath: "ı", jmath: "ȷ", ii: "ⅈ", jj: "ⅉ", ee: "ⅇ", dd: "ⅆ", Dd: "ⅅ",
  clubsuit: "♣", diamondsuit: "♢", heartsuit: "♡", spadesuit: "♠",
  // spaces
  emsp: " ", ensp: " ", thicksp: " ", medsp: " ", thinsp: " ",
  vthicksp: " ", hairsp: " ", nbsp: " ", zwsp: "​", zwnj: "‌",
  // templates
  binomial: "(a+b)^n=∑_(k=0)^n ▒(n¦k)a^k b^(n-k)",
};

/** Two-character sequences corrected as soon as the second one is typed. */
export const MATH_SEQUENCES: Record<string, string> = {
  "->": "→", "<-": "←", "<=": "≤", ">=": "≥", "!=": "≠", "+-": "±", "-+": "∓", ":=": "≔",
  "~=": "≅", "<<": "≪", ">>": "≫",
};

const ALPHA_BASE: Record<string, number> = {
  // style: [capital A, small a] code points in the Mathematical Alphanumeric block
  bold: 0x1d400, italic: 0x1d434, bolditalic: 0x1d468, script: 0x1d49c, boldscript: 0x1d4d0,
  fraktur: 0x1d504, double: 0x1d538, boldfraktur: 0x1d56c, sans: 0x1d5a0, sansbold: 0x1d5d4,
  sansitalic: 0x1d608, sansbolditalic: 0x1d63c, mono: 0x1d670,
};
const ALPHA_HOLES: Record<string, string> = {
  "italic:h": "ℎ", "script:B": "ℬ", "script:E": "ℰ", "script:F": "ℱ", "script:H": "ℋ", "script:I": "ℐ",
  "script:L": "ℒ", "script:M": "ℳ", "script:R": "ℛ", "script:e": "ℯ", "script:g": "ℊ", "script:o": "ℴ",
  "fraktur:C": "ℭ", "fraktur:H": "ℌ", "fraktur:I": "ℑ", "fraktur:R": "ℜ", "fraktur:Z": "ℨ",
  "double:C": "ℂ", "double:H": "ℍ", "double:N": "ℕ", "double:P": "ℙ", "double:Q": "ℚ", "double:R": "ℝ",
  "double:Z": "ℤ",
};
const DIGIT_BASE: Record<string, number> = { bold: 0x1d7ce, double: 0x1d7d8, sans: 0x1d7e2, sansbold: 0x1d7ec, mono: 0x1d7f6 };
const GREEK_ITALIC_SMALL = 0x1d6fc; // 𝛼
const GREEK_ITALIC_CAP = 0x1d6e2; // 𝛢

/** mathAlpha maps a Latin letter or digit to a Mathematical Alphanumeric symbol. */
export function mathAlpha(style: string, ch: string): string {
  const hole = ALPHA_HOLES[`${style}:${ch}`];
  if (hole) return hole;
  const c = ch.codePointAt(0)!;
  if (c >= 65 && c <= 90 && ALPHA_BASE[style]) return String.fromCodePoint(ALPHA_BASE[style] + c - 65);
  if (c >= 97 && c <= 122 && ALPHA_BASE[style]) return String.fromCodePoint(ALPHA_BASE[style] + 26 + c - 97);
  if (c >= 48 && c <= 57 && DIGIT_BASE[style]) return String.fromCodePoint(DIGIT_BASE[style] + c - 48);
  if (style === "italic" && c >= 0x3b1 && c <= 0x3c9) return String.fromCodePoint(GREEK_ITALIC_SMALL + c - 0x3b1);
  if (style === "italic" && c >= 0x391 && c <= 0x3a9) return String.fromCodePoint(GREEK_ITALIC_CAP + c - 0x391);
  return ch;
}

/** plainAlpha is the inverse of mathAlpha (styled letter -> ASCII / Greek). */
export function plainAlpha(ch: string): string {
  for (const [k, v] of Object.entries(ALPHA_HOLES)) if (v === ch) return k.split(":")[1];
  const c = ch.codePointAt(0)!;
  if (c >= 0x1d400 && c <= 0x1d6a3) {
    const off = (c - 0x1d400) % 52;
    return String.fromCharCode(off < 26 ? 65 + off : 97 + off - 26);
  }
  if (c >= 0x1d7ce && c <= 0x1d7ff) return String.fromCharCode(48 + ((c - 0x1d7ce) % 10));
  if (c >= GREEK_ITALIC_SMALL && c <= GREEK_ITALIC_SMALL + 24) return String.fromCodePoint(0x3b1 + c - GREEK_ITALIC_SMALL);
  if (c >= GREEK_ITALIC_CAP && c <= GREEK_ITALIC_CAP + 24) return String.fromCodePoint(0x391 + c - GREEK_ITALIC_CAP);
  return ch;
}

// Font words: \doubleX, \frakturX, \scriptX for every Latin letter.
for (const [word, style] of [["double", "double"], ["fraktur", "fraktur"], ["script", "script"]] as const)
  for (let i = 0; i < 26; i++) {
    const up = String.fromCharCode(65 + i);
    const lo = String.fromCharCode(97 + i);
    MATH_WORDS[word + up] = mathAlpha(style, up);
    MATH_WORDS[word + lo] = mathAlpha(style, lo);
  }

/** Function names recognised in front of a space (sin + space -> function). */
export const FUNC_NAMES = [
  "sin", "cos", "tan", "csc", "sec", "cot", "sinh", "cosh", "tanh", "csch", "sech", "coth",
  "arcsin", "arccos", "arctan", "arccsc", "arcsec", "arccot", "arsinh", "arcosh", "artanh",
  "log", "ln", "lg", "exp", "lim", "min", "max", "sup", "inf", "det", "dim", "gcd", "lcm", "mod",
  "Pr", "arg", "deg", "hom", "ker", "liminf", "limsup",
];
/** Functions whose sub/superscript is written below/above the name (lim_(n→∞)). */
export const LIMIT_FUNCS = ["lim", "min", "max", "ln", "sup", "inf", "liminf", "limsup", "det", "gcd", "Pr"];

export const OPEN_BRACKETS = "([{⟨⌈⌊⟦⟪〈⎰〖";
export const CLOSE_BRACKETS = ")]}⟩⌉⌋⟧⟫〉⎱〗";
export const LR_BRACKETS = "|‖";
export const NARY = "∑∏∐∫∬∭⨌∮∯∰∱∲∳⋀⋁⋂⋃⨀⨁⨂⨄⨆";
/** Integral-like n-ary operators keep their limits as scripts. */
export const NARY_INTEGRALS = "∫∬∭⨌∮∯∰∱∲∳";
export const OPERATORS =
  "+-−=<>±∓×÷⋅∗∘∙≤≥≠≈≡∼≃≅≍≶≷≺≻≼≽⪯⪰⊂⊃⊆⊇⊑⊒∈∋∉∧∨¬⇒⇔→←↔⇐↑↓↕⇑⇓⇕⟶⟵⟷⟹⟸⟺↦↗↖↘↙↩↪↼↽⇀⇁⇋⇌⊕⊗⊖⊙⊘∩∪⊓⊔⊥⊤⊢⊣⊨∣∥∝∖⋈⨯⟕⟖⟗⋉⋊▷*,;:!∶≔≪≫≝≐⋄⊞⊟⊡⊎∵∴⋆≀";
export const SPACES = " \t             　";
export const INVISIBLE = "⁡⁢⁣⁤​";
export const FRACTION_OPS = "/∕⁄¦";
export const PRIMES = "′″‴⁗";
/** Prefix operators taking the next operand: radicals, boxes, bars, group characters. */
export const RADICALS = "√∛∜";
export const BOXES = "□▭";
export const BARS = "▁¯";
export const GROUP_CHARS = "⏞⏟⏜⏝⎴⎵⏠⏡";

/** inStr: c is one of the characters of s (never true for ""). */
export const inStr = (s: string, c: string) => c !== "" && s.includes(c);
export const isOpen = (c: string) => inStr(OPEN_BRACKETS, c);
export const isClose = (c: string) => inStr(CLOSE_BRACKETS, c);
export const isLR = (c: string) => inStr(LR_BRACKETS, c);
export const isNary = (c: string) => inStr(NARY, c);
export const isOperator = (c: string) => inStr(OPERATORS, c);
export const isSpace = (c: string) => inStr(SPACES, c);
export const isCombining = (c: string) => {
  const p = c.codePointAt(0)!;
  return (p >= 0x300 && p <= 0x36f) || (p >= 0x20d0 && p <= 0x20ff);
};
const SPECIAL = new Set([
  ..."^_┴┬▒■█├┤⁡&@∣", ...FRACTION_OPS, ...PRIMES, ...RADICALS, ...BOXES, ...BARS, ...GROUP_CHARS,
  ...OPEN_BRACKETS, ...CLOSE_BRACKETS, ...LR_BRACKETS, ...NARY,
]);
/** isAlnum: a character that is part of an ordinary operand ("x", "2", "α", "𝑥", "."). */
export function isAlnum(c: string): boolean {
  if (!c) return false;
  if (SPECIAL.has(c) || isOperator(c) || isSpace(c) || inStr(INVISIBLE, c) || isCombining(c)) return false;
  if (c === "\\" || c === "'" || c === '"') return false;
  return true;
}
