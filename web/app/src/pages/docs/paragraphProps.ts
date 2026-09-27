// Paragraph properties (Docs M3): the Word/OnlyOffice paragraph attributes
// that were missing after M1, added to paragraphs and headings as additive
// global attributes (same pattern as LineHeight / ParagraphSpacing):
//
//   indentRight      right indent, points            margin-right
//   indentFirstLine  first-line indent, points;      text-indent
//                    negative = hanging indent
//   lineRule         "auto" | "exact" | "atLeast"    how lineHeight is read
//   tabs             tab stops "72l,144c.,216r"      data-tabs (+ tab-size)
//   keepNext         keep with next                  break-after: avoid
//   keepLines        keep lines together             break-inside: avoid
//   widowControl     false = off (default on)        widows/orphans
//   pageBreakBefore  page break before               break-before: page
//   borders          JSON {top,bottom,left,right,between?} of "w style color"
//   outlineLevel     1-9 (inherit = null, body text = 10) data-outline-level
//
// The left indent (`indent`), space before/after and shading stay in
// paragraphFormat.ts (M1); line height multiples stay in LineHeight.
//
// Every value is stored as a string or number (never an object) so
// y-prosemirror can compare attributes without churning Yjs updates.
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { selectedBlocks, toPt } from "./paragraphFormat";

const BLOCK_TYPES = ["paragraph", "heading"];

const fmtPt = (n: number) => `${Math.round(n * 100) / 100}pt`;

// --- tab stops ------------------------------------------------------------------

export type TabAlign = "left" | "center" | "right" | "decimal";
export type TabLeader = "none" | "dot" | "hyphen" | "underscore";

export interface TabStop {
  /** Position in points from the paragraph's left indent. */
  pos: number;
  align: TabAlign;
  leader: TabLeader;
}

const ALIGN_CODE: Record<TabAlign, string> = { left: "l", center: "c", right: "r", decimal: "d" };
const LEADER_CODE: Record<TabLeader, string> = { none: "", dot: ".", hyphen: "-", underscore: "_" };

/** encodeTabs writes tab stops as "72l,144c.,216r" (sorted, deduplicated). */
export function encodeTabs(tabs: TabStop[]): string | null {
  if (!tabs.length) return null;
  const seen = new Map<number, TabStop>();
  for (const t of tabs) seen.set(Math.round(t.pos * 100) / 100, t);
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pos, t]) => `${pos}${ALIGN_CODE[t.align]}${LEADER_CODE[t.leader]}`)
    .join(",");
}

/** parseTabs reads the encoded form back. Unknown entries are skipped. */
export function parseTabs(raw: string | null | undefined): TabStop[] {
  if (!raw) return [];
  const out: TabStop[] = [];
  for (const part of String(raw).split(",")) {
    const m = /^(-?[\d.]+)([lcrd])([._-]?)$/.exec(part.trim());
    if (!m) continue;
    const align = (Object.keys(ALIGN_CODE) as TabAlign[]).find((k) => ALIGN_CODE[k] === m[2])!;
    const leader = (Object.keys(LEADER_CODE) as TabLeader[]).find((k) => LEADER_CODE[k] === m[3])!;
    out.push({ pos: parseFloat(m[1]), align, leader });
  }
  return out;
}

// --- borders ----------------------------------------------------------------------

export type BorderSide = "top" | "bottom" | "left" | "right" | "between";
export interface BorderSpec {
  /** Width in points. */
  width: number;
  style: "solid" | "dashed" | "dotted" | "double";
  color: string;
}
export type Borders = Partial<Record<BorderSide, BorderSpec>>;

export function encodeBorders(b: Borders): string | null {
  const keys = (Object.keys(b) as BorderSide[]).filter((k) => b[k]);
  if (!keys.length) return null;
  const o: Record<string, string> = {};
  for (const k of keys.sort()) {
    const s = b[k]!;
    o[k] = `${s.width} ${s.style} ${s.color}`;
  }
  return JSON.stringify(o);
}

