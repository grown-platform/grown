// DrawingML table writer (ECMA-376 §21.1.3) for Grown tables (M5).
//
// pptxgenjs lays down the graphic frame; its `a:tbl` is replaced by this one
// (write.ts patchElements), which keeps what pptxgenjs can't express: the
// table style id and options, merged cells (gridSpan/rowSpan with
// hMerge/vMerge on covered cells), per-cell borders and fills, and rich
// cell text. A table with no style (a legacy Grown table) omits the style id
// and bakes its element fill/border into every cell, as before.

import type { CellBorder, CellSide, SlideElement } from "../model";
import { CELL_PAD, anchorOf, cellTextEl, colWidths, rowHeights, spanOf } from "../tableOps";
import { EMU_PER_PX, esc, parasXml, type LinkResolver } from "./textXml";

const EMU_PER_PT = 12700;
const hex = (c: string) => c.replace("#", "").slice(0, 6).padEnd(6, "0").toUpperCase();

const TAG: Record<CellSide, string> = { l: "lnL", r: "lnR", t: "lnT", b: "lnB" };
const ORDER: CellSide[] = ["l", "r", "t", "b"];

/** One `a:lnL`/`lnR`/`lnT`/`lnB`; width 0 = an explicit no-line. */
export function cellLineXml(side: CellSide, b: CellBorder): string {
  const tag = TAG[side];
  if (!b.width) return `<a:${tag} w="0"><a:noFill/></a:${tag}>`;
  return (
    `<a:${tag} w="${Math.round(b.width * EMU_PER_PT)}" cap="flat" cmpd="sng" algn="ctr">` +
    `<a:solidFill><a:srgbClr val="${hex(b.color)}"/></a:solidFill>` +
    `<a:prstDash val="${b.dash ?? "solid"}"/>` +
    `</a:${tag}>`
  );
}

const ON = (v: boolean | undefined) => (v ? "1" : "0");

/** The `a:tbl` XML for a table element (a: and r: prefixes unbound). */
export function tableXml(el: SlideElement, link: LinkResolver): string {
  const t = el.table!;
  const legacy = !t.style;
  const legacyLine: CellBorder =
    el.stroke && el.stroke !== "none" ? { color: el.stroke, width: el.strokeWidth || 1 } : { color: "#000000", width: 0 };
  const legacyFill = el.fill && el.fill !== "none" ? el.fill : undefined;
  const look = t.look ?? {};
  const tblPr = legacy
    ? `<a:tblPr/>`
    : `<a:tblPr firstRow="${ON(look.header)}" bandRow="${ON(look.banded)}" lastRow="${ON(look.lastRow)}" firstCol="${ON(look.firstCol)}" lastCol="${ON(look.lastCol)}" bandCol="${ON(look.bandedCols)}"><a:tableStyleId>${esc(t.style!)}</a:tableStyleId></a:tblPr>`;
  const grid = colWidths(el)
    .map((w) => `<a:gridCol w="${Math.round(w * EMU_PER_PX)}"/>`)
    .join("");
  const hs = rowHeights(el);
  const pad = Math.round(CELL_PAD * EMU_PER_PX);
  const rows: string[] = [];
  for (let r = 0; r < t.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < t.cols; c++) {
      const [ar, ac] = anchorOf(t, r, c);
      if (ar !== r || ac !== c) {
        const attrs = `${c > ac ? ` hMerge="1"` : ""}${r > ar ? ` vMerge="1"` : ""}`;
        cells.push(`<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>`);
        continue;
      }
      const { rs, cs } = spanOf(t, r, c);
      const p = t.props?.[r]?.[c] ?? null;
      const te = cellTextEl(el, r, c);
      const lines = ORDER.map((s) => {
        const b = p?.borders?.[s] ?? (legacy ? legacyLine : undefined);
        return b ? cellLineXml(s, b) : "";
      }).join("");
      const fill = p?.fill ?? (legacy ? legacyFill : undefined);
      const fillXml = fill === undefined ? "" : fill === "none" ? `<a:noFill/>` : `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>`;
      const anchor = te.valign === "middle" ? "ctr" : te.valign === "bottom" ? "b" : "t";
      const span = `${cs > 1 ? ` gridSpan="${cs}"` : ""}${rs > 1 ? ` rowSpan="${rs}"` : ""}`;
      cells.push(
        `<a:tc${span}><a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(te, link)}</a:txBody>` +
          `<a:tcPr marL="${pad}" marR="${pad}" marT="${pad}" marB="${pad}" anchor="${anchor}">${lines}${fillXml}</a:tcPr></a:tc>`,
      );
    }
    rows.push(`<a:tr h="${Math.round(hs[r] * EMU_PER_PX)}">${cells.join("")}</a:tr>`);
  }
  return `<a:tbl>${tblPr}<a:tblGrid>${grid}</a:tblGrid>${rows.join("")}</a:tbl>`;
}
