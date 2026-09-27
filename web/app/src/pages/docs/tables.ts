// Tables (Docs M4): additive attributes on TipTap's table nodes, a table
// node view that renders them, the bad-table normaliser on paste, and the
// table commands behind the Table menu, the size picker and the Table
// properties dialog.
//
// Attributes (all strings / numbers / booleans, see tableModel.ts):
//   table   tableStyle (template id), look ("header banded firstCol ..."),
//           borders (JSON per side incl. insideH/insideV), cellMargins
//           ("t r b l" pt), layout ("fixed" | null = autofit), width
//           ("100%" | "<n>pt" | null), align (left | center | right)
//   row     repeatHeader (boolean), height (pt, at least)
//   cell    backgroundColor (existing), borders (JSON per side),
//           verticalAlign (top | middle | bottom), margins ("t r b l" pt)
// Column widths stay TipTap's per-cell `colwidth` (px).
import { Extension, mergeAttributes, type Editor, type JSONContent } from "@tiptap/core";
import Table, { TableView } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { CellSelection, TableMap, isInTable, selectedRect, type TableRect } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import {
  CELL_SIDES,
  NO_BORDER,
  TABLE_SIDES,
  borderCss,
  distributeEvenly,
  encodeLook,
  encodeMargins,
  encodeTableBorders,
  marginsCss,
  normalizeTable,
  parseLook,
  parseMargins,
  parseTableBorders,
  type CellBorderSide,
  type TBorder,
  type TBorders,
  type TableBorderSide,
} from "./tableModel";
import { normaliseColor } from "./textOps";

const PX_PER_PT = 4 / 3;

// --- rendering ------------------------------------------------------------------------

/** tableStyleDecls are the inline declarations for a table's direct
 *  properties (shared by the node view and renderHTML). */
export function tableStyleDecls(a: Record<string, unknown>): Record<string, string> {
  const d: Record<string, string> = {};
  const b = parseTableBorders(a.borders);
  for (const side of TABLE_SIDES) if (b[side]) d[`--tbl-${side}`] = borderCss(b[side]!);
  const m = parseMargins(a.cellMargins);
  if (m) d["--tbl-pad"] = marginsCss(m);
  if (a.layout === "fixed") d["table-layout"] = "fixed";
  if (a.width === "100%") d.width = "100%";
  else if (typeof a.width === "string" && /^[\d.]+pt$/.test(a.width)) d.width = a.width;
  if (a.align === "center") {
    d["margin-left"] = "auto";
    d["margin-right"] = "auto";
  } else if (a.align === "right") {
    d["margin-left"] = "auto";
    d["margin-right"] = "0";
  }
  return d;
}

const declString = (d: Record<string, string>) =>
  Object.entries(d)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

/** pmColumnWidths is the fixed-layout grid of a table node: per column
 *  the widest `colwidth` any cell gives it, or null. */
export function pmColumnWidths(node: PMNode): (number | null)[] {
  const map = TableMap.get(node);
  const out: (number | null)[] = Array(map.width).fill(null);
  const seen = new Set<number>();
  for (const pos of map.map) {
    if (seen.has(pos)) continue;
    seen.add(pos);
    const cell = node.nodeAt(pos)!;
    const rect = map.findCell(pos);
    const cw = cell.attrs.colwidth as number[] | null;
    if (!cw) continue;
    for (let j = 0; j < rect.right - rect.left; j++) {
      const w = cw[j];
      if (w > 0) out[rect.left + j] = Math.max(out[rect.left + j] ?? 0, w);
    }
  }
  return out;
}

/** GrownTableView is TipTap's resizable table view plus the M4 table
 *  attributes, with the column grid taken from every row. */
export class GrownTableView extends TableView {
  applied = new Set<string>();

  constructor(node: PMNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    this.apply(node);
  }

  update(node: PMNode): boolean {
    if (!super.update(node)) return false;
    this.apply(node);
    return true;
  }

