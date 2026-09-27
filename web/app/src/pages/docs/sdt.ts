// Content controls in the editor (Docs M10): the `sdtInline` / `sdtBlock`
// nodes, commands to insert, change and remove them, and the editing
// rules Word and OnlyOffice apply to them:
//   - Backspace / Delete next to an inline control selects it; with the
//     control selected, a plain control showing its placeholder is emptied
//     first, anything else (and every form field) is removed;
//   - typing into a control that shows its placeholder replaces it, and a
//     control emptied by editing shows its placeholder again;
//   - check boxes toggle on click / Space (under track changes the new
//     symbol is an insertion and the old one a deletion); lists, dates and
//     pictures are chosen, not typed;
//   - a temporary control (w:temporary) unwraps once its content is set;
//   - locks: sdtLocked controls can't be removed, contentLocked content
//     can't be edited (a filterTransaction);
//   - a block control keeps its paragraphs: Backspace at the start of the
//     paragraph after it (Delete at the end of the one before) moves the
//     caret into it instead of joining, and removes that paragraph if it
//     is empty.
// Forms (OnlyOffice-style fillable fields, fill mode, navigation, formats)
// build on the same nodes; see forms.ts. The pure model is sdtModel.ts.
import { Extension, Node, mergeAttributes, type Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type ResolvedPos, type Schema, type Mark } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, AttrStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Step } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  SDT_BLOCK,
  SDT_INLINE,
  cannotDelete,
  cannotEdit,
  cssColor,
  defaultPr,
  encodePr,
  formatSdtDate,
  innerText,
  isChoiceOnly,
  isForm,
  isRadio,
  isSdt,
  newSdtId,
  prOf,
  RADIO_SYMBOLS,
  type SdtPr,
  type SdtType,
} from "./sdtModel";
import { checkOnType, formFilled, textFormFormat } from "./forms";
import { protectionState } from "./protection";
import { isSuggesting, markDeleted, suggestUser, suggestingKey } from "./suggesting";

export * from "./sdtModel";

// --- nodes -------------------------------------------------------------------------------

const sdtAttrs = () => ({
  sdtId: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-sdt-id"),
    renderHTML: (a: Record<string, unknown>) => (a.sdtId ? { "data-sdt-id": String(a.sdtId) } : {}),
  },
  pr: {
    default: '{"type":"richText"}',
    parseHTML: (el: HTMLElement) => el.getAttribute("data-sdt-pr") ?? '{"type":"richText"}',
    renderHTML: (a: Record<string, unknown>) => ({ "data-sdt-pr": String(a.pr) }),
  },
  plc: {
    default: false,
    parseHTML: (el: HTMLElement) => el.hasAttribute("data-plc"),
    renderHTML: (a: Record<string, unknown>) => (a.plc ? { "data-plc": "true" } : {}),
  },
});

/** Presentation attributes shared by both levels. */
function viewAttrs(pr: SdtPr): Record<string, string> {
  const out: Record<string, string> = { "data-sdt": pr.type };
  if (pr.alias) out["data-title"] = pr.alias;
  if (pr.appearance && pr.appearance !== "boundingBox") out["data-appearance"] = pr.appearance;
  if (pr.form) {
    out["data-form"] = pr.form.key || "";
    if (pr.form.required) out["data-required"] = "true";
    if (pr.form.role) out["data-role"] = pr.form.role;
    if (pr.form.fixed) out["data-fixed"] = "true";
  }
  if (pr.textForm?.comb) out["data-comb"] = "true";
  if (isRadio(pr)) out["data-radio"] = pr.checkbox!.groupKey!;
  if (pr.lock && pr.lock !== "unlocked") out["data-lock"] = pr.lock;
  const style: string[] = [];
  const color = cssColor(pr.color);
  if (color) style.push(`--sdt-color: ${color}`);
  const border = cssColor(pr.borderColor);
  if (border) style.push(`--sdt-border: ${border}`);
  const bg = cssColor(pr.backgroundColor);
  if (bg) style.push(`--sdt-bg: ${bg}`);
  if (pr.textForm?.comb && pr.textForm.maxChars && pr.textForm.maxChars > 0) style.push(`--sdt-comb: ${pr.textForm.maxChars}`);
  if (style.length) out.style = style.join("; ");
  return out;
}

export const SdtInline = Node.create({
  name: SDT_INLINE,
  group: "inline",
  inline: true,
  content: "inline*",
  selectable: true,
  draggable: false,
  addAttributes() {
    return sdtAttrs();
  },
  parseHTML() {
    return [
      {
        tag: "span[data-sdt-pr]",
        priority: 70,
        contentElement: (el: HTMLElement) => (el.querySelector(":scope > .doc-sdt-c") as HTMLElement | null) ?? el,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const pr = prOf(node);
    const attrs = mergeAttributes(HTMLAttributes, { class: "doc-sdt" }, viewAttrs(pr));
    if (pr.type === "picture") {
      const src = pr.picture?.src;
      const img = src
        ? ["img", { src, class: "doc-sdt-pic", contenteditable: "false", draggable: "false", ...(pr.picture?.width ? { width: String(pr.picture.width) } : {}) }]
        : ["span", { class: "doc-sdt-pic-empty", contenteditable: "false" }, "\u{1F5BC}"];
      return ["span", attrs, img, ["span", { class: "doc-sdt-c" }, 0]];
    }
    return ["span", attrs, 0];
  },
});

export const SdtBlock = Node.create({
  name: SDT_BLOCK,
  group: "block",
  content: "block+",
  defining: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return sdtAttrs();
  },
  parseHTML() {
    return [{ tag: "div[data-sdt-pr]", priority: 70 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "doc-sdt-block" }, viewAttrs(prOf(node))), 0];
  },
});

// --- finding controls --------------------------------------------------------------------

export interface SdtHit {
  node: PMNode;
  pos: number;
}

/** sdtAncestors: the controls around a position, innermost first. */
export function sdtAncestors($pos: ResolvedPos): SdtHit[] {
  const out: SdtHit[] = [];
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (isSdt(n)) out.push({ node: n, pos: $pos.before(d) });
  }
  return out;
}

/** sdtAt: the innermost control containing `pos` (or selected at it). */
export function sdtAt(state: EditorState, pos = state.selection.from): SdtHit | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && isSdt(sel.node) && pos === sel.from) return { node: sel.node, pos: sel.from };
  return sdtAncestors(state.doc.resolve(pos))[0] ?? null;
}

/** allSdts lists every control in document order. */
export function allSdts(doc: PMNode): SdtHit[] {
  const out: SdtHit[] = [];
  doc.descendants((node, pos) => {
    if (isSdt(node)) out.push({ node, pos });
    return node.isTextblock ? node.childCount > 0 && hasInlineSdt(node) : true;
  });
  return out;
}

function hasInlineSdt(block: PMNode): boolean {
  let found = false;
  block.forEach((c) => {
    if (c.type.name === SDT_INLINE) found = true;
  });
  return found;
}

