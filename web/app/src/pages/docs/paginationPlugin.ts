// The Pagination plugin (Docs M9): measures the rendered blocks, lays them
// out on pages (pagination.ts) and realises the pages with decorations,
// never by moving ProseMirror's DOM:
//   * a spacer widget before a block that starts a new page or column
//     (its height fills the rest of the page, the gap and the next page's
//     top margin; a negative margin pulls content back up after columns);
//   * a `display: block` spacer span inside a paragraph where it breaks
//     across pages, at the first character of the line that moves on;
//   * a spacer row inside a table where it breaks, followed by clones of
//     its header rows;
//   * a node decoration (translate + right margin) for blocks placed in
//     another column, or on a page whose size or margins differ from the
//     first page's.
// Page backgrounds, headers/footers, watermarks and line numbers are drawn
// by PageLayer.tsx from the same layout.
//
// Measuring is incremental: a block's box is cached by node identity and
// width and re-read only when the node changes or its rendered height
// does; the layout resumes from the first changed block (pagination.ts).
// Tests (and headless use) swap the DOM for a MockMeasurer grid with
// setPaginationMeasurer; the layout is then computed synchronously.
import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { collapse, paginate, type Box, type FlowBox, type Layout, type TableBox } from "./pagination";
import {
  blockSections,
  directFlowProps,
  layoutPageResolver,
  modelMeasure,
  sectionSpecs,
  type DocLayout,
  type FlowProps,
  type MeasuredDoc,
  type PropsOf,
  type TextMeasurer,
} from "./paginationModel";
import { PX_PER_PT, contentWidth, defaultSettings, sectionsOf, type DocSettings } from "./sections";
import { settingsStore } from "./pageLayout";
import { compiledProps, getDocModel } from "./docModel";
import { setPageResolver, setLayoutWaiter, updateFieldsTr } from "./references";
import { explicitPages } from "./fields";

/** Gap between pages on screen (px). */
export const PAGE_GAP = 16;

export interface BaseGeom {
  /** Widest page (the sheet's width). */
  maxW: number;
  /** The first page's text box: left edge and width, top margin. */
  left: number;
  width: number;
  top: number;
}

export interface PaginationState {
  dl: DocLayout | null;
  base: BaseGeom | null;
  deco: DecorationSet;
  settings: DocSettings;
  /** Draw pages (print layout); false in pageless view. */
  paged: boolean;
  version: number;
}

export const paginationKey = new PluginKey<PaginationState>("pagination");

interface Meta {
  dl?: DocLayout | null;
  base?: BaseGeom | null;
  deco?: DecorationSet;
  settings?: DocSettings;
  paged?: boolean;
  /** Recompute (model mode) / re-measure (DOM mode). */
  refresh?: boolean;
}

// --- per-editor runtime ---------------------------------------------------------------------

interface LineData {
  /** The line's textblock, relative to the top-level block's position. */
  tbOff: number;
  first: boolean;
  /** Natural y of the line's text top, relative to the block top. */
  textTop: number;
}

interface Cached {
  node: PMNode;
  width: number;
  h: number;
  box: Box;
  lines: LineData[] | null;
  /** Line / row starts relative to the block (-1 = resolve on demand). */
  items: number[];
}

interface Runtime {
  measurer: "dom" | TextMeasurer;
  cache: WeakMap<PMNode, Cached>;
  /** Blocks of the last measure, for incremental layout. */
  prevBoxes: Box[] | null;
  frame: number | null;
  listeners: Set<(s: PaginationState) => void>;
  waiters: (() => void)[];
  /** Print preview forces page layout in a pageless document. */
  forcePaged: boolean;
  /** Consecutive automatic PAGE-field refreshes (loop guard). */
  fieldRounds: number;
  lines: Map<number, LineData[]>;
  destroyed: boolean;
}

const runtimes = new WeakMap<Editor, Runtime>();

function runtime(editor: Editor): Runtime {
  let r = runtimes.get(editor);
  if (!r) {
    r = {
      measurer: "dom",
      cache: new WeakMap(),
      prevBoxes: null,
      frame: null,
      listeners: new Set(),
      waiters: [],
      forcePaged: false,
      fieldRounds: 0,
      lines: new Map(),
      destroyed: false,
    };
    runtimes.set(editor, r);
  }
  return r;
}

