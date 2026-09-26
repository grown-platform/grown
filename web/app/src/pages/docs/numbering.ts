// Paragraph numbering (Docs M3): Word's list model, additive to TipTap's
// bulletList / orderedList nodes (which keep working as before).
//
//   * The `numbering` Yjs map holds list definitions: an abstract list
//     (`abs:<id>`: nine levels, each with a number format, level text such
//     as "%1.%2.", start value, indents and an optional linked paragraph
//     style) and list instances (`num:<id>`: an abstract list plus
//     per-level start overrides, which is how restart / set value work).
//   * A paragraph joins a list with `numId` / `numLvl` attributes, or
//     through its style (a style's pPr.numId). numId "0" switches numbering
//     off even when the style has some.
//   * Paragraphs of instances that share an abstract list count together
//     (continue numbering); an instance with a start override restarts the
//     count at its first paragraph.
//   * computeNumbering() walks the document once and produces the label of
//     every numbered paragraph ("1.", "1.1.", "a)", "•"); the editor shows
//     the labels as node decorations and export writes them as text.
import type { Node as PMNode } from "@tiptap/pm/model";
import type * as Y from "yjs";
import { compileStyle, paragraphStyleId, headingStyleId, type StyleSheet } from "./styles";

// --- definitions --------------------------------------------------------------------

export type NumFmt =
  | "decimal"
  | "decimalZero"
  | "lowerLetter"
  | "upperLetter"
  | "lowerRoman"
  | "upperRoman"
  | "bullet"
  | "none";

export interface LvlDef {
  fmt: NumFmt;
  /** Level text: "%1." / "%1.%2)" placeholders, or the bullet character. */
  text: string;
  start: number;
  /** Left indent of the paragraph text, points. */
  indLeft: number;
  /** Hanging indent (number sits in it), points. */
  hanging: number;
  align?: "left" | "center" | "right";
  /** What follows the number. */
  suffix?: "tab" | "space" | "nothing";
  font?: string;
  /** Paragraph style linked to this level (numbering through a style). */
  pStyle?: string | null;
  /** Show all levels as arabic numbers (legal numbering). */
  legal?: boolean;
}

export interface AbstractNum {
  id: string;
  name?: string;
  lvls: LvlDef[];
}

export interface NumInstance {
  id: string;
  abstractId: string;
  /** Start overrides per level (restart numbering / set value). */
  starts?: Record<string, number>;
}

export const MAX_LEVELS = 9;

// --- formatting ---------------------------------------------------------------------

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const t: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of t) while (n >= v) (out += s), (n -= v);
  return out;
}

