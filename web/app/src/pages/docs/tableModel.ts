// Table model for Docs M4 (pure, no editor): border / margin / look
// encodings stored as node attributes, the table style templates and their
// CSS, the fixed-layout grid resolver, and the bad-table normaliser used on
// paste and import.
//
// Every attribute value is a string, number or boolean so y-prosemirror
// compares them without churn (as the M3 paragraph attributes do).
import type { JSONContent } from "@tiptap/core";

// --- borders ---------------------------------------------------------------------

export type TableBorderSide = "top" | "bottom" | "left" | "right" | "insideH" | "insideV";
export type CellBorderSide = "top" | "bottom" | "left" | "right";
export type TBorderStyle = "solid" | "dashed" | "dotted" | "double" | "none";
export interface TBorder {
  /** Width in points (0 for "none"). */
  width: number;
  style: TBorderStyle;
  color: string;
}
export type TBorders = Partial<Record<TableBorderSide, TBorder>>;

export const TABLE_SIDES: TableBorderSide[] = ["top", "left", "bottom", "right", "insideH", "insideV"];
export const CELL_SIDES: CellBorderSide[] = ["top", "left", "bottom", "right"];
export const NO_BORDER: TBorder = { width: 0, style: "none", color: "#000000" };

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** encodeBorders stores borders as JSON {side: "width style color"}, sides
 *  sorted, or null when there are none. */
export function encodeTableBorders(b: TBorders): string | null {
  const keys = (Object.keys(b) as TableBorderSide[]).filter((k) => b[k]).sort();
  if (!keys.length) return null;
  const o: Record<string, string> = {};
  for (const k of keys) {
    const s = b[k]!;
    o[k] = s.style === "none" ? "none" : `${fmt(s.width)} ${s.style} ${s.color}`;
  }
  return JSON.stringify(o);
}

export function parseTableBorders(raw: unknown): TBorders {
  if (!raw) return {};
  try {
    const o = JSON.parse(String(raw)) as Record<string, string>;
    const out: TBorders = {};
    for (const [k, v] of Object.entries(o)) {
      if (!(TABLE_SIDES as string[]).includes(k)) continue;
      if (v === "none") {
        out[k as TableBorderSide] = { ...NO_BORDER };
        continue;
      }
      const m = /^([\d.]+)\s+(solid|dashed|dotted|double)\s+(\S+)$/.exec(String(v));
      if (m) out[k as TableBorderSide] = { width: parseFloat(m[1]), style: m[2] as TBorderStyle, color: m[3] };
    }
    return out;
  } catch {
    return {};
  }
}

/** borderCss is a CSS border shorthand. `hidden` makes an explicit "none"
 *  win over the neighbour's border in the collapsed model. */
export function borderCss(b: TBorder, noneAs: "none" | "hidden" = "none"): string {
  if (b.style === "none" || b.width <= 0) return noneAs;
  // A double line needs about 3px to show both strokes.
  const w = b.style === "double" ? Math.max(b.width, 2.25) : b.width;
  return `${fmt(w)}pt ${b.style} ${b.color}`;
}

// --- margins ---------------------------------------------------------------------

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Word's default cell margins: 0 top/bottom, 0.08in (5.4pt) left/right. */
export const WORD_CELL_MARGINS: Margins = { top: 0, right: 5.4, bottom: 0, left: 5.4 };

export function encodeMargins(m: Margins | null | undefined): string | null {
  if (!m) return null;
  return [m.top, m.right, m.bottom, m.left].map(fmt).join(" ");
}

export function parseMargins(raw: unknown): Margins | null {
  if (raw == null || raw === "") return null;
  const p = String(raw).trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { top: p[0], right: p[1], bottom: p[2], left: p[3] };
}

export const marginsCss = (m: Margins) => `${fmt(m.top)}pt ${fmt(m.right)}pt ${fmt(m.bottom)}pt ${fmt(m.left)}pt`;

// --- style look (conditional formatting switches) -----------------------------------