export function parseBorders(raw: string | null | undefined): Borders {
  if (!raw) return {};
  try {
    const o = JSON.parse(String(raw)) as Record<string, string>;
    const out: Borders = {};
    for (const [k, v] of Object.entries(o)) {
      const m = /^([\d.]+)\s+(solid|dashed|dotted|double)\s+(\S+)$/.exec(v);
      if (m) out[k as BorderSide] = { width: parseFloat(m[1]), style: m[2] as BorderSpec["style"], color: m[3] };
    }
    return out;
  } catch {
    return {};
  }
}

/** bordersCss renders borders as CSS declarations (with a little padding so
 *  the text does not touch the line, as Word's default 1pt spacing does). */
export function bordersCss(b: Borders): string[] {
  const css: string[] = [];
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const s = b[side];
    if (!s) continue;
    css.push(`border-${side}: ${fmtPt(s.width)} ${s.style} ${s.color}`);
    css.push(`padding-${side}: 4pt`);
  }
  return css;
}

// --- line spacing -----------------------------------------------------------------

export type LineRule = "auto" | "exact" | "atLeast";

/** lineHeightCss turns a (rule, value) pair into a CSS line-height. "auto"
 *  values are multiples ("1.15"); exact/atLeast values are lengths ("14pt").
 *  At-least uses max() against single spacing. */
export function lineHeightCss(rule: LineRule | null | undefined, value: string | number): string {
  const v = typeof value === "number" ? String(value) : value;
  if (rule === "exact") return /[a-z]/i.test(v) ? v : `${v}pt`;
  if (rule === "atLeast") return `max(1.15em, ${/[a-z]/i.test(v) ? v : `${v}pt`})`;
  return v;
}

/** parseLineHeight inverts lineHeightCss: the stored lineHeight attribute
 *  and lineRule back to a rule and a number (multiple or points). */
export function parseLineHeight(
  raw: string | null | undefined,
  rule: LineRule | null | undefined,
): { rule: LineRule; value: number } | null {
  if (!raw) return null;
  const s = String(raw);
  const m = /^max\(\s*[\d.]+em\s*,\s*([^)]+)\)$/.exec(s);
  if (m) return { rule: "atLeast", value: toPt(m[1]) ?? 12 };
  if (rule === "exact" || rule === "atLeast" || /[a-z]/i.test(s))
    return { rule: rule === "atLeast" ? "atLeast" : "exact", value: toPt(s) ?? 12 };
  const n = parseFloat(s);
  return Number.isFinite(n) ? { rule: "auto", value: n } : null;
}

// --- the direct-props view -----------------------------------------------------------

export type Align = "left" | "center" | "right" | "justify";

/** DirectParaProps are one paragraph's own (not inherited) properties, all
 *  lengths in points. Unset properties are undefined. */
export interface DirectParaProps {
  indLeft?: number;
  indRight?: number;
  indFirstLine?: number;
  align?: Align;
  spaceBefore?: number;
  spaceAfter?: number;
  lineRule?: LineRule;
  /** Multiple (auto) or points (exact / at least). */
  lineValue?: number;
  tabs?: TabStop[];
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  borders?: Borders;
  shading?: string;
  outlineLevel?: number;
}

/** directProps reads a paragraph/heading node's direct properties. */
export function directProps(node: PMNode): DirectParaProps {
  const a = node.attrs;
  const p: DirectParaProps = {};
  if (a.indent != null) p.indLeft = a.indent as number;
  if (a.indentRight != null) p.indRight = a.indentRight as number;
  if (a.indentFirstLine != null) p.indFirstLine = a.indentFirstLine as number;
  if (a.textAlign && a.textAlign !== "left") p.align = a.textAlign as Align;
  if (a.paragraphSpacing) {
    const [b, af] = String(a.paragraphSpacing).split("|");
    const bb = toPt(b);
    const aa = toPt(af);
    if (bb != null) p.spaceBefore = bb;
    if (aa != null) p.spaceAfter = aa;
  }
  const lh = parseLineHeight(a.lineHeight as string | null, a.lineRule as LineRule | null);
  if (lh) {
    p.lineRule = lh.rule;
    p.lineValue = lh.value;
  }
  const tabs = parseTabs(a.tabs as string | null);
  if (tabs.length) p.tabs = tabs;
  if (a.keepNext) p.keepNext = true;
  if (a.keepLines) p.keepLines = true;
  if (a.widowControl === false) p.widowControl = false;
  if (a.pageBreakBefore) p.pageBreakBefore = true;
  const borders = parseBorders(a.borders as string | null);
  if (Object.keys(borders).length) p.borders = borders;
  if (a.shading) p.shading = a.shading as string;
  if (a.outlineLevel != null) p.outlineLevel = a.outlineLevel as number;
  return p;
}

