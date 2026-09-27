/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet workbooks are loosely typed. */

// File ▸ Import: reads a spreadsheet file into FortuneSheet sheets and merges
// it into the open workbook the way Google Sheets offers (new spreadsheet,
// insert new sheets, replace the spreadsheet, replace the current sheet,
// append rows, replace data at the selected cell).
//
//   .xlsx / .xlsm        xlsx/xlsxRead.ts (full fidelity: formats, rules, print, protection)
//   .ods / .xls / .xlsb  SheetJS CE (values, formulas, number formats, merges, sizes, names)
//   .csv / .tsv / .txt   csvText.ts (delimiter detection, quoted fields)

import { colToLetters, typedCell } from "./cellValue";
import { guessDelimiter, parseDelimited } from "./csvText";
import { renameSheetInFormula } from "./formulaRefs";
import type { NamedRange } from "./NamedRangesDialog";
import { readXlsx, type ImportedWorkbook } from "./xlsx/xlsxRead";
import { convertOnServer, needsServerConversion, officeConvertCaps } from "../../lib/officeConvert";

export type { ImportedWorkbook };

export type ImportKind = "xlsx" | "sheetjs" | "csv";

export type ImportMode =
  | "newSpreadsheet"
  | "insertSheets"
  | "replaceSpreadsheet"
  | "replaceSheet"
  | "appendRows"
  | "replaceAtCell";

export const IMPORT_MODES: { mode: ImportMode; label: string }[] = [
  { mode: "newSpreadsheet", label: "Create new spreadsheet" },
  { mode: "insertSheets", label: "Insert new sheet(s)" },
  { mode: "replaceSpreadsheet", label: "Replace spreadsheet" },
  { mode: "replaceSheet", label: "Replace current sheet" },
  { mode: "appendRows", label: "Append to current sheet" },
  { mode: "replaceAtCell", label: "Replace data at selected cell" },
];

export const IMPORT_ACCEPT = ".xlsx,.xlsm,.xls,.xlsb,.ods,.fods,.csv,.tsv,.txt";

/** How a file will be read, from its name and first bytes. */
export function importKind(name: string, head?: Uint8Array): ImportKind | null {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  const zip = !!head && head[0] === 0x50 && head[1] === 0x4b;
  if (ext === "xlsx" || ext === "xlsm" || ext === "xltx") return zip || !head ? "xlsx" : "sheetjs";
  if (ext === "ods" || ext === "xls" || ext === "xlsb" || ext === "fods" || ext === "ots") return "sheetjs";
  if (ext === "csv" || ext === "tsv" || ext === "txt" || ext === "tab") return "csv";
  if (zip) return "xlsx";
  return null;
}

export interface CsvImportOptions {
  /** Separator; undefined detects it. */
  delimiter?: string;
  /** Convert text to numbers, dates and formulas (default true). */
  convert?: boolean;
  name?: string;
}

/** Delimited text → one sheet. */
export function csvToWorkbook(textIn: string, opts: CsvImportOptions = {}): ImportedWorkbook {
  const text = textIn.replace(/^﻿/, "");
  const delimiter = opts.delimiter ?? (guessDelimiter(text) || ",");
  const rows = parseDelimited(text, { delimiter });
  const convert = opts.convert !== false;
  const celldata: any[] = [];
  let maxC = 0;
  rows.forEach((row, r) =>
    row.forEach((field, c) => {
      if (field === "") return;
      const cell = convert ? typedCell(field) : { v: field, m: field, ct: { fa: "@", t: "s" } };
      if (cell) {
        celldata.push({ r, c, v: cell });
        maxC = Math.max(maxC, c);
      }
    }),
  );
  return {
    sheets: [
      {
        name: opts.name || "Sheet1",
        id: `csv${Date.now().toString(36)}`,
        order: 0,
        status: 0,
        row: Math.max(100, rows.length + 20),
        column: Math.max(26, maxC + 6),
        celldata,
        config: {},
      },
    ],
    namedRanges: [],
    warnings: [],
  };
}

