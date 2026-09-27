/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */

// .xlsx → FortuneSheet sheets with Grown models, read part by part with JSZip
// and DOMParser. Formulas keep their text (the Go engine recomputes on save
// through the recalc path); cached values are kept so the grid shows results
// at once. The inverse of xlsxWrite.ts.

import JSZip from "jszip";
import type { CellRect } from "../cellRange";
import { translateFormula } from "../formulaShift";
import type { NamedRange } from "../NamedRangesDialog";
import { defaultPrintSettings, PAPER, type PaperSize, type PrintSettings } from "../printSettings";
import type { ProtectionModel } from "../protection";
import {
  NS_MAIN,
  all,
  attr,
  boolAttr,
  dirOf,
  kid,
  kids,
  numAttr,
  parseCellRef,
  parseRef,
  parseSqref,
  parseXml,
  ptToPx,
  readColor,
  readRels,
  readTheme,
  relsPathFor,
  resolvePath,
  text,
  widthToPx,
  type Rel,
} from "./ooxml";
import { bordersToInfo, isDateFormat, readStyles, type CellBorder, type ReadStyles } from "./xlsxStyles";
import { readAutoFilter, readConditionalFormatting, readDataValidations } from "./xlsxRules";
import { readTable, type TableModel } from "./xlsxTables";
import { GROWN_EXT_URI } from "./xlsxWrite";
import { readChartSpace, readDrawingAnchors } from "./xlsxCharts";
import type { ChartConfig } from "../chartData";

export interface ImportedWorkbook {
  /** FortuneSheet sheets (stored form: celldata), Grown models attached. */
  sheets: any[];
  namedRanges: NamedRange[];
  /** Things the importer could not carry over (shown to the user). */
  warnings: string[];
}

export interface ReadOptions {
  /** The importing user; becomes the author of imported protections. */
  userId?: string;
  /** Prefix for generated sheet ids. */
  idPrefix?: string;
}

/** Strips the file-format prefixes of newer functions and LAMBDA parameters. */
export function unprefixFormula(f: string): string {
  return f.replace(/_xlfn\.|_xlws\.|_xlpm\./g, "");
}

async function readPart(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path) ?? zip.file(Object.keys(zip.files).find((k) => k.toLowerCase() === path.toLowerCase()) ?? "\0");
  if (!file) return null;
  return parseXml(await file.async("string"));
}

async function partRels(zip: JSZip, path: string): Promise<Rel[]> {
  return readRels(await readPart(zip, relsPathFor(path)));
}

function relTarget(rels: Rel[], base: string, pred: (r: Rel) => boolean): string | null {
  const r = rels.find(pred);
  return r ? resolvePath(dirOf(base), r.target) : null;
}

const isType = (suffix: string) => (r: Rel) => r.type.endsWith("/" + suffix);

/** A shared string item (<si>): plain text, or rich-text runs. */
function readSi(si: Element, theme: string[]): { text: string; runs: any[] | null } {
  const runs = kids(si, "r");
  if (!runs.length) return { text: text(kid(si, "t")), runs: null };
  const out = runs.map((r) => {
    const pr = kid(r, "rPr");
    const run: any = { v: text(kid(r, "t")) };
    if (pr) {
      if (kid(pr, "b") && boolAttr(kid(pr, "b"), "val", true)) run.bl = 1;
      if (kid(pr, "i") && boolAttr(kid(pr, "i"), "val", true)) run.it = 1;
      if (kid(pr, "strike") && boolAttr(kid(pr, "strike"), "val", true)) run.cl = 1;
      if (kid(pr, "u") && attr(kid(pr, "u"), "val") !== "none") run.un = 1;
      const sz = numAttr(kid(pr, "sz"), "val");
      if (sz !== null) run.fs = sz;
      const fc = readColor(kid(pr, "color"), theme);
      if (fc) run.fc = fc;
      const ff = attr(kid(pr, "rFont"), "val");
      if (ff) run.ff = ff;
    }
    return run;
  });
  return { text: out.map((r) => r.v).join(""), runs: out };
}

function isoToSerial(s: string): number | null {
  const d = new Date(s.endsWith("Z") || /[+-]\d\d:\d\d$/.test(s) ? s : s + "Z");
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime() / 86400000 + 25569;
}

