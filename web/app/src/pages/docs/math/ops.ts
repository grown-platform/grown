// Equation commands behind the equation toolbar and the context menu:
// templates to insert, and whole-equation transforms (fraction kind,
// limit position, brackets, matrix rows/columns, linear/professional view).
import { type Content, type FracType, type MObj, isObj, isRun, mapSlots, normalize, run } from "./model";
import { cellsOf, parseCells, toLinear } from "./linear";

const e = (): Content => [run()];

export interface Template {
  id: string;
  label: string;
  /** Short preview text (linear format). */
  preview: string;
  make: () => MObj;
}

export interface TemplateGroup {
  id: string;
  label: string;
  items: Template[];
}

const t = (id: string, label: string, preview: string, make: () => MObj): Template => ({ id, label, preview, make });
const nary = (chr: string, limits: boolean, loc: "undOvr" | "subSup"): MObj => ({
  t: "nary",
  chr,
  limLoc: loc,
  sub: limits ? e() : null,
  sup: limits ? e() : null,
  base: e(),
});
const delim = (beg: string, end: string, n = 1): MObj => ({ t: "d", beg, end, sep: "∣", items: Array.from({ length: n }, e) });
const matrix = (r: number, c: number): MObj => ({ t: "m", rows: Array.from({ length: r }, () => Array.from({ length: c }, e)) });
const fn = (name: string): MObj => ({ t: "func", name: [run(name, { sty: "p" })], arg: e() });

/** TEMPLATES: the equation toolbar, grouped like Word's Equation tab. */
export const TEMPLATES: TemplateGroup[] = [
  {
    id: "fraction",
    label: "Fraction",
    items: [
      t("frac-bar", "Stacked fraction", "□/□", () => ({ t: "f", type: "bar", num: e(), den: e() })),
      t("frac-skw", "Skewed fraction", "□⁄□", () => ({ t: "f", type: "skw", num: e(), den: e() })),
      t("frac-lin", "Linear fraction", "□∕□", () => ({ t: "f", type: "lin", num: e(), den: e() })),
      t("frac-nobar", "No-bar fraction", "□¦□", () => ({ t: "f", type: "noBar", num: e(), den: e() })),
    ],
  },
  {
    id: "script",
    label: "Script",
    items: [
      t("sup", "Superscript", "□^□", () => ({ t: "sSup", base: e(), sup: e() })),
      t("sub", "Subscript", "□_□", () => ({ t: "sSub", base: e(), sub: e() })),
      t("subsup", "Subscript-superscript", "□_□^□", () => ({ t: "sSubSup", base: e(), sub: e(), sup: e() })),
      t("pre", "Left subscript-superscript", "(_□^□)□", () => ({ t: "sPre", base: e(), sub: e(), sup: e() })),
    ],
  },
  {
    id: "radical",
    label: "Radical",
    items: [
      t("sqrt", "Square root", "√□", () => ({ t: "rad", deg: e(), base: e() })),
      t("root", "Radical with degree", "√(□&□)", () => ({ t: "rad", deg: [run("n")], base: e() })),
      t("cbrt", "Cube root", "∛□", () => ({ t: "rad", deg: [run("3")], base: e() })),
    ],
  },
  {
    id: "integral",
    label: "Integral",
    items: [
      t("int", "Integral", "∫", () => nary("∫", false, "subSup")),
      t("int-lim", "Integral with limits", "∫_□^□", () => nary("∫", true, "subSup")),
      t("iint", "Double integral", "∬", () => nary("∬", false, "subSup")),
      t("oint", "Contour integral", "∮", () => nary("∮", false, "subSup")),
    ],
  },
  {
    id: "operator",
    label: "Large operator",
    items: [
      t("sum", "Summation", "∑", () => nary("∑", false, "undOvr")),
      t("sum-lim", "Summation with limits", "∑_□^□", () => nary("∑", true, "undOvr")),
      t("prod", "Product with limits", "∏_□^□", () => nary("∏", true, "undOvr")),
      t("union", "Union with limits", "⋃_□^□", () => nary("⋃", true, "undOvr")),
    ],
  },
  {
    id: "bracket",
    label: "Bracket",
    items: [
      t("paren", "Parentheses", "(□)", () => delim("(", ")")),
      t("square", "Square brackets", "[□]", () => delim("[", "]")),
      t("brace", "Braces", "{□}", () => delim("{", "}")),
      t("abs", "Absolute value", "|□|", () => delim("|", "|")),
      t("angle", "Angle brackets", "⟨□⟩", () => delim("⟨", "⟩")),
      t("sep", "Parentheses with separator", "(□∣□)", () => delim("(", ")", 2)),
      t("cases", "Cases", "{■", () => ({ t: "d", beg: "{", end: "", sep: "∣", items: [[run(), { t: "eqArr", rows: [e(), e()] }, run()]] })),
    ],
  },
  {
    id: "function",
    label: "Function",
    items: ["sin", "cos", "tan", "log", "ln"].map((n) => t(`fn-${n}`, n, `${n}⁡□`, () => fn(n))),
  },
  {
    id: "accent",
    label: "Accent",
    items: [
      t("hat", "Hat", "□̂", () => ({ t: "acc", chr: "̂", base: e() })),
      t("bar", "Bar", "□̅", () => ({ t: "acc", chr: "̅", base: e() })),
      t("vec", "Vector arrow", "□⃗", () => ({ t: "acc", chr: "⃗", base: e() })),
      t("dot", "Dot", "□̇", () => ({ t: "acc", chr: "̇", base: e() })),
      t("tilde", "Tilde", "□̃", () => ({ t: "acc", chr: "̃", base: e() })),
      t("overbrace", "Overbrace", "⏞□", () => ({ t: "groupChr", chr: "⏞", pos: "top", base: e() })),
      t("underbrace", "Underbrace", "⏟□", () => ({ t: "groupChr", chr: "⏟", pos: "bot", base: e() })),
      t("overline", "Overbar", "¯□", () => ({ t: "bar", pos: "top", base: e() })),
      t("boxed", "Boxed formula", "▭□", () => ({ t: "borderBox", base: e() })),
    ],
  },
  {
    id: "limit",
    label: "Limit and log",
    items: [
      t("lim", "Limit", "lim┬□", () => ({ t: "func", name: [run(), { t: "limLow", base: [run("lim", { sty: "p" })], lim: e() }, run()], arg: e() })),
      t("max", "Maximum", "max┬□", () => ({ t: "func", name: [run(), { t: "limLow", base: [run("max", { sty: "p" })], lim: e() }, run()], arg: e() })),
      t("log-base", "Logarithm with base", "log_□", () => ({ t: "func", name: [run(), { t: "sSub", base: [run("log", { sty: "p" })], sub: e() }, run()], arg: e() })),
      t("below", "Below", "□┬□", () => ({ t: "limLow", base: e(), lim: e() })),
      t("above", "Above", "□┴□", () => ({ t: "limUpp", base: e(), lim: e() })),
    ],
  },
  {
    id: "matrix",
    label: "Matrix",
    items: [
      t("m12", "1×2 matrix", "■(□&□)", () => matrix(1, 2)),
      t("m21", "2×1 matrix", "■(□@□)", () => matrix(2, 1)),
      t("m22", "2×2 matrix", "■(□&□@□&□)", () => matrix(2, 2)),
      t("m33", "3×3 matrix", "■(□&□&□@…)", () => matrix(3, 3)),
      t("pm22", "2×2 matrix in parentheses", "(■(□&□@□&□))", () => ({ t: "d", beg: "(", end: ")", sep: "∣", items: [[run(), matrix(2, 2), run()]] })),
      t("bm22", "2×2 matrix in brackets", "[■(□&□@□&□)]", () => ({ t: "d", beg: "[", end: "]", sep: "∣", items: [[run(), matrix(2, 2), run()]] })),
    ],
  },
];

