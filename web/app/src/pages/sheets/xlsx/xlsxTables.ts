// Excel tables (ListObjects, §18.5): read from and written to table parts so
// an imported table round-trips. Grown has no table UI yet; the model rides on
// the sheet as `grownTables` and moves with structure changes like other ranges.

import type { CellRect } from "../cellRange";
import { all, attr, attrs, boolAttr, esc, kid, kids, numAttr, parseRef, rectRef, text } from "./ooxml";

export interface TableColumn {
  id: number;
  name: string;
  totalsRowFunction?: string;
  totalsRowLabel?: string;
  /** The totals cell's formula when totalsRowFunction is "custom". */
  totalsRowFormula?: string;
  calculatedColumnFormula?: string;
}

export interface TableStyleInfo {
  name: string;
  showFirstColumn: boolean;
  showLastColumn: boolean;
  showRowStripes: boolean;
  showColumnStripes: boolean;
}

export interface TableModel {
  id: number;
  name: string;
  displayName: string;
  ref: CellRect;
  headerRowCount: number;
  totalsRowCount: number;
  totalsRowShown: boolean;
  insertRow: boolean;
  autoFilter: boolean;
  columns: TableColumn[];
  style: TableStyleInfo | null;
}

export function readTable(doc: Document): TableModel | null {
  const t = doc.documentElement;
  if (!t || t.localName !== "table") return null;
  const ref = parseRef(attr(t, "ref") ?? "");
  if (!ref) return null;
  const si = kid(t, "tableStyleInfo");
  return {
    id: numAttr(t, "id") ?? 1,
    name: attr(t, "name") ?? attr(t, "displayName") ?? "Table1",
    displayName: attr(t, "displayName") ?? attr(t, "name") ?? "Table1",
    ref,
    headerRowCount: numAttr(t, "headerRowCount") ?? 1,
    totalsRowCount: numAttr(t, "totalsRowCount") ?? 0,
    totalsRowShown: boolAttr(t, "totalsRowShown", true),
    insertRow: boolAttr(t, "insertRow", false),
    autoFilter: !!kid(t, "autoFilter"),
    columns: kids(kid(t, "tableColumns"), "tableColumn").map((c, i) => {
      const col: TableColumn = { id: numAttr(c, "id") ?? i + 1, name: attr(c, "name") ?? `Column${i + 1}` };
      const fn = attr(c, "totalsRowFunction");
      if (fn) col.totalsRowFunction = fn;
      const label = attr(c, "totalsRowLabel");
      if (label) col.totalsRowLabel = label;
      const calc = all(c, "calculatedColumnFormula")[0];
      if (calc) col.calculatedColumnFormula = text(calc);
      const tf = all(c, "totalsRowFormula")[0];
      if (tf) col.totalsRowFormula = text(tf);
      return col;
    }),
    style: si
      ? {
          name: attr(si, "name") ?? "TableStyleMedium2",
          showFirstColumn: boolAttr(si, "showFirstColumn"),
          showLastColumn: boolAttr(si, "showLastColumn"),
          showRowStripes: boolAttr(si, "showRowStripes"),
          showColumnStripes: boolAttr(si, "showColumnStripes"),
        }
      : null,
  };
}

export function writeTable(t: TableModel): string {
  const ref = rectRef(t.ref);
  const cols = t.columns
    .map((c) => {
      const inner =
        (c.calculatedColumnFormula ? `<calculatedColumnFormula>${esc(c.calculatedColumnFormula)}</calculatedColumnFormula>` : "") +
        (c.totalsRowFormula && c.totalsRowFunction === "custom" ? `<totalsRowFormula>${esc(c.totalsRowFormula)}</totalsRowFormula>` : "");
      const a = attrs({ id: c.id, name: c.name, totalsRowFunction: c.totalsRowFunction, totalsRowLabel: c.totalsRowLabel });
      return inner ? `<tableColumn${a}>${inner}</tableColumn>` : `<tableColumn${a}/>`;
    })
    .join("");
  // The filter covers the table without its totals row.
  const filterRef = rectRef({ ...t.ref, r2: t.ref.r2 - (t.totalsRowCount || 0) });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${attrs({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      ref,
      headerRowCount: t.headerRowCount === 1 ? undefined : t.headerRowCount,
      totalsRowCount: t.totalsRowCount ? t.totalsRowCount : undefined,
      insertRow: t.insertRow ? 1 : undefined,
      totalsRowShown: t.totalsRowShown ? undefined : 0,
    })}>` +
    (t.autoFilter && t.headerRowCount > 0 ? `<autoFilter ref="${filterRef}"/>` : "") +
    `<tableColumns count="${t.columns.length}">${cols}</tableColumns>` +
    (t.style
      ? `<tableStyleInfo${attrs({
          name: t.style.name,
          showFirstColumn: t.style.showFirstColumn,
          showLastColumn: t.style.showLastColumn,
          showRowStripes: t.style.showRowStripes,
          showColumnStripes: t.style.showColumnStripes,
        })}/>`
      : "") +
    "</table>"
  );
}
