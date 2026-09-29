import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { GrownTable, GrownTableView, GrownTableCell, GrownTableHeader, GrownTableRow, TableTools } from "./tables";
import StarterKit from "@tiptap/starter-kit";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { OBJECT_NODES, insertPictureFile, objectNodeView } from "./objectNodes";
import { objectAttributeSpecs } from "./objects";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { InsertionMark, DeletionMark, FormatChangeMark, TrackParagraphs, Suggesting } from "./suggesting";
import { Drawing } from "./drawing";
import { MathNode } from "./math/MathNode";
import { ParagraphSpacing, ParagraphIndent, ParagraphShading } from "./paragraphFormat";
import { DocShortcuts, TabCharacter } from "./shortcuts";
import { ParagraphProps } from "./paragraphProps";
import { DocModel, CharStyle } from "./docModel";
import { ClipboardHandling } from "./clipboard";
import { Search } from "./search";
import { AutoCorrect } from "./autocorrect";
import { BookmarkMark, BookmarkPoint, LinkWithTitle } from "./bookmarks";
import { Field, References } from "./references";
import { TableOfContents, TocEntry } from "./toc";
import type * as Y from "yjs";
import { ColumnBreak, SectionBreak } from "./pageLayout";
import { Pagination } from "./paginationPlugin";
import { M13_EXTENSIONS } from "./m13Extensions";
import type { WebsocketProvider } from "y-websocket";
import { ContentControls, SdtBlock, SdtInline } from "./sdt";
import { DocProtection } from "./protection";
import { CustomXmlBinding } from "./customXml";

// TipTap has no official font-size extension, so add a textStyle attribute that
// renders inline `font-size`. Mirrors the shape of @tiptap/extension-color.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

// LineHeight applies a line-height to paragraphs and headings — the "Line &
// paragraph spacing" control. TipTap ships no official line-height extension.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineHeight: {
      setLineHeight: (value: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export const LineHeight = Extension.create({
  name: "lineHeight",
  addOptions() {
    return { types: ["paragraph", "heading"], default: null as string | null };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: this.options.default,
            parseHTML: (el) => (el as HTMLElement).style.lineHeight || null,
            renderHTML: (attrs) =>
              attrs.lineHeight
                ? { style: `line-height: ${attrs.lineHeight}` }
                : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight:
        (value) =>
        ({ tr, state, dispatch }) => {
          const { selection } = state;
          if (dispatch) {
            const { from, to } = selection;
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (this.options.types.includes(node.type.name)) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  lineHeight: value,
                });
              }
            });
            dispatch(tr);
          }
          return true;
        },
      unsetLineHeight:
        () =>
        ({ chain }) =>
          chain()
            .updateAttributes("paragraph", { lineHeight: null })
            .updateAttributes("heading", { lineHeight: null })
            .run(),
    };
  },
});

// ParagraphSpacing (numeric space before/after), ParagraphIndent and
// ParagraphShading live in paragraphFormat.ts.
export { ParagraphSpacing, ParagraphIndent, ParagraphShading } from "./paragraphFormat";

// PageBreak is a block atom that forces the following content onto a new page
// when printed/exported (CSS break-after: page) and shows a dashed divider on
// screen.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      setPageBreak: () => ReturnType;
      /** Word-style page break (Ctrl+Enter): splits the paragraph at the
       *  caret and puts the break between the halves, leaving the caret at
       *  the start of the text after the break. */
      insertPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return [
      "div",
      { "data-page-break": "true", class: "page-break", contenteditable: "false" },
    ];
  },
  addCommands() {
    return {
      // Mirror the proven Drawing-node insertion (a single atom-block insert);
      // a trailing-paragraph insert in the same chain could fail and roll the
      // whole transaction back, leaving nothing inserted.
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent({ type: "pageBreak" }).run(),
      insertPageBreak:
        () =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.nodes.pageBreak;
          if (!(tr.selection instanceof TextSelection)) return false;
          if (!tr.selection.empty) tr.deleteSelection();
          const $pos = tr.selection.$from;
          if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
          // The break must be allowed next to this textblock in its parent.
          const parent = $pos.node($pos.depth - 1);
          const index = $pos.index($pos.depth - 1);
          if (!parent.canReplaceWith(index + 1, index + 1, type)) return false;
          if (dispatch) {
            tr.split($pos.pos);
            const after = tr.selection.$from.before();
            tr.insert(after, type.create());
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});

// ImagePaste lets users paste or drop image files into the document — TipTap's
// Image extension doesn't handle this. Since M7 files are uploaded to the
// document's asset store (docAssets.ts), falling back to data URLs.
function imageFilesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const f of Array.from(dt.files))
    if (f.type.startsWith("image/")) out.push(f);
  if (!out.length && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

function insertImage(view: EditorView, file: File) {
  // Docs M7: the picture goes to the document's asset store (a data: URL
  // when that isn't available) and lands inline at the caret.
  const editor = (view.dom as HTMLElement & { editor?: import("@tiptap/core").Editor }).editor;
  if (editor) {
    void insertPictureFile(editor, file);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const node = view.state.schema.nodes.image?.create({ src: reader.result });
    if (node) view.dispatch(view.state.tr.replaceSelectionWith(node));
  };
  reader.readAsDataURL(file);
}

export const ImagePaste = Extension.create({
  name: "imagePaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const files = imageFilesFrom(event.clipboardData);
            if (!files.length) return false;
            files.forEach((f) => insertImage(view, f));
            return true;
          },
          handleDrop(view, event) {
            const files = imageFilesFrom((event as DragEvent).dataTransfer);
            if (!files.length) return false;
            event.preventDefault();
            files.forEach((f) => insertImage(view, f));
            return true;
          },
        },
      }),
    ];
  },
});