  apply(node: PMNode) {
    const t = this.table;
    const a = node.attrs;
    const setData = (k: string, v: string | null) => (v == null ? t.removeAttribute(k) : t.setAttribute(k, v));
    setData("data-table-style", (a.tableStyle as string) || null);
    setData("data-look", a.tableStyle ? encodeLook(parseLook(a.look)) : null);
    // Columns: the widest width per column across rows (the first row
    // alone is what TipTap uses).
    const widths = pmColumnWidths(node);
    const cols = Array.from(this.colgroup.children) as HTMLElement[];
    let total = 0;
    let all = widths.length > 0;
    widths.forEach((w, i) => {
      if (!cols[i]) return;
      if (w) {
        cols[i].style.width = `${w}px`;
        cols[i].style.minWidth = "";
        total += w;
      } else {
        all = false;
        total += this.cellMinWidth;
      }
    });
    if (all) {
      t.style.width = `${total}px`;
      t.style.minWidth = "";
    } else {
      t.style.width = "";
      t.style.minWidth = `${total}px`;
    }
    const d = tableStyleDecls(a);
    for (const k of this.applied) if (!(k in d)) t.style.removeProperty(k);
    for (const [k, v] of Object.entries(d)) t.style.setProperty(k, v);
    if (d.width) t.style.minWidth = "";
    this.applied = new Set(Object.keys(d));
  }
}

// --- node extensions -----------------------------------------------------------------------

const strAttr = (name: string, data: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(data) || null,
  renderHTML: (attrs: Record<string, unknown>) => (attrs[name] != null && attrs[name] !== "" ? { [data]: String(attrs[name]) } : {}),
});

export const GrownTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableStyle: strAttr("tableStyle", "data-table-style"),
      look: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-look"),
        renderHTML: (a: Record<string, unknown>) => (a.tableStyle ? { "data-look": encodeLook(parseLook(a.look)) } : {}),
      },
      borders: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-borders") || null,
        renderHTML: (a: Record<string, unknown>) => (a.borders ? { "data-borders": String(a.borders) } : {}),
      },
      cellMargins: strAttr("cellMargins", "data-cell-margins"),
      layout: strAttr("layout", "data-layout"),
      width: strAttr("width", "data-width"),
      align: strAttr("align", "data-align"),
    };
  },
  // Inline CSS for the direct properties in HTML output (export and
  // clipboard); the editor itself renders through GrownTableView.
  renderHTML({ node, HTMLAttributes }) {
    const s = declString(tableStyleDecls(node.attrs));
    return this.parent!({ node, HTMLAttributes: s ? mergeAttributes(HTMLAttributes, { style: s }) : HTMLAttributes });
  },
});

export const GrownTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      repeatHeader: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute("data-repeat-header"),
        renderHTML: (a: Record<string, unknown>) => (a.repeatHeader ? { "data-repeat-header": "true" } : {}),
      },
      height: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = parseFloat(el.getAttribute("data-height") ?? "");
          return Number.isFinite(v) && v > 0 ? v : null;
        },
        renderHTML: (a: Record<string, unknown>) =>
          a.height ? { "data-height": String(a.height), style: `height: ${a.height}pt` } : {},
      },
    };
  },
});

/** cellBordersFromStyle reads border-* declarations of pasted HTML. */
function cellBordersFromStyle(el: HTMLElement): string | null {
  const out: TBorders = {};
  for (const side of CELL_SIDES) {
    const cap = side[0].toUpperCase() + side.slice(1);
    const st = el.style.getPropertyValue(`border-${side}-style`) || (el.style as unknown as Record<string, string>)[`border${cap}Style`];
    if (!st) continue;
    if (st === "none" || st === "hidden") {
      out[side] = { ...NO_BORDER };
      continue;
    }
    const wRaw = el.style.getPropertyValue(`border-${side}-width`);
    const m = /^([\d.]+)(px|pt)?$/.exec(wRaw.trim());
    const width = m ? (m[2] === "px" ? parseFloat(m[1]) * 0.75 : parseFloat(m[1])) : 0.75;
    const style = (["solid", "dashed", "dotted", "double"] as const).find((s) => s === st) ?? "solid";
    out[side] = { width: Math.round(width * 100) / 100, style, color: el.style.getPropertyValue(`border-${side}-color`) || "#000000" };
  }
  return encodeTableBorders(out);
}