export function paginationState(editor: Editor): PaginationState | undefined {
  return editor.isDestroyed ? undefined : paginationKey.getState(editor.state);
}

/** The current layout (null before the first measure). */
export function getLayout(editor: Editor): DocLayout | null {
  return paginationState(editor)?.dl ?? null;
}

/** onLayout subscribes to layout changes. */
export function onLayout(editor: Editor, fn: (s: PaginationState) => void): () => void {
  const r = runtime(editor);
  r.listeners.add(fn);
  return () => r.listeners.delete(fn);
}

/** afterNextLayout runs `fn` once the next layout has been applied. */
export function afterNextLayout(editor: Editor, fn: () => void) {
  runtime(editor).waiters.push(fn);
  requestRefresh(editor);
}

/** setPaginationMeasurer switches between the DOM and a grid measurer
 *  (tests); the layout is recomputed at once. */
export function setPaginationMeasurer(editor: Editor, m: "dom" | TextMeasurer) {
  const r = runtime(editor);
  r.measurer = m;
  r.cache = new WeakMap();
  r.prevBoxes = null;
  requestRefresh(editor);
}

/** setForcePaged shows pages in a pageless document (print preview). */
export function setForcePaged(editor: Editor, on: boolean) {
  runtime(editor).forcePaged = on;
  editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { paged: isPaged(editor, getSettingsFor(editor)) } satisfies Meta).setMeta("addToHistory", false));
  requestRefresh(editor);
}

/** syncSettings pushes the `docSettings` map into the plugin now (the
 *  map observer does this asynchronously). */
export function syncSettings(editor: Editor) {
  if (editor.isDestroyed) return;
  const settings = getSettingsFor(editor);
  const r = runtime(editor);
  r.cache = new WeakMap();
  r.prevBoxes = null;
  editor.view.dispatch(
    editor.state.tr.setMeta(paginationKey, { settings, paged: isPaged(editor, settings) } satisfies Meta).setMeta("addToHistory", false),
  );
  if (r.measurer === "dom") schedule(editor);
}

/** requestRefresh re-measures everything (settings, fonts, images). */
export function requestRefresh(editor: Editor, clearCache = false) {
  if (editor.isDestroyed) return;
  const r = runtime(editor);
  if (clearCache) {
    r.cache = new WeakMap();
    r.prevBoxes = null;
  }
  if (r.measurer !== "dom") {
    editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { refresh: true } satisfies Meta).setMeta("addToHistory", false));
    return;
  }
  schedule(editor);
}

function getSettingsFor(editor: Editor): DocSettings {
  try {
    return settingsStore(editor).get();
  } catch {
    return defaultSettings();
  }
}

function isPaged(editor: Editor, s: DocSettings) {
  return !s.pageless || runtime(editor).forcePaged;
}

// --- measuring ---------------------------------------------------------------------------

function propsFor(editor: Editor): PropsOf {
  return (node) => {
    if (!node.isTextblock) return {};
    try {
      const c = compiledProps(editor, node);
      return {
        keepNext: !!c.keepNext,
        keepLines: !!c.keepLines,
        widowControl: c.widowControl !== false,
        pageBreakBefore: !!c.pageBreakBefore,
      } satisfies FlowProps;
    } catch {
      return directFlowProps(node);
    }
  };
}

function px(v: string | null | undefined): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** Heights of our own spacers / clones inside an element, top to bottom,
 *  in client coordinates. */
function innerSpacers(dom: HTMLElement): { top: number; h: number }[] {
  const out: { top: number; h: number }[] = [];
  dom.querySelectorAll<HTMLElement>(".pg-inner").forEach((el) => {
    const r = el.getBoundingClientRect();
    out.push({ top: r.top, h: r.height });
  });
  return out.sort((a, b) => a.top - b.top);
}

/** Converts a client y inside a block to its natural offset (without our
 *  spacers) from the block's top. */
function natural(y: number, top: number, spacers: { top: number; h: number }[], scale: number): number {
  let shift = 0;
  for (const s of spacers) if (s.top + s.h <= y + 0.5) shift += s.h;
  return (y - top - shift) / scale;
}