/** .ods / .xls / .xlsb (and odd .xlsx) through SheetJS Community Edition. */
export async function sheetjsToWorkbook(bytes: Uint8Array): Promise<ImportedWorkbook> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellFormula: true, cellNF: true, cellStyles: true });
  const warnings: string[] = [
    "This file type is imported with values, formulas, number formats, merges and sizes; styles, conditional formatting and validation are not read.",
  ];
  const prefix = `s${Date.now().toString(36)}`;
  const sheets = wb.SheetNames.map((name, si) => {
    const ws: any = wb.Sheets[name];
    const celldata: any[] = [];
    let maxR = 0;
    let maxC = 0;
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith("!")) continue;
      const x = ws[addr];
      const { r, c } = XLSX.utils.decode_cell(addr);
      const cell: any = {};
      if (x.f) cell.f = "=" + String(x.f).replace(/_xlfn\.|_xlws\./g, "");
      const fmt = typeof x.z === "string" ? x.z : "General";
      switch (x.t) {
        case "n":
          cell.v = x.v;
          cell.ct = { fa: fmt, t: /[dyhs]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]/g, "")) && fmt !== "General" ? "d" : "n" };
          break;
        case "b":
          cell.v = !!x.v;
          cell.m = x.v ? "TRUE" : "FALSE";
          cell.ct = { fa: "General", t: "b" };
          break;
        case "e":
          cell.v = x.w ?? "#N/A";
          cell.m = cell.v;
          break;
        case "d": {
          const d = x.v instanceof Date ? x.v : new Date(x.v);
          cell.v = d.getTime() / 86400000 + 25569;
          cell.ct = { fa: fmt === "General" ? "m/d/yyyy" : fmt, t: "d" };
          break;
        }
        case "s":
          cell.v = String(x.v ?? "");
          cell.m = cell.v;
          cell.ct = { fa: fmt, t: fmt === "@" ? "s" : "g" };
          break;
        default:
          break;
      }
      if (Array.isArray(x.c) && x.c.length) {
        cell.ps = { left: null, top: null, width: null, height: null, value: x.c.map((cm: any) => cm.t ?? "").join("\n"), isShow: false };
      }
      if (cell.f && cell.v === undefined) {
        cell.v = "";
        cell.m = "";
      }
      if (!Object.keys(cell).length) continue;
      celldata.push({ r, c, v: cell });
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    const config: any = {};
    const merges: any[] = ws["!merges"] ?? [];
    if (merges.length) {
      config.merge = {};
      const byKey = new Map(celldata.map((cd) => [`${cd.r}_${cd.c}`, cd]));
      for (const m of merges) {
        const rs = m.e.r - m.s.r + 1;
        const cs = m.e.c - m.s.c + 1;
        config.merge[`${m.s.r}_${m.s.c}`] = { r: m.s.r, c: m.s.c, rs, cs };
        for (let r = m.s.r; r <= m.e.r; r++) {
          for (let c = m.s.c; c <= m.e.c; c++) {
            let cd = byKey.get(`${r}_${c}`);
            if (!cd) {
              cd = { r, c, v: {} };
              byKey.set(`${r}_${c}`, cd);
              celldata.push(cd);
            }
            cd.v.mc = r === m.s.r && c === m.s.c ? { r, c, rs, cs } : { r: m.s.r, c: m.s.c };
          }
        }
      }
    }
    const cols: any[] = ws["!cols"] ?? [];
    cols.forEach((col, c) => {
      if (!col) return;
      const px = col.wpx ?? (col.wch ? Math.round(col.wch * 7 + 5) : col.width ? Math.round(col.width * 7 + 5) : null);
      if (px) (config.columnlen ??= {})[String(c)] = px;
      if (col.hidden) (config.colhidden ??= {})[String(c)] = 0;
    });
    const rowsInfo: any[] = ws["!rows"] ?? [];
    rowsInfo.forEach((row, r) => {
      if (!row) return;
      const px = row.hpx ?? (row.hpt ? Math.round((row.hpt * 96) / 72) : null);
      if (px) (config.rowlen ??= {})[String(r)] = px;
      if (row.hidden) (config.rowhidden ??= {})[String(r)] = 0;
    });
    const sheet: any = {
      name,
      id: `${prefix}-${si}`,
      order: si,
      status: 0,
      row: Math.max(100, maxR + 21),
      column: Math.max(26, maxC + 6),
      celldata: celldata.sort((a, b) => a.r - b.r || a.c - b.c),
      config,
    };
    if (wb.Workbook?.Sheets?.[si]?.Hidden) sheet.hide = 1;
    return sheet;
  });
  const namedRanges: NamedRange[] = [];
  for (const n of wb.Workbook?.Names ?? []) {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)$/.exec(String(n.Ref ?? ""));
    if (!m || !n.Name || String(n.Name).startsWith("_xlnm")) continue;
    const sheetName = (m[1] ?? m[2]).replace(/''/g, "'");
    const idx = wb.SheetNames.indexOf(sheetName);
    namedRanges.push({ name: n.Name, range: m[3].replace(/\$/g, ""), sheetId: idx >= 0 ? `${prefix}-${idx}` : "", sheetName });
  }
  if (namedRanges.length && sheets[0]) sheets[0]._namedRanges = namedRanges;
  return { sheets, namedRanges, warnings };
}

