// The `math` node (Docs M11): an inline atom holding an equation model as a
// JSON string attribute (so it rides y-prosemirror like any attribute).
// `display` makes it a display equation on its own centred line (Word's
// m:oMathPara). The editor view renders it with KaTeX; getHTML() writes a
// <span data-math> with MathML inside, so HTML export, the clipboard and
// pandoc conversions all get a real equation.
import { Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import katex from "katex";
import "katex/dist/katex.min.css";
import { type Content, contentFromAttr, run, serializeContent } from "./model";
import { toLinear } from "./linear";
import { toKatex } from "./latex";
import { parseMathMLElement, toMathML } from "./mathml";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      /** Insert an equation at the selection and open it for editing. */
      insertEquation: (opts?: { content?: Content; display?: boolean; edit?: boolean }) => ReturnType;
      /** Replace the equation at `pos`. */
      updateEquation: (pos: number, eq: { content?: Content; display?: boolean }) => ReturnType;
    };
  }
}

/** Per-editor callback that opens the equation editor for the node at pos. */
type EditHandler = (pos: number, isNew: boolean) => void;
const handlers = new WeakMap<Editor, EditHandler>();
export function setMathEditHandler(editor: Editor, fn: EditHandler | null) {
  if (fn) handlers.set(editor, fn);
  else handlers.delete(editor);
}

/** contentOf reads a math node's equation (tolerating bad data). */
export const contentOf = (node: PMNode): Content => contentFromAttr(node.attrs.data);
export { serializeContent };

/** renderMath draws an equation into an element with KaTeX. */
export function renderMath(el: HTMLElement, c: Content, display: boolean) {
  const tex = toKatex(c);
  el.classList.toggle("doc-math-empty", !tex.trim());
  if (!tex.trim()) {
    el.textContent = "Type equation here.";
    return;
  }
  try {
    katex.render(tex, el, { throwOnError: false, displayMode: display, output: "htmlAndMathml", strict: "ignore" });
  } catch {
    el.textContent = toLinear(c);
  }
}

export const MathNode = Node.create({
  name: "math",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      data: {
        default: "[]",
        parseHTML: (el) =>
          el.localName === "math"
            ? serializeContent(parseMathMLElement(el).content)
            : el.getAttribute("data-math") || "[]",
        renderHTML: (attrs) => ({ "data-math": attrs.data }),
      },
      display: {
        default: false,
        parseHTML: (el) =>
          el.localName === "math" ? el.getAttribute("display") === "block" : el.getAttribute("data-display") === "block",
        renderHTML: (attrs) => (attrs.display ? { "data-display": "block" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-math]" }, { tag: "math" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const c = contentOf(node);
    const span = document.createElement("span");
    for (const [k, v] of Object.entries(HTMLAttributes)) if (v != null && v !== false) span.setAttribute(k, String(v));
    span.className = "doc-math";
    span.innerHTML = toMathML(c, !!node.attrs.display, toLinear(c));
    return span;
  },

  renderText({ node }) {
    return toLinear(contentOf(node));
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "doc-math";
      dom.contentEditable = "false";
      dom.setAttribute("data-testid", "doc-math");
      let current = node;
      const draw = (n: PMNode) => {
        const c = contentOf(n);
        dom.classList.toggle("doc-math-display", !!n.attrs.display);
        dom.setAttribute("data-linear", toLinear(c));
        dom.title = toLinear(c);
        renderMath(dom, c, !!n.attrs.display);
      };
      draw(node);
      dom.addEventListener("click", (e) => {
        const fn = handlers.get(editor);
        const pos = typeof getPos === "function" ? getPos() : null;
        if (!fn || pos == null || !editor.isEditable) return;
        e.preventDefault();
        fn(pos, false);
      });
      return {
        dom,
        update: (n: PMNode) => {
          if (n.type.name !== "math") return false;
          if (n.attrs.data !== current.attrs.data || n.attrs.display !== current.attrs.display) draw(n);
          current = n;
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },

  addCommands() {
    return {
      insertEquation:
        (opts = {}) =>
        ({ tr, dispatch, editor }) => {
          const node = this.type.create({ data: serializeContent(opts.content ?? [run()]), display: !!opts.display });
          const at = tr.selection.from;
          tr.replaceSelectionWith(node, false);
          if (dispatch) {
            dispatch(tr);
            if (opts.edit !== false) {
              const fn = handlers.get(editor);
              const pos = tr.mapping.map(at, -1);
              if (fn) setTimeout(() => fn(pos, true), 0);
            }
          }
          return true;
        },
      updateEquation:
        (pos, eq) =>
        ({ tr, dispatch, state }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "math") return false;
          const attrs = { ...node.attrs };
          if (eq.content) attrs.data = serializeContent(eq.content);
          if (eq.display !== undefined) attrs.display = eq.display;
          if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, attrs));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-=": () => this.editor.commands.insertEquation(),
    };
  },
});
