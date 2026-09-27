// Mail merge (Docs M12): data sources, merge fields, preview and merging.
//
// A data source is a table whose first row names the fields: a range of a
// Grown Sheet (the FortuneSheet workbook JSON the Sheets API returns) or an
// uploaded CSV. Merge fields are M8 `field` nodes with a Word MERGEFIELD
// instruction (`MERGEFIELD "First name"`); their cached result is the
// «First name» placeholder, or a record's value while previewing. Merging
// replaces every merge field with the record's value (keeping the field's
// formatting) and stacks one copy of the document per record, a page break
// between records.
//
// Pure apart from the editor helpers at the bottom.
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { parseDelimited } from "../sheets/csvText";
import { applyCaseFormats, parseInstr } from "./fields";

export interface MergeData {
  fields: string[];
  records: Record<string, string>[];
}

// --- data sources -------------------------------------------------------------------------

/** colIndex turns "A" / "AB" into a 0-based column. */
function colIndex(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** parseA1Range reads "A1:D20" (or a single cell); null when malformed. */
export function parseA1Range(s: string): CellRange | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*(?::\s*\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(s);
  if (!m) return null;
  const c1 = colIndex(m[1]);
  const r1 = +m[2] - 1;
  const c2 = m[3] ? colIndex(m[3]) : c1;
  const r2 = m[4] ? +m[4] - 1 : r1;
  if (r1 < 0 || r2 < 0) return null;
  return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet models are loosely typed. */
function cellText(v: any): string {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  if (v.m != null && v.m !== "") return String(v.m);
  if (v.ct?.s && Array.isArray(v.ct.s)) return v.ct.s.map((p: any) => String(p?.v ?? "")).join("");
  if (v.v != null) return String(v.v);
  return "";
}

/** sheetTabs lists a workbook's sheet names. */
export function sheetTabs(workbookJson: string): string[] {
  try {
    const wb = JSON.parse(workbookJson || "[]");
    return Array.isArray(wb) ? wb.map((s: any, i: number) => String(s?.name ?? `Sheet${i + 1}`)) : [];
  } catch {
    return [];
  }
}

/** sheetRows reads a tab of a FortuneSheet workbook as rows of display
 *  text: the given range, or the used range when none. */
export function sheetRows(workbookJson: string, tab?: string, range?: CellRange | null): string[][] {
  let wb: any[] = [];
  try {
    wb = JSON.parse(workbookJson || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(wb) || !wb.length) return [];
  const sh = (tab && wb.find((s) => s?.name === tab)) || wb[0];
  const cells = new Map<string, string>();
  let maxR = -1;
  let maxC = -1;
  const put = (r: number, c: number, v: any) => {
    const t = cellText(v);
    if (t === "") return;
    cells.set(`${r},${c}`, t);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  };
  if (Array.isArray(sh.celldata) && sh.celldata.length) for (const cd of sh.celldata) put(cd.r, cd.c, cd.v);
  else if (Array.isArray(sh.data)) sh.data.forEach((row: any[], r: number) => row?.forEach((v, c) => put(r, c, v)));
  const R = range ?? { r1: 0, c1: 0, r2: maxR, c2: maxC };
  const out: string[][] = [];
  for (let r = R.r1; r <= R.r2; r++) {
    const row: string[] = [];
    for (let c = R.c1; c <= R.c2; c++) row.push(cells.get(`${r},${c}`) ?? "");
    out.push(row);
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** csvRows parses CSV (comma, semicolon or tab, whichever the header uses). */
export function csvRows(text: string): string[][] {
  const head = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, head.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  return parseDelimited(text.replace(/^﻿/, ""), { delimiter });
}

/** recordsFromRows takes the first row as field names (blank or repeated
 *  names get "Column N") and the rest as records, skipping empty rows. */
export function recordsFromRows(rows: string[][]): MergeData {
  const header = rows[0] ?? [];
  const width = Math.max(header.length, ...rows.map((r) => r.length));
  const seen = new Set<string>();
  const fields: string[] = [];
  for (let c = 0; c < width; c++) {
    let name = (header[c] ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) name = `Column ${c + 1}`;
    seen.add(name.toLowerCase());
    fields.push(name);
  }
  const records: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    if (!row.some((v) => (v ?? "").trim() !== "")) continue;
    const rec: Record<string, string> = {};
    fields.forEach((f, c) => (rec[f] = row[c] ?? ""));
    records.push(rec);
  }
  // Drop trailing columns that have neither a name nor any value.
  while (fields.length && /^Column \d+$/.test(fields[fields.length - 1]) && !records.some((r) => r[fields[fields.length - 1]])) {
    const f = fields.pop()!;
    for (const r of records) delete r[f];
  }
  return { fields, records };
}

// --- merge fields -------------------------------------------------------------------------

/** mergeFieldInstr is Word's instruction for a merge field. */
export function mergeFieldInstr(name: string): string {
  return /^[\p{L}\p{N}_]+$/u.test(name) ? `MERGEFIELD ${name}` : `MERGEFIELD "${name.replace(/"/g, "")}"`;
}

/** mergeFieldName reads the field name from an instruction (null when it
 *  isn't a MERGEFIELD). */
export function mergeFieldName(instr: string): string | null {
  const p = parseInstr(instr);
  return p.type === "MERGEFIELD" ? (p.args[0] ?? "") : null;
}

export const placeholder = (name: string) => `«${name}»`;

/** fieldValue looks a field up in a record (names match case-insensitively,
 *  as in Word) and applies the field's \* case switches. */
export function fieldValue(instr: string, record: Record<string, string>): string {
  const p = parseInstr(instr);
  const name = (p.args[0] ?? "").toLowerCase();
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const v = key != null ? record[key] : "";
  return applyCaseFormats(v, p.formats);
}

/** usedFields lists the merge field names in a document, in order. */
export function usedFields(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === "field") {
      const name = mergeFieldName(String(n.attrs.instr ?? ""));
      if (name != null && !out.includes(name)) out.push(name);
    }
    return true;
  });
  return out;
}

/** mergeRecord returns the document with every merge field replaced by the
 *  record's value as text (with the field's marks). */
export function mergeRecord(doc: PMNode, record: Record<string, string>): PMNode {
  const schema = doc.type.schema;
  const map = (node: PMNode): PMNode => {
    if (node.isLeaf) return node;
    const kids: PMNode[] = [];
    node.forEach((child) => {
      if (child.type.name === "field" && mergeFieldName(String(child.attrs.instr ?? "")) != null) {
        const v = fieldValue(String(child.attrs.instr), record);
        if (v) kids.push(schema.text(v, child.marks));
        return;
      }
      kids.push(map(child));
    });
    return node.copy(joinText(schema, kids));
  };
  return map(doc);
}

/** joinText makes a fragment, joining adjacent text nodes with the same marks. */
function joinText(schema: Schema, nodes: PMNode[]): Fragment {
  const out: PMNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && last.isText && n.isText && last.sameMarkup(n)) out[out.length - 1] = schema.text((last.text ?? "") + (n.text ?? ""), n.marks);
    else out.push(n);
  }
  return Fragment.fromArray(out);
}