/** Word's letter numbering: a..z, then aa..zz, aaa.. */
function letters(n: number): string {
  if (n <= 0) return String(n);
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

export function formatNumber(n: number, fmt: NumFmt): string {
  switch (fmt) {
    case "decimal":
      return String(n);
    case "decimalZero":
      return n < 10 && n >= 0 ? `0${n}` : String(n);
    case "lowerLetter":
      return letters(n);
    case "upperLetter":
      return letters(n).toUpperCase();
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "upperRoman":
      return roman(n);
    default:
      return "";
  }
}

/** parseNumber reads a typed number in a format ("e" -> 5, "IV" -> 4). */
export function parseNumber(s: string, fmt: NumFmt): number | null {
  if (fmt === "decimal" || fmt === "decimalZero") return /^\d+$/.test(s) ? parseInt(s, 10) : null;
  if (fmt === "lowerLetter" || fmt === "upperLetter") {
    const want = fmt === "lowerLetter" ? /^([a-z])\1*$/ : /^([A-Z])\1*$/;
    if (!want.test(s)) return null;
    return (s.length - 1) * 26 + (s.toLowerCase().charCodeAt(0) - 96);
  }
  if (fmt === "lowerRoman" || fmt === "upperRoman") {
    const u = s.toUpperCase();
    if ((fmt === "lowerRoman") !== (s === s.toLowerCase())) return null;
    for (let n = 1; n < 4000; n++) if (roman(n) === u) return n;
    return null;
  }
  return null;
}

// --- the library ----------------------------------------------------------------------

const BULLETS = ["•", "◦", "▪"];
const OUTLINE_FMTS: NumFmt[] = ["decimal", "lowerLetter", "lowerRoman"];

/** Standard level geometry: 0.5in steps, 0.25in hanging. */
const geom = (i: number) => ({ indLeft: 36 * (i + 1), hanging: 18 });

function lvl(i: number, fmt: NumFmt, text: string, extra: Partial<LvlDef> = {}): LvlDef {
  return { fmt, text, start: 1, ...geom(i), suffix: "tab", ...extra };
}

const range9 = Array.from({ length: MAX_LEVELS }, (_, i) => i);

/** A level-0 format followed by the default outline for deeper levels. */
function singleLevel(fmt: NumFmt, text0: string): LvlDef[] {
  return range9.map((i) =>
    i === 0
      ? lvl(0, fmt, text0.replace("#", "%1"))
      : fmt === "bullet"
        ? lvl(i, "bullet", BULLETS[i % 3])
        : lvl(i, OUTLINE_FMTS[i % 3], `%${i + 1}.`),
  );
}

export interface ListPreset {
  id: string;
  label: string;
  kind: "bullet" | "number" | "multilevel";
  /** Linked to the Heading styles: applied through the styles. */
  headings?: boolean;
  lvls: () => LvlDef[];
}

const bullet = (id: string, ch: string, label: string): ListPreset => ({
  id,
  label,
  kind: "bullet",
  lvls: () => singleLevel("bullet", ch),
});
const number = (id: string, fmt: NumFmt, text: string, label: string): ListPreset => ({
  id,
  label,
  kind: "number",
  lvls: () => singleLevel(fmt, text),
});

const legalText = (i: number, delim = ".") =>
  range9.slice(0, i + 1).map((k) => `%${k + 1}${delim}`).join("");

export const LIST_LIBRARY: ListPreset[] = [
  bullet("bullet-disc", "•", "Filled round bullets"),
  bullet("bullet-circle", "◦", "Hollow round bullets"),
  bullet("bullet-square", "▪", "Filled square bullets"),
  bullet("bullet-diamonds", "❖", "Star bullets"),
  bullet("bullet-arrow", "➢", "Arrow bullets"),
  bullet("bullet-check", "✓", "Checkmark bullets"),
  bullet("bullet-diamond", "◆", "Filled diamond bullets"),
  bullet("bullet-dash", "–", "Dash bullets"),
  number("num-decimal-dot", "decimal", "#.", "1. 2. 3."),
  number("num-decimal-paren", "decimal", "#)", "1) 2) 3)"),
  number("num-upper-roman", "upperRoman", "#.", "I. II. III."),
  number("num-upper-letter", "upperLetter", "#.", "A. B. C."),
  number("num-lower-letter-paren", "lowerLetter", "#)", "a) b) c)"),
  number("num-lower-letter-dot", "lowerLetter", "#.", "a. b. c."),
  number("num-lower-roman", "lowerRoman", "#.", "i. ii. iii."),
  {
    id: "ml-outline",
    label: "1. a. i.",
    kind: "multilevel",
    lvls: () => range9.map((i) => lvl(i, OUTLINE_FMTS[i % 3], `%${i + 1}.`)),
  },
  {
    id: "ml-paren",
    label: "1) a) i)",
    kind: "multilevel",
    lvls: () => range9.map((i) => lvl(i, OUTLINE_FMTS[i % 3], i < 3 ? `%${i + 1})` : `(%${i + 1})`)),
  },
  {
    id: "ml-legal",
    label: "1. 1.1. 1.1.1.",
    kind: "multilevel",
    lvls: () => range9.map((i) => lvl(i, "decimal", legalText(i), { indLeft: 18 + 36 * i, hanging: 18 + 7 * i })),
  },
  {
    id: "ml-bullets",
    label: "• ◦ ▪",
    kind: "multilevel",
    lvls: () => range9.map((i) => lvl(i, "bullet", BULLETS[i % 3])),
  },
  {
    id: "ml-headings-article",
    label: "Article I. / Section I.01 / (a)",
    kind: "multilevel",
    headings: true,
    lvls: () => [
      lvl(0, "upperRoman", "Article %1.", { indLeft: 0, hanging: 0 }),
      lvl(1, "decimalZero", "Section %1.%2", { indLeft: 0, hanging: 0 }),
      lvl(2, "lowerLetter", "(%3)", { indLeft: 36, hanging: 18 }),
      lvl(3, "lowerRoman", "(%4)", { indLeft: 54, hanging: 18 }),
      lvl(4, "decimal", "%5)", { indLeft: 72, hanging: 18 }),
      lvl(5, "lowerLetter", "%6)", { indLeft: 90, hanging: 18 }),
      lvl(6, "lowerRoman", "%7)", { indLeft: 108, hanging: 18 }),
      lvl(7, "lowerLetter", "%8.", { indLeft: 126, hanging: 18 }),
      lvl(8, "lowerRoman", "%9.", { indLeft: 144, hanging: 18 }),
    ],
  },
  {
    id: "ml-headings-outline",
    label: "I. Heading / A. Heading / 1. Heading",
    kind: "multilevel",
    headings: true,
    lvls: () => {
      const f: [NumFmt, string][] = [
        ["upperRoman", "%1."], ["upperLetter", "%2."], ["decimal", "%3."], ["lowerLetter", "%4)"],
        ["decimal", "(%5)"], ["lowerLetter", "(%6)"], ["lowerRoman", "(%7)"], ["lowerLetter", "(%8)"],
        ["lowerRoman", "(%9)"],
      ];
      return f.map(([fmt, text], i) => lvl(i, fmt, text, { indLeft: 18 * i, hanging: 0, suffix: "space" }));
    },
  },
  {
    id: "ml-headings-legal",
    label: "1 Heading / 1.1 Heading / 1.1.1 Heading",
    kind: "multilevel",
    headings: true,
    lvls: () => range9.map((i) => lvl(i, "decimal", legalText(i), { indLeft: 0, hanging: 0, suffix: "space" })),
  },
];

/** Presets used by autocorrect for "1.1. " and "1)1) " patterns. */
export const AUTOCORRECT_PRESETS: Record<string, () => LvlDef[]> = {
  legalDot: () => LIST_LIBRARY.find((p) => p.id === "ml-legal")!.lvls(),
  legalParen: () => range9.map((i) => lvl(i, "decimal", legalText(i, ")"), { indLeft: 18 + 36 * i, hanging: 18 + 7 * i })),
};

export function presetById(id: string): ListPreset | undefined {
  return LIST_LIBRARY.find((p) => p.id === id);
}

// --- the store ----------------------------------------------------------------------------

let counter = 0;
function newId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${counter.toString(36)}`;
}

/** NumberingStore reads and writes the `numbering` Yjs map. */
export class NumberingStore {
  constructor(readonly map: Y.Map<unknown>) {}

  num(id: string | null | undefined): NumInstance | undefined {
    if (!id || id === "0") return undefined;
    return this.map.get(`num:${id}`) as NumInstance | undefined;
  }
  abstract(id: string | null | undefined): AbstractNum | undefined {
    if (!id) return undefined;
    return this.map.get(`abs:${id}`) as AbstractNum | undefined;
  }
  /** levels of a list instance (its abstract list's levels). */
  levels(numId: string | null | undefined): LvlDef[] | undefined {
    return this.abstract(this.num(numId)?.abstractId)?.lvls;
  }
  level(numId: string | null | undefined, lvl: number): LvlDef | undefined {
    return this.levels(numId)?.[lvl];
  }

  /** createList stores a new abstract list and one instance; returns the
   *  instance id. */
  createList(lvls: LvlDef[], name?: string): string {
    const absId = newId("a");
    const numId = newId("n");
    const abs: AbstractNum = { id: absId, lvls: clone(lvls) };
    if (name) abs.name = name;
    this.map.set(`abs:${absId}`, abs);
    this.map.set(`num:${numId}`, { id: numId, abstractId: absId });
    return numId;
  }

  /** createInstance adds another instance of an existing list, optionally
   *  restarting some levels. */
  createInstance(abstractId: string, starts?: Record<number, number>): string {
    const numId = newId("n");
    const inst: NumInstance = { id: numId, abstractId };
    if (starts && Object.keys(starts).length) inst.starts = Object.fromEntries(Object.entries(starts).map(([k, v]) => [String(k), v]));
    this.map.set(`num:${numId}`, inst);
    return numId;
  }

  setLevels(abstractId: string, lvls: LvlDef[]): void {
    const abs = this.abstract(abstractId);
    if (!abs) return;
    this.map.set(`abs:${abstractId}`, { ...abs, lvls: clone(lvls) });
  }

  /** setLevel replaces one level of the list an instance uses. */
  setLevel(numId: string, lvl: number, def: LvlDef): void {
    const inst = this.num(numId);
    const abs = this.abstract(inst?.abstractId);
    if (!abs) return;
    const lvls = clone(abs.lvls);
    lvls[lvl] = clone(def);
    this.setLevels(abs.id, lvls);
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// --- resolving a paragraph's list -------------------------------------------------------

export interface NumPr {
  numId: string;
  lvl: number;
}

/**
 * effectiveNumPr returns a paragraph's list and level, or null:
 *   * direct numId "0" switches numbering off;
 *   * direct numId/numLvl win;
 *   * otherwise the style chain's numbering. When the style gives no level,
 *     Word's rule applies: level 0, and only if level 0 is not linked to a
 *     style outside this paragraph's style chain (a style based on the
 *     linked style still counts).
 */
export function effectiveNumPr(sheet: StyleSheet, store: NumberingStore, node: PMNode): NumPr | null {
  if (node.type.name !== "paragraph" && node.type.name !== "heading") return null;
  const direct = node.attrs.numId as string | null | undefined;
  if (direct === "0") return null;
  if (direct) {
    if (!store.num(direct)) return null;
    return { numId: direct, lvl: clampLvl(node.attrs.numLvl) };
  }
  const styleId = paragraphStyleId(sheet, node);
  const { pPr } = compileStyle(sheet, styleId);
  if (!pPr.numId || pPr.numId === "0" || !store.num(pPr.numId)) return null;
  if (pPr.numLvl != null) return { numId: pPr.numId, lvl: clampLvl(pPr.numLvl) };
  const linked = store.level(pPr.numId, 0)?.pStyle;
  if (linked && !sheet.chain(styleId).some((s) => s.id === linked)) return null;
  return { numId: pPr.numId, lvl: 0 };
}

function clampLvl(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? 0), 10) || 0;
  return Math.max(0, Math.min(MAX_LEVELS - 1, n));
}

export interface NumLabel {
  numId: string;
  lvl: number;
  /** The rendered label: "1.", "1.1.", "a)", "•". */
  text: string;
  /** The counter value at this paragraph's level. */
  value: number;
  def: LvlDef;
}

/**
 * computeNumbering walks every paragraph/heading in document order and
 * returns the label of each numbered one, keyed by node position.
 */
export function computeNumbering(doc: PMNode, sheet: StyleSheet, store: NumberingStore): Map<number, NumLabel> {
  const out = new Map<number, NumLabel>();
  const counters = new Map<string, (number | undefined)[]>();
  const seen = new Set<string>();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const np = effectiveNumPr(sheet, store, node);
    if (!np) return false;
    const inst = store.num(np.numId)!;
    const lvls = store.levels(np.numId);
    const def = lvls?.[np.lvl];
    if (!lvls || !def) return false;
    const c = counters.get(inst.abstractId) ?? [];
    counters.set(inst.abstractId, c);
    const key = `${np.numId}:${np.lvl}`;
    const override = inst.starts?.[String(np.lvl)];
    if (override != null && !seen.has(key)) c[np.lvl] = override - 1;
    seen.add(key);
    // Levels above that were never used count as started.
    for (let k = 0; k < np.lvl; k++) if (c[k] === undefined) c[k] = lvls[k]?.start ?? 1;
    c[np.lvl] = (c[np.lvl] ?? def.start - 1) + 1;
    for (let k = np.lvl + 1; k < MAX_LEVELS; k++) c[k] = undefined;
    out.set(pos, { numId: np.numId, lvl: np.lvl, text: levelText(lvls, np.lvl, c), value: c[np.lvl]!, def });
    return false;
  });
  return out;
}

/** levelText fills a level's text with the current counters. */
export function levelText(lvls: LvlDef[], lvl: number, c: (number | undefined)[]): string {
  const def = lvls[lvl];
  if (def.fmt === "bullet") return def.text;
  if (def.fmt === "none") return def.text.replace(/%[1-9]/g, "");
  return def.text.replace(/%([1-9])/g, (_, d: string) => {
    const k = parseInt(d, 10) - 1;
    const l = lvls[k];
    if (!l) return "";
    const v = c[k] ?? l.start;
    return formatNumber(v, def.legal && k < lvl ? "decimal" : l.fmt);
  });
}

/** levelParaPr gives compileParaPr a list level's indents. */
export function levelParaPr(store: NumberingStore) {
  return (numId: string, lvl: number) => {
    const d = store.level(numId, lvl);
    return d ? { indLeft: d.indLeft, indFirstLine: -d.hanging } : null;
  };
}

/** headingPStyle links the first six levels of a list to Heading 1-6. */
export function linkHeadings(lvls: LvlDef[]): LvlDef[] {
  return lvls.map((l, i) => (i < 6 ? { ...l, pStyle: headingStyleId(i + 1) } : l));
}
