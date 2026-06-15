import { Mark, Extension, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Track changes ("Suggesting" mode). While active, edits are recorded as
// suggestions rather than applied destructively:
//   - typed/pasted text gets an `insertion` mark (author-coloured underline),
//   - deletions get a `deletion` mark (strikethrough) instead of removing text.
// Accept/Reject then materialise or discard the change. Marks ride along the
// shared Yjs document, so suggestions are collaborative for free.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggesting: {
      setSuggesting: (on: boolean) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
      acceptSuggestionRange: (from: number, to: number) => ReturnType;
      rejectSuggestionRange: (from: number, to: number) => ReturnType;
    };
  }
}

export interface SuggestUser {
  name: string;
  color: string;
}

const suggestAttrs = () => ({
  author: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-author") || "",
    renderHTML: (a: { author?: string }) =>
      a.author ? { "data-author": a.author } : {},
  },
  color: {
    default: "#188038",
    parseHTML: (el: HTMLElement) => el.getAttribute("data-color") || "#188038",
    renderHTML: (a: { color?: string }) =>
      a.color ? { "data-color": a.color } : {},
  },
});

export const InsertionMark = Mark.create({
  name: "insertion",
  inclusive: true,
  addAttributes() {
    return suggestAttrs();
  },
  parseHTML() {
    return [{ tag: "span[data-suggestion='insert']" }];
  },
  renderHTML({ HTMLAttributes }) {
    const color = (HTMLAttributes["data-color"] as string) || "#188038";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-suggestion": "insert",
        class: "suggestion-insert",
        style: `color:${color};text-decoration:underline`,
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
    return [{ tag: "span[data-suggestion='delete']" }];
  },
  renderHTML({ HTMLAttributes }) {
    const color = (HTMLAttributes["data-color"] as string) || "#d93025";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-suggestion": "delete",
        class: "suggestion-delete",
        style: `color:${color};text-decoration:line-through`,
      }),
      0,
    ];
  },
});

export const suggestingKey = new PluginKey("suggesting");

// markEntirely reports whether every text node in [from,to] carries the mark.
function rangeAllMarked(
  doc: import("@tiptap/pm/model").Node,
  from: number,
  to: number,
  markName: string,
): boolean {
  let all = true;
  let sawText = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      sawText = true;
      if (!node.marks.some((m) => m.type.name === markName)) all = false;
    }
  });
  return sawText && all;
}

// applyDeletion marks [from,to] as a suggested deletion, or — when the range is
// entirely the author's own pending insertion — removes it outright (undoing a
// suggestion shouldn't leave a strikethrough). Returns the cursor target.
function applyDeletion(
  view: EditorView,
  user: SuggestUser,
  from: number,
  to: number,
  caret: number,
) {
  const { state } = view;
  const del = state.schema.marks.deletion;
  const ins = state.schema.marks.insertion;
  if (!del || from < 0 || to > state.doc.content.size || from >= to) return;
  const tr = state.tr;
  if (rangeAllMarked(state.doc, from, to, "insertion")) {
    tr.delete(from, to);
    tr.setMeta(suggestingKey, true);
    view.dispatch(tr.scrollIntoView());
    return;
  }
  if (ins) tr.removeMark(from, to, ins);
  tr.addMark(from, to, del.create({ author: user.name, color: "#d93025" }));
  tr.setSelection(TextSelection.create(tr.doc, caret));
  tr.setMeta(suggestingKey, true);
  view.dispatch(tr.scrollIntoView());
}