function lineClusters(el: HTMLElement, exclude: { top: number; h: number }[]): { top: number; bottom: number }[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  // Behind / in-front objects (M7) are positioned out of the flow: their
  // boxes (and anything inside them) are not lines. Floats stay: a float
  // and the lines beside it move between pages together.
  const abs = Array.from(el.querySelectorAll(".doc-obj-abs")).map((e) => e.getBoundingClientRect());
  const inAbs = (r: DOMRect) => abs.some((a) => r.left >= a.left - 0.5 && r.right <= a.right + 0.5 && r.top >= a.top - 0.5 && r.bottom <= a.bottom + 0.5);
  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.height > 0 && !exclude.some((s) => Math.abs(r.top - s.top) < 0.5 && Math.abs(r.height - s.h) < 0.5) && !(abs.length && inAbs(r)),
  );
  rects.sort((a, b) => a.top - b.top);
  const out: { top: number; bottom: number }[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && r.top < last.bottom - 2) last.bottom = Math.max(last.bottom, r.bottom);
    else out.push({ top: r.top, bottom: r.bottom });
  }
  return out;
}

function measureFlow(view: EditorView, node: PMNode, pos: number, dom: HTMLElement, top: number, height: number, scale: number, spacers: { top: number; h: number }[]): { lines: number[]; data: LineData[] } {
  const tbs: { node: PMNode; pos: number }[] = [];
  if (node.isTextblock) tbs.push({ node, pos });
  else
    node.descendants((child, p) => {
      if (child.isTextblock) {
        tbs.push({ node: child, pos: pos + 1 + p });
        return false;
      }
      return child.type.name !== "table";
    });
  if (!tbs.length || node.isAtom) return { lines: [height], data: [{ tbOff: -1, first: true, textTop: 0 }] };
  const bounds: number[] = [];
  const data: LineData[] = [];
  for (const tb of tbs) {
    const el = (tb.node === node ? dom : view.nodeDOM(tb.pos)) as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement)) continue;
    const r = el.getBoundingClientRect();
    const contentTop = natural(r.top + el.clientTop * scale, top, spacers, scale);
    const clusters = lineClusters(el, spacers);
    if (!clusters.length) {
      bounds.push(contentTop);
      data.push({ tbOff: tb.pos - pos, first: true, textTop: contentTop });
      continue;
    }
    clusters.forEach((c, k) => {
      const textTop = natural(c.top, top, spacers, scale);
      if (k === 0) bounds.push(contentTop);
      else {
        const prev = clusters[k - 1];
        const between = spacers.find((s) => s.top >= prev.bottom - 1 && s.top + s.h <= c.top + 1);
        bounds.push(between ? natural(between.top, top, spacers, scale) : natural((prev.bottom + c.top) / 2, top, spacers, scale));
      }
      data.push({ tbOff: tb.pos - pos, first: k === 0, textTop });
    });
  }
  if (!bounds.length) return { lines: [height], data: [{ tbOff: -1, first: true, textTop: 0 }] };
  bounds[0] = 0;
  const lines: number[] = [];
  for (let k = 0; k < bounds.length; k++) {
    const next = k + 1 < bounds.length ? bounds[k + 1] : height;
    lines.push(Math.max(0, next - bounds[k]));
  }
  return { lines, data };
}

function measureTable(view: EditorView, node: PMNode, pos: number, _dom: HTMLElement, top: number, height: number, scale: number, spacers: { top: number; h: number }[]): { box: TableBox; items: number[] } {
  const rows: TableBox["rows"] = [];
  const items: number[] = [];
  const tops: number[] = [];
  let lastBottom = 0;
  node.forEach((row, off) => {
    const rp = pos + 1 + off;
    const tr = view.nodeDOM(rp) as HTMLElement | null;
    items.push(rp - pos);
    if (!tr || !(tr instanceof HTMLElement)) {
      tops.push(tops.length ? tops[tops.length - 1] : 0);
      return;
    }
    const r = tr.getBoundingClientRect();
    tops.push(natural(r.top, top, spacers, scale));
    lastBottom = natural(r.bottom, top, spacers, scale);
    rows.push({ h: 0, header: !!row.attrs.repeatHeader });
  });
  while (rows.length < tops.length) rows.push({ h: 0 });
  for (let i = 0; i < rows.length; i++) rows[i].h = Math.max(0, (i + 1 < tops.length ? tops[i + 1] : lastBottom) - tops[i]);
  return {
    box: { kind: "table", top: tops[0] ?? 0, bottom: Math.max(0, height - lastBottom), rows, mt: 0, mb: 0 },
    items,
  };
}

