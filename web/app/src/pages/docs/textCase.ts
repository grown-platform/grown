// Change case (Format > Text > Change case). Five modes, matching the set
// word processors offer: Sentence case, lowercase, UPPERCASE, Capitalize Each
// Word and tOGGLE cASE.
//
// The transform works on the document in place: each selected text node is
// rewritten with its own marks, so bold/italic/links/etc. stay on the same
// characters and paragraph boundaries are untouched. Words and sentences are
// judged with the surrounding text of the textblock as context, so a partial
// selection that starts mid-word or mid-sentence behaves like the same
// characters in a whole-paragraph selection.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

export type CaseMode = "sentence" | "lower" | "upper" | "capitalize" | "toggle";

export const CASE_MODES: { mode: CaseMode; label: string }[] = [
  { mode: "sentence", label: "Sentence case." },
  { mode: "lower", label: "lowercase" },
  { mode: "upper", label: "UPPERCASE" },
  { mode: "capitalize", label: "Capitalize Each Word" },
  { mode: "toggle", label: "tOGGLE cASE" },
];

const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();
const isWordChar = (c: string) => isLetter(c) || /[0-9_]/.test(c);
const isSpace = (c: string) => /\s/.test(c);
const isSentenceEnd = (c: string) => c === "." || c === "!" || c === "?";

/**
 * caseChars transforms `chars` (one entry per code point) under `mode`.
 * `before` is the text that precedes chars[0] in the same textblock; it
 * decides whether the first characters start a word or a sentence. Returns one
 * output string per input character, so callers can map results back onto the
 * nodes they came from even when a character changes length (ß -> SS).
 */
export function caseChars(chars: string[], mode: CaseMode, before = ""): string[] {
  const out: string[] = [];
  // Word state: have we seen a word character since the last whitespace?
  let inWord = false;
  // Sentence state: are we waiting for the first letter of a sentence?
  let sentenceStart = true;
  let afterTerminator = false;
  const feed = (c: string) => {
    if (isSpace(c)) {
      inWord = false;
      if (afterTerminator) sentenceStart = true;
      afterTerminator = false;
      return;
    }
    if (isWordChar(c)) inWord = true;
    if (isLetter(c)) sentenceStart = false;
    afterTerminator = isSentenceEnd(c) ? true : afterTerminator && !isWordChar(c);
  };
  for (const c of Array.from(before)) feed(c);

  for (const c of chars) {
    let r = c;
    switch (mode) {
      case "upper":
        r = c.toUpperCase();
        break;
      case "lower":
        r = c.toLowerCase();
        break;
      case "toggle":
        r = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
        break;
      case "capitalize":
        if (isLetter(c)) r = inWord ? c.toLowerCase() : c.toUpperCase();
        break;
      case "sentence":
        if (isLetter(c)) r = sentenceStart ? c.toUpperCase() : c.toLowerCase();
        break;
    }
    out.push(r);
    feed(c);
  }
  return out;
}

/** changeCaseText applies `mode` to a whole string (no preceding context). */
export function changeCaseText(text: string, mode: CaseMode, before = ""): string {
  return caseChars(Array.from(text), mode, before).join("");
}

/** Text of `block` before offset `end` (leaf nodes count as a space, so a
 *  hard break or image ends a word). */
function textBefore(block: PMNode, end: number): string {
  return block.textBetween(0, end, undefined, " ");
}

/**
 * changeCaseTr rewrites the case of every text node between from and to in
 * `tr`, keeping each node's marks. Returns the mapped [from, to].
 */
export function changeCaseTr(
  tr: Transaction,
  from: number,
  to: number,
  mode: CaseMode,
): [number, number] {
  const doc = tr.doc;
  // Collect edits first (document order), then apply end-to-start so earlier
  // positions stay valid.
  const edits: { from: number; to: number; text: string; node: PMNode }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const selFrom = Math.max(from, start);
    const selTo = Math.min(to, start + node.content.size);
    if (selFrom >= selTo) return false;
    let before = textBefore(node, selFrom - start);
    node.forEach((child, offset) => {
      const cFrom = start + offset;
      const cTo = cFrom + child.nodeSize;
      if (!child.isText) {
        if (cTo <= selFrom) return;
        before += " ";
        return;
      }
      const a = Math.max(selFrom, cFrom);
      const b = Math.min(selTo, cTo);
      if (a >= b) return;
      const text = child.text!.slice(a - cFrom, b - cFrom);
      const next = caseChars(Array.from(text), mode, before).join("");
      before += text;
      if (next !== text) edits.push({ from: a, to: b, text: next, node: child });
    });
    return false;
  });
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    tr.replaceWith(e.from, e.to, tr.doc.type.schema.text(e.text, e.node.marks));
  }
  return [tr.mapping.map(from, -1), tr.mapping.map(to, 1)];
}

/**
 * changeCase applies `mode` to the current selection, keeping per-run
 * formatting and paragraph structure. With an empty selection it acts on the
 * word around the caret (as word processors do). Returns false when there is
 * nothing to change.
 */
export function changeCase(editor: Editor, mode: CaseMode): boolean {
  const { state } = editor;
  let { from, to } = state.selection;
  if (from === to) {
    const w = wordAround(state.doc, from);
    if (!w) return false;
    [from, to] = w;
  }
  const hadSelection = !state.selection.empty;
  const tr = state.tr;
  const [nf, nt] = changeCaseTr(tr, from, to, mode);
  if (!tr.docChanged) return false;
  if (hadSelection) {
    try {
      tr.setSelection(TextSelection.create(tr.doc, nf, nt));
    } catch {
      /* keep mapped selection */
    }
  }
  editor.view.dispatch(tr);
  return true;
}

/** wordAround returns the [from, to] of the word touching `pos`, if any. */
export function wordAround(doc: PMNode, pos: number): [number, number] | null {
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.isTextblock) return null;
  const start = $pos.start();
  const text = block.textBetween(0, block.content.size, undefined, "￼");
  let a = pos - start;
  let b = a;
  while (a > 0 && isWordChar(text[a - 1])) a--;
  while (b < text.length && isWordChar(text[b])) b++;
  return a === b ? null : [start + a, start + b];
}