export function findTemplate(id: string): Template | undefined {
  for (const g of TEMPLATES) for (const it of g.items) if (it.id === id) return it;
  return undefined;
}

/** deep applies fn to every object, innermost first. */
function deep(c: Content, fn: (o: MObj) => MObj): Content {
  return c.map((n) => (isRun(n) ? n : fn(mapSlots(n, (x) => deep(x, fn)))));
}

export function setFractionType(c: Content, type: FracType): Content {
  return deep(c, (o) => (o.t === "f" ? { ...o, type } : o));
}

export function setLimitLocation(c: Content, limLoc: "undOvr" | "subSup"): Content {
  return deep(c, (o) => (o.t === "nary" ? { ...o, limLoc } : o));
}

export function hasObject(c: Content, t: MObj["t"]): boolean {
  let found = false;
  deep(c, (o) => {
    if (o.t === t) found = true;
    return o;
  });
  return found;
}

/** wrapInBrackets puts the whole equation in a delimiter. */
export function wrapInBrackets(c: Content, beg = "(", end = ")"): Content {
  return normalize([{ t: "d", beg, end, sep: "∣", items: [normalize(c)] }]);
}

/** removeOuterBrackets unwraps an equation that is one delimiter. */
export function removeOuterBrackets(c: Content): Content {
  const items = c.filter((n) => !(isRun(n) && n.text === ""));
  if (items.length === 1 && isObj(items[0]) && items[0].t === "d") return normalize(items[0].items.flatMap((it, i) => (i ? [run(","), ...it] : it)));
  return c;
}

/** Add a row / column to every matrix. */
export function matrixInsert(c: Content, what: "row" | "column"): Content {
  return deep(c, (o) => {
    if (o.t !== "m") return o;
    const cols = o.rows[0]?.length ?? 1;
    if (what === "row") return { ...o, rows: [...o.rows, Array.from({ length: cols }, e)] };
    return { ...o, rows: o.rows.map((r) => [...r, e()]) };
  });
}

export function matrixDelete(c: Content, what: "row" | "column"): Content {
  return deep(c, (o) => {
    if (o.t !== "m") return o;
    if (what === "row" && o.rows.length > 1) return { ...o, rows: o.rows.slice(0, -1) };
    if (what === "column" && (o.rows[0]?.length ?? 1) > 1) return { ...o, rows: o.rows.map((r) => r.slice(0, -1)) };
    return o;
  });
}

/** toLinearForm shows the equation as its linear text (Word's "Linear"). */
export function toLinearForm(c: Content): Content {
  return [run(toLinear(c))];
}

/** toProfessional builds the whole equation up (Word's "Professional"). */
export function toProfessional(c: Content): Content {
  return parseCells(cellsOf(c));
}

/** isLinearForm: the equation is text only (nothing built up). */
export function isLinearForm(c: Content): boolean {
  return c.every(isRun) && toProfessional(c).some(isObj);
}
