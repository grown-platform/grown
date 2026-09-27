// View toggles for Docs (M13): non-printing characters (¶, · for spaces,
// ° for no-break spaces, → for tabs, ↵ for line breaks) and the dark
// document colouring. Both are per user and never change the document.
import { useEffect, useState } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    nonPrinting: {
      /** Show or hide formatting marks (Word's ¶ button). */
      toggleNonPrinting: () => ReturnType;
      setNonPrinting: (on: boolean) => ReturnType;
    };
  }
}

const KEY = "grown.docs.nonPrinting";
export const nonPrintingKey = new PluginKey<{ on: boolean; decos: DecorationSet }>("nonPrinting");

function readPref(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writePref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private window */
  }
}

/** Decorations for the textblocks between `from` and `to`. */
function marksFor(doc: PMNode, from = 0, to = doc.content.size): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.isText) {
        const s = child.text ?? "";
        for (let i = 0; i < s.length; i++) {
          const c = s[i];
          if (c === " ") out.push(Decoration.inline(at + i, at + i + 1, { class: "np-space" }));
          else if (c === " ") out.push(Decoration.inline(at + i, at + i + 1, { class: "np-nbsp" }));
          else if (c === "\t") out.push(Decoration.inline(at + i, at + i + 1, { class: "np-tab" }));
        }
      } else if (child.type.name === "hardBreak") {
        out.push(Decoration.widget(at, () => mark("np-break"), { side: -1, key: "np-br" }));
      } else if (child.type.name === "tab" || child.type.name === "tabChar") {
        out.push(Decoration.node(at, at + child.nodeSize, { class: "np-tabnode" }));
      }
    });
    out.push(Decoration.widget(pos + node.nodeSize - 1, () => mark("np-para"), { side: 1, key: "np-p", marks: [] }));
    return false;
  });
  return out;
}

function mark(cls: string): HTMLElement {
  const el = document.createElement("span");
  el.className = `np-mark ${cls}`;
  el.contentEditable = "false";
  el.setAttribute("aria-hidden", "true");
  return el;
}

let stylesInstalled = false;
function installStyles() {
  if (stylesInstalled || typeof document === "undefined") return;
  stylesInstalled = true;
  const s = document.createElement("style");
  s.dataset.grown = "docs-view-modes";
  s.textContent = [
    // Zero-width marks so showing them never changes line breaks or pages.
    ".ProseMirror .np-mark{display:inline-block;width:0;overflow:visible;white-space:nowrap;pointer-events:none;user-select:none;color:#1a73e8;opacity:.7;font-weight:400;font-style:normal;text-decoration:none}",
    ".ProseMirror .np-para::after{content:'¶'}",
    ".ProseMirror .np-break::after{content:'↵'}",
    ".ProseMirror .np-space,.ProseMirror .np-nbsp,.ProseMirror .np-tab{position:relative}",
    ".ProseMirror .np-space::after,.ProseMirror .np-nbsp::after,.ProseMirror .np-tab::after{position:absolute;left:0;right:0;text-align:center;color:#1a73e8;opacity:.7;pointer-events:none}",
    ".ProseMirror .np-space::after{content:'·'}",
    ".ProseMirror .np-nbsp::after{content:'°'}",
    ".ProseMirror .np-tab::after,.ProseMirror .np-tabnode::after{content:'→'}",
    ".ProseMirror .np-tabnode{position:relative}",
    ".ProseMirror .np-tabnode::after{position:absolute;left:0;color:#1a73e8;opacity:.7}",
    // Dark document (View ▸ Dark document): invert the page, keep pictures.
    ".doc-dark{filter:invert(.92) hue-rotate(180deg)}",
    ".doc-dark img,.doc-dark .doc-drawing,.doc-dark video,.doc-dark .doc-watermark img{filter:invert(1) hue-rotate(180deg)}",
  ].join("\n");
  document.head.appendChild(s);
}

