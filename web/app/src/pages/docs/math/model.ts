// Internal equation model for Docs (M11). It mirrors Office Math (OMML):
// an equation is a *content* (a list of runs and math objects); every object
// holds its arguments as contents again. The model is plain JSON so it can
// live in a ProseMirror node attribute (and so in Yjs).
//
// Invariants kept by `normalize` (the same shape Word and OnlyOffice keep):
// a content starts and ends with a run, two objects are always separated by
// a run (possibly empty), and adjacent runs with the same style are merged.

/** Run style: "p" plain (upright, e.g. function names), "i"/"b"/"bi" math italic / bold. */
export type RunStyle = "p" | "b" | "i" | "bi";

export interface MRun {
  t: "r";
  text: string;
  /** Upright ("p") for function names and \text runs; absent = default math style. */
  sty?: RunStyle;
  /** Normal (non-math) text, from \text{…} or <mtext>. */
  nor?: boolean;
  /** Text colour ("#rrggbb"), e.g. from MathML mathcolor. */
  color?: string;
  /** Highlight ("#rrggbb"), e.g. from MathML mathbackground. */
  bg?: string;
}

export type FracType = "bar" | "skw" | "lin" | "noBar";
export type Content = MNode[];

export type MObj =
  | { t: "f"; type: FracType; num: Content; den: Content }
  | { t: "sSup"; base: Content; sup: Content }
  | { t: "sSub"; base: Content; sub: Content }
  | { t: "sSubSup"; base: Content; sub: Content; sup: Content }
  | { t: "sPre"; base: Content; sub: Content; sup: Content }
  | { t: "rad"; deg: Content; base: Content }
  | {
      t: "nary";
      chr: string;
      /** "undOvr" = limits above/below, "subSup" = limits as scripts. */
      limLoc: "undOvr" | "subSup";
      sub: Content | null;
      sup: Content | null;
      base: Content;
    }
  | { t: "d"; beg: string; end: string; sep: string; items: Content[] }
  | { t: "func"; name: Content; arg: Content }
  | { t: "limLow"; base: Content; lim: Content }
  | { t: "limUpp"; base: Content; lim: Content }
  | { t: "acc"; chr: string; base: Content }
  | { t: "bar"; pos: "top" | "bot"; base: Content }
  | { t: "box"; base: Content }
  | { t: "borderBox"; base: Content }
  | { t: "groupChr"; chr: string; pos: "top" | "bot"; base: Content }
  | { t: "m"; rows: Content[][] }
  | { t: "eqArr"; rows: Content[] }
  | { t: "phant"; base: Content };

export type MNode = MRun | MObj;

/** An equation: its content and whether it is a display (block) equation. */
export interface Equation {
  content: Content;
  display: boolean;
}

export const run = (text = "", extra: Partial<MRun> = {}): MRun => ({ t: "r", text, ...extra });
export const isRun = (n: MNode | undefined): n is MRun => !!n && n.t === "r";
export const isObj = (n: MNode | undefined): n is MObj => !!n && n.t !== "r";

/** Office class names used by the OnlyOffice fixtures, per object type. */
export const CLASS_NAMES: Record<MNode["t"], string> = {
  r: "ParaRun",
  f: "CFraction",
  sSup: "CDegree",
  sSub: "CDegree",
  sSubSup: "CDegreeSubSup",
  sPre: "CDegreeSubSup",
  rad: "CRadical",
  nary: "CNary",
  d: "CDelimiter",
  func: "CMathFunc",
  limLow: "CLimit",
  limUpp: "CLimit",
  acc: "CAccent",
  bar: "CBar",
  box: "CBox",
  borderBox: "CBorderBox",
  groupChr: "CGroupCharacter",
  m: "CMathMatrix",
  eqArr: "CEqArray",
  phant: "CPhantom",
};

