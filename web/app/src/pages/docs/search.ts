// Find and replace for the Docs editor.
//
// * findMatches() searches the document block by block. Each textblock is
//   flattened to a string in which every character maps to exactly one
//   ProseMirror position (text characters as themselves, a hard break as
//   "\n", any other inline atom as U+FFFC), so a match may span runs with
//   different formatting but never crosses a paragraph boundary.
// * The Search extension keeps the query in plugin state, draws highlight
//   decorations (".search-match", current one ".search-match-current") and
//   offers next/previous, replace one and replace all as commands.
// * Replacements go through smartReplace(), which keeps the formatting of
//   every character that survives and gives new characters the formatting
//   of the text they replace ("smart" replace, OnlyOffice ReplaceTextSmart).
import { Extension, type Editor } from "@tiptap/core";
import type { Mark, Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { formatMarks, newChangeId, nowIso } from "./changes";
import { isSuggesting, markDeleted, suggestUser, suggestingKey, type SuggestUser } from "./suggesting";

// --- matching ---------------------------------------------------------------------

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface SearchMatch {
  from: number;
  to: number;
  /** Capture groups (regex mode) for $1-style replacement patterns. */
  groups?: RegExpExecArray;
}

const OBJ = "￼";
const WORD = /[\p{L}\p{N}_]/u;
/** Upper bound on highlighted matches, so a one-letter query in a long
 *  document stays responsive. */
export const MAX_MATCHES = 5000;

/** blockString flattens a textblock's inline content (see file comment). */
export function blockString(node: PMNode): string {
  let s = "";
  node.forEach((child) => {
    if (child.isText) s += child.text;
    else if (child.type.name === "hardBreak") s += "\n";
    else s += OBJ.repeat(child.nodeSize);
  });
  return s;
}

/** buildRegExp compiles the query, or returns an Error for an invalid
 *  regular expression. Returns null for an empty query. */
export function buildRegExp(query: string, opts: SearchOptions = {}): RegExp | Error | null {
  if (!query) return null;
  const source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(source, "gu" + (opts.caseSensitive ? "" : "i"));
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** findMatches lists every match of `query` in `doc`, in document order. */
export function findMatches(
  doc: PMNode,
  query: string,
  opts: SearchOptions = {},
  limit = MAX_MATCHES,
): SearchMatch[] {
  const re = buildRegExp(query, opts);
  if (!re || re instanceof Error) return [];
  const out: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (out.length >= limit) return false;
    if (!node.isTextblock) return true;
    const text = blockString(node);
    const start = pos + 1;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && out.length < limit) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const a = m.index;
      const b = a + m[0].length;
      if (opts.wholeWord) {
        const before = text[a - 1];
        const after = text[b];
        const wordEdgeA = WORD.test(m[0][0]);
        const wordEdgeB = WORD.test(m[0][m[0].length - 1]);
        if ((wordEdgeA && before && WORD.test(before)) || (wordEdgeB && after && WORD.test(after))) {
          continue;
        }
      }
      out.push({ from: start + a, to: start + b, groups: opts.regex ? m : undefined });
    }
    return false;
  });
  return out;
}

/** expandReplacement fills $&, $1…$99, $<name> and $$ in a regex-mode
 *  replacement, like String.prototype.replace. */
export function expandReplacement(repl: string, m?: RegExpExecArray): string {
  if (!m) return repl;
  return repl.replace(/\$(\$|&|\d{1,2}|<([^>]*)>)/g, (all, tok: string, name?: string) => {
    if (tok === "$") return "$";
    if (tok === "&") return m[0];
    if (name !== undefined) return m.groups?.[name] ?? "";
    const n = Number(tok);
    if (n > 0 && n < m.length) return m[n] ?? "";
    return all;
  });
}

// --- smart replace ------------------------------------------------------------------

interface Chunk {
  a: number; // old start (offset in range)
  b: number; // old end
  text: string; // new text
}

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
const tokenize = (s: string) => s.match(TOKEN) ?? [];

/** diffChunks turns old -> new into minimal edit chunks: common prefix and
 *  suffix are kept, the middle is aligned word by word (LCS over tokens),
 *  and each replaced token group is trimmed to its differing characters. */
