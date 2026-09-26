// Text operations on the Docs editor that go beyond TipTap's commands:
// inserting text with word-processor options, reading text with explicit
// separators (paragraph, line break, tab, table cell/row), editing text
// just typed (autocorrect-style corrections), run-level colour/shading, and
// Alt+X hex-code-to-character conversion.
//
// All helpers take the TipTap Editor and dispatch one transaction, so they
// undo as a single step and are tracked by Suggesting mode like typing.
import type { Editor } from "@tiptap/core";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import { AllSelection, TextSelection } from "@tiptap/pm/state";

// --- reading text -------------------------------------------------------------

/** Separators used when turning a document range into plain text. The
 *  defaults follow Word's conventions (paragraph mark CRLF, manual line
 *  break CR, tab, cells separated by tab and rows ended by CRLF). */
export interface TextSeparators {
  paraSeparator?: string;
  newLineSeparator?: string;
  tabSymbol?: string;
  tableCellSeparator?: string;
  tableRowSeparator?: string;
}

const DEFAULT_SEPARATORS: Required<TextSeparators> = {
  paraSeparator: "\r\n",
  newLineSeparator: "\r",
  tabSymbol: "\t",
  tableCellSeparator: "\t",
  tableRowSeparator: "\r\n",
};

function inlineText(
  block: PMNode,
  start: number,
  from: number,
  to: number,
  sep: Required<TextSeparators>,
): string {
  let out = "";
  block.forEach((child, offset) => {
    const a = start + offset;
    const b = a + child.nodeSize;
    if (b <= from || a >= to) return;
    if (child.isText) {
      const t = child.text!.slice(Math.max(from, a) - a, Math.min(to, b) - a);
      out += t.split("\t").join(sep.tabSymbol);
    } else if (child.type.name === "hardBreak") {
      out += sep.newLineSeparator;
    }
  });
  return out;
}

/** Serialises the children of `node` (content starting at `start`) that
 *  overlap [from, to). A textblock is followed by the paragraph separator
 *  when the range runs past its end (i.e. includes its paragraph mark). */
function blocksText(
  node: PMNode,
  start: number,
  from: number,
  to: number,
  sep: Required<TextSeparators>,
): string {
  let out = "";
  node.forEach((child, offset) => {
    const a = start + offset;
    const b = a + child.nodeSize;
    if (b <= from || a >= to) return;
    if (child.isTextblock) {
      out += inlineText(child, a + 1, from, to, sep);
      if (to >= b) out += sep.paraSeparator;
    } else if (child.type.name === "table") {
      out += tableText(child, a + 1, from, to, sep);
    } else if (!child.isLeaf) {
      out += blocksText(child, a + 1, from, to, sep);
    }
  });
  return out;
}

function tableText(
  table: PMNode,
  start: number,
  from: number,
  to: number,
  sep: Required<TextSeparators>,
): string {
  let out = "";
  table.forEach((row, rowOffset) => {
    const rowStart = start + rowOffset + 1;
    const cells: string[] = [];
    row.forEach((cell, cellOffset) => {
      const cellStart = rowStart + cellOffset + 1;
      const paras: string[] = [];
      cell.forEach((p, pOffset) => {
        const a = cellStart + pOffset;
        if (p.isTextblock) paras.push(inlineText(p, a + 1, from, to, sep));
        else paras.push(blocksText(p, a + 1, from, to, sep));
      });
      cells.push(paras.join(sep.paraSeparator));
    });
    out += cells.join(sep.tableCellSeparator) + sep.tableRowSeparator;
  });
  return out;
}

/** getText returns the text of [from, to) (default: the whole document) with
 *  explicit separators. */
export function getText(
  editor: Editor,
  opts: TextSeparators = {},
  from = 0,
  to = editor.state.doc.content.size,
): string {
  const sep = { ...DEFAULT_SEPARATORS, ...opts };
  return blocksText(editor.state.doc, 0, from, to, sep);
}

/** getSelectedText returns the selected text. A paragraph mark is included
 *  (as `paraSeparator`) for every paragraph whose end is inside the
 *  selection; select-all therefore ends with one. */
