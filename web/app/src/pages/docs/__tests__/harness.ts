// Headless test harness for the Docs editor (TipTap 2 / ProseMirror).
//
// makeEditor() builds the *same* extension set the app uses
// (buildExtensions) minus Yjs collaboration, mounted on a detached-from-
// network <div> in jsdom. Helpers drive it the way a user would: typeText
// goes through handleTextInput (so input rules and Suggesting see it),
// pressKey goes through the real keymap (see keys.ts).
//
// Ported OnlyOffice cases are tagged in their test title as
//   oo:<path under sdkjs-tests/tests>#<QUnit test name>
// e.g. it("oo:word/change-case/change-case.js#Upper case", ...).
import { afterEach } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection, AllSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import * as Y from "yjs";
import { buildExtensions } from "../extensions";
import { pressKey, pressKeys } from "./keys";

export { pressKey, pressKeys };

// --- jsdom gaps ProseMirror touches when focusing / scrolling -------------
function polyfillLayout() {
  const rect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON() {
        return this;
      },
    }) as DOMRect;
  const rects = () =>
    Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
  if (typeof Range !== "undefined") {
    Range.prototype.getBoundingClientRect ??= rect;
    Range.prototype.getClientRects ??= rects;
  }
  if (typeof Element !== "undefined") {
    Element.prototype.scrollIntoView ??= function () {};
  }
  if (typeof document !== "undefined") {
    document.elementFromPoint ??= () => null;
  }
  // view.pasteHTML / pasteText construct a ClipboardEvent, which jsdom lacks.
  const g = globalThis as { ClipboardEvent?: unknown };
  if (typeof g.ClipboardEvent === "undefined" && typeof Event !== "undefined") {
    g.ClipboardEvent = class ClipboardEvent extends Event {
      clipboardData: DataTransfer | null = null;
    };
  }
}
polyfillLayout();

// --- editor lifecycle -------------------------------------------------------
export interface MakeEditorOpts {
  /** Bind the editor to a Yjs document (see makeSyncedEditors). */
  ydoc?: Y.Doc;
  /** Where to put the caret after load. Default "end". */
  cursor?: "start" | "end" | "all" | number;
  /** Start in Suggesting (track changes) mode. */
  suggesting?: boolean;
  editable?: boolean;
  userName?: string;
}

const live = new Set<Editor>();

afterEach(() => {
  for (const e of live) {
    const el = e.options.element;
    e.destroy();
    el?.remove();
  }
  live.clear();
});

/** makeEditor mounts a headless Grown Docs editor with `html` as content. */
export function makeEditor(html = "<p></p>", opts: MakeEditorOpts = {}): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    content: opts.ydoc ? undefined : html,
    editable: opts.editable ?? true,
    extensions: buildExtensions({
      collab: false,
      ydoc: opts.ydoc,
      userName: opts.userName,
      editable: opts.editable ?? true,
    }),
  });
  live.add(editor);
  if (opts.suggesting) editor.commands.setSuggesting(true);
  const c = opts.cursor ?? "end";
  if (c === "start") setCursor(editor, firstTextPos(editor));
  else if (c === "end") setCursor(editor, lastTextPos(editor));
  else if (c === "all") selectAll(editor);
  else setCursor(editor, c);
  return editor;
}

// --- selection ---------------------------------------------------------------
function firstTextPos(editor: Editor): number {
  return TextSelection.atStart(editor.state.doc).from;
}
function lastTextPos(editor: Editor): number {
  return TextSelection.atEnd(editor.state.doc).from;
}

/** setCursor collapses the selection at a ProseMirror position. */
export function setCursor(editor: Editor, pos: number): void {
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, pos)),
  );
}

/** selectRange selects [from, to) in ProseMirror positions. */
export function selectRange(editor: Editor, from: number, to: number): void {
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, from, to)),
  );
}

/** selectAll selects the whole document (AllSelection). */
export function selectAll(editor: Editor): void {
  const { state } = editor;
  editor.view.dispatch(state.tr.setSelection(new AllSelection(state.doc)));
}

/** textblocks lists the document's textblocks (paragraphs, headings, list
 *  item paragraphs, table-cell paragraphs) in document order with their
 *  start positions (the position just inside the block). */
export function textblocks(editor: Editor): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      out.push({ node, pos: pos + 1 });
      return false;
    }
    return true;
  });
  return out;
}

/** paragraphPos maps (textblock index, char offset) to a ProseMirror
 *  position. Offsets count characters as paragraphText reports them. */