export interface TableLook {
  header: boolean;
  banded: boolean;
  firstCol: boolean;
  lastRow: boolean;
  lastCol: boolean;
  bandedCols: boolean;
}
export const LOOK_KEYS: (keyof TableLook)[] = ["header", "banded", "firstCol", "lastRow", "lastCol", "bandedCols"];
/** Word's default for a new table (tblLook 04A0): header row, first
 *  column and banded rows. */
export const DEFAULT_LOOK: TableLook = {
  header: true,
  banded: true,
  firstCol: true,
  lastRow: false,
  lastCol: false,
  bandedCols: false,
};

export function parseLook(raw: unknown): TableLook {
  if (raw == null) return { ...DEFAULT_LOOK };
  const set = new Set(String(raw).split(/\s+/).filter(Boolean));
  const out = {} as TableLook;
  for (const k of LOOK_KEYS) out[k] = set.has(k);
  return out;
}

/** encodeLook lists the switches that are on ("" when none are). */
export function encodeLook(l: TableLook): string {
  return LOOK_KEYS.filter((k) => l[k]).join(" ");
}

// --- style templates ------------------------------------------------------------------

export interface CondFormat {
  fill?: string;
  color?: string;
  bold?: boolean;
  /** Border under the header row / over the total row. */
  edge?: TBorder;
}

export interface TableTemplate {
  /** Word's style id (so a .docx round trip keeps it). */
  id: string;
  /** Word's style name. */
  name: string;
  borders: TBorders;
  header?: CondFormat;
  firstCol?: CondFormat;
  lastRow?: CondFormat;
  lastCol?: CondFormat;
  band?: string;
  bandCol?: string;
}

const line = (color: string, width = 0.5): TBorder => ({ width, style: "solid", color });
const all = (b: TBorder): TBorders => ({ top: b, left: b, bottom: b, right: b, insideH: b, insideV: b });

function gridTable4(n: number, accent: string, light: string, band: string): TableTemplate {
  return {
    id: `GridTable4-Accent${n}`,
    name: `Grid Table 4 Accent ${n}`,
    borders: all(line(light)),
    header: { fill: accent, color: "#ffffff", bold: true, edge: line(accent) },
    firstCol: { bold: true },
    lastRow: { bold: true, edge: line(accent, 1.5) },
    lastCol: { bold: true },
    band,
    bandCol: band,
  };
}

/** The table style gallery. Ids and names are Word's built-in table
 *  styles; colours follow the default Office theme. */
