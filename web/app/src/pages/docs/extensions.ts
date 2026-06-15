import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";

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

// ImagePaste lets users paste or drop image files into the document — TipTap's
// Image extension doesn't handle this. Files are embedded as data URLs (MVP;
// uploading to Drive is a follow-up).
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

export interface BuildOpts {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  userName: string;
  userColor: string;
  editable: boolean;
}

/** buildExtensions assembles the full editor extension set. Yjs owns history,
 *  so StarterKit's undo/redo is disabled (Collaboration provides it). */
export function buildExtensions({
  ydoc,
  provider,
  userName,
  userColor,
}: BuildOpts) {
  return [
    StarterKit.configure({ history: false }),
    Underline,
    TextStyle,
    Color,
    FontSize,
    LineHeight,
    FontFamily,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image,
    ImagePaste,
    Subscript,
    Superscript,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    CommentMark,
    Footnote,
    Collaboration.configure({ document: ydoc }),
    CollaborationCursor.configure({
      provider,
      user: { name: userName, color: userColor },
    }),
  ];
}
