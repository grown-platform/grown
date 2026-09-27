// Spell checking in the Docs editor (M13).
//
// The words of every textblock (with the language of their run, the
// document language otherwise) go to the shared spell service
// (lib/spell), which checks them in a Web Worker against Hunspell
// dictionaries. Misspellings become red wavy-underline decorations; the
// context menu offers suggestions, "Ignore", "Ignore all" (per document,
// kept in the docSettings Yjs map) and "Add to dictionary" (per user,
// synced to the user's server-side preferences).
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { spellTokens } from "../../lib/spell/tokenize";
import { spellService } from "../../lib/spell/service";
import { NO_PROOFING } from "../../lib/spell/languages";
import { docLanguage, languageOf, onDocLanguage } from "./language";
import { settingsStore } from "./pageLayout";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    spellcheck: {
      /** Turn spell checking on or off (per user, every document). */
      setSpellcheck: (on: boolean) => ReturnType;
      /** Stop flagging this occurrence. */
      ignoreSpellingOnce: (from: number, to: number) => ReturnType;
    };
  }
}

export interface SpellWord {
  word: string;
  lang: string;
  from: number;
  to: number;
}

/** Marks whose text is never checked. */
const SKIP_MARKS = new Set(["code", "deletion"]);
/** Blocks whose text is never checked. */
const SKIP_BLOCKS = new Set(["codeBlock", "math", "tableOfContents"]);

/** collectWords lists the checkable words of a document (pure). */
export function collectWords(doc: PMNode, docLang: string): SpellWord[] {
  const out: SpellWord[] = [];
  doc.descendants((block, pos) => {
    if (SKIP_BLOCKS.has(block.type.name)) return false;
    if (!block.isTextblock) return true;
    let text = "";
    const langs: string[] = [];
    const starts: number[] = [];
    block.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.isText) {
        const skip = child.marks.some((m) => SKIP_MARKS.has(m.type.name));
        const lang = skip ? NO_PROOFING : languageOf(child, docLang);
        const s = child.text ?? "";
        for (let i = 0; i < s.length; i++) {
          text += s[i];
          langs.push(lang);
          starts.push(at + i);
        }
      } else {
        text += "￼";
        langs.push(NO_PROOFING);
        starts.push(at);
      }
    });
    for (const t of spellTokens(text)) {
      const lang = langs[t.from];
      if (lang === NO_PROOFING || langs[t.to - 1] === NO_PROOFING) continue;
      out.push({ word: t.word, lang, from: starts[t.from], to: starts[t.to - 1] + 1 });
    }
    return false;
  });
  return out;
}

// --- plugin ------------------------------------------------------------------------------

interface SpellState {
  decos: DecorationSet;
  /** "Ignore" once: ranges mapped through edits. */
  ignored: DecorationSet;
}

export const spellKey = new PluginKey<SpellState>("spellcheck");

type Meta = { decos?: DecorationSet; ignore?: { from: number; to: number } };

