import { Mark, Extension, mergeAttributes, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping, ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep, AttrStep, type Step } from "@tiptap/pm/transform";
import type { Slice, Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  applyDeletions,
  changeAt,
  collectChanges,
  collectParts,
  formatMarks,
  isFormatMark,
  marksJSON,
  marksKey,
  newChangeId,
  nextTextblockStart,
  nowIso,
  parseParaChange,
  parsePropsChange,
  partsInRange,
  propsAttrs,
  propsKey,
  resolveParts,
  type Deletion,
  type TrackedChange,
} from "./changes";
import { protectionState, REVIEW_RESOLVE } from "./protection";

// Track changes ("Suggesting" mode), v2 (M5). While tracking is on, edits
// are recorded instead of applied destructively:
//   - typed/pasted text gets an `insertion` mark,
//   - deleted text gets a `deletion` mark (your own pending insertions are
//     simply removed, as in Word),
//   - formatting changes get a `formatChange` mark holding the old marks,
//   - inserted/deleted paragraph marks (Enter, joining paragraphs) set the
//     paragraph's `paraChange` attribute; paragraph property changes set
//     `propsChange` with the old properties.
// Every record has an id, author and date (see changes.ts). Accept/Reject
// materialise or discard changes; the records ride the shared Yjs document,
// so suggestions are collaborative for free.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggesting: {
      setSuggesting: (on: boolean) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
      acceptSuggestionRange: (from: number, to: number) => ReturnType;
      rejectSuggestionRange: (from: number, to: number) => ReturnType;
      /** Accept / reject one logical change by id. */
      acceptChange: (id: string) => ReturnType;
      rejectChange: (id: string) => ReturnType;
      /** Accept / reject the change at the caret (or the changes in the
       *  selection). */
      acceptCurrentChange: () => ReturnType;
      rejectCurrentChange: () => ReturnType;
      /** Select the next / previous change (wrapping). */
      nextChange: () => ReturnType;
      previousChange: () => ReturnType;
    };
  }
}

export interface SuggestUser {
  name: string;
  color: string;
}

const INS_COLOR = "#188038";
const DEL_COLOR = "#d93025";

const infoAttrs = () => ({
  author: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-author") || "",
    renderHTML: (a: { author?: string }) => (a.author ? { "data-author": a.author } : {}),
  },
  id: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-change-id") || "",
    renderHTML: (a: { id?: string }) => (a.id ? { "data-change-id": a.id } : {}),
  },
  date: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-date") || "",
    renderHTML: (a: { date?: string }) => (a.date ? { "data-date": a.date } : {}),
  },
});

const suggestAttrs = () => ({
  ...infoAttrs(),
  color: {
    default: INS_COLOR,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-color") || INS_COLOR,
    renderHTML: (a: { color?: string }) => (a.color ? { "data-color": a.color } : {}),
  },
});

export const InsertionMark = Mark.create({
  name: "insertion",
  inclusive: true,
  addAttributes() {
    return suggestAttrs();
  },
  parseHTML() {
    return [{ tag: "span[data-suggestion='insert']" }, { tag: "ins" }];
  },
  renderHTML({ HTMLAttributes }) {
    const color = (HTMLAttributes["data-color"] as string) || INS_COLOR;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-suggestion": "insert",
        class: "suggestion-insert",
        style: `--change-color:${color}`,
      }),
      0,
    ];
  },
});

export const DeletionMark = Mark.create({
  name: "deletion",
  inclusive: false,
  addAttributes() {
    return suggestAttrs();
  },
  parseHTML() {
    return [{ tag: "span[data-suggestion='delete']" }, { tag: "del" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-suggestion": "delete",
        class: "suggestion-delete",
      }),
      0,
    ];
  },
});

/** A tracked formatting change: `old` is the JSON list of the formatting
 *  marks the text had before (see changes.marksJSON). */
