// Paragraph-level formatting attributes for paragraphs and headings:
//
//   paragraphSpacing  space before / after (margin-top / margin-bottom)
//   indent            left indent in points (margin-left)
//   shading           paragraph background colour
//
// Spacing is numeric (points). Each side can be set directly or left unset,
// in which case the block type's default applies — Grown's stylesheet gives
// Normal text 0 before and 0.75em after, and headings the browser's heading
// margins. "Add space" restores a non-zero default or falls back to 12pt,
// "remove space" sets the side to 0, and hasSpaceBefore/After report the
// state of the first selected paragraph (what the Format menu toggles on).
// When the added amount equals a paragraph's own default the direct value
// is cleared instead, so the paragraph keeps following its block type.
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

const BLOCK_TYPES = ["paragraph", "heading"];

// --- lengths ------------------------------------------------------------------

/** Base font size the editor stylesheet renders at (16px = 12pt), used to
 *  resolve em lengths. */
const EM_PT = 12;

/** toPt converts a CSS length ("12pt", "16px", "0.5in", "1em", "0") to points. */
export function toPt(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const m = /^(-?[\d.]+)\s*(pt|px|in|cm|mm|em|rem|pc)?$/i.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? "px").toLowerCase()) {
    case "pt":
      return n;
    case "px":
      return n * 0.75;
    case "in":
      return n * 72;
    case "cm":
      return (n * 72) / 2.54;
    case "mm":
      return (n * 72) / 25.4;
    case "pc":
      return n * 12;
    default:
      return n * EM_PT;
  }
}

const fmtPt = (n: number) => `${Math.round(n * 100) / 100}pt`;

// --- spacing model ----------------------------------------------------------------

export interface Spacing {
  before: number;
  after: number;
}

/** Default spacing (pt) per block type, matching what the editor renders
 *  when the paragraph has no direct spacing. */
const HEADING_MARGIN_PT: Record<number, number> = {
  1: 16.1,
  2: 14.9,
  3: 14,
  4: 16,
  5: 16.6,
  6: 18.7,
};

export function defaultSpacing(node: PMNode): Spacing {
  if (node.type.name === "heading") {
    const m = HEADING_MARGIN_PT[node.attrs.level as number] ?? 14;
    return { before: m, after: m };
  }
  return { before: 0, after: 9 };
}

/** Space added by "Add space before/after" when the style gives none. */
export const ADD_SPACE_PT = 12;

/** directSpacing reads a block's own spacing; unset sides are null. */
export function directSpacing(node: PMNode): { before: number | null; after: number | null } {
  const raw = node.attrs.paragraphSpacing as string | null | undefined;
  if (!raw) return { before: null, after: null };
  const [b, a] = String(raw).split("|");
  return { before: toPt(b), after: toPt(a) };
}

/** spacingOf returns a block's effective spacing in points. */
export function spacingOf(node: PMNode): Spacing {
  const d = directSpacing(node);
  const def = defaultSpacing(node);
  return { before: d.before ?? def.before, after: d.after ?? def.after };
}

function encodeSpacing(before: number | null, after: number | null): string | null {
  if (before == null && after == null) return null;
  return `${before == null ? "" : fmtPt(before)}|${after == null ? "" : fmtPt(after)}`;
}

/** selectedBlocks lists the paragraphs/headings the selection touches (the
 *  caret's block for an empty selection). */
export function selectedBlocks(state: EditorState): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, Math.max(to, from), (node, pos) => {
    if (BLOCK_TYPES.includes(node.type.name)) {
      out.push({ node, pos });
      return false;
    }
    return true;
  });
  if (!out.length) {
    const $from = state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (BLOCK_TYPES.includes(n.type.name)) {
        out.push({ node: n, pos: $from.before(d) });
        break;
      }
    }
  }
  return out;
}

/** hasSpaceBefore: does the first selected paragraph have space above it? */
export function hasSpaceBefore(state: EditorState): boolean {
  const b = selectedBlocks(state)[0];
  return !!b && spacingOf(b.node).before > 0;
}

/** hasSpaceAfter: does the first selected paragraph have space below it? */
export function hasSpaceAfter(state: EditorState): boolean {
  const b = selectedBlocks(state)[0];
  return !!b && spacingOf(b.node).after > 0;
}

type Side = "before" | "after";

function setSides(
  tr: Transaction,
  state: EditorState,
  pick: (node: PMNode) => { before?: number | null; after?: number | null },
): void {
  for (const { node, pos } of selectedBlocks(state)) {
    const cur = directSpacing(node);
    const next = pick(node);
    const before = next.before === undefined ? cur.before : next.before;
    const after = next.after === undefined ? cur.after : next.after;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      paragraphSpacing: encodeSpacing(before, after),
    });
  }
}

/** The value "add space" gives every selected paragraph: the first
 *  paragraph's default for that side when it has one, else ADD_SPACE_PT. */
function addValue(state: EditorState, side: Side): number {
  const first = selectedBlocks(state)[0];
  const d = first ? defaultSpacing(first.node)[side] : 0;
  return d > 0 ? d : ADD_SPACE_PT;
}

