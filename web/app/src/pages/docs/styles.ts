// Named paragraph and character styles (Docs M3).
//
// Model (additive; TipTap/Yjs stay):
//   * Style definitions live in the `styles` Yjs map (StyleSheet). Built-in
//     styles (Normal, Title, Subtitle, Heading 1-6, Quote, ...) are defined
//     in code; the map only stores overrides of built-ins and custom styles,
//     so existing documents need no seeding or migration.
//   * A paragraph refers to its style through a `styleId` attribute. A
//     heading node with no styleId *is* "Heading <level>", so every existing
//     heading keeps working and maps to the Heading styles; a paragraph with
//     no styleId is "Normal".
//   * Character styles are a `charStyle` mark with a styleId.
//   * Styles inherit through basedOn; `next` is the style Enter gives the
//     following paragraph. compileStyle() merges the chain, and
//     compileParaPr() adds numbering-level and direct properties in Word's
//     order (see there).
//   * Rendering: generated CSS scoped to the editor (styleCss), so changing
//     a style restyles every paragraph that uses it without touching the
//     ProseMirror document.
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type * as Y from "yjs";
import { directProps, bordersCss, lineHeightCss, type DirectParaProps } from "./paragraphProps";

// --- types ------------------------------------------------------------------------

export interface RunPr {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  smallCaps?: boolean;
  allCaps?: boolean;
  fontFamily?: string;
  /** Points. */
  fontSize?: number;
  color?: string;
  highlight?: string;
}

/** Paragraph properties a style (or a paragraph) can carry. numId "0"
 *  means "explicitly no numbering"; numLvl undefined in a style means
 *  "level 0 if this style is linked to the list's level". */
export interface ParaPr extends DirectParaProps {
  numId?: string | null;
  numLvl?: number | null;
}

export type StyleType = "paragraph" | "character";

export interface StyleDef {
  id: string;
  name: string;
  type: StyleType;
  basedOn?: string | null;
  next?: string | null;
  pPr?: ParaPr;
  rPr?: RunPr;
  /** Heading styles map to heading nodes of this level (1-6). */
  headingLevel?: number;
  builtin?: boolean;
  /** Gallery order; lower first. Custom styles go after built-ins. */
  order?: number;
}

// --- built-in styles -------------------------------------------------------------------

/** Heading sizes match what the editor renders for h1-h6 (browser
 *  defaults at the 12pt body size), so compiled styles describe what is on
 *  screen. */
const HEADING_PT = [24, 18, 14, 12, 10, 8];
/** Browser heading margins at those sizes (paragraphFormat's defaults). */
const HEADING_SPACE_PT = [16.1, 14.9, 14, 16, 16.6, 18.7];

export const NORMAL = "Normal";