export function paragraphPos(editor: Editor, index: number, offset: number): number {
  const blocks = textblocks(editor);
  const b = blocks[index];
  if (!b) throw new Error(`no textblock ${index} (have ${blocks.length})`);
  let remaining = offset;
  let pos = b.pos;
  let done = false;
  b.node.forEach((child, childOffset) => {
    if (done) return;
    const len = child.isText ? child.text!.length : 1;
    if (remaining <= len) {
      pos = b.pos + childOffset + remaining;
      done = true;
      return;
    }
    remaining -= len;
  });
  if (!done) {
    if (remaining > 0) throw new Error(`offset ${offset} past end of textblock ${index}`);
    pos = b.pos + b.node.content.size;
  }
  return pos;
}

/** selectInParagraph selects chars [start, end) of textblock `index` — the
 *  equivalent of "cursor to paragraph start, move right N with shift". */
export function selectInParagraph(
  editor: Editor,
  index: number,
  start: number,
  end: number,
): void {
  selectRange(editor, paragraphPos(editor, index, start), paragraphPos(editor, index, end));
}

/** selectText selects the `nth` (0-based) occurrence of `needle` in the doc.
 *  Matches within a single textblock only. */
export function selectText(editor: Editor, needle: string, nth = 0): void {
  let seen = 0;
  for (const [i, b] of textblocks(editor).entries()) {
    const text = blockText(b.node);
    let at = text.indexOf(needle);
    while (at !== -1) {
      if (seen++ === nth) {
        selectInParagraph(editor, i, at, at + needle.length);
        return;
      }
      at = text.indexOf(needle, at + 1);
    }
  }
  throw new Error(`"${needle}" (#${nth}) not found in document`);
}

/** selectedText returns the selected text, blocks joined by "\n". */
export function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, "\n", leafText);
}

// --- input ------------------------------------------------------------------
/** typeText types `text` character by character through ProseMirror's
 *  handleTextInput chain (input rules, Suggesting), falling back to a plain
 *  insert exactly as the view does. "\n" presses Enter. */
export function typeText(editor: Editor, text: string): void {
  for (const ch of text) {
    if (ch === "\n") {
      pressKey(editor, "Enter");
      continue;
    }
    const view = editor.view;
    const sel = view.state.selection;
    const { from, to } = sel;
    // Mirror ProseMirror's own input paths: a plain in-block text selection
    // is replaced by range (DOM change path); anything else (AllSelection,
    // node or cross-block selections) goes through replaceSelection, as the
    // view's keypress handler does.
    const inBlock = sel instanceof TextSelection && sel.$from.sameParent(sel.$to);
    const deflt = () =>
      inBlock ? view.state.tr.insertText(ch, from, to) : view.state.tr.insertText(ch);
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, deflt),
    );
    if (!handled) view.dispatch(deflt().scrollIntoView());
  }
}

// --- reading the document ----------------------------------------------------
function leafText(node: PMNode): string {
  if (node.type.name === "hardBreak") return "\n";
  return "";
}
function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, "\n", leafText);
}

/** paragraphText returns the text of textblock `index` (hard breaks as "\n"). */
export function paragraphText(editor: Editor, index = 0): string {
  const b = textblocks(editor)[index];
  if (!b) throw new Error(`no textblock ${index}`);
  return blockText(b.node);
}

/** paragraphTexts returns every textblock's text. */
export function paragraphTexts(editor: Editor): string[] {
  return textblocks(editor).map((b) => blockText(b.node));
}

/** docText returns the whole document's text, textblocks joined by "\n". */
export function docText(editor: Editor): string {
  return paragraphTexts(editor).join("\n");
}

/** marksAt lists mark names on the character at (textblock, offset). */
export function marksAt(editor: Editor, index: number, offset: number): string[] {
  const pos = paragraphPos(editor, index, offset);
  const node = editor.state.doc.nodeAt(pos);
  return (node?.marks ?? []).map((m) => m.type.name).sort();
}

/** blockPaths lists the node type of each textblock's parent chain, e.g.
 *  "bulletList>listItem>paragraph" — handy for list/heading assertions. */
export function blockPaths(editor: Editor): string[] {
  return textblocks(editor).map(({ pos }) => {
    const $p = editor.state.doc.resolve(pos);
    const names: string[] = [];
    for (let d = 1; d <= $p.depth; d++) {
      const n = $p.node(d);
      names.push(
        n.type.name === "heading" ? `heading${n.attrs.level}` : n.type.name,
      );
    }
    return names.join(">");
  });
}