export function getSelectedText(editor: Editor, opts: TextSeparators = {}): string {
  const sel = editor.state.selection;
  if (sel instanceof AllSelection) return getText(editor, opts);
  if (sel.empty) return "";
  return getText(editor, opts, sel.from, sel.to);
}

// --- inserting text -----------------------------------------------------------

export interface AddTextOptions {
  /** Pad the inserted text with a space on each side that touches a
   *  non-space character, so it doesn't glue onto neighbouring words. */
  wrapWithSpaces?: boolean;
}

/** addText inserts `text` at the caret, replacing any selection (select-all
 *  collapses the document into one paragraph holding the text). */
export function addText(editor: Editor, text: string, opts: AddTextOptions = {}): void {
  const { state } = editor;
  const { from, to } = state.selection;
  let insert = text;
  if (opts.wrapWithSpaces) {
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    const prev = $from.parent.isTextblock
      ? $from.parent.textBetween(0, $from.parentOffset, undefined, " ").slice(-1)
      : "";
    const next = $to.parent.isTextblock
      ? $to.parent.textBetween($to.parentOffset, $to.parent.content.size, undefined, " ").slice(0, 1)
      : "";
    if (prev && !/\s/.test(prev)) insert = " " + insert;
    if (next && !/\s/.test(next)) insert = insert + " ";
  }
  const tr = state.tr.insertText(insert, from, to);
  editor.view.dispatch(tr.scrollIntoView());
}

/** textBeforeCaret returns the caret's textblock text up to the caret. */
export function textBeforeCaret(editor: Editor): string {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock) return "";
  return $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
}

/**
 * correctEnteredText replaces `oldText` immediately before the caret with
 * `newText` — the primitive behind autocorrect and IME re-conversion. It
 * does nothing (and returns false) unless the text before the caret really
 * ends with `oldText`.
 */
export function correctEnteredText(editor: Editor, oldText: string, newText: string): boolean {
  const { state } = editor;
  if (!state.selection.empty) return false;
  if (!textBeforeCaret(editor).endsWith(oldText)) return false;
  const to = state.selection.from;
  const from = to - oldText.length;
  const marks = state.doc.resolve(from + (oldText ? 1 : 0)).marks();
  const tr = state.tr;
  if (newText) tr.replaceWith(from, to, state.schema.text(newText, marks));
  else tr.delete(from, to);
  editor.view.dispatch(tr);
  return true;
}

// --- runs, colour and shading -------------------------------------------------

export interface Run {
  from: number;
  to: number;
  marks: readonly Mark[];
}

/** runs lists the inline runs of textblock `node` (content starting at
 *  `start`): maximal spans of inline content with the same marks. */
export function runsOf(node: PMNode, start: number): Run[] {
  const out: Run[] = [];
  node.forEach((child, offset) => {
    const from = start + offset;
    const to = from + child.nodeSize;
    const last = out[out.length - 1];
    if (last && last.to === from && sameMarks(last.marks, child.marks)) last.to = to;
    else out.push({ from, to, marks: child.marks });
  });
  return out;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((m, i) => m.eq(b[i]));
}

/** rgbHex formats RGB components as a lower-case #rrggbb string. */
export function rgbHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
}

/** normaliseColor turns "#ABC", "#AABBCC" or "rgb(1, 2, 3)" into #rrggbb. */
export function normaliseColor(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (m) return rgbHex(+m[1], +m[2], +m[3]);
  return s;
}

/** getTextColor returns the text colour at the start of [from, to) (null for
 *  automatic colour). */
export function getTextColor(editor: Editor, from: number, to: number): string | null {
  let color: string | null = null;
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return !found;
    found = true;
    const ts = node.marks.find((m) => m.type.name === "textStyle");
    color = normaliseColor(ts?.attrs.color as string | undefined);
    return false;
  });
  return color;
}

/** setTextColor sets (or with null clears, i.e. automatic) the text colour of
 *  [from, to), keeping the other textStyle attributes (font, size). */
