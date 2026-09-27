/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */

// Workbook (FortuneSheet sheets + Grown models) → .xlsx, written part by part
// from ECMA-376 with JSZip. Covers values, formulas (text kept; Excel
// recalculates on open), number formats, fonts/fills/borders/alignment,
// merges, frozen panes, column widths/row heights, hidden rows/columns and
// sheets, tab colours, named ranges, conditional formatting, data validation,
// autofilter, tables, hyperlinks, comments, page setup (margins, orientation,
// scale/fit, print area, print titles, manual breaks, gridlines/headings,
// header/footer), sheet view options and sheet protection.
//
// Why not SheetJS here: the Community Edition writer (0.18.5 in this repo)
// drops styles, conditional formats, validation, panes and print settings;
// the parts below are small enough to write directly.

import JSZip from "jszip";
import type { CellRect } from "../cellRange";
import { colToLetters } from "../cellValue";
import { sheetCF, sheetDV, sheetFilter } from "../sheetDataTools";
import { sheetPrintSettings, PAPER } from "../printSettings";
import { sheetProtection } from "../protection";
import { sheetViewOptions } from "../sheetView";
import { attrs, cellRef, esc, pxToPt, pxToWidth, quoteSheet, rectRef, toArgb } from "./ooxml";
import { StyleBuilder, flattenBorders, type CellBorder } from "./xlsxStyles";
import { writeAutoFilter, writeConditionalFormatting, writeDataValidations } from "./xlsxRules";
import { writeTable, type TableModel } from "./xlsxTables";

export const GROWN_EXT_NS = "https://grown.pick.haus/xlsx/2026";
export const GROWN_EXT_URI = "{6F1B8B4E-6A36-4C5B-9C1A-6772726F776E}";

const ERROR_VALUES = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!"]);

// Functions added after Excel 2007 carry a prefix in the file format.
const XLFN = new Set(
  (
    "ACOT ACOTH AGGREGATE ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW " +
    "CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH " +
    "COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP ECMA.CEILING ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FIELDVALUE " +
    "FLOOR.MATH FLOOR.PRECISE FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV " +
    "GAMMALN.PRECISE GAUSS HSTACK HYPGEOM.DIST IFNA IFS IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOMITTED ISO.CEILING ISOWEEKNUM LAMBDA LET " +
    "LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE " +
    "PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA PHI POISSON.DIST QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ REDUCE " +
    "RRI SCAN SEC SECH SEQUENCE SHEET SHEETS SKEW.P SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN " +
    "TEXTSPLIT TOCOL TOROW UNICHAR UNICODE UNIQUE VALUETOTEXT VAR.P VAR.S VSTACK WEIBULL.DIST WORKDAY.INTL WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR Z.TEST"
  ).split(" "),
);
const XLWS = new Set(["FILTER", "SORT"]);

/** Adds the _xlfn. / _xlfn._xlws. prefixes Excel expects on newer functions. */
export function prefixFunctions(formula: string): string {
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      const j = formula.indexOf('"', i + 1);
      const end = j < 0 ? formula.length : j + 1;
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      const j = formula.indexOf("'", i + 1);
      const end = j < 0 ? formula.length : j + 1;
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_.]*(?=\()/.exec(formula.slice(i));
    if (m && !/[A-Za-z0-9_.]$/.test(out)) {
      const name = m[0].toUpperCase();
      if (XLWS.has(name)) out += "_xlfn._xlws." + m[0];
      else if (XLFN.has(name)) out += "_xlfn." + m[0];
      else out += m[0];
      i += m[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface CellOut {
  r: number;
  c: number;
  cell: any;
}

function sheetCells(sheet: any): CellOut[] {
  const out: CellOut[] = [];
  if (Array.isArray(sheet?.data)) {
    sheet.data.forEach((row: any[], r: number) =>
      row?.forEach?.((cell: any, c: number) => {
        if (cell !== null && cell !== undefined) out.push({ r, c, cell });
      }),
    );
  } else {
    for (const cd of Array.isArray(sheet?.celldata) ? sheet.celldata : []) {
      if (cd && Number.isInteger(cd.r) && Number.isInteger(cd.c) && cd.v !== null && cd.v !== undefined) out.push({ r: cd.r, c: cd.c, cell: cd.v });
    }
  }
  return out;
}

class SharedStrings {
  private list: string[] = [];
  private index = new Map<string, number>();
  count = 0;
  add(xml: string): number {
    this.count++;
    let i = this.index.get(xml);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(xml);
      this.index.set(xml, i);
    }
    return i;
  }
  plain(s: string): number {
    return this.add(`<si><t xml:space="preserve">${esc(s)}</t></si>`);
  }
  xml(): string {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.list.length}">` +
      this.list.join("") +
      "</sst>"
    );
  }
  get size(): number {
    return this.list.length;
  }
}