export function sdtById(doc: PMNode, id: string): SdtHit | null {
  return allSdts(doc).find((h) => String(h.node.attrs.sdtId) === id) ?? null;
}

/** contentRange: the positions just inside a control. */
export function contentRange(hit: SdtHit): { from: number; to: number } {
  return { from: hit.pos + 1, to: hit.pos + hit.node.nodeSize - 1 };
}

// --- plugin state ------------------------------------------------------------------------

export interface SdtState {
  /** Fill-in-form view: only form fields can be edited. */
  fill: boolean;
  /** Fill as this role (null = every field). */
  role: string | null;
  /** The text form being filled and its last value that fit its format. */
  current: { id: string; valid: string } | null;
}

export const sdtKey = new PluginKey<SdtState>("sdt");

export const sdtState = (state: EditorState): SdtState =>
  sdtKey.getState(state) ?? { fill: false, role: null, current: null };

/** isFillMode: fill-in-form view, by choice or by "filling forms" protection. */
export function isFillMode(state: EditorState): boolean {
  return sdtState(state).fill || protectionState(state).mode === "forms";
}

/** A form field this user may fill now (role and lock permitting). */
export function canFill(state: EditorState, node: PMNode): boolean {
  const pr = prOf(node);
  if (!pr.form || pr.type === "complex" || cannotEdit(pr)) return false;
  const role = sdtState(state).role;
  return !role || !pr.form.role || pr.form.role === role;
}

type Meta = { fill?: boolean; role?: string | null; current?: SdtState["current"]; keepEmpty?: boolean; force?: boolean };

const isRemote = (tr: Transaction) => {
  const y = tr.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined;
  return !!y?.isChangeOrigin || !!tr.getMeta("preventUpdate");
};

// --- building content --------------------------------------------------------------------

const REVIEW = new Set(["insertion", "deletion", "formatChange"]);

function baseMarks(node: PMNode): readonly Mark[] {
  let marks: readonly Mark[] = [];
  node.descendants((n) => {
    if (n.isText) {
      marks = n.marks.filter((m) => !REVIEW.has(m.type.name));
      return false;
    }
    return !marks.length;
  });
  return marks;
}

/** The inline content showing `text` (empty text = no content). */
function textContent(schema: Schema, text: string, marks: readonly Mark[] = []): Fragment {
  if (!text) return Fragment.empty;
  const parts = text.split("\n");
  const out: PMNode[] = [];
  parts.forEach((p, i) => {
    if (i) out.push(schema.nodes.hardBreak.create());
    if (p) out.push(schema.text(p, marks));
  });
  return Fragment.from(out);
}

/** What a control shows for its current properties (not placeholder). */
export function displayText(pr: SdtPr): string | null {
  if (pr.type === "checkbox") {
    const c = pr.checkbox!;
    const radio = isRadio(pr);
    const on = radio && c.checkedSymbol === "☒" ? RADIO_SYMBOLS.checked : c.checkedSymbol;
    const off = radio && c.uncheckedSymbol === "☐" ? RADIO_SYMBOLS.unchecked : c.uncheckedSymbol;
    return c.checked ? on : off;
  }
  if (pr.type === "date" && pr.date?.full) return formatSdtDate(pr.date.full, pr.date.format);
  return null;
}

/** The content of a block control showing `text`. */
function blockContent(schema: Schema, text: string, marks: readonly Mark[] = []): Fragment {
  return Fragment.from(schema.nodes.paragraph.create(null, textContent(schema, text, marks)));
}

/** buildSdt creates a control node for `pr` (placeholder shown when it has
 *  no value), at inline or block level. */
export function buildSdt(schema: Schema, pr: SdtPr, level: "inline" | "block" = "inline", content?: Fragment): PMNode {
  const type = schema.nodes[level === "inline" ? SDT_INLINE : SDT_BLOCK];
  const shown = displayText(pr);
  const attrs = { sdtId: newSdtId(), pr: encodePr(pr), plc: false };
  if (content && content.size) return type.create(attrs, content);
  if (shown != null) return type.create(attrs, level === "inline" ? textContent(schema, shown) : blockContent(schema, shown));
  const plc = pr.placeholder ?? "";
  if (!plc) return type.create(attrs, level === "inline" ? Fragment.empty : blockContent(schema, ""));
  return type.create({ ...attrs, plc: true }, level === "inline" ? textContent(schema, plc) : blockContent(schema, plc));
}

// --- transactions on one control ---------------------------------------------------------

/** setContent replaces a control's content (the placeholder flag follows). */
export function setSdtContentTr(tr: Transaction, pos: number, text: string, plc = false, pr?: SdtPr): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return tr;
  const schema = tr.doc.type.schema;
  const marks = baseMarks(node);
  const inline = node.type.name === SDT_INLINE;
  const frag = inline ? textContent(schema, text, marks) : blockContent(schema, text, marks);
  tr.replaceWith(pos + 1, pos + node.nodeSize - 1, frag);
  // Attribute steps (not a markup replace), so the fill-in view, which
  // only lets edits inside fields through, accepts them.
  if (!!node.attrs.plc !== plc) tr.setNodeAttribute(pos, "plc", plc);
  if (pr) tr.setNodeAttribute(pos, "pr", encodePr(pr));
  return tr;
}

/** updatePrTr merges properties into the control at `pos`. */
export function updatePrTr(tr: Transaction, pos: number, patch: Partial<SdtPr>): SdtPr | null {
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return null;
  const pr = { ...prOf(node), ...patch } as SdtPr;
  tr.setNodeAttribute(pos, "pr", encodePr(pr));
  return pr;
}

/** showPlaceholderTr puts a control back to its placeholder. */
export function showPlaceholderTr(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return tr;
  const pr = prOf(node);
  const shown = displayText(pr);
  if (shown != null) return setSdtContentTr(tr, pos, shown, false);
  return setSdtContentTr(tr, pos, pr.placeholder ?? "", !!pr.placeholder);
}

/** unwrapTr replaces a control with its content (keepContent) or removes
 *  it with its content. */
export function unwrapTr(tr: Transaction, pos: number, keepContent: boolean): Transaction {
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return tr;
  if (!keepContent || node.attrs.plc) {
    if (node.type.name === SDT_BLOCK && tr.doc.childCount === 1 && tr.doc.firstChild === node)
      tr.replaceWith(pos, pos + node.nodeSize, tr.doc.type.schema.nodes.paragraph.create());
    else tr.delete(pos, pos + node.nodeSize);
  } else tr.replaceWith(pos, pos + node.nodeSize, node.content);
  return tr;
}

// --- commands (functions on an editor) ---------------------------------------------------

function dispatch(editor: Editor, tr: Transaction, meta?: Meta): boolean {
  if (!tr.docChanged && !tr.selectionSet && !meta) return false;
  if (meta) tr.setMeta(sdtKey, meta);
  editor.view.dispatch(tr);
  return true;
}

export interface InsertOpts {
  level?: "inline" | "block";
  pr?: Partial<SdtPr>;
}

