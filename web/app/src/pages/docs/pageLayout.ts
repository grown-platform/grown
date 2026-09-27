// Page layout in the editor (Docs M9): the `sectionBreak` and
// `columnBreak` block atoms, the `docSettings` Yjs map, and commands to
// insert breaks and change a section's (or the whole document's) page
// setup. The pure model is sections.ts; pagination is pagination.ts +
// paginationPlugin.ts.
import { Node, type Editor } from "@tiptap/core";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import * as Y from "yjs";
import {
  SECTION_START_LABEL,
  SECTION_STARTS,
  defaultSettings,
  encodeSection,
  normalizeSection,
  parseSection,
  sectionAt,
  sectionsOf,
  DEFAULT_HYPHENATION,
  type DocSettings,
  type Section,
  type SectionProps,
  type SectionStart,
} from "./sections";
import { getDocModel } from "./docModel";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageLayout: {
      /** Word-style section break at the caret: the paragraph splits and
       *  the text after it starts a new section (`kind`). Both sections
       *  keep the current page setup. */
      insertSectionBreak: (kind?: SectionStart) => ReturnType;
      /** Column break at the caret (Ctrl+Shift+Enter). */
      insertColumnBreak: () => ReturnType;
    };
  }
}

// --- settings store ------------------------------------------------------------------------

/** SettingsStore wraps the `docSettings` Yjs map. */
export class SettingsStore {
  constructor(readonly map: Y.Map<unknown>) {}

  get(): DocSettings {
    const d = defaultSettings();
    const m = this.map;
    const json = <T>(k: string, fallback: T): T => {
      const v = m.get(k);
      if (v == null) return fallback;
      if (typeof v === "string") {
        try {
          return JSON.parse(v) as T;
        } catch {
          return fallback;
        }
      }
      return v as T;
    };
    return {
      section: m.has("section") ? parseSection(m.get("section")) : d.section,
      pageColor: (m.get("pageColor") as string | undefined) || null,
      watermark: json("watermark", null),
      evenOdd: m.get("evenOdd") === true,
      mirror: m.get("mirror") === true,
      pageless: m.get("pageless") === true,
      hyphenation: { ...DEFAULT_HYPHENATION, ...json("hyphenation", {}) },
    };
  }

  set(patch: Partial<DocSettings>) {
    const write = () => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (k === "section") this.map.set(k, encodeSection(v as SectionProps));
        else if (k === "watermark" || k === "hyphenation") this.map.set(k, v == null ? null : JSON.stringify(v));
        else this.map.set(k, v as never);
      }
    };
    if (this.map.doc) this.map.doc.transact(write);
    else write();
  }

  observe(fn: () => void): () => void {
    const h = () => fn();
    this.map.observe(h);
    return () => this.map.unobserve(h);
  }
}

const stores = new WeakMap<Editor, SettingsStore>();

/** settingsStore returns the editor's settings (the doc's Yjs map, or a
 *  private one without collaboration). */
export function settingsStore(editor: Editor): SettingsStore {
  let s = stores.get(editor);
  if (!s) {
    const model = getDocModel(editor);
    const ydoc = (model?.sheet.map.doc as Y.Doc | null) ?? new Y.Doc();
    s = new SettingsStore(ydoc.getMap("docSettings"));
    stores.set(editor, s);
  }
  return s;
}

export const getSettings = (editor: Editor): DocSettings => settingsStore(editor).get();

export function setDocSettings(editor: Editor, patch: Partial<DocSettings>) {
  settingsStore(editor).set(patch);
}

// --- sections in a live document ----------------------------------------------------------

export function docSections(editor: Editor, doc: PMNode = editor.state.doc): Section[] {
  return sectionsOf(doc, getSettings(editor).section);
}

/** The section holding the selection (its start). */
export function currentSection(editor: Editor): Section {
  const secs = docSections(editor);
  return sectionAt(secs, editor.state.selection.from);
}

export type SetupScope = "section" | "document" | "forward";

/** writeSectionProps stores a section's setup (on its break, or in the
 *  settings for the last section) in `tr`. */
function writeSection(editor: Editor, tr: Transaction, s: Section, props: SectionProps): void {
  if (s.breakPos == null) {
    settingsStore(editor).set({ section: props });
    return;
  }
  const pos = tr.mapping.map(s.breakPos);
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name === "sectionBreak") tr.setNodeMarkup(pos, undefined, { ...node.attrs, sectPr: encodeSection(props) });
}

/**
 * setSectionProps changes the page setup: of the section at the caret,
 * of every section (whole document), or from the caret on ("this point
 * forward" inserts a next-page section break at the caret's paragraph).
 */
