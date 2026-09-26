// Word-processor keyboard shortcuts for Docs, on top of TipTap's defaults
// (bold/italic/underline, Ctrl+Alt+0-6 styles, Ctrl+Shift+7/8 lists,
// Ctrl+Shift+L/E/R/J alignment, Shift+Enter line break, ...).
//
// Most bindings follow Word / OnlyOffice. Where one of those chords is
// already taken by a Grown (Google Docs-style) binding, Grown's binding wins
// and the table below marks the action as a "grown-variant":
//   * Ctrl+Shift+L stays "align left"; bullets remain Ctrl+Shift+8.
//   * Ctrl+] / Ctrl+[ indent (Google Docs); Word uses them for font size,
//     which here is Ctrl+Shift+. / Ctrl+Shift+, (both editors agree).
//   * Headings are Ctrl+Alt+1-6 (Google Docs), not Alt+1-3.
//
// SHORTCUT_GROUPS is the single source for the Help > Keyboard shortcuts
// dialog, so what it lists is what is bound.
import { Extension, type Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { selectedBlocks, toPt } from "./paragraphFormat";
import { unicodeToChar } from "./textOps";

// --- font size steps ----------------------------------------------------------------

/** Font sizes the increase/decrease shortcuts step through. */
export const FONT_SIZE_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
/** Grown's default text size (what the toolbar shows with no size set). */
export const DEFAULT_FONT_PT = 11;

/** nextFontSize returns the next size up (dir 1) or down (dir -1). Sizes past
 *  the table move by 10pt above it and 1pt below it. */
export function nextFontSize(cur: number, dir: 1 | -1): number {
  if (dir > 0) {
    const n = FONT_SIZE_STEPS.find((s) => s > cur + 1e-6);
    return n ?? Math.min(400, Math.floor(cur / 10) * 10 + 10);
  }
  const lower = FONT_SIZE_STEPS.filter((s) => s < cur - 1e-6);
  if (lower.length) return lower[lower.length - 1];
  return Math.max(1, Math.ceil(cur) - 1);
}

/** stepFontSize grows or shrinks the selection's font size one step. */
export function stepFontSize(editor: Editor, dir: 1 | -1): boolean {
  const cur = toPt(editor.getAttributes("textStyle").fontSize as string) ?? DEFAULT_FONT_PT;
  return editor.chain().setFontSize(`${nextFontSize(cur, dir)}pt`).run();
}

// --- character formatting -------------------------------------------------------------

/** Marks that are content or review state rather than character formatting;
 *  "reset character formatting" keeps them. */
const NON_FORMAT_MARKS = new Set(["link", "commentMark", "insertion", "deletion"]);
const isFormatMark = (m: Mark) => !NON_FORMAT_MARKS.has(m.type.name);

/** resetCharFormatting removes character formatting (bold, italic, font,
 *  size, colour, highlight, ...) from the selection, keeping links, comment
 *  anchors and suggestions. With an empty selection it resets the formatting
 *  the next typed characters get. */
export function resetCharFormatting(editor: Editor): boolean {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  const tr = state.tr;
  if (empty) {
    const keep = (state.storedMarks ?? $from.marks()).filter((m) => !isFormatMark(m));
    tr.setStoredMarks(keep);
  } else {
    for (const type of Object.values(state.schema.marks)) {
      if (!NON_FORMAT_MARKS.has(type.name)) tr.removeMark(from, to, type);
    }
  }
  editor.view.dispatch(tr);
  return true;
}

// --- format painter (copy / paste formatting) ------------------------------------

function formatMarksAtSelection(editor: Editor): readonly Mark[] {
  const { state } = editor;
  const { $from, empty, from } = state.selection;
  if (empty) return (state.storedMarks ?? $from.marks()).filter(isFormatMark);
  const node = state.doc.nodeAt(from);
  return (node?.marks ?? $from.marks()).filter(isFormatMark);
}

/** pasteFormatting applies copied character formatting to the selection (or
 *  to what is typed next when the selection is empty). */
export function pasteFormatting(editor: Editor, marks: readonly Mark[]): boolean {
  const { state } = editor;
  const { from, to, empty, $from } = state.selection;
  const tr = state.tr;
  if (empty) {
    const keep = (state.storedMarks ?? $from.marks()).filter((m) => !isFormatMark(m));
    tr.setStoredMarks([...keep, ...marks]);
  } else {
    for (const type of Object.values(state.schema.marks)) {
      if (!NON_FORMAT_MARKS.has(type.name)) tr.removeMark(from, to, type);
    }
    for (const m of marks) tr.addMark(from, to, m);
  }
  editor.view.dispatch(tr);
  return true;
}

// --- symbols ------------------------------------------------------------------------

export const SYMBOLS = {
  nbsp: " ",
  nbHyphen: "‑",
  enDash: "–",
  emDash: "—",
  copyright: "©",
  registered: "®",
  trademark: "™",
  euro: "€",
  ellipsis: "…",
} as const;

function insertSymbol(editor: Editor, ch: string): boolean {
  const { state } = editor;
  editor.view.dispatch(state.tr.insertText(ch).scrollIntoView());
  return true;
}

// --- paragraph helpers ---------------------------------------------------------------

function inList(editor: Editor): string | null {
  if (editor.isActive("taskItem")) return "taskItem";
  if (editor.isActive("listItem")) return "listItem";
  return null;
}

/** indent (Ctrl+M, Ctrl+]): nests a list item, otherwise indents the
 *  paragraph one step. */
export function indent(editor: Editor): boolean {
  const item = inList(editor);
  if (item && editor.commands.sinkListItem(item)) return true;
  return editor.commands.indentParagraph();
}

/** outdent (Ctrl+Shift+M, Ctrl+[): lifts a list item, otherwise removes one
 *  indent step from the paragraph. */
export function outdent(editor: Editor): boolean {
  const item = inList(editor);
  if (item && editor.commands.liftListItem(item)) return true;
  return editor.commands.outdentParagraph();
}

/** toggleAlign sets an alignment, or returns to left alignment when the
 *  paragraph already has it (Word/OnlyOffice behaviour). */
export function toggleAlign(editor: Editor, align: "center" | "right" | "justify"): boolean {
  if (editor.isActive({ textAlign: align })) return editor.commands.setTextAlign("left");
  return editor.commands.setTextAlign(align);
}

// --- storage / hooks -------------------------------------------------------------------

export interface DocShortcutsStorage {
  /** Formatting copied with Ctrl+Alt+C. */
  copiedFormat: readonly Mark[] | null;
  /** Called on Ctrl+S (the document saves continuously; the app may show a
   *  "saved" hint). */
  onSave: (() => void) | null;
}

declare module "@tiptap/core" {
  interface Storage {
    docShortcuts: DocShortcutsStorage;
  }
}

export const DocShortcuts = Extension.create<object, DocShortcutsStorage>({
  name: "docShortcuts",
  // Above StarterKit/TextAlign (100) so Ctrl+Enter and the align toggles win
  // over HardBreak's Ctrl+Enter and TextAlign's plain setters.
  priority: 110,
  addStorage() {
    return { copiedFormat: null, onSave: null };
  },
  addKeyboardShortcuts() {
    const e = () => this.editor;
    const inCode = () => e().isActive("codeBlock");
    return {
      // Breaks
      "Mod-Enter": () => (inCode() ? false : e().commands.insertPageBreak()),
      // Font size
      "Mod-Shift-.": () => stepFontSize(e(), 1),
      "Mod-Shift-,": () => stepFontSize(e(), -1),
      // Indent
      "Mod-m": () => indent(e()),
      "Mod-Shift-m": () => outdent(e()),
      "Mod-]": () => indent(e()),
      "Mod-[": () => outdent(e()),
      // Alignment toggles (left stays TextAlign's Mod-Shift-l)
      "Mod-Shift-e": () => toggleAlign(e(), "center"),
      "Mod-Shift-r": () => toggleAlign(e(), "right"),
      "Mod-Shift-j": () => toggleAlign(e(), "justify"),
      // Character formatting
      "Mod-Space": () => resetCharFormatting(e()),
      "Mod-\\": () => e().chain().clearNodes().unsetAllMarks().run(),
      "Mod-Alt-c": () => {
        this.storage.copiedFormat = formatMarksAtSelection(e());
        return true;
      },
      "Mod-Alt-v": () =>
        this.storage.copiedFormat ? pasteFormatting(e(), this.storage.copiedFormat) : false,
      // Special characters
      "Mod-Shift-Space": () => insertSymbol(e(), SYMBOLS.nbsp),
      "Mod-Shift--": () => insertSymbol(e(), SYMBOLS.nbHyphen),
      "Alt--": () => insertSymbol(e(), SYMBOLS.enDash),
      "Alt-Shift--": () => insertSymbol(e(), SYMBOLS.emDash),
      "Mod-Alt-g": () => insertSymbol(e(), SYMBOLS.copyright),
      "Mod-Alt-r": () => insertSymbol(e(), SYMBOLS.registered),
      "Mod-Alt-t": () => insertSymbol(e(), SYMBOLS.trademark),
      "Mod-Alt-e": () => insertSymbol(e(), SYMBOLS.euro),
      "Mod-Alt-.": () => insertSymbol(e(), SYMBOLS.ellipsis),
      "Mod-Alt-x": () => unicodeToChar(e()),
      // Notes
      "Mod-Alt-f": () => e().commands.insertFootnote(),
      "Mod-Alt-d": () => e().commands.insertEndnote(),
      // Save: the document is saved continuously; swallow the browser's
      // "Save page as" and let the app acknowledge it.
      "Mod-s": () => {
        this.storage.onSave?.();
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
    return [
      new Plugin({
        key: new PluginKey("docShortcutsNumpad"),
        props: {
          handleKeyDown(_view, event) {
            // Ctrl+Num- en dash, Ctrl+Alt+Num- em dash (the keymap can't tell
            // the numpad minus from the main-row one).
            if (event.code === "NumpadSubtract" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
              return insertSymbol(editor, event.altKey ? SYMBOLS.emDash : SYMBOLS.enDash);
            }
            // Alt+X (Word) on Windows/Linux; on macOS Option+X types a
            // character, so there only Cmd+Option+X converts.
            if (
              !isMac &&
              event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              event.code === "KeyX"
            ) {
              return unicodeToChar(editor);
            }
            return false;
          },
        },
      }),
    ];
  },
});

// --- Tab ------------------------------------------------------------------------------

/** TabCharacter makes Tab outside lists and tables insert a tab character,
 *  or indent the paragraphs when whole paragraphs are selected; Shift+Tab
 *  removes one indent step. Low priority so list and table Tab handling
 *  (nest item, next cell) runs first. */
export const TabCharacter = Extension.create({
  name: "tabCharacter",
  priority: 10,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const editor = this.editor;
        const { state } = editor;
        const sel = state.selection;
        const spansBlocks = !sel.$from.sameParent(sel.$to);
        const fromBlockStart = !sel.empty && sel.$from.parentOffset === 0;
        if (spansBlocks || (fromBlockStart && sel.to >= sel.$from.end())) {
          return editor.commands.indentParagraph();
        }
        if (!(sel instanceof TextSelection) || !sel.$from.parent.isTextblock) return false;
        editor.view.dispatch(state.tr.insertText("\t").scrollIntoView());
        return true;
      },
      "Shift-Tab": () => {
        if (!selectedBlocks(this.editor.state).some((b) => b.node.attrs.indent)) return false;
        return this.editor.commands.outdentParagraph();
      },
    };
  },
});