export const BUILTIN_STYLES: StyleDef[] = [
  { id: NORMAL, name: "Normal", type: "paragraph", builtin: true, order: 0, next: NORMAL, pPr: { spaceBefore: 0, spaceAfter: 9 } },
  { id: "NoSpacing", name: "No Spacing", type: "paragraph", basedOn: NORMAL, builtin: true, order: 1, pPr: { spaceBefore: 0, spaceAfter: 0 } },
  {
    id: "Title", name: "Title", type: "paragraph", basedOn: NORMAL, next: NORMAL, builtin: true, order: 2,
    pPr: { spaceAfter: 3, keepNext: true }, rPr: { fontSize: 26 },
  },
  {
    id: "Subtitle", name: "Subtitle", type: "paragraph", basedOn: NORMAL, next: NORMAL, builtin: true, order: 3,
    pPr: { spaceAfter: 16, keepNext: true }, rPr: { fontSize: 15, color: "#666666" },
  },
  ...HEADING_PT.map(
    (size, i): StyleDef => ({
      id: `Heading${i + 1}`,
      name: `Heading ${i + 1}`,
      type: "paragraph",
      basedOn: NORMAL,
      next: NORMAL,
      builtin: true,
      order: 10 + i,
      headingLevel: i + 1,
      pPr: {
        keepNext: true,
        keepLines: true,
        outlineLevel: i + 1,
        spaceBefore: HEADING_SPACE_PT[i],
        spaceAfter: HEADING_SPACE_PT[i],
      },
      rPr: { bold: true, fontSize: size },
    }),
  ),
  {
    id: "Quote", name: "Quote", type: "paragraph", basedOn: NORMAL, next: NORMAL, builtin: true, order: 20,
    pPr: { indLeft: 36, indRight: 36, align: "center" }, rPr: { italic: true, color: "#404040" },
  },
  {
    id: "IntenseQuote", name: "Intense Quote", type: "paragraph", basedOn: NORMAL, next: NORMAL, builtin: true, order: 21,
    pPr: {
      indLeft: 43, indRight: 43, align: "center", spaceBefore: 18, spaceAfter: 18,
      borders: { top: { width: 0.5, style: "solid", color: "#1a73e8" }, bottom: { width: 0.5, style: "solid", color: "#1a73e8" } },
    },
    rPr: { italic: true, color: "#1a73e8" },
  },
  { id: "ListParagraph", name: "List Paragraph", type: "paragraph", basedOn: NORMAL, builtin: true, order: 22, pPr: { indLeft: 36 } },
  { id: "Caption", name: "Caption", type: "paragraph", basedOn: NORMAL, builtin: true, order: 23, pPr: { spaceAfter: 10 }, rPr: { italic: true, fontSize: 9, color: "#44546a" } },
  // Character styles.
  { id: "Emphasis", name: "Emphasis", type: "character", builtin: true, order: 40, rPr: { italic: true } },
  { id: "Strong", name: "Strong", type: "character", builtin: true, order: 41, rPr: { bold: true } },
  { id: "SubtleEmphasis", name: "Subtle Emphasis", type: "character", builtin: true, order: 42, rPr: { italic: true, color: "#404040" } },
  { id: "IntenseEmphasis", name: "Intense Emphasis", type: "character", builtin: true, order: 43, rPr: { italic: true, color: "#1a73e8" } },
  { id: "BookTitle", name: "Book Title", type: "character", builtin: true, order: 44, rPr: { bold: true, italic: true } },
];

const BUILTIN = new Map(BUILTIN_STYLES.map((s) => [s.id, s]));

export const headingStyleId = (level: number) => `Heading${level}`;

// --- the style sheet ---------------------------------------------------------------------

/** A stored entry: a full definition, or a tombstone for a deleted custom
 *  style (so concurrent edits do not resurrect it). */
type Stored = StyleDef | { id: string; deleted: true };

/** StyleSheet reads and writes the `styles` Yjs map. */
export class StyleSheet {
  constructor(readonly map: Y.Map<unknown>) {}

  /** get returns a style (override, custom or built-in), or undefined. */
  get(id: string | null | undefined): StyleDef | undefined {
    if (!id) return undefined;
    const s = this.map.get(id) as Stored | undefined;
    if (s && "deleted" in s) return undefined;
    return (s as StyleDef | undefined) ?? BUILTIN.get(id);
  }

  /** all lists every live style in gallery order. */
  all(type?: StyleType): StyleDef[] {
    const ids = new Set<string>([...BUILTIN.keys(), ...this.map.keys()]);
    const out: StyleDef[] = [];
    for (const id of ids) {
      const s = this.get(id);
      if (s && (!type || s.type === type)) out.push(s);
    }
    return out.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
  }

  byName(name: string): StyleDef | undefined {
    const n = name.trim().toLowerCase();
    return this.all().find((s) => s.name.toLowerCase() === n);
  }

  /** isCustomized: the style or an ancestor is stored in the map. */
  isCustomized(id: string): boolean {
    return this.chain(id).some((s) => this.map.has(s.id));
  }