export const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
            renderHTML: (attrs) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain()
            .setMark("textStyle", { fontSize: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});

// CommentMark highlights a range that has one or more anchored comments. It
// carries the comment id so clicks can focus the matching thread, and renders a
// yellow underline/background consistent with Google Docs' comment anchors.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentMark: {
      setCommentMark: (commentId: string) => ReturnType;
      unsetCommentMark: (commentId: string) => ReturnType;
    };
  }
}

export const CommentMark = Mark.create({
  name: "commentMark",
  // Comment anchors should not merge across distinct comments.
  excludes: "",
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-comment-id"),
        renderHTML: (attrs) =>
          attrs.commentId ? { "data-comment-id": attrs.commentId } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "doc-comment-anchor" }),
      0,
    ];
  },
  addCommands() {
    return {
      setCommentMark:
        (commentId) =>
        ({ chain }) =>
          chain().setMark("commentMark", { commentId }).run(),
      unsetCommentMark:
        (commentId) =>
        ({ state, dispatch, tr }) => {
          // Remove only marks matching commentId across the whole document.
          const markType = state.schema.marks.commentMark;
          if (!markType) return false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            node.marks.forEach((m) => {
              if (m.type === markType && m.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, markType);
              }
            });
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});

// Footnote is an inline atom marking a footnote reference. The note text lives
// in the `content` attribute; the visible superscript number is supplied by a
// CSS counter (.footnote-ref::before in editorStyles), so markers auto-renumber
// as footnotes are inserted, deleted, or reordered. The Footnotes panel renders
// the matching numbered notes at the bottom of the page.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (content?: string) => ReturnType;
      setFootnoteContent: (id: string, content: string) => ReturnType;
    };
  }
}

let footnoteSeq = 0;
function newFootnoteId(): string {
  footnoteSeq += 1;
  return `fn-${Date.now().toString(36)}-${footnoteSeq}`;
}

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-footnote-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-footnote-id": attrs.id } : {},
      },
      content: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-content") || "",
        renderHTML: (attrs) => ({ "data-content": attrs.content || "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "sup.footnote-ref" }];
  },
  renderHTML({ HTMLAttributes }) {
    const content = (HTMLAttributes["data-content"] as string) || "";
    return [
      "sup",
      mergeAttributes(HTMLAttributes, { class: "footnote-ref", title: content }),
    ];
  },
  addCommands() {
    return {
      insertFootnote:
        (content = "") =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { id: newFootnoteId(), content },
            })
            .run(),
      setFootnoteContent:
        (id, content) =>
        ({ state, dispatch, tr }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name === "footnote" && node.attrs.id === id) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, content });
              found = true;
            }
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },
});

// Endnote mirrors Footnote but its notes collect at the END of the document
// (rendered by the Endnotes panel) rather than the bottom of the page. Markers
// auto-number via a separate CSS counter (.endnote-ref::before, lower-roman).
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    endnote: {
      insertEndnote: (content?: string) => ReturnType;
      setEndnoteContent: (id: string, content: string) => ReturnType;
    };
  }
}

let endnoteSeq = 0;
function newEndnoteId(): string {
  endnoteSeq += 1;
  return `en-${Date.now().toString(36)}-${endnoteSeq}`;
}

export const Endnote = Node.create({
  name: "endnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-endnote-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-endnote-id": attrs.id } : {},
      },
      content: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-content") || "",
        renderHTML: (attrs) => ({ "data-content": attrs.content || "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "sup.endnote-ref" }];
  },
  renderHTML({ HTMLAttributes }) {
    const content = (HTMLAttributes["data-content"] as string) || "";
    return [
      "sup",
      mergeAttributes(HTMLAttributes, { class: "endnote-ref", title: content }),
    ];
  },
  addCommands() {
    return {
      insertEndnote:
        (content = "") =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { id: newEndnoteId(), content },
            })
            .run(),
      setEndnoteContent:
        (id, content) =>
        ({ state, dispatch, tr }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name === "endnote" && node.attrs.id === id) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, content });
              found = true;
            }
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },
});

