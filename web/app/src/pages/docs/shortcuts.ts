// Word-processor keyboard shortcuts for Docs, on top of TipTap's defaults
// (bold/italic/underline, Ctrl+Alt+0-6 styles, Ctrl+Shift+7/8 lists,
// Ctrl+Shift+L/E/R/J alignment, Shift+Enter line break, ...).
//
// Two schemes, chosen per user (lib/shortcutScheme.ts):
//   * "office" (default): Microsoft Word conventions. Where a Word chord is
//     already taken by a long-standing Grown binding, Grown's binding wins
//     and the row carries a note:
//       - Ctrl+Shift+L stays "align left" (Word: List Bullet style); bullets
//         remain Ctrl+Shift+8.
//       - Ctrl+] / Ctrl+[ indent; Word's Ctrl+] / Ctrl+[ font size is
//         Ctrl+Shift+. / Ctrl+Shift+, here (Word's other font-size chords).
//       - Headings are Ctrl+Alt+1-6 (Word: Ctrl+Alt+1-3).
//   * "google": Google Docs conventions (strikethrough Alt+Shift+5, spelling
//     Ctrl+Alt+X, no Word-only chords such as Ctrl+L/E/R/J or Ctrl+=).
//
// SCHEME_BINDINGS holds the chords that differ between the schemes and
// SHORTCUT_ROWS every documented chord; shortcutGroups(scheme) is the single
// source for the Help > Keyboard shortcuts dialog and the menu hints, and the
// DocShortcuts keymap below dispatches from SCHEME_BINDINGS, so what the
// dialog lists is what is bound.
import { Extension, type Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { selectedBlocks, toPt } from "./paragraphFormat";
import { unicodeToChar } from "./textOps";
import { DEFAULT_SHORTCUT_SCHEME, getShortcutScheme, type ShortcutScheme } from "../../lib/shortcutScheme";

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
const NON_FORMAT_MARKS = new Set(["link", "commentMark", "insertion", "deletion", "formatChange"]);
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

// --- scheme bindings -------------------------------------------------------------------

/** Actions whose chords differ between the Office and Google schemes. */
export type SchemeAction =
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "alignJustify"
  | "strikethrough"
  | "superscript"
  | "subscript"
  | "wordCount"
  | "spelling"
  | "unicodeToChar";

/** SCHEME_BINDINGS: per scheme, the chords (display notation, "Ctrl" = Ctrl
 *  or Cmd, "Alt" = Alt or Option) of every action that differs between the
 *  schemes. The first chord is the one menus show. */
export const SCHEME_BINDINGS: Record<ShortcutScheme, Record<SchemeAction, string[]>> = {
  office: {
    alignLeft: ["Ctrl+L", "Ctrl+Shift+L"],
    alignCenter: ["Ctrl+E", "Ctrl+Shift+E"],
    alignRight: ["Ctrl+R", "Ctrl+Shift+R"],
    alignJustify: ["Ctrl+J", "Ctrl+Shift+J"],
    strikethrough: ["Ctrl+Shift+S"],
    superscript: ["Ctrl+Shift+=", "Ctrl+."],
    subscript: ["Ctrl+=", "Ctrl+,"],
    wordCount: ["Ctrl+Shift+G", "Ctrl+Shift+C"],
    spelling: ["F7"],
    unicodeToChar: ["Alt+X", "Ctrl+Alt+X"],
  },
  google: {
    alignLeft: ["Ctrl+Shift+L"],
    alignCenter: ["Ctrl+Shift+E"],
    alignRight: ["Ctrl+Shift+R"],
    alignJustify: ["Ctrl+Shift+J"],
    strikethrough: ["Alt+Shift+5"],
    superscript: ["Ctrl+."],
    subscript: ["Ctrl+,"],
    wordCount: ["Ctrl+Shift+C"],
    spelling: ["Ctrl+Alt+X"],
    unicodeToChar: ["Alt+X"],
  },
};

/** Scheme actions handled by DocEditor's window listener (they work with the
 *  editor unfocused); the rest run in the editor keymap. */
export const APP_LEVEL_ACTIONS: ReadonlySet<SchemeAction> = new Set(["wordCount", "spelling"]);

/** toPmChord turns "Ctrl+Shift+=" into ProseMirror's "Mod-Shift-=". */
export function toPmChord(keys: string): string {
  const parts = keys.split("+");
  const key = parts.pop() || "+";
  const mods = parts.map((m) => (m === "Ctrl" ? "Mod" : m));
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join("-");
}

/** Does a keyboard event press `keys` (display notation)? Letters and digits
 *  match on the physical key, so Alt/Option and Shift don't change them. */
export function eventMatchesChord(keys: string, e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  const parts = keys.split("+");
  const key = parts.pop() || "+";
  const mods = new Set(parts);
  if (mods.has("Ctrl") !== (e.ctrlKey || e.metaKey)) return false;
  if (mods.has("Alt") !== e.altKey || mods.has("Shift") !== e.shiftKey) return false;
  if (/^[A-Z]$/i.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  return e.key === key;
}

/** schemeActionFor returns the app-level scheme action a key event triggers. */
export function schemeActionFor(
  scheme: ShortcutScheme,
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): SchemeAction | null {
  for (const a of APP_LEVEL_ACTIONS) {
    if (SCHEME_BINDINGS[scheme][a].some((k) => eventMatchesChord(k, e))) return a;
  }
  return null;
}

/** shortcutHint is the chord a menu shows for a scheme action. */
export function shortcutHint(scheme: ShortcutScheme, action: SchemeAction): string {
  return SCHEME_BINDINGS[scheme][action][0] ?? "";
}

// --- storage / hooks -------------------------------------------------------------------

export interface DocShortcutsStorage {
  /** Formatting copied with Ctrl+Alt+C. */
  copiedFormat: readonly Mark[] | null;
  /** Called on Ctrl+S (the document saves continuously; the app may show a
   *  "saved" hint). */
  onSave: (() => void) | null;
  /** Pins the shortcut scheme (tests); null follows the user's preference
   *  (lib/shortcutScheme.ts). TipTap v2 extension storage is shared by every
   *  editor on the page. */
  scheme: ShortcutScheme | null;
}

declare module "@tiptap/core" {
  interface Storage {
    docShortcuts: DocShortcutsStorage;
  }
}

/** The editor commands behind the in-editor scheme actions. */
function runSchemeAction(editor: Editor, action: SchemeAction): boolean {
  switch (action) {
    case "alignLeft":
      return editor.commands.setTextAlign("left");
    case "alignCenter":
      return toggleAlign(editor, "center");
    case "alignRight":
      return toggleAlign(editor, "right");
    case "alignJustify":
      return toggleAlign(editor, "justify");
    case "strikethrough":
      return editor.commands.toggleStrike();
    case "superscript":
      return editor.commands.toggleSuperscript();
    case "subscript":
      return editor.commands.toggleSubscript();
    case "unicodeToChar":
      return unicodeToChar(editor);
    default:
      return false;
  }
}

/** schemeKeymap builds the ProseMirror bindings for SCHEME_BINDINGS: each
 *  chord runs the action the active scheme gives it, and falls through
 *  (false) when the active scheme doesn't bind it, so the browser or a
 *  lower-priority extension gets the key. Alt+X without Ctrl is handled by
 *  the numpad plugin below (macOS types a character with Option+X). */
function schemeKeymap(editor: () => Editor, scheme: () => ShortcutScheme): Record<string, () => boolean> {
  const chords = new Set<string>();
  for (const map of Object.values(SCHEME_BINDINGS)) {
    for (const [action, keys] of Object.entries(map)) {
      if (APP_LEVEL_ACTIONS.has(action as SchemeAction)) continue;
      for (const k of keys) if (k !== "Alt+X") chords.add(k);
    }
  }
  const out: Record<string, () => boolean> = {};
  for (const k of chords) {
    out[toPmChord(k)] = () => {
      const map = SCHEME_BINDINGS[scheme()];
      const action = (Object.keys(map) as SchemeAction[]).find(
        (a) => !APP_LEVEL_ACTIONS.has(a) && map[a].includes(k),
      );
      return action ? runSchemeAction(editor(), action) : false;
    };
  }
  return out;
}

export const DocShortcuts = Extension.create<object, DocShortcutsStorage>({
  name: "docShortcuts",
  // Above StarterKit/TextAlign (100) so Ctrl+Enter and the align toggles win
  // over HardBreak's Ctrl+Enter and TextAlign's plain setters.
  priority: 110,
  addStorage() {
    return { copiedFormat: null, onSave: null, scheme: null };
  },
  addKeyboardShortcuts() {
    const e = () => this.editor;
    const inCode = () => e().isActive("codeBlock");
    return {
      // Alignment, strikethrough, sub/superscript and the other chords that
      // differ between the Office and Google schemes.
      ...schemeKeymap(e, () => this.storage.scheme ?? getShortcutScheme("docs")),
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
  /** Set when Grown's binding differs from Word/OnlyOffice's (Office scheme). */
  note?: string;
}

/** A row template: fixed keys, or a scheme action whose keys depend on the
 *  scheme. */
type RowTemplate = { label: string; note?: string } & ({ keys: string } | { action: SchemeAction });

const ROWS: { title: string; items: RowTemplate[] }[] = [
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
      { label: "Strikethrough", action: "strikethrough" },
      { label: "Superscript", action: "superscript" },
      { label: "Subscript", action: "subscript" },
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
      { label: "Heading 1–6", keys: "Ctrl+Alt+1…6", note: "Word: Ctrl+Alt+1…3" },
      { label: "Align left", action: "alignLeft" },
      { label: "Center (again: left)", action: "alignCenter" },
      { label: "Align right (again: left)", action: "alignRight" },
      { label: "Justify (again: left)", action: "alignJustify" },
      { label: "Increase indent", keys: "Ctrl+M / Ctrl+]", note: "Word: Ctrl+] is font size" },
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
      { label: "Equation", keys: "Ctrl+Alt+=", note: "Word: Alt+=" },
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
      { label: "Hex code to character", action: "unicodeToChar" },
    ],
  },
  {
    title: "Fields & links",
    items: [
      { label: "Update fields / table of contents", keys: "F9" },
      { label: "Update all fields", keys: "Ctrl+F9" },
      { label: "Show field codes", keys: "Alt+F9" },
      { label: "Unlink fields (keep the text)", keys: "Ctrl+Shift+F9" },
      { label: "Insert page number", keys: "Alt+Shift+P", note: "OnlyOffice: Ctrl+Shift+P" },
      { label: "Insert date", keys: "Alt+Shift+D" },
      { label: "Insert time", keys: "Alt+Shift+T" },
      { label: "Follow link", keys: "Ctrl+Click / Alt+Enter" },
    ],
  },
  {
    title: "Menus & tools",
    items: [
      { label: "Search the menus", keys: "Alt+/" },
      { label: "Keyboard shortcuts", keys: "Ctrl+/" },
      { label: "Insert comment", keys: "Ctrl+Alt+M" },
      { label: "Spelling and grammar", action: "spelling" },
      { label: "Word count", action: "wordCount" },
      { label: "Version history", keys: "Ctrl+Alt+Shift+H" },
    ],
  },
];

/** shortcutGroups is the Help > Keyboard shortcuts list for a scheme. */
export function shortcutGroups(scheme: ShortcutScheme): { title: string; items: ShortcutRow[] }[] {
  return ROWS.map((g) => ({
    title: g.title,
    items: g.items.flatMap((r): ShortcutRow[] => {
      const keys = "action" in r ? SCHEME_BINDINGS[scheme][r.action].join(" / ") : r.keys;
      if (!keys) return [];
      const note = scheme === "office" ? r.note : undefined;
      return [note ? { label: r.label, keys, note } : { label: r.label, keys }];
    }),
  }));
}

/** The default (Office) scheme's list. */
export const SHORTCUT_GROUPS = shortcutGroups(DEFAULT_SHORTCUT_SCHEME);