export const TABLE_TEMPLATES: TableTemplate[] = [
  { id: "TableNormal", name: "Normal Table", borders: {} },
  { id: "TableGrid", name: "Table Grid", borders: all(line("#000000")) },
  {
    id: "PlainTable1",
    name: "Plain Table 1",
    borders: all(line("#bfbfbf")),
    header: { bold: true },
    firstCol: { bold: true },
    lastRow: { bold: true, edge: line("#bfbfbf", 1.5) },
    lastCol: { bold: true },
    band: "#f2f2f2",
    bandCol: "#f2f2f2",
  },
  {
    id: "PlainTable3",
    name: "Plain Table 3",
    borders: {},
    header: { bold: true, edge: line("#7f7f7f") },
    firstCol: { bold: true },
    lastRow: { bold: true },
    lastCol: { bold: true },
    band: "#f2f2f2",
    bandCol: "#f2f2f2",
  },
  {
    id: "GridTable1Light",
    name: "Grid Table 1 Light",
    borders: all(line("#bfbfbf")),
    header: { bold: true, edge: line("#999999", 1.5) },
    firstCol: { bold: true },
    lastRow: { bold: true, edge: line("#999999", 1.5) },
    lastCol: { bold: true },
  },
  gridTable4(1, "#4472c4", "#8eaadb", "#d9e2f3"),
  gridTable4(2, "#ed7d31", "#f4b083", "#fbe4d5"),
  gridTable4(6, "#70ad47", "#a8d08d", "#e2efd9"),
  {
    id: "ListTable3-Accent5",
    name: "List Table 3 Accent 5",
    borders: { top: line("#5b9bd5"), left: line("#5b9bd5"), bottom: line("#5b9bd5"), right: line("#5b9bd5") },
    header: { fill: "#5b9bd5", color: "#ffffff", bold: true },
    firstCol: { bold: true },
    lastRow: { bold: true, edge: line("#5b9bd5", 1.5) },
    lastCol: { bold: true },
    band: "#deeaf6",
  },
  {
    id: "GridTable5Dark-Accent1",
    name: "Grid Table 5 Dark Accent 1",
    borders: all(line("#ffffff")),
    header: { fill: "#4472c4", color: "#ffffff", bold: true },
    firstCol: { fill: "#4472c4", color: "#ffffff", bold: true },
    lastRow: { fill: "#4472c4", color: "#ffffff", bold: true },
    lastCol: { fill: "#4472c4", color: "#ffffff", bold: true },
    band: "#b4c6e7",
    bandCol: "#b4c6e7",
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_KEY = new Map<string, TableTemplate>();
for (const t of TABLE_TEMPLATES) {
  BY_KEY.set(norm(t.id), t);
  BY_KEY.set(norm(t.name), t);
}

/** findTemplate matches a template by id or Word name, ignoring case,
 *  spaces and dashes ("Grid Table 4 - Accent 1" = "GridTable4-Accent1"). */
export function findTemplate(idOrName: string | null | undefined): TableTemplate | null {
  if (!idOrName) return null;
  return BY_KEY.get(norm(idOrName)) ?? null;
}

// --- CSS ---------------------------------------------------------------------------

/** Legacy look of a table with no style and no borders. */
const LEGACY_BORDER = "1px solid #ccced1";
const DEFAULT_PAD = "4px 8px";

export type CssRules = Record<string, Record<string, string>>;

/** tableCssRules returns the table CSS as selector -> declarations
 *  (kebab-case). Cells draw every border (the collapsed model) from CSS
 *  variables the table sets: its outside sides on the outer cells, the
 *  inside lines between cells. A template sets the variables and its
 *  conditional formats; direct table borders override the variables
 *  inline, and direct cell borders are inline on the cell. */
export function tableCssRules(scope = ".ProseMirror"): CssRules {
  const t = `${scope} table`;
  const cell = (s: string) => `${t}${s} > tbody > tr > :is(td, th)`;
  const r: CssRules = {};
  r[t] = {
    "--tbl-top": LEGACY_BORDER,
    "--tbl-bottom": LEGACY_BORDER,
    "--tbl-left": LEGACY_BORDER,
    "--tbl-right": LEGACY_BORDER,
    "--tbl-insideH": LEGACY_BORDER,
    "--tbl-insideV": LEGACY_BORDER,
    "--tbl-pad": DEFAULT_PAD,
  };
  r[cell("")] = {
    "border-top": "var(--tbl-insideH)",
    "border-bottom": "var(--tbl-insideH)",
    "border-left": "var(--tbl-insideV)",
    "border-right": "var(--tbl-insideV)",
    padding: "var(--tbl-pad)",
  };
  r[`${t} > tbody > tr:first-child > :is(td, th)`] = { "border-top": "var(--tbl-top)" };
  r[`${t} > tbody > tr:last-child > :is(td, th)`] = { "border-bottom": "var(--tbl-bottom)" };
  r[`${t} > tbody > tr > :is(td, th):first-child`] = { "border-left": "var(--tbl-left)" };
  r[`${t} > tbody > tr > :is(td, th):last-child`] = { "border-right": "var(--tbl-right)" };
  for (const tpl of TABLE_TEMPLATES) {
    const s = `[data-table-style="${tpl.id}"]`;
    const vars: Record<string, string> = {};
    for (const side of TABLE_SIDES) vars[`--tbl-${side}`] = borderCss(tpl.borders[side] ?? NO_BORDER);
    r[`${t}${s}`] = vars;
    // Conditional formats, lowest priority first (Word: bands, then
    // first/last column, then header/total rows).
    const fmtRule = (sel: string, f: CondFormat | undefined, edge?: "border-top" | "border-bottom") => {
      if (!f) return;
      const d: Record<string, string> = {};
      if (f.fill) d["background-color"] = f.fill;
      if (f.color) d.color = f.color;
      if (f.bold) d["font-weight"] = "700";
      if (f.edge && edge) d[edge] = borderCss(f.edge);
      if (Object.keys(d).length) r[sel] = d;
    };
    if (tpl.band) {
      // Band 1 is the first row after the header.
      r[`${t}${s}[data-look~="banded"][data-look~="header"] > tbody > tr:nth-child(even) > :is(td, th)`] = { "background-color": tpl.band };
      r[`${t}${s}[data-look~="banded"]:not([data-look~="header"]) > tbody > tr:nth-child(odd) > :is(td, th)`] = { "background-color": tpl.band };
    }
    if (tpl.bandCol) {
      r[`${t}${s}[data-look~="bandedCols"][data-look~="firstCol"] > tbody > tr > :is(td, th):nth-child(even)`] = { "background-color": tpl.bandCol };
      r[`${t}${s}[data-look~="bandedCols"]:not([data-look~="firstCol"]) > tbody > tr > :is(td, th):nth-child(odd)`] = { "background-color": tpl.bandCol };
    }
    fmtRule(`${t}${s}[data-look~="firstCol"] > tbody > tr > :is(td, th):first-child`, tpl.firstCol);
    fmtRule(`${t}${s}[data-look~="lastCol"] > tbody > tr > :is(td, th):last-child`, tpl.lastCol);
    fmtRule(`${t}${s}[data-look~="lastRow"] > tbody > tr:last-child > :is(td, th)`, tpl.lastRow, "border-top");
    fmtRule(`${t}${s}[data-look~="header"] > tbody > tr:first-child > :is(td, th)`, tpl.header, "border-bottom");
    // A styled table's <th> looks like its template, not the legacy grey.
    r[`${t}${s} > tbody > tr > th`] = { "font-weight": "inherit", "background-color": "transparent" };
    if (tpl.header) {
      const d: Record<string, string> = {};
      if (tpl.header.bold) d["font-weight"] = "700";
      if (tpl.header.fill) d["background-color"] = tpl.header.fill;
      r[`${t}${s}[data-look~="header"] > tbody > tr:first-child > th`] = d;
    }
  }
  // Repeated header rows repeat on every printed page.
  r[`${t} > tbody > tr[data-repeat-header]`] = { "break-inside": "avoid" };
  return r;
}

/** tableCss renders tableCssRules as a stylesheet (HTML export). */
export function tableCss(scope = ""): string {
  const rules = tableCssRules(scope);
  return Object.entries(rules)
    .map(([sel, d]) => `${sel.trim()}{${Object.entries(d).map(([k, v]) => `${k}:${v}`).join(";")}}`)
    .join("\n");
}

/** tableSx is tableCssRules in MUI `sx` form (camelCase keys; custom
 *  properties keep their names). */
export function tableSx(scope = ".ProseMirror"): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [sel, d] of Object.entries(tableCssRules(scope))) {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) o[k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
    out[`& ${sel}`] = o;
  }
  return out;
}