export function setSectionProps(
  editor: Editor,
  change: Partial<SectionProps> | ((p: SectionProps) => SectionProps),
  scope: SetupScope = "section",
): boolean {
  const apply = (p: SectionProps) => normalizeSection(typeof change === "function" ? change(p) : { ...p, ...change });
  const secs = docSections(editor);
  const tr = editor.state.tr;
  if (scope === "document") {
    for (const s of secs) writeSection(editor, tr, s, apply(s.props));
  } else if (scope === "forward") {
    const cur = sectionAt(secs, editor.state.selection.from);
    const $f = editor.state.selection.$from;
    // Break before the caret's top-level block (unless it starts the section).
    const blockStart = $f.depth ? $f.before(1) : $f.pos;
    if (blockStart > cur.from) {
      const br = editor.schema.nodes.sectionBreak.create({ id: newSectionId(), kind: "nextPage", sectPr: encodeSection(cur.props) });
      tr.insert(blockStart, br);
    }
    for (const s of secs) if (s.index >= cur.index) writeSection(editor, tr, s, apply(s.props));
  } else {
    const cur = sectionAt(secs, editor.state.selection.from);
    writeSection(editor, tr, cur, apply(cur.props));
  }
  if (tr.docChanged) editor.view.dispatch(tr);
  return true;
}

/** setBreakKind changes how the section after a break starts. */
export function setBreakKind(editor: Editor, breakPos: number, kind: SectionStart): boolean {
  const node = editor.state.doc.nodeAt(breakPos);
  if (node?.type.name !== "sectionBreak") return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(breakPos, undefined, { ...node.attrs, kind }));
  return true;
}

let idSeq = 0;
export function newSectionId(): string {
  idSeq = (idSeq + 1) % 1e6;
  return `s${Date.now().toString(36)}${idSeq.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

// --- break insertion ------------------------------------------------------------------------

/** Split the caret's textblock and put a block atom between the halves. */
function insertBlockBreak(state: EditorState, tr: Transaction, type: NodeType, attrs: Record<string, unknown> | null, topLevel: boolean): boolean {
  if (!(tr.selection instanceof TextSelection)) return false;
  if (!tr.selection.empty) tr.deleteSelection();
  const $pos = tr.selection.$from;
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
  if (topLevel && $pos.depth !== 1) {
    // Section breaks live between top-level blocks: after the caret's
    // top-level block.
    const after = $pos.after(1);
    tr.insert(after, type.create(attrs));
    const next = after + 1;
    if (next >= tr.doc.content.size || !tr.doc.nodeAt(next)?.isTextblock) tr.insert(next, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(next + 1)));
    return true;
  }
  const parent = $pos.node($pos.depth - 1);
  const index = $pos.index($pos.depth - 1);
  if (!parent.canReplaceWith(index + 1, index + 1, type)) return false;
  tr.split($pos.pos);
  const after = tr.selection.$from.before();
  tr.insert(after, type.create(attrs));
  return true;
}

// --- nodes ---------------------------------------------------------------------------------

export const SectionBreak = Node.create({
  name: "sectionBreak",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-section-id"),
        renderHTML: (a) => (a.id ? { "data-section-id": String(a.id) } : {}),
      },
      /** How the next section starts. */
      kind: {
        default: "nextPage",
        parseHTML: (el) => {
          const k = (el as HTMLElement).getAttribute("data-kind") ?? "nextPage";
          return (SECTION_STARTS as string[]).includes(k) ? k : "nextPage";
        },
        renderHTML: (a) => ({ "data-kind": String(a.kind) }),
      },
      /** The page setup of the section this break ends (JSON). */
      sectPr: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-sectpr"),
        renderHTML: (a) => (a.sectPr ? { "data-sectpr": String(a.sectPr) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-section-break]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const kind = (node.attrs.kind as SectionStart) ?? "nextPage";
    return [
      "div",
      {
        ...HTMLAttributes,
        "data-section-break": "true",
        class: "section-break",
        contenteditable: "false",
        "data-label": `Section break (${SECTION_START_LABEL[kind] ?? "Next page"})`,
      },
    ];
  },
  renderText() {
    return "\n";
  },
  addCommands() {
    return {
      insertSectionBreak:
        (kind: SectionStart = "nextPage") =>
        ({ tr, state, dispatch, editor }) => {
          const cur = sectionAt(sectionsOf(state.doc, getSettings(editor).section), state.selection.from);
          const ok = insertBlockBreak(state, tr, this.type, { id: newSectionId(), kind, sectPr: encodeSection(cur.props) }, true);
          if (ok && dispatch) dispatch(tr.scrollIntoView());
          return ok;
        },
    };
  },
});

export const ColumnBreak = Node.create({
  name: "columnBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-column-break]" }];
  },
  renderHTML() {
    return ["div", { "data-column-break": "true", class: "column-break", contenteditable: "false" }];
  },
  renderText() {
    return "\n";
  },
  addCommands() {
    return {
      insertColumnBreak:
        () =>
        ({ tr, state, dispatch }) => {
          const ok = insertBlockBreak(state, tr, this.type, null, false);
          if (ok && dispatch) dispatch(tr.scrollIntoView());
          return ok;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-Enter": () => (this.editor.isActive("codeBlock") ? false : this.editor.commands.insertColumnBreak()),
    };
  },
});

/** Section-break labels for menus. */
export const BREAK_ITEMS: { kind: SectionStart; label: string }[] = SECTION_STARTS.map((k) => ({
  kind: k,
  label: `Section break (${SECTION_START_LABEL[k].toLowerCase()})`,
}));