function withCellProps<T extends { extend: (c: object) => unknown }>(base: T) {
  return (base.extend as (c: object) => unknown)({
    addAttributes(this: { parent?: () => object }) {
      return {
        ...(this.parent?.() || {}),
        backgroundColor: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
          renderHTML: (attrs: { backgroundColor?: string }) =>
            attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
        },
        borders: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-borders") || cellBordersFromStyle(el),
          renderHTML: (a: { borders?: string | null }) => {
            if (!a.borders) return {};
            const b = parseTableBorders(a.borders);
            const css = CELL_SIDES.filter((s) => b[s]).map((s) => `border-${s}: ${borderCss(b[s]!, "hidden")}`);
            return { "data-borders": a.borders, style: css.join("; ") };
          },
        },
        verticalAlign: {
          default: null,
          parseHTML: (el: HTMLElement) => {
            const v = el.style.verticalAlign || el.getAttribute("valign") || "";
            return v === "middle" || v === "center" ? "middle" : v === "bottom" ? "bottom" : v === "top" ? "top" : null;
          },
          renderHTML: (a: { verticalAlign?: string | null }) =>
            a.verticalAlign ? { style: `vertical-align: ${a.verticalAlign}` } : {},
        },
        margins: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-margins") || null,
          renderHTML: (a: { margins?: string | null }) => {
            const m = parseMargins(a.margins);
            return m ? { "data-margins": a.margins, style: `padding: ${marginsCss(m)}` } : {};
          },
        },
      };
    },
  });
}

export const GrownTableCell = withCellProps(TableCell) as typeof TableCell;
export const GrownTableHeader = withCellProps(TableHeader) as typeof TableHeader;

// --- paste normaliser ---------------------------------------------------------------------

/** normalizeFragmentTables repairs tables in a fragment (see
 *  normalizeTable). Tables on an open edge of a slice (a partial table
 *  copied from inside another one) are left to prosemirror-tables. */
export function normalizeFragmentTables(frag: Fragment, schema: Schema, openStart = 0, openEnd = 0): Fragment {
  const out: PMNode[] = [];
  frag.forEach((node, _, i) => {
    const edge = (i === 0 && openStart > 0) || (i === frag.childCount - 1 && openEnd > 0);
    if (node.type.name === "table" && !edge) {
      const r = normalizeTable(node.toJSON() as JSONContent);
      if (!r.table) return;
      out.push(r.fixes.length ? schema.nodeFromJSON(r.table) : node);
      return;
    }
    if (node.isTextblock || node.isLeaf) {
      out.push(node);
      return;
    }
    const inner = normalizeFragmentTables(node.content, schema, i === 0 ? Math.max(0, openStart - 1) : 0, i === frag.childCount - 1 ? Math.max(0, openEnd - 1) : 0);
    out.push(inner === node.content ? node : node.copy(inner));
  });
  return Fragment.fromArray(out);
}

export const TableTools = Extension.create({
  name: "tableTools",
  addProseMirrorPlugins() {
    const schema = this.editor.schema;
    return [
      new Plugin({
        key: new PluginKey("tableNormalizer"),
        props: {
          transformPasted: (slice: Slice) =>
            new Slice(normalizeFragmentTables(slice.content, schema, slice.openStart, slice.openEnd), slice.openStart, slice.openEnd),
        },
      }),
    ];
  },
});

// --- commands ------------------------------------------------------------------------------

export interface TableCtx {
  table: PMNode;
  /** Position of the table node. */
  pos: number;
  rect: TableRect;
  map: TableMap;
  /** A cell selection (vs a caret in one cell). */
  cells: boolean;
}