export const FormatChangeMark = Mark.create({
  name: "formatChange",
  inclusive: false,
  addAttributes() {
    return {
      ...infoAttrs(),
      old: {
        default: "[]",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-old") || "[]",
        renderHTML: (a: { old?: string }) => ({ "data-old": a.old ?? "[]" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-suggestion='format']" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-suggestion": "format", class: "suggestion-format" }), 0];
  },
});

/** Paragraph-level review attributes on paragraphs and headings. */
export const TrackParagraphs = Extension.create({
  name: "trackParagraphs",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          paraChange: {
            default: null,
            // The original paragraph mark stays with the second half of a
            // split; the Suggesting plugin fixes up the first half.
            keepOnSplit: true,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-para-change") || null,
            renderHTML: (a) => {
              const pc = parseParaChange(a.paraChange);
              return pc ? { "data-para-change": String(a.paraChange), "data-para-change-type": pc.type } : {};
            },
          },
          propsChange: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => (el as HTMLElement).getAttribute("data-props-change") || null,
            renderHTML: (a) => (a.propsChange ? { "data-props-change": String(a.propsChange) } : {}),
          },
        },
      },
    ];
  },
});

export const suggestingKey = new PluginKey("suggesting");

// Per-editor tracking flag. (TipTap 2 extension storage is shared by every
// editor built from the same extension object, so it can't hold it.)
const tracking = new WeakMap<Editor, boolean>();

/** isSuggesting reports whether the editor records edits as changes. */
export function isSuggesting(editor: Editor): boolean {
  // "Tracked changes only" protection (M10) tracks every edit.
  if (!editor.isDestroyed && protectionState(editor.state).mode === "trackedChanges") return true;
  return tracking.get(editor) ?? false;
}

/** suggestUser is the author the editor records changes under. */
export function suggestUser(editor: Editor): SuggestUser {
  const ext = editor.extensionManager.extensions.find((e) => e.name === "suggesting");
  return (ext?.options as { user?: SuggestUser } | undefined)?.user ?? { name: "", color: INS_COLOR };
}

// --- helpers -------------------------------------------------------------------------------

/** setCaret puts a collapsed selection at (or next to) pos. */
function setCaret(tr: Transaction, pos: number, bias: -1 | 1 = 1): void {
  const p = Math.max(0, Math.min(pos, tr.doc.content.size));
  const $p = tr.doc.resolve(p);
  tr.setSelection($p.parent.inlineContent ? TextSelection.create(tr.doc, p) : Selection.near($p, bias));
}

function hasMark(node: PMNode, name: string): PMMark | undefined {
  return node.marks.find((m) => m.type.name === name);
}

function ownInsertion(node: PMNode, user: SuggestUser): boolean {
  const m = hasMark(node, "insertion");
  return !!m && m.attrs.author === user.name;
}

/** adjacentId returns the id of a same-author `markName` record right
 *  before (or after) pos. */
function adjacentId(doc: PMNode, pos: number, markName: string, author: string, side: -1 | 1 | 0 = 0): string | null {
  const $p = doc.resolve(pos);
  const cands = side === -1 ? [$p.nodeBefore] : side === 1 ? [$p.nodeAfter] : [$p.nodeBefore, $p.nodeAfter];
  for (const n of cands) {
    const m = n && hasMark(n, markName);
    if (m && m.attrs.author === author && m.attrs.id) return String(m.attrs.id);
  }
  return null;
}

/** paragraphInsertId: at the start of a paragraph, the id of the author's
 *  inserted paragraph mark just before (typing after Enter continues it). */
function paragraphInsertId(doc: PMNode, pos: number, author: string): string | null {
  const $p = doc.resolve(pos);
  if (!$p.parent.isTextblock || $p.parentOffset !== 0 || $p.depth < 1) return null;
  const before = $p.before();
  if (before < 1) return null;
  const $b = doc.resolve(before - 1);
  if (!$b.parent.isTextblock || before - 1 !== $b.end()) return null;
  const pc = parseParaChange($b.parent.attrs.paraChange);
  return pc?.type === "insert" && pc.author === author && pc.id ? pc.id : null;
}