/**
 * insertContentControl adds a control at the selection. A non-empty
 * selection in one paragraph (inline) or whole paragraphs (block) becomes
 * the control's content; otherwise it shows its placeholder. The caret ends
 * inside the new control.
 */
export function insertContentControl(editor: Editor, type: SdtType, opts: InsertOpts = {}): SdtHit | null {
  const { state } = editor;
  const schema = state.schema;
  const pr = defaultPr(type, opts.pr);
  const level = opts.level ?? (type === "richText" && !state.selection.empty && !state.selection.$from.sameParent(state.selection.$to) ? "block" : "inline");
  const tr = state.tr;
  const sel = state.selection;
  let pos: number;
  if (level === "block") {
    const $from = sel.$from;
    const $to = sel.$to;
    const range = $from.blockRange($to);
    if (!sel.empty && range) {
      const content = state.doc.slice(range.start, range.end).content;
      const node = buildSdt(schema, pr, "block", content);
      tr.replaceWith(range.start, range.end, node);
      pos = range.start;
    } else {
      const node = buildSdt(schema, pr, "block");
      // After the current top-level block (or replacing it when empty).
      const depth = Math.max(1, $from.depth);
      const blockPos = $from.before(1);
      const block = $from.node(1);
      if (block.isTextblock && block.content.size === 0 && depth >= 1) {
        tr.replaceWith(blockPos, blockPos + block.nodeSize, node);
        pos = blockPos;
      } else {
        pos = $from.after(1);
        tr.insert(pos, node);
      }
    }
  } else {
    let content: Fragment | undefined;
    if (!sel.empty && sel.$from.sameParent(sel.$to) && sel.$from.parent.isTextblock && !isChoiceOnly(pr) && type !== "date")
      content = state.doc.slice(sel.from, sel.to).content;
    const node = buildSdt(schema, pr, "inline", content);
    pos = sel.from;
    tr.replaceWith(sel.from, content ? sel.to : sel.from, node);
  }
  const node = tr.doc.nodeAt(pos)!;
  const inner = pos + 1 + (node.type.name === SDT_BLOCK ? 1 : 0);
  tr.setSelection(TextSelection.create(tr.doc, Math.min(inner, tr.doc.content.size)));
  editor.view.dispatch(tr.scrollIntoView());
  const hit = editor.state.doc.nodeAt(pos);
  return isSdt(hit) ? { node: hit, pos } : null;
}

/** updateContentControl merges properties (the display follows: symbols,
 *  dates, placeholder text of an empty control). */
export function updateContentControl(editor: Editor, pos: number, patch: Partial<SdtPr>): boolean {
  const tr = editor.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const pr = updatePrTr(tr, pos, patch)!;
  const shown = displayText(pr);
  if (shown != null && shown !== innerText(node)) setSdtContentTr(tr, pos, shown, false);
  else if (node.attrs.plc && pr.placeholder && pr.placeholder !== innerText(node)) setSdtContentTr(tr, pos, pr.placeholder, true);
  else if (node.attrs.plc && !pr.placeholder) setSdtContentTr(tr, pos, "", false);
  return dispatch(editor, tr, { force: true });
}

/** removeContentControl deletes a control, keeping its content or not. */
export function removeContentControl(editor: Editor, pos: number, keepContent = true): boolean {
  const tr = unwrapTr(editor.state.tr, pos, keepContent);
  return dispatch(editor, tr, { force: true });
}

/** clearContentControl shows the placeholder again. */
export function clearContentControl(editor: Editor, pos: number): boolean {
  const tr = editor.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const pr = prOf(node);
  if (pr.type === "checkbox") return setCheckbox(editor, pos, false);
  if (pr.type === "picture") {
    updatePrTr(tr, pos, { picture: { ...pr.picture, src: null } });
    return dispatch(editor, tr);
  }
  if (pr.type === "date") updatePrTr(tr, pos, { date: { ...pr.date!, full: null } });
  if (pr.type === "complex") {
    // A complex form clears its sub-fields, keeping its own text.
    const subs: number[] = [];
    node.descendants((n, p) => {
      if (isSdt(n)) subs.push(pos + 1 + p);
      return !isSdt(n);
    });
    for (const p of subs.reverse()) showPlaceholderTr(tr, p);
    return dispatch(editor, tr);
  }
  showPlaceholderTr(tr, pos);
  return dispatch(editor, tr);
}

/** setSdtText sets a control's text (OnlyOffice SetText / SetInnerText). */
export function setSdtText(editor: Editor, pos: number, text: string): boolean {
  const tr = editor.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  if (!text) showPlaceholderTr(tr, pos);
  else setSdtContentTr(tr, pos, text, false);
  return dispatch(editor, tr, { keepEmpty: !text });
}

/** Radio buttons of a group in the document. */
function radioGroup(doc: PMNode, groupKey: string): SdtHit[] {
  return allSdts(doc).filter((h) => {
    const pr = prOf(h.node);
    return pr.type === "checkbox" && pr.checkbox?.groupKey === groupKey;
  });
}

/**
 * checkboxTr sets a check box. Under track changes the new symbol is an
 * insertion placed before the old one, which is marked deleted; toggling
 * back un-deletes the old symbol and drops your own insertion.
 */
function checkboxTr(editor: Editor, tr: Transaction, pos: number, checked: boolean): void {
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return;
  const pr = prOf(node);
  const next: SdtPr = { ...pr, checkbox: { ...pr.checkbox!, checked } };
  const symbol = displayText(next)!;
  tr.setNodeAttribute(pos, "pr", encodePr(next));
  const tracking = isSuggesting(editor);
  if (!tracking) {
    setSdtContentTr(tr, pos, symbol, false);
    return;
  }
  const schema = tr.doc.type.schema;
  const user = suggestUser(editor);
  const cur = tr.doc.nodeAt(pos)!;
  const out: PMNode[] = [];
  let restored = false;
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const id = `cb${Date.now().toString(36)}`;
  const del = schema.marks.deletion.create({ author: user.name, color: "#d93025", id, date });
  const ins = schema.marks.insertion.create({ author: user.name, color: user.color, id, date });
  cur.forEach((c) => {
    if (!c.isText) return;
    const d = c.marks.find((m) => m.type.name === "deletion");
    const i = c.marks.find((m) => m.type.name === "insertion");
    if (d) {
      if (!restored && c.text === symbol) {
        out.push(c.mark(d.removeFromSet(c.marks)));
        restored = true;
      } else out.push(c);
    } else if (i && i.attrs.author === user.name) {
      /* own pending insertion: dropped */
    } else out.push(c.mark(del.addToSet(c.marks)));
  });
  if (!restored) out.unshift(schema.text(symbol, ins.addToSet(baseMarks(cur))));
  tr.replaceWith(pos + 1, pos + cur.nodeSize - 1, Fragment.from(out));
  tr.setMeta(suggestingKey, true);
}

/** setCheckbox checks or unchecks a check box (a radio button unchecks the
 *  rest of its group; checking a checked radio button keeps it). */