  /** chain lists a style and its basedOn ancestors, leaf first. */
  chain(id: string | null | undefined): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let s = this.get(id);
    while (s && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
      s = this.get(s.basedOn);
    }
    return out;
  }

  put(def: StyleDef): void {
    this.map.set(def.id, JSON.parse(JSON.stringify(def)) as StyleDef);
  }

  /** remove deletes a custom style or restores a built-in to its default. */
  remove(id: string): void {
    if (BUILTIN.has(id)) this.map.delete(id);
    else this.map.set(id, { id, deleted: true });
  }

  /** uniqueId turns a display name into an unused style id. */
  uniqueId(name: string): string {
    const base = name.replace(/[^A-Za-z0-9_-]+/g, "") || "Style";
    let id = base;
    for (let i = 2; this.get(id) || this.map.has(id); i++) id = `${base}${i}`;
    return id;
  }
}

// --- compiling -------------------------------------------------------------------------------

function clean<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** compileStyle merges a style's basedOn chain (root first, leaf wins). */
export function compileStyle(sheet: StyleSheet, id: string | null | undefined): { pPr: ParaPr; rPr: RunPr } {
  const chain = sheet.chain(id).reverse();
  const pPr: ParaPr = {};
  const rPr: RunPr = {};
  for (const s of chain) {
    Object.assign(pPr, clean(s.pPr ?? {}));
    Object.assign(rPr, clean(s.rPr ?? {}));
  }
  return { pPr, rPr };
}

/** paragraphStyleId returns the style a paragraph or heading node uses. A
 *  heading follows its styleId only when that style is a heading style of
 *  the same level (so a styleId left over from setNode never disagrees with
 *  the heading level); otherwise it is "Heading <level>". */
export function paragraphStyleId(sheet: StyleSheet, node: PMNode): string {
  const sid = node.attrs.styleId as string | null | undefined;
  if (node.type.name === "heading") {
    const level = node.attrs.level as number;
    if (sid && headingLevelOf(sheet, sid) === level) return sid;
    return headingStyleId(level);
  }
  if (sid && sheet.get(sid)?.type === "paragraph") return sid;
  return NORMAL;
}

/** headingLevelOf returns the heading level a style maps to through its
 *  chain (a custom style based on Heading 2 is a level-2 heading). */
export function headingLevelOf(sheet: StyleSheet, id: string): number | null {
  for (const s of sheet.chain(id)) if (s.headingLevel) return s.headingLevel;
  return null;
}

/** Level properties of a list, for compileParaPr (numbering.ts). */
export type LevelParaPr = (numId: string, lvl: number) => { indLeft?: number; indFirstLine?: number } | null;

export interface CompiledParaPr extends ParaPr {
  indLeft: number;
  indRight: number;
  indFirstLine: number;
  align: NonNullable<DirectParaProps["align"]>;
}

/** directParaPr reads a node's direct props including its direct numbering. */
export function directParaPr(node: PMNode): ParaPr {
  const p: ParaPr = directProps(node);
  const numId = node.attrs.numId as string | null | undefined;
  if (numId != null) {
    p.numId = String(numId);
    p.numLvl = (node.attrs.numLvl as number | null) ?? 0;
  }
  return p;
}

/**
 * compileParaPr computes a paragraph's effective properties, in Word's
 * order:
 *
 *   1. defaults (no indent, left aligned);
 *   2. when the numbering comes from the style (no direct numbering, or
 *      direct numbering equal to the style's): the list level's indents,
 *      then the style chain — the style's own indents win;
 *      otherwise the style chain, then the direct list level's indents;
 *   3. direct numbering "0" (numbering switched off) clears the left and
 *      first-line indents a list would have given;
 *   4. direct paragraph properties.
 */
