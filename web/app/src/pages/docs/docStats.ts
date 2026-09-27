// Document statistics (Docs M13): Word's "Word Count" / OnlyOffice's
// "Document statistics" numbers, computed from the document model (pure)
// plus the page and line counts of the M9 layout.
import type { Node as PMNode } from "@tiptap/pm/model";

export interface DocStats {
  pages: number;
  words: number;
  /** Characters without spaces. */
  chars: number;
  /** Characters with spaces (tabs and no-break spaces count as spaces). */
  charsWithSpaces: number;
  /** Paragraphs with text (Word doesn't count empty ones). */
  paragraphs: number;
  /** Text lines from the layout, when there is one. */
  lines: number | null;
}

export interface DocStatsOptions {
  /** Count only this range (a selection). */
  from?: number;
  to?: number;
  /** Include footnote and endnote text (Word's "textboxes, footnotes and
   *  endnotes" box). */
  includeNotes?: boolean;
  pages?: number;
  lines?: number | null;
}

const NOTE_TYPES = new Set(["footnote", "endnote"]);

/** docStats counts words the way Word does: runs of non-space characters
 *  separated by white space (so "well-known" and "e.g." are one word). */
export function docStats(doc: PMNode, o: DocStatsOptions = {}): DocStats {
  const from = o.from ?? 0;
  const to = o.to ?? doc.content.size;
  const paras: string[] = [];
  const notes: string[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (at + child.nodeSize <= from || at >= to) return;
      if (child.isText) text += (child.text ?? "").slice(Math.max(0, from - at), Math.max(0, to - at));
      else if (NOTE_TYPES.has(child.type.name)) {
        if (o.includeNotes && typeof child.attrs.content === "string") notes.push(child.attrs.content);
      } else if (child.type.name === "hardBreak") text += "\n";
      else if (child.isLeaf) text += child.textContent || (child.type.spec.leafText ? child.type.spec.leafText(child) : "");
    });
    paras.push(text);
    return false;
  });
  const all = [...paras, ...notes];
  let words = 0;
  let chars = 0;
  let charsWithSpaces = 0;
  for (const t of all) {
    words += (t.match(/[^\s ]+/g) ?? []).length;
    const flat = t.replace(/\n/g, "");
    charsWithSpaces += [...flat].length;
    chars += [...flat.replace(/[\s ]/g, "")].length;
  }
  return {
    pages: o.pages ?? 1,
    words,
    chars,
    charsWithSpaces,
    paragraphs: paras.filter((p) => p.trim()).length + notes.filter((n) => n.trim()).length,
    lines: o.lines ?? null,
  };
}