/** propsToAttrs maps a (partial) props object to node attributes. A key
 *  present with value undefined/null clears that property. */
export function propsToAttrs(p: Partial<Record<keyof DirectParaProps, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (k: keyof DirectParaProps) => Object.prototype.hasOwnProperty.call(p, k);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  if (has("indLeft")) out.indent = num(p.indLeft) || null;
  if (has("indRight")) out.indentRight = num(p.indRight) || null;
  if (has("indFirstLine")) out.indentFirstLine = num(p.indFirstLine) || null;
  if (has("align")) out.textAlign = (p.align as string) ?? "left";
  if (has("lineRule") || has("lineValue")) {
    const rule = (p.lineRule as LineRule | undefined) ?? "auto";
    const v = num(p.lineValue);
    out.lineRule = v == null || rule === "auto" ? null : rule;
    out.lineHeight =
      v == null ? null : rule === "auto" ? String(v) : lineHeightCss(rule, fmtPt(v));
  }
  if (has("tabs")) out.tabs = encodeTabs((p.tabs as TabStop[] | undefined) ?? []);
  if (has("keepNext")) out.keepNext = p.keepNext ? true : null;
  if (has("keepLines")) out.keepLines = p.keepLines ? true : null;
  if (has("widowControl")) out.widowControl = p.widowControl === false ? false : null;
  if (has("pageBreakBefore")) out.pageBreakBefore = p.pageBreakBefore ? true : null;
  if (has("borders")) out.borders = encodeBorders((p.borders as Borders | undefined) ?? {});
  if (has("shading")) out.shading = (p.shading as string | undefined) || null;
  if (has("outlineLevel")) out.outlineLevel = num(p.outlineLevel);
  return out;
}

/** setParagraphProps applies (partial) direct props to every selected
 *  paragraph. Space before/after go through the M1 spacing attribute. */
export function applyParagraphProps(
  tr: Transaction,
  state: EditorState,
  props: Partial<Record<keyof DirectParaProps, unknown>>,
): void {
  const attrs = propsToAttrs(props);
  const hasB = Object.prototype.hasOwnProperty.call(props, "spaceBefore");
  const hasA = Object.prototype.hasOwnProperty.call(props, "spaceAfter");
  for (const { node, pos } of selectedBlocks(state)) {
    const next: Record<string, unknown> = { ...node.attrs, ...attrs };
    if (hasB || hasA) {
      const [b0, a0] = String(node.attrs.paragraphSpacing ?? "|").split("|");
      const b = hasB ? (props.spaceBefore as number | null | undefined) : toPt(b0);
      const a = hasA ? (props.spaceAfter as number | null | undefined) : toPt(a0);
      next.paragraphSpacing =
        b == null && a == null ? null : `${b == null ? "" : fmtPt(b)}|${a == null ? "" : fmtPt(a)}`;
    }
    tr.setNodeMarkup(pos, undefined, next);
  }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphProps: {
      /** Set direct paragraph properties on the selected paragraphs. A key
       *  given as null clears that property. */
      setParagraphProps: (props: Partial<Record<keyof DirectParaProps, unknown>>) => ReturnType;
      /** Left / right / first-line indents in points (null clears). */
      setIndents: (ind: { left?: number | null; right?: number | null; firstLine?: number | null }) => ReturnType;
    };
  }
}