/** markDeleted records [from, to) of tr.doc as deleted by `user`: text gets
 *  a deletion mark, paragraph marks inside the range a "delete" paraChange;
 *  the user's own pending insertions are removed outright. Returns the
 *  range's ends in the resulting document and whether anything was marked. */
export function markDeleted(
  tr: Transaction,
  from: number,
  to: number,
  user: SuggestUser,
  id?: string,
  date = nowIso(),
): { start: number; end: number; marked: boolean } {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const base = tr.steps.length;
  const cid = id ?? adjacentId(doc, from, "deletion", user.name, -1) ?? adjacentId(doc, to, "deletion", user.name, 1) ?? newChangeId();
  const mark = schema.marks.deletion.create({ author: user.name, color: DEL_COLOR, id: cid, date });
  const remove: Deletion[] = [];
  let marked = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) {
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + node.nodeSize);
      if (e <= s || hasMark(node, "deletion")) return false;
      if (ownInsertion(node, user)) remove.push([s, e]);
      else {
        tr.removeMark(s, e, schema.marks.formatChange);
        tr.addMark(s, e, mark);
        marked = true;
      }
      return false;
    }
    if (node.isTextblock) {
      const end = pos + node.nodeSize - 1;
      if (end >= from && end < to) {
        const next = nextTextblockStart(doc, end);
        if (next != null && next <= to) {
          const pc = parseParaChange(node.attrs.paraChange);
          if (pc?.type === "insert" && pc.author === user.name) remove.push([end, next, pos]);
          else if (pc?.type !== "delete") {
            tr.setNodeAttribute(pos, "paraChange", JSON.stringify({ type: "delete", id: cid, author: user.name, date }));
            marked = true;
          }
        }
      }
    }
    return true;
  });
  applyDeletions(tr, remove);
  const m = tr.mapping.slice(base);
  return { start: m.map(from, -1), end: m.map(to, 1), marked };
}

/** markInserted records [from, to) of tr.doc as inserted by `user`. */
export function markInserted(tr: Transaction, from: number, to: number, user: SuggestUser, id: string, date = nowIso()): boolean {
  const doc = tr.doc;
  const schema = doc.type.schema;
  const mark = schema.marks.insertion.create({ author: user.name, color: user.color, id, date });
  let changed = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline) {
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + node.nodeSize);
      if (e <= s) return false;
      if (hasMark(node, "deletion")) (tr.removeMark(s, e, schema.marks.deletion), (changed = true));
      if (hasMark(node, "formatChange")) (tr.removeMark(s, e, schema.marks.formatChange), (changed = true));
      if (!ownInsertion(node, user)) (tr.addMark(s, e, mark), (changed = true));
      return false;
    }
    if (node.isTextblock) {
      const end = pos + node.nodeSize - 1;
      if (end >= from && end < to) {
        const pc = parseParaChange(node.attrs.paraChange);
        if (!(pc?.type === "insert" && pc.author === user.name)) {
          tr.setNodeAttribute(pos, "paraChange", JSON.stringify({ type: "insert", id, author: user.name, date }));
          changed = true;
        }
      }
    }
    return true;
  });
  return changed;
}

/** trackedReplace replaces [from, to) with text or a slice as a tracked
 *  change: the old content is marked deleted and the new content inserted
 *  at the start of the range (OnlyOffice / Word order). */