/** domMeasure reads every top-level block's box from the rendered DOM. */
function domMeasure(editor: Editor, view: EditorView, doc: PMNode): MeasuredDoc {
  const r = runtime(editor);
  const props = propsFor(editor);
  const root = view.dom as HTMLElement;
  const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth || 1 : 1;
  const boxes: Box[] = [];
  const blockPos: number[] = [];
  const itemPos: number[][] = [];
  r.lines = new Map();
  doc.forEach((node, pos, i) => {
    blockPos.push(pos);
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !(dom instanceof HTMLElement)) {
      boxes.push({ kind: "flow", lines: [0], mt: 0, mb: 0, atomic: true });
      itemPos.push([pos]);
      return;
    }
    const rect = dom.getBoundingClientRect();
    const spacers = dom.querySelector(".pg-inner") ? innerSpacers(dom) : [];
    const height = (rect.height - spacers.reduce((a, s) => a + s.h, 0)) / scale;
    const width = dom.offsetWidth;
    const hit = r.cache.get(node);
    const abs = (items: number[]) => items.map((o) => (o < 0 ? -1 : pos + o));
    if (hit && hit.width === width && Math.abs(hit.h - height) < 0.5) {
      boxes.push(hit.box);
      itemPos.push(abs(hit.items));
      if (hit.lines) r.lines.set(i, hit.lines);
      return;
    }
    const cs = getComputedStyle(dom);
    const mt = px(cs.marginTop);
    const mb = px(cs.marginBottom);
    let box: Box;
    let lines: LineData[] | null = null;
    let items: number[];
    if (node.type.name === "table") {
      const t = measureTable(view, node, pos, dom, rect.top, height, scale, spacers);
      box = { ...t.box, mt, mb };
      items = t.items;
    } else {
      const f = measureFlow(view, node, pos, dom, rect.top, height, scale, spacers);
      const p = props(node);
      const flow: FlowBox = {
        kind: "flow",
        lines: f.lines,
        mt,
        mb,
        keepNext: !!p.keepNext,
        keepLines: !!p.keepLines,
        widow: p.widowControl !== false,
        breakBefore: !!p.pageBreakBefore,
        atomic: node.isAtom || node.isLeaf || f.lines.length < 2,
        breakAfter: node.type.name === "pageBreak" ? "page" : node.type.name === "columnBreak" ? "column" : null,
      };
      box = flow;
      lines = f.data;
      items = f.data.map((d) => (d.first ? (d.tbOff < 0 ? 0 : d.tbOff + 1) : -1));
    }
    r.cache.set(node, { node, width, h: height, box, lines, items });
    if (lines) r.lines.set(i, lines);
    boxes.push(box);
    itemPos.push(abs(items));
  });
  return { boxes, blockPos, itemPos };
}

/** Where line `k` of block `i` starts (DOM): its paragraph's start, or the
 *  first position whose caret is on that line. */
function resolveLinePos(editor: Editor, view: EditorView, i: number, k: number, blockPos: number): number | null {
  const data = runtime(editor).lines.get(i)?.[k];
  if (!data || data.tbOff < 0) return null;
  const tbPos = blockPos + data.tbOff;
  if (data.first) return tbPos + 1;
  const dom = view.nodeDOM(blockPos) as HTMLElement | null;
  const tb = view.state.doc.nodeAt(tbPos);
  if (!dom || !tb) return null;
  const root = view.dom as HTMLElement;
  const scale = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth || 1 : 1;
  const top = dom.getBoundingClientRect().top;
  const spacers = innerSpacers(dom);
  // The line's current client top: natural offset plus our spacers above.
  let y = top + data.textTop * scale;
  let nat = 0;
  for (const s of spacers) {
    const sNat = (s.top - top) / scale - nat;
    if (sNat <= data.textTop + 0.5) {
      y += s.h;
      nat += s.h / scale;
    }
  }
  let lo = tbPos + 1;
  let hi = tbPos + 1 + tb.content.size;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let t: number;
    try {
      t = view.coordsAtPos(mid, 1).top;
    } catch {
      return null;
    }
    if (t >= y - 2) hi = mid;
    else lo = mid + 1;
  }
  return lo > tbPos + 1 ? lo : null;
}