// Image with an optional display size (px). Imported .docx pictures carry
// their Word size; the writer uses it for the drawing extent (Docs M6).
// Only the width renders, so the browser keeps the aspect ratio.
export const SizedImage = Image.extend({
  draggable: true,
  addNodeView() {
    // Docs M7: wrapping, crop, rotation and resize handles (objectNodes.ts).
    return objectNodeView(this.editor) as never;
  },
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      ...objectAttributeSpecs(),
      width: {
        default: null,
        parseHTML: (el) => {
          const v = parseInt((el as HTMLElement).getAttribute("width") ?? "", 10);
          return Number.isFinite(v) && v > 0 ? v : null;
        },
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const v = parseInt((el as HTMLElement).getAttribute("data-height") ?? "", 10);
          return Number.isFinite(v) && v > 0 ? v : null;
        },
        renderHTML: (attrs) => (attrs.height ? { "data-height": String(attrs.height) } : {}),
      },
    };
  },
});

// Table nodes with the M4 table / row / cell properties (tables.ts). The
// cell and header nodes keep the M1 backgroundColor attribute.
export const TableCellBg = GrownTableCell;
export const TableHeaderBg = GrownTableHeader;

/** Options for the collaborative (app) editor: Yjs document + websocket
 *  provider. `collab` may be omitted; it defaults to true. */
export interface CollabBuildOpts {
  collab?: true;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  userName: string;
  userColor: string;
  editable: boolean;
}

/** Options for a standalone editor with no Yjs document or websocket (used by
 *  the headless vitest harness). ProseMirror's own history provides undo. */
export interface LocalBuildOpts {
  collab: false;
  userName?: string;
  userColor?: string;
  editable?: boolean;
  /** Bind to this Yjs document (no provider, no remote cursors); Yjs then
   *  owns undo. Lets tests sync several editors in-process. */
  ydoc?: Y.Doc;
}

export type BuildOpts = CollabBuildOpts | LocalBuildOpts;

/** Strike without its own keyboard shortcut (see DocShortcuts). */
const SchemeStrike = Strike.extend({
  addKeyboardShortcuts() {
    return {};
  },
});

/** buildExtensions assembles the full editor extension set. With collab (the
 *  default) Yjs owns history, so StarterKit's undo/redo is disabled
 *  (Collaboration provides it). With `collab: false` the Yjs extensions are
 *  left out and StarterKit's history is kept. */
export function buildExtensions(opts: BuildOpts) {
  const userName = opts.userName ?? "Test user";
  const userColor = opts.userColor ?? "#1a73e8";
  const localYdoc = opts.collab === false ? opts.ydoc : undefined;
  const collabExts =
    opts.collab === false
      ? localYdoc
        ? [Collaboration.configure({ document: localYdoc })]
        : []
      : [
          Collaboration.configure({ document: opts.ydoc }),
          CollaborationCursor.configure({
            provider: opts.provider,
            user: { name: userName, color: userColor },
          }),
        ];
  return [
    opts.collab === false && !localYdoc
      ? StarterKit.configure({ strike: false })
      : StarterKit.configure({ history: false, strike: false }),
    // Strikethrough's chord depends on the shortcut scheme (Ctrl+Shift+S in
    // Office, Alt+Shift+5 in Google), so DocShortcuts binds it. Right after
    // StarterKit, where StarterKit's own Strike sat, so the mark order (and
    // with it HTML/DOCX output) is unchanged.
    SchemeStrike,
    Underline,
    TextStyle,
    Color,
    FontSize,
    LineHeight,
    ParagraphSpacing,
    ParagraphIndent,
    ParagraphShading,
    ParagraphProps,
    PageBreak,
    FontFamily,
    Highlight.configure({ multicolor: true }),
    LinkWithTitle.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Data-URL images (pasted, imported) must survive HTML parsing.
    SizedImage.configure({ allowBase64: true }),
    ImagePaste,
    // Pictures, shapes, text boxes and charts in the text (M7).
    ...OBJECT_NODES,
    Subscript,
    Superscript,
    GrownTable.configure({ resizable: true, View: GrownTableView }),
    GrownTableRow,
    TableHeaderBg,
    TableCellBg,
    TableTools,
    CommentMark,
    Footnote,
    Endnote,
    InsertionMark,
    DeletionMark,
    FormatChangeMark,
    TrackParagraphs,
    Drawing,
    MathNode,
    // References and fields (M8).
    BookmarkMark,
    BookmarkPoint,
    Field,
    TableOfContents,
    TocEntry,
    References,
    Suggesting.configure({ user: { name: userName, color: userColor } }),
    ClipboardHandling,
    Search,
    AutoCorrect,
    DocShortcuts,
    TabCharacter,
    // Styles + numbering (M3): bound to the doc's `styles` / `numbering`
    // Yjs maps (a private Y.Doc when there is none).
    DocModel.configure({ ydoc: opts.ydoc }),
    CharStyle,
    // Sections, columns and pagination (M9).
    SectionBreak,
    ColumnBreak,
    Pagination,
    // Spell check, language, view toggles, drop cap (M13).
    ...M13_EXTENSIONS,
    // Content controls, forms and protection (M10).
    SdtInline,
    SdtBlock,
    ContentControls,
    DocProtection,
    CustomXmlBinding,
    ...collabExts,
  ];
}