// --- fixed-layout grid resolver ----------------------------------------------------------

export interface GridCell {
  /** Grid columns the cell spans (gridSpan / colspan). */
  span?: number;
  /** Preferred width, or null/undefined for auto. */
  width?: number | null;
  /** A vertically merged continuation cell has no width of its own. */
  vMerge?: "restart" | "continue" | null;
}
export interface GridRow {
  cells: GridCell[];
  /** Grid columns skipped before the first cell (gridBefore). */
  before?: number;
}

/** resolveFixedGrid computes a fixed-layout table's column widths: a
 *  column takes the widest explicit width of the single-column cells in
 *  it, in any row; columns with none keep the grid (tblGrid) width; a
 *  merged-continuation cell is ignored; a spanning cell wider than its
 *  columns widens them in proportion. Columns missing from the grid get
 *  the average grid width (or `fallback`). */
export function resolveFixedGrid(grid: readonly number[], rows: readonly GridRow[], fallback = 100): number[] {
  let cols = grid.length;
  for (const r of rows) cols = Math.max(cols, (r.before ?? 0) + r.cells.reduce((a, c) => a + Math.max(1, c.span ?? 1), 0));
  const known = grid.filter((w) => w > 0);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : fallback;
  const out = Array.from({ length: cols }, (_, i) => (grid[i] > 0 ? grid[i] : avg));
  const explicit: (number | null)[] = Array(cols).fill(null);
  const spans: { col: number; span: number; width: number }[] = [];
  for (const r of rows) {
    let col = r.before ?? 0;
    for (const c of r.cells) {
      const span = Math.max(1, c.span ?? 1);
      if (c.vMerge !== "continue" && c.width != null && c.width > 0) {
        if (span === 1) explicit[col] = Math.max(explicit[col] ?? 0, c.width);
        else spans.push({ col, span, width: c.width });
      }
      col += span;
    }
  }
  for (let i = 0; i < cols; i++) if (explicit[i] != null) out[i] = explicit[i]!;
  for (const s of spans) {
    const cur = out.slice(s.col, s.col + s.span).reduce((a, b) => a + b, 0);
    if (s.width > cur && cur > 0) for (let i = s.col; i < s.col + s.span; i++) out[i] = (out[i] * s.width) / cur;
  }
  return out.map((w) => Math.round(w * 100) / 100);
}