// --- decorations -----------------------------------------------------------------------------

export function baseGeom(dl: DocLayout): BaseGeom {
  const pages = dl.layout.pages;
  const maxW = Math.max(...pages.map((p) => p.spec.w));
  const p0 = pages[0];
  const x0 = (maxW - p0.spec.w) / 2;
  return {
    maxW,
    left: x0 + p0.textLeft,
    width: contentWidth(dl.sections[p0.section]?.props ?? dl.sections[0].props) * dl.unit,
    top: p0.top + p0.spec.top,
  };
}

function spacerEl(cls: string, h: number, mt = 0): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  el.contentEditable = "false";
  el.style.height = `${h}px`;
  if (mt) el.style.marginTop = `${mt}px`;
  return el;
}

/** buildDecorations realises a layout (see the file comment). `posOf`
 *  gives where line/row `k` of block `i` starts. */
export function buildDecorations(
  dl: DocLayout,
  doc: PMNode,
  base: BaseGeom,
  posOf: (i: number, k: number) => number | null,
): Decoration[] {
  const out: Decoration[] = [];
  const { layout, measured } = dl;
  let flowBottom = base.top;
  let prevMb = 0;
  let first = true;
  for (let i = 0; i < measured.boxes.length && i < doc.childCount; i++) {
    const box = measured.boxes[i];
    const pieces = layout.blocks[i];
    const node = doc.child(i);
    const pos = measured.blockPos[i];
    if (!pieces?.length) continue;
    const p0 = pieces[0];
    const page = layout.pages[p0.page];
    const F = first ? flowBottom + box.mt : flowBottom + collapse(prevMb, box.mt);
    let blockTop = F;
    let dy = 0;
    if (p0.col === 0) {
      if (Math.abs(p0.top - F) > 0.5) {
        const D = p0.top - flowBottom - (first ? 0 : prevMb) - box.mt;
        const h = Math.max(1, D);
        const mt = Math.min(0, D - 1);
        const key = `pg-b${i}-${Math.round(h)}-${Math.round(mt)}`;
        out.push(Decoration.widget(pos, () => spacerEl("pg-spacer pg-break", h, mt), { side: -1, key, ignoreSelection: true }));
        blockTop = p0.top;
      }
    } else dy = p0.top - F;
    // Horizontal placement.
    const x = (base.maxW - page.spec.w) / 2 + page.textLeft + (page.spec.cols[p0.col]?.x ?? 0);
    const w = page.spec.cols[p0.col]?.w ?? base.width;
    const dx = x - base.left;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(w - base.width) > 0.5) {
      const ir = typeof node.attrs.indentRight === "number" ? (node.attrs.indentRight as number) * PX_PER_PT : 0;
      const style = `translate: ${dx.toFixed(2)}px ${dy.toFixed(2)}px; margin-right: ${(base.width - w + ir).toFixed(2)}px`;
      out.push(Decoration.node(pos, pos + node.nodeSize, { style, class: "pg-shift" }));
    }
    // Pieces after the first: spacers inside the block.
    let inner = 0;
    const H = box.kind === "flow" ? box.lines.reduce((a, b) => a + b, 0) : box.top + box.rows.reduce((a, r) => a + r.h, 0) + box.bottom;
    for (let k = 1; k < pieces.length; k++) {
      const p = pieces[k];
      if (box.kind === "flow") {
        const off = box.lines.slice(0, p.from).reduce((a, b) => a + b, 0);
        const S = p.top - (blockTop + off + inner);
        const at = posOf(i, p.from);
        if (at == null || S < 0.5) continue;
        const key = `pg-l${i}-${k}-${Math.round(S)}`;
        out.push(Decoration.widget(at, () => {
          const el = document.createElement("span");
          el.className = "pg-spacer pg-inner pg-line";
          el.contentEditable = "false";
          el.style.display = "block";
          el.style.height = `${S}px`;
          return el;
        }, { side: -1, key, ignoreSelection: true }));
        inner += S;
      } else {
        const off = box.top + box.rows.slice(0, p.from).reduce((a, r) => a + r.h, 0) - (p.rowOffset ?? 0);
        const S = p.top - (blockTop + off + inner);
        const at = posOf(i, p.from);
        if (at == null || S < 0.5) continue;
        const cols = Math.max(1, node.firstChild?.childCount ?? 1);
        const key = `pg-r${i}-${k}-${Math.round(S)}`;
        out.push(Decoration.widget(at, () => {
          const tr = document.createElement("tr");
          tr.className = "pg-spacer pg-inner pg-row";
          tr.contentEditable = "false";
          const td = document.createElement("td");
          td.colSpan = cols;
          td.style.cssText = `height:${S}px;padding:0;border:none;background:transparent`;
          tr.appendChild(td);
          return tr;
        }, { side: -2, key, ignoreSelection: true }));
        inner += S;
        for (const h of p.headerRows ?? []) {
          const hk = `pg-h${i}-${k}-${h}`;
          out.push(Decoration.widget(at, (view, getPos) => {
            const wpos = getPos() ?? at;
            const $p = view.state.doc.resolve(wpos);
            let rowPos = $p.start();
            for (let r = 0; r < h; r++) rowPos += $p.parent.child(r).nodeSize;
            const src = view.nodeDOM(rowPos) as HTMLElement | null;
            const clone = (src?.cloneNode(true) as HTMLElement) ?? document.createElement("tr");
            clone.classList.add("pg-inner", "pg-repeat");
            clone.removeAttribute("data-repeat-header");
            clone.contentEditable = "false";
            return clone;
          }, { side: -1, key: hk, ignoreSelection: true }));
        }
        inner += p.headerHeight ?? 0;
      }
    }
    flowBottom = blockTop + H + inner;
    prevMb = box.mb;
    first = false;
  }
  return out;
}

