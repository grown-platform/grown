// MathML for Docs equations: a Presentation MathML importer (paste, HTML
// import) and an exporter (HTML export, clipboard), so equations degrade to
// something every browser and word processor can read.
import { type Content, type MNode, type MObj, type MRun, isRun, normalize, run } from "./model";
import { type Cell, cellsToContent } from "./linear";
import { isClose, isLR, isNary, isOpen, mathAlpha, plainAlpha } from "./symbols";

export interface MathMLImport {
  content: Content;
  display: boolean;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ", thinsp: " ", ThinSpace: " ", MediumSpace: " ", ThickSpace: " ",
  InvisibleTimes: "⁢", ApplyFunction: "⁡", it: "⁢", af: "⁡", PlusMinus: "±",
  pm: "±", times: "×", divide: "÷", le: "≤", ge: "≥", ne: "≠", infin: "∞", sum: "∑", int: "∫",
  prod: "∏", alpha: "α", beta: "β", gamma: "γ", delta: "δ", pi: "π", theta: "θ", lambda: "λ", mu: "μ",
  sigma: "σ", omega: "ω", minus: "−", rarr: "→", larr: "←", lt: "<", gt: ">", amp: "&", quot: '"',
  apos: "'", middot: "·", deg: "°", prime: "′", ExponentialE: "ⅇ", ImaginaryI: "ⅈ", DifferentialD: "ⅆ",
};

const COLORS: Record<string, string> = {
  red: "#ff0000", blue: "#0000ff", green: "#008000", black: "#000000", white: "#ffffff", gray: "#808080",
  grey: "#808080", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", lime: "#00ff00", navy: "#000080",
  teal: "#008080", maroon: "#800000", olive: "#808000", aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff",
  magenta: "#ff00ff", silver: "#c0c0c0", lightblue: "#add8e6",
};
function color(v: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (COLORS[s]) return COLORS[s];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return undefined;
  return m[1].length === 3 ? "#" + [...m[1]].map((c) => c + c).join("") : "#" + m[1];
}

/** rgbOf("#ff0000") -> [255, 0, 0]. */
export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const VARIANTS: Record<string, string> = {
  bold: "bold", italic: "italic", "bold-italic": "bolditalic", "double-struck": "double", script: "script",
  "bold-script": "boldscript", fraktur: "fraktur", "bold-fraktur": "boldfraktur", "sans-serif": "sans",
  "bold-sans-serif": "sansbold", "sans-serif-italic": "sansitalic", "sans-serif-bold-italic": "sansbolditalic",
  monospace: "mono",
};

const kidsOf = (e: Element) => Array.from(e.children);
const local = (e: Element) => (e.localName || e.nodeName).replace(/^.*:/, "").toLowerCase();
/** XML whitespace is trimmed from token text; &nbsp; then reads as a space. */
const tokenText = (e: Element) => (e.textContent ?? "").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").replace(/ /g, " ");

/** parseMathML reads a <math> element (string) into model content. */
export function parseMathML(src: string): MathMLImport {
  const xml = src.replace(/&([A-Za-z]+);/g, (m, name: string) => (ENTITIES[name] !== undefined ? `&#${ENTITIES[name].codePointAt(0)};` : m));
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  let root: Element | null = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length) {
    const html = new DOMParser().parseFromString(src, "text/html");
    root = html.querySelector("math");
  }
  if (!root) return { content: [run(src)], display: false };
  const math = local(root) === "math" ? root : root.querySelector("math") ?? root;
  const display = math.getAttribute("display") === "block";
  return { content: normalize(new Reader(display).row(kidsOf(math))), display };
}

/** parseMathMLElement reads an already-parsed <math> element. */
export function parseMathMLElement(el: Element): MathMLImport {
  const display = el.getAttribute("display") === "block";
  return { content: normalize(new Reader(display).row(kidsOf(el))), display };
}

class Reader {
  constructor(readonly display: boolean) {}