/** columnWidthsOf reads a ProseMirror-JSON table's per-column widths
 *  (colwidth, px): the widest explicit width per column across rows, or
 *  null where no cell sets one. */
export function columnWidthsOf(table: JSONContent): (number | null)[] {
  const placed = placeCells(table).cells;
  let cols = 0;
  for (const p of placed) cols = Math.max(cols, p.col + p.colspan);
  const out: (number | null)[] = Array(cols).fill(null);
  for (const p of placed) {
    const cw = p.node.attrs?.colwidth as number[] | null | undefined;
    if (!Array.isArray(cw)) continue;
    for (let j = 0; j < p.colspan; j++) {
      const w = cw[j];
      if (typeof w === "number" && w > 0) out[p.col + j] = Math.max(out[p.col + j] ?? 0, w);
    }
  }
  return out;
}

// --- bad-table correction (DOCX vMerge model) ------------------------------------------

export interface RawCell {
  span: number;
  vMerge: "restart" | "continue" | null;
}
export interface RawRow<C extends RawCell = RawCell> {
  cells: C[];
  before?: number;
}

/** correctBadTable repairs invalid vertical merges in a WordprocessingML-
 *  shaped table: a "continue" cell with no merge above it (at the same
 *  grid column and span) starts a merge instead, and a row made only of
 *  continuation cells is folded into the rows above (removed). Returns
 *  the kept rows (the cells are updated in place). */
export function correctBadTable<C extends RawCell, R extends RawRow<C>>(rows: R[]): R[] {
  const kept: R[] = [];
  // Merge state per grid column: the span of the cell whose merge is open.
  let open = new Map<number, number>();
  for (const row of rows) {
    const next = new Map<number, number>();
    let col = row.before ?? 0;
    for (const c of row.cells) {
      const span = Math.max(1, c.span);
      if (c.vMerge === "continue" && open.get(col) !== span) c.vMerge = "restart";
      if (c.vMerge) next.set(col, span);
      col += span;
    }
    if (row.cells.length && row.cells.every((c) => c.vMerge === "continue")) {
      // Nothing of its own: the merges above simply continue past it.
      continue;
    }
    kept.push(row);
    open = next;
  }
  // A lone "restart" (nothing continues it) is a plain cell; OnlyOffice
  // keeps the flag, and so do we: it has the same meaning.
  return kept;
}