// --- running a layout pass -------------------------------------------------------------------

function firstChanged(prev: Box[] | null, next: Box[]): number {
  if (!prev) return 0;
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) if (prev[i] !== next[i] && JSON.stringify(prev[i]) !== JSON.stringify(next[i])) return i;
  return prev.length === next.length ? next.length : n;
}

function computeLayout(editor: Editor, doc: PMNode, settings: DocSettings, measured: MeasuredDoc, unit: number, splitRows: boolean): DocLayout {
  const r = runtime(editor);
  const sections = sectionsOf(doc, settings.section);
  const specs = sectionSpecs(sections, unit);
  const prev = paginationState(editor)?.dl?.layout ?? null;
  const changed = firstChanged(r.prevBoxes, measured.boxes);
  let layout: Layout;
  if (prev && changed >= measured.boxes.length && prev.blocks.length === measured.boxes.length && JSON.stringify(prev.sections) === JSON.stringify(specs)) layout = prev;
  else layout = paginate(measured.boxes, specs, { gap: PAGE_GAP * (unit / PX_PER_PT), mirror: settings.mirror, splitRows }, prev, changed);
  r.prevBoxes = measured.boxes;
  return { layout, sections, measured, settings, unit };
}

/** Model mode: layout from the document alone (grid metrics). */
function modelLayout(editor: Editor, doc: PMNode, settings: DocSettings, m: TextMeasurer): { dl: DocLayout; base: BaseGeom; decos: Decoration[] } {
  const unit = 1;
  const sections = sectionsOf(doc, settings.section);
  const measured = modelMeasure(doc, sections, { measurer: m, unit, props: propsFor(editor) });
  const dl = computeLayout(editor, doc, settings, measured, unit, true);
  const base = baseGeom(dl);
  const decos = buildDecorations(dl, doc, base, (i, k) => measured.itemPos[i]?.[k] ?? null);
  return { dl, base, decos };
}

function notify(editor: Editor) {
  const r = runtime(editor);
  const s = paginationState(editor);
  if (!s) return;
  for (const fn of r.listeners) fn(s);
  const w = r.waiters.splice(0);
  for (const fn of w) fn();
}

