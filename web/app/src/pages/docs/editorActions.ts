import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";

/**
 * replaceAll replaces every occurrence of `find` with `replace` in the document.
 * Matches are applied end-to-start so earlier positions stay valid as the doc
 * length changes. Returns the number of replacements.
 */
export function replaceAll(
  editor: Editor,
  find: string,
  replace: string,
): number {
  if (!find) return 0;
  const matches: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      let i = node.text.indexOf(find);
      while (i !== -1) {
        matches.push({ from: pos + i, to: pos + i + find.length });
        i = node.text.indexOf(find, i + find.length);
      }
    }
  });
  if (!matches.length) return 0;
  const tr = editor.state.tr;
  for (let k = matches.length - 1; k >= 0; k--) {
    tr.insertText(replace, matches[k].from, matches[k].to);
  }
  editor.view.dispatch(tr);
  return matches.length;
}

const hasClipboard = () =>
  typeof navigator !== "undefined" && !!navigator.clipboard;

export function copySelection(): void {
  document.execCommand("copy");
}

export function cutSelection(): void {
  document.execCommand("cut");
}

/** paste inserts clipboard contents. plain=true strips formatting. Falls back to
 *  a hint when the Clipboard API is unavailable (e.g. an insecure origin). */
export async function paste(editor: Editor, plain: boolean): Promise<void> {
  if (!hasClipboard()) {
    window.alert(
      `Clipboard access is blocked here — use ${plain ? "Ctrl+Shift+V" : "Ctrl+V"}.`,
    );
    return;
  }
  try {
    if (!plain && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes("text/html")) {
          const html = await (await it.getType("text/html")).text();
          editor.chain().focus().insertContent(html).run();
          return;
        }
      }
    }
    const text = await navigator.clipboard.readText();
    editor.chain().focus().insertContent(text).run();
  } catch {
    window.alert(
      `Clipboard access is blocked here — use ${plain ? "Ctrl+Shift+V" : "Ctrl+V"}.`,
    );
  }
}

/** transformSelection rewrites each selected text node through fn, keeping
 *  the node's marks and the paragraph structure. fn sees one text node's
 *  slice at a time, so it should be context-free (use changeCase from
 *  textCase.ts for word/sentence-aware modes). */
export function transformSelection(editor: Editor, fn: (s: string) => string) {
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const tr = editor.state.tr;
  const edits: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (a >= b) return false;
    const text = node.text!.slice(a - pos, b - pos);
    const next = fn(text);
    if (next !== text) edits.push({ from: a, to: b, text: next, marks: node.marks });
    return false;
  });
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.text) tr.replaceWith(e.from, e.to, editor.schema.text(e.text, e.marks));
    else tr.delete(e.from, e.to);
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** toTitleCase capitalises the first letter of every word. Kept for callers
 *  that transform plain strings; the editor uses changeCase("capitalize"). */
export const toTitleCase = (s: string) =>
  s.replace(
    /\w\S*/g,
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );
