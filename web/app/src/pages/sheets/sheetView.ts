/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet cells/sheets are loosely typed. */

// View options of a sheet: show formulas, gridlines, row/column headings,
// zoom and the page-break preview. Gridlines and zoom use FortuneSheet's own
// sheet fields (`showGridLines`, `zoomRatio`); the rest ride on `grownView`.
// These map to xlsx sheetView@showFormulas/showGridLines/showRowColHeaders/
// zoomScale/view="pageBreakPreview".

export interface SheetViewOptions {
  showFormulas: boolean;
  showGridLines: boolean;
  showHeadings: boolean;
  /** 1 = 100 %. */
  zoom: number;
  pageBreakPreview: boolean;
}

export const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

export function sheetViewOptions(sheet: any): SheetViewOptions {
  const v = sheet?.grownView ?? {};
  const g = sheet?.showGridLines;
  return {
    showFormulas: !!v.showFormulas,
    showGridLines: !(g === 0 || g === false),
    showHeadings: v.showHeadings !== false,
    zoom: typeof sheet?.zoomRatio === "number" && sheet.zoomRatio > 0 ? sheet.zoomRatio : 1,
    pageBreakPreview: !!v.pageBreakPreview,
  };
}

/** The sheet fields that store a view (for applyOp patches). */
export function viewFields(v: SheetViewOptions): Record<string, unknown> {
  return {
    grownView: { showFormulas: v.showFormulas, showHeadings: v.showHeadings, pageBreakPreview: v.pageBreakPreview },
    showGridLines: v.showGridLines ? 1 : 0,
    zoomRatio: v.zoom,
  };
}

/**
 * What a cell shows under the view: with formulas shown, formula cells show
 * their formula and every cell aligns left (numbers too, like Excel).
 */
export function cellViewText(cell: any, v: Pick<SheetViewOptions, "showFormulas">): { text: string; align: "left" | "center" | "right" | null } {
  if (!cell || typeof cell !== "object") return { text: "", align: null };
  if (v.showFormulas) {
    if (typeof cell.f === "string" && cell.f) return { text: cell.f, align: "left" };
    const raw = cell.v;
    return { text: raw == null ? "" : typeof raw === "boolean" ? (raw ? "TRUE" : "FALSE") : String(raw), align: "left" };
  }
  const m = cell.m ?? cell.v;
  const align = cell.ht === 0 || cell.ht === "0" ? "center" : cell.ht === 2 || cell.ht === "2" ? "right" : cell.ht === 1 || cell.ht === "1" ? "left" : null;
  return { text: m == null ? "" : String(m), align };
}

/** Column width while formulas are shown: doubled, as in Excel and OnlyOffice. */
export function viewColumnWidth(px: number, v: Pick<SheetViewOptions, "showFormulas">): number {
  return v.showFormulas ? px * 2 : px;
}

/** Undo-able view toggles (the editor keeps view changes out of FortuneSheet's cell history). */
export class ViewHistory {
  private past: SheetViewOptions[] = [];
  private future: SheetViewOptions[] = [];
  constructor(public current: SheetViewOptions) {}
  set(next: SheetViewOptions): SheetViewOptions {
    this.past.push(this.current);
    this.future = [];
    this.current = next;
    return next;
  }
  undo(): SheetViewOptions {
    const prev = this.past.pop();
    if (prev) {
      this.future.push(this.current);
      this.current = prev;
    }
    return this.current;
  }
  redo(): SheetViewOptions {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