export function tableCtx(state: EditorState): TableCtx | null {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  return { table: rect.table, pos: rect.tableStart - 1, rect, map: rect.map, cells: state.selection instanceof CellSelection };
}

/** Unique cell positions (relative to the table start) in a rect. */
function cellsIn(map: TableMap, r: { left: number; right: number; top: number; bottom: number }): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let row = r.top; row < r.bottom; row++)
    for (let col = r.left; col < r.right; col++) {
      const p = map.map[row * map.width + col];
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  return out;
}

/** currentTableAttrs of the table at the selection (null outside one). */
export function currentTableAttrs(editor: Editor): Record<string, unknown> | null {
  return tableCtx(editor.state)?.table.attrs ?? null;
}

/** currentCellAttrs of the cell the selection starts in. */
export function currentCellAttrs(editor: Editor): Record<string, unknown> | null {
  const c = tableCtx(editor.state);
  if (!c) return null;
  const pos = c.map.map[c.rect.top * c.map.width + c.rect.left];
  return c.table.nodeAt(pos)?.attrs ?? null;
}

export function currentRowAttrs(editor: Editor): Record<string, unknown> | null {
  const c = tableCtx(editor.state);
  return c ? c.table.child(c.rect.top).attrs : null;
}

/** setTableProps merges attributes into the table at the selection. */
export function setTableProps(editor: Editor, attrs: Record<string, unknown>): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const tr = editor.state.tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, ...attrs });
  editor.view.dispatch(tr);
  return true;
}

/** setCellProps merges attributes into every selected cell (or the cell
 *  holding the caret). */
export function setCellProps(editor: Editor, attrs: Record<string, unknown>): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const start = c.pos + 1;
  const tr = editor.state.tr;
  for (const p of cellsIn(c.map, c.rect)) {
    const cell = c.table.nodeAt(p)!;
    tr.setNodeMarkup(start + p, undefined, { ...cell.attrs, ...attrs });
  }
  editor.view.dispatch(tr);
  return true;
}

/** Positions of the table's rows (absolute). */
function rowPositions(table: PMNode, tablePos: number): number[] {
  const out: number[] = [];
  table.forEach((_, off) => out.push(tablePos + 1 + off));
  return out;
}

/** setRowProps merges attributes into the selected rows. */
export function setRowProps(editor: Editor, attrs: Record<string, unknown>, rows?: [number, number]): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const [top, bottom] = rows ?? [c.rect.top, c.rect.bottom];
  const tr = editor.state.tr;
  const pos = rowPositions(c.table, c.pos);
  for (let r = top; r < bottom; r++) tr.setNodeMarkup(pos[r], undefined, { ...c.table.child(r).attrs, ...attrs });
  editor.view.dispatch(tr);
  return true;
}

export type BorderPreset =
  | "all"
  | "outer"
  | "inner"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "insideH"
  | "insideV"
  | "none";

export const BORDER_PRESETS: { id: BorderPreset; label: string }[] = [
  { id: "all", label: "All borders" },
  { id: "outer", label: "Outer borders" },
  { id: "inner", label: "Inner borders" },
  { id: "top", label: "Top border" },
  { id: "bottom", label: "Bottom border" },
  { id: "left", label: "Left border" },
  { id: "right", label: "Right border" },
  { id: "insideH", label: "Inner horizontal" },
  { id: "insideV", label: "Inner vertical" },
  { id: "none", label: "No borders" },
];

/** Which table sides a preset sets. */
export function presetTableSides(p: BorderPreset): TableBorderSide[] {
  switch (p) {
    case "all":
    case "none":
      return TABLE_SIDES;
    case "outer":
      return ["top", "left", "bottom", "right"];
    case "inner":
      return ["insideH", "insideV"];
    default:
      return [p];
  }
}

/** setTableBorders applies a preset to the whole table's borders. */
export function setTableBorders(editor: Editor, preset: BorderPreset, border: TBorder): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const b = parseTableBorders(c.table.attrs.borders);
  for (const side of presetTableSides(preset)) b[side] = preset === "none" ? { ...NO_BORDER } : { ...border };
  return setTableProps(editor, { borders: encodeTableBorders(b) });
}