function richRun(p: any): string {
  let pr = "";
  if (Number(p?.bl) === 1) pr += "<b/>";
  if (Number(p?.it) === 1) pr += "<i/>";
  if (Number(p?.cl) === 1) pr += "<strike/>";
  if (Number(p?.un) === 1) pr += "<u/>";
  if (p?.fs) pr += `<sz val="${Number(p.fs)}"/>`;
  const fc = toArgb(p?.fc);
  if (fc) pr += `<color rgb="${fc}"/>`;
  if (typeof p?.ff === "string" && p.ff) pr += `<rFont val="${esc(p.ff)}"/>`;
  return `<r>${pr ? `<rPr>${pr}</rPr>` : ""}<t xml:space="preserve">${esc(p?.v ?? "")}</t></r>`;
}

/** The value part of a <c>: type attribute and inner XML. */
function cellValueXml(cell: any, sst: SharedStrings): { t?: string; inner: string } {
  const f = typeof cell.f === "string" && cell.f.startsWith("=") ? cell.f.slice(1) : null;
  const fx = f !== null ? `<f>${esc(prefixFunctions(f))}</f>` : "";
  if (f === null && cell.ct?.t === "inlineStr" && Array.isArray(cell.ct.s)) {
    const runs = cell.ct.s as any[];
    if (!runs.some((p) => (p?.v ?? "") !== "")) return { inner: "" };
    return { t: "s", inner: `<v>${sst.add(`<si>${runs.map(richRun).join("")}</si>`)}</v>` };
  }
  let v = cell.v;
  if (v === undefined || v === null || v === "") {
    if (fx) return { t: "str", inner: `${fx}<v></v>` };
    return { inner: "" };
  }
  const t = cell.ct?.t;
  if (typeof v === "string" && (t === "n" || t === "d") && v.trim() !== "" && Number.isFinite(Number(v))) v = Number(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { t: "e", inner: `${fx}<v>#NUM!</v>` };
    return { inner: `${fx}<v>${v}</v>` };
  }
  if (typeof v === "boolean") return { t: "b", inner: `${fx}<v>${v ? 1 : 0}</v>` };
  const s = String(v);
  if (ERROR_VALUES.has(s)) return { t: "e", inner: `${fx}<v>${esc(s)}</v>` };
  if (t === "b" && /^(true|false)$/i.test(s)) return { t: "b", inner: `${fx}<v>${/^true$/i.test(s) ? 1 : 0}</v>` };
  if (fx) return { t: "str", inner: `${fx}<v>${esc(s)}</v>` };
  return { t: "s", inner: `<v>${sst.plain(s)}</v>` };
}

function frozenPane(frozen: any): { xSplit: number; ySplit: number } | null {
  if (!frozen?.type) return null;
  const rf = Number(frozen.range?.row_focus ?? 0);
  const cf = Number(frozen.range?.column_focus ?? 0);
  switch (frozen.type) {
    case "row":
      return { xSplit: 0, ySplit: 1 };
    case "column":
      return { xSplit: 1, ySplit: 0 };
    case "both":
      return { xSplit: 1, ySplit: 1 };
    case "rangeRow":
      return { xSplit: 0, ySplit: rf + 1 };
    case "rangeColumn":
      return { xSplit: cf + 1, ySplit: 0 };
    case "rangeBoth":
      return { xSplit: cf + 1, ySplit: rf + 1 };
    default:
      return null;
  }
}

function inRects(rects: CellRect[], r: number, c: number): boolean {
  return rects.some((x) => r >= Math.min(x.r1, x.r2) && r <= Math.max(x.r1, x.r2) && c >= Math.min(x.c1, x.c2) && c <= Math.max(x.c1, x.c2));
}

function headerFooterText(s: string): string {
  // Excel header codes: &L &C &R sections; a plain string goes to the centre.
  return /&[LCR]/.test(s) ? s : `&C${s}`;
}

