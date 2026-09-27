// Link insertion shared by Ctrl+K, the toolbar, Insert > Link and the
// context menu.
//
// ProseMirror learns about a selection the browser changed (Shift+Home,
// Shift+arrows) from the asynchronous `selectionchange` event. A shortcut
// pressed straight after such a key can therefore run while the editor
// state still holds the old caret, and a blocking window.prompt keeps the
// pending event from being handled until after the command ran: the link
// then lands on an empty selection and nothing is linked. promptLink reads
// the DOM selection into the state first, and applies the link to the range
// captured before the prompt opened.
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { resolveLinkInput } from "../../lib/urlType";

/** syncSelectionFromDOM copies the browser's selection into the editor
 *  state when it lies inside the editor and differs from the state's text
 *  selection. Node and cell selections are left alone. Returns true when
 *  the state changed. */
export function syncSelectionFromDOM(view: EditorView): boolean {
  const root = view.root as Document | ShadowRoot;
  const sel = (root as Document).getSelection?.() ?? window.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode) return false;
  if (!view.dom.contains(sel.anchorNode) || !view.dom.contains(sel.focusNode)) return false;
  const cur = view.state.selection;
  if (!(cur instanceof TextSelection)) return false;
  let anchor: number;
  let head: number;
  try {
    anchor = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    head = view.posAtDOM(sel.focusNode, sel.focusOffset);
  } catch {
    return false;
  }
  if (anchor === cur.anchor && head === cur.head) return false;
  const { doc } = view.state;
  const next = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
  if (next.eq(cur)) return false;
  view.dispatch(view.state.tr.setSelection(next));
  return true;
}

export interface LinkUI {
  prompt?: (message: string, value: string) => string | null;
  confirm?: (msg: string) => boolean;
  alert?: (msg: string) => void;
}

/** promptLink asks for a URL and links the selection (or, with an empty
 *  selection, inserts the URL as linked text). An empty answer removes the
 *  link; cancelling does nothing. Returns the href set, "" when removed,
 *  or null when cancelled. */
export function promptLink(editor: Editor, ui: LinkUI = {}): string | null {
  syncSelectionFromDOM(editor.view);
  const { from, to, empty } = editor.state.selection;
  const prev = (editor.getAttributes("link").href as string) || "";
  const ask = ui.prompt ?? ((m: string, v: string) => window.prompt(m, v));
  const url = resolveLinkInput(ask("Link URL", prev), ui);
  if (url === null) {
    editor.commands.focus();
    return null;
  }
  // The prompt blocked the page, so no edit can have moved the range.
  const chain = editor.chain().focus().setTextSelection({ from, to });
  if (url === "") {
    chain.extendMarkRange("link").unsetLink().run();
  } else if (empty && !prev) {
    chain
      .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
      .run();
  } else if (empty) {
    chain.extendMarkRange("link").setLink({ href: url }).run();
  } else {
    chain.setLink({ href: url }).run();
  }
  return url;
}