/** applyCellBorders applies a preset to the selected cells, Word style:
 *  "outer" means the outline of the selection, "inner" the lines between
 *  selected cells. With a caret the selection is that one cell. */
export function applyCellBorders(editor: Editor, preset: BorderPreset, border: TBorder): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const start = c.pos + 1;
  const tr = editor.state.tr;
  const R = c.rect;
  for (const p of cellsIn(c.map, R)) {
    const cell = c.table.nodeAt(p)!;
    const cr = c.map.findCell(p);
    const outer: Record<CellBorderSide, boolean> = {
      top: cr.top <= R.top,
      bottom: cr.bottom >= R.bottom,
      left: cr.left <= R.left,
      right: cr.right >= R.right,
    };
    const want = (side: CellBorderSide): boolean => {
      const h = side === "top" || side === "bottom";
      switch (preset) {
        case "all":
        case "none":
          return true;
        case "outer":
          return outer[side];
        case "inner":
          return !outer[side];
        case "insideH":
          return h && !outer[side];
        case "insideV":
          return !h && !outer[side];
        default:
          return side === preset && outer[side];
      }
    };
    const b = parseTableBorders(cell.attrs.borders);
    let changed = false;
    for (const side of CELL_SIDES)
      if (want(side)) {
        b[side] = preset === "none" ? { ...NO_BORDER } : { ...border };
        changed = true;
      }
    if (changed) tr.setNodeMarkup(start + p, undefined, { ...cell.attrs, borders: encodeTableBorders(b) });
  }
  editor.view.dispatch(tr);
  return true;
}

/** clearCellBorders removes direct borders from the selected cells. */
export function clearCellBorders(editor: Editor): boolean {
  return setCellProps(editor, { borders: null });
}

/** measureColumns returns the table's column widths in px: explicit
 *  widths where set, otherwise the rendered width (or 100px headless). */
export function measureColumns(view: EditorView, tablePos: number): number[] {
  const table = view.state.doc.nodeAt(tablePos)!;
  const known = pmColumnWidths(table);
  const dom = view.nodeDOM(tablePos) as HTMLElement | null;
  const el = dom?.tagName === "TABLE" ? dom : dom?.querySelector?.("table");
  const measured: number[] = [];
  if (el) {
    const map = TableMap.get(table);
    const rows = Array.from(el.querySelectorAll(":scope > tbody > tr")) as HTMLTableRowElement[];
    // Single-column cells give exact column widths.
    for (let r = 0; r < map.height && r < rows.length; r++) {
      const tds = Array.from(rows[r].children) as HTMLElement[];
      const starts: number[] = [];
      for (let col = 0; col < map.width; col++) {
        const p = map.map[r * map.width + col];
        const rect = map.findCell(p);
        if (rect.top === r && rect.left === col) starts.push(p);
      }
      starts.forEach((p, i) => {
        const rect = map.findCell(p);
        const w = tds[i]?.getBoundingClientRect().width ?? 0;
        if (rect.right - rect.left === 1 && w > 0 && !measured[rect.left]) measured[rect.left] = Math.round(w);
      });
    }
  }
  return known.map((w, i) => w ?? measured[i] ?? 100);
}

/** setColumnWidths sets `colwidth` for grid columns [from, from+widths). */
function setColumnWidths(editor: Editor, c: TableCtx, from: number, widths: number[], base: number[]) {
  const start = c.pos + 1;
  const tr = editor.state.tr;
  const all = cellsIn(c.map, { left: 0, right: c.map.width, top: 0, bottom: c.map.height });
  for (const p of all) {
    const rect = c.map.findCell(p);
    if (rect.right <= from || rect.left >= from + widths.length) continue;
    const cell = c.table.nodeAt(p)!;
    const cw = Array.from({ length: rect.right - rect.left }, (_, j) => {
      const col = rect.left + j;
      if (col >= from && col < from + widths.length) return widths[col - from];
      return (cell.attrs.colwidth as number[] | null)?.[j] ?? base[col];
    });
    tr.setNodeMarkup(start + p, undefined, { ...cell.attrs, colwidth: cw });
  }
  editor.view.dispatch(tr);
}