// --- the shortcut reference ---------------------------------------------------------

export interface ShortcutRow {
  label: string;
  keys: string;
  /** Set when Grown's binding differs from Word/OnlyOffice's. */
  note?: string;
}

export const SHORTCUT_GROUPS: { title: string; items: ShortcutRow[] }[] = [
  {
    title: "Common actions",
    items: [
      { label: "Copy", keys: "Ctrl+C" },
      { label: "Cut", keys: "Ctrl+X" },
      { label: "Paste", keys: "Ctrl+V" },
      { label: "Paste without formatting", keys: "Ctrl+Shift+V" },
      { label: "Undo", keys: "Ctrl+Z" },
      { label: "Redo", keys: "Ctrl+Y / Ctrl+Shift+Z" },
      { label: "Select all", keys: "Ctrl+A" },
      { label: "Find", keys: "Ctrl+F" },
      { label: "Find and replace", keys: "Ctrl+H" },
      { label: "Save (saves automatically)", keys: "Ctrl+S" },
      { label: "Print", keys: "Ctrl+P" },
    ],
  },
  {
    title: "Text formatting",
    items: [
      { label: "Bold", keys: "Ctrl+B" },
      { label: "Italic", keys: "Ctrl+I" },
      { label: "Underline", keys: "Ctrl+U" },
      { label: "Strikethrough", keys: "Ctrl+Shift+S" },
      { label: "Superscript", keys: "Ctrl+." },
      { label: "Subscript", keys: "Ctrl+," },
      { label: "Increase font size", keys: "Ctrl+Shift+." },
      { label: "Decrease font size", keys: "Ctrl+Shift+," },
      { label: "Reset character formatting", keys: "Ctrl+Space" },
      { label: "Clear formatting", keys: "Ctrl+\\" },
      { label: "Copy formatting", keys: "Ctrl+Alt+C" },
      { label: "Paste formatting", keys: "Ctrl+Alt+V" },
    ],
  },
  {
    title: "Paragraph formatting",
    items: [
      { label: "Normal text", keys: "Ctrl+Alt+0" },
      { label: "Heading 1–6", keys: "Ctrl+Alt+1…6", note: "Word: Alt+1…3" },
      { label: "Align left", keys: "Ctrl+Shift+L", note: "Word: Ctrl+L" },
      { label: "Center (again: left)", keys: "Ctrl+Shift+E" },
      { label: "Align right (again: left)", keys: "Ctrl+Shift+R" },
      { label: "Justify (again: left)", keys: "Ctrl+Shift+J" },
      { label: "Increase indent", keys: "Ctrl+M / Ctrl+]" },
      { label: "Decrease indent", keys: "Ctrl+Shift+M / Ctrl+[" },
      { label: "Numbered list", keys: "Ctrl+Shift+7" },
      { label: "Bulleted list", keys: "Ctrl+Shift+8", note: "Word: Ctrl+Shift+L" },
    ],
  },
  {
    title: "Insert",
    items: [
      { label: "Page break", keys: "Ctrl+Enter" },
      { label: "Line break", keys: "Shift+Enter" },
      { label: "Tab character", keys: "Tab" },
      { label: "Footnote", keys: "Ctrl+Alt+F" },
      { label: "Endnote", keys: "Ctrl+Alt+D" },
      { label: "Insert link", keys: "Ctrl+K" },
      { label: "Non-breaking space", keys: "Ctrl+Shift+Space" },
      { label: "Non-breaking hyphen", keys: "Ctrl+Shift+-" },
      { label: "En dash –", keys: "Ctrl+Num- / Alt+-" },
      { label: "Em dash —", keys: "Ctrl+Alt+Num- / Alt+Shift+-" },
      { label: "Ellipsis …", keys: "Ctrl+Alt+." },
      { label: "Copyright ©", keys: "Ctrl+Alt+G" },
      { label: "Registered ®", keys: "Ctrl+Alt+R" },
      { label: "Trademark ™", keys: "Ctrl+Alt+T" },
      { label: "Euro €", keys: "Ctrl+Alt+E" },
      { label: "Hex code to character", keys: "Alt+X" },
    ],
  },
  {
    title: "Menus & tools",
    items: [
      { label: "Search the menus", keys: "Alt+/" },
      { label: "Keyboard shortcuts", keys: "Ctrl+/" },
      { label: "Insert comment", keys: "Ctrl+Alt+M" },
      { label: "Word count", keys: "Ctrl+Shift+C" },
      { label: "Version history", keys: "Ctrl+Alt+Shift+H" },
    ],
  },
];