export function diffChunks(oldText: string, newText: string): Chunk[] {
  let p = 0;
  const max = Math.min(oldText.length, newText.length);
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (
    s < max - p &&
    oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]
  )
    s++;
  const oldMid = oldText.slice(p, oldText.length - s);
  const newMid = newText.slice(p, newText.length - s);
  if (!oldMid && !newMid) return [];
  const ot = tokenize(oldMid);
  const nt = tokenize(newMid);
  const chunks: Chunk[] = [];
  const push = (a: number, b: number, text: string) => {
    // Trim characters the group has in common at either end.
    let i = 0;
    const old = oldText.slice(a, b);
    const lim = Math.min(old.length, text.length);
    while (i < lim && old[i] === text[i]) i++;
    let j = 0;
    while (j < lim - i && old[old.length - 1 - j] === text[text.length - 1 - j]) j++;
    if (a + i === b - j && !text.slice(i, text.length - j)) return;
    chunks.push({ a: a + i, b: b - j, text: text.slice(i, text.length - j) });
  };
  if (ot.length * nt.length > 250_000) {
    push(p, p + oldMid.length, newMid);
    return chunks;
  }
  // LCS table over tokens.
  const n = ot.length;
  const m = nt.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = ot[i] === nt[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0;
  let j = 0;
  let oPos = p;
  let gA = -1;
  let gText = "";
  const flush = () => {
    if (gA >= 0) push(gA, oPos, gText);
    gA = -1;
    gText = "";
  };
  while (i < n || j < m) {
    if (i < n && j < m && ot[i] === nt[j]) {
      flush();
      oPos += ot[i].length;
      i++;
      j++;
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      if (gA < 0) gA = oPos;
      gText += nt[j++];
    } else {
      if (gA < 0) gA = oPos;
      oPos += ot[i++].length;
    }
  }
  flush();
  return chunks;
}

/** textWithMarks returns the visible characters of [from, to) (text marked
 *  as a tracked deletion is left out), their marks and positions, when the
 *  range is plain text inside one textblock; else null. */
function textWithMarks(
  doc: PMNode,
  from: number,
  to: number,
): { text: string; marks: (readonly Mark[])[]; pos: number[] } | null {
  const $a = doc.resolve(from);
  const $b = doc.resolve(to);
  if (!$a.sameParent($b) || !$a.parent.isTextblock) return null;
  let text = "";
  const marks: (readonly Mark[])[] = [];
  const pos: number[] = [];
  let ok = true;
  doc.nodesBetween(from, to, (node, p) => {
    if (!ok) return false;
    if (!node.isInline) return true;
    if (!node.isText) {
      ok = false;
      return false;
    }
    if (node.marks.some((m) => m.type.name === "deletion")) return false;
    const a = Math.max(from, p);
    const b = Math.min(to, p + node.nodeSize);
    for (let k = a; k < b; k++) {
      text += node.text![k - p];
      marks.push(node.marks);
      pos.push(k);
    }
    return false;
  });
  return ok ? { text, marks, pos } : null;
}

/** Contiguous document ranges covering the visible characters [a, b). */
function charRanges(pos: number[], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = a; k < b; k++) {
    const last = out[out.length - 1];
    if (last && last[1] === pos[k]) last[1]++;
    else out.push([pos[k], pos[k] + 1]);
  }
  return out;
}

/** smartReplace replaces [from, to) with `text` in `tr`, keeping per-run
 *  formatting: surviving characters keep theirs, new characters take the
 *  formatting of what they replace. Text that is already a tracked deletion
 *  is not compared and stays. With `track` (a user) the edit is tracked:
 *  replaced characters become deletions (the user's own insertions are
 *  removed) and new characters insertions placed after what they replace.
 *  Returns the end of the replacement. */