/** setColumnWidth sets the selected columns to `px` wide. */
export function setColumnWidth(editor: Editor, px: number): boolean {
  const c = tableCtx(editor.state);
  if (!c || !(px > 0)) return false;
  const base = measureColumns(editor.view, c.pos);
  const n = c.rect.right - c.rect.left;
  setColumnWidths(editor, c, c.rect.left, Array(n).fill(Math.round(px)), base);
  return true;
}

/** setRowHeight sets the selected rows' minimum height (pt; null = auto). */
export function setRowHeight(editor: Editor, pt: number | null): boolean {
  return setRowProps(editor, { height: pt && pt > 0 ? Math.round(pt * 100) / 100 : null });
}

/** distributeColumns gives the selected columns (all columns with a caret)
 *  equal widths that keep their total. */
export function distributeColumns(editor: Editor, measure = measureColumns): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const [left, right] = c.cells ? [c.rect.left, c.rect.right] : [0, c.map.width];
  if (right - left < 2) return false;
  const base = measure(editor.view, c.pos);
  const total = base.slice(left, right).reduce((a, b) => a + b, 0);
  setColumnWidths(editor, c, left, distributeEvenly(Math.round(total), right - left), base);
  return true;
}

/** measureRows returns rendered row heights in pt (0 headless). */
export function measureRows(view: EditorView, tablePos: number): number[] {
  const table = view.state.doc.nodeAt(tablePos)!;
  const dom = view.nodeDOM(tablePos) as HTMLElement | null;
  const el = dom?.tagName === "TABLE" ? dom : dom?.querySelector?.("table");
  const rows = el ? (Array.from(el.querySelectorAll(":scope > tbody > tr")) as HTMLElement[]) : [];
  return Array.from({ length: table.childCount }, (_, i) => {
    const h = rows[i]?.getBoundingClientRect().height ?? 0;
    return h > 0 ? Math.round((h / PX_PER_PT) * 100) / 100 : ((table.child(i).attrs.height as number | null) ?? 0);
  });
}

/** distributeRows gives the selected rows (all rows with a caret) the
 *  same height: their average. */
export function distributeRows(editor: Editor, measure = measureRows): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const [top, bottom] = c.cells ? [c.rect.top, c.rect.bottom] : [0, c.map.height];
  if (bottom - top < 2) return false;
  const hs = measure(editor.view, c.pos).slice(top, bottom);
  const avg = hs.reduce((a, b) => a + b, 0) / hs.length;
  if (!(avg > 0)) return false;
  return setRowProps(editor, { height: Math.round(avg * 100) / 100 }, [top, bottom]);
}

export type AutofitMode = "contents" | "window" | "fixed";

/** autofitTable: "contents" sizes columns to their text, "window" to the
 *  page width, "fixed" freezes the current widths (fixed layout). */
export function autofitTable(editor: Editor, mode: AutofitMode): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const start = c.pos + 1;
  if (mode === "fixed") {
    const base = measureColumns(editor.view, c.pos);
    setColumnWidths(editor, c, 0, base, base);
    return setTableProps(editor, { layout: "fixed", width: null });
  }
  const tr = editor.state.tr;
  for (const p of cellsIn(c.map, { left: 0, right: c.map.width, top: 0, bottom: c.map.height })) {
    const cell = c.table.nodeAt(p)!;
    if (cell.attrs.colwidth) tr.setNodeMarkup(start + p, undefined, { ...cell.attrs, colwidth: null });
  }
  tr.setNodeMarkup(c.pos, undefined, { ...c.table.attrs, layout: null, width: mode === "window" ? "100%" : null });
  editor.view.dispatch(tr);
  return true;
}

