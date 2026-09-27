// Current word / sentence helpers (OnlyOffice plugin API GetCurrentWord,
// GetCurrentSentence, ReplaceCurrentWord, ReplaceCurrentSentence), used by
// autocorrect-style features and selection commands.
//
// Rules, all within the caret's paragraph:
// * A word is a run of letters, digits and "_". When the caret touches a
//   word on either side, that word is current. Otherwise a run of
//   punctuation next to the caret is (so the caret after a final "." has
//   "." as its word). Whitespace alone gives "".
// * A sentence runs from its first non-space character through its closing
//   punctuation (.!?… and any closing quotes/brackets after them), or to the
//   end of the paragraph. The caret belongs to the first sentence that ends
//   after it, so a caret right after "." (or in the spaces that follow)
//   belongs to the next sentence, and after the last one there is none.
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { blockString, smartReplace } from "./search";

export type UnitPart = "entirely" | "beforeCursor" | "afterCursor";

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);
const isPunct = (c: string | undefined) => !!c && !isWord(c) && !/\s/u.test(c) && c !== "￼";

interface Caret {
  text: string;
  off: number;
  /** Position of the paragraph's first character. */
  start: number;
  /** Field results by offset: a field breaks words but reads as its
   *  result in a sentence (M8). */
  fields: Map<number, string>;
}

function caret(editor: Editor): Caret | null {
  const { $head } = editor.state.selection;
  if (!$head.parent.isTextblock) return null;
  const fields = new Map<number, string>();
  $head.parent.forEach((c, off) => {
    if (c.type.name === "field") fields.set(off, String(c.attrs.result ?? ""));
  });
  return { text: blockString($head.parent), off: $head.parentOffset, start: $head.start(), fields };
}

/** The text of [a, b) with fields read as their results. */
function sliceText(c: Caret, a: number, b: number): string {
  if (!c.fields.size) return c.text.slice(a, b);
  let s = "";
  for (let i = a; i < b; i++) s += c.fields.get(i) ?? c.text[i];
  return s;
}

/** wordRange returns the [from, to) offsets of the word at `off`. */
export function wordRange(text: string, off: number): [number, number] {
  let test: (c: string | undefined) => boolean;
  if (isWord(text[off - 1]) || isWord(text[off])) test = isWord;
  else if (isPunct(text[off - 1]) || isPunct(text[off])) test = isPunct;
  else return [off, off];
  let a = off;
  while (a > 0 && test(text[a - 1])) a--;
  let b = off;
  while (b < text.length && test(text[b])) b++;
  return [a, b];
}

const TERMINATOR = /[.!?…]/u;
const CLOSER = /["'”’)\]»]/u;

/** sentenceRanges splits paragraph text into [start, end) sentence ranges
 *  (leading/trailing spaces excluded). */
export function sentenceRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/u.test(text[i])) i++;
    if (i >= n) break;
    const s = i;
    let e = -1;
    while (i < n) {
      if (TERMINATOR.test(text[i])) {
        while (i < n && TERMINATOR.test(text[i])) i++;
        while (i < n && CLOSER.test(text[i])) i++;
        // A terminator only ends the sentence before a space or the end
        // ("3.5", "e.g.x" stay inside).
        if (i >= n || /\s/u.test(text[i])) {
          e = i;
          break;
        }
        continue;
      }
      i++;
    }
    if (e < 0) {
      e = n;
      while (e > s && /\s/u.test(text[e - 1])) e--;
    }
    out.push([s, e]);
    i = e;
  }
  return out;
}

/** sentenceRange returns the current sentence's [start, end) at `off`, or
 *  null when the caret is after the paragraph's last sentence. */
export function sentenceRange(text: string, off: number): [number, number] | null {
  return sentenceRanges(text).find(([, e]) => e > off) ?? null;
}

function part(range: [number, number], off: number, which: UnitPart): [number, number] {
  const [a, b] = range;
  const mid = Math.min(Math.max(off, a), b);
  if (which === "beforeCursor") return [a, mid];
  if (which === "afterCursor") return [mid, b];
  return [a, b];
}

function unitRange(editor: Editor, unit: "word" | "sentence", which: UnitPart) {
  const c = caret(editor);
  if (!c) return null;
  let r: [number, number] | null;
  if (unit === "word") r = wordRange(c.text, c.off);
  else r = sentenceRange(c.text, c.off);
  if (!r) return { c, from: c.start + c.off, to: c.start + c.off, empty: true };
  const [a, b] = part(r, c.off, which);
  return { c, from: c.start + a, to: c.start + b, empty: false, text: sliceText(c, a, b) };
}

/** getCurrentWord returns the word at the caret (or its part before/after
 *  the caret). */
export function getCurrentWord(editor: Editor, which: UnitPart = "entirely"): string {
  return unitRange(editor, "word", which)?.text ?? "";
}

/** getCurrentSentence returns the sentence at the caret (or its part
 *  before/after the caret). */
export function getCurrentSentence(editor: Editor, which: UnitPart = "entirely"): string {
  return unitRange(editor, "sentence", which)?.text ?? "";
}

function replaceUnit(editor: Editor, unit: "word" | "sentence", text: string, which: UnitPart): boolean {
  const r = unitRange(editor, unit, which);
  if (!r) return false;
  const tr = editor.state.tr;
  const end = smartReplace(tr, editor.state.schema, r.from, r.to, text);
  tr.setSelection(TextSelection.create(tr.doc, end));
  editor.view.dispatch(tr);
  return true;
}

/** replaceCurrentWord replaces the word at the caret (or the part before /
 *  after the caret) with `text`, keeping run formatting; the caret ends
 *  after the new text. */
export function replaceCurrentWord(editor: Editor, text: string, which: UnitPart = "entirely"): boolean {
  return replaceUnit(editor, "word", text, which);
}

/** replaceCurrentSentence is replaceCurrentWord for the current sentence. */
export function replaceCurrentSentence(editor: Editor, text: string, which: UnitPart = "entirely"): boolean {
  return replaceUnit(editor, "sentence", text, which);
}

/** selectCurrentWord / selectCurrentSentence select the unit at the caret. */
export function selectCurrentWord(editor: Editor): boolean {
  return selectUnit(editor, "word");
}
export function selectCurrentSentence(editor: Editor): boolean {
  return selectUnit(editor, "sentence");
}
function selectUnit(editor: Editor, unit: "word" | "sentence"): boolean {
  const r = unitRange(editor, unit, "entirely");
  if (!r || r.empty || r.from === r.to) return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, r.from, r.to)),
  );
  return true;
}
