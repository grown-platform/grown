// Proofing language (Docs M13): a `lang` mark on runs (Word's w:lang /
// w:noProof run properties) and a document language in the docSettings
// Yjs map. Spell checking reads the language of each word from here.
import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { DEFAULT_LANGUAGE, NO_PROOFING, normalizeLang } from "../../lib/spell/languages";
import { settingsStore } from "./pageLayout";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    proofingLanguage: {
      /** Mark the selection (or, with an empty selection, the paragraph)
       *  as written in `lang`; NO_PROOFING turns checking off for it. */
      setTextLanguage: (lang: string) => ReturnType;
      /** Remove the language mark (the text follows the document). */
      unsetTextLanguage: () => ReturnType;
    };
  }
}

export const LangMark = Mark.create({
  name: "lang",
  inclusive: true,
  addAttributes() {
    return {
      lang: {
        default: null,
        parseHTML: (el) => normalizeLang((el as HTMLElement).getAttribute("lang")) || null,
        renderHTML: (a) => (a.lang ? { lang: a.lang } : {}),
      },
      noProof: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).hasAttribute("data-noproof"),
        renderHTML: (a) => (a.noProof ? { "data-noproof": "true", spellcheck: "false" } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[lang]" }, { tag: "span[data-noproof]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-lang" }), 0];
  },
  addCommands() {
    return {
      setTextLanguage:
        (lang) =>
        ({ tr, state, dispatch }) => {
          const t = normalizeLang(lang);
          let { from, to } = state.selection;
          if (from === to) {
            const $f = state.selection.$from;
            const d = textblockDepth($f);
            if (d == null) return false;
            from = $f.start(d);
            to = $f.end(d);
          }
          const type = state.schema.marks.lang;
          tr.removeMark(from, to, type);
          if (t) tr.addMark(from, to, type.create(t === NO_PROOFING ? { lang: null, noProof: true } : { lang: t, noProof: false }));
          if (state.selection.empty) tr.setStoredMarks(t ? [...(state.storedMarks ?? state.selection.$from.marks()).filter((m) => m.type !== type), type.create(t === NO_PROOFING ? { noProof: true } : { lang: t })] : null);
          if (dispatch) dispatch(tr);
          return true;
        },
      unsetTextLanguage:
        () =>
        ({ commands }) =>
          commands.unsetMark("lang"),
    };
  },
});

function textblockDepth($p: ResolvedPos): number | null {
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).isTextblock) return d;
  return $p.parent.isTextblock ? $p.depth : null;
}

// --- document language -------------------------------------------------------------------

/** The document's language (docSettings `lang`, en-US by default). */
export function docLanguage(editor: Editor): string {
  const v = settingsStore(editor).map.get("lang");
  return typeof v === "string" && v ? normalizeLang(v) : DEFAULT_LANGUAGE;
}

export function setDocLanguage(editor: Editor, lang: string) {
  settingsStore(editor).map.set("lang", normalizeLang(lang));
}

/** onDocLanguage calls `fn` when the document language changes. */
export function onDocLanguage(editor: Editor, fn: () => void): () => void {
  const map = settingsStore(editor).map;
  const h = (ev: { keysChanged: Set<string> }) => {
    if (ev.keysChanged.has("lang") || ev.keysChanged.has("spellIgnored")) fn();
  };
  map.observe(h);
  return () => map.unobserve(h);
}

/** The effective language of a text node: its mark, else the document's.
 *  NO_PROOFING when checking is off for it. */
export function languageOf(node: PMNode, docLang: string): string {
  const m = node.marks.find((mk) => mk.type.name === "lang");
  if (m?.attrs.noProof) return NO_PROOFING;
  return (m?.attrs.lang as string | null) || docLang;
}

/** The language at the selection (for the Language dialog / status). */
export function selectionLanguage(editor: Editor): string {
  const { $from } = editor.state.selection;
  const marks = editor.state.storedMarks ?? $from.marks();
  const m = marks.find((mk) => mk.type.name === "lang");
  if (m?.attrs.noProof) return NO_PROOFING;
  return (m?.attrs.lang as string | null) || docLanguage(editor);
}