export function compileParaPr(
  sheet: StyleSheet,
  node: PMNode,
  levelPr: LevelParaPr = () => null,
): CompiledParaPr {
  const styleId = paragraphStyleId(sheet, node);
  const style = compileStyle(sheet, styleId).pPr;
  const direct = directParaPr(node);
  const out: CompiledParaPr = { indLeft: 0, indRight: 0, indFirstLine: 0, align: "left" };

  const styleNum = style.numId && style.numId !== "0" ? { numId: style.numId, lvl: style.numLvl ?? 0 } : null;
  const directNum = direct.numId != null ? { numId: direct.numId, lvl: direct.numLvl ?? 0 } : null;
  const fromStyle =
    !directNum || (styleNum && directNum.numId === styleNum.numId && directNum.lvl === styleNum.lvl);
  const eff = fromStyle ? styleNum : directNum && directNum.numId !== "0" ? directNum : null;
  const lvlPr = eff ? levelPr(eff.numId, eff.lvl) : null;

  if (fromStyle && lvlPr) Object.assign(out, clean(lvlPr));
  Object.assign(out, clean(style));
  if (!fromStyle && lvlPr) Object.assign(out, clean(lvlPr));
  if (directNum?.numId === "0") {
    out.indLeft = 0;
    out.indFirstLine = 0;
  }
  const { numId: _n, numLvl: _l, ...directRest } = direct;
  Object.assign(out, clean(directRest));
  if (directNum) {
    out.numId = directNum.numId;
    out.numLvl = directNum.lvl;
  } else {
    out.numId = style.numId ?? null;
    out.numLvl = style.numLvl ?? null;
  }
  return out;
}

// --- CSS -------------------------------------------------------------------------------

const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;

/** runPrCss renders run properties as CSS declarations. */
export function runPrCss(r: RunPr): string[] {
  const css: string[] = [];
  if (r.bold !== undefined) css.push(`font-weight: ${r.bold ? 700 : 400}`);
  if (r.italic !== undefined) css.push(`font-style: ${r.italic ? "italic" : "normal"}`);
  const deco = [r.underline && "underline", r.strike && "line-through"].filter(Boolean);
  if (r.underline !== undefined || r.strike !== undefined)
    css.push(`text-decoration: ${deco.length ? deco.join(" ") : "none"}`);
  if (r.smallCaps) css.push("font-variant: small-caps");
  if (r.allCaps) css.push("text-transform: uppercase");
  if (r.fontFamily) css.push(`font-family: ${r.fontFamily}`);
  if (r.fontSize) css.push(`font-size: ${pt(r.fontSize)}`);
  if (r.color) css.push(`color: ${r.color}`);
  if (r.highlight) css.push(`background-color: ${r.highlight}`);
  return css;
}

/** paraPrCss renders (style-level) paragraph properties as CSS. */
export function paraPrCss(p: ParaPr): string[] {
  const css: string[] = [];
  if (p.indLeft !== undefined) css.push(`margin-left: ${pt(p.indLeft)}`);
  if (p.indRight !== undefined) css.push(`margin-right: ${pt(p.indRight)}`);
  if (p.indFirstLine !== undefined) css.push(`text-indent: ${pt(p.indFirstLine)}`);
  if (p.align) css.push(`text-align: ${p.align}`);
  if (p.spaceBefore !== undefined) css.push(`margin-top: ${pt(p.spaceBefore)}`);
  if (p.spaceAfter !== undefined) css.push(`margin-bottom: ${pt(p.spaceAfter)}`);
  if (p.lineValue !== undefined)
    css.push(`line-height: ${lineHeightCss(p.lineRule, p.lineRule && p.lineRule !== "auto" ? pt(p.lineValue) : p.lineValue)}`);
  if (p.keepNext) css.push("break-after: avoid");
  if (p.keepLines) css.push("break-inside: avoid");
  if (p.widowControl === false) css.push("widows: 1", "orphans: 1");
  if (p.pageBreakBefore) css.push("break-before: page");
  if (p.shading) css.push(`background-color: ${p.shading}`);
  if (p.borders) css.push(...bordersCss(p.borders));
  return css;
}

/** styleDeclarations is a style's full compiled CSS (paragraph + run). */
export function styleDeclarations(sheet: StyleSheet, id: string): string {
  const { pPr, rPr } = compileStyle(sheet, id);
  const s = sheet.get(id);
  const decl = s?.type === "character" ? runPrCss(rPr) : [...paraPrCss(pPr), ...runPrCss(rPr)];
  return decl.join("; ");
}

/**
 * styleCss generates the stylesheet for one editor (`scope` is a selector
 * for its root). Built-in Normal and Heading 1-6 already look right through
 * the editor's base CSS, so they only get rules once they (or an ancestor)
 * are customised; every other style always gets one.
 */
