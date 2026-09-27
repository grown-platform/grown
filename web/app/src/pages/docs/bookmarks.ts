// Bookmarks and document-internal links (Docs M8).
//
// A bookmark is a `bookmark` mark carrying its name over the text it
// covers (Word's w:bookmarkStart … w:bookmarkEnd); a bookmark on an empty
// selection is a zero-width `bookmarkPoint` inline atom. Names follow
// Word: a letter, then letters, digits and "_", at most 40 characters;
// names starting with "_" are hidden (Word's _Toc… / _Ref… bookmarks that
// tables of contents and cross-references create).
//
// Links to a place in the document are ordinary link marks whose href is
// "#<bookmark>" ("#_top" is the beginning of the document), exactly as a
// DOCX w:hyperlink w:anchor. The link mark gains a `title` (ScreenTip).
import { Mark, Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import Link from "@tiptap/extension-link";
import { bookmarkRanges, textWithFields } from "./fields";

export const BookmarkMark = Mark.create({
  name: "bookmark",
  // Bookmarks may overlap (a heading can carry _Toc1 and _Ref1).
  excludes: "",
  inclusive: false,
  spanning: true,
  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-bookmark"),
        renderHTML: (a) => (a.name ? { "data-bookmark": a.name } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-bookmark]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-bookmark" }), 0];
  },
});

export const BookmarkPoint = Node.create({
  name: "bookmarkPoint",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-bookmark-point"),
        renderHTML: (a) => ({ "data-bookmark-point": a.name ?? "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-bookmark-point]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-bookmark-point", contenteditable: "false" })];
  },
  renderText() {
    return "";
  },
});

/** Link with a ScreenTip (`title`), shown as the tooltip and written to
 *  DOCX as w:hyperlink/@w:tooltip. */
export const LinkWithTitle = Link.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      title: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("title"),
        renderHTML: (a) => (a.title ? { title: a.title } : {}),
      },
    };
  },
});

// --- names and lookup ------------------------------------------------------------------

/** isValidBookmarkName: Word's rule (hidden names start with "_"). */
export function isValidBookmarkName(name: string, allowHidden = false): boolean {
  return (allowHidden ? /^[A-Za-z_][A-Za-z0-9_]{0,39}$/ : /^[A-Za-z][A-Za-z0-9_]{0,39}$/u).test(name);
}

export const isHiddenBookmark = (name: string) => name.startsWith("_");

export interface BookmarkInfo {
  name: string;
  from: number;
  to: number;
  text: string;
  hidden: boolean;
}

/** listBookmarks lists bookmarks in document order. */
export function listBookmarks(doc: PMNode): BookmarkInfo[] {
  return [...bookmarkRanges(doc)]
    .map(([name, r]) => ({ name, from: r.from, to: r.to, text: textWithFields(doc, r.from, r.to), hidden: isHiddenBookmark(name) }))
    .sort((a, b) => a.from - b.from || a.name.localeCompare(b.name));
}

export function findBookmark(doc: PMNode, name: string): BookmarkInfo | null {
  return listBookmarks(doc).find((b) => b.name === name) ?? null;
}

/** removeBookmark removes every trace of a bookmark in `tr`. */
export function removeBookmark(tr: Transaction, name: string): boolean {
  const type = tr.doc.type.schema.marks.bookmark;
  let found = false;
  const points: number[] = [];
  tr.doc.descendants((n, pos) => {
    if (n.type.name === "bookmarkPoint" && n.attrs.name === name) {
      points.push(pos);
      found = true;
    }
    if (!n.isInline) return true;
    for (const m of n.marks)
      if (m.type === type && m.attrs.name === name) {
        tr.removeMark(pos, pos + n.nodeSize, m);
        found = true;
      }
    return false;
  });
  for (const p of points.reverse()) tr.delete(p, p + 1);
  return found;
}

/** setBookmark (re)defines a bookmark over [from, to) in `tr` — an empty
 *  range gets a point bookmark. An existing bookmark of that name moves. */
export function setBookmark(tr: Transaction, name: string, from: number, to: number): void {
  const schema = tr.doc.type.schema;
  const start = tr.steps.length;
  removeBookmark(tr, name);
  // Removed point bookmarks shift the range.
  const map = tr.mapping.slice(start);
  from = map.map(from);
  to = map.map(to, -1);
  if (from >= to) {
    tr.insert(from, schema.nodes.bookmarkPoint.create({ name }));
    return;
  }
  tr.addMark(from, to, schema.marks.bookmark.create({ name }));
}