export const Suggesting = Extension.create<{ user: SuggestUser }>({
  name: "suggesting",
  addOptions() {
    return { user: { name: "", color: "#188038" } };
  },
  addStorage() {
    return { active: false };
  },
  addCommands() {
    return {
      setSuggesting:
        (on) =>
        () => {
          this.storage.active = on;
          return true;
        },
      acceptAllSuggestions:
        () =>
        ({ state, dispatch, tr }) => {
          const ins = state.schema.marks.insertion;
          const del = state.schema.marks.deletion;
          const dels: Array<[number, number]> = [];
          state.doc.descendants((node, pos) => {
            if (node.isText && node.marks.some((m) => m.type === del))
              dels.push([pos, pos + node.nodeSize]);
          });
          dels.reverse().forEach(([f, t]) => tr.delete(f, t));
          if (ins) tr.removeMark(0, tr.doc.content.size, ins);
          tr.setMeta(suggestingKey, true);
          if (dispatch) dispatch(tr);
          return true;
        },
      rejectAllSuggestions:
        () =>
        ({ state, dispatch, tr }) => {
          const ins = state.schema.marks.insertion;
          const del = state.schema.marks.deletion;
          const inserts: Array<[number, number]> = [];
          state.doc.descendants((node, pos) => {
            if (node.isText && node.marks.some((m) => m.type === ins))
              inserts.push([pos, pos + node.nodeSize]);
          });
          inserts.reverse().forEach(([f, t]) => tr.delete(f, t));
          if (del) tr.removeMark(0, tr.doc.content.size, del);
          tr.setMeta(suggestingKey, true);
          if (dispatch) dispatch(tr);
          return true;
        },
      acceptSuggestionRange:
        (from, to) =>
        ({ state, dispatch, tr }) => {
          const ins = state.schema.marks.insertion;
          const del = state.schema.marks.deletion;
          // Accept: drop the deletion-marked text, keep insertions as plain text.
          const dels: Array<[number, number]> = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.isText && del && node.marks.some((m) => m.type === del))
              dels.push([
                Math.max(from, pos),
                Math.min(to, pos + node.nodeSize),
              ]);
          });
          dels.reverse().forEach(([f, t]) => tr.delete(f, t));
          if (ins) tr.removeMark(from, to, ins);
          if (del) tr.removeMark(from, to, del);
          tr.setMeta(suggestingKey, true);
          if (dispatch) dispatch(tr);
          return true;
        },
      rejectSuggestionRange:
        (from, to) =>
        ({ state, dispatch, tr }) => {
          const ins = state.schema.marks.insertion;
          const del = state.schema.marks.deletion;
          const inserts: Array<[number, number]> = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.isText && ins && node.marks.some((m) => m.type === ins))
              inserts.push([
                Math.max(from, pos),
                Math.min(to, pos + node.nodeSize),
              ]);
          });
          inserts.reverse().forEach(([f, t]) => tr.delete(f, t));
          if (del) tr.removeMark(from, to, del);
          if (ins) tr.removeMark(from, to, ins);
          tr.setMeta(suggestingKey, true);
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: suggestingKey,
        // Tag newly inserted text with the insertion mark.
        appendTransaction(transactions, _oldState, newState) {
          if (!ext.storage.active) return null;
          if (!transactions.some((t) => t.docChanged)) return null;
          if (transactions.some((t) => t.getMeta(suggestingKey))) return null;
          const ins = newState.schema.marks.insertion;
          const del = newState.schema.marks.deletion;
          if (!ins) return null;
          const user = ext.options.user;
          const tr = newState.tr;
          let changed = false;
          transactions.forEach((transaction) => {
            if (transaction.getMeta(suggestingKey)) return;
            transaction.steps.forEach((step, i) => {
              step.getMap().forEach((_fromA, _toA, fromB, toB) => {
                if (toB <= fromB) return;
                const rest = transaction.mapping.slice(i + 1);
                const from = rest.map(fromB, -1);
                const to = rest.map(toB, 1);
                newState.doc.nodesBetween(from, to, (node, pos) => {
                  if (!node.isText) return;
                  const s = Math.max(from, pos);
                  const e = Math.min(to, pos + node.nodeSize);
                  if (e <= s) return;
                  if (del && node.marks.some((m) => m.type === del)) return;
                  if (node.marks.some((m) => m.type === ins)) return;
                  tr.addMark(s, e, ins.create({ author: user.name, color: user.color }));
                  changed = true;
                });
              });
            });
          });
          if (!changed) return null;
          tr.setMeta(suggestingKey, true);
          return tr;
        },
        props: {
          handleKeyDown(view, event) {
            if (!ext.storage.active) return false;
            const { state } = view;
            const sel = state.selection;
            if (event.key === "Backspace") {
              if (!sel.empty) {
                applyDeletion(view, ext.options.user, sel.from, sel.to, sel.from);
              } else {
                applyDeletion(view, ext.options.user, sel.from - 1, sel.from, sel.from - 1);
              }
              return true;
            }
            if (event.key === "Delete") {
              if (!sel.empty) {
                applyDeletion(view, ext.options.user, sel.from, sel.to, sel.from);
              } else {
                applyDeletion(view, ext.options.user, sel.from, sel.from + 1, sel.from);
              }
              return true;
            }
            return false;
          },
          handleTextInput(view, from, to, text) {
            if (!ext.storage.active) return false;
            if (from === to) return false; // plain insert → appendTransaction marks it
            // Typing over a selection: strike the selection, insert after it.
            const { state } = view;
            const ins = state.schema.marks.insertion;
            const del = state.schema.marks.deletion;
            const user = ext.options.user;
            const tr = state.tr;
            if (del) {
              if (ins) tr.removeMark(from, to, ins);
              tr.addMark(from, to, del.create({ author: user.name, color: "#d93025" }));
            }
            tr.insertText(text, to);
            if (ins)
              tr.addMark(to, to + text.length, ins.create({ author: user.name, color: user.color }));
            tr.setSelection(TextSelection.create(tr.doc, to + text.length));
            tr.setMeta(suggestingKey, true);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