export function setCheckbox(editor: Editor, pos: number, checked: boolean): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!isSdt(node) || prOf(node).type !== "checkbox") return false;
  const pr = prOf(node);
  const tr = editor.state.tr;
  if (isRadio(pr)) {
    if (!checked) return false;
    for (const h of radioGroup(tr.doc, pr.checkbox!.groupKey!)) {
      const p = tr.mapping.map(h.pos);
      const on = p === tr.mapping.map(pos);
      if (!!prOf(tr.doc.nodeAt(p)!).checkbox?.checked !== on) checkboxTr(editor, tr, p, on);
    }
  } else checkboxTr(editor, tr, pos, checked);
  return dispatch(editor, tr);
}

export function toggleCheckbox(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  return setCheckbox(editor, pos, !prOf(node).checkbox?.checked);
}

/** selectListItem shows an item of a combo box / drop-down list (by value
 *  or label). A combo box also takes free text. */
export function selectListItem(editor: Editor, pos: number, valueOrLabel: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const pr = prOf(node);
  const item = pr.items?.find((i) => i.value === valueOrLabel) ?? pr.items?.find((i) => i.label === valueOrLabel);
  const text = item ? item.label || item.value : pr.type === "comboBox" ? valueOrLabel : null;
  if (text == null) return false;
  return dispatch(editor, setSdtContentTr(editor.state.tr, pos, text, false), { keepEmpty: !text });
}

/** setSdtDate sets a date picker (ISO yyyy-mm-dd, or null to clear). */
export function setSdtDate(editor: Editor, pos: number, iso: string | null, format?: string): boolean {
  const tr = editor.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const pr = prOf(node);
  const date = { format: DEFAULT_FORMAT(pr), ...pr.date, ...(format ? { format } : {}), full: iso };
  const next = updatePrTr(tr, pos, { date })!;
  if (iso) setSdtContentTr(tr, pos, formatSdtDate(iso, date.format), false, next);
  else showPlaceholderTr(tr, pos);
  return dispatch(editor, tr);
}

const DEFAULT_FORMAT = (pr: SdtPr) => pr.date?.format ?? "M/d/yyyy";

/** setSdtPicture sets a picture control's image (a data or http URL). */
export function setSdtPicture(editor: Editor, pos: number, src: string | null, size?: { width?: number; height?: number }): boolean {
  const tr = editor.state.tr;
  const node = tr.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const pr = prOf(node);
  updatePrTr(tr, pos, { picture: { ...pr.picture, src, ...(size ?? {}) } });
  return dispatch(editor, tr);
}

/** selectContentControl selects a control's content (OnlyOffice
 *  SelectContentControl). */
export function selectContentControl(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const tr = editor.state.tr;
  const { from, to } = contentRange({ node, pos });
  if (node.type.name === SDT_BLOCK) {
    const a = TextSelection.atStart(node);
    const b = TextSelection.atEnd(node);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + a.from, pos + 1 + b.to));
  } else tr.setSelection(TextSelection.create(tr.doc, from, to));
  editor.view.dispatch(tr);
  return true;
}

/** moveIntoControl puts the caret at the start (or end) of a control. */
export function moveIntoControl(editor: Editor, pos: number, atEnd = false): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!isSdt(node)) return false;
  const tr = editor.state.tr;
  if (node.type.name === SDT_BLOCK) {
    const s = atEnd ? TextSelection.atEnd(node) : TextSelection.atStart(node);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + s.from));
  } else {
    const { from, to } = contentRange({ node, pos });
    tr.setSelection(TextSelection.create(tr.doc, atEnd && !node.attrs.plc ? to : from));
  }
  editor.view.dispatch(tr);
  return true;
}

/** mainForm: the outermost form around `pos` (a complex form for its
 *  sub-fields; OnlyOffice GetMainForm). */
export function mainForm(doc: PMNode, pos: number): SdtHit | null {
  const node = doc.nodeAt(pos);
  const hits = sdtAncestors(doc.resolve(pos));
  if (isSdt(node)) hits.unshift({ node, pos });
  const forms = hits.filter((h) => !!prOf(h.node).form);
  return forms[forms.length - 1] ?? null;
}

/** setFormFixed converts a form between fixed size and inline
 *  (OnlyOffice ConvertFormFixedType). */
export function setFormFixed(editor: Editor, pos: number, fixed: boolean): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!isSdt(node) || !prOf(node).form) return false;
  return updateContentControl(editor, pos, { form: { ...prOf(node).form!, fixed } });
}

/** setFillMode switches the fill-in-form view (and the role filled as). */
export function setFillMode(editor: Editor, on: boolean, role: string | null = null): void {
  const tr = editor.state.tr.setMeta(sdtKey, { fill: on, role } satisfies Meta);
  editor.view.dispatch(tr);
  if (on) goToField(editor, 1, true);
}

// --- form navigation ---------------------------------------------------------------------

/** Fields in tab order: every fillable form field (sub-fields of complex
 *  forms included, complex forms themselves not). */
export function fillableFields(state: EditorState): SdtHit[] {
  return allSdts(state.doc).filter((h) => {
    const pr = prOf(h.node);
    return !!pr.form && pr.type !== "complex" && canFill(state, h.node);
  });
}

/** goToField moves to the next (1) / previous (-1) field, wrapping.
 *  `fromStart` goes to the first field. */
export function goToField(editor: Editor, dir: 1 | -1, fromStart = false): boolean {
  const { state } = editor;
  const fields = fillableFields(state);
  if (!fields.length) return false;
  const here = state.selection.from;
  let target: SdtHit | undefined;
  if (fromStart) target = fields[0];
  else if (dir > 0) target = fields.find((f) => f.pos > here) ?? fields[0];
  else {
    const cur = sdtAt(state);
    target = [...fields].reverse().find((f) => f.pos < (cur ? cur.pos : here)) ?? fields[fields.length - 1];
  }
  return moveIntoControl(editor, target.pos);
}

// --- key handling ------------------------------------------------------------------------

function selectNode(view: EditorView, pos: number): boolean {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  return true;
}

/** deleteSelectedControl: Backspace / Delete with a control selected. */
function deleteSelectedControl(view: EditorView, hit: SdtHit): boolean {
  const pr = prOf(hit.node);
  const { state } = view;
  if (cannotDelete(pr) || isFillMode(state)) {
    if (isFillMode(state) && canFill(state, hit.node) && !hit.node.attrs.plc && !isChoiceOnly(pr)) {
      const tr = showPlaceholderTr(state.tr, hit.pos);
      tr.setSelection(TextSelection.create(tr.doc, hit.pos + 1));
      view.dispatch(tr);
    }
    return true;
  }
  if (hit.node.attrs.plc && !isForm(pr) && !isChoiceOnly(pr)) {
    const tr = setSdtContentTr(state.tr, hit.pos, "", false);
    tr.setSelection(NodeSelection.create(tr.doc, hit.pos));
    tr.setMeta(sdtKey, { keepEmpty: true } satisfies Meta);
    view.dispatch(tr);
    return true;
  }
  view.dispatch(unwrapTr(state.tr, hit.pos, false).scrollIntoView());
  return true;
}

const WORD_CH = /[\p{L}\p{N}_]/u;