export function smartReplace(
  tr: Transaction,
  schema: Schema,
  from: number,
  to: number,
  text: string,
  track: SuggestUser | null = null,
): number {
  const doc = tr.doc;
  const old = textWithMarks(doc, from, to);
  const id = newChangeId();
  const date = nowIso();
  const insMark = track ? schema.marks.insertion?.create({ author: track.name, color: track.color, id, date }) : null;
  const withIns = (marks: readonly Mark[]) => (insMark ? [...formatMarks([...marks]), insMark] : marks);
  if (!old) {
    const marks = doc.resolve(Math.min(from + 1, to)).marks();
    if (track) {
      const r = markDeleted(tr, from, to, track, id, date);
      if (text) tr.insert(r.start, schema.text(text, withIns(marks)));
      return r.start + text.length;
    }
    if (text) tr.replaceWith(from, to, schema.text(text, marks));
    else tr.delete(from, to);
    return from + text.length;
  }
  const chunks = diffChunks(old.text, text);
  const beforeMarks = doc.resolve(from).marks();
  const endOf = (a: number) => (a > 0 ? old.pos[a - 1] + 1 : old.pos[0] ?? from);
  const startLen = tr.doc.content.size;
  for (let k = chunks.length - 1; k >= 0; k--) {
    const c = chunks[k];
    const marks =
      c.a < c.b
        ? old.marks[c.a]
        : c.a > 0
          ? old.marks[c.a - 1]
          : old.marks[0] ?? beforeMarks;
    const ranges = charRanges(old.pos, c.a, c.b);
    if (track) {
      // New text goes after what it replaces; then strike the old.
      const at = c.a < c.b ? old.pos[c.b - 1] + 1 : endOf(c.a);
      if (c.text) tr.insert(at, schema.text(c.text, withIns(marks)));
      for (let r = ranges.length - 1; r >= 0; r--) markDeleted(tr, ranges[r][0], ranges[r][1], track, id, date);
    } else {
      for (let r = ranges.length - 1; r >= 0; r--) tr.delete(ranges[r][0], ranges[r][1]);
      const at = c.a < c.b ? old.pos[c.a] : endOf(c.a);
      if (c.text) tr.insert(at, schema.text(c.text, marks));
    }
  }
  return to + (tr.doc.content.size - startLen);
}

/** trackUser is the Suggesting user when the editor is tracking changes. */
function trackUser(editor: Editor): SuggestUser | null {
  return isSuggesting(editor) ? suggestUser(editor) : null;
}

/** tagReplace marks a replace transaction: tracked ones were recorded here,
 *  untracked ones keep the review marks they copied. */
function tagReplace(tr: Transaction, track: SuggestUser | null): Transaction {
  return track ? tr.setMeta(suggestingKey, true) : tr.setMeta("keepReviewMarks", true);
}

/** replaceTextSmart replaces the text of each selected textblock with the
 *  matching entry of `texts` (a single string for a single paragraph),
 *  preserving run formatting (OnlyOffice Api.ReplaceTextSmart). Selected
 *  parts of partly selected blocks are replaced. Tracked when the editor
 *  is in Suggesting mode. Returns false when there is nothing selected. */
export function replaceTextSmart(editor: Editor, texts: string | string[]): boolean {
  const list = typeof texts === "string" ? [texts] : texts;
  const { state } = editor;
  const { from, to } = state.selection;
  if (from === to) return false;
  const ranges: { from: number; to: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const a = Math.max(from, pos + 1);
    const b = Math.min(to, pos + 1 + node.content.size);
    if (a <= b) ranges.push({ from: a, to: b });
    return false;
  });
  const track = trackUser(editor);
  const tr = state.tr;
  const n = Math.min(ranges.length, list.length);
  for (let k = n - 1; k >= 0; k--) smartReplace(tr, state.schema, ranges[k].from, ranges[k].to, list[k], track);
  if (!tr.docChanged) return true;
  editor.view.dispatch(tagReplace(tr, track));
  return true;
}

// --- the Search extension ------------------------------------------------------------

export interface SearchState {
  query: string;
  options: SearchOptions;
  matches: SearchMatch[];
  /** Index of the current (focused) match, or -1. */
  current: number;
  /** Set when the regular expression doesn't compile. */
  error: string | null;
}

export const searchKey = new PluginKey<SearchState>("docSearch");

type Meta =
  | { type: "query"; query: string; options: SearchOptions }
  | { type: "current"; index: number }
  | { type: "clear" };

const EMPTY: SearchState = { query: "", options: {}, matches: [], current: -1, error: null };

function compute(doc: PMNode, query: string, options: SearchOptions): Pick<SearchState, "matches" | "error"> {
  const re = buildRegExp(query, options);
  if (re instanceof Error) return { matches: [], error: re.message };
  return { matches: re ? findMatches(doc, query, options) : [], error: null };
}