export function trackedReplace(state: EditorState, from: number, to: number, content: string | Slice, user: SuggestUser): Transaction {
  const tr = state.tr;
  const { schema } = state;
  const date = nowIso();
  const id = newChangeId();
  const $from = state.doc.resolve(from);
  const fmt = formatMarks(from < to ? ($from.marksAcross(state.doc.resolve(to)) ?? $from.marks()) : $from.marks());
  const { start, marked } = markDeleted(tr, from, to, user, id, date);
  // Nothing of anyone else's was replaced: continue the neighbouring own
  // insertion, as typing would.
  const insId = marked ? id : adjacentId(tr.doc, start, "insertion", user.name, -1) ?? id;
  let end = start;
  if (typeof content === "string") {
    if (content) {
      const mark = schema.marks.insertion.create({ author: user.name, color: user.color, id: insId, date });
      tr.insert(start, schema.text(content, [...fmt, mark]));
      end = start + content.length;
    }
  } else if (content.size) {
    const size = tr.doc.content.size;
    tr.replace(start, start, content);
    end = start + (tr.doc.content.size - size);
    markInserted(tr, start, end, user, insId, date);
  }
  setCaret(tr, end);
  tr.setMeta(suggestingKey, true);
  return tr.scrollIntoView();
}

const WORD = /[\p{L}\p{N}_]/u;

/** unitRange is the range a Backspace (-1) / Delete (1) removes from an
 *  empty selection at pos, skipping text that is already deleted. Null when
 *  the caret is at a paragraph boundary (handled separately). */
function unitRange(doc: PMNode, pos: number, dir: -1 | 1, word: boolean): { from: number; to: number } | null {
  const $p = doc.resolve(pos);
  const block = $p.parent;
  if (!block.isTextblock) return null;
  const start = $p.start();
  const endPos = $p.end();
  const deletedAt = (p: number) => {
    const n = doc.nodeAt(p);
    return !!n && n.isInline && !!hasMark(n, "deletion");
  };
  const charAt = (p: number) => doc.textBetween(p, p + 1, "\n", "￼");
  let q = pos;
  if (dir < 0) {
    while (q > start && deletedAt(q - 1)) q--;
    if (q === start) return null;
    let a = q - 1;
    if (word) {
      while (a > start && /\s/.test(charAt(a)) && !deletedAt(a - 1)) a--;
      while (a > start && WORD.test(charAt(a - 1)) && !deletedAt(a - 1)) a--;
    }
    return { from: a, to: q };
  }
  while (q < endPos && deletedAt(q)) q++;
  if (q === endPos) return null;
  let b = q + 1;
  if (word) {
    while (b < endPos && WORD.test(charAt(b)) && !deletedAt(b)) b++;
    while (b < endPos && /\s/.test(charAt(b)) && !deletedAt(b)) b++;
  }
  return { from: q, to: b };
}

/** trackedDelete handles Backspace (-1) / Delete (1) while tracking. */
function trackedDelete(view: EditorView, user: SuggestUser, dir: -1 | 1, word: boolean): boolean {
  const { state } = view;
  const sel = state.selection;
  const tr = state.tr;
  if (!sel.empty) {
    let inline = false;
    state.doc.nodesBetween(sel.from, sel.to, (n) => {
      if (n.isInline) inline = true;
      return !inline;
    });
    const crosses = !sel.$from.sameParent(sel.$to);
    // A selected block object (image, drawing, table) is deleted as usual.
    if (!inline && !crosses) return false;
    const r = markDeleted(tr, sel.from, sel.to, user);
    setCaret(tr, dir < 0 ? r.start : r.end);
  } else {
    const r = unitRange(state.doc, sel.from, dir, word);
    if (r) {
      const m = markDeleted(tr, r.from, r.to, user);
      setCaret(tr, dir < 0 ? m.start : m.end);
    } else {
      // At a paragraph boundary: the paragraph mark before (Backspace) or
      // at the end of this paragraph (Delete).
      const $p = sel.$from;
      if (!$p.parent.isTextblock) return false;
      let end: number;
      if (dir < 0) {
        // Skip deleted text back to the paragraph start.
        const before = state.doc.resolve($p.start());
        if (before.depth < 1) return false;
        const prevEnd = before.before() - 1;
        if (prevEnd < 1) return true;
        const $prev = state.doc.resolve(prevEnd);
        if (!$prev.parent.isTextblock || prevEnd !== $prev.end()) return false;
        if (nextTextblockStart(state.doc, prevEnd) !== $p.start()) return false;
        end = prevEnd;
      } else {
        end = $p.end();
        if (nextTextblockStart(state.doc, end) == null) return true;
      }
      const next = nextTextblockStart(state.doc, end)!;
      const m = markDeleted(tr, end, next, user);
      setCaret(tr, dir < 0 ? m.start : m.end);
    }
  }
  tr.setMeta(suggestingKey, true);
  view.dispatch(tr.scrollIntoView());
  return true;
}