// Attributes parse from HTML (so pasted Word/HTML keeps them) and render
// as inline CSS / data attributes (so export keeps them).
export const ParagraphProps = Extension.create({
  name: "paragraphProps",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          indentRight: {
            default: null,
            parseHTML: (el) => toPt((el as HTMLElement).style.marginRight) || null,
            renderHTML: (a) =>
              a.indentRight ? { style: `margin-right: ${fmtPt(a.indentRight as number)}` } : {},
          },
          indentFirstLine: {
            default: null,
            parseHTML: (el) => toPt((el as HTMLElement).style.textIndent) || null,
            renderHTML: (a) =>
              a.indentFirstLine != null
                ? { style: `text-indent: ${fmtPt(a.indentFirstLine as number)}` }
                : {},
          },
          lineRule: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-line-rule") || null,
            renderHTML: (a) => (a.lineRule ? { "data-line-rule": String(a.lineRule) } : {}),
          },
          tabs: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-tabs") || null,
            renderHTML: (a) => {
              if (!a.tabs) return {};
              const first = parseTabs(a.tabs as string)[0];
              // CSS has one tab width per element; the first stop is the
              // closest approximation until pagination lays out tabs (M9).
              return first && first.pos > 0
                ? { "data-tabs": String(a.tabs), style: `tab-size: ${Math.round(first.pos / 0.75)}px` }
                : { "data-tabs": String(a.tabs) };
            },
          },
          keepNext: {
            default: null,
            parseHTML: (el) => ((el as HTMLElement).style.breakAfter === "avoid" ? true : null),
            renderHTML: (a) => (a.keepNext ? { style: "break-after: avoid", "data-keep-next": "" } : {}),
          },
          keepLines: {
            default: null,
            parseHTML: (el) => ((el as HTMLElement).style.breakInside === "avoid" ? true : null),
            renderHTML: (a) =>
              a.keepLines ? { style: "break-inside: avoid", "data-keep-lines": "" } : {},
          },
          widowControl: {
            default: null,
            parseHTML: (el) => ((el as HTMLElement).style.widows === "1" ? false : null),
            renderHTML: (a) => (a.widowControl === false ? { style: "widows: 1; orphans: 1" } : {}),
          },
          pageBreakBefore: {
            default: null,
            // A page break belongs to the first half only when splitting.
            keepOnSplit: false,
            parseHTML: (el) => ((el as HTMLElement).style.breakBefore === "page" ? true : null),
            renderHTML: (a) =>
              a.pageBreakBefore ? { style: "break-before: page", "data-page-break-before": "" } : {},
          },
          borders: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-borders") || null,
            renderHTML: (a) => {
              if (!a.borders) return {};
              const css = bordersCss(parseBorders(a.borders as string));
              return css.length
                ? { "data-borders": String(a.borders), style: css.join("; ") }
                : { "data-borders": String(a.borders) };
            },
          },
          outlineLevel: {
            default: null,
            parseHTML: (el) => {
              const v = parseInt((el as HTMLElement).getAttribute("data-outline-level") ?? "", 10);
              // 10 = body text over a style's outline level (M8 Add text).
              return v >= 1 && v <= 10 ? v : null;
            },
            renderHTML: (a) =>
              a.outlineLevel ? { "data-outline-level": String(a.outlineLevel) } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphProps:
        (props) =>
        ({ tr, state, dispatch }) => {
          if (!selectedBlocks(state).length) return false;
          if (dispatch) applyParagraphProps(tr, state, props);
          return true;
        },
      setIndents:
        (ind) =>
        ({ tr, state, dispatch }) => {
          if (!selectedBlocks(state).length) return false;
          const p: Partial<Record<keyof DirectParaProps, unknown>> = {};
          if (ind.left !== undefined) p.indLeft = ind.left;
          if (ind.right !== undefined) p.indRight = ind.right;
          if (ind.firstLine !== undefined) p.indFirstLine = ind.firstLine;
          if (dispatch) applyParagraphProps(tr, state, p);
          return true;
        },
    };
  },
});
