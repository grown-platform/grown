// Glue between the document and the pure layout (Docs M9): section page
// specs, a model measurer (text metrics from a grid measurer; used by
// tests and as the headless fallback), and page lookups (which page a
// position is on) for fields, the status bar and navigation.
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  columnBoxes,
  type DocSettings,
  type Section,
  type SectionProps,
} from "./sections";
import { paginate, type Box, type FlowBox, type Layout, type PageSpec, type SectionSpec, type TableBox } from "./pagination";
import { directSpacing, spacingOf } from "./paragraphFormat";

/** Text metrics (MockMeasurer implements it). */
export interface TextMeasurer {
  lineHeight: number;
  lineCount(text: string, width: number): number;
  /** Character offsets where each wrapped line starts. */
  lineBreaks?(text: string, width: number): number[];
}

/** Keep / break properties of a block (the app compiles styles). */
export interface FlowProps {
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
}

export type PropsOf = (node: PMNode) => FlowProps;

export const directFlowProps: PropsOf = (n) => ({
  keepNext: !!n.attrs.keepNext,
  keepLines: !!n.attrs.keepLines,
  widowControl: n.attrs.widowControl !== false,
  pageBreakBefore: !!n.attrs.pageBreakBefore,
});

// --- page specs --------------------------------------------------------------------------

/** pageSpec converts a section's setup (points) to layout units. */
export function pageSpec(p: SectionProps, unit: number): PageSpec {
  const m = p.margins;
  return {
    w: p.pageW * unit,
    h: p.pageH * unit,
    top: m.top * unit,
    bottom: m.bottom * unit,
    left: m.left * unit,
    right: m.right * unit,
    header: m.header * unit,
    footer: m.footer * unit,
    gutter: m.gutter * unit,
    cols: columnBoxes(p).map((c) => ({ x: c.x * unit, w: c.w * unit })),
  };
}

export function sectionSpecs(sections: Section[], unit: number): SectionSpec[] {
  return sections.map((s) => ({
    fromBlock: s.fromBlock,
    toBlock: s.toBlock,
    start: s.start,
    page: pageSpec(s.props, unit),
    pgStart: s.props.pgNum.start ?? null,
  }));
}

/** The section index of every top-level block. */
export function blockSections(sections: Section[]): number[] {
  const out: number[] = [];
  for (const s of sections) for (let i = s.fromBlock; i < s.toBlock; i++) out[i] = s.index;
  return out;
}

// --- model measurer -------------------------------------------------------------------------

export interface ModelMeasureOpts {
  measurer: TextMeasurer;
  /** Layout units per point (1 = points as-is). */
  unit?: number;
  /** Use the editor's default spacing for unset sides (else 0). */
  defaultSpacing?: boolean;
  props?: PropsOf;
}

/** Text of a textblock for measuring: hard breaks are newlines, fields
 *  their results, other atoms one character. Also maps each character
 *  offset to a document position. */
export function measureText(node: PMNode, start: number): { text: string; pos: number[] } {
  let text = "";
  const pos: number[] = [];
  node.forEach((child, offset) => {
    const at = start + offset;
    if (child.isText) {
      const t = child.text ?? "";
      for (let i = 0; i < t.length; i++) pos.push(at + i);
      text += t;
    } else if (child.type.name === "hardBreak") {
      pos.push(at);
      text += "\n";
    } else if (child.type.name === "field") {
      const r = String(child.attrs.result ?? "") || " ";
      for (let i = 0; i < r.length; i++) pos.push(at);
      text += r;
    } else if (child.type.name === "bookmarkPoint") {
      /* zero width */
    } else {
      pos.push(at);
      text += "x";
    }
  });
  pos.push(start + node.content.size);
  return { text, pos };
}