function printFromSheet(ws: Element): PrintSettings | null {
  const pm = kid(ws, "pageMargins");
  const setup = kid(ws, "pageSetup");
  const po = kid(ws, "printOptions");
  const hf = kid(ws, "headerFooter");
  const rb = kid(ws, "rowBreaks");
  const cb = kid(ws, "colBreaks");
  const fit = boolAttr(kid(kid(ws, "sheetPr"), "pageSetUpPr"), "fitToPage");
  if (!pm && !setup && !po && !hf && !rb && !cb && !fit) return null;
  const s = defaultPrintSettings();
  if (pm) {
    for (const k of ["left", "right", "top", "bottom", "header", "footer"] as const) {
      const v = numAttr(pm, k);
      if (v !== null) s.margins[k] = v;
    }
  }
  if (setup) {
    const o = attr(setup, "orientation");
    if (o === "landscape" || o === "portrait") s.orientation = o;
    const code = numAttr(setup, "paperSize");
    const paper = (Object.entries(PAPER).find(([, p]) => p.code === code)?.[0] ?? "letter") as PaperSize;
    s.paper = paper;
    s.scale = numAttr(setup, "scale") ?? 100;
    s.fitToWidth = numAttr(setup, "fitToWidth") ?? 1;
    s.fitToHeight = numAttr(setup, "fitToHeight") ?? 1;
    if (attr(setup, "pageOrder") === "overThenDown") s.pageOrder = "overThenDown";
  }
  s.fitToPage = fit;
  if (po) {
    s.gridLines = boolAttr(po, "gridLines");
    s.headings = boolAttr(po, "headings");
    s.hCenter = boolAttr(po, "horizontalCentered");
    s.vCenter = boolAttr(po, "verticalCentered");
  }
  if (hf) {
    const clean = (x: string) => x.replace(/^&C(?!.*&[LR])/, "");
    s.header = clean(text(kid(hf, "oddHeader")));
    s.footer = clean(text(kid(hf, "oddFooter")));
  }
  const brks = (el: Element | null) =>
    kids(el, "brk")
      .filter((b) => boolAttr(b, "man", false) || attr(b, "man") === null)
      .map((b) => numAttr(b, "id") ?? 0)
      .filter((x) => x > 0);
  s.rowBreaks = brks(rb);
  s.colBreaks = brks(cb);
  return s;
}