// --- snapshots ---------------------------------------------------------------
/** htmlSnapshot returns the editor's serialised HTML (what export uses). */
export function htmlSnapshot(editor: Editor): string {
  return editor.getHTML();
}

/** jsonSnapshot returns the ProseMirror JSON document. */
export function jsonSnapshot(editor: Editor): JSONContent {
  return editor.getJSON();
}

// --- IME composition -------------------------------------------------------------
/** compose starts an IME composition at the caret. Each update() replaces
 *  the text composed so far (as the browser does while the user picks
 *  candidates); end() commits it and leaves the caret after it. Code-point
 *  arrays are accepted for scripts that are awkward to write literally. */
export function compose(editor: Editor) {
  const start = editor.state.selection.from;
  if (!editor.state.selection.empty) {
    editor.view.dispatch(editor.state.tr.deleteSelection());
  }
  let len = 0;
  return {
    update(text: string | number[]) {
      const t = typeof text === "string" ? text : String.fromCodePoint(...text);
      const tr = editor.state.tr;
      if (t) tr.insertText(t, start, start + len);
      else tr.delete(start, start + len);
      tr.setSelection(TextSelection.create(tr.doc, start + t.length));
      editor.view.dispatch(tr);
      len = t.length;
    },
    end() {},
  };
}

/** composeText enters `text` as one completed composition. */
export function composeText(editor: Editor, text: string): void {
  const c = compose(editor);
  c.update(text);
  c.end();
}

// --- collaboration ---------------------------------------------------------------
/** makeSyncedEditors builds `n` editors on separate Yjs documents. Updates
 *  are exchanged only when the returned sync() is called, so tests can
 *  interleave local edits and synchronisation like a real network. */
export function makeSyncedEditors(n = 2): { editors: Editor[]; docs: Y.Doc[]; sync: () => void } {
  const docs = Array.from({ length: n }, () => new Y.Doc());
  const editors = docs.map((ydoc) => makeEditor("<p></p>", { ydoc }));
  const sync = () => {
    for (let round = 0; round < 2; round++) {
      for (const a of docs)
        for (const b of docs)
          if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    }
  };
  sync();
  return { editors, docs, sync };
}

// --- styles and numbering (M3) ------------------------------------------------------
export { numberingText } from "../docModel";

/** setBlockAttrs merges attributes into textblock `index` (direct paragraph
 *  properties, styleId, numId/numLvl). */
export function setBlockAttrs(editor: Editor, index: number, attrs: Record<string, unknown>): void {
  const b = textblocks(editor)[index];
  if (!b) throw new Error(`no textblock ${index}`);
  const pos = b.pos - 1;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...b.node.attrs, ...attrs }));
}

/** selectBlocks selects whole textblocks [first, last] (OnlyOffice's
 *  SelectDocumentRange). */
export function selectBlocks(editor: Editor, first: number, last: number): void {
  const blocks = textblocks(editor);
  selectRange(editor, blocks[first].pos, blocks[last].pos + blocks[last].node.content.size);
}

// --- track changes (M5) ------------------------------------------------------------------
export { reviewRuns, paragraphReviewType, type ReviewType } from "../changes";
import { reviewRuns, paragraphReviewType, type ReviewType } from "../changes";

/** reviewText reads textblock `index` as [review type, text] runs:
 *  "add" (insertion), "remove" (deletion) or "common". */
export function reviewText(editor: Editor, index = 0): [ReviewType, string][] {
  const b = textblocks(editor)[index];
  if (!b) throw new Error(`no textblock ${index}`);
  return reviewRuns(b.node);
}

/** paragraphReviewTypes lists each textblock's paragraph-mark review type. */
export function paragraphReviewTypes(editor: Editor): ReviewType[] {
  return textblocks(editor).map((b) => paragraphReviewType(b.node));
}

/** reviewHtml builds inline HTML for runs with review types (the default
 *  author is the harness user, "Test user"). */
export function reviewHtml(runs: { text: string; type?: ReviewType; author?: string; tag?: "strong" | "em" }[]): string {
  return runs
    .map(({ text, type, author = "Test user", tag }) => {
      let h = tag ? `<${tag}>${text}</${tag}>` : text;
      if (type === "add") h = `<span data-suggestion="insert" data-author="${author}">${h}</span>`;
      if (type === "remove") h = `<span data-suggestion="delete" data-author="${author}">${h}</span>`;
      return h;
    })
    .join("");
}
