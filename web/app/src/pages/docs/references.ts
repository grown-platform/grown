// References and fields in the editor (Docs M8): the `field` node, field
// updating (F9 / Update all), field codes (Alt+F9), unlinking
// (Ctrl+Shift+F9), Ctrl+click / Alt+Enter to follow links and REF \h
// fields, caption numbers that follow edits, and bookmark hygiene on
// paste. Pure field logic is fields.ts; bookmarks bookmarks.ts; tables of
// contents toc.ts; captions captions.ts; cross-references crossref.ts.
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, NodeSelection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { bookmarkRanges, computeFieldResults, explicitPages, outlineLevelOf, parseInstr, type FieldEnv, type PageResolver } from "./fields";
import { followLink, goToBookmark, linkAt } from "./bookmarks";
import { rebuildTocs, setTocUpdateHandler, tocNodes, TOC_DEFAULT, type TocLeader } from "./toc";
import { computeNumbering } from "./numbering";
import { getDocModel } from "./docModel";
import { syncSelectionFromDOM } from "./links";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    field: {
      /** Insert a field with an instruction; its result is computed. */
      insertField: (instr: string) => ReturnType;
    };
  }
}

// --- the field node ----------------------------------------------------------------------

export const Field = Node.create({
  name: "field",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      instr: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-field-instr") ?? "",
        renderHTML: (a) => ({ "data-field-instr": a.instr }),
      },
      result: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-field-result") ?? el.textContent ?? "",
        renderHTML: () => ({}),
      },
      locked: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).hasAttribute("data-field-locked"),
        renderHTML: (a) => (a.locked ? { "data-field-locked": "true" } : {}),
      },
    };
  },
  parseHTML() {
    return [
      { tag: "span[data-field-instr]", priority: 60 },
      { tag: "sup[data-field-instr]", priority: 60 },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const p = parseInstr(String(node.attrs.instr ?? ""));
    const noteRef = p.type === "NOTEREF" && p.sw.f;
    return [
      noteRef ? "sup" : "span",
      mergeAttributes(HTMLAttributes, {
        class: "doc-field",
        "data-field": p.type,
        "data-testid": "doc-field",
        contenteditable: "false",
        ...(p.sw.h && p.type !== "SEQ" ? { "data-field-link": "true", title: "Ctrl+click to follow" } : {}),
      }),
      String(node.attrs.result ?? ""),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.result ?? "");
  },
  addCommands() {
    return {
      insertField:
        (instr) =>
        ({ tr, dispatch, editor }) => {
          const node = this.type.create({ instr, result: "" });
          const at = tr.selection.from;
          tr.replaceSelectionWith(node, false);
          const results = computeFieldResults(fieldEnv(editor, tr.doc));
          let pos = at;
          if (tr.doc.nodeAt(pos)?.type.name !== "field") pos = tr.selection.from - 1;
          const n = tr.doc.nodeAt(pos);
          if (n?.type.name === "field") tr.setNodeMarkup(pos, undefined, { ...n.attrs, result: results.get(pos) ?? "" });
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
});

// --- environment ------------------------------------------------------------------------

type PageResolverFactory = (doc: PMNode) => PageResolver;
const pageResolvers = new WeakMap<Editor, PageResolverFactory>();
const nowOverride = new WeakMap<Editor, () => Date>();

/** setPageResolver installs a page resolver for an editor (the app
 *  measures the rendered page; tests and the default count breaks). */
export function setPageResolver(editor: Editor, f: PageResolverFactory | null) {
  if (f) pageResolvers.set(editor, f);
  else pageResolvers.delete(editor);
}

/** setFieldClock fixes DATE/TIME results for tests. */
export function setFieldClock(editor: Editor, now: (() => Date) | null) {
  if (now) nowOverride.set(editor, now);
  else nowOverride.delete(editor);
}

/** fieldEnv builds the environment for computing field results. */
export function fieldEnv(editor: Editor, doc: PMNode = editor.state.doc): FieldEnv {
  const model = getDocModel(editor);
  const f = pageResolvers.get(editor);
  let pages: PageResolver;
  try {
    pages = f ? f(doc) : explicitPages(doc);
  } catch {
    pages = explicitPages(doc);
  }
  return {
    doc,
    pages,
    now: nowOverride.get(editor)?.() ?? new Date(),
    sheet: model?.sheet ?? null,
    labels: model ? computeNumbering(doc, model.sheet, model.numbering) : new Map(),
  };
}

// --- updating ---------------------------------------------------------------------------

export type UpdateScope = "all" | "selection";

/** Which field nodes and TOCs a scope covers in `state`. */
function scopeTargets(state: EditorState, scope: UpdateScope): { fields: Set<number> | null; tocs: Set<number> | null } {
  if (scope === "all") return { fields: null, tocs: null };
  const { from, to, empty } = state.selection;
  const fields = new Set<number>();
  const tocs = new Set<number>();
  for (const t of tocNodes(state.doc)) if (t.pos < to && t.pos + t.node.nodeSize > from) tocs.add(t.pos);
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "field") fields.add(sel.from);
  else if (empty) {
    const $p = state.doc.resolve(from);
    if ($p.nodeAfter?.type.name === "field") fields.add(from);
    if ($p.nodeBefore?.type.name === "field") fields.add(from - $p.nodeBefore.nodeSize);
  } else
    state.doc.nodesBetween(from, to, (n, pos) => {
      if (n.type.name === "field") fields.add(pos);
      return n.type.name !== "tableOfContents";
    });
  return { fields, tocs };
}

/**
 * growHeadingBookmarks widens hidden (_Ref / _Toc) bookmarks that start a
 * heading's text to the end of the heading, so text typed at the end of
 * a referenced heading shows up in its references on the next update
 * (typing at a bookmark's end otherwise stays outside it).
 */
function growHeadingBookmarks(tr: Transaction, sheet: FieldEnv["sheet"]) {
  const type = tr.doc.type.schema.marks.bookmark;
  for (const [name, r] of bookmarkRanges(tr.doc)) {
    if (!name.startsWith("_") || r.from >= r.to) continue;
    const $from = tr.doc.resolve(r.from);
    if ($from.parentOffset !== 0 || !$from.parent.isTextblock || !outlineLevelOf($from.parent, sheet)) continue;
    const end = $from.end();
    if (r.to < end && r.to >= $from.start()) tr.addMark(r.to, end, type.create({ name }));
  }
}

/** updateFieldsTr applies fresh results (and rebuilt TOCs) in `tr`.
 *  Returns how many fields and tables changed. */
export function updateFieldsTr(
  editor: Editor,
  tr: Transaction,
  scope: { fields: Set<number> | null; tocs: Set<number> | null },
  kinds?: Set<string>,
): number {
  if (!kinds) growHeadingBookmarks(tr, fieldEnv(editor, tr.doc).sheet);
  const env = fieldEnv(editor, tr.doc);
  const results = computeFieldResults(env);
  let changed = 0;
  for (const [pos, result] of results) {
    if (scope.fields && !scope.fields.has(pos)) continue;
    const n = tr.doc.nodeAt(pos);
    if (!n || n.type.name !== "field") continue;
    if (kinds && !kinds.has(parseInstr(String(n.attrs.instr)).type)) continue;
    if (n.attrs.result !== result) {
      tr.setNodeMarkup(pos, undefined, { ...n.attrs, result });
      changed++;
    }
  }
  if (!kinds && (scope.tocs === null || scope.tocs.size)) {
    const before = tr.doc;
    const n = rebuildTocs(tr, { ...env, doc: tr.doc }, scope.tocs ?? undefined, results);
    if (n && !tr.doc.eq(before)) changed += n;
  }
  return changed;
}

/** updateFields updates the fields in the selection (F9) — with a caret,
 *  the field at the caret or the table of contents around it — or every
 *  field and table in the document. */
export function updateFields(editor: Editor, scope: UpdateScope = "selection"): boolean {
  if (scope === "selection") syncSelectionFromDOM(editor.view);
  const { state } = editor;
  const targets = scopeTargets(state, scope);
  if (targets.fields && !targets.fields.size && targets.tocs && !targets.tocs.size) return false;
  const tr = state.tr;
  const sel = state.selection;
  updateFieldsTr(editor, tr, targets);
  if (!tr.docChanged) return true;
  // Keep the caret where it was (TOC contents are replaced).
  try {
    tr.setSelection(sel.map(tr.doc, tr.mapping));
  } catch {
    /* keep the mapped default */
  }
  editor.view.dispatch(tr);
  // Page numbers depend on layout, which the update itself changes: take
  // a second look once the view has re-rendered.
  if (pageResolvers.has(editor)) {
    const again = () => {
      if (editor.isDestroyed) return;
      const t2 = editor.state.tr;
      updateFieldsTr(editor, t2, scopeTargets(editor.state, scope === "all" ? "all" : "selection"));
      if (t2.docChanged) editor.view.dispatch(t2.setMeta("addToHistory", false));
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(again);
  }
  return true;
}

/** updateTocAt rebuilds one table of contents. */
export function updateTocAt(editor: Editor, pos: number): boolean {
  const tr = editor.state.tr;
  updateFieldsTr(editor, tr, { fields: new Set(), tocs: new Set([pos]) });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}
/**
 * insertTableOfContents inserts a table of contents (or of figures, by
 * instruction) at the caret's paragraph: in place of an empty paragraph,
 * before a paragraph whose start holds the caret, else after it; then
 * builds its entries.
 */
export function insertTableOfContents(editor: Editor, instr = TOC_DEFAULT, leader: TocLeader = "dot"): boolean {
  syncSelectionFromDOM(editor.view);
  const { state } = editor;
  const schema = state.schema;
  const $f = state.selection.$from;
  let d = $f.depth;
  while (d > 0 && !$f.node(d).isTextblock) d--;
  // Only at the top level or inside simple containers (not tables/lists
  // where a block isn't allowed): walk up to the doc's child.
  while (d > 1) d--;
  const toc = schema.nodes.tableOfContents.create({ instr, leader }, schema.nodes.tocEntry.create({ level: 1 }));
  const tr = state.tr;
  let at: number;
  if (d === 0) {
    at = $f.pos;
    tr.insert(at, toc);
  } else {
    const block = $f.node(d);
    const before = $f.before(d);
    const after = $f.after(d);
    if (block.isTextblock && block.content.size === 0) {
      tr.replaceWith(before, after, toc);
      at = before;
    } else if ($f.depth === d && $f.parentOffset === 0) {
      tr.insert(before, toc);
      at = before;
    } else {
      tr.insert(after, toc);
      at = after;
    }
  }
  updateFieldsTr(editor, tr, { fields: new Set(), tocs: new Set([at]) });
  // A paragraph after the table to keep typing in.
  const end = at + tr.doc.nodeAt(at)!.nodeSize;
  if (end >= tr.doc.content.size) tr.insert(end, schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

setTocUpdateHandler((editor, pos) => {
  updateTocAt(editor, pos);
});

/** unlinkFields replaces the selected fields with their result text. */
export function unlinkFields(editor: Editor): boolean {
  syncSelectionFromDOM(editor.view);
  const { state } = editor;
  const { fields } = scopeTargets(state, "selection");
  if (!fields?.size) return false;
  const tr = state.tr;
  for (const pos of [...fields].sort((a, b) => b - a)) {
    const n = tr.doc.nodeAt(pos);
    if (!n || n.type.name !== "field") continue;
    const text = String(n.attrs.result ?? "");
    if (text) tr.replaceWith(pos, pos + 1, state.schema.text(text, n.marks));
    else tr.delete(pos, pos + 1);
  }
  editor.view.dispatch(tr);
  return true;
}

const codesOn = new WeakMap<Editor, boolean>();
/** toggleFieldCodes shows field instructions instead of results. */
export function toggleFieldCodes(editor: Editor, on?: boolean): boolean {
  const next = on ?? !codesOn.get(editor);
  codesOn.set(editor, next);
  editor.view.dom.classList.toggle("show-field-codes", next);
  return true;
}
export const fieldCodesShown = (editor: Editor) => !!codesOn.get(editor);

/** fieldAt returns the field node at the caret / selection, if any. */
export function fieldAt(state: EditorState): { pos: number; node: PMNode } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "field") return { pos: sel.from, node: sel.node };
  const $p = state.doc.resolve(sel.from);
  if ($p.nodeAfter?.type.name === "field") return { pos: sel.from, node: $p.nodeAfter };
  if ($p.nodeBefore?.type.name === "field") return { pos: sel.from - 1, node: $p.nodeBefore };
  return null;
}

/** followAt follows the link or REF \h field at `pos` (or the caret). */
export function followAt(editor: Editor, pos?: number): boolean {
  const { state } = editor;
  const p = pos ?? state.selection.from;
  const node = state.doc.nodeAt(p);
  const field = node?.type.name === "field" ? node : pos == null ? fieldAt(state)?.node : null;
  if (field) {
    const ins = parseInstr(String(field.attrs.instr ?? ""));
    if ((ins.type === "REF" || ins.type === "PAGEREF" || ins.type === "NOTEREF") && ins.args[0]) return goToBookmark(editor, ins.args[0]);
  }
  const href = linkAt(editor, pos);
  return href ? followLink(editor, href) : false;
}

// --- the extension ----------------------------------------------------------------------

const seqKey = new PluginKey("fieldSeq");
const followKey = new PluginKey("followLinks");
const pasteKey = new PluginKey("bookmarkPaste");

function hasSeqFields(doc: PMNode): boolean {
  let hit = false;
  doc.descendants((n) => {
    if (hit) return false;
    if (n.type.name === "field" && /^\s*SEQ\b/i.test(String(n.attrs.instr ?? ""))) hit = true;
    return !hit;
  });
  return hit;
}

/** Drop pasted bookmarks whose names already exist in the document. */
function stripDuplicateBookmarks(slice: Slice, taken: Set<string>): Slice {
  const walk = (frag: Fragment): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((n) => {
      if (n.type.name === "bookmarkPoint" && taken.has(String(n.attrs.name))) return;
      let m = n;
      if (n.isInline) m = n.mark(n.marks.filter((mk) => !(mk.type.name === "bookmark" && taken.has(String(mk.attrs.name)))));
      else if (n.content.size) m = n.copy(walk(n.content));
      out.push(m);
    });
    return Fragment.from(out);
  };
  return new Slice(walk(slice.content), slice.openStart, slice.openEnd);
}

export const References = Extension.create({
  name: "references",
  // Above the default keymaps so Alt+Enter wins over paragraph splitting
  // inside a link.
  priority: 120,
  addKeyboardShortcuts() {
    const e = () => this.editor;
    return {
      F9: () => {
        updateFields(e(), "selection");
        return true;
      },
      "Mod-F9": () => {
        updateFields(e(), "all");
        return true;
      },
      "Alt-F9": () => toggleFieldCodes(e()),
      "Mod-Shift-F9": () => {
        unlinkFields(e());
        return true;
      },
      "Alt-Shift-p": () => e().commands.insertField("PAGE"),
      "Alt-Shift-d": () => e().commands.insertField('DATE \\@ "M/d/yyyy"'),
      "Alt-Shift-t": () => e().commands.insertField('TIME \\@ "h:mm am/pm"'),
      "Alt-Enter": () => followAt(e()),
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      // Caption numbers follow edits: SEQ fields renumber after every
      // change, as they would on Word's next update.
      new Plugin({
        key: seqKey,
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta(seqKey))) return null;
          if (!hasSeqFields(state.doc)) return null;
          const tr = state.tr;
          updateFieldsTr(editor, tr, { fields: null, tocs: new Set() }, new Set(["SEQ", "STYLEREF"]));
          if (!tr.docChanged) return null;
          return tr.setMeta(seqKey, true).setMeta("addToHistory", trs.every((t) => t.getMeta("addToHistory") !== false));
        },
      }),
      new Plugin({
        key: followKey,
        props: {
          // On mousedown, so the browser never moves the caret to the click
          // point afterwards (that selection change would win the race).
          handleDOMEvents: {
            mousedown(view, event) {
              if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
              const target = event.target as HTMLElement | null;
              let done = false;
              const fieldEl = target?.closest?.(".doc-field");
              if (fieldEl && view.dom.contains(fieldEl)) {
                try {
                  const p = view.posAtDOM(fieldEl, 0);
                  const at = view.state.doc.nodeAt(p)?.type.name === "field" ? p : p - 1;
                  done = followAt(editor, at);
                } catch {
                  done = false;
                }
              }
              if (!done) {
                const link = target?.closest?.("a[href]");
                if (link && view.dom.contains(link)) done = followLink(editor, link.getAttribute("href") ?? "");
              }
              if (done) event.preventDefault();
              return done;
            },
          },
          handleClick(_view, pos, event) {
            if (!(event.ctrlKey || event.metaKey)) return false;
            return linkAt(editor, pos) ? followAt(editor, pos) : false;
          },
        },
      }),
      new Plugin({
        key: pasteKey,
        props: {
          transformPasted(slice, view) {
            const taken = new Set(bookmarkRanges(view.state.doc).keys());
            return taken.size ? stripDuplicateBookmarks(slice, taken) : slice;
          },
        },
      }),
    ];
  },
});