export function setTextColor(editor: Editor, from: number, to: number, color: string | null): void {
  const { state } = editor;
  const type = state.schema.marks.textStyle;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    const cur = node.marks.find((m) => m.type === type);
    const attrs = { ...(cur?.attrs ?? {}), color: color ? normaliseColor(color) : null };
    const empty = Object.values(attrs).every((v) => v == null);
    if (empty) tr.removeMark(a, b, type);
    else tr.addMark(a, b, type.create(attrs));
    return false;
  });
  editor.view.dispatch(tr);
}

/** getRunShading returns the run background (highlight) colour at `from`. */
export function getRunShading(editor: Editor, from: number, to: number): string | null {
  let color: string | null = null;
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return !found;
    found = true;
    const hl = node.marks.find((m) => m.type.name === "highlight");
    color = hl ? normaliseColor((hl.attrs.color as string) ?? "#ffff00") : null;
    return false;
  });
  return color;
}

/** setRunShading sets (null clears) the background colour of the text in
 *  [from, to). */
export function setRunShading(editor: Editor, from: number, to: number, color: string | null): void {
  const { state } = editor;
  const type = state.schema.marks.highlight;
  const tr = state.tr.removeMark(from, to, type);
  if (color) tr.addMark(from, to, type.create({ color: normaliseColor(color) }));
  editor.view.dispatch(tr);
}

/** setRangeShading shades [from, to): when the range covers whole paragraphs
 *  the paragraphs themselves are shaded (paragraph background), otherwise
 *  the text runs are. */
export function setRangeShading(editor: Editor, from: number, to: number, color: string | null): void {
  const { state } = editor;
  const blocks: { node: PMNode; pos: number }[] = [];
  let whole = true;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const end = start + node.content.size;
    if (from > start || to < end) whole = false;
    blocks.push({ node, pos });
    return false;
  });
  if (!whole || !blocks.length || !blocks.every((b) => "shading" in b.node.attrs)) {
    setRunShading(editor, from, to, color);
    return;
  }
  const tr = state.tr;
  for (const b of blocks) {
    tr.setNodeMarkup(b.pos, undefined, { ...b.node.attrs, shading: color ? normaliseColor(color) : null });
  }
  editor.view.dispatch(tr);
}

/** getParagraphShading returns the background colour of the textblock at
 *  `pos` (null when unshaded). */
export function getParagraphShading(editor: Editor, pos: number): string | null {
  const $p = editor.state.doc.resolve(pos);
  for (let d = $p.depth; d >= 0; d--) {
    const n = $p.node(d);
    if (n.isTextblock) return normaliseColor(n.attrs.shading as string | null);
  }
  return null;
}

// --- Alt+X --------------------------------------------------------------------

const HEX_TAIL = /(?:[uU]\+)?([0-9a-fA-F]{2,6})$/;

/**
 * unicodeToChar converts a hex code point into its character (Word's Alt+X):
 * the selection when it is a hex code (optionally "U+" prefixed), otherwise
 * up to six hex digits before the caret. The new character is selected.
 */
export function unicodeToChar(editor: Editor): boolean {
  const { state } = editor;
  const sel = state.selection;
  let from = sel.from;
  let to = sel.to;
  let hex: string;
  if (sel instanceof AllSelection || !sel.$from.sameParent(sel.$to)) return false;
  if (!sel.empty) {
    const m = /^(?:[uU]\+)?([0-9a-fA-F]{1,6})$/.exec(state.doc.textBetween(from, to));
    if (!m) return false;
    hex = m[1];
  } else {
    const m = HEX_TAIL.exec(textBeforeCaret(editor));
    if (!m) return false;
    hex = m[1];
    from = to - m[0].length;
  }
  const cp = parseInt(hex, 16);
  if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
  const ch = String.fromCodePoint(cp);
  const tr = state.tr.insertText(ch, from, to);
  tr.setSelection(TextSelection.create(tr.doc, from, from + ch.length));
  editor.view.dispatch(tr);
  return true;
}
