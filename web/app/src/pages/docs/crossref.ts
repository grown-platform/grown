// Cross-references (Docs M8): References ▸ Cross-reference inserts a REF,
// PAGEREF or NOTEREF field pointing at a heading, bookmark, footnote,
// endnote or caption. Headings, notes and captions get a hidden `_Ref<n>`
// bookmark (reused when one already covers the same text), as Word does.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { ensureBookmark, isHiddenBookmark, listBookmarks } from "./bookmarks";
import { computeFieldResults, outlineLevelOf, textWithFields } from "./fields";
import { captionItems } from "./captions";
import { fieldEnv } from "./references";
import { getDocModel } from "./docModel";
import { computeNumbering } from "./numbering";
import { syncSelectionFromDOM } from "./links";

/** "heading" | "bookmark" | "footnote" | "endnote" | "caption:<label>". */
export type RefType = string;

export type RefKind =
  | "text" // heading / bookmark text, entire caption
  | "number" // heading / paragraph number (\r)
  | "numberNoContext" // \n
  | "numberFull" // \w
  | "page" // PAGEREF
  | "aboveBelow" // \p
  | "noteNumber" // NOTEREF
  | "noteNumberFormatted" // NOTEREF \f
  | "labelNumber" // caption: "Figure 1"
  | "captionText"; // caption: text only

export const REF_KINDS: Record<string, { id: RefKind; label: string }[]> = {
  heading: [
    { id: "text", label: "Heading text" },
    { id: "page", label: "Page number" },
    { id: "number", label: "Heading number" },
    { id: "numberNoContext", label: "Heading number (no context)" },
    { id: "numberFull", label: "Heading number (full context)" },
    { id: "aboveBelow", label: "Above/below" },
  ],
  bookmark: [
    { id: "text", label: "Bookmark text" },
    { id: "page", label: "Page number" },
    { id: "number", label: "Paragraph number" },
    { id: "numberNoContext", label: "Paragraph number (no context)" },
    { id: "numberFull", label: "Paragraph number (full context)" },
    { id: "aboveBelow", label: "Above/below" },
  ],
  footnote: [
    { id: "noteNumber", label: "Footnote number" },
    { id: "noteNumberFormatted", label: "Footnote number (formatted)" },
    { id: "page", label: "Page number" },
    { id: "aboveBelow", label: "Above/below" },
  ],
  endnote: [
    { id: "noteNumber", label: "Endnote number" },
    { id: "noteNumberFormatted", label: "Endnote number (formatted)" },
    { id: "page", label: "Page number" },
    { id: "aboveBelow", label: "Above/below" },
  ],
  caption: [
    { id: "text", label: "Entire caption" },
    { id: "labelNumber", label: "Only label and number" },
    { id: "captionText", label: "Only caption text" },
    { id: "page", label: "Page number" },
    { id: "aboveBelow", label: "Above/below" },
  ],
};

export const kindsFor = (type: RefType) => REF_KINDS[type.startsWith("caption:") ? "caption" : type] ?? [];

export interface RefTarget {
  /** Position of the target (paragraph, note or bookmark start). */
  pos: number;
  /** Bookmark name for type "bookmark". */
  name?: string;
  label: string;
  level?: number;
}

/** refTargets lists what a reference type can point at, in order. */
export function refTargets(editor: Editor, type: RefType, hidden = false): RefTarget[] {
  const doc = editor.state.doc;
  const sheet = getDocModel(editor)?.sheet;
  const out: RefTarget[] = [];
  if (type === "heading") {
    const model = getDocModel(editor);
    const labels = model ? computeNumbering(doc, model.sheet, model.numbering) : new Map();
    doc.descendants((n, pos) => {
      if (n.type.name === "tableOfContents") return false;
      if (!n.isTextblock) return true;
      const level = outlineLevelOf(n, sheet);
      const text = textWithFields(doc, pos + 1, pos + n.nodeSize - 1).trim();
      if (level && text) {
        const num = labels.get(pos)?.text;
        out.push({ pos, level, label: num ? `${num} ${text}` : text });
      }
      return false;
    });
  } else if (type === "bookmark") {
    for (const b of listBookmarks(doc)) if (hidden || !isHiddenBookmark(b.name)) out.push({ pos: b.from, name: b.name, label: b.name });
  } else if (type === "footnote" || type === "endnote") {
    let i = 0;
    doc.descendants((n, pos) => {
      if (n.type.name === type) {
        i++;
        const note = String(n.attrs.content ?? "").trim();
        out.push({ pos, label: `${i}${note ? ` ${note.slice(0, 60)}` : ""}` });
      }
      return true;
    });
  } else if (type.startsWith("caption:")) {
    for (const c of captionItems(doc, type.slice(8))) out.push({ pos: c.pos, label: c.text });
  }
  return out;
}