export interface ImportFileOptions extends CsvImportOptions {
  userId?: string;
}

async function toBytes(file: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  if (typeof (file as Blob).arrayBuffer === "function") return new Uint8Array(await (file as Blob).arrayBuffer());
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file as Blob);
  });
}

/** Extensions the optional LibreOffice converter (CC8) may take for Sheets. */
const SERVER_CONVERTIBLE = new Set(["xls", "xlt", "ods"]);

/** With LibreOffice enabled on the server, .xls/.xlt (and .ods when the
 *  server prefers it) are converted to .xlsx there and read by the full
 *  xlsx reader; any failure falls back to SheetJS. */
async function viaServer(bytes: Uint8Array, name: string, opts: ImportFileOptions): Promise<ImportedWorkbook | null> {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  if (!SERVER_CONVERTIBLE.has(ext)) return null;
  const caps = await officeConvertCaps();
  if (!needsServerConversion(caps, name, "xlsx")) return null;
  try {
    const xlsx = await convertOnServer(new Blob([bytes as BlobPart]), name);
    return await readXlsx(await toBytes(xlsx), { userId: opts.userId });
  } catch (e) {
    console.warn(`LibreOffice conversion of ${name} failed; reading it with SheetJS`, e);
    return null;
  }
}

/** Reads any supported spreadsheet file. */
export async function importSpreadsheetFile(
  file: Blob | ArrayBuffer | Uint8Array,
  name: string,
  opts: ImportFileOptions = {},
): Promise<ImportedWorkbook> {
  const bytes = await toBytes(file);
  const converted = await viaServer(bytes, name, opts);
  if (converted) return converted;
  const kind = importKind(name, bytes.subarray(0, 4));
  const base = name.replace(/\.[^.]+$/, "").slice(0, 31) || "Sheet1";
  switch (kind) {
    case "xlsx":
      try {
        return await readXlsx(bytes, { userId: opts.userId });
      } catch (e) {
        // Strict-OOXML and other oddities: fall back to SheetJS.
        try {
          return await sheetjsToWorkbook(bytes);
        } catch {
          throw e;
        }
      }
    case "sheetjs":
      return sheetjsToWorkbook(bytes);
    case "csv": {
      const text = new TextDecoder().decode(bytes);
      const delimiter = opts.delimiter ?? (/\.tsv$|\.tab$/i.test(name) ? "\t" : undefined);
      return csvToWorkbook(text, { ...opts, delimiter, name: opts.name ?? base });
    }
    default:
      throw new Error("Unsupported file type. Import .xlsx, .xls, .ods, .csv or .tsv files.");
  }
}

// ---- merging into the open workbook ----------------------------------------------------

function uniqueName(name: string, taken: Set<string>): string {
  let n = name;
  let i = 2;
  while (taken.has(n.toLowerCase())) n = `${name.slice(0, 26)} (${i++})`;
  taken.add(n.toLowerCase());
  return n;
}

function renameInSheet(sheet: any, from: string, to: string): any {
  if (from === to) return sheet;
  const celldata = (sheet.celldata ?? []).map((cd: any) =>
    typeof cd?.v?.f === "string" ? { ...cd, v: { ...cd.v, f: renameSheetInFormula(cd.v.f, from, to) } } : cd,
  );
  return { ...sheet, celldata };
}

function mergeNamedRanges(target: NamedRange[], add: NamedRange[], renames: Map<string, { name: string; id: string }>): NamedRange[] {
  const out = [...target];
  const names = new Set(target.map((n) => n.name.toLowerCase()));
  for (const n of add) {
    if (names.has(n.name.toLowerCase())) continue;
    names.add(n.name.toLowerCase());
    const re = renames.get(n.sheetName);
    out.push(re ? { ...n, sheetName: re.name, sheetId: re.id } : n);
  }
  return out;
}

/** Cells of the first imported sheet moved by (dr, dc). */
function shiftedCells(sheet: any, dr: number, dc: number): any[] {
  return (sheet?.celldata ?? []).map((cd: any) => {
    const v = { ...cd.v };
    if (v.mc) v.mc = { ...v.mc, r: v.mc.r + dr, c: v.mc.c + dc };
    return { r: cd.r + dr, c: cd.c + dc, v };
  });
}

