// As-you-type AutoCorrect for the Docs editor.
//
// Corrections run when a word is finished (a space, punctuation or Enter is
// typed) or, for quotes, when the quote is typed:
// * capitalise the first letter of a sentence (after . ! ? … or at the start
//   of a paragraph), skipping abbreviations in the exception list (e.g.
//   "e.g.", "Mr.") and single-letter initials; the first paragraph of a
//   table cell follows its own option, as in Word/OnlyOffice;
// * smart quotes: " and ' become “ ” ‘ ’ (an apostrophe inside a word is ’);
// * "--" becomes an em dash "—" once the next character is typed;
// * two spaces after a word become ". " (off by default);
// * a replacement list: "(c)" -> "©", "teh" -> "the", ... Entries made only of
//   symbols match the end of the word ("wait..." -> "wait…"); entries with
//   letters or digits must match the whole word. Entries ending in a symbol
//   ("(c)", "->", "...") fire as soon as their last character is typed.
// Backspace straight after a correction puts the typed text back.
//
// Settings are held per editor (setAutoCorrect command, getAutoCorrect) and
// persisted per user in localStorage by the app (load/saveAutoCorrect).
import { Extension, type Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface Replacement {
  from: string;
  to: string;
}

export interface AutoCorrectSettings {
  capitalizeSentences: boolean;
  capitalizeCells: boolean;
  smartQuotes: boolean;
  dashes: boolean;
  doubleSpacePeriod: boolean;
  replaceText: boolean;
  replacements: Replacement[];
  /** Abbreviations after which the next word is not capitalised. */
  exceptions: string[];
}

export const DEFAULT_REPLACEMENTS: Replacement[] = [
  { from: "(c)", to: "©" },
  { from: "(r)", to: "®" },
  { from: "(tm)", to: "™" },
  { from: "...", to: "…" },
  { from: "->", to: "→" },
  { from: "<-", to: "←" },
  { from: "=>", to: "⇒" },
  { from: "1/2", to: "½" },
  { from: "1/4", to: "¼" },
  { from: "3/4", to: "¾" },
];

export const DEFAULT_EXCEPTIONS = [
  "a.m.", "approx.", "apt.", "ca.", "cf.", "ch.", "dept.", "dr.", "e.g.", "est.",
  "etc.", "fig.", "i.e.", "inc.", "jr.", "mr.", "mrs.", "ms.", "no.", "p.",
  "p.m.", "pp.", "prof.", "sr.", "st.", "vol.", "vs.",
];

export const DEFAULT_AUTOCORRECT: AutoCorrectSettings = {
  capitalizeSentences: true,
  capitalizeCells: true,
  smartQuotes: true,
  dashes: true,
  doubleSpacePeriod: false,
  replaceText: true,
  replacements: DEFAULT_REPLACEMENTS,
  exceptions: DEFAULT_EXCEPTIONS,
};

// --- persistence ---------------------------------------------------------------------

const storageKey = (user: string) => `grown.docs.autocorrect.v1:${user}`;

/** loadAutoCorrect reads a user's settings (defaults for anything missing
 *  or when storage is unavailable). */
export function loadAutoCorrect(user: string, store: Pick<Storage, "getItem"> = localStorage): AutoCorrectSettings {
  try {
    const raw = store.getItem(storageKey(user));
    if (!raw) return { ...DEFAULT_AUTOCORRECT };
    const v = JSON.parse(raw) as Partial<AutoCorrectSettings>;
    const merged = { ...DEFAULT_AUTOCORRECT, ...v };
    if (!Array.isArray(merged.replacements)) merged.replacements = DEFAULT_REPLACEMENTS;
    if (!Array.isArray(merged.exceptions)) merged.exceptions = DEFAULT_EXCEPTIONS;
    return merged;
  } catch {
    return { ...DEFAULT_AUTOCORRECT };
  }
}

/** saveAutoCorrect stores a user's settings; storage errors are ignored. */
export function saveAutoCorrect(
  user: string,
  s: AutoCorrectSettings,
  store: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    store.setItem(storageKey(user), JSON.stringify(s));
  } catch {
    /* private window or quota: settings last for this session only */
  }
}