/** mergeAll stacks one merged copy per record, a page break between. */
export function mergeAll(doc: PMNode, records: Record<string, string>[]): PMNode {
  const schema = doc.type.schema;
  const blocks: PMNode[] = [];
  records.forEach((rec, i) => {
    if (i > 0 && schema.nodes.pageBreak) blocks.push(schema.nodes.pageBreak.create());
    mergeRecord(doc, rec).forEach((b) => blocks.push(b));
  });
  if (!blocks.length) return doc;
  return schema.nodes.doc.create(doc.attrs, blocks);
}

/** mergeText is a record's merged document as plain text (e-mail bodies):
 *  paragraphs separated by blank lines. */
export function mergeText(doc: PMNode, record: Record<string, string>): string {
  const merged = mergeRecord(doc, record);
  const paras: string[] = [];
  merged.descendants((n) => {
    if (n.isTextblock) {
      let s = "";
      n.forEach((c) => (s += c.isText ? c.text : c.type.name === "hardBreak" ? "\n" : c.type.name === "field" ? String(c.attrs.result ?? "") : ""));
      paras.push(s);
      return false;
    }
    return true;
  });
  return paras.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** fillTemplate replaces «Field» (and {{Field}}) in a short template such
 *  as an e-mail subject. */
export function fillTemplate(tpl: string, record: Record<string, string>): string {
  const look = (name: string) => {
    const key = Object.keys(record).find((k) => k.toLowerCase() === name.trim().toLowerCase());
    return key != null ? record[key] : "";
  };
  return tpl.replace(/«([^»]+)»/g, (_, n) => look(n)).replace(/\{\{([^}]+)\}\}/g, (_, n) => look(n));
}

/** emailField guesses the field holding e-mail addresses. */
export function emailField(data: MergeData): string | null {
  const byName = data.fields.find((f) => /e-?mail/i.test(f));
  if (byName) return byName;
  return data.fields.find((f) => data.records.length > 0 && data.records.every((r) => /^[^@\s]+@[^@\s]+$/.test((r[f] ?? "").trim()))) ?? null;
}

export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

// --- editor helpers -----------------------------------------------------------------------

/** insertMergeField inserts a merge field at the selection. */
export function insertMergeField(editor: Editor, name: string): boolean {
  const type = editor.schema.nodes.field;
  if (!type) return false;
  const node = type.create({ instr: mergeFieldInstr(name), result: placeholder(name) });
  const { state, view } = editor;
  view.dispatch(state.tr.replaceSelectionWith(node, true).scrollIntoView());
  return true;
}

/** previewRecord shows a record's values in the merge fields (null: the
 *  «Field» placeholders again). */
export function previewRecord(editor: Editor, record: Record<string, string> | null): void {
  const { state } = editor;
  const tr = state.tr;
  state.doc.descendants((n, pos) => {
    if (n.type.name !== "field") return true;
    const instr = String(n.attrs.instr ?? "");
    const name = mergeFieldName(instr);
    if (name == null) return false;
    const result = record ? fieldValue(instr, record) : placeholder(name);
    if (result !== n.attrs.result) tr.setNodeMarkup(pos, undefined, { ...n.attrs, result });
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}