/** Words ignored in this document ("Ignore all"). */
export function ignoredWords(editor: Editor): Set<string> {
  const v = settingsStore(editor).map.get("spellIgnored");
  try {
    return new Set(Array.isArray(v) ? (v as string[]) : typeof v === "string" ? (JSON.parse(v) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function ignoreAll(editor: Editor, word: string) {
  const s = ignoredWords(editor);
  s.add(word);
  settingsStore(editor).map.set("spellIgnored", JSON.stringify([...s].sort()));
}

/** The misspellings currently shown, in document order. */
export function misspellings(state: EditorState): SpellWord[] {
  const st = spellKey.getState(state);
  if (!st) return [];
  return st.decos
    .find()
    .map((d) => ({ from: d.from, to: d.to, word: (d.spec as { word: string }).word, lang: (d.spec as { lang: string }).lang }))
    .sort((a, b) => a.from - b.from);
}

/** The misspelling at (or touching) `pos`, if any. */
export function misspellingAt(state: EditorState, pos: number): SpellWord | null {
  return misspellings(state).find((m) => pos >= m.from && pos <= m.to) ?? null;
}

/** replaceMisspelling swaps a flagged word for a suggestion, keeping the
 *  run formatting of its first letter. */
export function replaceMisspelling(editor: Editor, m: SpellWord, text: string) {
  const cur = editor.state.doc.textBetween(m.from, m.to);
  if (cur !== m.word) return false;
  const tr = editor.state.tr.insertText(text, m.from, m.to);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

const editors = new WeakMap<EditorView, Editor>();
const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

function computeDecos(editor: Editor, view: EditorView): { decos: DecorationSet; pending: Map<string, Set<string>> } {
  const svc = spellService();
  const pending = new Map<string, Set<string>>();
  if (!svc.enabled || !editor.isEditable) return { decos: DecorationSet.empty, pending };
  const state = view.state;
  const st = spellKey.getState(state);
  const ignored = ignoredWords(editor);
  const once = st?.ignored.find() ?? [];
  const docLang = docLanguage(editor);
  const sel = state.selection;
  const out: Decoration[] = [];
  for (const w of collectWords(state.doc, docLang)) {
    if (ignored.has(w.word)) continue;
    if (once.some((d) => d.from === w.from && d.to === w.to)) continue;
    // Don't flag the word being typed (caret at its end, focused).
    if (sel.empty && view.hasFocus() && sel.from === w.to && typing.get(view)) continue;
    const k = svc.known(w.lang, w.word);
    if (k === undefined) {
      const set = pending.get(w.lang) ?? new Set<string>();
      set.add(w.word);
      pending.set(w.lang, set);
    } else if (!k) {
      out.push(Decoration.inline(w.from, w.to, { class: "spell-error", "data-spell": w.word }, { word: w.word, lang: w.lang }));
    }
  }
  return { decos: DecorationSet.create(state.doc, out), pending };
}

const typing = new WeakMap<EditorView, boolean>();

/** refresh recomputes the decorations and queues unknown words. */
function refresh(view: EditorView): Promise<void> {
  const editor = editors.get(view);
  if (!editor || editor.isDestroyed) return Promise.resolve();
  const { decos, pending } = computeDecos(editor, view);
  const prev = spellKey.getState(view.state)?.decos;
  if (!prev || !sameDecos(prev, decos))
    view.dispatch(view.state.tr.setMeta(spellKey, { decos } satisfies Meta).setMeta("addToHistory", false));
  const svc = spellService();
  return Promise.all([...pending].map(([lang, words]) => svc.check(lang, words))).then(() => undefined);
}

function sameDecos(a: DecorationSet, b: DecorationSet): boolean {
  const x = a.find();
  const y = b.find();
  return x.length === y.length && x.every((d, i) => d.from === y[i].from && d.to === y[i].to);
}

function schedule(view: EditorView, ms = 350) {
  clearTimeout(timers.get(view));
  timers.set(
    view,
    setTimeout(() => void refresh(view), ms),
  );
}

/** checkSpellingNow recomputes immediately and waits for the checker
 *  (tests, the Spelling dialog). */
export async function checkSpellingNow(editor: Editor): Promise<SpellWord[]> {
  const view = editor.view;
  clearTimeout(timers.get(view));
  typing.set(view, false);
  await refresh(view);
  await refresh(view);
  return misspellings(editor.state);
}

let stylesInstalled = false;
function installStyles() {
  if (stylesInstalled || typeof document === "undefined") return;
  stylesInstalled = true;
  const s = document.createElement("style");
  s.dataset.grown = "docs-spell";
  s.textContent =
    ".ProseMirror .spell-error{text-decoration:underline wavy #d93025;text-decoration-skip-ink:none;text-underline-offset:3px;text-decoration-thickness:1px}" +
    ".doc-dark .ProseMirror .spell-error{text-decoration-color:#ff7b72}";
  document.head.appendChild(s);
}

export const SpellCheck = Extension.create({
  name: "spellcheck",
  addCommands() {
    return {
      setSpellcheck:
        (on) =>
        ({ editor }) => {
          spellService().setEnabled(on);
          schedule(editor.view, 0);
          return true;
        },
      ignoreSpellingOnce:
        (from, to) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(spellKey, { ignore: { from, to } } satisfies Meta));
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<SpellState>({
        key: spellKey,
        state: {
          init: () => ({ decos: DecorationSet.empty, ignored: DecorationSet.empty }),
          apply(tr: Transaction, prev: SpellState): SpellState {
            const meta = tr.getMeta(spellKey) as Meta | undefined;
            let decos = prev.decos.map(tr.mapping, tr.doc);
            let ignored = prev.ignored.map(tr.mapping, tr.doc);
            if (meta?.decos) decos = meta.decos;
            if (meta?.ignore) {
              ignored = ignored.add(tr.doc, [Decoration.inline(meta.ignore.from, meta.ignore.to, {})]);
              decos = decos.remove(decos.find(meta.ignore.from, meta.ignore.to));
            }
            if (tr.docChanged) {
              // Drop flags on words being edited; the next check redraws them.
              const touched: Decoration[] = [];
              tr.mapping.maps.forEach((m, i) =>
                m.forEach((_a, _b, from, to) => {
                  const mapped = tr.mapping.slice(i + 1);
                  touched.push(...decos.find(mapped.map(from, -1), mapped.map(to, 1)));
                }),
              );
              if (touched.length) decos = decos.remove(touched);
            }
            return { decos, ignored };
          },
        },
        props: {
          decorations: (state) => spellKey.getState(state)?.decos ?? null,
          // Our checker replaces the browser's, so there's one set of squiggles.
          attributes: () => ({ spellcheck: "false", lang: docLanguage(editor) }),
          handleTextInput: (view) => {
            typing.set(view, true);
            return false;
          },
          handleKeyDown: (view, ev) => {
            if (ev.key.length === 1 && /[\p{L}\p{M}'’]/u.test(ev.key)) typing.set(view, true);
            else if (ev.key.length === 1 || ev.key === "Enter" || ev.key === "Tab") typing.set(view, false);
            return false;
          },
        },
        view: (view) => {
          editors.set(view, editor);
          installStyles();
          const svc = spellService();
          const off = svc.subscribe(() => schedule(view, 0));
          const offLang = onDocLanguage(editor, () => schedule(view, 0));
          schedule(view, 50);
          return {
            update: (v, prev) => {
              if (!v.state.doc.eq(prev.doc)) schedule(v);
              else if (!v.state.selection.eq(prev.selection) && typing.get(v)) {
                // Moving away from the word just typed flags it.
                typing.set(v, false);
                schedule(v, 0);
              }
            },
            destroy: () => {
              off();
              offLang();
              clearTimeout(timers.get(view));
            },
          };
        },
      }),
    ];
  },
});