/** Absolute A1 text for a named range. */
function absRange(range: string): string {
  return range.replace(/\$?([A-Za-z]{1,3})\$?(\d+)/g, (_m, c, r) => `$${String(c).toUpperCase()}$${r}`);
}

interface CommentOut {
  r: number;
  c: number;
  text: string;
}

function commentsXml(list: CommentOut[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Grown</author></authors><commentList>' +
    list.map((x) => `<comment ref="${cellRef(x.r, x.c)}" authorId="0"><text><t xml:space="preserve">${esc(x.text)}</t></text></comment>`).join("") +
    "</commentList></comments>"
  );
}

function vmlXml(list: CommentOut[]): string {
  const shapes = list
    .map(
      (x, i) =>
        `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
        '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
        '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
        `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${x.c + 1}, 15, ${x.r}, 2, ${x.c + 3}, 15, ${x.r + 4}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${x.r}</x:Row><x:Column>${x.c}</x:Column></x:ClientData>` +
        "</v:shape>",
    )
    .join("");
  return (
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    shapes +
    "</xml>"
  );
}

export interface WriteOptions {
  /** Workbook title (docProps/core.xml). */
  title?: string;
}

/** Writes a workbook (FortuneSheet sheets as stored or live) to xlsx bytes. */
export async function workbookToXlsx(input: any[], opts: WriteOptions = {}): Promise<Uint8Array> {
  const sheets = (Array.isArray(input) ? input : [])
    .filter((s) => s && typeof s === "object")
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (Number(a.s.order ?? a.i) - Number(b.s.order ?? b.i)) || a.i - b.i)
    .map((x) => x.s);
  if (!sheets.length) sheets.push({ name: "Sheet1", celldata: [] });
  const zip = new JSZip();
  const styles = new StyleBuilder();
  const sst = new SharedStrings();
  const contentOverrides: string[] = [];
  const definedNames: string[] = [];
  const usedNames = new Set<string>();
  const names = sheets.map((s, i) => {
    let nm = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet${i + 1}`;
    while (usedNames.has(nm.toLowerCase())) nm = `${nm.slice(0, 27)} (${i + 1})`;
    usedNames.add(nm.toLowerCase());
    return nm;
  });
  let tableSeq = 0;
  let commentSeq = 0;
  // The first visible sheet is active.
  const active = Math.max(0, sheets.findIndex((s) => !(s.hide === 1 || s.hide === true)));

  sheets.forEach((sheet, idx) => {
    const cfg = sheet.config ?? {};
    const borders = flattenBorders(cfg.borderInfo);
    const protection = sheetProtection(sheet);
    const except = protection.sheet?.except ?? [];
    const cells = sheetCells(sheet);
    const byKey = new Map<string, any>();
    for (const x of cells) byKey.set(`${x.r}_${x.c}`, x.cell);
    // Border-only cells and unlocked "except" cells need a <c> too.
    for (const k of borders.keys()) if (!byKey.has(k)) byKey.set(k, null);
    if (protection.sheet) {
      let budget = 10000;
      for (const x of except) {
        for (let r = Math.min(x.r1, x.r2); r <= Math.max(x.r1, x.r2) && budget > 0; r++)
          for (let c = Math.min(x.c1, x.c2); c <= Math.max(x.c1, x.c2) && budget > 0; c++, budget--) if (!byKey.has(`${r}_${c}`)) byKey.set(`${r}_${c}`, null);
      }
    }
    const rows = new Map<number, { c: number; xml: string }[]>();
    const comments: CommentOut[] = [];
    let maxR = 0;
    let maxC = 0;
    for (const [k, cell] of byKey) {
      const [r, c] = k.split("_").map(Number);
      const border: CellBorder | null = borders.get(k) ?? null;
      const unlocked = protection.sheet ? inRects(except, r, c) : false;
      const sIdx = styles.cellStyle(cell, border, unlocked);
      const val = cell ? cellValueXml(cell, sst) : { inner: "" };
      if (!val.inner && sIdx === 0) continue;
      const xml = `<c r="${cellRef(r, c)}"${sIdx ? ` s="${sIdx}"` : ""}${val.t ? ` t="${val.t}"` : ""}${val.inner ? `>${val.inner}</c>` : "/>"}`;
      let list = rows.get(r);
      if (!list) rows.set(r, (list = []));
      list.push({ c, xml });
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
      const ps = cell?.ps;
      if (ps && typeof ps.value === "string" && ps.value.trim()) comments.push({ r, c, text: ps.value });
    }
    const rowlen: Record<string, number> = cfg.rowlen ?? {};
    const rowhidden: Record<string, number> = cfg.rowhidden ?? {};
    const rowIdx = new Set<number>([...rows.keys(), ...Object.keys(rowlen).map(Number), ...Object.keys(rowhidden).map(Number)]);
    const defaultRowPx = Number(sheet.defaultRowHeight) || 19;
    const sheetData = [...rowIdx]
      .filter((r) => Number.isInteger(r) && r >= 0)
      .sort((a, b) => a - b)
      .map((r) => {
        const list = (rows.get(r) ?? []).sort((a, b) => a.c - b.c);
        const h = rowlen[String(r)];
        const custom = typeof h === "number" && Math.abs(h - defaultRowPx) > 0.01;
        const a = attrs({ r: r + 1, ht: custom ? pxToPt(h) : undefined, customHeight: custom ? 1 : undefined, hidden: String(r) in rowhidden ? 1 : undefined });
        return list.length ? `<row${a}>${list.map((x) => x.xml).join("")}</row>` : `<row${a}/>`;
      })
      .join("");

    // Columns.
    const columnlen: Record<string, number> = cfg.columnlen ?? {};
    const colhidden: Record<string, number> = cfg.colhidden ?? {};
    const colIdx = [...new Set([...Object.keys(columnlen), ...Object.keys(colhidden)].map(Number))].filter((c) => Number.isInteger(c) && c >= 0).sort((a, b) => a - b);
    const defaultColPx = Number(sheet.defaultColWidth) || 73;
    const cols = colIdx
      .map((c) => {
        const w = typeof columnlen[String(c)] === "number" ? columnlen[String(c)] : defaultColPx;
        return `<col${attrs({ min: c + 1, max: c + 1, width: pxToWidth(w), customWidth: 1, hidden: String(c) in colhidden ? 1 : undefined })}/>`;
      })
      .join("");

    // Merges.
    const merges = Object.values(cfg.merge ?? {})
      .filter((m: any) => m && Number(m.rs) >= 1 && Number(m.cs) >= 1 && (m.rs > 1 || m.cs > 1))
      .map((m: any) => `<mergeCell ref="${rectRef({ r1: m.r, c1: m.c, r2: m.r + m.rs - 1, c2: m.c + m.cs - 1 })}"/>`);

    // View.
    const view = sheetViewOptions(sheet);
    const pane = frozenPane(sheet.frozen);
    let paneXml = "";
    if (pane && (pane.xSplit || pane.ySplit)) {
      const activePane = pane.xSplit && pane.ySplit ? "bottomRight" : pane.ySplit ? "bottomLeft" : "topRight";
      paneXml =
        `<pane${attrs({ xSplit: pane.xSplit || undefined, ySplit: pane.ySplit || undefined, topLeftCell: cellRef(pane.ySplit, pane.xSplit), activePane, state: "frozen" })}/>` +
        `<selection pane="${activePane}" activeCell="${cellRef(pane.ySplit, pane.xSplit)}" sqref="${cellRef(pane.ySplit, pane.xSplit)}"/>`;
    }
    const zoom = Math.round(view.zoom * 100);
    const sheetView =
      `<sheetViews><sheetView${attrs({
        showFormulas: view.showFormulas ? 1 : undefined,
        showGridLines: view.showGridLines ? undefined : 0,
        showRowColHeaders: view.showHeadings ? undefined : 0,
        tabSelected: idx === active ? 1 : undefined,
        view: view.pageBreakPreview ? "pageBreakPreview" : undefined,
        zoomScale: zoom !== 100 ? Math.max(10, Math.min(400, zoom)) : undefined,
        workbookViewId: 0,
      })}>` +
      paneXml +
      "</sheetView></sheetViews>";

    // Print setup.
    const ps = sheetPrintSettings(sheet);
    const tab = toArgb(sheet.color);
    const sheetPr =
      tab || ps.fitToPage
        ? `<sheetPr>${tab ? `<tabColor rgb="${tab}"/>` : ""}${ps.fitToPage ? '<pageSetUpPr fitToPage="1"/>' : ""}</sheetPr>`
        : "";
    const printOptions =
      ps.gridLines || ps.headings || ps.hCenter || ps.vCenter
        ? `<printOptions${attrs({ horizontalCentered: ps.hCenter ? 1 : undefined, verticalCentered: ps.vCenter ? 1 : undefined, headings: ps.headings ? 1 : undefined, gridLines: ps.gridLines ? 1 : undefined })}/>`
        : "";
    const m = ps.margins;
    const pageMargins = `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}" header="${m.header}" footer="${m.footer}"/>`;
    const pageSetup = `<pageSetup${attrs({
      paperSize: PAPER[ps.paper]?.code ?? 1,
      scale: ps.scale !== 100 ? ps.scale : undefined,
      fitToWidth: ps.fitToPage && ps.fitToWidth !== 1 ? ps.fitToWidth : undefined,
      fitToHeight: ps.fitToPage && ps.fitToHeight !== 1 ? ps.fitToHeight : undefined,
      pageOrder: ps.pageOrder !== "downThenOver" ? ps.pageOrder : undefined,
      orientation: ps.orientation,
    })}/>`;
    const headerFooter =
      ps.header || ps.footer
        ? `<headerFooter>${ps.header ? `<oddHeader>${esc(headerFooterText(ps.header))}</oddHeader>` : ""}${ps.footer ? `<oddFooter>${esc(headerFooterText(ps.footer))}</oddFooter>` : ""}</headerFooter>`
        : "";
    const brk = (list: number[], max: number) => list.map((id) => `<brk id="${id}" max="${max}" man="1"/>`).join("");
    const rowBreaks = ps.rowBreaks.length ? `<rowBreaks count="${ps.rowBreaks.length}" manualBreakCount="${ps.rowBreaks.length}">${brk(ps.rowBreaks, 16383)}</rowBreaks>` : "";
    const colBreaks = ps.colBreaks.length ? `<colBreaks count="${ps.colBreaks.length}" manualBreakCount="${ps.colBreaks.length}">${brk(ps.colBreaks, 1048575)}</colBreaks>` : "";
    const qn = quoteSheet(names[idx]);
    if (ps.printArea) definedNames.push(`<definedName name="_xlnm.Print_Area" localSheetId="${idx}">${esc(`${qn}!${rectRef(ps.printArea, true)}`)}</definedName>`);
    if (ps.titleRows || ps.titleCols) {
      const parts: string[] = [];
      if (ps.titleCols) parts.push(`${qn}!$${colToLetters(ps.titleCols[0])}:$${colToLetters(ps.titleCols[1])}`);
      if (ps.titleRows) parts.push(`${qn}!$${ps.titleRows[0] + 1}:$${ps.titleRows[1] + 1}`);
      definedNames.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${idx}">${esc(parts.join(","))}</definedName>`);
    }

    // Filter.
    const filter = sheetFilter(sheet);
    const autoFilter = writeAutoFilter(filter);
    if (filter) definedNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${idx}" hidden="1">${esc(`${qn}!${rectRef(filter.range, true)}`)}</definedName>`);

    // Protection.
    const sheetProt = protection.sheet
      ? `<sheetProtection${attrs({ sheet: 1, objects: 1, scenarios: 1, formatCells: protection.sheet.allowFormat ? 0 : undefined })}/>`
      : "";
    let ext = "";
    if (protection.ranges.length) {
      const items = protection.ranges
        .map(
          (pr) =>
            `<g:protectedRange${attrs({ name: pr.name, sqref: pr.ranges.map((x) => rectRef(x)).join(" "), users: pr.users.join(" "), by: pr.by, description: pr.description })}/>`,
        )
        .join("");
      ext = `<extLst><ext uri="${GROWN_EXT_URI}" xmlns:g="${GROWN_EXT_NS}"><g:protectedRanges>${items}</g:protectedRanges></ext></extLst>`;
    }

    // Hyperlinks.
    const rels: string[] = [];
    const links: string[] = [];
    for (const [k, h] of Object.entries(sheet.hyperlink ?? {}) as [string, any][]) {
      const [r, c] = k.split("_").map(Number);
      if (!Number.isInteger(r) || !Number.isInteger(c) || !h?.linkAddress) continue;
      if (h.linkType === "webpage" || /^[a-z]+:/i.test(String(h.linkAddress))) {
        const rid = `rId${rels.length + 1}`;
        rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(h.linkAddress)}" TargetMode="External"/>`);
        links.push(`<hyperlink ref="${cellRef(r, c)}" r:id="${rid}"/>`);
      } else {
        links.push(`<hyperlink ref="${cellRef(r, c)}" location="${esc(h.linkAddress)}" display="${esc(h.linkAddress)}"/>`);
      }
    }

    // Comments.
    let legacyDrawing = "";
    if (comments.length) {
      commentSeq++;
      const cPath = `xl/comments${commentSeq}.xml`;
      const vPath = `xl/drawings/vmlDrawing${commentSeq}.vml`;
      zip.file(cPath, commentsXml(comments));
      zip.file(vPath, vmlXml(comments));
      contentOverrides.push(`<Override PartName="/${cPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`);
      const rc = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${rc}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${commentSeq}.xml"/>`);
      const rv = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${rv}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${commentSeq}.vml"/>`);
      legacyDrawing = `<legacyDrawing r:id="${rv}"/>`;
    }

    // Tables.
    const tableParts: string[] = [];
    for (const t of (Array.isArray(sheet.grownTables) ? sheet.grownTables : []) as TableModel[]) {
      if (!t?.ref) continue;
      tableSeq++;
      const tPath = `xl/tables/table${tableSeq}.xml`;
      zip.file(tPath, writeTable({ ...t, id: tableSeq }));
      contentOverrides.push(`<Override PartName="/${tPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
      const rid = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${tableSeq}.xml"/>`);
      tableParts.push(`<tablePart r:id="${rid}"/>`);
    }

    const cf = writeConditionalFormatting(sheetCF(sheet), (s) => styles.dxf(s));
    const dv = writeDataValidations(sheetDV(sheet));
    const dim = byKey.size ? `${cellRef(0, 0)}:${cellRef(maxR, maxC)}` : "A1";
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      sheetPr +
      `<dimension ref="${dim}"/>` +
      sheetView +
      `<sheetFormatPr${attrs({ defaultColWidth: pxToWidth(defaultColPx), defaultRowHeight: pxToPt(defaultRowPx), customHeight: defaultRowPx !== 20 ? 1 : undefined })}/>` +
      (cols ? `<cols>${cols}</cols>` : "") +
      `<sheetData>${sheetData}</sheetData>` +
      sheetProt +
      autoFilter +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "") +
      cf +
      dv +
      (links.length ? `<hyperlinks>${links.join("")}</hyperlinks>` : "") +
      printOptions +
      pageMargins +
      pageSetup +
      headerFooter +
      rowBreaks +
      colBreaks +
      legacyDrawing +
      (tableParts.length ? `<tableParts count="${tableParts.length}">${tableParts.join("")}</tableParts>` : "") +
      ext +
      "</worksheet>";
    zip.file(`xl/worksheets/sheet${idx + 1}.xml`, xml);
    if (rels.length) {
      zip.file(
        `xl/worksheets/_rels/sheet${idx + 1}.xml.rels`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`,
      );
    }
  });

  // Named ranges (workbook scope, stored on the first sheet).
  const nr: any[] = Array.isArray(sheets[0]?._namedRanges) ? sheets[0]._namedRanges : [];
  for (const n of nr) {
    if (!n?.name || !n?.range) continue;
    const range = String(n.range).replace(/^=/, "");
    const ref = range.includes("!") ? range.replace(/!(.*)$/, (_m, r) => "!" + absRange(r)) : `${quoteSheet(String(n.sheetName || names[0]))}!${absRange(range)}`;
    definedNames.push(`<definedName name="${esc(n.name)}">${esc(ref)}</definedName>`);
  }

  const sheetEntries = sheets
    .map((s, i) => `<sheet name="${esc(names[i])}" sheetId="${i + 1}"${s.hide === 1 || s.hide === true ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`)
    .join("");
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<workbookPr defaultThemeVersion="164011"/>' +
      `<bookViews><workbookView activeTab="${active}"/></bookViews>` +
      `<sheets>${sheetEntries}</sheets>` +
      (definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : "") +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      "</workbook>",
  );
  const n = sheets.length;
  const wbRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
  wbRels.push(`<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  wbRels.push(`<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`);
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join("")}</Relationships>`,
  );
  zip.file("xl/styles.xml", styles.xml());
  zip.file("xl/sharedStrings.xml", sst.xml());
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "docProps/core.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      (opts.title ? `<dc:title>${esc(opts.title)}</dc:title>` : "") +
      `<dc:creator>Grown</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      "</cp:coreProperties>",
  );
  zip.file(
    "docProps/app.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Grown Sheets</Application></Properties>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>",
  );
  const sheetOverrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheetOverrides +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      contentOverrides.join("") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      "</Types>",
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