/** refTypes: the reference types offered (captions by label in use). */
export function refTypes(labels: string[]): { id: RefType; label: string }[] {
  return [
    { id: "heading", label: "Heading" },
    { id: "bookmark", label: "Bookmark" },
    { id: "footnote", label: "Footnote" },
    { id: "endnote", label: "Endnote" },
    ...labels.map((l) => ({ id: `caption:${l}`, label: l })),
  ];
}

export interface CrossRefOptions {
  type: RefType;
  target: RefTarget;
  kind: RefKind;
  hyperlink?: boolean;
  /** "Include above/below" (numbers and pages). */
  aboveBelow?: boolean;
}

/** The bookmark a reference points at, created in `tr` when needed. */
function targetBookmark(tr: Transaction, o: CrossRefOptions): string | null {
  const doc = tr.doc;
  if (o.type === "bookmark") return o.target.name ?? null;
  if (o.type === "heading") {
    const n = doc.nodeAt(o.target.pos);
    if (!n?.isTextblock) return null;
    return ensureBookmark(tr, o.target.pos + 1, o.target.pos + n.nodeSize - 1, "_Ref");
  }
  if (o.type === "footnote" || o.type === "endnote") {
    const n = doc.nodeAt(o.target.pos);
    if (!n || n.type.name !== o.type) return null;
    return ensureBookmark(tr, o.target.pos, o.target.pos + 1, "_Ref");
  }
  if (o.type.startsWith("caption:")) {
    const c = captionItems(doc, o.type.slice(8)).find((x) => x.pos === o.target.pos);
    if (!c) return null;
    if (o.kind === "labelNumber") return ensureBookmark(tr, c.labelFrom, c.labelTo, "_Ref");
    if (o.kind === "captionText") return ensureBookmark(tr, c.textFrom, c.textTo, "_Ref");
    return ensureBookmark(tr, c.pos + 1, c.pos + c.node.nodeSize - 1, "_Ref");
  }
  return null;
}

/** crossRefInstr builds the field instruction for a reference. */
export function crossRefInstr(name: string, o: Pick<CrossRefOptions, "kind" | "hyperlink" | "aboveBelow" | "type">): string {
  const h = o.hyperlink ? " \\h" : "";
  const p = o.aboveBelow ? " \\p" : "";
  const note = o.type === "footnote" || o.type === "endnote";
  switch (o.kind) {
    case "page":
      return `PAGEREF ${name}${h}${p}`;
    case "aboveBelow":
      return note ? `NOTEREF ${name} \\p${h}` : `REF ${name} \\p${h}`;
    case "noteNumber":
      return `NOTEREF ${name}${h}${p}`;
    case "noteNumberFormatted":
      return `NOTEREF ${name} \\f${h}${p}`;
    case "number":
      return `REF ${name} \\r${h}${p}`;
    case "numberNoContext":
      return `REF ${name} \\n${h}${p}`;
    case "numberFull":
      return `REF ${name} \\w${h}${p}`;
    default:
      return `REF ${name}${h}`;
  }
}

/** insertCrossReference inserts the reference field at the selection. */
export function insertCrossReference(editor: Editor, o: CrossRefOptions): boolean {
  syncSelectionFromDOM(editor.view);
  const { state } = editor;
  const tr = state.tr;
  const name = targetBookmark(tr, o);
  if (!name) return false;
  const node = state.schema.nodes.field.create({ instr: crossRefInstr(name, o), result: "" });
  const at = tr.mapping.map(state.selection.from);
  tr.replaceWith(at, tr.mapping.map(state.selection.to), node);
  const results = computeFieldResults(fieldEnv(editor, tr.doc));
  const n = tr.doc.nodeAt(at);
  if (n?.type.name === "field") tr.setNodeMarkup(at, undefined, { ...n.attrs, result: results.get(at) ?? "" });
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** addRefToParagraph: OnlyOffice's AddRefToParagraph(paragraph, type,
 *  hyperlink, aboveBelow) for a heading paragraph at `pos` — heading
 *  text (type 0) or number. */
export function addRefToParagraph(editor: Editor, pos: number, kind: RefKind = "text", hyperlink = true): boolean {
  const n: PMNode | null = editor.state.doc.nodeAt(pos);
  if (!n?.isTextblock) return false;
  return insertCrossReference(editor, { type: "heading", target: { pos, label: n.textContent }, kind, hyperlink });
}