/** deleteInside removes a character (or word) inside an inline control. */
function deleteInside(view: EditorView, hit: SdtHit, dir: -1 | 1, word: boolean): boolean {
  const { state } = view;
  const sel = state.selection;
  const { from: cFrom, to: cTo } = contentRange(hit);
  if (!sel.empty) {
    if (sel.from < cFrom || sel.to > cTo) return false;
    view.dispatch(state.tr.delete(sel.from, sel.to).scrollIntoView());
    return true;
  }
  const pos = sel.from;
  const text = state.doc.textBetween(cFrom, cTo, "\n", "￼");
  const off = pos - cFrom;
  let a = off;
  let b = off;
  if (dir < 0) {
    if (off === 0) return false;
    a = off - 1;
    if (/[\udc00-\udfff]/.test(text[a] ?? "") && a > 0) a--;
    if (word) {
      while (a > 0 && /\s/.test(text[a - 1]) && !WORD_CH.test(text[a])) a--;
      while (a > 0 && WORD_CH.test(text[a - 1])) a--;
    }
  } else {
    if (off >= text.length) return false;
    b = off + 1;
    if (/[\ud800-\udbff]/.test(text[off] ?? "")) b++;
    if (word) {
      while (b < text.length && WORD_CH.test(text[b])) b++;
      while (b < text.length && /\s/.test(text[b])) b++;
    }
  }
  view.dispatch(state.tr.delete(cFrom + a, cFrom + b).scrollIntoView());
  return true;
}

/** Block controls keep their paragraphs (see the file comment). */
function blockBoundary(view: EditorView, dir: -1 | 1, tracking: boolean): boolean {
  const { state } = view;
  const $p = state.selection.$from;
  if (!state.selection.empty || !$p.parent.isTextblock) return false;
  const atEdge = dir < 0 ? $p.parentOffset === 0 : $p.parentOffset === $p.parent.content.size;
  if (!atEdge) return false;
  const d = $p.depth;
  const idx = $p.index(d - 1);
  const container = $p.node(d - 1);
  const sibling = dir < 0 ? (idx > 0 ? container.child(idx - 1) : null) : idx + 1 < container.childCount ? container.child(idx + 1) : null;
  const blockPos = $p.before(d);
  // Leaving a block control from inside: move out, never join.
  if (!sibling && isSdt(container) && container.type.name === SDT_BLOCK) {
    const outer = dir < 0 ? $p.before(d - 1) : $p.after(d - 1);
    const target = dir < 0 ? Selectionish.before(state.doc, outer) : Selectionish.after(state.doc, outer);
    if (target != null) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
    return true;
  }
  if (!sibling || sibling.type.name !== SDT_BLOCK) return false;
  const sibPos = dir < 0 ? blockPos - sibling.nodeSize : $p.after(d);
  if (tracking) {
    const user = suggestUser(editorOf(view));
    const pc = $p.parent.attrs.paraChange ? JSON.parse(String($p.parent.attrs.paraChange)) : null;
    const own = pc?.type === "insert" && pc.author === user.name;
    if (!own || $p.parent.content.size > 0) {
      // The paragraph mark between the two is marked deleted; the caret
      // moves into the control.
      const a = dir < 0 ? sibPos + 1 + TextSelection.atEnd(sibling).from : $p.end();
      const b = dir < 0 ? $p.start() : sibPos + 1 + TextSelection.atStart(sibling).from;
      const tr = state.tr;
      const m = markDeleted(tr, a, b, user);
      tr.setSelection(TextSelection.create(tr.doc, dir < 0 ? m.start : m.end));
      tr.setMeta(suggestingKey, true);
      view.dispatch(tr.scrollIntoView());
      return true;
    }
  }
  const tr = state.tr;
  let caret: number;
  if ($p.parent.content.size === 0) {
    tr.delete(blockPos, blockPos + $p.parent.nodeSize);
    const sp = tr.mapping.map(sibPos);
    const sib = tr.doc.nodeAt(sp)!;
    caret = sp + 1 + (dir < 0 ? TextSelection.atEnd(sib).from : TextSelection.atStart(sib).from);
  } else caret = sibPos + 1 + (dir < 0 ? TextSelection.atEnd(sibling).from : TextSelection.atStart(sibling).from);
  tr.setSelection(TextSelection.create(tr.doc, caret));
  view.dispatch(tr.scrollIntoView());
  return true;
}

const Selectionish = {
  before(doc: PMNode, pos: number): number | null {
    const s = TextSelection.findFrom(doc.resolve(pos), -1, true);
    return s ? s.from : null;
  },
  after(doc: PMNode, pos: number): number | null {
    const s = TextSelection.findFrom(doc.resolve(pos), 1, true);
    return s ? s.from : null;
  },
};

const editors = new WeakMap<EditorView, Editor>();
const editorOf = (view: EditorView) => editors.get(view)!;

function handleDelete(view: EditorView, dir: -1 | 1, word: boolean): boolean {
  const { state } = view;
  const sel = state.selection;
  const editor = editorOf(view);
  const tracking = isSuggesting(editor);
  if (sel instanceof NodeSelection && sel.node.type.name === SDT_INLINE) return deleteSelectedControl(view, { node: sel.node, pos: sel.from });
  if (sel instanceof NodeSelection && sel.node.type.name === SDT_BLOCK) {
    if (cannotDelete(prOf(sel.node)) || isFillMode(state)) return true;
    return false;
  }
  const fill = isFillMode(state);
  const inner = sdtAncestors(sel.$from)[0];
  if (inner && inner.node.type.name === SDT_INLINE && (sel.empty || sdtAncestors(sel.$to)[0]?.pos === inner.pos)) {
    const pr = prOf(inner.node);
    if (cannotEdit(pr) || (fill && !canFill(state, inner.node))) return true;
    if (inner.node.attrs.plc || isChoiceOnly(pr)) return fill ? true : selectNode(view, inner.pos);
    if (tracking && !fill) return false;
    if (deleteInside(view, inner, dir, word)) return true;
    // At the control's edge.
    return fill ? true : selectNode(view, inner.pos);
  }
  if (fill) {
    // Outside fields nothing is deleted.
    return true;
  }
  if (sel.empty) {
    const $p = sel.$from;
    const adj = dir < 0 ? $p.nodeBefore : $p.nodeAfter;
    if (adj && adj.type.name === SDT_INLINE) return selectNode(view, dir < 0 ? $p.pos - adj.nodeSize : $p.pos);
    if (blockBoundary(view, dir, tracking)) return true;
  }
  // A selection that would remove a locked control.
  if (!sel.empty) {
    let blocked = false;
    state.doc.nodesBetween(sel.from, sel.to, (n, p) => {
      if (isSdt(n) && p >= sel.from && p + n.nodeSize <= sel.to && cannotDelete(prOf(n))) blocked = true;
      return !blocked;
    });
    if (blocked) return true;
  }
  return false;
}

/** Typing into a control: placeholder replacement, formats, choice-only
 *  types, content locks. Returns true when handled. */