export function styleCss(sheet: StyleSheet, scope: string): string {
  const rules: string[] = [];
  for (const s of sheet.all()) {
    const decl = styleDeclarations(sheet, s.id);
    if (!decl) continue;
    const customized = sheet.isCustomized(s.id);
    let sel: string;
    if (s.type === "character") sel = `${scope} [data-cstyle="${s.id}"]`;
    else if (s.id === NORMAL) {
      if (!customized) continue;
      sel = `${scope} p:not([data-style])`;
    } else if (s.headingLevel && s.builtin)
      // Heading nodes already look right; a paragraph that cannot be a
      // heading (first paragraph of a list item) still gets the look.
      sel = customized
        ? `${scope} h${s.headingLevel}:not([data-style]), ${scope} [data-style="${s.id}"]`
        : `${scope} p[data-style="${s.id}"]`;
    else sel = `${scope} [data-style="${s.id}"]`;
    rules.push(`${sel} { ${decl}; }`);
  }
  return rules.join("\n");
}

// --- reading the selection ----------------------------------------------------------------

/** marksRunPr reads run properties from a text node's marks. */
export function marksRunPr(node: PMNode | null | undefined): RunPr {
  const r: RunPr = {};
  for (const m of node?.marks ?? []) {
    const n = m.type.name;
    if (n === "bold") r.bold = true;
    else if (n === "italic") r.italic = true;
    else if (n === "underline") r.underline = true;
    else if (n === "strike") r.strike = true;
    else if (n === "highlight") r.highlight = (m.attrs.color as string) || "#ffff00";
    else if (n === "textStyle") {
      if (m.attrs.fontFamily) r.fontFamily = m.attrs.fontFamily as string;
      if (m.attrs.fontSize) {
        const v = parseFloat(String(m.attrs.fontSize));
        if (Number.isFinite(v)) r.fontSize = /px$/.test(String(m.attrs.fontSize)) ? v * 0.75 : v;
      }
      if (m.attrs.color) r.color = m.attrs.color as string;
    }
  }
  return r;
}

/**
 * displayStyle is the style the toolbar shows for the selection, following
 * OnlyOffice's rules:
 *   * caret: the character style of the character before the caret, else
 *     the paragraph's style;
 *   * selection: if it contains text (not only spaces), the one character
 *     style all of that text shares; if it is only spaces, the style of the
 *     first run; with no character style, the paragraphs' common style;
 *   * paragraphs with different styles show nothing (null).
 */
export function displayStyle(sheet: StyleSheet, state: EditorState): StyleDef | null {
  const { from, to, empty, $from } = state.selection;
  const charStyleOf = (n: PMNode | null | undefined) =>
    (n?.marks.find((m) => m.type.name === "charStyle")?.attrs.styleId as string | undefined) ?? null;

  let cs: string | null = null;
  if (empty) {
    cs = charStyleOf($from.nodeBefore ?? ($from.parentOffset === 0 ? $from.nodeAfter : null));
  } else {
    const runs: { style: string | null; spaces: boolean }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + node.nodeSize);
      if (e <= s) return false;
      const text = node.text!.slice(s - pos, e - pos);
      runs.push({ style: charStyleOf(node), spaces: !/\S/.test(text) });
      return false;
    });
    const textRuns = runs.filter((r) => !r.spaces);
    if (textRuns.length) {
      const set = new Set(textRuns.map((r) => r.style));
      cs = set.size === 1 ? [...set][0] : null;
    } else if (runs.length) cs = runs[0].style;
  }
  const c = cs ? sheet.get(cs) : undefined;
  if (c) return c;

  const ids = new Set<string>();
  const blocks: PMNode[] = [];
  state.doc.nodesBetween(from, Math.max(from, to), (node) => {
    if (node.isTextblock) {
      blocks.push(node);
      return false;
    }
    return true;
  });
  if (!blocks.length && $from.parent.isTextblock) blocks.push($from.parent);
  for (const b of blocks) {
    if (b.type.name === "paragraph" || b.type.name === "heading") ids.add(paragraphStyleId(sheet, b));
    else ids.add(NORMAL);
  }
  if (ids.size !== 1) return null;
  return sheet.get([...ids][0]) ?? null;
}