/** nearestMatch picks the first match starting at or after pos (wrapping). */
function nearestMatch(matches: SearchMatch[], pos: number): number {
  if (!matches.length) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
  return i === -1 ? 0 : i;
}

/** getSearchState reads the search plugin state (or an empty state). */
export function getSearchState(state: EditorState): SearchState {
  return searchKey.getState(state) ?? EMPTY;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      /** Set the find query and options; highlights every match. */
      setSearch: (query: string, options?: SearchOptions) => ReturnType;
      clearSearch: () => ReturnType;
      /** Select the next / previous match (wrapping). */
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      /** Replace the current match and move to the next one. */
      replaceCurrent: (replacement: string) => ReturnType;
      /** Replace every match in one step. */
      replaceAllMatches: (replacement: string) => ReturnType;
    };
  }
}

function selectMatch(tr: Transaction, m: SearchMatch, index: number) {
  tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
  tr.setMeta(searchKey, { type: "current", index } satisfies Meta);
  tr.scrollIntoView();
}

export const Search = Extension.create({
  name: "search",
  addCommands() {
    return {
      setSearch:
        (query, options = {}) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchKey, { type: "query", query, options } satisfies Meta);
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(searchKey, { type: "clear" } satisfies Meta);
          return true;
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state);
          if (!s.matches.length) return false;
          const { from, to } = state.selection;
          let i = s.matches.findIndex((m) => m.from > from || (m.from === from && to < m.to));
          if (i === -1) i = 0;
          if (dispatch) selectMatch(tr, s.matches[i], i);
          return true;
        },
      findPrevious:
        () =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state);
          if (!s.matches.length) return false;
          const { from } = state.selection;
          let i = -1;
          for (let k = s.matches.length - 1; k >= 0; k--) {
            if (s.matches[k].from < from) {
              i = k;
              break;
            }
          }
          if (i === -1) i = s.matches.length - 1;
          if (dispatch) selectMatch(tr, s.matches[i], i);
          return true;
        },
      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state);
          if (!s.matches.length) return false;
          let i = s.current;
          if (i < 0 || i >= s.matches.length) i = nearestMatch(s.matches, state.selection.from);
          const m = s.matches[i];
          const sel = state.selection;
          // First press only selects the match if the user hasn't landed on it.
          if (!(sel.from === m.from && sel.to === m.to)) {
            if (dispatch) selectMatch(tr, m, i);
            return true;
          }
          if (!dispatch) return true;
          const track = trackUser(this.editor);
          const end = smartReplace(tr, state.schema, m.from, m.to, expandReplacement(replacement, m.groups), track);
          tagReplace(tr, track);
          const next = findMatches(tr.doc, s.query, s.options);
          const ni = nearestMatch(next, end);
          if (ni >= 0 && next[ni]) {
            tr.setSelection(TextSelection.create(tr.doc, next[ni].from, next[ni].to));
            tr.scrollIntoView();
          } else {
            tr.setSelection(TextSelection.create(tr.doc, end));
          }
          tr.setMeta(searchKey, { type: "current", index: ni } satisfies Meta);
          return true;
        },
      replaceAllMatches:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state);
          const matches = s.query ? findMatches(state.doc, s.query, s.options, Infinity) : [];
          if (!matches.length) return false;
          if (dispatch) {
            const track = trackUser(this.editor);
            for (let k = matches.length - 1; k >= 0; k--) {
              const m = matches[k];
              smartReplace(tr, state.schema, m.from, m.to, expandReplacement(replacement, m.groups), track);
            }
            tagReplace(tr, track);
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev, _old, next) {
            const meta = tr.getMeta(searchKey) as Meta | undefined;
            if (meta?.type === "clear") return EMPTY;
            if (meta?.type === "query") {
              const r = compute(next.doc, meta.query, meta.options);
              return {
                query: meta.query,
                options: meta.options,
                ...r,
                current: nearestMatch(r.matches, next.selection.from),
              };
            }
            let s = prev;
            if (tr.docChanged && s.query) {
              const r = compute(next.doc, s.query, s.options);
              s = { ...s, ...r, current: Math.min(s.current, r.matches.length - 1) };
            }
            if (meta?.type === "current") s = { ...s, current: meta.index };
            return s;
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s || !s.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === s.current ? "search-match search-match-current" : "search-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