  /** row: the children of an mrow-like element; brackets written as <mo> pair up. */
  row(els: Element[]): Content {
    const cells: Cell[] = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const name = local(e);
      if ((name === "munderover" || name === "munder" || name === "mover" || name === "msubsup" || name === "msub" || name === "msup") && this.naryOf(e)) {
        const nary = this.node(e) as Extract<MObj, { t: "nary" }>;
        if (i + 1 < els.length) nary.base = normalize(this.nodes(els[++i]));
        cells.push({ obj: nary });
        continue;
      }
      if (name === "mo" && tokenText(e) === "\u2061") {
        // function application: the letters before it are the name
        let k = cells.length;
        while (k > 0 && "ch" in cells[k - 1] && /\p{L}/u.test((cells[k - 1] as { ch: string }).ch)) k--;
        const nameCells = cells.splice(k);
        const nameText = nameCells.map((c) => ("ch" in c ? plainAlpha(c.ch) : "")).join("");
        const arg = i + 1 < els.length ? this.arg(els[++i]) : [run()];
        cells.push({ obj: { t: "func", name: [run(nameText, { sty: "p" })], arg } });
        continue;
      }
      for (const n of this.nodes(e)) {
        if (isRun(n)) for (const ch of n.text) cells.push(n.color || n.bg || n.nor || n.sty ? { ch, tpl: n } : { ch });
        else cells.push({ obj: n });
      }
    }
    return pairBrackets(cells);
  }

  content(e: Element): Content {
    return normalize(this.row(kidsOf(e)));
  }
  arg(e: Element | undefined): Content {
    if (!e) return [run()];
    return normalize(local(e) === "mrow" ? this.row(kidsOf(e)) : this.nodes(e));
  }

  naryOf(e: Element): string | null {
    const base = kidsOf(e)[0];
    if (!base || local(base) !== "mo") return null;
    const t = tokenText(base);
    return isNary(t) ? t : null;
  }

  token(e: Element, text: string, variantDefault?: string): MRun {
    const variant = e.getAttribute("mathvariant") ?? variantDefault;
    let t = text;
    if (variant && variant !== "normal" && VARIANTS[variant]) t = [...t].map((c) => mathAlpha(VARIANTS[variant], plainAlpha(c))).join("");
    const r: MRun = run(t);
    const c = color(e.getAttribute("mathcolor") ?? e.getAttribute("color"));
    const bg = color(e.getAttribute("mathbackground") ?? e.getAttribute("background"));
    if (c) r.color = c;
    if (bg) r.bg = bg;
    if (variant === "normal" && /[A-Za-z]/.test(t) && [...t].length > 1) r.sty = "p";
    return r;
  }

  nodes(e: Element): Content {
    const k = kidsOf(e);
    switch (local(e)) {
      case "mi": {
        const t = tokenText(e);
        return [this.token(e, t, [...t].length === 1 ? "italic" : "normal")];
      }
      case "mn":
      case "mo":
        return [this.token(e, tokenText(e))];
      case "mtext":
        return [{ ...this.token(e, tokenText(e)), nor: true }];
      case "ms": {
        const l = e.getAttribute("lquote") ?? '"';
        const r = e.getAttribute("rquote") ?? '"';
        return [{ ...this.token(e, l + tokenText(e) + r), nor: true }];
      }
      case "mspace":
      case "none":
      case "mprescripts":
      case "annotation":
      case "annotation-xml":
        return [];
      case "math":
      case "mrow":
      case "mstyle":
      case "mpadded":
      case "merror":
      case "maction":
        return this.row(local(e) === "maction" ? k.slice(0, 1) : k);
      case "semantics":
        return k.length ? this.nodes(k[0]) : [];
      case "mfrac": {
        const lt = e.getAttribute("linethickness");
        const type = e.getAttribute("bevelled") === "true" ? "skw" : lt === "0" || lt === "0px" || lt === "0pt" ? "noBar" : "bar";
        return [{ t: "f", type, num: this.arg(k[0]), den: this.arg(k[1]) }];
      }
      case "msqrt":
        return [{ t: "rad", deg: [run()], base: this.content(e) }];
      case "mroot":
        return [{ t: "rad", deg: this.arg(k[1]), base: this.arg(k[0]) }];
      case "msub":
      case "msup":
      case "msubsup":
      case "munder":
      case "mover":
      case "munderover":
        return [this.node(e)];
      case "mmultiscripts": {
        const base = this.arg(k[0]);
        const pre = k.findIndex((x) => local(x) === "mprescripts");
        const post = k.slice(1, pre < 0 ? undefined : pre);
        let out: MObj | null = null;
        if (post.length >= 2) out = { t: "sSubSup", base, sub: this.arg(post[0]), sup: this.arg(post[1]) };
        if (pre >= 0 && k.length >= pre + 3)
          return [{ t: "sPre", sub: this.arg(k[pre + 1]), sup: this.arg(k[pre + 2]), base: out ? [run(), out, run()] : base }];
        return [out ?? { t: "sSubSup", base, sub: [run()], sup: [run()] }];
      }
      case "mfenced": {
        const open = e.getAttribute("open") ?? "(";
        const close = e.getAttribute("close") ?? ")";
        const sep = (e.getAttribute("separators") ?? ",").trim()[0] ?? ",";
        return [{ t: "d", beg: open, end: close, sep, items: k.length ? k.map((x) => this.arg(x)) : [[run()]] }];
      }
      case "menclose":
        return [{ t: "borderBox", base: this.content(e) }];
      case "mphantom":
        return [{ t: "phant", base: this.content(e) }];
      case "mtable":
        return [{ t: "m", rows: this.table(e) }];
      default:
        return this.row(k.length ? k : []);
    }
  }

  /** mtable rows, normalising nested mtr / stray mtd. */
  table(e: Element): Content[][] {
    const rows: Content[][] = [];
    let loose: Content[] = [];
    const flushLoose = () => {
      if (loose.length) rows.push(loose);
      loose = [];
    };
    const cellsOfRow = (r: Element): Content[] => {
      const out: Content[] = [];
      for (const c of kidsOf(r)) {
        if (local(c) === "mtd") {
          const inner = kidsOf(c).filter((x) => local(x) === "mtd");
          if (inner.length) out.push(...inner.map((x) => this.content(x)));
          else out.push(this.content(c));
        } else if (local(c) !== "mtr") out.push(this.arg(c));
      }
      return out;
    };
    const visit = (r: Element) => {
      const name = local(r);
      if (name === "mtr" || name === "mlabeledtr") {
        const nested = kidsOf(r).filter((x) => local(x) === "mtr");
        if (nested.length) {
          nested.forEach(visit);
          return;
        }
        flushLoose();
        rows.push(cellsOfRow(name === "mlabeledtr" ? ({ children: kidsOf(r).slice(1) } as unknown as Element) : r));
      } else if (name === "mtd") {
        const inner = kidsOf(r).filter((x) => local(x) === "mtd");
        if (inner.length) {
          flushLoose();
          rows.push(inner.map((x) => this.content(x)));
        } else loose.push(this.content(r));
      }
    };
    kidsOf(e).forEach(visit);
    flushLoose();
    const cols = Math.max(1, ...rows.map((r) => r.length));
    for (const r of rows) while (r.length < cols) r.push([run()]);
    return rows.length ? rows : [[[run()]]];
  }

  node(e: Element): MObj {
    const k = kidsOf(e);
    const name = local(e);
    const nary = this.naryOf(e);
    if (nary) {
      const movable = k[0].getAttribute("movablelimits");
      const scripts = name === "msub" || name === "msup" || name === "msubsup";
      const limLoc = scripts || (movable === "true" && !this.display) ? "subSup" : "undOvr";
      const lower = ["munder", "munderover", "msub", "msubsup"].includes(name) ? this.arg(k[1]) : null;
      const upper = name === "mover" || name === "msup" ? this.arg(k[1]) : name === "munderover" || name === "msubsup" ? this.arg(k[2]) : null;
      return { t: "nary", chr: nary, limLoc, sub: lower, sup: upper, base: [run()] };
    }
    const base = this.arg(k[0]);
    switch (name) {
      case "msub":
        return { t: "sSub", base, sub: this.arg(k[1]) };
      case "msup":
        return { t: "sSup", base, sup: this.arg(k[1]) };
      case "msubsup":
        return { t: "sSubSup", base, sub: this.arg(k[1]), sup: this.arg(k[2]) };
      case "munder": {
        const g = groupChar(k[1]);
        if (g && "⏟⏝⎵⏡".includes(g)) return { t: "groupChr", chr: g, pos: "bot", base };
        return { t: "limLow", base, lim: this.arg(k[1]) };
      }
      case "mover": {
        const g = groupChar(k[1]);
        if (g && "⏞⏜⎴⏠".includes(g)) return { t: "groupChr", chr: g, pos: "top", base };
        const acc = e.getAttribute("accent") === "true" && g ? ACCENT_CHARS[g] : undefined;
        if (acc) return { t: "acc", chr: acc, base };
        return { t: "limUpp", base, lim: this.arg(k[1]) };
      }
      default: {
        const upp: MObj = { t: "limUpp", base, lim: this.arg(k[2]) };
        return { t: "limLow", base: [run(), upp, run()], lim: this.arg(k[1]) };
      }
    }
  }
}