function sameStyle(a: MRun, b: MRun): boolean {
  return (a.sty ?? "") === (b.sty ?? "") && !!a.nor === !!b.nor && (a.color ?? "") === (b.color ?? "") && (a.bg ?? "") === (b.bg ?? "");
}

/** The named argument slots of an object, in reading order. */
export function slots(o: MObj): Content[] {
  switch (o.t) {
    case "f":
      return [o.num, o.den];
    case "sSup":
      return [o.base, o.sup];
    case "sSub":
      return [o.base, o.sub];
    case "sSubSup":
      return [o.base, o.sub, o.sup];
    case "sPre":
      return [o.sub, o.sup, o.base];
    case "rad":
      return [o.deg, o.base];
    case "nary":
      return [...(o.sub ? [o.sub] : []), ...(o.sup ? [o.sup] : []), o.base];
    case "d":
      return o.items;
    case "func":
      return [o.name, o.arg];
    case "limLow":
    case "limUpp":
      return [o.base, o.lim];
    case "m":
      return o.rows.flat();
    case "eqArr":
      return o.rows;
    default:
      return [o.base];
  }
}

/** mapSlots rebuilds an object with every argument passed through fn. */
export function mapSlots(o: MObj, fn: (c: Content) => Content): MObj {
  switch (o.t) {
    case "f":
      return { ...o, num: fn(o.num), den: fn(o.den) };
    case "sSup":
      return { ...o, base: fn(o.base), sup: fn(o.sup) };
    case "sSub":
      return { ...o, base: fn(o.base), sub: fn(o.sub) };
    case "sSubSup":
    case "sPre":
      return { ...o, base: fn(o.base), sub: fn(o.sub), sup: fn(o.sup) };
    case "rad":
      return { ...o, deg: fn(o.deg), base: fn(o.base) };
    case "nary":
      return { ...o, sub: o.sub && fn(o.sub), sup: o.sup && fn(o.sup), base: fn(o.base) };
    case "d":
      return { ...o, items: o.items.map(fn) };
    case "func":
      return { ...o, name: fn(o.name), arg: fn(o.arg) };
    case "limLow":
    case "limUpp":
      return { ...o, base: fn(o.base), lim: fn(o.lim) };
    case "m":
      return { ...o, rows: o.rows.map((r) => r.map(fn)) };
    case "eqArr":
      return { ...o, rows: o.rows.map(fn) };
    default:
      return { ...o, base: fn(o.base) } as MObj;
  }
}

/** normalize enforces the content invariants, recursively. */
export function normalize(c: Content): Content {
  const out: Content = [];
  for (const n0 of c) {
    const n = isRun(n0) ? n0 : mapSlots(n0, normalize);
    const last = out[out.length - 1];
    if (isRun(n)) {
      if (isRun(last) && (sameStyle(last, n) || n.text === "" || last.text === "")) {
        if (last.text === "" && n.text !== "") out[out.length - 1] = { ...n };
        else if (n.text !== "") out[out.length - 1] = { ...last, text: last.text + n.text };
      } else out.push({ ...n });
    } else {
      if (!isRun(last)) out.push(run());
      out.push(n);
    }
  }
  if (!isRun(out[0])) out.unshift(run());
  if (!isRun(out[out.length - 1])) out.push(run());
  return out;
}

/** Plain text of every run (scripts included), for search / word counts. */
export function plainText(c: Content): string {
  let s = "";
  for (const n of c) {
    if (isRun(n)) s += n.text;
    else for (const sl of slots(n)) s += plainText(sl);
  }
  return s;
}

/** isEmpty: no text and no objects. */
export function isEmptyContent(c: Content): boolean {
  return c.every((n) => isRun(n) && n.text === "");
}

/** mapRuns rewrites every run's text (e.g. change case), recursively. */
export function mapRuns(c: Content, fn: (r: MRun) => MRun): Content {
  return c.map((n) => (isRun(n) ? fn(n) : mapSlots(n, (x) => mapRuns(x, fn))));
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}