export const NonPrinting = Extension.create({
  name: "nonPrinting",
  addCommands() {
    return {
      toggleNonPrinting:
        () =>
        ({ state, dispatch }) => {
          const on = !nonPrintingKey.getState(state)?.on;
          if (dispatch) dispatch(state.tr.setMeta(nonPrintingKey, { on }).setMeta("addToHistory", false));
          writePref(on);
          return true;
        },
      setNonPrinting:
        (on) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(state.tr.setMeta(nonPrintingKey, { on }).setMeta("addToHistory", false));
          writePref(on);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    // grown-variant: Word/OnlyOffice use Ctrl+Shift+8 (Ctrl+*), which is
    // Grown's (Google Docs') bulleted list, so ¶ takes Ctrl+Alt+Shift+8.
    return {
      "Mod-Alt-Shift-8": () => this.editor.commands.toggleNonPrinting(),
      "Mod-Alt-Shift-*": () => this.editor.commands.toggleNonPrinting(),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: nonPrintingKey,
        state: {
          init: (_, state: EditorState) => {
            const on = readPref();
            return { on, decos: on ? DecorationSet.create(state.doc, marksFor(state.doc)) : DecorationSet.empty };
          },
          apply(tr: Transaction, prev, _old, state: EditorState) {
            const meta = tr.getMeta(nonPrintingKey) as { on: boolean } | undefined;
            if (meta) return { on: meta.on, decos: meta.on ? DecorationSet.create(state.doc, marksFor(state.doc)) : DecorationSet.empty };
            if (!prev.on || !tr.docChanged) return prev;
            // Redo only the textblocks an edit touched.
            let decos = prev.decos.map(tr.mapping, tr.doc);
            const ranges: [number, number][] = [];
            tr.mapping.maps.forEach((m, i) =>
              m.forEach((_a, _b, from, to) => {
                const rest = tr.mapping.slice(i + 1);
                ranges.push([rest.map(from, -1), rest.map(to, 1)]);
              }),
            );
            for (const [a, b] of ranges) {
              const from = Math.max(0, Math.min(a, tr.doc.content.size));
              const to = Math.max(from, Math.min(b, tr.doc.content.size));
              const $a = tr.doc.resolve(from);
              const $b = tr.doc.resolve(to);
              const start = $a.depth ? $a.before(1) : 0;
              const end = $b.depth ? $b.after(1) : tr.doc.content.size;
              decos = decos.remove(decos.find(start, end));
              decos = decos.add(tr.doc, marksFor(tr.doc, start, end));
            }
            return { on: true, decos };
          },
        },
        props: {
          decorations: (state) => nonPrintingKey.getState(state)?.decos ?? null,
          attributes: (state): Record<string, string> => (nonPrintingKey.getState(state)?.on ? { "data-nonprinting": "true" } : {}),
        },
        view: () => {
          installStyles();
          return {};
        },
      }),
    ];
  },
});

export const isNonPrinting = (editor: Editor) => !!nonPrintingKey.getState(editor.state)?.on;

// --- dark document ------------------------------------------------------------------------

const DARK_KEY = "grown.docs.darkDocument";

export function loadDarkDocument(): boolean {
  try {
    return localStorage.getItem(DARK_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDarkDocument(on: boolean) {
  installStyles();
  try {
    localStorage.setItem(DARK_KEY, on ? "1" : "0");
  } catch {
    /* private window */
  }
}

const DARK_EVENT = "grown-docs-dark-document";

/** toggleDarkDocument flips the dark document view (View menu). */
export function toggleDarkDocument() {
  const on = !loadDarkDocument();
  saveDarkDocument(on);
  window.dispatchEvent(new CustomEvent(DARK_EVENT, { detail: on }));
}

/** useDarkDocument: the dark document preference, live. */
export function useDarkDocument(): boolean {
  const [on, setOn] = useState(loadDarkDocument);
  useEffect(() => {
    if (on) saveDarkDocument(true);
    const h = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(DARK_EVENT, h);
    return () => window.removeEventListener(DARK_EVENT, h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}