const ACCENT_CHARS: Record<string, string> = {
  "˙": "̇", "¨": "̈", "˜": "̃", "ˇ": "̌", "→": "⃗", "⃗": "⃗", "¯": "̅",
  "‾": "̅", "´": "́", "`": "̀", "˘": "̆",
};

function groupChar(e: Element | undefined): string | null {
  if (!e || local(e) !== "mo") return null;
  const t = tokenText(e);
  return [...t].length === 1 ? t : null;
}

/** pairBrackets turns matched bracket characters into delimiter objects. */
function pairBrackets(cells: Cell[]): Content {
  const ch = (i: number) => (cells[i] && "ch" in cells[i] ? (cells[i] as { ch: string }).ch : "");
  const out: Cell[] = [];
  let i = 0;
  const findClose = (start: number): number => {
    const open = ch(start);
    for (let j = start + 1; j < cells.length; j++) {
      const c = ch(j);
      if (isOpen(c) || (isLR(c) && c !== open)) {
        const k = findClose(j);
        if (k > 0) j = k;
        continue;
      }
      if (isClose(c) || (isLR(c) && (c === open || !isLR(open)))) return j;
    }
    return -1;
  };
  while (i < cells.length) {
    const c = ch(i);
    if (isOpen(c) || isLR(c)) {
      const k = findClose(i);
      if (k > i) {
        const inner = pairBrackets(cells.slice(i + 1, k));
        out.push({ obj: { t: "d", beg: c, end: ch(k), sep: "∣", items: [normalize(inner)] } });
        i = k + 1;
        continue;
      }
    }
    out.push(cells[i]);
    i++;
  }
  return cellsToContent(out);
}