/** Reads an .xlsx package. Throws when the data is not a spreadsheet package. */
export async function readXlsx(data: ArrayBuffer | Uint8Array | Blob, opts: ReadOptions = {}): Promise<ImportedWorkbook> {
  const zip = await JSZip.loadAsync(data);
  const warnings: string[] = [];
  const rootRels = readRels(await readPart(zip, "_rels/.rels"));
  const wbPath = relTarget(rootRels, "", (r) => r.type.endsWith("/officeDocument")) ?? "xl/workbook.xml";
  const wbDoc = await readPart(zip, wbPath);
  if (!wbDoc) throw new Error("Not an Excel workbook (no xl/workbook.xml)");
  if (wbDoc.documentElement.namespaceURI !== NS_MAIN && wbDoc.documentElement.localName !== "workbook") {
    throw new Error("Unsupported workbook format");
  }
  const wbRels = await partRels(zip, wbPath);
  const theme = readTheme(await readPart(zip, relTarget(wbRels, wbPath, isType("theme")) ?? "xl/theme/theme1.xml"));
  const styles: ReadStyles = readStyles(await readPart(zip, relTarget(wbRels, wbPath, isType("styles")) ?? "xl/styles.xml"), theme);
  const sstDoc = await readPart(zip, relTarget(wbRels, wbPath, isType("sharedStrings")) ?? "xl/sharedStrings.xml");
  const sst = sstDoc ? kids(sstDoc.documentElement, "si").map((si) => readSi(si, theme)) : [];
  const date1904 = boolAttr(kid(wbDoc.documentElement, "workbookPr"), "date1904");

  const sheetEls = kids(kid(wbDoc.documentElement, "sheets"), "sheet");
  const sheetNames = sheetEls.map((el) => attr(el, "name") ?? "Sheet");
  const prefix = opts.idPrefix ?? `x${Date.now().toString(36)}`;
  const sheets: any[] = [];
  const charts: ChartConfig[] = [];

  // Defined names: print areas/titles per sheet, the rest become named ranges.
  const printArea = new Map<number, CellRect>();
  const printTitles = new Map<number, { rows: [number, number] | null; cols: [number, number] | null }>();
  const namedRanges: NamedRange[] = [];
  for (const dn of all(kid(wbDoc.documentElement, "definedNames"), "definedName")) {
    const name = attr(dn, "name") ?? "";
    const local = numAttr(dn, "localSheetId");
    const ref = text(dn).trim();
    if (name === "_xlnm.Print_Area" && local !== null) {
      const r = parseRef(ref.split(",")[0]);
      if (r) printArea.set(local, r);
      continue;
    }
    if (name === "_xlnm.Print_Titles" && local !== null) {
      const t = { rows: null as [number, number] | null, cols: null as [number, number] | null };
      for (const part of ref.split(",")) {
        const p = part.replace(/^.*!/, "").replace(/\$/g, "");
        let m = /^(\d+):(\d+)$/.exec(p);
        if (m) t.rows = [Number(m[1]) - 1, Number(m[2]) - 1];
        m = /^([A-Za-z]+):([A-Za-z]+)$/.exec(p);
        if (m) {
          const a = parseRef(`${m[1]}1`);
          const b = parseRef(`${m[2]}1`);
          if (a && b) t.cols = [a.c1, b.c1];
        }
      }
      printTitles.set(local, t);
      continue;
    }
    if (name.startsWith("_xlnm.") || boolAttr(dn, "hidden")) continue;
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)$/.exec(ref);
    if (!m) {
      warnings.push(`Named range "${name}" is not a cell range and was skipped.`);
      continue;
    }
    const sheetName = (m[1] ?? m[2]).replace(/''/g, "'");
    const idx = sheetNames.indexOf(sheetName);
    namedRanges.push({
      name,
      range: m[3].replace(/\$/g, ""),
      sheetId: idx >= 0 ? `${prefix}-${idx}` : "",
      sheetName,
    });
  }

  for (let si = 0; si < sheetEls.length; si++) {
    const el = sheetEls[si];
    const rid = attr(el, "id");
    const rel = wbRels.find((r) => r.id === rid);
    const path = rel ? resolvePath(dirOf(wbPath), rel.target) : `xl/worksheets/sheet${si + 1}.xml`;
    const doc = await readPart(zip, path);
    if (!doc || doc.documentElement.localName !== "worksheet") {
      warnings.push(`Sheet "${sheetNames[si]}" is not a worksheet (chart sheet or macro sheet) and was skipped.`);
      continue;
    }
    const ws = doc.documentElement;
    const rels = await partRels(zip, path);
    const sheet: any = {
      name: sheetNames[si],
      id: `${prefix}-${si}`,
      order: sheets.length,
      status: 0,
      celldata: [],
      config: {},
    };
    const state = attr(el, "state");
    if (state === "hidden" || state === "veryHidden") sheet.hide = 1;
    const tab = readColor(kid(kid(ws, "sheetPr"), "tabColor"), theme);
    if (tab) sheet.color = tab;

    // Sheet view.
    const view = kids(kid(ws, "sheetViews"), "sheetView")[0] ?? null;
    if (view) {
      if (attr(view, "showGridLines") !== null && !boolAttr(view, "showGridLines", true)) sheet.showGridLines = 0;
      const gv: any = {};
      if (boolAttr(view, "showFormulas")) gv.showFormulas = true;
      if (attr(view, "showRowColHeaders") !== null && !boolAttr(view, "showRowColHeaders", true)) gv.showHeadings = false;
      if (attr(view, "view") === "pageBreakPreview") gv.pageBreakPreview = true;
      if (Object.keys(gv).length) sheet.grownView = gv;
      const zoom = numAttr(view, "zoomScale");
      if (zoom && zoom !== 100) sheet.zoomRatio = Math.max(0.1, Math.min(4, zoom / 100));
      const pane = kid(view, "pane");
      const st = attr(pane, "state");
      if (pane && (st === "frozen" || st === "frozenSplit")) {
        const x = Math.round(numAttr(pane, "xSplit") ?? 0);
        const y = Math.round(numAttr(pane, "ySplit") ?? 0);
        if (x > 0 && y > 0) sheet.frozen = { type: "rangeBoth", range: { row_focus: y - 1, column_focus: x - 1 } };
        else if (y > 0) sheet.frozen = { type: "rangeRow", range: { row_focus: y - 1, column_focus: 0 } };
        else if (x > 0) sheet.frozen = { type: "rangeColumn", range: { row_focus: 0, column_focus: x - 1 } };
      }
    }

    // Default sizes.
    const fmtPr = kid(ws, "sheetFormatPr");
    const defRowPt = numAttr(fmtPr, "defaultRowHeight");
    const defRowPx = defRowPt ? ptToPx(defRowPt) : 20;
    sheet.defaultRowHeight = defRowPx;
    const defColW = numAttr(fmtPr, "defaultColWidth");
    const baseColW = numAttr(fmtPr, "baseColWidth");
    // Without an explicit default, Excel shows baseColWidth (8) digits plus padding: 64 px for 8.
    sheet.defaultColWidth = defColW !== null ? widthToPx(defColW) : Math.round((baseColW ?? 8) * 7 + 8);

    // Columns.
    const columnlen: Record<string, number> = {};
    const colhidden: Record<string, number> = {};
    for (const col of kids(kid(ws, "cols"), "col")) {
      const min = (numAttr(col, "min") ?? 1) - 1;
      const max = Math.min((numAttr(col, "max") ?? min + 1) - 1, min + 1000, 16383);
      const w = numAttr(col, "width");
      const hidden = boolAttr(col, "hidden");
      for (let c = min; c <= max; c++) {
        if (w !== null && (boolAttr(col, "customWidth") || Math.abs(widthToPx(w) - sheet.defaultColWidth) > 1)) columnlen[String(c)] = widthToPx(w);
        if (hidden) colhidden[String(c)] = 0;
      }
    }

    // Cells.
    const rowlen: Record<string, number> = {};
    const rowhidden: Record<string, number> = {};
    const borders = new Map<string, CellBorder>();
    const shared = new Map<string, { f: string; r: number; c: number }>();
    const cells = new Map<string, any>();
    let maxR = 0;
    let maxC = 0;
    let rowCursor = -1;
    for (const row of kids(kid(ws, "sheetData"), "row")) {
      const r = (numAttr(row, "r") ?? rowCursor + 2) - 1;
      rowCursor = r;
      const ht = numAttr(row, "ht");
      if (ht !== null && (boolAttr(row, "customHeight") || Math.abs(ptToPx(ht) - defRowPx) > 1)) rowlen[String(r)] = ptToPx(ht);
      if (boolAttr(row, "hidden")) rowhidden[String(r)] = 0;
      let colCursor = -1;
      for (const c of kids(row, "c")) {
        const pos = parseCellRef(attr(c, "r") ?? "") ?? { r, c: colCursor + 1 };
        colCursor = pos.c;
        const sIdx = numAttr(c, "s") ?? 0;
        const style = styles.xfs[sIdx] ?? styles.xfs[0];
        const t = attr(c, "t") ?? "n";
        const vEl = kid(c, "v");
        const fEl = kid(c, "f");
        const cell: any = {};
        if (style) Object.assign(cell, style.cell);
        const fmt = style?.fmt ?? "General";
        // Formula (shared formulas are expanded from their anchor).
        if (fEl) {
          const ft = attr(fEl, "t");
          const si = attr(fEl, "si");
          const body = text(fEl);
          if (ft === "shared" && si !== null) {
            if (body) {
              shared.set(si, { f: "=" + unprefixFormula(body), r: pos.r, c: pos.c });
              cell.f = "=" + unprefixFormula(body);
            } else {
              const anchor = shared.get(si);
              if (anchor) cell.f = translateFormula(anchor.f, pos.r - anchor.r, pos.c - anchor.c);
            }
          } else if (body) {
            cell.f = "=" + unprefixFormula(body);
          }
        }
        // Value.
        let v: any = null;
        let runs: any[] | null = null;
        const raw = vEl ? text(vEl) : null;
        switch (t) {
          case "s": {
            const item = sst[Number(raw)];
            if (item) {
              v = item.text;
              runs = item.runs;
            }
            break;
          }
          case "inlineStr": {
            const is = kid(c, "is");
            if (is) {
              const item = readSi(is, theme);
              v = item.text;
              runs = item.runs;
            }
            break;
          }
          case "str":
            v = raw ?? "";
            break;
          case "b":
            v = raw === "1" || raw === "true";
            break;
          case "e":
            v = raw ?? "#N/A";
            break;
          case "d":
            v = raw ? isoToSerial(raw) : null;
            break;
          default:
            v = raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
        }
        if (typeof v === "number" && date1904 && isDateFormat(fmt)) v += 1462;
        if (runs && runs.length > 1 && !cell.f) {
          cell.ct = { fa: fmt, t: "inlineStr", s: runs };
        } else if (v !== null && v !== undefined) {
          cell.v = v;
          if (typeof v === "number") cell.ct = { fa: fmt, t: isDateFormat(fmt) ? "d" : "n" };
          else if (typeof v === "boolean") {
            cell.ct = { fa: "General", t: "b" };
            cell.m = v ? "TRUE" : "FALSE";
          } else {
            cell.ct = { fa: fmt, t: fmt === "@" ? "s" : "g" };
            cell.m = String(v);
          }
        } else if (fmt !== "General") {
          cell.ct = { fa: fmt, t: isDateFormat(fmt) ? "d" : fmt === "@" ? "s" : "n" };
        }
        if (cell.f && cell.v === undefined) {
          cell.v = "";
          cell.m = "";
        }
        if (style && !style.locked) cell.lo = 0;
        if (style?.border) borders.set(`${pos.r}_${pos.c}`, style.border);
        if (Object.keys(cell).length) {
          cells.set(`${pos.r}_${pos.c}`, cell);
          maxR = Math.max(maxR, pos.r);
          maxC = Math.max(maxC, pos.c);
        }
      }
    }

    // Merges.
    const merge: Record<string, any> = {};
    for (const mc of kids(kid(ws, "mergeCells"), "mergeCell")) {
      const rect = parseRef(attr(mc, "ref") ?? "");
      if (!rect || (rect.r1 === rect.r2 && rect.c1 === rect.c2)) continue;
      const rs = rect.r2 - rect.r1 + 1;
      const cs = rect.c2 - rect.c1 + 1;
      if (rs * cs > 100000) continue;
      merge[`${rect.r1}_${rect.c1}`] = { r: rect.r1, c: rect.c1, rs, cs };
      for (let r = rect.r1; r <= rect.r2; r++) {
        for (let c = rect.c1; c <= rect.c2; c++) {
          const k = `${r}_${c}`;
          const cell = cells.get(k) ?? {};
          if (r === rect.r1 && c === rect.c1) cell.mc = { r, c, rs, cs };
          else {
            // Covered cells hold no value.
            delete cell.v;
            delete cell.m;
            delete cell.f;
            cell.mc = { r: rect.r1, c: rect.c1 };
          }
          cells.set(k, cell);
        }
      }
      maxR = Math.max(maxR, rect.r2);
      maxC = Math.max(maxC, rect.c2);
    }

    // Hyperlinks.
    const hyperlink: Record<string, any> = {};
    for (const h of kids(kid(ws, "hyperlinks"), "hyperlink")) {
      const rect = parseRef(attr(h, "ref") ?? "");
      if (!rect) continue;
      const hr = rels.find((x) => x.id === attr(h, "id"));
      const loc = attr(h, "location");
      if (hr?.target) hyperlink[`${rect.r1}_${rect.c1}`] = { linkType: "webpage", linkAddress: hr.target };
      else if (loc) hyperlink[`${rect.r1}_${rect.c1}`] = { linkType: "cellrange", linkAddress: loc };
    }
    if (Object.keys(hyperlink).length) sheet.hyperlink = hyperlink;

    // Comments.
    const commentsPath = relTarget(rels, path, isType("comments"));
    if (commentsPath) {
      const cd = await readPart(zip, commentsPath);
      for (const cm of all(cd, "comment")) {
        const p = parseCellRef(attr(cm, "ref") ?? "");
        if (!p) continue;
        const t = all(cm, "t")
          .map((x) => text(x))
          .join("");
        const k = `${p.r}_${p.c}`;
        const cell = cells.get(k) ?? {};
        cell.ps = { left: null, top: null, width: null, height: null, value: t, isShow: false };
        cells.set(k, cell);
      }
    }

    // Tables.
    const tables: TableModel[] = [];
    for (const tp of kids(kid(ws, "tableParts"), "tablePart")) {
      const tr = rels.find((x) => x.id === attr(tp, "id"));
      if (!tr) continue;
      const td = await readPart(zip, resolvePath(dirOf(path), tr.target));
      const t = td ? readTable(td) : null;
      if (t) tables.push(t);
    }
    if (tables.length) sheet.grownTables = tables;

    // Protection.
    const prot: ProtectionModel = { sheet: null, ranges: [] };
    const sp = kid(ws, "sheetProtection");
    if (sp && boolAttr(sp, "sheet")) {
      prot.sheet = { users: [], by: opts.userId, except: [], allowFormat: attr(sp, "formatCells") === "0" || undefined };
      for (const pr of kids(kid(ws, "protectedRanges"), "protectedRange")) prot.sheet.except.push(...parseSqref(attr(pr, "sqref")));
    }
    for (const ext of all(kid(ws, "extLst"), "ext")) {
      if (attr(ext, "uri") !== GROWN_EXT_URI) continue;
      for (const pr of all(ext, "protectedRange")) {
        const users = (attr(pr, "users") ?? "").split(/\s+/).filter(Boolean);
        prot.ranges.push({
          id: `pr-x${prot.ranges.length}-${prefix}`,
          name: attr(pr, "name") ?? `Range ${prot.ranges.length + 1}`,
          ranges: parseSqref(attr(pr, "sqref")),
          users,
          by: attr(pr, "by") ?? opts.userId,
          description: attr(pr, "description") ?? undefined,
        });
      }
    }
    if (prot.sheet || prot.ranges.length) sheet.grownProtection = prot;

    // Rules.
    const cf = readConditionalFormatting(ws, styles.dxfs, theme);
    if (cf.length) sheet.grownCF = cf;
    const dv = readDataValidations(ws);
    if (dv.length) sheet.grownDV = dv;
    const filter = readAutoFilter(kid(ws, "autoFilter"));
    if (filter) {
      sheet.grownFilter = filter;
      sheet.filter_select = { row: [filter.range.r1, filter.range.r2], column: [filter.range.c1, filter.range.c2] };
    }

    // Print.
    const ps = printFromSheet(ws);
    const area = printArea.get(si);
    const titles = printTitles.get(si);
    if (ps || area || titles) {
      const s = ps ?? defaultPrintSettings();
      if (area) s.printArea = area;
      if (titles) {
        s.titleRows = titles.rows;
        s.titleCols = titles.cols;
      }
      sheet.grownPrint = s;
    }
    const drawingEl = kid(ws, "drawing");
    if (drawingEl) {
      const rid = drawingEl.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? attr(drawingEl, "id");
      const dRel = rels.find((r) => r.id === rid);
      const dPath = dRel ? resolvePath(dirOf(path), dRel.target) : null;
      const dDoc = dPath ? await readPart(zip, dPath) : null;
      let other = 0;
      if (dDoc && dPath) {
        const dRels = await partRels(zip, dPath);
        const colPx = (c: number) => (columnlen[String(c)] ?? 73) + 1;
        const rowPx = (r: number) => (rowlen[String(r)] ?? 19) + 1;
        const anchors = readDrawingAnchors(dDoc, colPx, rowPx);
        other = Array.from(dDoc.documentElement.children).filter((a) => /Anchor$/.test(a.localName)).length - anchors.length;
        for (const a of anchors) {
          const cRel = dRels.find((r) => r.id === a.rid);
          const cDoc = cRel ? await readPart(zip, resolvePath(dirOf(dPath), cRel.target)) : null;
          const got = cDoc ? readChartSpace(cDoc) : null;
          if (!got) {
            other++;
            continue;
          }
          const dataSheet = got.sheet === null ? si : sheetNames.indexOf(got.sheet);
          charts.push({
            ...got.cfg,
            id: `chart-${prefix}-${charts.length}`,
            sheetId: `${prefix}-${dataSheet >= 0 ? dataSheet : si}`,
            anchor: a.anchor,
          } as ChartConfig);
        }
      }
      if (other > 0) warnings.push(`Images, shapes or unsupported charts on "${sheet.name}" were not imported.`);
    }

    sheet.config = {
      ...(Object.keys(merge).length ? { merge } : {}),
      ...(Object.keys(rowlen).length ? { rowlen } : {}),
      ...(Object.keys(columnlen).length ? { columnlen } : {}),
      ...(Object.keys(rowhidden).length ? { rowhidden } : {}),
      ...(Object.keys(colhidden).length ? { colhidden } : {}),
      ...(borders.size ? { borderInfo: bordersToInfo(borders) } : {}),
    };
    sheet.celldata = [...cells.entries()]
      .map(([k, v]) => {
        const [r, c] = k.split("_").map(Number);
        return { r, c, v };
      })
      .sort((a, b) => a.r - b.r || a.c - b.c);
    sheet.row = Math.max(100, maxR + 21);
    sheet.column = Math.max(26, maxC + 6);
    sheets.push(sheet);
  }
  if (!sheets.length) throw new Error("The workbook has no worksheets");
  if (namedRanges.length) sheets[0]._namedRanges = namedRanges;
  if (charts.length) sheets[0].grownCharts = charts;
  return { sheets, namedRanges, warnings };
}