/** For one paragraph: when the added value is its own default, clear the
 *  direct value so it keeps following its type's default; otherwise set it. */
const addSide = (side: Side, v: number) => (node: PMNode) => ({
  [side]: Math.abs(defaultSpacing(node)[side] - v) < 1e-6 ? null : v,
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphSpacing: {
      /** Legacy CSS-length setter; null leaves a side at its default. */
      setParagraphSpacing: (before: string | null, after: string | null) => ReturnType;
      /** Numeric setter (points); undefined keeps a side, null resets it. */
      setSpacingPt: (spacing: { before?: number | null; after?: number | null }) => ReturnType;
      addSpaceBefore: () => ReturnType;
      removeSpaceBefore: () => ReturnType;
      addSpaceAfter: () => ReturnType;
      removeSpaceAfter: () => ReturnType;
    };
    paragraphIndent: {
      indentParagraph: () => ReturnType;
      outdentParagraph: () => ReturnType;
      setParagraphIndent: (pt: number | null) => ReturnType;
    };
    paragraphShading: {
      setParagraphShading: (color: string | null) => ReturnType;
    };
  }
}

export const ParagraphSpacing = Extension.create({
  name: "paragraphSpacing",
  addOptions() {
    return { types: BLOCK_TYPES };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          // One attribute "before|after" (either side may be empty = default).
          paragraphSpacing: {
            default: null,
            parseHTML: (el) => {
              const e = el as HTMLElement;
              const mt = e.style.marginTop;
              const mb = e.style.marginBottom;
              return mt || mb ? `${mt}|${mb}` : null;
            },
            renderHTML: (attrs) => {
              if (!attrs.paragraphSpacing) return {};
              const [before, after] = String(attrs.paragraphSpacing).split("|");
              const css: string[] = [];
              if (before) css.push(`margin-top: ${before}`);
              if (after) css.push(`margin-bottom: ${after}`);
              return css.length ? { style: css.join("; ") } : {};
            },
          },
        },
      },
    ];
  },
  addCommands() {
    const run =
      (pick: (state: EditorState) => (node: PMNode) => { before?: number | null; after?: number | null }) =>
      () =>
      ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        if (!selectedBlocks(state).length) return false;
        if (dispatch) setSides(tr, state, pick(state));
        return true;
      };
    return {
      setParagraphSpacing:
        (before, after) =>
        ({ tr, state, dispatch }) => {
          if (dispatch)
            setSides(tr, state, () => ({ before: toPt(before), after: toPt(after) }));
          return true;
        },
      setSpacingPt:
        (spacing) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) setSides(tr, state, () => spacing);
          return true;
        },
      addSpaceBefore: run((state) => addSide("before", addValue(state, "before"))),
      removeSpaceBefore: run(() => () => ({ before: 0 })),
      addSpaceAfter: run((state) => addSide("after", addValue(state, "after"))),
      removeSpaceAfter: run(() => () => ({ after: 0 })),
    };
  },
});

// --- indent ---------------------------------------------------------------------

/** One indent step: 0.5in, as Google Docs and the ruler's tab grid use. */
export const INDENT_STEP_PT = 36;
const MAX_INDENT_PT = 7 * 72;

export const ParagraphIndent = Extension.create({
  name: "paragraphIndent",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          indent: {
            default: null,
            parseHTML: (el) => {
              const v = toPt((el as HTMLElement).style.marginLeft);
              return v ? v : null;
            },
            renderHTML: (attrs) =>
              attrs.indent ? { style: `margin-left: ${fmtPt(attrs.indent as number)}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    const shift =
      (delta: number | null) =>
      ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        const blocks = selectedBlocks(state);
        if (!blocks.length) return false;
        if (dispatch) {
          for (const { node, pos } of blocks) {
            const cur = (node.attrs.indent as number | null) ?? 0;
            // Snap to the step grid, like tab stops.
            const next =
              delta == null
                ? 0
                : delta > 0
                  ? Math.min(MAX_INDENT_PT, (Math.floor(cur / delta + 1e-6) + 1) * delta)
                  : Math.max(0, (Math.ceil(cur / -delta - 1e-6) - 1) * -delta);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next || null });
          }
        }
        return true;
      };
    return {
      indentParagraph: () => shift(INDENT_STEP_PT),
      outdentParagraph: () => shift(-INDENT_STEP_PT),
      setParagraphIndent:
        (pt) =>
        ({ tr, state, dispatch }) => {
          if (dispatch)
            for (const { node, pos } of selectedBlocks(state))
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: pt || null });
          return true;
        },
    };
  },
});

// --- shading --------------------------------------------------------------------

export const ParagraphShading = Extension.create({
  name: "paragraphShading",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          shading: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.backgroundColor || null,
            renderHTML: (attrs) =>
              attrs.shading ? { style: `background-color: ${attrs.shading}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphShading:
        (color) =>
        ({ tr, state, dispatch }) => {
          if (dispatch)
            for (const { node, pos } of selectedBlocks(state))
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, shading: color });
          return true;
        },
    };
  },
});