function skipTransaction(t: Transaction): boolean {
  if (t.getMeta(suggestingKey)) return true;
  // Remote collaborators' changes and Yjs undo/redo.
  const y = t.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined;
  if (y?.isChangeOrigin) return true;
  // Loading content (setContent) and ProseMirror history.
  if (t.getMeta("preventUpdate") || t.getMeta("history$")) return true;
  if (t.getMeta("addToHistory") === false) return true;
  return false;
}

/** A plain paragraph split: an empty-range insert of only the boundary
 *  tokens (splitBlock / splitListItem). */
function isSplit(step: Step): boolean {
  if (!(step instanceof ReplaceStep) || step.from !== step.to) return false;
  const s = step.slice;
  return s.openStart > 0 && s.openStart === s.openEnd && s.size === 2 * s.openStart;
}

/** fullyOwnInserted: every inline child is the user's own insertion (or the
 *  block is empty). Property changes of such paragraphs aren't tracked. */
function fullyOwnInserted(node: PMNode, user: SuggestUser): boolean {
  let all = true;
  node.forEach((c) => {
    if (!ownInsertion(c, user)) all = false;
  });
  return all;
}

interface FmtSeg {
  from: number;
  to: number;
  old: string;
  /** False when the text already has a change record (or is new). */
  record: boolean;
}
interface PropsSeg {
  pos: number;
  type: string;
  attrs: Record<string, unknown>;
}