/** toggleRepeatHeader: turning it on marks every row from the top to the
 *  selection as a header row repeated on each page; turning it off
 *  clears it from the selected row down. */
export function toggleRepeatHeader(editor: Editor): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const on = !c.table.child(c.rect.top).attrs.repeatHeader;
  if (on) return setRowProps(editor, { repeatHeader: true }, [0, c.rect.bottom]);
  return setRowProps(editor, { repeatHeader: false }, [c.rect.top, c.map.height]);
}

/** splitTable splits the table above the selected row, with an empty
 *  paragraph between the halves. Cells merged across the split are cut in
 *  two (the lower part is empty). At the first row the paragraph goes
 *  before the table. */
export function splitTable(editor: Editor): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const { schema } = editor.state;
  const at = c.rect.top;
  const para = schema.nodes.paragraph.create();
  if (at === 0) {
    const tr = editor.state.tr.insert(c.pos, para);
    tr.setSelection(TextSelection.create(tr.doc, c.pos + 1));
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  }
  const { table, map } = c;
  const top: PMNode[] = [];
  for (let r = 0; r < at; r++) {
    const row = table.child(r);
    const cells: PMNode[] = [];
    row.forEach((cell, off) => {
      const rect = map.findCell(rowOffset(table, r) + off);
      cells.push(rect.bottom > at ? cell.type.create({ ...cell.attrs, rowspan: at - rect.top }, cell.content, cell.marks) : cell);
    });
    top.push(row.copy(Fragment.fromArray(cells)));
  }
  const bottom: PMNode[] = [];
  for (let r = at; r < map.height; r++) {
    const row = table.child(r);
    if (r > at) {
      bottom.push(row);
      continue;
    }
    // The first lower row gains a cell for every merge coming from above.
    const cells: PMNode[] = [];
    for (let col = 0; col < map.width; ) {
      const p = map.map[r * map.width + col];
      const rect = map.findCell(p);
      const cell = table.nodeAt(p)!;
      if (rect.top < r) {
        cells.push(cell.type.createAndFill({ ...cell.attrs, rowspan: rect.bottom - r })!);
      } else cells.push(cell);
      col = rect.right;
    }
    bottom.push(row.copy(Fragment.fromArray(cells)));
  }
  const attrs = table.attrs;
  const t1 = table.type.create(attrs, top);
  const t2 = table.type.create(attrs, bottom);
  const tr = editor.state.tr.replaceWith(c.pos, c.pos + table.nodeSize, [t1, para, t2]);
  tr.setSelection(TextSelection.create(tr.doc, c.pos + t1.nodeSize + 1));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function rowOffset(table: PMNode, r: number): number {
  let off = 0;
  for (let i = 0; i < r; i++) off += table.child(i).nodeSize;
  return off + 1;
}

export type TextSeparator = "tab" | "comma" | "semicolon" | "paragraph" | { custom: string };

const SEP: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";" };

/** splitInline splits a textblock's inline content at a separator,
 *  keeping marks. */
function splitInline(block: PMNode, sep: string): Fragment[] {
  const out: PMNode[][] = [[]];
  block.forEach((child) => {
    if (!child.isText || !sep) {
      out[out.length - 1].push(child);
      return;
    }
    const parts = child.text!.split(sep);
    parts.forEach((t, i) => {
      if (i > 0) out.push([]);
      if (t) out[out.length - 1].push(child.type.schema.text(t, child.marks));
    });
  });
  return out.map((nodes) => Fragment.fromArray(nodes));
}

/** textToTable turns the selected paragraphs into a table: one row per
 *  paragraph split at the separator, or with "paragraph" one cell per
 *  paragraph in `cols` columns. Ragged rows are padded. */