function spacing(node: PMNode, o: ModelMeasureOpts): { before: number; after: number } {
  if (o.defaultSpacing) return spacingOf(node);
  const d = directSpacing(node);
  return { before: d.before ?? 0, after: d.after ?? 0 };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Lines of a textblock: heights and start positions. */
function textblockLines(node: PMNode, pos: number, width: number, o: ModelMeasureOpts): { h: number[]; at: number[] } {
  const unit = o.unit ?? 1;
  const w = Math.max(1, width - (num(node.attrs.indent) + num(node.attrs.indentRight)) * unit);
  const { text, pos: map } = measureText(node, pos + 1);
  const m = o.measurer;
  const breaks = m.lineBreaks ? m.lineBreaks(text, w) : null;
  const n = breaks ? breaks.length : m.lineCount(text, w);
  const h = Array(n).fill(m.lineHeight);
  const at = breaks ? breaks.map((b) => map[Math.min(b, map.length - 1)]) : Array(n).fill(pos + 1);
  return { h, at };
}

/** A block's lines, with each textblock's spacing folded into its first
 *  and last line (blocks nested in lists / quotes / tables of contents). */
function flowLines(node: PMNode, pos: number, width: number, o: ModelMeasureOpts): { h: number[]; at: number[] } {
  const unit = o.unit ?? 1;
  if (node.isTextblock) return textblockLines(node, pos, width, o);
  if (node.isAtom || node.isLeaf) return { h: [atomHeight(node, o)], at: [pos] };
  const h: number[] = [];
  const at: number[] = [];
  node.descendants((child, p) => {
    if (!child.isTextblock) return true;
    const lines = textblockLines(child, pos + 1 + p, width, o);
    const sp = spacing(child, o);
    lines.h[0] += sp.before * unit;
    lines.h[lines.h.length - 1] += sp.after * unit;
    h.push(...lines.h);
    at.push(...lines.at);
    return false;
  });
  if (!h.length) return { h: [atomHeight(node, o)], at: [pos] };
  return { h, at };
}

function atomHeight(node: PMNode, o: ModelMeasureOpts): number {
  const unit = o.unit ?? 1;
  switch (node.type.name) {
    case "pageBreak":
    case "columnBreak":
    case "sectionBreak":
      return 0;
    case "image":
      return num(node.attrs.height) * unit || o.measurer.lineHeight * 5;
    default:
      return o.measurer.lineHeight;
  }
}

function cellHeight(cell: PMNode, cellPos: number, width: number, o: ModelMeasureOpts): number {
  const unit = o.unit ?? 1;
  let h = 0;
  cell.forEach((child, off) => {
    const lines = flowLines(child, cellPos + 1 + off, width, o);
    const sp = child.isTextblock ? spacing(child, o) : { before: 0, after: 0 };
    h += lines.h.reduce((a, b) => a + b, 0) + (sp.before + sp.after) * unit;
  });
  return h;
}

/** Widest bottom border of a row's cells (points). */
function rowBorder(row: PMNode): number {
  let w = 0;
  row.forEach((cell) => {
    const raw = cell.attrs.borders;
    if (!raw) return;
    try {
      const b = JSON.parse(String(raw)) as Record<string, string>;
      const m = /^([\d.]+)/.exec(String(b.bottom ?? ""));
      if (m && !/none/.test(String(b.bottom))) w = Math.max(w, parseFloat(m[1]));
    } catch {
      /* ignore */
    }
  });
  return w;
}

function tableBox(node: PMNode, pos: number, width: number, o: ModelMeasureOpts): { box: TableBox; rowPos: number[] } {
  const unit = o.unit ?? 1;
  const rows: TableBox["rows"] = [];
  const rowPos: number[] = [];
  node.forEach((row, off) => {
    const rp = pos + 1 + off;
    rowPos.push(rp);
    const cells = row.childCount || 1;
    let h = 0;
    row.forEach((cell, coff) => {
      h = Math.max(h, cellHeight(cell, rp + 1 + coff, width / cells, o));
    });
    const min = num(row.attrs.height) * unit;
    const header = !!row.attrs.repeatHeader;
    rows.push({ h: Math.max(h, min) + rowBorder(row) * unit, header });
  });
  return { box: { kind: "table", top: 0, bottom: 0, rows, mt: 0, mb: 0 }, rowPos };
}

export interface MeasuredDoc {
  boxes: Box[];
  /** Start position of each top-level block. */
  blockPos: number[];
  /** Per block: where each line (flow) or row (table) starts. */
  itemPos: number[][];
}

/** modelMeasure turns a document into boxes with a grid measurer. */
export function modelMeasure(doc: PMNode, sections: Section[], o: ModelMeasureOpts): MeasuredDoc {
  const unit = o.unit ?? 1;
  const props = o.props ?? directFlowProps;
  const secOf = blockSections(sections);
  const widths = sections.map((s) => columnBoxes(s.props)[0].w * unit);
  const boxes: Box[] = [];
  const blockPos: number[] = [];
  const itemPos: number[][] = [];
  doc.forEach((node, pos, i) => {
    blockPos.push(pos);
    const width = widths[secOf[i] ?? 0];
    if (node.type.name === "table") {
      const t = tableBox(node, pos, width, o);
      boxes.push(t.box);
      itemPos.push(t.rowPos);
      return;
    }
    const lines = flowLines(node, pos, width, o);
    const sp = node.isTextblock ? spacing(node, o) : { before: 0, after: 0 };
    const p = node.isTextblock ? props(node) : {};
    const box: FlowBox = {
      kind: "flow",
      lines: lines.h,
      mt: sp.before * unit,
      mb: sp.after * unit,
      keepNext: !!p.keepNext,
      keepLines: !!p.keepLines,
      widow: p.widowControl !== false,
      breakBefore: !!p.pageBreakBefore,
      atomic: node.isAtom || node.isLeaf,
      breakAfter: node.type.name === "pageBreak" ? "page" : node.type.name === "columnBreak" ? "column" : null,
    };
    boxes.push(box);
    itemPos.push(lines.at);
  });
  return { boxes, blockPos, itemPos };
}

// --- whole-document layout ----------------------------------------------------------------

export interface DocLayout {
  layout: Layout;
  sections: Section[];
  measured: MeasuredDoc;
  settings: DocSettings;
  unit: number;
}

export function layoutDoc(measured: MeasuredDoc, sections: Section[], settings: DocSettings, unit: number, opts: { gap?: number; splitRows?: boolean } = {}): DocLayout {
  const layout = paginate(measured.boxes, sectionSpecs(sections, unit), {
    gap: opts.gap,
    mirror: settings.mirror,
    splitRows: opts.splitRows ?? true,
  });
  return { layout, sections, measured, settings, unit };
}

// --- page lookups -----------------------------------------------------------------------

/** Where a piece starts in the document. */
export function pieceStart(dl: DocLayout, block: number, piece: number): number {
  const p = dl.layout.blocks[block][piece];
  const items = dl.measured.itemPos[block];
  if (!p || piece === 0 || !items) return dl.measured.blockPos[block];
  const v = items[p.from];
  return v != null && v >= 0 ? v : dl.measured.blockPos[block];
}

/** blockAt: the top-level block index holding a position. */
export function blockAt(dl: DocLayout, pos: number): number {
  const bp = dl.measured.blockPos;
  let lo = 0;
  let hi = bp.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bp[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** pageIndexAt: the (0-based) page a position is on. */
export function pageIndexAt(dl: DocLayout, pos: number): number {
  const b = blockAt(dl, pos);
  const pieces = dl.layout.blocks[b] ?? [];
  let page = pieces[0]?.page ?? 0;
  for (let k = 1; k < pieces.length; k++) {
    if (pieceStart(dl, b, k) <= pos) page = pieces[k].page;
    else break;
  }
  return page;
}

/** A PageResolver (fields.ts) backed by the layout. */
export function layoutPageResolver(dl: DocLayout) {
  const pages = dl.layout.pages;
  return {
    pageAt: (pos: number) => pages[pageIndexAt(dl, pos)]?.number ?? 1,
    pageCount: () => pages.length,
    sectionPageCount: (pos: number) => {
      const sec = pages[pageIndexAt(dl, pos)]?.section ?? 0;
      return pages.filter((p) => p.section === sec).length;
    },
  };
}

// --- line numbers ------------------------------------------------------------------------

export interface LineMark {
  page: number;
  /** Virtual y of the line's top and its height. */
  y: number;
  h: number;
  n: number;
}

/**
 * lineNumbers numbers the text lines of sections with line numbering
 * (Word's lnNumType): restarting per page, per section or never, counting
 * by N (only multiples are returned). Table rows, breaks and atoms are
 * not counted.
 */
export function lineNumbers(dl: DocLayout): LineMark[] {
  const out: LineMark[] = [];
  const secOf = blockSections(dl.sections);
  let n = 0;
  let lastPage = -1;
  let lastSection = -1;
  dl.measured.boxes.forEach((box, i) => {
    const sec = dl.sections[secOf[i] ?? 0];
    const ln = sec?.props.lnNum;
    if (!ln || box.kind !== "flow" || box.atomic) return;
    const pieces = dl.layout.blocks[i] ?? [];
    pieces.forEach((p) => {
      let y = p.top;
      for (let k = p.from; k < p.to; k++) {
        if (sec.index !== lastSection) {
          if (lastSection < 0 || ln.restart !== "continuous") n = ln.start - 1;
          lastSection = sec.index;
          lastPage = p.page;
        } else if (ln.restart === "newPage" && p.page !== lastPage) n = ln.start - 1;
        lastPage = p.page;
        n++;
        if (n % ln.countBy === 0) out.push({ page: p.page, y, h: box.lines[k], n });
        y += box.lines[k];
      }
    });
  });
  return out;
}

/** The text on each page (for thumbnails), trimmed to `max` characters. */
export function pageSnippets(dl: DocLayout, doc: PMNode, max = 90): string[] {
  const out = dl.layout.pages.map(() => "");
  dl.layout.blocks.forEach((pieces, i) => {
    pieces.forEach((p, k) => {
      if (out[p.page].length >= max) return;
      const from = pieceStart(dl, i, k);
      const next = k + 1 < pieces.length ? pieceStart(dl, i, k + 1) : dl.measured.blockPos[i] + (doc.maybeChild(i)?.nodeSize ?? 0);
      if (next <= from) return;
      try {
        const t = doc.textBetween(Math.max(0, from), Math.min(doc.content.size, next), " ", " ").trim();
        if (t) out[p.page] = (out[p.page] ? `${out[p.page]} ${t}` : t).slice(0, max);
      } catch {
        /* ignore */
      }
    });
  });
  return out;
}