// --- the engine (pure) ----------------------------------------------------------------

/** One text edit inside the paragraph, as offsets into the text before the
 *  caret. */
export interface Edit {
  from: number;
  to: number;
  text: string;
}

export interface WordContext {
  /** Paragraph text before the caret. */
  before: string;
  /** The paragraph is the first one in a table cell. */
  firstInCell: boolean;
}

const LETTER = /\p{L}/u;
const WORDCH = /[\p{L}\p{N}_]/u;
const OPENERS = /[\s([{<«"'“‘—–-]/u;
const NO_CAPITALS = /\p{Script=Georgian}/u; // Mkhedruli is written without case (bug 69089)

/** smartQuote picks the curly form of a typed ' or " from the preceding
 *  character. */
export function smartQuote(ch: "'" | '"', prev: string | undefined): string {
  const open = !prev || OPENERS.test(prev) || prev === "“" || prev === "‘";
  if (ch === '"') return open ? "“" : "”";
  return open ? "‘" : "’";
}

function lastToken(s: string): { start: number; token: string } {
  const m = /\S+$/u.exec(s);
  return m ? { start: m.index, token: m[0] } : { start: s.length, token: "" };
}

/** wordEndEdits computes the corrections due when the word before the caret
 *  ends (dash, replacement list, capitalisation). Edits don't overlap and
 *  are in ascending order. */
export function wordEndEdits(ctx: WordContext, s: AutoCorrectSettings): Edit[] {
  let before = ctx.before;
  const edits: Edit[] = [];
  // 1. "--" -> em dash.
  if (s.dashes && /(^|[^-])--$/u.test(before)) {
    const at = before.length - 2;
    edits.push({ from: at, to: before.length, text: "—" });
    before = before.slice(0, at) + "—";
  }
  // 2. Replacement list.
  if (s.replaceText && !edits.length) {
    const { start, token } = lastToken(before);
    if (token) {
      const bare = token.replace(/^[("'“‘[]+/u, "");
      const lead = token.length - bare.length;
      for (const r of s.replacements) {
        if (!r.from) continue;
        const symbolic = !WORDCH.test(r.from);
        const whole = token === r.from;
        if (whole || (symbolic ? token.endsWith(r.from) : bare === r.from)) {
          const from = whole ? start : symbolic ? before.length - r.from.length : start + lead;
          edits.push({ from, to: before.length, text: r.to });
          before = before.slice(0, from) + r.to;
          break;
        }
      }
    }
  }
  // 3. Capitalise the first word of a sentence.
  const m = /[\p{L}\p{N}_'’]+$/u.exec(before);
  if (m && (s.capitalizeSentences || s.capitalizeCells)) {
    const word = m[0];
    const ws = m.index;
    const first = word[0];
    const tok = lastToken(before).token;
    const plainWord = !/[./@:\\]/u.test(tok) && !/\p{Lu}/u.test(word.slice(1));
    if (LETTER.test(first) && first !== first.toUpperCase() && !NO_CAPITALS.test(first) && plainWord) {
      const head = before.slice(0, ws).replace(/[\s"'“‘([{«]*$/u, "");
      let capitalize = false;
      if (!head) {
        capitalize = ctx.firstInCell ? s.capitalizeCells : s.capitalizeSentences;
      } else if (s.capitalizeSentences) {
        const core = head.replace(/["'”’)\]»]+$/u, "");
        if (/[.!?…]$/u.test(core)) {
          const prevTok = lastToken(core).token.toLowerCase();
          const isException = core.endsWith(".") && (s.exceptions.includes(prevTok) || /^\p{L}\.$/u.test(prevTok));
          capitalize = !isException;
        }
      }
      if (capitalize) {
        const up = first.toUpperCase();
        // Merge into a replacement edit covering the same word if any.
        const last = edits[edits.length - 1];
        if (last && last.from <= ws && ws < last.from + last.text.length) {
          const k = ws - last.from;
          last.text = last.text.slice(0, k) + up + last.text.slice(k + 1);
        } else {
          edits.push({ from: ws, to: ws + 1, text: up });
        }
      }
    }
  }
  return edits.sort((a, b) => a.from - b.from);
}

/** immediateReplacement finds a replacement-list entry ending in a symbol
 *  that typing `ch` completes. Entries that start with a letter or digit
 *  must start a word. */
export function immediateReplacement(
  before: string,
  ch: string,
  list: Replacement[],
): { from: number; to: string } | null {
  const text = before + ch;
  for (const r of list) {
    if (!r.from || WORDCH.test(r.from[r.from.length - 1]) || !text.endsWith(r.from)) continue;
    const from = text.length - r.from.length;
    if (WORDCH.test(r.from[0]) && from > 0 && WORDCH.test(text[from - 1])) continue;
    return { from, to: r.to };
  }
  return null;
}

// --- the extension ---------------------------------------------------------------------

interface UndoInfo {
  /** Range of corrected text in the current doc, and what was typed. */
  ranges: { from: number; to: number; original: string }[];
  /** Caret position right after the correction. */
  caret: number;
}

export const autoCorrectKey = new PluginKey<UndoInfo | null>("docAutoCorrect");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    autoCorrect: {
      /** Replace (part of) the AutoCorrect settings. */
      setAutoCorrect: (settings: Partial<AutoCorrectSettings>) => ReturnType;
    };
  }
}

// Per-editor settings. (TipTap 2 extension storage is shared by every
// editor built from the same extension object, so it can't hold them.)
const settingsByEditor = new WeakMap<Editor, AutoCorrectSettings>();

function blockTextBefore(state: EditorState): { text: string; start: number } | null {
  const { $from } = state.selection;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($from.marks().some((m) => m.type.name === "code")) return null;
  return {
    text: parent.textBetween(0, $from.parentOffset, undefined, "￼"),
    start: $from.start(),
  };
}

function firstInCell(state: EditorState): boolean {
  const { $from } = state.selection;
  if ($from.depth < 2) return false;
  const cell = $from.node($from.depth - 1);
  return /^table(Cell|Header)$/.test(cell.type.name) && $from.index($from.depth - 1) === 0;
}

/** applyEdits writes edits (offsets from `start`) into tr, keeping each
 *  replaced character's marks. Returns undo ranges in the new document. */
function applyEdits(
  tr: Transaction,
  start: number,
  before: string,
  edits: Edit[],
): UndoInfo["ranges"] {
  const undo: UndoInfo["ranges"] = [];
  let delta = 0;
  for (const e of edits) {
    const from = start + e.from + delta;
    const to = start + e.to + delta;
    const marks: readonly Mark[] = tr.doc.resolve(Math.min(from + 1, to)).marks();
    tr.replaceWith(from, to, tr.doc.type.schema.text(e.text, marks));
    undo.push({ from, to: from + e.text.length, original: before.slice(e.from, e.to) });
    delta += e.text.length - (e.to - e.from);
  }
  return undo;
}

export const AutoCorrect = Extension.create<{ settings: AutoCorrectSettings }>({
  name: "autoCorrect",
  addOptions() {
    return { settings: DEFAULT_AUTOCORRECT };
  },
  addCommands() {
    return {
      setAutoCorrect:
        (settings) =>
        () => {
          settingsByEditor.set(this.editor, { ...getAutoCorrect(this.editor), ...settings });
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    if (!settingsByEditor.has(editor)) settingsByEditor.set(editor, { ...this.options.settings });
    const settings = () => getAutoCorrect(editor);

    /** Run word-end corrections, then insert `ch` (if any). */
    const correct = (view: EditorView, ch: string | null): boolean => {
      const { state } = view;
      if (!state.selection.empty || !editor.isEditable) return false;
      const ctx = blockTextBefore(state);
      if (!ctx) return false;
      const s = settings();
      const caret = state.selection.from;
      const marks = state.storedMarks ?? state.selection.$from.marks();
      let edits: Edit[] = [];
      let insert = ch;
      // Word-end characters run every correction; any other character
      // only completes a pending "--" ("a--b" -> "a—b").
      const wordEnd = ch === null || /[\s.,;:!?)\]}”’-]/u.test(ch);
      let undoable = true;
      let typedOriginal: string | null = null;
      const immediate = ch && s.replaceText ? immediateReplacement(ctx.text, ch, s.replacements) : null;
      if (immediate) {
        edits = [{ from: immediate.from, to: ctx.text.length, text: immediate.to }];
        typedOriginal = (ctx.text + ch).slice(immediate.from);
        insert = null;
      } else if (ch === '"' || ch === "'") {
        if (!s.smartQuotes) return false;
        insert = smartQuote(ch, ctx.text.slice(-1) || undefined);
      } else {
        if (!wordEnd && !(s.dashes && ch !== "-")) return false;
        undoable = wordEnd;
        // "a." / "i)" alone at the start of a paragraph is a list marker
        // (numbering autocorrect, docModel.ts), not a sentence to capitalise.
        const listMarker = (ch === "." || ch === ")") && /^([a-zA-Z]|[ivx]+|[IVX]+)$/u.test(ctx.text);
        edits = wordEndEdits(
          { before: ctx.text, firstInCell: firstInCell(state) },
          wordEnd
            ? {
                ...s,
                dashes: s.dashes && ch !== "-",
                ...(listMarker ? { capitalizeSentences: false, capitalizeCells: false } : {}),
              }
            : { ...s, replaceText: false, capitalizeSentences: false, capitalizeCells: false },
        );
        if (
          ch === " " &&
          s.doubleSpacePeriod &&
          /[\p{L}\p{N}] $/u.test(ctx.text) &&
          !/[.!?…] $/u.test(ctx.text)
        ) {
          edits.push({ from: ctx.text.length - 1, to: ctx.text.length, text: ". " });
          insert = null;
        }
        if (!edits.length) return false;
      }
      const tr = state.tr;
      const ranges = applyEdits(tr, ctx.start, ctx.text, edits);
      if (typedOriginal !== null) ranges[0].original = typedOriginal;
      let end = tr.mapping.map(caret);
      if (insert) {
        tr.insert(end, state.schema.text(insert, marks));
        end += insert.length;
        if (ch === '"' || ch === "'") ranges.push({ from: end - 1, to: end, original: ch });
      }
      tr.setSelection(TextSelection.create(tr.doc, end));
      tr.setMeta(autoCorrectKey, undoable ? ({ ranges, caret: end } satisfies UndoInfo) : null);
      view.dispatch(tr.scrollIntoView());
      return true;
    };

    return [
      new Plugin<UndoInfo | null>({
        key: autoCorrectKey,
        state: {
          init: () => null,
          apply(tr, prev) {
            const meta = tr.getMeta(autoCorrectKey) as UndoInfo | null | undefined;
            if (meta !== undefined) return meta;
            return tr.docChanged || tr.selectionSet ? null : prev;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (from !== to || text.length !== 1) return false;
            return correct(view, text);
          },
          handleKeyDown(view, event) {
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              correct(view, null);
              return false; // let Enter split the paragraph as usual
            }
            if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey) {
              const undo = autoCorrectKey.getState(view.state);
              if (!undo || view.state.selection.from !== undo.caret || !view.state.selection.empty) return false;
              const tr = view.state.tr;
              for (let k = undo.ranges.length - 1; k >= 0; k--) {
                const r = undo.ranges[k];
                const marks = tr.doc.resolve(Math.min(r.from + 1, r.to)).marks();
                if (r.original) tr.replaceWith(r.from, r.to, view.state.schema.text(r.original, marks));
                else tr.delete(r.from, r.to);
              }
              tr.setMeta(autoCorrectKey, null);
              view.dispatch(tr);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** getAutoCorrect returns the editor's current AutoCorrect settings. */
export function getAutoCorrect(editor: Editor): AutoCorrectSettings {
  return settingsByEditor.get(editor) ?? DEFAULT_AUTOCORRECT;
}