// --- normaliser for ProseMirror-JSON tables ---------------------------------------------

interface Placed {
  node: JSONContent;
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
}

const CELL_TYPES = new Set(["tableCell", "tableHeader"]);
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null);

/** placeCells lays cells out on the grid the way ProseMirror does (first
 *  free column, left to right). */
function placeCells(table: JSONContent): { cells: Placed[]; rows: number } {
  const rows = (table.content ?? []).filter((r) => r.type === "tableRow");
  const taken: boolean[][] = rows.map(() => []);
  const cells: Placed[] = [];
  rows.forEach((row, r) => {
    let col = 0;
    for (const node of row.content ?? []) {
      if (!CELL_TYPES.has(node.type ?? "")) continue;
      while (taken[r][col]) col++;
      const colspan = posInt(node.attrs?.colspan) ?? 1;
      const rowspan = posInt(node.attrs?.rowspan) ?? 1;
      for (let dr = 0; dr < rowspan && r + dr < rows.length; dr++)
        for (let dc = 0; dc < colspan; dc++) taken[r + dr][col + dc] = true;
      cells.push({ node, row: r, col, colspan, rowspan });
      col += colspan;
    }
  });
  return { cells, rows: rows.length };
}

export interface NormalizeResult {
  /** The repaired table, or null when nothing table-like is left. */
  table: JSONContent | null;
  /** What was repaired (empty when the table was valid). */
  fixes: string[];
}

const emptyCell = (type: string, colwidth: number | null): JSONContent => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: colwidth ? [colwidth] : null },
  content: [{ type: "paragraph" }],
});

/** normalizeTable repairs a table in TipTap JSON so every row covers the
 *  same number of columns: invalid spans are reset, spans that run past
 *  the table or into a cell merged from above are clipped, rows that are
 *  entirely covered by merges from above are removed (their merges
 *  shortened), empty rows are dropped, short rows are padded with empty
 *  cells, colwidth arrays match their colspan, and empty cells get a
 *  paragraph. The input is not modified. */