/** DOM mode: measure, lay out, decorate, dispatch. */
function runDom(editor: Editor) {
  const r = runtime(editor);
  r.frame = null;
  if (editor.isDestroyed || r.measurer !== "dom") return;
  const view = editor.view;
  const state = view.state;
  const ps = paginationKey.getState(state);
  if (!ps) return;
  const settings = ps.settings;
  const paged = isPaged(editor, settings);
  // Not rendered (hidden, or a DOM without layout such as jsdom).
  if (!(view.dom as HTMLElement).offsetWidth) return;
  let measured: MeasuredDoc;
  try {
    measured = domMeasure(editor, view, state.doc);
  } catch {
    return;
  }
  const dl = computeLayout(editor, state.doc, settings, measured, PX_PER_PT, false);
  const base = baseGeom(dl);
  // Resolve split positions for rows/lines.
  const posOf = (i: number, k: number) => {
    const b = measured.boxes[i];
    if (b.kind === "table") return measured.itemPos[i]?.[k] ?? null;
    const known = measured.itemPos[i]?.[k];
    if (known != null && known >= 0) return known;
    const at = resolveLinePos(editor, view, i, k, measured.blockPos[i]);
    if (at != null && measured.itemPos[i]) measured.itemPos[i][k] = at;
    return at;
  };
  const decos = paged ? buildDecorations(dl, state.doc, base, posOf) : [];
  const deco = DecorationSet.create(state.doc, decos);
  const same = sameDecos(ps.deco, deco, state.doc) && ps.dl?.layout === dl.layout && ps.paged === paged;
  if (same && ps.dl) {
    notifyLater(editor);
    return;
  }
  view.dispatch(state.tr.setMeta(paginationKey, { dl, base, deco, paged } satisfies Meta).setMeta("addToHistory", false));
}

function sameDecos(a: DecorationSet, b: DecorationSet, doc: PMNode): boolean {
  const x = a.find(0, doc.content.size);
  const y = b.find(0, doc.content.size);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const s = x[i] as unknown as { from: number; to: number; spec: { key?: string }; type: { attrs?: Record<string, string> } };
    const t = y[i] as unknown as typeof s;
    if (s.from !== t.from || s.to !== t.to || s.spec.key !== t.spec.key || JSON.stringify(s.type.attrs ?? null) !== JSON.stringify(t.type.attrs ?? null)) return false;
  }
  return true;
}

function notifyLater(editor: Editor) {
  queueMicrotask(() => !editor.isDestroyed && notify(editor));
}

function schedule(editor: Editor) {
  const r = runtime(editor);
  if (r.frame != null || r.destroyed) return;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16) as unknown as number;
  r.frame = raf(() => runDom(editor));
}

/** Page-dependent body fields (PAGE / NUMPAGES / SECTIONPAGES) follow
 *  the layout, as in Word. */
const LIVE_FIELDS = new Set(["PAGE", "NUMPAGES", "SECTIONPAGES"]);

function refreshPageFields(editor: Editor) {
  const r = runtime(editor);
  if (editor.isDestroyed || !editor.isEditable) return;
  let has = false;
  editor.state.doc.descendants((n) => {
    if (has) return false;
    if (n.type.name === "field" && LIVE_FIELDS.has(String(n.attrs.instr).trim().split(/\s+/)[0]?.toUpperCase())) has = true;
    return !has;
  });
  if (!has) return;
  const tr = editor.state.tr;
  updateFieldsTr(editor, tr, { fields: null, tocs: new Set() }, LIVE_FIELDS);
  if (!tr.docChanged) {
    r.fieldRounds = 0;
    return;
  }
  if (++r.fieldRounds > 3) return;
  editor.view.dispatch(tr.setMeta("addToHistory", false).setMeta("pagination-fields", true));
}

// --- the extension ---------------------------------------------------------------------------