function lastUsedRow(sheet: any): number {
  let last = -1;
  for (const cd of sheet?.celldata ?? []) {
    const v = cd?.v;
    if (v && (v.v !== undefined && v.v !== null && v.v !== "" || v.f || v.ct?.s)) last = Math.max(last, cd.r);
  }
  return last;
}

export interface ImportTarget {
  /** Id of the active sheet. */
  sheetId?: string;
  /** Selected cell (for replaceAtCell). */
  r?: number;
  c?: number;
}

/**
 * The workbook after importing `imp` into `current` (stored form: celldata).
 * Pure. For "newSpreadsheet" it returns the imported sheets as a workbook.
 */
export function applyImport(current: any[], imp: ImportedWorkbook, mode: ImportMode, target: ImportTarget = {}): any[] {
  const cur = Array.isArray(current) ? current.filter(Boolean) : [];
  const fresh = (sheets: any[]) => sheets.map((s, i) => ({ ...s, order: i }));
  if (mode === "newSpreadsheet" || mode === "replaceSpreadsheet" || !cur.length) return fresh(imp.sheets);
  if (mode === "insertSheets") {
    const taken = new Set(cur.map((s) => String(s.name ?? "").toLowerCase()));
    const ids = new Set(cur.map((s) => String(s.id)));
    const renames = new Map<string, { name: string; id: string }>();
    let added = imp.sheets.map((s) => {
      const name = uniqueName(String(s.name ?? "Sheet"), taken);
      let id = String(s.id ?? name);
      while (ids.has(id)) id = `${id}_`;
      ids.add(id);
      renames.set(String(s.name), { name, id });
      const copy = { ...s, name, id };
      delete copy._namedRanges;
      return copy;
    });
    for (const [from, to] of renames) added = added.map((s) => renameInSheet(s, from, to.name));
    const out = [...cur, ...added].map((s, i) => ({ ...s, order: i }));
    const nr = mergeNamedRanges(Array.isArray(cur[0]._namedRanges) ? cur[0]._namedRanges : [], imp.namedRanges, renames);
    if (nr.length) out[0] = { ...out[0], _namedRanges: nr };
    return out;
  }
  const idx = Math.max(0, cur.findIndex((s) => String(s.id) === String(target.sheetId)));
  const host = cur[idx];
  const src = imp.sheets[0] ?? { celldata: [] };
  const out = [...cur];
  if (mode === "replaceSheet") {
    const { _namedRanges: _drop, ...rest } = src;
    void _drop;
    out[idx] = { ...rest, id: host.id, name: host.name, order: host.order ?? idx, ...(idx === 0 && host._namedRanges ? { _namedRanges: host._namedRanges } : {}) };
    return out;
  }
  const dr = mode === "appendRows" ? lastUsedRow(host) + 1 : (target.r ?? 0);
  const dc = mode === "appendRows" ? 0 : (target.c ?? 0);
  const moved = shiftedCells(src, dr, dc);
  const keys = new Set(moved.map((cd) => `${cd.r}_${cd.c}`));
  const celldata = [...(host.celldata ?? []).filter((cd: any) => !keys.has(`${cd.r}_${cd.c}`)), ...moved];
  const merge = { ...(host.config?.merge ?? {}) };
  for (const m of Object.values(src.config?.merge ?? {}) as any[]) merge[`${m.r + dr}_${m.c + dc}`] = { ...m, r: m.r + dr, c: m.c + dc };
  const maxR = celldata.reduce((m: number, cd: any) => Math.max(m, cd.r), 0);
  const maxC = celldata.reduce((m: number, cd: any) => Math.max(m, cd.c), 0);
  out[idx] = {
    ...host,
    celldata,
    config: { ...(host.config ?? {}), ...(Object.keys(merge).length ? { merge } : {}) },
    row: Math.max(Number(host.row) || 100, maxR + 21),
    column: Math.max(Number(host.column) || 26, maxC + 6),
  };
  return out;
}

/** A one-line summary for the import dialog ("2 sheets, 120 cells"). */
export function describeImport(imp: ImportedWorkbook): string {
  const cells = imp.sheets.reduce((n, s) => n + (s.celldata?.length ?? 0), 0);
  const sheets = imp.sheets.length;
  const first = imp.sheets[0];
  let range = "";
  if (first?.celldata?.length) {
    const maxR = Math.max(...first.celldata.map((cd: any) => cd.r));
    const maxC = Math.max(...first.celldata.map((cd: any) => cd.c));
    range = ` (first sheet A1:${colToLetters(maxC)}${maxR + 1})`;
  }
  return `${sheets} sheet${sheets === 1 ? "" : "s"}, ${cells} cell${cells === 1 ? "" : "s"}${range}`;
}