export const Suggesting = Extension.create<{ user: SuggestUser }>({
  name: "suggesting",
  addOptions() {
    return { user: { name: "", color: INS_COLOR } };
  },
  addCommands() {
    const resolveAll =
      (accept: boolean) =>
      ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const parts = collectParts(state.doc);
        if (!parts.length) return false;
        if (dispatch) {
          resolveParts(tr, parts, accept);
          tr.setMeta(suggestingKey, true).setMeta(REVIEW_RESOLVE, true);
        }
        return true;
      };
    const resolveRange =
      (accept: boolean, from: number, to: number) =>
      ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const parts = partsInRange(collectParts(state.doc), from, to);
        if (!parts.length) return false;
        if (dispatch) {
          resolveParts(tr, parts, accept);
          tr.setMeta(suggestingKey, true).setMeta(REVIEW_RESOLVE, true);
        }
        return true;
      };
    const resolveId =
      (accept: boolean, id: string) =>
      ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const parts = collectParts(state.doc).filter((p) => p.id === id);
        if (!parts.length) return false;
        if (dispatch) {
          resolveParts(tr, parts, accept);
          tr.setMeta(suggestingKey, true).setMeta(REVIEW_RESOLVE, true);
        }
        return true;
      };
    const resolveCurrent =
      (accept: boolean) =>
      (props: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const { from, to, empty } = props.state.selection;
        const changes = collectChanges(props.state.doc);
        if (!empty) {
          // Every change touched by the selection, whole.
          const ids = new Set(changes.filter((c) => c.parts.some((p) => p.from < to && from < p.to)).map((c) => c.id));
          if (!ids.size) return false;
          const parts = collectParts(props.state.doc).filter((p) => ids.has(p.id));
          if (props.dispatch) {
            resolveParts(props.tr, parts, accept);
            props.tr.setMeta(suggestingKey, true).setMeta(REVIEW_RESOLVE, true);
          }
          return true;
        }
        const c = changeAt(changes, from);
        return c ? resolveId(accept, c.id)(props) : false;
      };
    const go =
      (dir: 1 | -1) =>
      ({ state, tr, dispatch }: { state: EditorState; tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        const changes = collectChanges(state.doc);
        if (!changes.length) return false;
        const { from, to } = state.selection;
        let c: TrackedChange | undefined;
        if (dir > 0) c = changes.find((x) => x.from > from || (x.from === from && x.to > to)) ?? changes[0];
        else c = [...changes].reverse().find((x) => x.from < from) ?? changes[changes.length - 1];
        if (dispatch) {
          const end = Math.min(c.to, tr.doc.content.size);
          tr.setSelection(TextSelection.between(tr.doc.resolve(c.from), tr.doc.resolve(end)));
          tr.scrollIntoView();
        }
        return true;
      };
    return {
      setSuggesting:
        (on) =>
        () => {
          tracking.set(this.editor, on);
          return true;
        },
      acceptAllSuggestions: () => resolveAll(true),
      rejectAllSuggestions: () => resolveAll(false),
      acceptSuggestionRange: (from, to) => resolveRange(true, from, to),
      rejectSuggestionRange: (from, to) => resolveRange(false, from, to),
      acceptChange: (id) => resolveId(true, id),
      rejectChange: (id) => resolveId(false, id),
      acceptCurrentChange: () => resolveCurrent(true),
      rejectCurrentChange: () => resolveCurrent(false),
      nextChange: () => go(1),
      previousChange: () => go(-1),
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const user = () => this.options.user;
    const active = () => isSuggesting(editor);
    let viewRef: EditorView | null = null;
    return [
      new Plugin({
        key: suggestingKey,
        view(v) {
          viewRef = v;
          return { destroy: () => (viewRef = null) };
        },
        filterTransaction(tr, state) {
          if (!active() || skipTransaction(tr) || !tr.docChanged) return true;
          const ui = tr.getMeta("uiEvent");
          const sel = state.selection;
          if (ui === "cut" && !sel.empty) {
            const { from, to } = sel;
            void Promise.resolve().then(() => {
              const v = viewRef;
              if (!v) return;
              const t = v.state.tr;
              const r = markDeleted(t, from, to, user());
              setCaret(t, r.start);
              t.setMeta(suggestingKey, true);
              v.dispatch(t);
            });
            return false;
          }
          if (ui === "paste" && !sel.empty) {
            const step = tr.steps[0];
            const slice = step instanceof ReplaceStep ? step.slice : null;
            if (!slice) return true;
            const { from, to } = sel;
            void Promise.resolve().then(() => {
              const v = viewRef;
              if (v) v.dispatch(trackedReplace(v.state, from, to, slice, user()));
            });
            return false;
          }
          return true;
        },
        appendTransaction(transactions, _oldState, newState) {
          const on = active();
          const u = user();
          const schema = newState.schema;
          const tr = newState.tr;
          const date = nowIso();
          let changed = false;
          let insId: string | null = null;
          const fmtId = newChangeId();
          const inserts: { from: number; to: number }[] = [];
          const plainInserts: { from: number; to: number }[] = [];
          const splits: number[] = [];
          const fmts: FmtSeg[] = [];
          const props: PropsSeg[] = [];
          transactions.forEach((t, k) => {
            if (skipTransaction(t) || !t.docChanged) return;
            const after = new Mapping();
            for (let j = k + 1; j < transactions.length; j++) after.appendMapping(transactions[j].mapping);
            const ui = t.getMeta("uiEvent");
            // Untracked typing must not inherit review marks (an insertion
            // is inclusive; typing inside a deleted run takes its mark).
            const keepMarks = ui === "paste" || ui === "drop" || !!t.getMeta("keepReviewMarks");
            t.steps.forEach((step, i) => {
              const rest = t.mapping.slice(i + 1);
              const fin = (p: number, assoc: number) => after.map(rest.map(p, assoc), assoc);
              const before = t.docs[i];
              const next = i + 1 < t.steps.length ? t.docs[i + 1] : t.doc;
              if (step instanceof ReplaceStep) {
                if (!on && isSplit(step)) splits.push(fin(step.from, -1));
                step.getMap().forEach((_a, _b, fromB, toB) => {
                  if (toB <= fromB) return;
                  const r = { from: fin(fromB, -1), to: fin(toB, 1) };
                  if (on) inserts.push(r);
                  else if (!keepMarks) plainInserts.push(r);
                });
                return;
              }
              if (!on) return;
              if ((step instanceof AddMarkStep || step instanceof RemoveMarkStep) && isFormatMark(step.mark.type.name)) {
                before.nodesBetween(step.from, step.to, (node, pos) => {
                  if (!node.isInline) return true;
                  const s = Math.max(step.from, pos);
                  const e = Math.min(step.to, pos + node.nodeSize);
                  if (e > s)
                    fmts.push({
                      from: fin(s, 1),
                      to: fin(e, -1),
                      old: JSON.stringify(marksJSON(node.marks)),
                      record: !hasMark(node, "formatChange") && !hasMark(node, "deletion") && !ownInsertion(node, u),
                    });
                  return false;
                });
                return;
              }
              if (step instanceof ReplaceAroundStep || step instanceof AttrStep) {
                const map = step.getMap();
                const inv = map.invert();
                const a = step instanceof AttrStep ? step.pos : map.map(step.from, -1);
                const b = step instanceof AttrStep ? step.pos + 1 : map.map(step.to, 1);
                next.nodesBetween(a, Math.min(b, next.content.size), (node, pos) => {
                  if (!node.isTextblock) return true;
                  const old = before.nodeAt(inv.map(pos, -1));
                  if (
                    old &&
                    old.isTextblock &&
                    (old.attrs.propsChange || propsKey(old.type.name, old.attrs) !== propsKey(node.type.name, node.attrs))
                  )
                    props.push({ pos: fin(pos, -1), type: old.type.name, attrs: propsAttrs(old.attrs) });
                  return false;
                });
              }
            });
          });

          // Untracked split: the new paragraph mark (the first half's) is a
          // plain one; the original mark stays with the second half.
          for (const p of splits) {
            const $p = tr.doc.resolve(p);
            if (!$p.parent.isTextblock || $p.pos !== $p.end() || !$p.parent.attrs.paraChange) continue;
            tr.setNodeAttribute($p.before(), "paraChange", null);
            changed = true;
          }
          const review = [schema.marks.insertion, schema.marks.deletion, schema.marks.formatChange];
          for (const r of plainInserts) {
            tr.doc.nodesBetween(r.from, r.to, (node, pos) => {
              if (!node.isInline) return true;
              const s = Math.max(r.from, pos);
              const e = Math.min(r.to, pos + node.nodeSize);
              for (const t of review)
                if (e > s && node.marks.some((m) => m.type === t)) {
                  tr.removeMark(s, e, t);
                  changed = true;
                }
              return false;
            });
          }

          if (on) {
            for (const r of inserts) {
              if (r.to <= r.from) continue;
              insId ??= adjacentId(tr.doc, r.from, "insertion", u.name, -1) ?? paragraphInsertId(tr.doc, r.from, u.name) ?? newChangeId();
              if (markInserted(tr, r.from, r.to, u, insId, date)) changed = true;
            }
            // Formatting changes, then drop the ones that were undone.
            const fmtType = schema.marks.formatChange;
            for (const f of fmts) {
              if (f.to <= f.from || !f.record) continue;
              tr.doc.nodesBetween(f.from, f.to, (node, pos) => {
                if (!node.isInline) return true;
                if (hasMark(node, "formatChange") || hasMark(node, "deletion") || ownInsertion(node, u)) return false;
                const s = Math.max(f.from, pos);
                const e = Math.min(f.to, pos + node.nodeSize);
                if (e > s) {
                  tr.addMark(s, e, fmtType.create({ id: fmtId, author: u.name, date, old: f.old }));
                  changed = true;
                }
                return false;
              });
            }
            for (const f of fmts) {
              if (f.to <= f.from) continue;
              tr.doc.nodesBetween(f.from, f.to, (node, pos) => {
                if (!node.isInline) return true;
                const fm = hasMark(node, "formatChange");
                if (fm && marksKey(node.marks) === String(fm.attrs.old)) {
                  tr.removeMark(Math.max(f.from, pos), Math.min(f.to, pos + node.nodeSize), fm);
                  changed = true;
                }
                return false;
              });
            }
            // Paragraph property changes.
            const propsId = newChangeId();
            for (const p of props) {
              const node = tr.doc.nodeAt(p.pos);
              if (!node || !node.isTextblock) continue;
              const cur = parsePropsChange(node.attrs.propsChange);
              if (!cur) {
                if (fullyOwnInserted(node, u)) continue;
                if (propsKey(p.type, p.attrs) === propsKey(node.type.name, node.attrs)) continue;
                tr.setNodeAttribute(p.pos, "propsChange", JSON.stringify({ id: propsId, author: u.name, date, type: p.type, attrs: p.attrs }));
                changed = true;
              } else if (propsKey(cur.type, cur.attrs) === propsKey(node.type.name, node.attrs)) {
                tr.setNodeAttribute(p.pos, "propsChange", null);
                changed = true;
              }
            }
          }
          if (!changed) return null;
          tr.setMeta(suggestingKey, true);
          return tr;
        },
        props: {
          handleKeyDown(view, event) {
            if (!active() || view.composing) return false;
            const u = user();
            const word = event.ctrlKey || event.altKey || event.metaKey;
            if (event.key === "Backspace") return trackedDelete(view, u, -1, word);
            if (event.key === "Delete") return trackedDelete(view, u, 1, word);
            if (event.key === "Enter" && !view.state.selection.empty) {
              // Replace the selection with a paragraph break: mark it
              // deleted, then let Enter split at its start.
              const { from, to } = view.state.selection;
              const tr = view.state.tr;
              const r = markDeleted(tr, from, to, u);
              setCaret(tr, r.start);
              tr.setMeta(suggestingKey, true);
              view.dispatch(tr);
              return false;
            }
            return false;
          },
          handleTextInput(view, from, to, text) {
            if (!active()) return false;
            if (from === to) return false; // plain insert → appendTransaction marks it
            view.dispatch(trackedReplace(view.state, from, to, text, user()));
            return true;
          },
          handleDrop(view, event, slice, moved) {
            // A drag-move while tracking: insert at the drop point and mark
            // the source deleted (a copy-drop is a plain insertion).
            if (!active() || !moved || !slice.size) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!at) return false;
            const { from, to } = view.state.selection;
            if (at.pos >= from && at.pos <= to) return true;
            const u = user();
            const tr = view.state.tr;
            const id = newChangeId();
            const date = nowIso();
            const insert = (pos: number) => {
              const size = tr.doc.content.size;
              tr.replace(pos, pos, slice);
              const end = pos + (tr.doc.content.size - size);
              markInserted(tr, pos, end, u, id, date);
              return end;
            };
            let end: number;
            if (at.pos > to) {
              end = insert(at.pos);
              const k = tr.steps.length;
              markDeleted(tr, from, to, u, id, date);
              end = tr.mapping.slice(k).map(end);
            } else {
              markDeleted(tr, from, to, u, id, date);
              end = insert(at.pos);
            }
            setCaret(tr, Math.min(end, tr.doc.content.size));
            tr.setMeta(suggestingKey, true);
            tr.setMeta("uiEvent", "drop");
            view.dispatch(tr.scrollIntoView());
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

