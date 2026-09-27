// Captions (Docs M8): Insert ▸ Caption adds a Caption-style paragraph
// "Figure 1: text" whose number is a SEQ field (optionally prefixed with
// the chapter number, a STYLEREF field), above or below the selected
// table, image or drawing — or next to the current paragraph. SEQ fields
// renumber after every edit (references.ts), so captions stay 1, 2, 3.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { computeFieldResults, parseInstr, textWithFields } from "./fields";
import { fieldEnv } from "./references";
import { hasSeq } from "./toc";

export const DEFAULT_LABELS = ["Figure", "Table", "Equation"];
export const CHAPTER_SEPARATORS: { id: string; label: string }[] = [
  { id: "-", label: "- (hyphen)" },
  { id: ".", label: ". (period)" },
  { id: ":", label: ": (colon)" },
  { id: "—", label: "— (em dash)" },
  { id: "–", label: "– (en dash)" },
];

const LABELS_KEY = "grown.docs.captionLabels.v1";

/** Custom labels the user added (per browser, like Word's Normal.dotm). */
export function customLabels(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LABELS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export function saveCustomLabels(labels: string[]) {
  try {
    localStorage.setItem(LABELS_KEY, JSON.stringify([...new Set(labels)]));
  } catch {
    /* storage unavailable */
  }
}

/** captionLabels: the built-in labels, custom ones, and every SEQ
 *  identifier used in the document. */
export function captionLabels(doc: PMNode, extra: string[] = customLabels()): string[] {
  const out = [...DEFAULT_LABELS, ...extra];
  doc.descendants((n) => {
    if (n.type.name === "field") {
      const p = parseInstr(String(n.attrs.instr ?? ""));
      if (p.type === "SEQ" && p.args[0]) out.push(p.args[0]);
    }
    return true;
  });
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface CaptionOptions {
  label: string;
  /** Text after the number, verbatim (": Sales by region"). */
  text?: string;
  position?: "above" | "below";
  /** Leave "Figure" out of the caption text (the number stays). */
  excludeLabel?: boolean;
  /** \* number format: ARABIC, alphabetic, ALPHABETIC, roman, ROMAN. */
  format?: string;
  /** Chapter numbering: the heading level that starts a chapter and the
   *  separator between chapter and caption number. */
  chapter?: { level: number; separator: string } | null;
}

/** captionInstrs returns the SEQ (and STYLEREF) instructions of a caption. */
export function captionInstrs(o: CaptionOptions): { seq: string; chapter: string | null } {
  const label = o.label.trim().replace(/\s+/g, "_");
  const fmt = o.format && o.format !== "ARABIC" ? o.format : "ARABIC";
  const reset = o.chapter ? ` \\s ${o.chapter.level}` : "";
  return {
    seq: `SEQ ${label} \\* ${fmt}${reset}`,
    chapter: o.chapter ? `STYLEREF ${o.chapter.level} \\s` : null,
  };
}

/** The block a caption attaches to: a selected block object, the table
 *  around the caret, else the caret's paragraph. */
function captionAnchor(editor: Editor): { pos: number; node: PMNode; depth: number } | null {
  const { state } = editor;
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.isBlock) return { pos: sel.from, node: sel.node, depth: sel.$from.depth + 1 };
  const $f = sel.$from;
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (n.type.name === "table") return { pos: $f.before(d), node: n, depth: d };
  }
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (n.isTextblock) return { pos: $f.before(d), node: n, depth: d };
  }
  return null;
}

/** defaultCaptionPosition: tables caption above, everything else below. */
export function defaultCaptionPosition(editor: Editor): "above" | "below" {
  return captionAnchor(editor)?.node.type.name === "table" ? "above" : "below";
}

/** insertCaption inserts a numbered caption and puts the caret at its end. */
export function insertCaption(editor: Editor, o: CaptionOptions): boolean {
  const { state } = editor;
  const schema = state.schema;
  const anchor = captionAnchor(editor);
  if (!anchor || !o.label.trim()) return false;
  const position = o.position ?? (anchor.node.type.name === "table" ? "above" : "below");
  const { seq, chapter } = captionInstrs(o);
  const content: PMNode[] = [];
  if (!o.excludeLabel) content.push(schema.text(`${o.label.trim()} `));
  if (chapter) {
    content.push(schema.nodes.field.create({ instr: chapter, result: "" }));
    content.push(schema.text(o.chapter!.separator || "-"));
  }
  content.push(schema.nodes.field.create({ instr: seq, result: "" }));
  if (o.text) content.push(schema.text(o.text));
  const para = schema.nodes.paragraph.create({ styleId: "Caption" }, content);
  const at = position === "above" ? anchor.pos : anchor.pos + anchor.node.nodeSize;
  const tr = state.tr.insert(at, para);
  // Compute the new caption's numbers straight away.
  const results = computeFieldResults(fieldEnv(editor, tr.doc));
  tr.doc.nodesBetween(at, at + para.nodeSize, (n, pos) => {
    if (n.type.name === "field" && results.has(pos)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, result: results.get(pos) });
    return true;
  });
  tr.setSelection(TextSelection.create(tr.doc, at + tr.doc.nodeAt(at)!.nodeSize - 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

export interface CaptionItem {
  pos: number;
  node: PMNode;
  /** The whole caption text ("Figure 1: Growth"). */
  text: string;
  /** Range of "label + number" ("Figure 1"), and of the text after it. */
  labelFrom: number;
  labelTo: number;
  textFrom: number;
  textTo: number;
}

/** captionItems lists the captions of a label in document order. */
export function captionItems(doc: PMNode, label: string): CaptionItem[] {
  const out: CaptionItem[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === "tableOfContents") return false;
    if (!n.isTextblock) return true;
    if (!hasSeq(n, label)) return false;
    const from = pos + 1;
    const to = pos + n.nodeSize - 1;
    // Label and number end after the SEQ field.
    let seqEnd = from;
    n.forEach((c, off) => {
      if (c.type.name === "field" && parseInstr(String(c.attrs.instr)).type === "SEQ" && seqEnd === from) seqEnd = from + off + c.nodeSize;
    });
    const rest = textWithFields(doc, seqEnd, to);
    const lead = rest.length - rest.replace(/^[\s:.\-–—]+/u, "").length;
    out.push({
      pos,
      node: n,
      text: textWithFields(doc, from, to).trim(),
      labelFrom: from,
      labelTo: seqEnd,
      textFrom: Math.min(to, seqEnd + lead),
      textTo: to,
    });
    return false;
  });
  return out;
}
