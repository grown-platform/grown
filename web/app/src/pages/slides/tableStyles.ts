// Table style templates (M5). Ids are PowerPoint's built-in table style
// GUIDs (`a:tableStyleId`), so a pptx round trip keeps the style and
// PowerPoint/LibreOffice draw it without a definition in tableStyles.xml.
// Colours follow the default Office theme; the rules (whole table, banded
// rows/columns, header/total rows, first/last columns) are the documented
// behaviour of each style, written from the style descriptions.

import type { CellBorder, TableLook } from "./model";

/** Conditional formatting of one part of a table. */
export interface CondFormat {
  fill?: string;
  color?: string;
  bold?: boolean;
  /** Line under a header row / over a total row. */
  edge?: CellBorder;
}

export interface TableTemplate {
  /** pptx table style GUID. */
  id: string;
  name: string;
  /** Style group in the gallery. */
  group: "No style" | "Medium";
  /** Fill of every cell. */
  fill?: string;
  /** Text colour of every cell. */
  color?: string;
  /** Every cell border (outer and inner). */
  border?: CellBorder;
  /** Odd banded rows/columns (band 1). */
  band?: string;
  header?: CondFormat;
  lastRow?: CondFormat;
  firstCol?: CondFormat;
  lastCol?: CondFormat;
}

/** Office theme accents 1–6 (2013+). */
export const ACCENTS = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

/** Mix `hex` with white: `t` = share of the colour kept (0.2 = 20 % tint). */
export function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (s: number) => {
    const c = (n >> s) & 255;
    return Math.round(255 - (255 - c) * t)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const white = (width: number): CellBorder => ({ color: "#ffffff", width });

/** Medium Style 2: tinted body, 40 % tinted bands, solid accent header,
 *  white grid lines. */
function medium2(id: string, name: string, accent: string): TableTemplate {
  const solid: CondFormat = { fill: accent, color: "#ffffff", bold: true };
  return {
    id,
    name,
    group: "Medium",
    fill: tint(accent, 0.2),
    color: "#000000",
    border: white(1),
    band: tint(accent, 0.4),
    header: { ...solid, edge: white(3) },
    lastRow: { ...solid, edge: white(3) },
    firstCol: solid,
    lastCol: solid,
  };
}

export const NO_STYLE_NO_GRID = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}";
export const NO_STYLE_TABLE_GRID = "{5940675A-B579-460E-94D1-54222C63F5DA}";
export const MEDIUM_STYLE_2_ACCENT_1 = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";

export const TABLE_TEMPLATES: TableTemplate[] = [
  {
    id: NO_STYLE_NO_GRID,
    name: "No Style, No Grid",
    group: "No style",
    header: { bold: true },
    lastRow: { bold: true },
    firstCol: { bold: true },
    lastCol: { bold: true },
  },
  {
    id: NO_STYLE_TABLE_GRID,
    name: "No Style, Table Grid",
    group: "No style",
    border: { color: "#000000", width: 1 },
    header: { bold: true },
    lastRow: { bold: true },
    firstCol: { bold: true },
    lastCol: { bold: true },
  },
  medium2("{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}", "Medium Style 2", "#000000"),
  medium2(MEDIUM_STYLE_2_ACCENT_1, "Medium Style 2 - Accent 1", ACCENTS[0]),
  medium2("{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}", "Medium Style 2 - Accent 2", ACCENTS[1]),
  medium2("{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}", "Medium Style 2 - Accent 3", ACCENTS[2]),
  medium2("{00A15C55-8517-42AA-B614-E9B94910E393}", "Medium Style 2 - Accent 4", ACCENTS[3]),
  medium2("{7DF18680-E054-41AD-8BC1-D1AEF772440D}", "Medium Style 2 - Accent 5", ACCENTS[4]),
  medium2("{93296810-A885-4BE3-A3E7-6D5BEEA58F35}", "Medium Style 2 - Accent 6", ACCENTS[5]),
];

const BY_ID = new Map(TABLE_TEMPLATES.map((t) => [t.id.toUpperCase(), t]));

/** findTableTemplate looks a template up by GUID (any case, braces kept). */
export function findTableTemplate(id: string | undefined): TableTemplate | undefined {
  return id ? BY_ID.get(id.toUpperCase()) : undefined;
}

/** The look a new styled table gets (PowerPoint: header row + banded rows). */
export const DEFAULT_LOOK: TableLook = { header: true, banded: true };

/** The parts of a table cell (r, c) belongs to, for a table of rows × cols. */
export interface CellRole {
  header: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  /** Odd band (band 1) row / column, counted after a header row / first column. */
  bandRow: boolean;
  bandCol: boolean;
}

export function cellRole(look: TableLook | undefined, rows: number, cols: number, r: number, c: number): CellRole {
  const l = look ?? {};
  const header = !!l.header && r === 0;
  const lastRow = !!l.lastRow && r === rows - 1 && !(header && rows === 1);
  const firstCol = !!l.firstCol && c === 0;
  const lastCol = !!l.lastCol && c === cols - 1 && !(firstCol && cols === 1);
  const br = r - (l.header ? 1 : 0);
  const bc = c - (l.firstCol ? 1 : 0);
  return {
    header,
    lastRow,
    firstCol,
    lastCol,
    bandRow: !!l.banded && !header && !lastRow && br >= 0 && br % 2 === 0,
    bandCol: !!l.bandedCols && !firstCol && !lastCol && bc >= 0 && bc % 2 === 0,
  };
}

/** What a template gives cell (r, c): fill, text colour/bold, and borders
 *  per side. Precedence (lowest first): whole table, column bands, row
 *  bands, first/last column, header/total row (as in PowerPoint). */
export function templateCell(
  tpl: TableTemplate | undefined,
  look: TableLook | undefined,
  rows: number,
  cols: number,
  r: number,
  c: number,
): { fill?: string; color?: string; bold?: boolean; borders: Partial<Record<"t" | "r" | "b" | "l", CellBorder>> } {
  const out: { fill?: string; color?: string; bold?: boolean; borders: Partial<Record<"t" | "r" | "b" | "l", CellBorder>> } = {
    borders: {},
  };
  if (!tpl) return out;
  const role = cellRole(look, rows, cols, r, c);
  out.fill = tpl.fill;
  out.color = tpl.color;
  if (tpl.border) out.borders = { t: tpl.border, r: tpl.border, b: tpl.border, l: tpl.border };
  if (tpl.band && (role.bandCol || role.bandRow)) out.fill = tpl.band;
  const apply = (f: CondFormat | undefined) => {
    if (!f) return;
    if (f.fill) out.fill = f.fill;
    if (f.color) out.color = f.color;
    if (f.bold) out.bold = true;
  };
  if (role.firstCol) apply(tpl.firstCol);
  if (role.lastCol) apply(tpl.lastCol);
  if (role.lastRow) {
    apply(tpl.lastRow);
    if (tpl.lastRow?.edge) out.borders.t = tpl.lastRow.edge;
  }
  if (role.header) {
    apply(tpl.header);
    if (tpl.header?.edge) out.borders.b = tpl.header.edge;
  }
  // The row under a header shares the header's bottom edge.
  const l = look ?? {};
  if (l.header && r === 1 && tpl.header?.edge) out.borders.t = tpl.header.edge;
  if (l.lastRow && r === rows - 2 && rows > 1 && tpl.lastRow?.edge) out.borders.b = tpl.lastRow.edge;
  return out;
}