/** nextHiddenName returns the first free `<prefix><n>` ("_Ref1", "_Toc3"). */
export function nextHiddenName(doc: PMNode, prefix: string, taken: Set<string> = new Set()): string {
  const used = new Set([...bookmarkRanges(doc).keys(), ...taken]);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** bookmarkCovering returns a bookmark with `prefix` whose span is exactly
 *  [from, to), if there is one. */
export function bookmarkCovering(doc: PMNode, from: number, to: number, prefix: string): string | null {
  for (const [name, r] of bookmarkRanges(doc)) if (name.startsWith(prefix) && r.from === from && r.to === to) return name;
  return null;
}

/** ensureBookmark returns a `prefix` bookmark covering [from, to), adding
 *  one in `tr` when there is none. With `grow`, a `prefix` bookmark that
 *  starts or ends inside the range is widened to it instead (a heading
 *  whose text was edited keeps its _Toc bookmark). */
export function ensureBookmark(tr: Transaction, from: number, to: number, prefix: string, grow = false): string {
  const hit = bookmarkCovering(tr.doc, from, to, prefix);
  if (hit) return hit;
  if (grow) {
    for (const [name, r] of bookmarkRanges(tr.doc)) {
      if (!name.startsWith(prefix)) continue;
      if (r.from >= from && r.to <= to && r.to > r.from) {
        tr.addMark(from, to, tr.doc.type.schema.marks.bookmark.create({ name }));
        return name;
      }
    }
  }
  const name = nextHiddenName(tr.doc, prefix);
  if (from < to) tr.addMark(from, to, tr.doc.type.schema.marks.bookmark.create({ name }));
  else tr.insert(from, tr.doc.type.schema.nodes.bookmarkPoint.create({ name }));
  return name;
}

/** Content range [start, end) of the textblock at `pos`. */
export function blockRange(doc: PMNode, pos: number): { from: number; to: number } {
  const node = doc.nodeAt(pos)!;
  return { from: pos + 1, to: pos + node.nodeSize - 1 };
}

/** refBookmarkForParagraph: the _Ref bookmark covering a paragraph's
 *  text (OnlyOffice's GetBookmarkRefToParagraph), or null. */
export function refBookmarkForParagraph(doc: PMNode, pos: number): string | null {
  const { from, to } = blockRange(doc, pos);
  return bookmarkCovering(doc, from, to, "_Ref");
}

// --- navigation -------------------------------------------------------------------------

/** goToBookmark selects a bookmark (or puts the caret at a point
 *  bookmark) and scrolls to it. "_top" is the start of the document. */
export function goToBookmark(editor: Editor, name: string): boolean {
  const { state } = editor;
  let from: number;
  let to: number;
  if (name === "_top") {
    from = to = TextSelection.atStart(state.doc).from;
  } else {
    const b = bookmarkRanges(state.doc).get(name);
    if (!b) return false;
    from = b.from;
    to = b.to;
  }
  const $from = state.doc.resolve(from);
  const sel = from === to || !$from.parent.inlineContent ? TextSelection.near($from) : TextSelection.create(state.doc, from, to);
  editor.view.dispatch(state.tr.setSelection(sel).scrollIntoView());
  editor.view.focus();
  scrollPosIntoView(editor, sel.from);
  return true;
}

/** Scroll the page (not only the editor) so `pos` is visible. */
function scrollPosIntoView(editor: Editor, pos: number) {
  try {
    const dom = editor.view.domAtPos(pos).node as HTMLElement;
    const el = dom.nodeType === 1 ? dom : dom.parentElement;
    el?.scrollIntoView?.({ block: "center" });
  } catch {
    /* jsdom / detached */
  }
}

/** followLink goes to a link's target: "#name" to a bookmark (or the top
 *  of the document), anything else opens in a new tab. */
export function followLink(editor: Editor, href: string, open: (url: string) => void = (u) => window.open(u, "_blank", "noopener")): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return goToBookmark(editor, decodeURIComponent(href.slice(1)));
  open(href);
  return true;
}

/** linkAt returns the href of the link mark at the caret or `pos`. */
export function linkAt(editor: Editor, pos?: number): string | null {
  const { state } = editor;
  const p = pos ?? state.selection.from;
  const $p = state.doc.resolve(p);
  const marks = [...(state.doc.nodeAt(p)?.marks ?? []), ...($p.nodeBefore?.marks ?? []), ...$p.marks()];
  const link = marks.find((m) => m.type.name === "link");
  return (link?.attrs.href as string | undefined) ?? null;
}