export function normalizeTable(input: JSONContent): NormalizeResult {
  const fixes = new Set<string>();
  const table: JSONContent = JSON.parse(JSON.stringify(input));
  let rows = (table.content ?? []).filter((r) => {
    if (r.type === "tableRow") return true;
    fixes.add("content outside rows");
    return false;
  });
  for (const row of rows) {
    const content = row.content ?? [];
    row.content = content.filter((c) => {
      if (CELL_TYPES.has(c.type ?? "")) return true;
      fixes.add("content outside cells");
      return false;
    });
    for (const c of row.content) {
      const a = (c.attrs ??= {});
      const colspan = posInt(a.colspan);
      const rowspan = posInt(a.rowspan);
      if (colspan == null) {
        if (a.colspan != null) fixes.add("invalid span");
        a.colspan = 1;
      }
      if (rowspan == null) {
        if (a.rowspan != null) fixes.add("invalid span");
        a.rowspan = 1;
      }
      if (a.colwidth != null) {
        const cw = Array.isArray(a.colwidth) ? a.colwidth : [];
        const ok = cw.length === a.colspan && cw.every((w: unknown) => typeof w === "number" && w > 0);
        if (!ok) {
          fixes.add("column widths");
          a.colwidth = cw.length && cw.every((w: unknown) => typeof w === "number" && w > 0)
            ? Array.from({ length: a.colspan as number }, (_, i) => cw[Math.min(i, cw.length - 1)])
            : null;
        }
      }
      if (!c.content?.length) {
        c.content = [{ type: "paragraph" }];
        fixes.add("empty cell");
      }
    }
  }

  // Clip spans against the table bottom and against cells merged from
  // above, then fold rows that have no cells of their own.
  for (let pass = 0; pass < 100; pass++) {
    const taken: (Placed | undefined)[][] = rows.map(() => []);
    const placed: Placed[] = [];
    rows.forEach((row, r) => {
      let col = 0;
      for (const node of row.content ?? []) {
        while (taken[r][col]) col++;
        const a = node.attrs!;
        if ((a.rowspan as number) > rows.length - r) {
          a.rowspan = rows.length - r;
          fixes.add("rowspan past the last row");
        }
        let colspan = a.colspan as number;
        let free = 0;
        while (free < colspan && !(r < rows.length && taken[r][col + free])) free++;
        if (free < colspan) {
          colspan = free;
          a.colspan = free;
          if (Array.isArray(a.colwidth)) a.colwidth = (a.colwidth as number[]).slice(0, free);
          fixes.add("overlapping merge");
        }
        const p: Placed = { node, row: r, col, colspan, rowspan: a.rowspan as number };
        for (let dr = 0; dr < p.rowspan; dr++) for (let dc = 0; dc < colspan; dc++) taken[r + dr][col + dc] = p;
        placed.push(p);
        col += colspan;
      }
    });
    const emptyIdx = rows.findIndex((row) => !(row.content ?? []).length);
    if (emptyIdx < 0) break;
    const covering = new Set(taken[emptyIdx].filter(Boolean) as Placed[]);
    if (covering.size) {
      fixes.add("row covered by merged cells");
      for (const p of covering) p.node.attrs!.rowspan = (p.node.attrs!.rowspan as number) - 1;
    } else fixes.add("empty row");
    rows = rows.filter((_, i) => i !== emptyIdx);
  }
  if (!rows.length) return { table: null, fixes: [...fixes, "empty table"] };

  // Pad short rows.
  const { cells } = placeCells({ ...table, content: rows });
  const width: number[] = rows.map(() => 0);
  let cols = 0;
  for (const p of cells) {
    for (let dr = 0; dr < p.rowspan; dr++) width[p.row + dr] += p.colspan;
    cols = Math.max(cols, p.col + p.colspan);
  }
  const colW = columnWidthsOf({ ...table, content: rows });
  rows.forEach((row, r) => {
    const missing = cols - width[r];
    if (missing <= 0) return;
    fixes.add("ragged rows");
    const content = row.content ?? [];
    const header = content.length > 0 && content.every((c) => c.type === "tableHeader");
    // Appended cells fill the free columns left to right.
    const free: number[] = [];
    const takenCols = new Set<number>();
    for (const p of cells) if (p.row <= r && r < p.row + p.rowspan) for (let dc = 0; dc < p.colspan; dc++) takenCols.add(p.col + dc);
    for (let c = 0; c < cols; c++) if (!takenCols.has(c)) free.push(c);
    for (const c of free) content.push(emptyCell(header ? "tableHeader" : "tableCell", colW[c]));
    row.content = content;
  });
  table.content = rows;
  return { table, fixes: [...fixes] };
}

/** normalizeTablesIn repairs every table in a JSON tree (in place order;
 *  returns a new tree). Tables that end up empty are removed. */
export function normalizeTablesIn(node: JSONContent, fixes: string[] = []): JSONContent {
  if (node.type === "table") {
    const r = normalizeTable(node);
    fixes.push(...r.fixes);
    if (!r.table) return { type: "__removed" };
    return { ...r.table, content: r.table.content!.map((row) => normalizeTablesIn(row, fixes)) };
  }
  if (!node.content) return node;
  return {
    ...node,
    content: node.content.map((c) => normalizeTablesIn(c, fixes)).filter((c) => c.type !== "__removed"),
  };
}

// --- helpers for commands --------------------------------------------------------------

/** distributeEvenly splits `total` into n equal parts that sum to it. */
export function distributeEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const out = Array(n).fill(base);
  for (let i = 0; i < total - base * n; i++) out[i]++;
  return out;
}

/** splitByDelimiter splits a line of text into cells. */
export function splitCells(text: string, delimiter: string): string[] {
  if (!delimiter) return [text];
  return text.split(delimiter);
}