// --- export ----------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runML(r: MRun): string {
  const style = [r.color ? ` mathcolor="${r.color}"` : "", r.bg ? ` mathbackground="${r.bg}"` : ""].join("");
  if (r.nor) return `<mtext${style}>${esc(r.text)}</mtext>`;
  let s = "";
  let buf = "";
  let kind: "mi" | "mn" | "mo" | null = null;
  const flush = () => {
    if (!buf) return;
    const variant = kind === "mi" && [...buf].length > 1 ? ' mathvariant="normal"' : "";
    s += `<${kind}${variant}${style}>${esc(buf)}</${kind}>`;
    buf = "";
  };
  for (const c of r.text) {
    const k: "mi" | "mn" | "mo" = /[0-9.]/.test(c) ? "mn" : /[\p{L}\p{M}]/u.test(c) ? "mi" : "mo";
    if (k !== kind || k === "mo" || (k === "mi" && r.sty !== "p")) {
      flush();
      kind = k;
    }
    buf += c;
  }
  flush();
  return s;
}

const row = (c: Content) => {
  const inner = c.map(nodeML).join("");
  return `<mrow>${inner}</mrow>`;
};

function nodeML(n: MNode): string {
  if (isRun(n)) return runML(n);
  switch (n.t) {
    case "f":
      if (n.type === "lin") return `<mrow>${row(n.num)}<mo>/</mo>${row(n.den)}</mrow>`;
      return `<mfrac${n.type === "skw" ? ' bevelled="true"' : n.type === "noBar" ? ' linethickness="0"' : ""}>${row(n.num)}${row(n.den)}</mfrac>`;
    case "sSup":
      return `<msup>${row(n.base)}${row(n.sup)}</msup>`;
    case "sSub":
      return `<msub>${row(n.base)}${row(n.sub)}</msub>`;
    case "sSubSup":
      return `<msubsup>${row(n.base)}${row(n.sub)}${row(n.sup)}</msubsup>`;
    case "sPre":
      return `<mmultiscripts>${row(n.base)}<mprescripts/>${row(n.sub)}${row(n.sup)}</mmultiscripts>`;
    case "rad":
      return n.deg.some((x) => !isRun(x) || x.text) ? `<mroot>${row(n.base)}${row(n.deg)}</mroot>` : `<msqrt>${row(n.base)}</msqrt>`;
    case "nary": {
      const op = `<mo${n.limLoc === "subSup" ? ' movablelimits="true"' : ""}>${n.chr}</mo>`;
      const under = n.limLoc === "undOvr";
      let head: string;
      if (n.sub && n.sup) head = under ? `<munderover>${op}${row(n.sub)}${row(n.sup)}</munderover>` : `<msubsup>${op}${row(n.sub)}${row(n.sup)}</msubsup>`;
      else if (n.sub) head = under ? `<munder>${op}${row(n.sub)}</munder>` : `<msub>${op}${row(n.sub)}</msub>`;
      else if (n.sup) head = under ? `<mover>${op}${row(n.sup)}</mover>` : `<msup>${op}${row(n.sup)}</msup>`;
      else head = op;
      return `<mrow>${head}${row(n.base)}</mrow>`;
    }
    case "d":
      return `<mrow><mo fence="true">${esc(n.beg)}</mo>${n.items.map(row).join(`<mo separator="true">${esc(n.sep === "∣" ? "|" : n.sep)}</mo>`)}<mo fence="true">${esc(n.end)}</mo></mrow>`;
    case "func":
      return `<mrow>${row(n.name)}<mo>&#x2061;</mo>${row(n.arg)}</mrow>`;
    case "limLow":
      return `<munder>${row(n.base)}${row(n.lim)}</munder>`;
    case "limUpp":
      return `<mover>${row(n.base)}${row(n.lim)}</mover>`;
    case "acc": {
      const spacing: Record<string, string> = { "̂": "^", "̃": "~", "̅": "¯", "̇": "˙", "̈": "¨", "̌": "ˇ", "⃗": "→", "́": "´", "̀": "`", "̆": "˘" };
      return `<mover accent="true">${row(n.base)}<mo>${esc(spacing[n.chr] ?? n.chr)}</mo></mover>`;
    }
    case "bar":
      return n.pos === "bot" ? `<munder>${row(n.base)}<mo>_</mo></munder>` : `<mover>${row(n.base)}<mo>¯</mo></mover>`;
    case "box":
      return row(n.base);
    case "borderBox":
      return `<menclose notation="box">${row(n.base)}</menclose>`;
    case "groupChr":
      return n.pos === "top" ? `<mover>${row(n.base)}<mo>${esc(n.chr)}</mo></mover>` : `<munder>${row(n.base)}<mo>${esc(n.chr)}</mo></munder>`;
    case "m":
      return `<mtable>${n.rows.map((r) => `<mtr>${r.map((c) => `<mtd>${row(c)}</mtd>`).join("")}</mtr>`).join("")}</mtable>`;
    case "eqArr":
      return `<mtable>${n.rows.map((r) => `<mtr><mtd>${row(r)}</mtd></mtr>`).join("")}</mtable>`;
    case "phant":
      return `<mphantom>${row(n.base)}</mphantom>`;
  }
}

/** toMathML: a <math> element for the content (display = block equation). */
export function toMathML(c: Content, display = false, alttext?: string): string {
  const alt = alttext ? ` alttext="${esc(alttext).replace(/"/g, "&quot;")}"` : "";
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ""}${alt}>${c.map(nodeML).join("")}</math>`;
}