function handleText(view: EditorView, from: number, to: number, text: string): boolean {
  const { state } = view;
  const sel = state.selection;
  const fill = isFillMode(state);
  let hit: SdtHit | null = null;
  if (sel instanceof NodeSelection && isSdt(sel.node) && from === sel.from) hit = { node: sel.node, pos: sel.from };
  else {
    const a = sdtAncestors(state.doc.resolve(from))[0];
    const b = sdtAncestors(state.doc.resolve(to))[0];
    if (a && b && a.pos === b.pos) hit = a;
  }
  if (!hit) return fill; // outside any control: blocked in fill mode
  if (hit.node.type.name === SDT_BLOCK) {
    const pr = prOf(hit.node);
    if (cannotEdit(pr) || fill) return true;
    if (hit.node.attrs.plc) {
      const tr = setSdtContentTr(state.tr, hit.pos, text, false);
      tr.setSelection(TextSelection.create(tr.doc, hit.pos + 2 + text.length));
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    return false;
  }
  const pr = prOf(hit.node);
  if (cannotEdit(pr) || (fill && !canFill(state, hit.node))) return true;
  if (pr.type === "checkbox") {
    if (text === " ") toggleCheckbox(editorOf(view), hit.pos);
    return true;
  }
  if (isChoiceOnly(pr)) return true;
  const plc = !!hit.node.attrs.plc;
  const whole = plc || (sel instanceof NodeSelection && sel.from === hit.pos);
  const { from: cFrom, to: cTo } = contentRange(hit);
  const current = whole ? "" : state.doc.textBetween(cFrom, cTo, "\n", "￼");
  const a = whole ? 0 : from - cFrom;
  const b = whole ? 0 : to - cFrom;
  const insert = text;
  // Text forms: allowed characters and length (mask literals are filled in).
  if (pr.form && pr.type === "text") {
    const r = checkOnType(pr, current, a, b, text);
    if (!r.ok) {
      // A full field passes what doesn't fit on to the next sub-field of
      // its complex form (OnlyOffice).
      if (r.full) overflow(view, hit, text);
      return true;
    }
    const tr = setSdtContentTr(state.tr, hit.pos, r.text, false);
    tr.setSelection(TextSelection.create(tr.doc, hit.pos + 1 + r.caret));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  if (!whole) return false;
  const tr = setSdtContentTr(state.tr, hit.pos, insert, false);
  tr.setSelection(TextSelection.create(tr.doc, hit.pos + 1 + insert.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** When a text field of a complex form is full, typing continues in the
 *  next text field of the same complex form. */
function overflow(view: EditorView, hit: SdtHit, text: string): boolean {
  const { state } = view;
  const complex = sdtAncestors(state.doc.resolve(hit.pos)).find((h) => prOf(h.node).type === "complex");
  if (!complex) return false;
  const subs = allSdts(complex.node)
    .map((h) => ({ node: h.node, pos: complex.pos + 1 + h.pos }))
    .filter((h) => prOf(h.node).type === "text" && h.pos > hit.pos);
  const next = subs[0];
  if (!next) return false;
  const editor = editorOf(view);
  moveIntoControl(editor, next.pos, true);
  const s = editor.state.selection;
  return handleText(editor.view, s.from, s.to, text);
}

/** Arrow keys in fill mode: move within a field, jump between fields at
 *  its edges. */
function fillArrow(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view;
  const editor = editorOf(view);
  const hit = sdtAt(state);
  if (!hit || !canFill(state, hit.node)) return goToField(editor, dir);
  const { from, to } = contentRange(hit);
  const pos = dir < 0 ? state.selection.from : state.selection.to;
  const atEdge = hit.node.attrs.plc || isChoiceOnly(prOf(hit.node)) || (dir < 0 ? pos <= from : pos >= to);
  if (!atEdge) {
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos + dir)));
    return true;
  }
  const fields = fillableFields(state);
  const i = fields.findIndex((f) => f.pos === hit.pos);
  const next = fields[i + dir];
  if (!next) return true;
  return moveIntoControl(editor, next.pos, dir < 0);
}

// --- the extension -----------------------------------------------------------------------

const SDT_CSS = `
.ProseMirror .doc-sdt { position: relative; border-radius: 2px; background: var(--sdt-bg, transparent); }
.ProseMirror .doc-sdt:not([data-appearance="hidden"]) { box-shadow: 0 0 0 1px var(--sdt-border, transparent); }
.ProseMirror .doc-sdt.doc-sdt-active:not([data-appearance="hidden"]),
.ProseMirror .doc-sdt-block.doc-sdt-active:not([data-appearance="hidden"]) { box-shadow: 0 0 0 1px var(--sdt-color, #7f9cc7); }
.ProseMirror .doc-sdt[data-plc], .ProseMirror .doc-sdt-block[data-plc] { color: #80868b; }
.ProseMirror .doc-sdt[data-form] { background: var(--sdt-bg, rgba(26, 115, 232, 0.08)); box-shadow: 0 0 0 1px var(--sdt-border, rgba(26, 115, 232, 0.35)); }
.ProseMirror .doc-sdt[data-sdt="checkbox"] { cursor: pointer; }
.ProseMirror .doc-sdt[data-sdt="dropDownList"]::after, .ProseMirror .doc-sdt[data-sdt="comboBox"]::after { content: " \\25BE"; color: #5f6368; font-size: 0.8em; }
.ProseMirror .doc-sdt[data-sdt="date"]::after { content: " \\1F4C5"; font-size: 0.75em; }
.ProseMirror .doc-sdt[data-sdt="picture"] { display: inline-block; min-width: 1.5em; min-height: 1.2em; cursor: pointer; }
.ProseMirror .doc-sdt-pic { max-width: 100%; vertical-align: bottom; }
.ProseMirror .doc-sdt-pic-empty { display: inline-block; padding: 8px 14px; color: #80868b; border: 1px dashed #bdc1c6; }
.ProseMirror .doc-sdt[data-comb] { letter-spacing: 0.6em; font-family: monospace; }
.ProseMirror .doc-sdt-block { position: relative; margin: 2px -4px; padding: 0 3px; border-radius: 2px; box-shadow: 0 0 0 1px var(--sdt-border, transparent); background: var(--sdt-bg, transparent); }
.ProseMirror .doc-sdt-active[data-title]::before { content: attr(data-title); position: absolute; left: -1px; top: -1.45em; font-size: 11px; line-height: 1.3; padding: 0 5px; white-space: nowrap; color: #fff; background: var(--sdt-color, #7f9cc7); border-radius: 2px 2px 0 0; pointer-events: none; z-index: 2; }
.ProseMirror.doc-forms-fill .doc-sdt[data-form][data-required]:not(.doc-sdt-filled) { box-shadow: 0 0 0 1px #d93025; }
.ProseMirror.doc-forms-fill .doc-sdt[data-form].doc-sdt-readonly { opacity: 0.6; }
.ProseMirror.doc-forms-fill { caret-color: #1a73e8; }
`;

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === "undefined") return;
  cssDone = true;
  const s = document.createElement("style");
  s.setAttribute("data-grown", "sdt");
  s.textContent = SDT_CSS;
  document.head.appendChild(s);
}