export const Pagination = Extension.create({
  name: "pagination",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: () => ({
            dl: null,
            base: null,
            deco: DecorationSet.empty,
            settings: defaultSettings(),
            paged: true,
            version: 0,
          }),
          apply(tr: Transaction, value: PaginationState, _old: EditorState, next: EditorState): PaginationState {
            const meta = tr.getMeta(paginationKey) as Meta | undefined;
            let v = value;
            if (meta) {
              v = {
                ...v,
                ...(meta.settings ? { settings: meta.settings } : {}),
                ...(meta.dl !== undefined ? { dl: meta.dl } : {}),
                ...(meta.base !== undefined ? { base: meta.base } : {}),
                ...(meta.deco ? { deco: meta.deco } : {}),
                ...(meta.paged !== undefined ? { paged: meta.paged } : {}),
                version: v.version + 1,
              };
            }
            const r = runtime(editor);
            if (r.measurer !== "dom" && (tr.docChanged || meta?.settings || meta?.refresh || !v.dl)) {
              const m = modelLayout(editor, next.doc, v.settings, r.measurer);
              return {
                ...v,
                dl: m.dl,
                base: m.base,
                deco: v.paged ? DecorationSet.create(next.doc, m.decos) : DecorationSet.empty,
                version: v.version + 1,
              };
            }
            if (tr.docChanged && !meta?.deco) return { ...v, deco: v.deco.map(tr.mapping, tr.doc) };
            return v;
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.deco ?? DecorationSet.empty,
        },
        view: (view) => {
          const r = runtime(editor);
          r.destroyed = false;
          let unobserve: (() => void) | null = null;
          // Settings from the Yjs map (after the editor's storage exists).
          const pushSettings = () => {
            if (editor.isDestroyed) return;
            const settings = getSettingsFor(editor);
            r.cache = new WeakMap();
            r.prevBoxes = null;
            view.dispatch(
              view.state.tr
                .setMeta(paginationKey, { settings, paged: isPaged(editor, settings) } satisfies Meta)
                .setMeta("addToHistory", false),
            );
            if (r.measurer === "dom") schedule(editor);
          };
          queueMicrotask(() => {
            if (editor.isDestroyed) return;
            try {
              unobserve = settingsStore(editor).observe(pushSettings);
            } catch {
              /* no model */
            }
            pushSettings();
          });
          // Style / list definition changes can change heights.
          let unstyles: (() => void) | null = null;
          queueMicrotask(() => {
            if (editor.isDestroyed) return;
            const model = getDocModel(editor);
            if (!model) return;
            const h = () => requestRefresh(editor, true);
            model.sheet.map.observeDeep(h);
            model.numbering.map.observeDeep(h);
            unstyles = () => {
              model.sheet.map.unobserveDeep(h);
              model.numbering.map.unobserveDeep(h);
            };
          });
          // Images and fonts change heights after rendering.
          const onLoad = (e: Event) => {
            if ((e.target as HTMLElement)?.tagName === "IMG") schedule(editor);
          };
          view.dom.addEventListener("load", onLoad, true);
          const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
          fonts?.ready?.then(() => requestRefresh(editor, true)).catch(() => {});
          // Page numbers for fields from the layout (explicit breaks until
          // the first layout exists).
          setPageResolver(editor, (doc) => {
            const dl = paginationKey.getState(editor.state)?.dl;
            if (!dl) return explicitPages(doc);
            if (doc !== editor.state.doc && r.measurer !== "dom") {
              const m = modelLayout(editor, doc, dl.settings, r.measurer);
              return layoutPageResolver(m.dl);
            }
            return layoutPageResolver(dl);
          });
          setLayoutWaiter(editor, (fn) => afterNextLayout(editor, fn));
          if (r.measurer === "dom") schedule(editor);
          let lastVersion = -1;
          return {
            update(v, prev) {
              const s = paginationKey.getState(v.state);
              if (r.measurer === "dom" && (v.state.doc !== prev.doc || s?.settings !== paginationKey.getState(prev)?.settings)) schedule(editor);
              if (s && s.version !== lastVersion && s.dl && s.dl !== paginationKey.getState(prev)?.dl) {
                lastVersion = s.version;
                notifyLater(editor);
                queueMicrotask(() => refreshPageFields(editor));
              }
            },
            destroy() {
              r.destroyed = true;
              if (r.frame != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(r.frame);
              r.frame = null;
              unobserve?.();
              unstyles?.();
              view.dom.removeEventListener("load", onLoad, true);
              setPageResolver(editor, null);
              setLayoutWaiter(editor, null);
            },
          };
        },
      }),
    ];
  },
});

/** Section index of each top-level block in the current layout. */
export function layoutBlockSections(dl: DocLayout): number[] {
  return blockSections(dl.sections);
}