export function textToTable(editor: Editor, separator: TextSeparator = "tab", cols = 1): boolean {
  const { state } = editor;
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false;
  const { schema } = state;
  const blocks: PMNode[] = [];
  for (let i = range.startIndex; i < range.endIndex; i++) blocks.push(range.parent.child(i));
  if (!blocks.length) return false;
  const para = (content: Fragment, like?: PMNode) =>
    schema.nodes.paragraph.create(like?.type === schema.nodes.paragraph ? like.attrs : null, content);
  const rows: PMNode[][] = [];
  if (separator === "paragraph") {
    const n = Math.max(1, cols);
    blocks.forEach((b, i) => {
      if (i % n === 0) rows.push([]);
      rows[rows.length - 1].push(b.isTextblock ? para(b.content, b) : b);
    });
  } else {
    const sep = typeof separator === "string" ? SEP[separator] : separator.custom;
    for (const b of blocks) rows.push(b.isTextblock ? splitInline(b, sep).map((f) => para(f, b)) : [b]);
  }
  const json: JSONContent = {
    type: "table",
    content: rows.map((cells) => ({
      type: "tableRow",
      content: cells.map((p) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p.toJSON()] })),
    })),
  };
  const fixed = normalizeTable(json).table;
  if (!fixed) return false;
  const table = schema.nodeFromJSON(fixed);
  const tr = state.tr.replaceWith(range.start, range.end, table);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.start + 3)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** tableToText replaces the table with one paragraph per row, cells
 *  joined by the separator (tab by default). A cell's paragraphs are
 *  joined by spaces; cells merged from above give empty fields. */
export function tableToText(editor: Editor, separator: TextSeparator = "tab"): boolean {
  const c = tableCtx(editor.state);
  if (!c) return false;
  const { schema } = editor.state;
  const sep = separator === "paragraph" ? "\t" : typeof separator === "string" ? SEP[separator] : separator.custom;
  const { table, map } = c;
  const paras: PMNode[] = [];
  for (let r = 0; r < map.height; r++) {
    const parts: PMNode[] = [];
    let first = true;
    for (let col = 0; col < map.width; ) {
      const p = map.map[r * map.width + col];
      const rect = map.findCell(p);
      if (!first && sep) parts.push(schema.text(sep));
      first = false;
      if (rect.top === r) {
        const cell = table.nodeAt(p)!;
        let firstBlock = true;
        cell.descendants((n) => {
          if (!n.isTextblock) return true;
          if (!firstBlock && n.content.size) parts.push(schema.text(" "));
          if (n.content.size) firstBlock = false;
          n.content.forEach((x) => parts.push(x));
          return false;
        });
      }
      col = rect.right;
    }
    paras.push(schema.nodes.paragraph.create(null, parts));
  }
  const tr = editor.state.tr.replaceWith(c.pos, c.pos + table.nodeSize, paras);
  tr.setSelection(TextSelection.near(tr.doc.resolve(c.pos + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** insertTableSized inserts a rows x cols table at the selection. */
export function insertTableSized(editor: Editor, rows: number, cols: number, withHeaderRow = true): boolean {
  return editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
}

/** applyTableStyle sets (or clears, with null) the table's style template. */
export function applyTableStyle(editor: Editor, id: string | null): boolean {
  return setTableProps(editor, { tableStyle: id });
}

/** setLookOption turns one conditional-format switch on or off. */
export function setLookOption(editor: Editor, key: keyof ReturnType<typeof parseLook>, on: boolean): boolean {
  const attrs = currentTableAttrs(editor);
  if (!attrs) return false;
  const look = parseLook(attrs.look);
  look[key] = on;
  return setTableProps(editor, { look: encodeLook(look) });
}

export { encodeMargins };

/** getCellBackground is the shading of the cell at the selection
 *  (#rrggbb), or null. */
export function getCellBackground(editor: Editor): string | null {
  return normaliseColor((currentCellAttrs(editor)?.backgroundColor as string | null) ?? null);
}

/** setCellBackground shades the selected cells (null clears). */
export function setCellBackground(editor: Editor, color: string | null): boolean {
  return setCellProps(editor, { backgroundColor: normaliseColor(color) });
}