/** Controls whose content a transaction touched (final positions). */
function touchedSdts(trs: readonly Transaction[], doc: PMNode): SdtHit[] {
  const ranges: [number, number][] = [];
  trs.forEach((t, k) => {
    if (!t.docChanged) return;
    let after = null as null | { map: (p: number, a?: number) => number };
    const rest = trs.slice(k + 1);
    after = { map: (p: number, a = 1) => rest.reduce((q, x) => x.mapping.map(q, a), p) };
    t.steps.forEach((step, i) => {
      const m = t.mapping.slice(i + 1);
      step.getMap().forEach((_a, _b, fromB, toB) => ranges.push([after!.map(m.map(fromB, -1), -1), after!.map(m.map(toB, 1), 1)]));
      if (step instanceof AttrStep) {
        const p = after!.map(m.map(step.pos, 1), 1);
        ranges.push([p, p + 1]);
      }
    });
  });
  const seen = new Map<number, SdtHit>();
  const size = doc.content.size;
  for (const [a0, b0] of ranges) {
    const a = Math.max(0, Math.min(a0, size));
    const b = Math.max(a, Math.min(b0, size));
    for (const h of sdtAncestors(doc.resolve(a))) seen.set(h.pos, h);
    for (const h of sdtAncestors(doc.resolve(b))) seen.set(h.pos, h);
    if (b > a)
      doc.nodesBetween(a, b, (n, p) => {
        if (isSdt(n)) seen.set(p, { node: n, pos: p });
        return true;
      });
  }
  return [...seen.values()].sort((x, y) => y.pos - x.pos);
}

/** dropPlaceholderText removes the placeholder text from a control that
 *  gained other content, keeping that content. */
function dropPlaceholderText(tr: Transaction, pos: number): void {
  const node = tr.doc.nodeAt(pos)!;
  const plc = prOf(node).placeholder ?? "";
  // Direct text children as one string, with their positions.
  let text = "";
  const at: number[] = [];
  const base = node.type.name === SDT_BLOCK ? -1 : pos + 1;
  if (base >= 0)
    node.forEach((c, off) => {
      if (!c.isText) {
        text += "\ufffc";
        at.push(base + off);
        return;
      }
      for (let i = 0; i < c.text!.length; i++) at.push(base + off + i);
      text += c.text;
    });
  const i = plc ? text.indexOf(plc) : -1;
  if (i >= 0) tr.delete(at[i], at[i + plc.length - 1] + 1);
  tr.setNodeAttribute(pos, "plc", false);
}

/** isEmptyContent: an inline control without content, or a block one with
 *  a single empty paragraph. */
function isEmptyContent(node: PMNode): boolean {
  if (node.type.name === SDT_INLINE) return node.content.size === 0;
  return node.childCount === 1 && !!node.firstChild?.isTextblock && node.firstChild.content.size === 0;
}

/** stepAllowed: locks and the fill-in-form view. */
function stepAllowed(step: Step, doc: PMNode, state: EditorState, fill: boolean): boolean {
  const insideFillable = (a: number, b: number) => {
    const ha = sdtAncestors(doc.resolve(a));
    const hb = sdtAncestors(doc.resolve(b));
    const inner = ha[0];
    return !!inner && hb[0]?.pos === inner.pos && canFill(state, inner.node) && a > inner.pos && b < inner.pos + inner.node.nodeSize;
  };
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    const from = step.from;
    const to = step.to;
    for (const p of [from, to]) {
      for (const h of sdtAncestors(doc.resolve(p))) if (cannotEdit(prOf(h.node))) return false;
    }
    let ok = true;
    if (to > from)
      doc.nodesBetween(from, to, (n, p) => {
        if (!ok) return false;
        if (!isSdt(n)) return true;
        const whole = from <= p && p + n.nodeSize <= to;
        if (whole && cannotDelete(prOf(n))) ok = false;
        else if (!whole && cannotEdit(prOf(n))) ok = false;
        return ok;
      });
    if (!ok) return false;
    if (fill) return insideFillable(from, to);
    return true;
  }
  if (step instanceof AttrStep) {
    const n = doc.nodeAt(step.pos);
    if (fill) return isSdt(n) && (canFill(state, n) || (prOf(n).type === "checkbox" && !!prOf(n).form));
    return true;
  }
  if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
    const name = step.mark.type.name;
    // Comments, review records and bookmarks (a cross-reference to a
    // heading in a locked control, OnlyOffice bug 69293) always apply.
    if (name === "commentMark" || name === "bookmark" || REVIEW.has(name)) return true;
    if (fill) return false;
    for (const h of sdtAncestors(doc.resolve(step.from))) if (cannotEdit(prOf(h.node))) return false;
    return true;
  }
  return !fill;
}

export const ContentControls = Extension.create({
  name: "contentControls",
  priority: 1100,
  onCreate() {
    injectCss();
    editors.set(this.editor.view, this.editor);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<SdtState>({
        key: sdtKey,
        state: {
          init: () => ({ fill: false, role: null, current: null }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(sdtKey) as Meta | undefined;
            let next = value;
            if (meta && ("fill" in meta || "role" in meta)) next = { ...next, fill: meta.fill ?? next.fill, role: meta.role === undefined ? next.role : meta.role };
            if (meta && "current" in meta) next = { ...next, current: meta.current ?? null };
            else if (tr.selectionSet || tr.docChanged) {
              // Entering a text form remembers its value if it fits.
              const hit = sdtAtState(newState);
              const pr = hit ? prOf(hit.node) : null;
              if (hit && pr?.form && pr.type === "text") {
                const id = String(hit.node.attrs.sdtId);
                if (next.current?.id !== id) {
                  const v = hit.node.attrs.plc ? "" : innerText(hit.node);
                  next = { ...next, current: { id, valid: textFormFormat(pr).check(v) ? v : "" } };
                }
              } else if (next.current && !tr.getMeta("sdtLeave")) next = { ...next, current: next.current };
            }
            return next;
          },
        },
        view(view) {
          editors.set(view, editor);
          return {};
        },
        filterTransaction(tr, state) {
          if (!tr.docChanged || isRemote(tr)) return true;
          const meta = tr.getMeta(sdtKey) as Meta | undefined;
          if (meta?.force || tr.getMeta("sdtBinding")) return true;
          const fill = isFillMode(state);
          for (let i = 0; i < tr.steps.length; i++) if (!stepAllowed(tr.steps[i], tr.docs[i], state, fill)) return false;
          return true;
        },
        appendTransaction(trs, oldState, newState) {
          const local = trs.filter((t) => t.docChanged && !isRemote(t) && !t.getMeta("sdtAppend"));
          const tr = newState.tr;
          const keepEmpty = trs.some((t) => (t.getMeta(sdtKey) as Meta | undefined)?.keepEmpty);
          if (local.length) {
            for (const h of touchedSdts(local, newState.doc)) {
              const node = tr.doc.nodeAt(h.pos);
              if (!isSdt(node)) continue;
              const pr = prOf(node);
              // Typing that went around the placeholder (IME, native
              // input): drop the placeholder text, keep what was typed.
              if (node.attrs.plc && pr.placeholder && innerText(node) !== pr.placeholder && !isEmptyContent(node)) {
                dropPlaceholderText(tr, h.pos);
                continue;
              }
              if (!node.attrs.plc && isEmptyContent(node) && !keepEmpty && !isChoiceOnly(pr) && pr.type !== "complex" && (pr.placeholder || displayText(pr) != null)) {
                showPlaceholderTr(tr, h.pos);
                continue;
              }
              if (pr.temporary && !node.attrs.plc && !isEmptyContent(node)) {
                unwrapTr(tr, h.pos, true);
                continue;
              }
              // Review marks on the control node itself only when its whole
              // content carries them (a control inserted or deleted whole).
              for (const m of node.marks) {
                if (!REVIEW.has(m.type.name)) continue;
                let all = node.content.size > 0;
                node.descendants((c) => {
                  if (c.isText && !m.isInSet(c.marks)) all = false;
                  return all;
                });
                if (!all) tr.removeNodeMark(h.pos, m);
              }
            }
          }
          // Leaving a text form: a value that no longer fits its format
          // goes back to the last one that did (OnlyOffice).
          const before = sdtState(oldState).current;
          if (before && (trs.some((t) => t.selectionSet) || local.length)) {
            const now = sdtAtState(newState);
            if (!now || String(now.node.attrs.sdtId) !== before.id) {
              const left = sdtById(tr.doc, before.id);
              if (left && !left.node.attrs.plc) {
                const pr = prOf(left.node);
                const v = innerText(left.node);
                if (pr.form && pr.type === "text" && !textFormFormat(pr).check(v)) {
                  if (before.valid) setSdtContentTr(tr, left.pos, before.valid, false);
                  else showPlaceholderTr(tr, left.pos);
                }
              }
            }
          }
          return tr.docChanged ? tr.setMeta(sdtKey, { force: true } satisfies Meta).setMeta("sdtAppend", true).setMeta("addToHistory", local.length > 0) : null;
        },
        props: {
          handleKeyDown(view, event) {
            if (view.composing) return false;
            const { state } = view;
            const fill = isFillMode(state);
            const word = event.ctrlKey || event.altKey || event.metaKey;
            if (event.key === "Backspace" && !event.shiftKey) return handleDelete(view, -1, word);
            if (event.key === "Delete") return handleDelete(view, 1, word);
            if (event.key === "Tab" && fill && !event.ctrlKey && !event.altKey && !event.metaKey) {
              goToField(editorOf(view), event.shiftKey ? -1 : 1);
              return true;
            }
            if (fill && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.shiftKey && !word)
              return fillArrow(view, event.key === "ArrowLeft" ? -1 : 1);
            if (event.key === "Enter") {
              const hit = sdtAt(state);
              if (!hit || hit.node.type.name !== SDT_INLINE) return fill;
              const pr = prOf(hit.node);
              if (pr.multiLine || pr.textForm?.multiLine) {
                if (fill && !canFill(state, hit.node)) return true;
                if (hit.node.attrs.plc) return true;
                view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create()).scrollIntoView());
                return true;
              }
              if (fill) goToField(editorOf(view), 1);
              return true;
            }
            if (event.key === " " && !word) {
              const hit = sdtAt(state);
              if (hit && prOf(hit.node).type === "checkbox") {
                if (!(fill && !canFill(state, hit.node)) && !cannotEdit(prOf(hit.node))) toggleCheckbox(editorOf(view), hit.pos);
                return true;
              }
              const sel = state.selection;
              if (sel.empty) {
                const n = sel.$from.nodeAfter;
                if (n?.type.name === SDT_INLINE && prOf(n).type === "checkbox" && fill) {
                  toggleCheckbox(editorOf(view), sel.from);
                  return true;
                }
              }
            }
            return false;
          },
          handleTextInput(view, from, to, text) {
            return handleText(view, from, to, text);
          },
          handleClickOn(view, _pos, node, nodePos, event) {
            if (node.type.name !== SDT_INLINE) return false;
            const pr = prOf(node);
            const { state } = view;
            if (isFillMode(state) && !canFill(state, node)) return pr.type === "checkbox";
            if (pr.type === "checkbox") {
              if (!cannotEdit(pr) && view.editable) toggleCheckbox(editorOf(view), nodePos);
              return true;
            }
            if (pr.type === "picture" && view.editable && !cannotEdit(pr)) {
              window.dispatchEvent(new CustomEvent("grown-docs-sdt-picture", { detail: { pos: nodePos } }));
              selectNode(view, nodePos);
              event.preventDefault();
              return true;
            }
            if (node.attrs.plc && view.editable) {
              // Clicking a placeholder puts the caret at its start.
              view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, nodePos + 1)));
              return true;
            }
            return false;
          },
          // In the fill-in view a double click selects a whole field (a
          // sub-field of a complex form), a triple click the whole complex
          // form (OnlyOffice).
          handleDoubleClickOn(view, pos, node, nodePos) {
            if (!isFillMode(view.state) || node.type.name !== SDT_INLINE) return false;
            const pr = prOf(node);
            if (pr.type === "complex" || !pr.form) return false;
            const inner = sdtAncestors(view.state.doc.resolve(pos))[0];
            if (inner && inner.pos !== nodePos) return false;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, nodePos + 1, nodePos + node.nodeSize - 1)));
            return true;
          },
          handleTripleClick(view, pos) {
            if (!isFillMode(view.state)) return false;
            const complex = sdtAncestors(view.state.doc.resolve(pos)).find((h) => prOf(h.node).type === "complex");
            if (!complex) return false;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, complex.pos + 1, complex.pos + complex.node.nodeSize - 1)));
            return true;
          },
          attributes(state): Record<string, string> {
            return isFillMode(state) ? { class: "doc-forms-fill" } : {};
          },
          decorations(state) {
            const decos: Decoration[] = [];
            const sel = state.selection;
            const active = new Set<number>();
            if (sel instanceof NodeSelection && isSdt(sel.node)) active.add(sel.from);
            for (const h of sdtAncestors(sel.$from)) active.add(h.pos);
            for (const p of active) {
              const n = state.doc.nodeAt(p);
              if (n) decos.push(Decoration.node(p, p + n.nodeSize, { class: "doc-sdt-active" }));
            }
            if (isFillMode(state)) {
              for (const h of allSdts(state.doc)) {
                const pr = prOf(h.node);
                if (!pr.form) continue;
                const cls = [formFilled(h.node) ? "doc-sdt-filled" : "", pr.type !== "complex" && !canFill(state, h.node) ? "doc-sdt-readonly" : ""].filter(Boolean).join(" ");
                if (cls) decos.push(Decoration.node(h.pos, h.pos + h.node.nodeSize, { class: cls }));
              }
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },
});

function sdtAtState(state: EditorState): SdtHit | null {
  return sdtAt(state);
}
